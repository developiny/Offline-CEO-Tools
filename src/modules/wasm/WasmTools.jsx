import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ToolTabs from '../../components/ToolTabs.jsx'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import FileDrop from '../../components/FileDrop.jsx'
import ProgressBar from '../../components/ProgressBar.jsx'
import { addRecent, toolKey } from '../../utils/toolPrefs.js'
import { downloadBlob, formatBytes } from '../../utils/file.js'
import { zipBlobs } from '../../utils/zip.js'

const TOOLS = [
  { id: 'ux', label: 'UX Kit' },
  { id: 'imagepro', label: 'Image Pro' },
  { id: 'pdfpro', label: 'PDF Pro' },
  { id: 'videopro', label: 'Video/Audio Pro' },
  { id: 'devpro', label: 'Dev Pro' },
  { id: 'design', label: 'Design Gen' },
  { id: 'privacy', label: 'Privacy/Offline' },
  { id: 'iconpack', label: 'Icon Pack' },
  { id: 'sprite', label: 'Sprite Sheet' },
  { id: 'palette', label: 'Palette' },
  { id: 'svgopt', label: 'SVG Optimizer' },
  { id: 'pdfform', label: 'PDF Form Fill/Flatten' },
  { id: 'sign', label: 'Signature Stamp' },
  { id: 'ocr', label: 'OCR' },
  { id: 'ffmpeg', label: 'FFmpeg' },
]

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function safeName(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|]+/g, '_')
}

function baseName(name) {
  return safeName(name).replace(/\.[^.]+$/, '')
}

function replaceExt(filename, ext) {
  const base = safeName(filename).replace(/\.[^.]+$/, '')
  return base + '.' + ext
}

function guessExtFromType(type) {
  const t = String(type || '').toLowerCase()
  if (t.includes('mp4')) return 'mp4'
  if (t.includes('webm')) return 'webm'
  if (t.includes('quicktime')) return 'mov'
  if (t.includes('x-matroska')) return 'mkv'
  if (t.includes('mpeg')) return 'mpg'
  if (t.includes('audio/mpeg')) return 'mp3'
  if (t.includes('audio/mp4')) return 'm4a'
  if (t.includes('audio/wav')) return 'wav'
  if (t.includes('audio/ogg')) return 'ogg'
  if (t.includes('audio/webm')) return 'weba'
  if (t.includes('application/octet-stream')) return ''
  return ''
}

function parseFilenameFromContentDisposition(cd) {
  const s = String(cd || '')
  // RFC 5987: filename*=UTF-8''encoded
  const m1 = s.match(/filename\*\s*=\s*([^;]+)/i)
  if (m1) {
    const raw = m1[1].trim().replace(/^UTF-8''/i, '').replace(/^"(.*)"$/, '$1')
    try {
      return safeName(decodeURIComponent(raw))
    } catch {
      return safeName(raw)
    }
  }
  const m2 = s.match(/filename\s*=\s*([^;]+)/i)
  if (m2) return safeName(m2[1].trim().replace(/^"(.*)"$/, '$1'))
  return ''
}

function parseFilenameFromUrl(inputUrl) {
  try {
    const u = new URL(inputUrl)
    const name = u.pathname.split('/').filter(Boolean).pop() || ''
    return safeName(decodeURIComponent(name))
  } catch {
    return ''
  }
}

function rgbToHex(r, g, b) {
  const rr = clamp(Math.round(r), 0, 255).toString(16).padStart(2, '0')
  const gg = clamp(Math.round(g), 0, 255).toString(16).padStart(2, '0')
  const bb = clamp(Math.round(b), 0, 255).toString(16).padStart(2, '0')
  return ('#' + rr + gg + bb).toUpperCase()
}

async function imageFileToCanvas(file, maxW = 0, maxH = 0) {
  const bmp = await createImageBitmap(file)
  let w = bmp.width
  let h = bmp.height
  if (maxW > 0 || maxH > 0) {
    const sx = maxW > 0 ? maxW / w : 1
    const sy = maxH > 0 ? maxH / h : 1
    const s = Math.min(1, sx, sy)
    w = Math.max(1, Math.round(w * s))
    h = Math.max(1, Math.round(h * s))
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { alpha: true })
  ctx.drawImage(bmp, 0, 0, w, h)
  return canvas
}

async function canvasToBlob(canvas, type = 'image/png', quality) {
  return await new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

// Dynamically imported heavy libs cache (keeps initial bundle smaller).
const libsRef = {
  current: {
    tesseract: null,
    ffmpeg: null,
    pdfLib: null,
  },
}

async function getTesseract() {
  if (libsRef.current.tesseract) return libsRef.current.tesseract
  const mod = await import('tesseract.js')
  libsRef.current.tesseract = mod
  return mod
}

async function getFfmpeg() {
  if (libsRef.current.ffmpeg) return libsRef.current.ffmpeg
  const mod = await import('@ffmpeg/ffmpeg')
  libsRef.current.ffmpeg = mod
  return mod
}

async function getPdfLib() {
  if (libsRef.current.pdfLib) return libsRef.current.pdfLib
  const mod = await import('pdf-lib')
  libsRef.current.pdfLib = mod
  return mod
}

export default function WasmTools() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tool, setTool] = useState('iconpack')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

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
        key: toolKey('wasm', tool),
        label: `WASM: ${t.label}`,
        path: `/wasm?tool=${tool}`,
        tool,
      })
      window.dispatchEvent(new Event('oct:prefs'))
    }
  }, [tool, setSearchParams])

  // 1) Icon pack generator
  const [iconFiles, setIconFiles] = useState([])
  const [iconSizes, setIconSizes] = useState('16,24,32,48,64,96,128,192,256,512')
  const [iconBg, setIconBg] = useState('#00000000')

  async function runIconPack() {
    if (!iconFiles.length) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const sizes = Array.from(
        new Set(
          String(iconSizes || '')
            .split(',')
            .map((x) => Math.floor(Number(x.trim())))
            .filter((x) => Number.isFinite(x) && x >= 8 && x <= 2048),
        ),
      ).sort((a, b) => a - b)
      if (!sizes.length) throw new Error('Enter at least one valid icon size.')

      const entries = []
      const total = iconFiles.length * sizes.length
      let done = 0
      for (const f of iconFiles) {
        const src = await imageFileToCanvas(f)
        for (const s of sizes) {
          const c = document.createElement('canvas')
          c.width = s
          c.height = s
          const ctx = c.getContext('2d', { alpha: true })
          // optional bg if user sets opaque alpha.
          if (/^#[0-9a-f]{8}$/i.test(iconBg) && iconBg.slice(7, 9).toLowerCase() !== '00') {
            ctx.fillStyle = iconBg
            ctx.fillRect(0, 0, s, s)
          }
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, s, s)
          const blob = await canvasToBlob(c, 'image/png')
          entries.push({
            name: `${baseName(f.name)}-${s}x${s}.png`,
            blob,
          })
          done++
          setProgress(done / Math.max(1, total))
        }
      }
      const zip = await zipBlobs(entries)
      downloadBlob(zip, `icon-pack-${Date.now()}.zip`)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // 2) Sprite sheet builder
  const [spriteFiles, setSpriteFiles] = useState([])
  const [spriteCols, setSpriteCols] = useState(8)
  const [spritePadding, setSpritePadding] = useState(2)
  const [spriteCell, setSpriteCell] = useState(64)
  const [spriteOutUrl, setSpriteOutUrl] = useState('')
  const [spriteOutBlob, setSpriteOutBlob] = useState(null)
  const [spriteCss, setSpriteCss] = useState('')

  useEffect(() => {
    return () => {
      if (spriteOutUrl) URL.revokeObjectURL(spriteOutUrl)
    }
  }, [spriteOutUrl])

  async function runSpriteSheet() {
    if (!spriteFiles.length) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const cols = clamp(Math.floor(Number(spriteCols) || 8), 1, 128)
      const pad = clamp(Math.floor(Number(spritePadding) || 0), 0, 64)
      const cell = clamp(Math.floor(Number(spriteCell) || 64), 8, 1024)

      const rows = Math.ceil(spriteFiles.length / cols)
      const w = cols * cell + (cols + 1) * pad
      const h = rows * cell + (rows + 1) * pad
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { alpha: true })
      ctx.clearRect(0, 0, w, h)

      const cssLines = []
      for (let i = 0; i < spriteFiles.length; i++) {
        const f = spriteFiles[i]
        const src = await imageFileToCanvas(f)
        const col = i % cols
        const row = Math.floor(i / cols)
        const x = pad + col * (cell + pad)
        const y = pad + row * (cell + pad)
        // letterbox fit
        const scale = Math.min(cell / src.width, cell / src.height)
        const dw = Math.max(1, Math.round(src.width * scale))
        const dh = Math.max(1, Math.round(src.height * scale))
        const dx = x + Math.floor((cell - dw) / 2)
        const dy = y + Math.floor((cell - dh) / 2)
        ctx.drawImage(src, 0, 0, src.width, src.height, dx, dy, dw, dh)
        const className = baseName(f.name).toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
        cssLines.push(`.icon-${className} { background-position: -${x}px -${y}px; width: ${cell}px; height: ${cell}px; }`)
        setProgress((i + 1) / Math.max(1, spriteFiles.length))
      }

      const blob = await canvasToBlob(canvas, 'image/png')
      if (!blob) throw new Error('Failed to export sprite sheet.')
      if (spriteOutUrl) URL.revokeObjectURL(spriteOutUrl)
      const url = URL.createObjectURL(blob)
      setSpriteOutBlob(blob)
      setSpriteOutUrl(url)
      setSpriteCss(
        `.icon {\n  display: inline-block;\n  background-image: url('sprite.png');\n  background-repeat: no-repeat;\n}\n\n${cssLines.join('\n')}\n`,
      )
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // 3) Palette extractor
  const [palFile, setPalFile] = useState(null)
  const [palK, setPalK] = useState(8)
  const [palData, setPalData] = useState([])
  const [palAvg, setPalAvg] = useState('')

  async function runPaletteExtractor() {
    if (!palFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const c = await imageFileToCanvas(palFile, 220, 220)
      const ctx = c.getContext('2d')
      const img = ctx.getImageData(0, 0, c.width, c.height)
      const d = img.data
      const pts = []
      let sr = 0
      let sg = 0
      let sb = 0
      let n = 0
      const step = Math.max(1, Math.floor((c.width * c.height) / 7000))
      for (let i = 0; i < d.length; i += 4 * step) {
        const a = d[i + 3]
        if (a < 16) continue
        const r = d[i]
        const g = d[i + 1]
        const b = d[i + 2]
        pts.push([r, g, b])
        sr += r
        sg += g
        sb += b
        n++
      }
      if (!n) throw new Error('No non-transparent pixels found.')
      setPalAvg(rgbToHex(sr / n, sg / n, sb / n))

      const k = clamp(Math.floor(Number(palK) || 8), 2, 24)
      const centers = []
      for (let i = 0; i < k; i++) {
        const p = pts[Math.floor((i / k) * (pts.length - 1))]
        centers.push([p[0], p[1], p[2]])
      }
      let assign = new Array(pts.length).fill(0)
      for (let iter = 0; iter < 10; iter++) {
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i]
          let best = 0
          let bd = Infinity
          for (let j = 0; j < centers.length; j++) {
            const dr = p[0] - centers[j][0]
            const dg = p[1] - centers[j][1]
            const db = p[2] - centers[j][2]
            const dd = dr * dr + dg * dg + db * db
            if (dd < bd) {
              bd = dd
              best = j
            }
          }
          assign[i] = best
        }
        const sum = Array.from({ length: k }, () => ({ r: 0, g: 0, b: 0, n: 0 }))
        for (let i = 0; i < pts.length; i++) {
          const a = assign[i]
          sum[a].r += pts[i][0]
          sum[a].g += pts[i][1]
          sum[a].b += pts[i][2]
          sum[a].n++
        }
        for (let j = 0; j < k; j++) {
          if (!sum[j].n) continue
          centers[j][0] = sum[j].r / sum[j].n
          centers[j][1] = sum[j].g / sum[j].n
          centers[j][2] = sum[j].b / sum[j].n
        }
        setProgress((iter + 1) / 10)
      }
      const counts = Array.from({ length: k }, () => 0)
      for (const a of assign) counts[a]++
      const out = centers
        .map((c1, i) => ({ hex: rgbToHex(c1[0], c1[1], c1[2]), count: counts[i] }))
        .sort((a, b) => b.count - a.count)
      setPalData(out)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
      setPalData([])
      setPalAvg('')
    } finally {
      setBusy(false)
    }
  }

  // 4) SVG optimizer (lightweight minify; no external API)
  const [svgIn, setSvgIn] = useState('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="48" fill="#7EE4FF"/></svg>')
  const [svgOut, setSvgOut] = useState('')

  function runSvgOptimize() {
    setErr('')
    try {
      const s = String(svgIn || '')
      // lightweight optimizer for common cases.
      const out = s
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/>\s+</g, '><')
        .replace(/\s*(=)\s*/g, '$1')
        .replace(/\s+\/>/g, '/>')
        .trim()
      setSvgOut(out)
    } catch (e) {
      setErr(e?.message || String(e))
      setSvgOut('')
    }
  }

  // 5) PDF form fill/flatten
  const [formPdfFile, setFormPdfFile] = useState(null)
  const [formFields, setFormFields] = useState([]) // {name,type,value}
  const [formLoading, setFormLoading] = useState(false)
  const [formFlatten, setFormFlatten] = useState(true)

  async function loadPdfFormFields() {
    if (!formPdfFile) return
    setErr('')
    setFormLoading(true)
    try {
      const { PDFDocument } = await getPdfLib()
      const bytes = await formPdfFile.arrayBuffer()
      const pdf = await PDFDocument.load(bytes)
      const form = pdf.getForm()
      const fields = form.getFields().map((f) => {
        const name = f.getName()
        const ctor = f.constructor?.name || 'PDFField'
        let value = ''
        if (ctor === 'PDFTextField') value = ''
        if (ctor === 'PDFCheckBox') value = false
        if (ctor === 'PDFDropdown') value = ''
        if (ctor === 'PDFOptionList') value = ''
        if (ctor === 'PDFRadioGroup') value = ''
        return { name, type: ctor, value }
      })
      setFormFields(fields)
    } catch (e) {
      setErr(e?.message || String(e))
      setFormFields([])
    } finally {
      setFormLoading(false)
    }
  }

  async function runPdfFillFlatten() {
    if (!formPdfFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const { PDFDocument } = await getPdfLib()
      const bytes = await formPdfFile.arrayBuffer()
      const pdf = await PDFDocument.load(bytes)
      const form = pdf.getForm()

      for (let i = 0; i < formFields.length; i++) {
        const f = formFields[i]
        const field = form.getFieldMaybe(f.name)
        if (!field) continue
        const type = field.constructor?.name || ''
        if (type === 'PDFTextField') field.setText(String(f.value || ''))
        else if (type === 'PDFCheckBox') {
          if (f.value) field.check()
          else field.uncheck()
        } else if (type === 'PDFDropdown') {
          const v = String(f.value || '')
          if (v) field.select(v)
        } else if (type === 'PDFOptionList') {
          const v = String(f.value || '')
          if (v) field.select(v)
        } else if (type === 'PDFRadioGroup') {
          const v = String(f.value || '')
          if (v) field.select(v)
        }
        setProgress((i + 1) / Math.max(1, formFields.length + 1))
      }

      if (formFlatten) form.flatten()
      const out = await pdf.save()
      downloadBlob(new Blob([out], { type: 'application/pdf' }), `filled-${baseName(formPdfFile.name)}-${Date.now()}.pdf`)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // 6) Signature stamping UI
  const [sigPdfFile, setSigPdfFile] = useState(null)
  const [sigFile, setSigFile] = useState(null)
  const [sigPages, setSigPages] = useState('1')
  const [sigX, setSigX] = useState(40)
  const [sigY, setSigY] = useState(40)
  const [sigW, setSigW] = useState(160)
  const [sigOpacity, setSigOpacity] = useState(0.92)

  function parsePageSpec(spec, maxPages) {
    const out = new Set()
    const s = String(spec || '').trim()
    if (!s) return []
    for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
      const m = part.match(/^(\d+)(?:-(\d+)?)?$/)
      if (!m) continue
      const a = clamp(parseInt(m[1], 10), 1, maxPages)
      const b = m[2] ? clamp(parseInt(m[2], 10), 1, maxPages) : a
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i - 1)
    }
    return Array.from(out).sort((a, b) => a - b)
  }

  async function runSignatureStamp() {
    if (!sigPdfFile || !sigFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const { PDFDocument } = await getPdfLib()
      const bytes = await sigPdfFile.arrayBuffer()
      const pdf = await PDFDocument.load(bytes)
      const sigBytes = new Uint8Array(await sigFile.arrayBuffer())
      const emb = /jpe?g/i.test(sigFile.type) || /\.jpe?g$/i.test(sigFile.name)
        ? await pdf.embedJpg(sigBytes)
        : await pdf.embedPng(sigBytes)
      const pages = pdf.getPages()
      const targets = parsePageSpec(sigPages, pages.length)
      if (!targets.length) throw new Error('No valid page selection.')
      for (let i = 0; i < targets.length; i++) {
        const p = pages[targets[i]]
        const ww = clamp(Number(sigW) || 160, 16, 2000)
        const hh = (emb.height / emb.width) * ww
        p.drawImage(emb, {
          x: Number(sigX) || 40,
          y: Number(sigY) || 40,
          width: ww,
          height: hh,
          opacity: clamp(Number(sigOpacity) || 0.92, 0, 1),
        })
        setProgress((i + 1) / Math.max(1, targets.length))
      }
      const out = await pdf.save()
      downloadBlob(new Blob([out], { type: 'application/pdf' }), `signed-${baseName(sigPdfFile.name)}-${Date.now()}.pdf`)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // 7) OCR (Tesseract.js)
  const [ocrFile, setOcrFile] = useState(null)
  const [ocrLang, setOcrLang] = useState('eng')
  const [ocrOut, setOcrOut] = useState('')

  async function runOcr() {
    if (!ocrFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    setOcrOut('')
    try {
      const Tesseract = await getTesseract()
      const { data } = await Tesseract.recognize(ocrFile, ocrLang, {
        logger: (m) => {
          if (m?.status === 'recognizing text' && Number.isFinite(m.progress)) {
            setProgress(m.progress)
          }
        },
      })
      setOcrOut(String(data?.text || ''))
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // 8) FFmpeg wasm media convert
  const ffRef = useRef(null)
  const [ffFile, setFfFile] = useState(null)
  const [ffMode, setFfMode] = useState('mp4-to-gif') // mp4-to-gif|mp4-to-webm|webm-to-mp4|extract-mp3
  const [ffBusy, setFfBusy] = useState(false)
  const [ffLog, setFfLog] = useState('')
  const [videoUrl, setVideoUrl] = useState('')
  const [videoUrlName, setVideoUrlName] = useState('')
  const [videoUrlBusy, setVideoUrlBusy] = useState(false)

  async function ensureFfmpegInstance() {
    if (ffRef.current) return ffRef.current
    const { FFmpeg } = await getFfmpeg()
    const ff = new FFmpeg()
    ff.on('progress', ({ progress: p }) => {
      if (Number.isFinite(p)) setProgress(p)
    })
    ff.on('log', ({ message }) => {
      setFfLog((s) => (s ? s + '\n' + message : message))
    })
    const coreUrl = await import('@ffmpeg/core?url')
    await ff.load({
      coreURL: coreUrl.default || coreUrl,
    })
    ffRef.current = ff
    return ff
  }

  async function runFfmpeg() {
    if (!ffFile) return
    setErr('')
    setBusy(true)
    setFfBusy(true)
    setProgress(0)
    setFfLog('')
    try {
      const ff = await ensureFfmpegInstance()
      const inName = safeName(ffFile.name || 'input.bin')
      const inBytes = new Uint8Array(await ffFile.arrayBuffer())
      await ff.writeFile(inName, inBytes)

      let outName = 'out.bin'
      let mime = 'application/octet-stream'
      let args = []
      if (ffMode === 'mp4-to-gif') {
        outName = 'out.gif'
        mime = 'image/gif'
        args = ['-i', inName, '-vf', 'fps=12,scale=480:-1:flags=lanczos', '-loop', '0', outName]
      } else if (ffMode === 'mp4-to-webm') {
        outName = 'out.webm'
        mime = 'video/webm'
        args = ['-i', inName, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', outName]
      } else if (ffMode === 'webm-to-mp4') {
        outName = 'out.mp4'
        mime = 'video/mp4'
        args = ['-i', inName, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-movflags', '+faststart', outName]
      } else {
        outName = 'out.mp3'
        mime = 'audio/mpeg'
        args = ['-i', inName, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', outName]
      }

      await ff.exec(args)
      const out = await ff.readFile(outName)
      const blob = new Blob([out.buffer], { type: mime })
      downloadBlob(blob, replaceExt(inName, outName.split('.').pop()))
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
      setFfBusy(false)
    }
  }

  async function runDirectUrlDownload() {
    const raw = String(videoUrl || '').trim()
    if (!raw) return
    let url
    try {
      url = new URL(raw)
    } catch {
      setErr('Invalid URL.')
      return
    }
    if (!/^https?:$/i.test(url.protocol)) {
      setErr('Only http/https URLs are supported.')
      return
    }

    setErr('')
    setBusy(true)
    setVideoUrlBusy(true)
    setProgress(0)
    setFfLog('')
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        mode: 'cors',
        redirect: 'follow',
      })
      if (!res.ok) throw new Error(`Request failed (${res.status}).`)
      if (res.type === 'opaque') {
        throw new Error('Opaque response. This URL is blocked by CORS.')
      }

      const total = Number(res.headers.get('content-length') || 0)
      const contentType = String(res.headers.get('content-type') || '')
      const cd = res.headers.get('content-disposition') || ''
      const chunks = []
      let received = 0

      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            received += value.length
            if (total > 0) setProgress(received / total)
          }
        }
      } else {
        const ab = await res.arrayBuffer()
        chunks.push(new Uint8Array(ab))
        received = ab.byteLength
      }

      const blob = new Blob(chunks, { type: contentType || 'application/octet-stream' })
      let outName = safeName(videoUrlName.trim())
      if (!outName) outName = parseFilenameFromContentDisposition(cd)
      if (!outName) outName = parseFilenameFromUrl(url.toString())
      if (!outName) outName = `download-${Date.now()}`

      const ext = guessExtFromType(blob.type)
      if (ext && !/\.[a-z0-9]{2,5}$/i.test(outName)) outName = `${outName}.${ext}`

      downloadBlob(blob, outName)
      setProgress(1)
      setFfLog((s) =>
        [
          s,
          `Downloaded ${received ? formatBytes(received) : 'file'} from URL.`,
          `CORS allowed: yes`,
        ]
          .filter(Boolean)
          .join('\n'),
      )
    } catch (e) {
      const msg = String(e?.message || e || '')
      const corsHint =
        /cors|failed to fetch|opaque|networkerror/i.test(msg)
          ? '\nLikely blocked by CORS/anti-bot protection on that platform URL.'
          : ''
      setErr(`Direct URL download failed.${corsHint}`)
      setFfLog((s) =>
        [
          s,
          msg,
          'Tip: use a direct media file URL from a source/CDN that sends CORS headers.',
        ]
          .filter(Boolean)
          .join('\n'),
      )
    } finally {
      setBusy(false)
      setVideoUrlBusy(false)
    }
  }

  // 9) UX kit
  const [uxImportBusy, setUxImportBusy] = useState(false)
  function runExportAllSettings() {
    try {
      const data = {}
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k) continue
        data[k] = localStorage.getItem(k)
      }
      const blob = new Blob([JSON.stringify({ version: 1, ts: Date.now(), data }, null, 2)], {
        type: 'application/json',
      })
      downloadBlob(blob, `all-local-settings-${Date.now()}.json`)
    } catch (e) {
      setErr(e?.message || String(e))
    }
  }

  async function runImportAllSettings(file) {
    if (!file) return
    setErr('')
    setUxImportBusy(true)
    try {
      const raw = await file.text()
      const parsed = JSON.parse(raw)
      const data = parsed?.data
      if (!data || typeof data !== 'object') throw new Error('Invalid settings file.')
      for (const [k, v] of Object.entries(data)) localStorage.setItem(String(k), String(v ?? ''))
      window.dispatchEvent(new Event('oct:prefs'))
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setUxImportBusy(false)
    }
  }

  // 10) Image pro
  const [imgProFile, setImgProFile] = useState(null)
  const [imgProOutUrl, setImgProOutUrl] = useState('')
  const [imgProOutBlob, setImgProOutBlob] = useState(null)
  const [bgKeyColor, setBgKeyColor] = useState('#FFFFFF')
  const [bgTolerance, setBgTolerance] = useState(48)
  const [faceMode, setFaceMode] = useState('pixelate') // pixelate|blur|bar
  const [faceStrength, setFaceStrength] = useState(12)
  const [wmBatchFiles, setWmBatchFiles] = useState([])
  const [wmTemplate, setWmTemplate] = useState('{name} © {yyyy}')
  const [wmPreset, setWmPreset] = useState('br')
  const [icoFile, setIcoFile] = useState(null)
  const [icoSizes, setIcoSizes] = useState('16,24,32,48,64,128,256')

  useEffect(() => {
    return () => {
      if (imgProOutUrl) URL.revokeObjectURL(imgProOutUrl)
    }
  }, [imgProOutUrl])

  function parseHexRgb(hex) {
    const s = String(hex || '').trim()
    const m = s.match(/^#?([0-9a-f]{6})$/i)
    if (!m) return { r: 255, g: 255, b: 255 }
    return {
      r: parseInt(m[1].slice(0, 2), 16),
      g: parseInt(m[1].slice(2, 4), 16),
      b: parseInt(m[1].slice(4, 6), 16),
    }
  }

  async function runBgRemove() {
    if (!imgProFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const c = await imageFileToCanvas(imgProFile)
      const ctx = c.getContext('2d', { alpha: true })
      const img = ctx.getImageData(0, 0, c.width, c.height)
      const d = img.data
      const key = parseHexRgb(bgKeyColor)
      const tol = clamp(Number(bgTolerance) || 48, 0, 255)
      const tol2 = tol * tol
      for (let i = 0; i < d.length; i += 4) {
        const dr = d[i] - key.r
        const dg = d[i + 1] - key.g
        const db = d[i + 2] - key.b
        const dist = dr * dr + dg * dg + db * db
        if (dist <= tol2) d[i + 3] = 0
      }
      ctx.putImageData(img, 0, 0)
      const blob = await canvasToBlob(c, 'image/png')
      if (!blob) throw new Error('Failed to export PNG.')
      setImgProOutBlob(blob)
      if (imgProOutUrl) URL.revokeObjectURL(imgProOutUrl)
      setImgProOutUrl(URL.createObjectURL(blob))
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function runAutoFaceCensor() {
    if (!imgProFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      if (!('FaceDetector' in window)) {
        throw new Error('FaceDetector API is not supported in this browser.')
      }
      const src = await imageFileToCanvas(imgProFile)
      const ctx = src.getContext('2d', { alpha: true })
      const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 20 })
      const faces = await detector.detect(src)
      if (!faces.length) throw new Error('No faces detected.')
      for (let i = 0; i < faces.length; i++) {
        const bb = faces[i].boundingBox
        const x = clamp(Math.floor(bb.x), 0, src.width - 1)
        const y = clamp(Math.floor(bb.y), 0, src.height - 1)
        const w = clamp(Math.floor(bb.width), 1, src.width - x)
        const h = clamp(Math.floor(bb.height), 1, src.height - y)
        if (faceMode === 'bar') {
          ctx.fillStyle = '#000000'
          ctx.fillRect(x, y, w, h)
        } else if (faceMode === 'blur') {
          const tmp = document.createElement('canvas')
          tmp.width = w
          tmp.height = h
          const tctx = tmp.getContext('2d')
          tctx.drawImage(src, x, y, w, h, 0, 0, w, h)
          ctx.save()
          ctx.filter = `blur(${clamp(Number(faceStrength) || 12, 2, 40)}px)`
          ctx.drawImage(tmp, 0, 0, w, h, x, y, w, h)
          ctx.restore()
        } else {
          const px = clamp(Math.round(Number(faceStrength) || 12), 3, 80)
          const sw = Math.max(1, Math.round(w / px))
          const sh = Math.max(1, Math.round(h / px))
          const tmp = document.createElement('canvas')
          tmp.width = sw
          tmp.height = sh
          const tctx = tmp.getContext('2d')
          tctx.drawImage(src, x, y, w, h, 0, 0, sw, sh)
          ctx.save()
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h)
          ctx.restore()
        }
        setProgress((i + 1) / Math.max(1, faces.length))
      }
      const blob = await canvasToBlob(src, 'image/png')
      if (!blob) throw new Error('Failed to export PNG.')
      setImgProOutBlob(blob)
      if (imgProOutUrl) URL.revokeObjectURL(imgProOutUrl)
      setImgProOutUrl(URL.createObjectURL(blob))
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  function applyTemplate(tpl, filename) {
    const d = new Date()
    return String(tpl || '')
      .replaceAll('{name}', baseName(filename))
      .replaceAll('{yyyy}', String(d.getFullYear()))
      .replaceAll('{mm}', String(d.getMonth() + 1).padStart(2, '0'))
      .replaceAll('{dd}', String(d.getDate()).padStart(2, '0'))
  }

  async function runBatchWatermarkTemplate() {
    if (!wmBatchFiles.length) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const entries = []
      for (let i = 0; i < wmBatchFiles.length; i++) {
        const f = wmBatchFiles[i]
        const c = await imageFileToCanvas(f)
        const ctx = c.getContext('2d', { alpha: true })
        const text = applyTemplate(wmTemplate, f.name)
        const size = Math.max(14, Math.round(c.width * 0.04))
        ctx.save()
        ctx.globalAlpha = 0.4
        ctx.fillStyle = '#ffffff'
        ctx.font = `${size}px ui-monospace, monospace`
        const tw = ctx.measureText(text).width
        const pad = Math.max(8, Math.round(size * 0.4))
        let x = pad
        let y = pad + size
        if (wmPreset === 'tr') {
          x = c.width - tw - pad
          y = pad + size
        } else if (wmPreset === 'bl') {
          x = pad
          y = c.height - pad
        } else if (wmPreset === 'br') {
          x = c.width - tw - pad
          y = c.height - pad
        } else if (wmPreset === 'center') {
          x = (c.width - tw) / 2
          y = c.height / 2
        }
        ctx.fillText(text, x, y)
        ctx.restore()
        const blob = await canvasToBlob(c, 'image/png')
        entries.push({ name: replaceExt(f.name, 'png'), blob })
        setProgress((i + 1) / Math.max(1, wmBatchFiles.length))
      }
      const zip = await zipBlobs(entries)
      downloadBlob(zip, `watermarked-${Date.now()}.zip`)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function runIcoGenerator() {
    if (!icoFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const sizes = Array.from(
        new Set(
          String(icoSizes || '')
            .split(',')
            .map((x) => Math.floor(Number(x.trim())))
            .filter((x) => Number.isFinite(x) && x >= 16 && x <= 256),
        ),
      ).sort((a, b) => a - b)
      if (!sizes.length) throw new Error('Enter ICO sizes between 16 and 256.')
      const pngBuffers = []
      for (let i = 0; i < sizes.length; i++) {
        const s = sizes[i]
        const c = await imageFileToCanvas(icoFile)
        const out = document.createElement('canvas')
        out.width = s
        out.height = s
        out.getContext('2d', { alpha: true }).drawImage(c, 0, 0, c.width, c.height, 0, 0, s, s)
        const blob = await canvasToBlob(out, 'image/png')
        pngBuffers.push(new Uint8Array(await blob.arrayBuffer()))
        setProgress((i + 1) / Math.max(1, sizes.length))
      }
      const headerSize = 6 + 16 * sizes.length
      let dataOffset = headerSize
      const head = new Uint8Array(headerSize)
      const dv = new DataView(head.buffer)
      dv.setUint16(0, 0, true) // reserved
      dv.setUint16(2, 1, true) // type ico
      dv.setUint16(4, sizes.length, true)
      for (let i = 0; i < sizes.length; i++) {
        const s = sizes[i]
        const bytes = pngBuffers[i]
        const p = 6 + i * 16
        dv.setUint8(p + 0, s === 256 ? 0 : s)
        dv.setUint8(p + 1, s === 256 ? 0 : s)
        dv.setUint8(p + 2, 0) // palette
        dv.setUint8(p + 3, 0)
        dv.setUint16(p + 4, 1, true) // planes
        dv.setUint16(p + 6, 32, true)
        dv.setUint32(p + 8, bytes.byteLength, true)
        dv.setUint32(p + 12, dataOffset, true)
        dataOffset += bytes.byteLength
      }
      const icoBlob = new Blob([head, ...pngBuffers], { type: 'image/x-icon' })
      downloadBlob(icoBlob, `${baseName(icoFile.name)}.ico`)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // 11) PDF Pro
  const [pdfProFile, setPdfProFile] = useState(null)
  const [pdfPageCount, setPdfPageCount] = useState(0)
  const [pdfRotatePages, setPdfRotatePages] = useState('1')
  const [pdfRotateDeg, setPdfRotateDeg] = useState(90)
  const [pdfReorderSpec, setPdfReorderSpec] = useState('')
  const [pdfRedactPages, setPdfRedactPages] = useState('1')
  const [pdfRedactX, setPdfRedactX] = useState(40)
  const [pdfRedactY, setPdfRedactY] = useState(40)
  const [pdfRedactW, setPdfRedactW] = useState(180)
  const [pdfRedactH, setPdfRedactH] = useState(48)
  const [pdfPreset, setPdfPreset] = useState('balanced') // balanced|archive
  const [pdfSearchable, setPdfSearchable] = useState(false)

  async function loadPdfProMeta() {
    if (!pdfProFile) return
    try {
      const { PDFDocument } = await getPdfLib()
      const bytes = await pdfProFile.arrayBuffer()
      const pdf = await PDFDocument.load(bytes)
      setPdfPageCount(pdf.getPageCount())
    } catch {
      setPdfPageCount(0)
    }
  }

  useEffect(() => {
    loadPdfProMeta().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfProFile])

  function parseReorderSpec(spec, maxPages) {
    const parts = String(spec || '')
      .split(',')
      .map((x) => parseInt(x.trim(), 10))
      .filter((x) => Number.isFinite(x) && x >= 1 && x <= maxPages)
    return parts.map((x) => x - 1)
  }

  async function runPdfProApply() {
    if (!pdfProFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const { PDFDocument, degrees, rgb, StandardFonts } = await getPdfLib()
      const bytes = await pdfProFile.arrayBuffer()
      let pdf = await PDFDocument.load(bytes)

      // reorder
      if (pdfReorderSpec.trim()) {
        const order = parseReorderSpec(pdfReorderSpec, pdf.getPageCount())
        if (order.length) {
          const d = await PDFDocument.create()
          const copied = await d.copyPages(pdf, order)
          for (const p of copied) d.addPage(p)
          pdf = d
        }
      }

      // rotate + redaction
      const pages = pdf.getPages()
      const rotTargets = parsePageSpec(pdfRotatePages, pages.length)
      const redTargets = parsePageSpec(pdfRedactPages, pages.length)
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i]
        if (rotTargets.includes(i)) {
          const cur = p.getRotation().angle || 0
          p.setRotation(degrees((cur + Number(pdfRotateDeg || 90)) % 360))
        }
        if (redTargets.includes(i)) {
          p.drawRectangle({
            x: Number(pdfRedactX) || 40,
            y: Number(pdfRedactY) || 40,
            width: Number(pdfRedactW) || 180,
            height: Number(pdfRedactH) || 48,
            color: rgb(0, 0, 0),
          })
        }
        setProgress((i + 1) / Math.max(1, pages.length))
      }

      if (pdfSearchable) {
        // Lightweight searchable mode: OCR each page and add invisible-ish text blocks.
        const { loadPdfFromArrayBuffer, renderPdfPageToCanvas } = await import('../../utils/pdfjs.js')
        const srcPdf = await loadPdfFromArrayBuffer(await pdfProFile.arrayBuffer())
        const tesseract = await getTesseract()
        const font = await pdf.embedFont(StandardFonts.Helvetica)
        const pages2 = pdf.getPages()
        const canvas = document.createElement('canvas')
        for (let i = 0; i < pages2.length; i++) {
          await renderPdfPageToCanvas(srcPdf, i + 1, canvas, 1.1)
          const { data } = await tesseract.recognize(canvas, 'eng')
          const text = String(data?.text || '').trim()
          if (text) {
            pages2[i].drawText(text.slice(0, 8000), {
              x: 8,
              y: 8,
              size: 6,
              font,
              color: rgb(0, 0, 0),
              opacity: 0.02,
            })
          }
          setProgress((i + 1) / Math.max(1, pages2.length))
        }
      }

      const saveOpts = pdfPreset === 'archive'
        ? { useObjectStreams: false, addDefaultPage: false }
        : { useObjectStreams: true, addDefaultPage: false }
      pdf.setTitle(`Processed ${pdfProFile.name}`)
      pdf.setProducer('Offline CEO Tools (local)')
      const out = await pdf.save(saveOpts)
      downloadBlob(new Blob([out], { type: 'application/pdf' }), `pdf-pro-${baseName(pdfProFile.name)}-${Date.now()}.pdf`)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // 12) Video/Audio Pro
  const [vidAction, setVidAction] = useState('trim') // trim|normalize|subburn|gif
  const [vidStart, setVidStart] = useState(0)
  const [vidEnd, setVidEnd] = useState(10)
  const [vidGifFps, setVidGifFps] = useState(12)
  const [vidGifW, setVidGifW] = useState(480)
  const [vidSubFile, setVidSubFile] = useState(null)

  async function runVideoProAction() {
    if (!ffFile) return
    setErr('')
    setBusy(true)
    setFfBusy(true)
    setProgress(0)
    setFfLog('')
    try {
      const ff = await ensureFfmpegInstance()
      const inName = safeName(ffFile.name || 'input.bin')
      await ff.writeFile(inName, new Uint8Array(await ffFile.arrayBuffer()))
      let outName = 'out.mp4'
      let mime = 'video/mp4'
      let args = []
      if (vidAction === 'trim') {
        outName = replaceExt(inName, 'mp4')
        args = ['-ss', String(vidStart), '-to', String(vidEnd), '-i', inName, '-c', 'copy', outName]
      } else if (vidAction === 'normalize') {
        outName = replaceExt(inName, 'mp3')
        mime = 'audio/mpeg'
        args = ['-i', inName, '-vn', '-af', 'loudnorm=I=-16:LRA=11:TP=-1.5', '-c:a', 'libmp3lame', '-b:a', '192k', outName]
      } else if (vidAction === 'subburn') {
        if (!vidSubFile) throw new Error('Subtitle (.srt) file is required.')
        const srtName = safeName(vidSubFile.name || 'subs.srt')
        await ff.writeFile(srtName, new Uint8Array(await vidSubFile.arrayBuffer()))
        outName = replaceExt(inName, 'mp4')
        args = ['-i', inName, '-vf', `subtitles=${srtName}`, '-c:v', 'libx264', '-crf', '24', '-preset', 'veryfast', outName]
      } else {
        outName = replaceExt(inName, 'gif')
        mime = 'image/gif'
        args = ['-ss', String(vidStart), '-to', String(vidEnd), '-i', inName, '-vf', `fps=${Math.max(1, Number(vidGifFps) || 12)},scale=${Math.max(64, Number(vidGifW) || 480)}:-1:flags=lanczos`, '-loop', '0', outName]
      }
      await ff.exec(args)
      const out = await ff.readFile(outName)
      downloadBlob(new Blob([out.buffer], { type: mime }), outName)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
      setFfBusy(false)
    }
  }

  // 13) Dev pro
  const [schemaFields, setSchemaFields] = useState([{ name: 'name', type: 'string', required: true }])
  const [schemaTitle, setSchemaTitle] = useState('MySchema')
  const [schemaOut, setSchemaOut] = useState('')
  const [apiPath, setApiPath] = useState('/items/{id}')
  const [apiMethod, setApiMethod] = useState('get')
  const [apiSummary, setApiSummary] = useState('Get item')
  const [apiOut, setApiOut] = useState('')
  const [harIn, setHarIn] = useState('')
  const [harOut, setHarOut] = useState('')
  const [sqlIn, setSqlIn] = useState('select id,name from users where active=1 order by created_at desc;')
  const [sqlOut, setSqlOut] = useState('')

  function runSchemaBuilder() {
    const props = {}
    const req = []
    for (const f of schemaFields) {
      const key = String(f.name || '').trim()
      if (!key) continue
      props[key] = { type: f.type || 'string' }
      if (f.required) req.push(key)
    }
    const out = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: schemaTitle || 'Schema',
      type: 'object',
      properties: props,
      required: req,
      additionalProperties: false,
    }
    setSchemaOut(JSON.stringify(out, null, 2))
  }

  function runOpenApiSnippet() {
    const out = {
      openapi: '3.1.0',
      paths: {
        [apiPath || '/items']: {
          [String(apiMethod || 'get').toLowerCase()]: {
            summary: apiSummary || '',
            responses: {
              200: { description: 'OK' },
            },
          },
        },
      },
    }
    setApiOut(JSON.stringify(out, null, 2))
  }

  function runHarAnalyze() {
    try {
      const obj = JSON.parse(harIn || '{}')
      const entries = obj?.log?.entries || []
      const total = entries.length
      const transfer = entries.reduce((a, e) => a + Math.max(0, Number(e?.response?.bodySize) || 0), 0)
      const sorted = entries
        .map((e) => ({
          url: e?.request?.url || '',
          ms: Number(e?.time) || 0,
          status: e?.response?.status || 0,
        }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 12)
      setHarOut(
        [
          `Requests: ${total}`,
          `Total transfer (bodySize): ${formatBytes(transfer)}`,
          '',
          'Slowest:',
          ...sorted.map((x) => `${Math.round(x.ms)}ms [${x.status}] ${x.url}`),
        ].join('\n'),
      )
    } catch (e) {
      setHarOut(`Invalid HAR JSON: ${e?.message || String(e)}`)
    }
  }

  function runSqlFormatExplain() {
    const s = String(sqlIn || '').trim()
    const keywords = ['select', 'from', 'where', 'group by', 'order by', 'having', 'limit', 'join', 'left join', 'right join', 'inner join']
    let out = s
    for (const kw of keywords) {
      const re = new RegExp(`\\b${kw.replace(' ', '\\s+')}\\b`, 'ig')
      out = out.replace(re, `\n${kw.toUpperCase()}`)
    }
    out = out.replace(/\s*,\s*/g, ', ')
    out = out.replace(/\n{2,}/g, '\n').trim()
    const type = /^\s*(select|insert|update|delete)/i.exec(s)?.[1]?.toUpperCase() || 'UNKNOWN'
    const explain = `Query type: ${type}\nHas WHERE: ${/\bwhere\b/i.test(s) ? 'yes' : 'no'}\nHas ORDER BY: ${/\border\s+by\b/i.test(s) ? 'yes' : 'no'}`
    setSqlOut(`${out}\n\n--\n${explain}`)
  }

  // 14) Design generators
  const [favFile, setFavFile] = useState(null)
  const [favOutManifest, setFavOutManifest] = useState('')
  const [frameFile, setFrameFile] = useState(null)
  const [framePreset, setFramePreset] = useState('iphone-14-pro') // iphone-14-pro|android-6.7
  const [frameOutUrl, setFrameOutUrl] = useState('')
  const [frameOutBlob, setFrameOutBlob] = useState(null)
  const [brandName, setBrandName] = useState('Offline CEO Tools')
  const [brandColor, setBrandColor] = useState('#7EE4FF')
  const [brandOut, setBrandOut] = useState('')

  useEffect(() => {
    return () => {
      if (frameOutUrl) URL.revokeObjectURL(frameOutUrl)
    }
  }, [frameOutUrl])

  async function runFaviconManifestPack() {
    if (!favFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const sizes = [16, 32, 48, 64, 72, 96, 128, 144, 152, 180, 192, 256, 384, 512]
      const entries = []
      for (let i = 0; i < sizes.length; i++) {
        const s = sizes[i]
        const c = await imageFileToCanvas(favFile)
        const out = document.createElement('canvas')
        out.width = s
        out.height = s
        out.getContext('2d', { alpha: true }).drawImage(c, 0, 0, c.width, c.height, 0, 0, s, s)
        const blob = await canvasToBlob(out, 'image/png')
        entries.push({ name: `icons/icon-${s}x${s}.png`, blob })
        setProgress((i + 1) / sizes.length)
      }
      const manifest = {
        name: brandName || 'Web App',
        short_name: String(brandName || 'App').slice(0, 12),
        start_url: '.',
        display: 'standalone',
        background_color: '#0B0E14',
        theme_color: '#0B0E14',
        icons: sizes.map((s) => ({ src: `icons/icon-${s}x${s}.png`, sizes: `${s}x${s}`, type: 'image/png' })),
      }
      const manifestBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/manifest+json' })
      entries.push({ name: 'site.webmanifest', blob: manifestBlob })
      setFavOutManifest(JSON.stringify(manifest, null, 2))
      const zip = await zipBlobs(entries)
      downloadBlob(zip, `favicon-pack-${Date.now()}.zip`)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function runFrameMaker() {
    if (!frameFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const preset = framePreset === 'android-6.7'
        ? { w: 1440, h: 3120, inset: 92, radius: 90 }
        : { w: 1290, h: 2796, inset: 88, radius: 84 }
      const src = await imageFileToCanvas(frameFile)
      const c = document.createElement('canvas')
      c.width = preset.w
      c.height = preset.h
      const ctx = c.getContext('2d', { alpha: true })
      ctx.fillStyle = '#0B0E14'
      ctx.fillRect(0, 0, c.width, c.height)
      // device body
      ctx.fillStyle = '#111827'
      ctx.fillRect(24, 24, c.width - 48, c.height - 48)
      // screen area with rounded mask
      const x = preset.inset
      const y = preset.inset
      const w = c.width - preset.inset * 2
      const h = c.height - preset.inset * 2
      ctx.save()
      ctx.beginPath()
      const r = preset.radius
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
      ctx.clip()
      const scale = Math.max(w / src.width, h / src.height)
      const dw = Math.round(src.width * scale)
      const dh = Math.round(src.height * scale)
      const dx = x + Math.floor((w - dw) / 2)
      const dy = y + Math.floor((h - dh) / 2)
      ctx.drawImage(src, 0, 0, src.width, src.height, dx, dy, dw, dh)
      ctx.restore()
      const blob = await canvasToBlob(c, 'image/png')
      setFrameOutBlob(blob)
      if (frameOutUrl) URL.revokeObjectURL(frameOutUrl)
      setFrameOutUrl(URL.createObjectURL(blob))
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  function runBrandKit() {
    const base = parseHexRgb(brandColor)
    const mk = (t) => rgbToHex(base.r + (255 - base.r) * t, base.g + (255 - base.g) * t, base.b + (255 - base.b) * t)
    const dk = (t) => rgbToHex(base.r * (1 - t), base.g * (1 - t), base.b * (1 - t))
    const out = {
      name: brandName,
      colors: {
        base: rgbToHex(base.r, base.g, base.b),
        light1: mk(0.25),
        light2: mk(0.5),
        dark1: dk(0.2),
        dark2: dk(0.4),
      },
      css: `:root {\n  --brand: ${rgbToHex(base.r, base.g, base.b)};\n  --brand-light: ${mk(0.25)};\n  --brand-dark: ${dk(0.2)};\n  --radius: 14px;\n  --shadow: 0 14px 38px rgba(0,0,0,0.22);\n}`,
      typography: {
        display: 'ui-serif, Georgia, serif',
        body: 'ui-sans-serif, system-ui, sans-serif',
        mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
    }
    setBrandOut(JSON.stringify(out, null, 2))
  }

  // 15) Privacy/offline
  const [installPromptEvt, setInstallPromptEvt] = useState(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [storageInfo, setStorageInfo] = useState({ used: 0, quota: 0 })
  const [swState, setSwState] = useState('unknown')

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault()
      setInstallPromptEvt(e)
    }
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    setIsInstalled(window.matchMedia?.('(display-mode: standalone)')?.matches || false)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  async function refreshStorageInfo() {
    try {
      if (!navigator.storage?.estimate) return
      const est = await navigator.storage.estimate()
      setStorageInfo({ used: Number(est.usage || 0), quota: Number(est.quota || 0) })
    } catch {
      // ignore
    }
  }

  async function refreshSwState() {
    try {
      if (!('serviceWorker' in navigator)) {
        setSwState('unsupported')
        return
      }
      const reg = await navigator.serviceWorker.getRegistration()
      setSwState(reg ? 'registered' : 'not registered')
    } catch {
      setSwState('unknown')
    }
  }

  useEffect(() => {
    refreshStorageInfo().catch(() => {})
    refreshSwState().catch(() => {})
  }, [])

  async function runInstallPwa() {
    if (!installPromptEvt) return
    try {
      await installPromptEvt.prompt()
    } catch {
      // ignore
    }
  }

  async function runWipeLocalData() {
    setErr('')
    try {
      localStorage.clear()
      sessionStorage.clear()
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
      window.dispatchEvent(new Event('oct:prefs'))
      await refreshStorageInfo()
    } catch (e) {
      setErr(e?.message || String(e))
    }
  }

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>WASM + Heavy Local Tools</h1>
        <p className="muted">
          These tools run entirely in your browser and can be heavy. Files stay on-device.
        </p>
      </div>

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <ToolTabs tools={TOOLS} activeId={tool} onChange={setTool} />
          <FavoriteButton
            entry={{
              key: toolKey('wasm', tool),
              label: `WASM: ${TOOLS.find((x) => x.id === tool)?.label || tool}`,
              path: `/wasm?tool=${tool}`,
              tool,
            }}
          />
        </div>
        {err ? <div className="error">{err}</div> : null}
        {busy || progress > 0 ? <ProgressBar value={progress} label={busy ? 'Working' : 'Last run'} /> : null}
      </section>

      {tool === 'ux' ? (
        <section className="panel">
          <h2>Project UX Kit</h2>
          <div className="two">
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Keyboard Shortcuts</div>
              <div className="list mono" style={{ fontSize: 13 }}>
                <div><span className="kbd">/</span> focus global search</div>
                <div><span className="kbd">g</span> + <span className="kbd">i</span> go to image</div>
                <div><span className="kbd">g</span> + <span className="kbd">p</span> go to pdf</div>
                <div><span className="kbd">g</span> + <span className="kbd">w</span> go to wasm</div>
              </div>
            </div>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Settings Export / Import</div>
              <div className="row">
                <button className="button" type="button" onClick={runExportAllSettings}>Export all local settings</button>
                <label className="button button--ghost" style={{ display: 'inline-flex', alignItems: 'center' }}>
                  {uxImportBusy ? 'Importing...' : 'Import settings JSON'}
                  <input
                    type="file"
                    accept="application/json,.json"
                    style={{ display: 'none' }}
                    onChange={(e) => runImportAllSettings(e.target.files?.[0] || null)}
                  />
                </label>
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                Includes tool favorites/recents and any local preferences saved in `localStorage`.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'imagepro' ? (
        <section className="panel">
          <h2>Image Pro</h2>
          <div className="field">
            <label>Input image</label>
            <input className="input" type="file" accept="image/*" disabled={busy} onChange={(e) => setImgProFile(e.target.files?.[0] || null)} />
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Background remover (chroma-key local)</div>
              <div className="row">
                <div className="field" style={{ width: 140 }}>
                  <label>Key color</label>
                  <input className="input" type="color" value={bgKeyColor} onChange={(e) => setBgKeyColor(e.target.value)} />
                </div>
                <div className="field" style={{ width: 220 }}>
                  <label>Tolerance</label>
                  <input className="input" type="range" min="0" max="255" value={bgTolerance} onChange={(e) => setBgTolerance(Number(e.target.value))} />
                </div>
                <button className="button" type="button" onClick={runBgRemove} disabled={busy || !imgProFile}>Remove BG</button>
              </div>
            </div>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Auto face detect + censor</div>
              <div className="row">
                <div className="field" style={{ width: 180 }}>
                  <label>Mode</label>
                  <select className="select" value={faceMode} onChange={(e) => setFaceMode(e.target.value)}>
                    <option value="pixelate">Pixelate</option>
                    <option value="blur">Blur</option>
                    <option value="bar">Black bar</option>
                  </select>
                </div>
                <div className="field" style={{ width: 220 }}>
                  <label>Strength</label>
                  <input className="input" type="range" min="2" max="40" value={faceStrength} onChange={(e) => setFaceStrength(Number(e.target.value))} />
                </div>
                <button className="button" type="button" onClick={runAutoFaceCensor} disabled={busy || !imgProFile}>Auto censor faces</button>
              </div>
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Batch watermark templates</div>
              <FileDrop
                label="Drop images for watermark batch"
                hint="Template supports {name} {yyyy} {mm} {dd}"
                accept={['image/*']}
                multiple
                disabled={busy}
                onFiles={setWmBatchFiles}
              />
              <div className="row" style={{ marginTop: 8 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Template</label>
                  <input className="input mono" value={wmTemplate} onChange={(e) => setWmTemplate(e.target.value)} />
                </div>
                <div className="field" style={{ width: 180 }}>
                  <label>Position</label>
                  <select className="select" value={wmPreset} onChange={(e) => setWmPreset(e.target.value)}>
                    <option value="tl">Top-left</option>
                    <option value="tr">Top-right</option>
                    <option value="bl">Bottom-left</option>
                    <option value="br">Bottom-right</option>
                    <option value="center">Center</option>
                  </select>
                </div>
                <button className="button" type="button" onClick={runBatchWatermarkTemplate} disabled={busy || !wmBatchFiles.length}>Build ZIP</button>
              </div>
            </div>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>ICO generator</div>
              <div className="field">
                <label>Image</label>
                <input className="input" type="file" accept="image/*" disabled={busy} onChange={(e) => setIcoFile(e.target.files?.[0] || null)} />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Sizes</label>
                  <input className="input mono" value={icoSizes} onChange={(e) => setIcoSizes(e.target.value)} />
                </div>
                <button className="button" type="button" onClick={runIcoGenerator} disabled={busy || !icoFile}>Download .ico</button>
              </div>
              <p className="muted" style={{ marginTop: 8 }}>ICNS is not generated directly; use the icon pack ZIP for Apple asset pipelines.</p>
            </div>
          </div>
          {imgProOutUrl ? (
            <div className="panel" style={{ marginTop: 10, padding: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="mono muted">Result preview</div>
                <button className="button button--ghost" type="button" onClick={() => imgProOutBlob && downloadBlob(imgProOutBlob, `image-pro-${Date.now()}.png`)}>
                  Download PNG
                </button>
              </div>
              <img src={imgProOutUrl} alt="Image Pro output" style={{ maxWidth: '100%', borderRadius: 12, marginTop: 8 }} />
            </div>
          ) : null}
        </section>
      ) : null}

      {tool === 'pdfpro' ? (
        <section className="panel">
          <h2>PDF Pro</h2>
          <div className="field">
            <label>PDF file</label>
            <input className="input" type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(e) => setPdfProFile(e.target.files?.[0] || null)} />
          </div>
          {pdfProFile ? <div className="muted mono" style={{ marginTop: 8 }}>{pdfProFile.name} {pdfPageCount ? `(${pdfPageCount} pages)` : ''}</div> : null}
          <div className="two" style={{ marginTop: 10 }}>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Organizer + rotation</div>
              <div className="field">
                <label>Reorder spec (optional, e.g. 3,1,2)</label>
                <input className="input mono" value={pdfReorderSpec} onChange={(e) => setPdfReorderSpec(e.target.value)} />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Rotate pages</label>
                  <input className="input mono" value={pdfRotatePages} onChange={(e) => setPdfRotatePages(e.target.value)} placeholder="1,3-5" />
                </div>
                <div className="field" style={{ width: 140 }}>
                  <label>Degrees</label>
                  <select className="select" value={pdfRotateDeg} onChange={(e) => setPdfRotateDeg(Number(e.target.value))}>
                    <option value={90}>90</option>
                    <option value={180}>180</option>
                    <option value={270}>270</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Redaction + export preset</div>
              <div className="field">
                <label>Redact pages</label>
                <input className="input mono" value={pdfRedactPages} onChange={(e) => setPdfRedactPages(e.target.value)} placeholder="1 or 2-4" />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <div className="field" style={{ width: 120 }}><label>X</label><input className="input" type="number" value={pdfRedactX} onChange={(e) => setPdfRedactX(e.target.value)} /></div>
                <div className="field" style={{ width: 120 }}><label>Y</label><input className="input" type="number" value={pdfRedactY} onChange={(e) => setPdfRedactY(e.target.value)} /></div>
                <div className="field" style={{ width: 120 }}><label>W</label><input className="input" type="number" value={pdfRedactW} onChange={(e) => setPdfRedactW(e.target.value)} /></div>
                <div className="field" style={{ width: 120 }}><label>H</label><input className="input" type="number" value={pdfRedactH} onChange={(e) => setPdfRedactH(e.target.value)} /></div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <div className="field" style={{ width: 220 }}>
                  <label>Preset</label>
                  <select className="select" value={pdfPreset} onChange={(e) => setPdfPreset(e.target.value)}>
                    <option value="balanced">Balanced</option>
                    <option value="archive">PDF/A-ish compatibility</option>
                  </select>
                </div>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={pdfSearchable} onChange={(e) => setPdfSearchable(e.target.checked)} />
                  <span className="muted">OCR searchable overlay</span>
                </label>
              </div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={runPdfProApply} disabled={busy || !pdfProFile}>
              Apply PDF Pro
            </button>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            For full drag-and-drop multi-select page organizer UI, also use the main PDF module (`/pdf?tool=pages`) which already supports thumbnails + DnD reorder.
          </p>
        </section>
      ) : null}

      {tool === 'videopro' ? (
        <section className="panel">
          <h2>Video/Audio Pro (FFmpeg)</h2>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Input media</label>
              <input className="input" type="file" accept="video/*,audio/*" disabled={busy} onChange={(e) => setFfFile(e.target.files?.[0] || null)} />
            </div>
            <div className="field" style={{ minWidth: 220 }}>
              <label>Action</label>
              <select className="select" value={vidAction} onChange={(e) => setVidAction(e.target.value)}>
                <option value="trim">Trim / Cut</option>
                <option value="normalize">Audio normalize</option>
                <option value="subburn">Subtitle burn-in (.srt)</option>
                <option value="gif">GIF export controls</option>
              </select>
            </div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <div className="field" style={{ width: 140 }}><label>Start sec</label><input className="input" type="number" value={vidStart} onChange={(e) => setVidStart(e.target.value)} /></div>
            <div className="field" style={{ width: 140 }}><label>End sec</label><input className="input" type="number" value={vidEnd} onChange={(e) => setVidEnd(e.target.value)} /></div>
            {vidAction === 'gif' ? (
              <>
                <div className="field" style={{ width: 140 }}><label>GIF FPS</label><input className="input" type="number" value={vidGifFps} onChange={(e) => setVidGifFps(e.target.value)} /></div>
                <div className="field" style={{ width: 160 }}><label>GIF width</label><input className="input" type="number" value={vidGifW} onChange={(e) => setVidGifW(e.target.value)} /></div>
              </>
            ) : null}
            {vidAction === 'subburn' ? (
              <div className="field" style={{ minWidth: 260 }}>
                <label>Subtitle file</label>
                <input className="input" type="file" accept=".srt,text/plain" onChange={(e) => setVidSubFile(e.target.files?.[0] || null)} />
              </div>
            ) : null}
            <button className="button" type="button" onClick={runVideoProAction} disabled={busy || !ffFile}>
              {ffBusy ? 'Running...' : 'Run action'}
            </button>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Log</label>
            <textarea className="textarea" value={ffLog} readOnly />
          </div>
        </section>
      ) : null}

      {tool === 'devpro' ? (
        <section className="panel">
          <h2>Developer Pro</h2>
          <div className="two">
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>JSON schema builder</div>
              <div className="field">
                <label>Title</label>
                <input className="input" value={schemaTitle} onChange={(e) => setSchemaTitle(e.target.value)} />
              </div>
              <div className="stack" style={{ marginTop: 8 }}>
                {schemaFields.map((f, i) => (
                  <div key={i} className="row">
                    <input className="input" style={{ flex: 1 }} value={f.name} onChange={(e) => setSchemaFields((all) => all.map((x, ix) => (ix === i ? { ...x, name: e.target.value } : x)))} placeholder="field name" />
                    <select className="select" style={{ width: 140 }} value={f.type} onChange={(e) => setSchemaFields((all) => all.map((x, ix) => (ix === i ? { ...x, type: e.target.value } : x)))}>
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                      <option value="array">array</option>
                      <option value="object">object</option>
                    </select>
                    <label className="row" style={{ gap: 6 }}>
                      <input type="checkbox" checked={!!f.required} onChange={(e) => setSchemaFields((all) => all.map((x, ix) => (ix === i ? { ...x, required: e.target.checked } : x)))} />
                      <span className="muted">Req</span>
                    </label>
                    <button className="button button--ghost" type="button" onClick={() => setSchemaFields((all) => all.filter((_, ix) => ix !== i))}>Del</button>
                  </div>
                ))}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="button button--ghost" type="button" onClick={() => setSchemaFields((all) => all.concat([{ name: '', type: 'string', required: false }]))}>Add field</button>
                <button className="button" type="button" onClick={runSchemaBuilder}>Build schema</button>
              </div>
              <textarea className="textarea" style={{ marginTop: 8 }} value={schemaOut} readOnly />
            </div>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>OpenAPI snippet generator</div>
              <div className="row">
                <input className="input" style={{ flex: 1 }} value={apiPath} onChange={(e) => setApiPath(e.target.value)} />
                <select className="select" style={{ width: 120 }} value={apiMethod} onChange={(e) => setApiMethod(e.target.value)}>
                  <option value="get">GET</option>
                  <option value="post">POST</option>
                  <option value="put">PUT</option>
                  <option value="delete">DELETE</option>
                </select>
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Summary</label>
                <input className="input" value={apiSummary} onChange={(e) => setApiSummary(e.target.value)} />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="button" type="button" onClick={runOpenApiSnippet}>Generate</button>
              </div>
              <textarea className="textarea" style={{ marginTop: 8 }} value={apiOut} readOnly />
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>HAR analyzer</div>
              <textarea className="textarea" value={harIn} onChange={(e) => setHarIn(e.target.value)} placeholder="Paste HAR JSON" />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="button" type="button" onClick={runHarAnalyze}>Analyze HAR</button>
              </div>
              <textarea className="textarea" style={{ marginTop: 8 }} value={harOut} readOnly />
            </div>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>SQL formatter + explainer</div>
              <textarea className="textarea" value={sqlIn} onChange={(e) => setSqlIn(e.target.value)} />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="button" type="button" onClick={runSqlFormatExplain}>Format + explain</button>
              </div>
              <textarea className="textarea" style={{ marginTop: 8 }} value={sqlOut} readOnly />
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'design' ? (
        <section className="panel">
          <h2>Design Generators</h2>
          <div className="two">
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Favicon + webmanifest pack</div>
              <div className="field">
                <label>Base image</label>
                <input className="input" type="file" accept="image/*" onChange={(e) => setFavFile(e.target.files?.[0] || null)} />
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <label>App name</label>
                <input className="input" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="button" type="button" onClick={runFaviconManifestPack} disabled={busy || !favFile}>
                  Build favicon ZIP
                </button>
              </div>
              <textarea className="textarea" style={{ marginTop: 8 }} value={favOutManifest} readOnly />
            </div>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>App screenshot frame maker</div>
              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Screenshot</label>
                  <input className="input" type="file" accept="image/*" onChange={(e) => setFrameFile(e.target.files?.[0] || null)} />
                </div>
                <div className="field" style={{ width: 200 }}>
                  <label>Preset</label>
                  <select className="select" value={framePreset} onChange={(e) => setFramePreset(e.target.value)}>
                    <option value="iphone-14-pro">iPhone 14 Pro</option>
                    <option value="android-6.7">Android 6.7"</option>
                  </select>
                </div>
                <button className="button" type="button" onClick={runFrameMaker} disabled={busy || !frameFile}>
                  Build frame
                </button>
              </div>
              {frameOutUrl ? (
                <div className="stack" style={{ marginTop: 8 }}>
                  <img src={frameOutUrl} alt="Framed screenshot" style={{ maxWidth: '100%', borderRadius: 12 }} />
                  <button className="button button--ghost" type="button" onClick={() => frameOutBlob && downloadBlob(frameOutBlob, `framed-${Date.now()}.png`)}>
                    Download PNG
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Brand kit generator</div>
              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Brand name</label>
                  <input className="input" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
                </div>
                <div className="field" style={{ width: 160 }}>
                  <label>Base color</label>
                  <input className="input" type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} />
                </div>
                <button className="button" type="button" onClick={runBrandKit}>Generate</button>
              </div>
              <textarea className="textarea" style={{ marginTop: 8 }} value={brandOut} readOnly />
            </div>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Social template packs</div>
              <p className="muted">
                Use `/social` module for full generators. This pack gives pre-sized blank templates quickly.
              </p>
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  className="button"
                  type="button"
                  onClick={async () => {
                    const dims = [
                      ['x-post', 1600, 900],
                      ['ig-post', 1080, 1080],
                      ['ig-story', 1080, 1920],
                      ['yt-thumb', 1280, 720],
                    ]
                    const entries = []
                    for (let i = 0; i < dims.length; i++) {
                      const [name, w, h] = dims[i]
                      const c = document.createElement('canvas')
                      c.width = w
                      c.height = h
                      const ctx = c.getContext('2d')
                      ctx.fillStyle = '#0B0E14'
                      ctx.fillRect(0, 0, w, h)
                      ctx.strokeStyle = 'rgba(255,255,255,0.2)'
                      ctx.strokeRect(1, 1, w - 2, h - 2)
                      ctx.fillStyle = 'rgba(255,255,255,0.7)'
                      ctx.font = '28px ui-monospace, monospace'
                      ctx.fillText(`${name} ${w}x${h}`, 28, 44)
                      const blob = await canvasToBlob(c, 'image/png')
                      entries.push({ name: `${name}.png`, blob })
                    }
                    const zip = await zipBlobs(entries)
                    downloadBlob(zip, `social-templates-${Date.now()}.zip`)
                  }}
                >
                  Download social template ZIP
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'privacy' ? (
        <section className="panel">
          <h2>Privacy + Offline Polish</h2>
          <div className="two">
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>PWA / service worker</div>
              <div className="list mono" style={{ fontSize: 13 }}>
                <div>Installed: {isInstalled ? 'yes' : 'no'}</div>
                <div>Service Worker: {swState}</div>
                <div>Online: {isOnline ? 'online' : 'offline'}</div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="button" type="button" onClick={runInstallPwa} disabled={!installPromptEvt}>Install app</button>
                <button className="button button--ghost" type="button" onClick={() => refreshSwState().catch(() => {})}>Refresh SW status</button>
              </div>
            </div>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Storage usage meter</div>
              <div className="mono">
                Used: {formatBytes(storageInfo.used)} / Quota: {formatBytes(storageInfo.quota)}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button className="button button--ghost" type="button" onClick={() => refreshStorageInfo().catch(() => {})}>Refresh usage</button>
                <button className="button" type="button" onClick={runWipeLocalData}>Wipe local app data</button>
              </div>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 10, padding: 12 }}>
            <div className="mono muted" style={{ marginBottom: 8 }}>Airplane mode test</div>
            <p className="muted">
              Turn off network and refresh this app. If assets were cached by service worker, shell pages still load.
              File-processing tools continue to work fully offline.
            </p>
          </div>
        </section>
      ) : null}

      {tool === 'iconpack' ? (
        <section className="panel">
          <h2>Icon Pack Generator</h2>
          <FileDrop
            label="Drop one or more source images"
            hint="Each source image will be exported to multiple icon sizes"
            accept={['image/*']}
            multiple
            disabled={busy}
            onFiles={setIconFiles}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Sizes (comma separated)</label>
              <input className="input mono" value={iconSizes} onChange={(e) => setIconSizes(e.target.value)} />
            </div>
            <div className="field" style={{ width: 180 }}>
              <label>Background RGBA hex</label>
              <input className="input mono" value={iconBg} onChange={(e) => setIconBg(e.target.value)} placeholder="#00000000" />
            </div>
            <button className="button" type="button" onClick={runIconPack} disabled={busy || !iconFiles.length}>
              Build ZIP
            </button>
          </div>
        </section>
      ) : null}

      {tool === 'sprite' ? (
        <section className="panel">
          <h2>Sprite Sheet Builder</h2>
          <FileDrop
            label="Drop sprite source images"
            hint="Outputs sprite.png + CSS mapping"
            accept={['image/*']}
            multiple
            disabled={busy}
            onFiles={setSpriteFiles}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <div className="field" style={{ width: 140 }}>
              <label>Columns</label>
              <input className="input" type="number" value={spriteCols} onChange={(e) => setSpriteCols(e.target.value)} />
            </div>
            <div className="field" style={{ width: 140 }}>
              <label>Cell px</label>
              <input className="input" type="number" value={spriteCell} onChange={(e) => setSpriteCell(e.target.value)} />
            </div>
            <div className="field" style={{ width: 140 }}>
              <label>Padding</label>
              <input className="input" type="number" value={spritePadding} onChange={(e) => setSpritePadding(e.target.value)} />
            </div>
            <button className="button" type="button" onClick={runSpriteSheet} disabled={busy || !spriteFiles.length}>
              Build sprite
            </button>
          </div>
          {spriteOutUrl ? (
            <div className="two" style={{ marginTop: 10 }}>
              <div className="panel" style={{ padding: 12 }}>
                <div className="mono muted" style={{ marginBottom: 8 }}>Sprite preview</div>
                <img src={spriteOutUrl} alt="Sprite sheet" style={{ maxWidth: '100%', borderRadius: 12 }} />
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="button button--ghost" type="button" onClick={() => spriteOutBlob && downloadBlob(spriteOutBlob, 'sprite.png')}>
                    Download PNG
                  </button>
                </div>
              </div>
              <div className="field">
                <label>CSS map</label>
                <textarea className="textarea" value={spriteCss} readOnly />
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tool === 'palette' ? (
        <section className="panel">
          <h2>Palette Extractor</h2>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Image</label>
              <input className="input" type="file" accept="image/*" disabled={busy} onChange={(e) => setPalFile(e.target.files?.[0] || null)} />
            </div>
            <div className="field" style={{ width: 140 }}>
              <label>Colors</label>
              <input className="input" type="number" value={palK} onChange={(e) => setPalK(e.target.value)} />
            </div>
            <button className="button" type="button" onClick={runPaletteExtractor} disabled={busy || !palFile}>
              Extract
            </button>
          </div>
          {palData.length ? (
            <div className="stack" style={{ marginTop: 10 }}>
              <div className="panel" style={{ padding: 12 }}>
                <div className="mono muted" style={{ marginBottom: 8 }}>Average</div>
                <div className="mono" style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.16)', background: palAvg }}>
                  {palAvg}
                </div>
              </div>
              <div className="grid" style={{ gap: 10 }}>
                {palData.map((x) => (
                  <div key={x.hex + x.count} className="card" style={{ gridColumn: 'span 6', padding: 12 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <div className="mono" style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.16)', background: x.hex }}>
                        {x.hex}
                      </div>
                      <div className="muted mono">{x.count}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tool === 'svgopt' ? (
        <section className="panel">
          <h2>SVG Optimizer</h2>
          <div className="row">
            <button className="button" type="button" onClick={runSvgOptimize}>
              Optimize
            </button>
            <button className="button button--ghost" type="button" onClick={() => navigator.clipboard?.writeText?.(svgOut).catch(() => {})} disabled={!svgOut}>
              Copy output
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => downloadBlob(new Blob([svgOut], { type: 'image/svg+xml' }), `optimized-${Date.now()}.svg`)}
              disabled={!svgOut}
            >
              Download SVG
            </button>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Input SVG</label>
              <textarea className="textarea" value={svgIn} onChange={(e) => setSvgIn(e.target.value)} />
            </div>
            <div className="field">
              <label>Optimized SVG</label>
              <textarea className="textarea" value={svgOut} readOnly />
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            This is a safe lightweight minifier. It does not run external SVGO plugins.
          </p>
        </section>
      ) : null}

      {tool === 'pdfform' ? (
        <section className="panel">
          <h2>PDF Form Fill / Flatten</h2>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>PDF form file</label>
              <input className="input" type="file" accept="application/pdf,.pdf" disabled={busy || formLoading} onChange={(e) => { setFormPdfFile(e.target.files?.[0] || null); setFormFields([]) }} />
            </div>
            <button className="button" type="button" onClick={loadPdfFormFields} disabled={!formPdfFile || busy || formLoading}>
              {formLoading ? 'Loading...' : 'Load fields'}
            </button>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={formFlatten} onChange={(e) => setFormFlatten(e.target.checked)} />
              <span className="muted">Flatten output</span>
            </label>
          </div>
          {formFields.length ? (
            <div className="stack" style={{ marginTop: 10 }}>
              <div className="table">
                <div className="table__row table__row--head" style={{ gridTemplateColumns: '1fr 180px 1fr' }}>
                  <div>Field</div>
                  <div>Type</div>
                  <div>Value</div>
                </div>
                {formFields.map((f, i) => (
                  <div key={f.name + i} className="table__row" style={{ gridTemplateColumns: '1fr 180px 1fr' }}>
                    <div className="mono">{f.name}</div>
                    <div className="muted mono">{f.type}</div>
                    <div>
                      {f.type === 'PDFCheckBox' ? (
                        <label className="row" style={{ gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={!!f.value}
                            onChange={(e) =>
                              setFormFields((all) => all.map((x, ix) => (ix === i ? { ...x, value: e.target.checked } : x)))
                            }
                          />
                          <span className="muted">Checked</span>
                        </label>
                      ) : (
                        <input
                          className="input"
                          value={String(f.value ?? '')}
                          onChange={(e) =>
                            setFormFields((all) => all.map((x, ix) => (ix === i ? { ...x, value: e.target.value } : x)))
                          }
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="row">
                <button className="button" type="button" onClick={runPdfFillFlatten} disabled={busy || !formPdfFile}>
                  Fill & download
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tool === 'sign' ? (
        <section className="panel">
          <h2>Signature Stamping UI</h2>
          <div className="two">
            <div className="stack">
              <div className="field">
                <label>PDF file</label>
                <input className="input" type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(e) => setSigPdfFile(e.target.files?.[0] || null)} />
              </div>
              <div className="field">
                <label>Signature image (PNG/JPG)</label>
                <input className="input" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" disabled={busy} onChange={(e) => setSigFile(e.target.files?.[0] || null)} />
              </div>
              <div className="row">
                <div className="field" style={{ width: 180 }}>
                  <label>Pages</label>
                  <input className="input mono" value={sigPages} onChange={(e) => setSigPages(e.target.value)} placeholder="1 or 1,3-5" />
                </div>
                <div className="field" style={{ width: 120 }}>
                  <label>X</label>
                  <input className="input" type="number" value={sigX} onChange={(e) => setSigX(e.target.value)} />
                </div>
                <div className="field" style={{ width: 120 }}>
                  <label>Y</label>
                  <input className="input" type="number" value={sigY} onChange={(e) => setSigY(e.target.value)} />
                </div>
                <div className="field" style={{ width: 140 }}>
                  <label>Width</label>
                  <input className="input" type="number" value={sigW} onChange={(e) => setSigW(e.target.value)} />
                </div>
                <div className="field" style={{ width: 220 }}>
                  <label>Opacity</label>
                  <input className="input" type="range" min="0" max="1" step="0.01" value={sigOpacity} onChange={(e) => setSigOpacity(Number(e.target.value))} />
                </div>
              </div>
              <div className="row">
                <button className="button" type="button" onClick={runSignatureStamp} disabled={busy || !sigPdfFile || !sigFile}>
                  Stamp & download
                </button>
              </div>
            </div>
            <div className="panel" style={{ padding: 14 }}>
              <div className="muted">
                Coordinates are in PDF points (origin at bottom-left). For quick placement, start with X:40 Y:40.
              </div>
              <p className="muted" style={{ marginTop: 10 }}>
                This tool intentionally avoids server signing APIs. It only stamps an image onto pages locally.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'ocr' ? (
        <section className="panel">
          <h2>OCR (Tesseract.js)</h2>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Image/PDF page screenshot</label>
              <input className="input" type="file" accept="image/*" disabled={busy} onChange={(e) => setOcrFile(e.target.files?.[0] || null)} />
            </div>
            <div className="field" style={{ width: 140 }}>
              <label>Lang</label>
              <input className="input mono" value={ocrLang} onChange={(e) => setOcrLang(e.target.value)} placeholder="eng" />
            </div>
            <button className="button" type="button" onClick={runOcr} disabled={busy || !ocrFile}>
              Run OCR
            </button>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Recognized text</label>
            <textarea className="textarea" value={ocrOut} readOnly />
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            First run can be slow because language data may need to load in the browser.
          </p>
        </section>
      ) : null}

      {tool === 'ffmpeg' ? (
        <section className="panel">
          <h2>FFmpeg (WASM)</h2>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Input media file</label>
              <input className="input" type="file" accept="video/*,audio/*" disabled={busy} onChange={(e) => setFfFile(e.target.files?.[0] || null)} />
            </div>
            <div className="field" style={{ minWidth: 220 }}>
              <label>Mode</label>
              <select className="select" value={ffMode} onChange={(e) => setFfMode(e.target.value)} disabled={busy}>
                <option value="mp4-to-gif">MP4 → GIF</option>
                <option value="mp4-to-webm">MP4 → WEBM</option>
                <option value="webm-to-mp4">WEBM → MP4</option>
                <option value="extract-mp3">Extract MP3</option>
              </select>
            </div>
            <button className="button" type="button" onClick={runFfmpeg} disabled={busy || !ffFile}>
              {ffBusy ? 'Converting...' : 'Convert'}
            </button>
          </div>
          {ffFile ? <div className="muted mono" style={{ marginTop: 8 }}>{ffFile.name} ({formatBytes(ffFile.size)})</div> : null}

          <div className="panel" style={{ marginTop: 12, padding: 12 }}>
            <div className="mono muted" style={{ marginBottom: 8 }}>Direct Video URL Download (CORS required)</div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>Direct media URL</label>
                <input
                  className="input mono"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://cdn.example.com/video.mp4"
                  disabled={busy}
                />
              </div>
              <div className="field" style={{ minWidth: 220 }}>
                <label>Optional filename</label>
                <input
                  className="input mono"
                  value={videoUrlName}
                  onChange={(e) => setVideoUrlName(e.target.value)}
                  placeholder="my-video.mp4"
                  disabled={busy}
                />
              </div>
              <button className="button" type="button" onClick={runDirectUrlDownload} disabled={busy || !videoUrl.trim()}>
                {videoUrlBusy ? 'Downloading...' : 'Download URL'}
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => {
                  const u = String(videoUrl || '').trim()
                  if (!u) return
                  window.open(u, '_blank', 'noopener,noreferrer')
                }}
                disabled={!videoUrl.trim() || busy}
              >
                Open URL
              </button>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              Works only when the target URL allows browser cross-origin access. Major streaming platforms often block this on purpose.
            </p>
          </div>

          <div className="field" style={{ marginTop: 10 }}>
            <label>Log</label>
            <textarea className="textarea" value={ffLog} readOnly />
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            FFmpeg wasm is heavy. First load is larger and slower, then it is cached by the browser.
          </p>
        </section>
      ) : null}
    </div>
  )
}
