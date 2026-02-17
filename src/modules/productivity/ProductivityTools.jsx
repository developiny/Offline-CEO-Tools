import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ToolTabs from '../../components/ToolTabs.jsx'
import FileDrop from '../../components/FileDrop.jsx'
import ProgressBar from '../../components/ProgressBar.jsx'
import Preview from '../../components/Preview.jsx'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import { downloadBlob, formatBytes } from '../../utils/file.js'
import { zipBlobs } from '../../utils/zip.js'
import { sniffFileType } from '../../utils/fileType.js'
import { hashFile } from '../../utils/crypto.js'
import { buildIcsEvent } from '../../utils/ics.js'
import { buildUtmUrl } from '../../utils/utm.js'
import { addRecent, toolKey } from '../../utils/toolPrefs.js'

const libsRef = { current: { qrcode: null, jsqr: null, jsbarcode: null, math: null } }

async function getQrCodeLib() {
  if (libsRef.current.qrcode) return libsRef.current.qrcode
  const mod = await import('qrcode')
  libsRef.current.qrcode = mod.default || mod
  return libsRef.current.qrcode
}

async function getJsQrLib() {
  if (libsRef.current.jsqr) return libsRef.current.jsqr
  const mod = await import('jsqr')
  libsRef.current.jsqr = mod.default || mod
  return libsRef.current.jsqr
}

async function getJsBarcodeLib() {
  if (libsRef.current.jsbarcode) return libsRef.current.jsbarcode
  const mod = await import('jsbarcode')
  libsRef.current.jsbarcode = mod.default || mod
  return libsRef.current.jsbarcode
}

async function getMathLib() {
  if (libsRef.current.math) return libsRef.current.math
  const mod = await import('mathjs')
  // Create a math instance lazily to keep bundle small until used.
  const math = mod.create(mod.all, {})
  libsRef.current.math = math
  return math
}

const TOOLS = [
  { id: 'qr', label: 'QR' },
  { id: 'utm', label: 'UTM + QR' },
  { id: 'ics', label: 'ICS' },
  { id: 'timer', label: 'Timer' },
  { id: 'barcode', label: 'Barcode' },
  { id: 'unit', label: 'Units' },
  { id: 'tz', label: 'Time zones' },
  { id: 'calc', label: 'Calculator' },
  { id: 'pct', label: 'Percent' },
  { id: 'size', label: 'File size' },
  { id: 'rename', label: 'Renamer' },
  { id: 'detect', label: 'Type + SHA-256' },
]

const COMMON_TZ = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
]

function fmtInTz(date, timeZone) {
  const fmt = new Intl.DateTimeFormat(undefined, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return fmt.format(date)
}

function safeName(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|]+/g, '_')
}

function dataUrlToBlob(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!m) throw new Error('Invalid data URL.')
  const mime = m[1]
  const b64 = m[2]
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function looksLikeHttpUrl(text) {
  try {
    const u = new URL(String(text || '').trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function decodeQrFromCanvas(jsQR, canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return ''
  const w = canvas.width
  const h = canvas.height
  if (!w || !h) return ''
  const img = ctx.getImageData(0, 0, w, h)

  // Try normal + inverted decoding first.
  let res = jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' })
  if (res?.data) return res.data

  // Then try a simple high-contrast pass for noisy screenshots.
  const boosted = new Uint8ClampedArray(img.data)
  for (let i = 0; i < boosted.length; i += 4) {
    const lum = 0.2126 * boosted[i] + 0.7152 * boosted[i + 1] + 0.0722 * boosted[i + 2]
    const v = lum > 145 ? 255 : 0
    boosted[i] = v
    boosted[i + 1] = v
    boosted[i + 2] = v
  }
  res = jsQR(boosted, w, h, { inversionAttempts: 'attemptBoth' })
  return res?.data || ''
}

function applyRename(name, opts) {
  const base = safeName(name).replace(/\.[^.]+$/, '')
  const ext = (safeName(name).match(/\.([^.]+)$/) || [])[1] || ''

  let out = opts.template
    .replaceAll('{name}', base)
    .replaceAll('{ext}', ext)
    .replaceAll('{index}', String(opts.index))

  if (opts.prefix) out = opts.prefix + out
  if (opts.suffix) out = out + opts.suffix

  if (opts.find) out = out.split(opts.find).join(opts.replace || '')

  if (!out.includes('.') && ext) out += '.' + ext
  return out
}

const unitDefs = {
  length: {
    label: 'Length',
    base: 'm',
    units: {
      m: 1,
      km: 1000,
      cm: 0.01,
      mm: 0.001,
      in: 0.0254,
      ft: 0.3048,
      yd: 0.9144,
      mi: 1609.344,
    },
  },
  mass: {
    label: 'Mass',
    base: 'kg',
    units: {
      kg: 1,
      g: 0.001,
      lb: 0.45359237,
      oz: 0.028349523125,
    },
  },
  temperature: {
    label: 'Temperature',
    base: 'C',
    units: { C: 1, F: 1, K: 1 },
    convert(value, from, to) {
      const v = Number(value)
      if (!Number.isFinite(v)) return NaN
      let c = v
      if (from === 'F') c = (v - 32) * (5 / 9)
      if (from === 'K') c = v - 273.15
      if (to === 'C') return c
      if (to === 'F') return c * (9 / 5) + 32
      return c + 273.15
    },
  },
  area: {
    label: 'Area',
    base: 'm2',
    units: {
      m2: 1,
      km2: 1000000,
      cm2: 0.0001,
      mm2: 0.000001,
      ft2: 0.09290304,
      yd2: 0.83612736,
      acre: 4046.8564224,
      ha: 10000,
    },
  },
  volume: {
    label: 'Volume',
    base: 'm3',
    units: {
      m3: 1,
      l: 0.001,
      ml: 0.000001,
      ft3: 0.028316846592,
      in3: 0.000016387064,
      gal_us: 0.003785411784,
      qt_us: 0.000946352946,
    },
  },
  speed: {
    label: 'Speed',
    base: 'm/s',
    units: {
      'm/s': 1,
      'km/h': 0.2777777777778,
      mph: 0.44704,
      knot: 0.5144444444444,
      'ft/s': 0.3048,
    },
  },
  data: {
    label: 'Data Size',
    base: 'B',
    units: {
      B: 1,
      KB: 1000,
      MB: 1000000,
      GB: 1000000000,
      TB: 1000000000000,
      KiB: 1024,
      MiB: 1048576,
      GiB: 1073741824,
      TiB: 1099511627776,
      bit: 0.125,
    },
  },
  pressure: {
    label: 'Pressure',
    base: 'Pa',
    units: {
      Pa: 1,
      kPa: 1000,
      bar: 100000,
      psi: 6894.757293168,
      atm: 101325,
      mmHg: 133.322387415,
    },
  },
  energy: {
    label: 'Energy',
    base: 'J',
    units: {
      J: 1,
      kJ: 1000,
      cal: 4.184,
      kcal: 4184,
      Wh: 3600,
      kWh: 3600000,
      eV: 1.602176634e-19,
    },
  },
  power: {
    label: 'Power',
    base: 'W',
    units: {
      W: 1,
      kW: 1000,
      MW: 1000000,
      hp: 745.699871582,
      'BTU/h': 0.29307107,
    },
  },
  time: {
    label: 'Time',
    base: 's',
    units: {
      s: 1,
      min: 60,
      h: 3600,
      day: 86400,
      week: 604800,
      month_30d: 2592000,
      year_365d: 31536000,
      ms: 0.001,
    },
  },
  angle: {
    label: 'Angle',
    base: 'rad',
    units: {
      rad: 1,
      deg: Math.PI / 180,
      grad: Math.PI / 200,
      turn: Math.PI * 2,
    },
  },
}

export default function ProductivityTools() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tool, setTool] = useState('qr')
  const [err, setErr] = useState('')

  useEffect(() => {
    const t = searchParams.get('tool')
    if (t && TOOLS.some((x) => x.id === t)) setTool(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p)
      next.set('tool', tool)
      return next
    })
    const t = TOOLS.find((x) => x.id === tool)
    if (t) {
      addRecent({
        key: toolKey('productivity', tool),
        label: `Prod: ${t.label}`,
        path: `/productivity?tool=${tool}`,
        tool,
      })
      window.dispatchEvent(new Event('oct:prefs'))
    }
  }, [tool, setSearchParams])

  useEffect(() => {
    // Opportunistic prefetch for active tab; keeps initial bundle smaller but avoids first-click lag.
    if (tool === 'calc') getMathLib().catch(() => {})
    if (tool === 'qr' || tool === 'utm') {
      getQrCodeLib().catch(() => {})
      getJsQrLib().catch(() => {})
    }
    if (tool === 'barcode') getJsBarcodeLib().catch(() => {})
  }, [tool])

  // QR generator
  const [qrText, setQrText] = useState('https://example.com')
  const [qrUrl, setQrUrl] = useState('')
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const QRCode = await getQrCodeLib()
        const url = await QRCode.toDataURL(qrText || '', { margin: 1, width: 320 })
        if (!cancelled) setQrUrl(url)
      } catch {
        if (!cancelled) setQrUrl('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [qrText])

  // UTM builder
  const [utmBase, setUtmBase] = useState('https://example.com')
  const [utm, setUtm] = useState({
    source: 'newsletter',
    medium: 'email',
    campaign: 'spring-launch',
    term: '',
    content: '',
  })
  const utmUrl = useMemo(() => {
    try {
      return buildUtmUrl(utmBase, utm)
    } catch {
      return ''
    }
  }, [utmBase, utm])
  const [utmQrUrl, setUtmQrUrl] = useState('')
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!utmUrl) return setUtmQrUrl('')
        const QRCode = await getQrCodeLib()
        const url = await QRCode.toDataURL(utmUrl, { margin: 1, width: 320 })
        if (!cancelled) setUtmQrUrl(url)
      } catch {
        if (!cancelled) setUtmQrUrl('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [utmUrl])

  // ICS generator
  const [icsSummary, setIcsSummary] = useState('Meeting')
  const [icsDesc, setIcsDesc] = useState('')
  const [icsLoc, setIcsLoc] = useState('')
  const [icsUrl, setIcsUrl] = useState('')
  const [icsStart, setIcsStart] = useState(() => new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 16))
  const [icsEnd, setIcsEnd] = useState(() => new Date(Date.now() + 40 * 60 * 1000).toISOString().slice(0, 16))
  const icsText = useMemo(() => {
    try {
      return buildIcsEvent({
        start: new Date(icsStart),
        end: new Date(icsEnd),
        summary: icsSummary,
        description: icsDesc,
        location: icsLoc,
        url: icsUrl,
      })
    } catch {
      return ''
    }
  }, [icsStart, icsEnd, icsSummary, icsDesc, icsLoc, icsUrl])

  // Pomodoro timer
  const [pomoWorkMin, setPomoWorkMin] = useState(25)
  const [pomoBreakMin, setPomoBreakMin] = useState(5)
  const [pomoMode, setPomoMode] = useState('work') // work|break
  const [pomoRunning, setPomoRunning] = useState(false)
  const [pomoLeftMs, setPomoLeftMs] = useState(25 * 60 * 1000)
  const pomoRef = useRef({ t: 0, endAt: 0 })
  useEffect(() => {
    if (!pomoRunning) return
    const id = setInterval(() => {
      const now = Date.now()
      const left = Math.max(0, pomoRef.current.endAt - now)
      setPomoLeftMs(left)
      if (left === 0) {
        // auto-switch
        const nextMode = pomoMode === 'work' ? 'break' : 'work'
        setPomoMode(nextMode)
        const dur = (nextMode === 'work' ? Number(pomoWorkMin) : Number(pomoBreakMin)) * 60 * 1000
        pomoRef.current.endAt = Date.now() + dur
        setPomoLeftMs(dur)
      }
    }, 250)
    return () => clearInterval(id)
  }, [pomoRunning, pomoMode, pomoWorkMin, pomoBreakMin])

  // QR reader (camera)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [camOn, setCamOn] = useState(false)
  const [qrFound, setQrFound] = useState('')
  const [qrReading, setQrReading] = useState(false)
  const [qrImagePreview, setQrImagePreview] = useState('')
  const [qrImageName, setQrImageName] = useState('')
  const streamRef = useRef(null)
  const qrPreviewRef = useRef('')

  async function startCamera() {
    setErr('')
    setQrFound('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCamOn(true)
    } catch (e) {
      setErr(e?.message || 'Camera permission denied.')
      setCamOn(false)
    }
  }

  function stopCamera() {
    const s = streamRef.current
    if (s) for (const t of s.getTracks()) t.stop()
    streamRef.current = null
    setCamOn(false)
  }

  useEffect(() => {
    if (!camOn) return
    let raf = 0
    const tick = () => {
      const v = videoRef.current
      const c = canvasRef.current
      if (!v || !c) {
        raf = requestAnimationFrame(tick)
        return
      }
      const w = v.videoWidth || 0
      const h = v.videoHeight || 0
      if (w && h) {
        c.width = w
        c.height = h
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(v, 0, 0, w, h)
        const img = ctx.getImageData(0, 0, w, h)
        getJsQrLib()
          .then((jsQR) => {
            const res = jsQR(img.data, w, h)
            if (res?.data) setQrFound(res.data)
          })
          .catch(() => {})
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [camOn])

  async function readQrFromImageFile(file) {
    setErr('')
    setQrFound('')
    setQrReading(true)
    try {
      if (qrPreviewRef.current) URL.revokeObjectURL(qrPreviewRef.current)
      const previewUrl = URL.createObjectURL(file)
      qrPreviewRef.current = previewUrl
      setQrImagePreview(previewUrl)
      setQrImageName(file.name || 'image')

      const jsQR = await getJsQrLib()
      const bmp = await createImageBitmap(file)
      const maxSide = Math.max(1, bmp.width, bmp.height)
      const baseScale = Math.min(1, 1800 / maxSide)
      const variants = [
        { scale: 1.0, rotate: 0 },
        { scale: 1.0, rotate: 90 },
        { scale: 1.0, rotate: 180 },
        { scale: 1.0, rotate: 270 },
        { scale: 0.75, rotate: 0 },
        { scale: 1.35, rotate: 0 },
        { scale: 0.5, rotate: 0 },
      ]
      let found = ''
      for (const step of variants) {
        if (found) break
        const s = Math.max(0.2, step.scale * baseScale)
        const rw = Math.max(1, Math.round(bmp.width * s))
        const rh = Math.max(1, Math.round(bmp.height * s))
        const rot = ((step.rotate % 360) + 360) % 360
        const swap = rot === 90 || rot === 270
        const outW = swap ? rh : rw
        const outH = swap ? rw : rh

        const c = document.createElement('canvas')
        c.width = outW
        c.height = outH
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx) continue
        ctx.translate(outW / 2, outH / 2)
        ctx.rotate((rot * Math.PI) / 180)
        ctx.drawImage(bmp, -rw / 2, -rh / 2, rw, rh)
        found = decodeQrFromCanvas(jsQR, c)
      }
      if (typeof bmp.close === 'function') bmp.close()

      if (found) setQrFound(found)
      else setErr('No QR code detected in this image.')
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setQrReading(false)
    }
  }

  // Barcode
  const barcodeSvgRef = useRef(null)
  const [barcodeText, setBarcodeText] = useState('123456789012')
  const [barcodeFmt, setBarcodeFmt] = useState('CODE128')
  useEffect(() => {
    try {
      if (!barcodeSvgRef.current) return
      getJsBarcodeLib()
        .then((JsBarcode) => {
          JsBarcode(barcodeSvgRef.current, barcodeText || '', {
            format: barcodeFmt,
            displayValue: true,
            margin: 10,
          })
        })
        .catch(() => {})
    } catch {
      // ignore render errors
    }
  }, [barcodeText, barcodeFmt])

  // Units
  const [unitKind, setUnitKind] = useState('length')
  const unitDef = unitDefs[unitKind]
  const unitKeys = Object.keys(unitDef.units)
  const [unitFrom, setUnitFrom] = useState(unitKeys[0])
  const [unitTo, setUnitTo] = useState(unitKeys[1] || unitKeys[0])
  const [unitValue, setUnitValue] = useState('1')
  useEffect(() => {
    const keys = Object.keys(unitDefs[unitKind].units)
    setUnitFrom(keys[0])
    setUnitTo(keys[1] || keys[0])
  }, [unitKind])
  const unitOut = useMemo(() => {
    const v = Number(unitValue)
    if (!Number.isFinite(v)) return ''
    if (unitDef.convert) return String(unitDef.convert(v, unitFrom, unitTo))
    const base = v * unitDef.units[unitFrom]
    const out = base / unitDef.units[unitTo]
    return String(out)
  }, [unitValue, unitFrom, unitTo, unitDef])

  // Time zones
  const [tzDate, setTzDate] = useState(() => {
    const d = new Date()
    d.setSeconds(0, 0)
    return d.toISOString()
  })
  const tzBaseDate = useMemo(() => new Date(tzDate), [tzDate])

  // Calculator
  const [expr, setExpr] = useState('sin(pi / 4)^2')
  const [exprOut, setExprOut] = useState('')
  function runCalc() {
    setErr('')
    try {
      getMathLib()
        .then((math) => {
          const res = math.evaluate(expr)
          setExprOut(typeof res === 'string' ? res : String(res))
        })
        .catch((e) => {
          setErr(e?.message || 'Invalid expression.')
          setExprOut('')
        })
    } catch (e) {
      setErr(e?.message || 'Invalid expression.')
      setExprOut('')
    }
  }

  // Percent
  const [pctBase, setPctBase] = useState('200')
  const [pctRate, setPctRate] = useState('15')
  const pctAmount = useMemo(() => {
    const b = Number(pctBase)
    const r = Number(pctRate)
    if (!Number.isFinite(b) || !Number.isFinite(r)) return ''
    return String((b * r) / 100)
  }, [pctBase, pctRate])
  const pctTotal = useMemo(() => {
    const b = Number(pctBase)
    const a = Number(pctAmount)
    if (!Number.isFinite(b) || !Number.isFinite(a)) return ''
    return String(b + a)
  }, [pctBase, pctAmount])

  // File size
  const [bytes, setBytes] = useState('1048576')
  const sizeOut = useMemo(() => formatBytes(Number(bytes)), [bytes])

  // Renamer
  const [renameFiles, setRenameFiles] = useState([])
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameProgress, setRenameProgress] = useState(0)
  const [template, setTemplate] = useState('{name}')
  const [prefix, setPrefix] = useState('')
  const [suffix, setSuffix] = useState('')
  const [find, setFind] = useState('')
  const [rep, setRep] = useState('')

  async function runRenameZip() {
    if (!renameFiles.length) return
    setErr('')
    setRenameBusy(true)
    setRenameProgress(0)
    try {
      const entries = []
      for (let i = 0; i < renameFiles.length; i++) {
        const f = renameFiles[i]
        const newName = applyRename(f.name, { template, prefix, suffix, find, replace: rep, index: i + 1 })
        entries.push({ name: newName, blob: f })
        setRenameProgress((i + 1) / renameFiles.length)
      }
      const zip = await zipBlobs(entries)
      downloadBlob(zip, `renamed-${Date.now()}.zip`)
      setRenameProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setRenameBusy(false)
    }
  }

  // Detector
  const [detFiles, setDetFiles] = useState([])
  const [detResults, setDetResults] = useState([])
  const [detBusy, setDetBusy] = useState(false)
  const [detProgress, setDetProgress] = useState(0)

  async function runDetect() {
    if (!detFiles.length) return
    setErr('')
    setDetBusy(true)
    setDetProgress(0)
    setDetResults([])
    try {
      const out = []
      for (let i = 0; i < detFiles.length; i++) {
        const f = detFiles[i]
        const type = await sniffFileType(f)
        const sha = await hashFile('SHA-256', f)
        out.push({ name: f.name, size: f.size, type, sha })
        setDetProgress((i + 1) / detFiles.length)
      }
      setDetResults(out)
      setDetProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setDetBusy(false)
    }
  }

  useEffect(() => () => stopCamera(), [])
  useEffect(() => {
    return () => {
      if (qrPreviewRef.current) URL.revokeObjectURL(qrPreviewRef.current)
    }
  }, [])
  useEffect(() => {
    if (tool !== 'qr') stopCamera()
  }, [tool])

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>Productivity Tools</h1>
        <p className="muted">Local-only utilities. Camera access is optional for QR scanning.</p>
      </div>

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <ToolTabs tools={TOOLS} activeId={tool} onChange={(id) => { setTool(id); setErr('') }} />
          <FavoriteButton
            entry={{
              key: toolKey('productivity', tool),
              label: `Prod: ${TOOLS.find((x) => x.id === tool)?.label || tool}`,
              path: `/productivity?tool=${tool}`,
              tool,
            }}
          />
        </div>
        {err ? <div className="error">{err}</div> : null}
      </section>

      {tool === 'qr' ? (
        <section className="panel">
          <h2>QR Generator + Reader</h2>
          <div className="two">
            <div className="field">
              <label>Text/URL</label>
              <textarea className="textarea" value={qrText} onChange={(e) => setQrText(e.target.value)} />
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    if (!qrUrl) return
                    const blob = dataUrlToBlob(qrUrl)
                    downloadBlob(blob, `qr-${Date.now()}.png`)
                  }}
                  disabled={!qrUrl}
                >
                  Download PNG
                </button>
              </div>
            </div>
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>QR</div>
              {qrUrl ? <img src={qrUrl} alt="QR code" style={{ width: 320, maxWidth: '100%', borderRadius: 12 }} /> : <div className="muted">Invalid input.</div>}
            </div>
          </div>

          <div className="panel" style={{ padding: 14, marginTop: 10 }}>
            <div className="mono muted" style={{ marginBottom: 8 }}>Reader</div>
            <div className="row">
              {!camOn ? (
                <button className="button" type="button" onClick={startCamera}>Start camera</button>
              ) : (
                <button className="button button--ghost" type="button" onClick={stopCamera}>Stop camera</button>
              )}
              <button
                className="button button--ghost"
                type="button"
                onClick={async () => {
                  try {
                    if (!qrFound) return
                    await navigator.clipboard.writeText(qrFound)
                  } catch {
                    setErr('Clipboard blocked by browser permissions.')
                  }
                }}
                disabled={!qrFound}
              >
                Copy result
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => {
                  if (!looksLikeHttpUrl(qrFound)) return
                  window.open(qrFound, '_blank', 'noopener,noreferrer')
                }}
                disabled={!looksLikeHttpUrl(qrFound)}
              >
                Open URL
              </button>
            </div>
            <div style={{ marginTop: 10 }}>
              <FileDrop
                label="Drop QR image"
                hint="Or click to choose a local image"
                accept={['image/*']}
                multiple={false}
                onFiles={(files) => {
                  if (files?.[0]) readQrFromImageFile(files[0])
                }}
              />
            </div>

            {camOn ? (
              <div className="two" style={{ marginTop: 10 }}>
                <video ref={videoRef} style={{ width: '100%', borderRadius: 12 }} playsInline muted />
                <canvas ref={canvasRef} style={{ width: '100%', borderRadius: 12, opacity: 0.25 }} />
              </div>
            ) : null}
            {qrImagePreview ? (
              <div className="panel" style={{ padding: 10, marginTop: 10 }}>
                <div className="mono muted" style={{ marginBottom: 8 }}>
                  Uploaded image: {qrImageName || 'image'}
                </div>
                <img
                  src={qrImagePreview}
                  alt="QR upload preview"
                  style={{ maxWidth: '100%', borderRadius: 12, display: 'block' }}
                />
              </div>
            ) : null}

            <div className="field" style={{ marginTop: 10 }}>
              <label>Detected {qrReading ? '(scanning image...)' : ''}</label>
              <textarea className="textarea mono" value={qrFound} readOnly placeholder="No QR detected yet" />
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'utm' ? (
        <section className="panel">
          <h2>UTM Builder + QR</h2>
          <div className="field">
            <label>Base URL</label>
            <input className="input mono" value={utmBase} onChange={(e) => setUtmBase(e.target.value)} placeholder="https://example.com/page" />
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>utm_source</label>
              <input className="input mono" value={utm.source} onChange={(e) => setUtm((s) => ({ ...s, source: e.target.value }))} />
            </div>
            <div className="field">
              <label>utm_medium</label>
              <input className="input mono" value={utm.medium} onChange={(e) => setUtm((s) => ({ ...s, medium: e.target.value }))} />
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>utm_campaign</label>
              <input className="input mono" value={utm.campaign} onChange={(e) => setUtm((s) => ({ ...s, campaign: e.target.value }))} />
            </div>
            <div className="field">
              <label>utm_term</label>
              <input className="input mono" value={utm.term} onChange={(e) => setUtm((s) => ({ ...s, term: e.target.value }))} />
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>utm_content</label>
            <input className="input mono" value={utm.content} onChange={(e) => setUtm((s) => ({ ...s, content: e.target.value }))} />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Result URL</label>
            <textarea className="textarea" value={utmUrl} readOnly />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="button"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(utmUrl)
                } catch {
                  setErr('Clipboard blocked by browser permissions.')
                }
              }}
              disabled={!utmUrl}
            >
              Copy URL
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => {
                if (!utmQrUrl) return
                downloadBlob(dataUrlToBlob(utmQrUrl), `utm-qr-${Date.now()}.png`)
              }}
              disabled={!utmQrUrl}
            >
              Download QR
            </button>
          </div>
          <div className="panel" style={{ padding: 14, marginTop: 10 }}>
            <div className="mono muted" style={{ marginBottom: 8 }}>QR</div>
            {utmQrUrl ? <img src={utmQrUrl} alt="UTM QR" style={{ width: 320, maxWidth: '100%', borderRadius: 12 }} /> : <div className="muted">Enter a valid URL.</div>}
          </div>
        </section>
      ) : null}

      {tool === 'ics' ? (
        <section className="panel">
          <h2>ICS Calendar Event Generator</h2>
          <p className="muted">Generates a downloadable .ics file (UTC). Import into Google/Apple/Outlook calendars.</p>
          <div className="two">
            <div className="field">
              <label>Start (local)</label>
              <input className="input mono" type="datetime-local" value={icsStart} onChange={(e) => setIcsStart(e.target.value)} />
            </div>
            <div className="field">
              <label>End (local)</label>
              <input className="input mono" type="datetime-local" value={icsEnd} onChange={(e) => setIcsEnd(e.target.value)} />
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Summary</label>
              <input className="input" value={icsSummary} onChange={(e) => setIcsSummary(e.target.value)} />
            </div>
            <div className="field">
              <label>Location</label>
              <input className="input" value={icsLoc} onChange={(e) => setIcsLoc(e.target.value)} />
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Description</label>
              <textarea className="textarea" value={icsDesc} onChange={(e) => setIcsDesc(e.target.value)} />
            </div>
            <div className="field">
              <label>URL (optional)</label>
              <textarea className="textarea" value={icsUrl} onChange={(e) => setIcsUrl(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="button"
              type="button"
              onClick={() => {
                if (!icsText) return
                downloadBlob(new Blob([icsText], { type: 'text/calendar;charset=utf-8' }), `event-${Date.now()}.ics`)
              }}
              disabled={!icsText}
            >
              Download .ics
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(icsText)
                } catch {
                  setErr('Clipboard blocked by browser permissions.')
                }
              }}
              disabled={!icsText}
            >
              Copy ICS
            </button>
          </div>
        </section>
      ) : null}

      {tool === 'timer' ? (
        <section className="panel">
          <h2>Pomodoro Timer</h2>
          <p className="muted">Runs locally in the browser. Keeps time while this tab is open.</p>
          <div className="row">
            <div className="field" style={{ width: 160 }}>
              <label>Work (min)</label>
              <input className="input mono" type="number" value={pomoWorkMin} onChange={(e) => setPomoWorkMin(Number(e.target.value))} disabled={pomoRunning} />
            </div>
            <div className="field" style={{ width: 160 }}>
              <label>Break (min)</label>
              <input className="input mono" type="number" value={pomoBreakMin} onChange={(e) => setPomoBreakMin(Number(e.target.value))} disabled={pomoRunning} />
            </div>
            <div className="field" style={{ minWidth: 160 }}>
              <label>Mode</label>
              <select className="select" value={pomoMode} onChange={(e) => setPomoMode(e.target.value)} disabled={pomoRunning}>
                <option value="work">Work</option>
                <option value="break">Break</option>
              </select>
            </div>
          </div>
          <div className="panel" style={{ padding: 14, marginTop: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="mono" style={{ fontSize: 34 }}>
                {String(Math.floor(pomoLeftMs / 60000)).padStart(2, '0')}:
                {String(Math.floor((pomoLeftMs % 60000) / 1000)).padStart(2, '0')}
              </div>
              <div className="mono muted">{pomoMode}</div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            {!pomoRunning ? (
              <button
                className="button"
                type="button"
                onClick={() => {
                  const dur = (pomoMode === 'work' ? Number(pomoWorkMin) : Number(pomoBreakMin)) * 60 * 1000
                  pomoRef.current.endAt = Date.now() + dur
                  setPomoLeftMs(dur)
                  setPomoRunning(true)
                }}
              >
                Start
              </button>
            ) : (
              <button className="button button--ghost" type="button" onClick={() => setPomoRunning(false)}>
                Pause
              </button>
            )}
            <button
              className="button button--ghost"
              type="button"
              onClick={() => {
                setPomoRunning(false)
                const dur = (pomoMode === 'work' ? Number(pomoWorkMin) : Number(pomoBreakMin)) * 60 * 1000
                setPomoLeftMs(dur)
              }}
            >
              Reset
            </button>
          </div>
        </section>
      ) : null}

      {tool === 'barcode' ? (
        <section className="panel">
          <h2>Barcode Generator</h2>
          <div className="row">
            <div className="field" style={{ minWidth: 220 }}>
              <label>Format</label>
              <select className="select" value={barcodeFmt} onChange={(e) => setBarcodeFmt(e.target.value)}>
                <option value="CODE128">CODE128</option>
                <option value="EAN13">EAN13</option>
                <option value="UPC">UPC</option>
                <option value="CODE39">CODE39</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Value</label>
              <input className="input mono" value={barcodeText} onChange={(e) => setBarcodeText(e.target.value)} />
            </div>
          </div>
          <div className="panel" style={{ padding: 14, marginTop: 10 }}>
            <svg ref={barcodeSvgRef} />
          </div>
        </section>
      ) : null}

      {tool === 'unit' ? (
        <section className="panel">
          <h2>Advanced Unit Converter</h2>
          <div className="row">
            <div className="field" style={{ minWidth: 220 }}>
              <label>Category</label>
              <select className="select" value={unitKind} onChange={(e) => setUnitKind(e.target.value)}>
                {Object.entries(unitDefs).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ width: 200 }}>
              <label>Value</label>
              <input className="input mono" value={unitValue} onChange={(e) => setUnitValue(e.target.value)} />
            </div>
            <div className="field" style={{ minWidth: 180 }}>
              <label>From</label>
              <select className="select" value={unitFrom} onChange={(e) => setUnitFrom(e.target.value)}>
                {Object.keys(unitDefs[unitKind].units).map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="field" style={{ minWidth: 180 }}>
              <label>To</label>
              <select className="select" value={unitTo} onChange={(e) => setUnitTo(e.target.value)}>
                {Object.keys(unitDefs[unitKind].units).map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Result</label>
            <input className="input mono" value={unitOut} readOnly />
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Includes length, mass, temperature, area, volume, speed, data size, pressure, energy, power, time, and angle.
          </p>
        </section>
      ) : null}

      {tool === 'tz' ? (
        <section className="panel">
          <h2>Time Zone Converter</h2>
          <p className="muted">
            Enter a date-time (ISO). We display it in multiple time zones using Intl formatting.
          </p>
          <div className="field">
            <label>Date/time (ISO)</label>
            <input className="input mono" value={tzDate} onChange={(e) => setTzDate(e.target.value)} />
          </div>
          <div className="panel" style={{ padding: 14, marginTop: 10 }}>
            <div className="table" style={{ minWidth: 0 }}>
              {COMMON_TZ.map((z) => (
                <div key={z} className="table__row" style={{ gridTemplateColumns: '260px 1fr' }}>
                  <div className="mono muted">{z}</div>
                  <div className="mono">{isNaN(tzBaseDate.getTime()) ? 'Invalid date' : fmtInTz(tzBaseDate, z)}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'calc' ? (
        <section className="panel">
          <h2>Calculator (Basic + Scientific)</h2>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Expression</label>
              <input className="input mono" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="2*(3+4)" />
            </div>
            <button className="button" type="button" onClick={runCalc}>Evaluate</button>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Result</label>
            <input className="input mono" value={exprOut} readOnly />
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Examples: <span className="kbd">sqrt(2)</span> <span className="kbd">sin(pi/2)</span> <span className="kbd">log(100,10)</span>
          </p>
        </section>
      ) : null}

      {tool === 'pct' ? (
        <section className="panel">
          <h2>Percentage Calculator</h2>
          <div className="row">
            <div className="field" style={{ width: 220 }}>
              <label>Base</label>
              <input className="input mono" value={pctBase} onChange={(e) => setPctBase(e.target.value)} />
            </div>
            <div className="field" style={{ width: 220 }}>
              <label>Percent</label>
              <input className="input mono" value={pctRate} onChange={(e) => setPctRate(e.target.value)} />
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Amount</label>
              <input className="input mono" value={pctAmount} readOnly />
            </div>
            <div className="field">
              <label>Total (base + amount)</label>
              <input className="input mono" value={pctTotal} readOnly />
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'size' ? (
        <section className="panel">
          <h2>File Size Calculator</h2>
          <div className="row">
            <div className="field" style={{ width: 260 }}>
              <label>Bytes</label>
              <input className="input mono" value={bytes} onChange={(e) => setBytes(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Human readable</label>
              <input className="input mono" value={sizeOut} readOnly />
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'rename' ? (
        <section className="panel">
          <h2>Local File Renamer (Downloads a ZIP)</h2>
          <p className="muted">
            Browsers cannot rename files on disk. This tool creates a ZIP with renamed copies.
          </p>
          <FileDrop
            label="Drop files to rename"
            hint="We download a ZIP with new names"
            multiple
            disabled={renameBusy}
            onFiles={setRenameFiles}
          />

          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Template</label>
              <input className="input mono" value={template} onChange={(e) => setTemplate(e.target.value)} />
              <div className="muted">
                Tokens: <span className="kbd">{'{name}'}</span> <span className="kbd">{'{ext}'}</span> <span className="kbd">{'{index}'}</span>
              </div>
            </div>
            <div className="field">
              <label>Prefix / Suffix</label>
              <div className="two">
                <input className="input mono" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="prefix-" />
                <input className="input mono" value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder="-suffix" />
              </div>
            </div>
          </div>

          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Find</label>
              <input className="input mono" value={find} onChange={(e) => setFind(e.target.value)} />
            </div>
            <div className="field">
              <label>Replace</label>
              <input className="input mono" value={rep} onChange={(e) => setRep(e.target.value)} />
            </div>
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={runRenameZip} disabled={!renameFiles.length || renameBusy}>
              Download renamed ZIP
            </button>
            {renameBusy || renameProgress > 0 ? <ProgressBar value={renameProgress} label={renameBusy ? 'Renaming' : 'Last run'} /> : null}
          </div>

          <Preview title="Files">
            {renameFiles.length ? (
              <div className="table">
                <div className="table__row table__row--head" style={{ gridTemplateColumns: '1fr 1fr 120px' }}>
                  <div>Old</div>
                  <div>New</div>
                  <div className="right">Size</div>
                </div>
                {renameFiles.map((f, i) => (
                  <div key={f.name + f.size + f.lastModified} className="table__row" style={{ gridTemplateColumns: '1fr 1fr 120px' }}>
                    <div className="mono">{f.name}</div>
                    <div className="mono">{applyRename(f.name, { template, prefix, suffix, find, replace: rep, index: i + 1 })}</div>
                    <div className="right">{formatBytes(f.size)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">No files selected.</div>
            )}
          </Preview>
        </section>
      ) : null}

      {tool === 'detect' ? (
        <section className="panel">
          <h2>File Type + SHA-256 Detector</h2>
          <FileDrop
            label="Drop files"
            hint="We sniff magic bytes and compute SHA-256 locally"
            multiple
            disabled={detBusy}
            onFiles={setDetFiles}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={runDetect} disabled={!detFiles.length || detBusy}>
              Detect
            </button>
          </div>
          {detBusy || detProgress > 0 ? <ProgressBar value={detProgress} label={detBusy ? 'Detecting' : 'Last run'} /> : null}
          <Preview title="Results">
            {detResults.length ? (
              <div className="table">
                <div className="table__row table__row--head" style={{ gridTemplateColumns: '1fr 120px 160px 1fr' }}>
                  <div>Name</div>
                  <div className="right">Size</div>
                  <div>Type</div>
                  <div>SHA-256</div>
                </div>
                {detResults.map((r) => (
                  <div key={r.name + r.sha} className="table__row" style={{ gridTemplateColumns: '1fr 120px 160px 1fr' }}>
                    <div className="mono">{r.name}</div>
                    <div className="right">{formatBytes(r.size)}</div>
                    <div className="muted">{r.type.kind} {r.type.ext ? `(.${r.type.ext})` : ''}</div>
                    <div className="mono" style={{ wordBreak: 'break-all' }}>{r.sha}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">No results yet.</div>
            )}
          </Preview>
        </section>
      ) : null}
    </div>
  )
}
