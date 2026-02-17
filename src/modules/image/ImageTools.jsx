import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import FileDrop from '../../components/FileDrop.jsx'
import ProgressBar from '../../components/ProgressBar.jsx'
import Preview from '../../components/Preview.jsx'
import ToolTabs from '../../components/ToolTabs.jsx'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import { formatBytes } from '../../utils/file.js'
import { downloadBlob } from '../../utils/file.js'
import { zipBlobs } from '../../utils/zip.js'
import { processImageFile } from './imageOps.js'
import { addRecent, toolKey } from '../../utils/toolPrefs.js'
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

const TOOLS = [
  { id: 'edit', label: 'Edit/Convert' },
  { id: 'bulk', label: 'Bulk' },
  { id: 'base64', label: 'Base64' },
  { id: 'pdf', label: 'Image -> PDF' },
  { id: 'colors', label: 'Colors' },
  { id: 'picker', label: 'Picker' },
  { id: 'censor', label: 'Censor' },
  { id: 'svg', label: 'SVG' },
  { id: 'favicon', label: 'Favicon Validator' },
  { id: 'exif', label: 'EXIF Viewer/Editor' },
  { id: 'gif', label: 'GIF Frames' },
  { id: 'spriteanim', label: 'Sprite Animator' },
]

function safeName(name) {
  return String(name || 'image').replace(/[\\/:*?"<>|]+/g, '_')
}

function replaceExt(filename, ext) {
  const base = safeName(filename).replace(/\.[^.]+$/, '')
  return base + '.' + ext
}

function extFromMime(type) {
  const t = String(type || '').toLowerCase()
  if (t === 'image/jpeg' || t === 'image/jpg') return 'jpg'
  if (t === 'image/webp') return 'webp'
  if (t === 'image/avif') return 'avif'
  if (t === 'image/bmp') return 'bmp'
  return 'png'
}

function detectCanvasFormats() {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const all = [
    { mime: 'image/png', label: 'PNG' },
    { mime: 'image/jpeg', label: 'JPG' },
    { mime: 'image/webp', label: 'WEBP' },
    { mime: 'image/avif', label: 'AVIF' },
    { mime: 'image/bmp', label: 'BMP' },
  ]
  return all.filter((f) => {
    if (f.mime === 'image/png' || f.mime === 'image/jpeg') return true
    try {
      const url = canvas.toDataURL(f.mime)
      return url.startsWith(`data:${f.mime}`)
    } catch {
      return false
    }
  })
}

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('Failed to read file.'))
    r.readAsDataURL(file)
  })
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

export default function ImageTools() {
  const [searchParams, setSearchParams] = useSearchParams()
  const workerRef = useRef(null)
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [lastError, setLastError] = useState('')
  const [activeTool, setActiveTool] = useState('edit')

  const [singleFile, setSingleFile] = useState(null)
  const [outBlob, setOutBlob] = useState(null)
  const [outUrl, setOutUrl] = useState('')
  const [beforeUrl, setBeforeUrl] = useState('')

  const [wmImageFile, setWmImageFile] = useState(null)
  const imgRef = useRef(null)
  const dragRef = useRef(null)
  const [imgMeta, setImgMeta] = useState({ w: 0, h: 0 })

  const [opts, setOpts] = useState({
    output: { type: 'image/png', quality: 0.85, jpegBackground: '#ffffff' },
    resize: { enabled: false, width: 1200, height: 1200, mode: 'contain' },
    crop: { enabled: false, x: 0, y: 0, w: 0, h: 0 },
    rotate: { degrees: 0 },
    flip: { h: false, v: false },
    filters: { grayscale: 0, blur: 0, brightness: 100, contrast: 100, saturation: 100 },
    sharpen: { strength: 0 },
    watermarkText: {
      text: '',
      opacity: 0.35,
      size: 28,
      color: '#ffffff',
      position: 'br',
      rotate: -18,
      padding: 18,
    },
    watermarkImage: { opacity: 0.35, scale: 0.25, position: 'br', padding: 18 },
  })

  const FILTER_PRESETS = useMemo(
    () => [
      { id: 'custom', label: 'Custom', f: null, sharpen: null },
      { id: 'clarendon', label: 'Clarendon (approx)', f: { contrast: 120, saturation: 125, brightness: 105, grayscale: 0, blur: 0 }, sharpen: 0.4 },
      { id: 'gingham', label: 'Gingham (approx)', f: { contrast: 92, saturation: 90, brightness: 108, grayscale: 0.08, blur: 0 }, sharpen: 0 },
      { id: 'moon', label: 'Moon (approx)', f: { grayscale: 1, contrast: 115, brightness: 108, saturation: 100, blur: 0 }, sharpen: 0.2 },
      { id: 'lofi', label: 'Lo-Fi (approx)', f: { contrast: 135, saturation: 140, brightness: 105, grayscale: 0, blur: 0 }, sharpen: 0.6 },
      { id: 'earlybird', label: 'Earlybird (approx)', f: { contrast: 112, saturation: 90, brightness: 110, grayscale: 0.06, blur: 0 }, sharpen: 0.1 },
      { id: 'inkwell', label: 'Inkwell (approx)', f: { grayscale: 1, contrast: 120, brightness: 102, saturation: 100, blur: 0 }, sharpen: 0.3 },
    ],
    [],
  )
  const [filterPreset, setFilterPreset] = useState('custom')
  const outputFormats = useMemo(() => detectCanvasFormats(), [])

  useEffect(() => {
    if (!outputFormats.length) return
    if (outputFormats.some((f) => f.mime === opts.output.type)) return
    setOpts((s) => ({ ...s, output: { ...s.output, type: outputFormats[0].mime } }))
  }, [outputFormats, opts.output.type])

  // Image color tools
  const [colorFile, setColorFile] = useState(null)
  const [colorBusy, setColorBusy] = useState(false)
  const [paletteN, setPaletteN] = useState(8)
  const [colorStats, setColorStats] = useState(null) // { avgHex, palette: [{hex,count}] }

  // Image picker
  const pickerCanvasRef = useRef(null)
  const [pickerFile, setPickerFile] = useState(null)
  const [pickerMeta, setPickerMeta] = useState({ w: 0, h: 0 })
  const [pickerData, setPickerData] = useState(null) // ImageData
  const [picked, setPicked] = useState(null) // {x,y,r,g,b,a}
  const [hovered, setHovered] = useState(null)

  // Photo censor
  const censorImgRef = useRef(null)
  const censorDragRef = useRef(null)
  const [censorFile, setCensorFile] = useState(null)
  const [censorBeforeUrl, setCensorBeforeUrl] = useState('')
  const [censorOutUrl, setCensorOutUrl] = useState('')
  const [censorOutBlob, setCensorOutBlob] = useState(null)
  const [censorMeta, setCensorMeta] = useState({ w: 0, h: 0 })
  const [censorBoxes, setCensorBoxes] = useState([]) // {id,x,y,w,h,mode}
  const [censorMode, setCensorMode] = useState('pixelate') // pixelate|blur|bar
  const [censorPixel, setCensorPixel] = useState(14)
  const [censorBlur, setCensorBlur] = useState(10)
  const [censorSel, setCensorSel] = useState('')

  // SVG tools
  const [svgTool, setSvgTool] = useState('blob') // blob|pattern|svg2png|img2svg
  const [svgFill, setSvgFill] = useState('#7EE4FF')
  const [svgStroke, _setSvgStroke] = useState('#000000')
  const [svgBg, setSvgBg] = useState('#0B0E14')
  const [svgSize, setSvgSize] = useState(512)
  const [svgComplexity, setSvgComplexity] = useState(8)
  const [svgCode, setSvgCode] = useState('')
  const [svgFile, setSvgFile] = useState(null)
  const [svgScale, setSvgScale] = useState(1024)
  const [svgImgFile, setSvgImgFile] = useState(null)
  const [svgImgWidth, setSvgImgWidth] = useState(640)
  const [svgImgBlock, setSvgImgBlock] = useState(1)
  const [svgImgLevels, setSvgImgLevels] = useState(64)

  // Favicon validator
  const [favFiles, setFavFiles] = useState([])
  const [favResults, setFavResults] = useState([])
  const [favMissing, setFavMissing] = useState([])

  // EXIF viewer/editor (JPEG)
  const [exifFile, setExifFile] = useState(null)
  const [exifBusy, setExifBusy] = useState(false)
  const [exifRows, setExifRows] = useState([])
  const [exifArtist, setExifArtist] = useState('')
  const [exifDesc, setExifDesc] = useState('')
  const [exifCopyright, setExifCopyright] = useState('')
  const [exifDateTime, setExifDateTime] = useState('')

  // GIF frame extractor
  const [gifFile, setGifFile] = useState(null)
  const [gifBusy, setGifBusy] = useState(false)
  const [gifFrames, setGifFrames] = useState([])

  // Sprite animator
  const [spriteFile, setSpriteFile] = useState(null)
  const [spriteBmp, setSpriteBmp] = useState(null)
  const [spriteCols, setSpriteCols] = useState(4)
  const [spriteRows, setSpriteRows] = useState(4)
  const [spriteCount, setSpriteCount] = useState(16)
  const [spriteFps, setSpriteFps] = useState(8)
  const [spritePlaying, setSpritePlaying] = useState(false)
  const spriteCanvasRef = useRef(null)

  useEffect(() => {
    return () => {
      for (const f of gifFrames) {
        if (f.url) URL.revokeObjectURL(f.url)
      }
    }
  }, [gifFrames])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!spriteFile) {
        setSpriteBmp(null)
        return
      }
      try {
        const bmp = await createImageBitmap(spriteFile)
        if (cancelled) return
        setSpriteBmp(bmp)
        const cols = clamp(Math.floor(Number(spriteCols) || 4), 1, 128)
        const rows = clamp(Math.floor(Number(spriteRows) || 4), 1, 128)
        setSpriteCount(Math.max(1, Math.min(cols * rows, Number(spriteCount) || cols * rows)))
      } catch {
        if (!cancelled) setSpriteBmp(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [spriteFile, spriteCols, spriteRows, spriteCount])

  useEffect(() => {
    if (!spriteBmp) return
    const canvas = spriteCanvasRef.current
    if (!canvas) return
    const cols = clamp(Math.floor(Number(spriteCols) || 1), 1, 512)
    const rows = clamp(Math.floor(Number(spriteRows) || 1), 1, 512)
    const frameW = Math.max(1, Math.floor(spriteBmp.width / cols))
    const frameH = Math.max(1, Math.floor(spriteBmp.height / rows))
    canvas.width = frameW
    canvas.height = frameH
    const ctx = canvas.getContext('2d')
    const maxFrames = Math.max(1, Math.min(cols * rows, Math.floor(Number(spriteCount) || cols * rows)))
    const fps = clamp(Number(spriteFps) || 8, 1, 60)
    let raf = 0
    let frame = 0
    let last = 0
    const stepMs = 1000 / fps
    const draw = (index) => {
      const i = index % maxFrames
      const sx = (i % cols) * frameW
      const sy = Math.floor(i / cols) * frameH
      ctx.clearRect(0, 0, frameW, frameH)
      ctx.drawImage(spriteBmp, sx, sy, frameW, frameH, 0, 0, frameW, frameH)
    }
    const tick = (t) => {
      if (!last) last = t
      if (t - last >= stepMs) {
        draw(frame)
        frame = (frame + 1) % maxFrames
        last = t
      }
      if (spritePlaying) raf = requestAnimationFrame(tick)
    }
    draw(0)
    if (spritePlaying) raf = requestAnimationFrame(tick)
    return () => {
      if (raf) cancelAnimationFrame(raf)
    }
  }, [spriteBmp, spriteCols, spriteRows, spriteCount, spriteFps, spritePlaying])

  const accept = useMemo(
    () => ['image/*', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg', '.gif', '.ico'],
    [],
  )

  useEffect(() => {
    return () => {
      if (outUrl) URL.revokeObjectURL(outUrl)
      if (beforeUrl) URL.revokeObjectURL(beforeUrl)
      if (censorBeforeUrl) URL.revokeObjectURL(censorBeforeUrl)
      if (censorOutUrl) URL.revokeObjectURL(censorOutUrl)
    }
  }, [outUrl, beforeUrl, censorBeforeUrl, censorOutUrl])

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current
      if (!d) return
      if (!imgRef.current) return
      e.preventDefault()

      const rect = imgRef.current.getBoundingClientRect()
      const scaleX = imgMeta.w / rect.width
      const scaleY = imgMeta.h / rect.height
      const px = (e.clientX - rect.left) * scaleX
      const py = (e.clientY - rect.top) * scaleY

      const minSize = 20
      const start = d.start
      const dx = px - start.px
      const dy = py - start.py

      let { x, y, w, h } = start.crop

      if (d.mode === 'move') {
        x = start.crop.x + dx
        y = start.crop.y + dy
      } else {
        if (d.mode.includes('w')) {
          x = start.crop.x + dx
          w = start.crop.w - dx
        }
        if (d.mode.includes('e')) {
          w = start.crop.w + dx
        }
        if (d.mode.includes('n')) {
          y = start.crop.y + dy
          h = start.crop.h - dy
        }
        if (d.mode.includes('s')) {
          h = start.crop.h + dy
        }
      }

      w = clamp(w, minSize, imgMeta.w)
      h = clamp(h, minSize, imgMeta.h)
      x = clamp(x, 0, imgMeta.w - w)
      y = clamp(y, 0, imgMeta.h - h)

      setOpts((s) => ({
        ...s,
        crop: {
          ...s.crop,
          enabled: true,
          x: Math.round(x),
          y: Math.round(y),
          w: Math.round(w),
          h: Math.round(h),
        },
      }))
    }

    const onUp = () => {
      dragRef.current = null
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [imgMeta.w, imgMeta.h])

  useEffect(() => {
    // Censor drag handlers
    const onMove = (e) => {
      const d = censorDragRef.current
      if (!d) return
      if (!censorImgRef.current) return
      e.preventDefault()

      const rect = censorImgRef.current.getBoundingClientRect()
      const scaleX = censorMeta.w / rect.width
      const scaleY = censorMeta.h / rect.height
      const px = (e.clientX - rect.left) * scaleX
      const py = (e.clientY - rect.top) * scaleY

      const start = d.start
      const dx = px - start.px
      const dy = py - start.py
      const minSize = 16

      setCensorBoxes((all) => {
        const idx = all.findIndex((b) => b.id === d.id)
        if (idx < 0) return all
        const b0 = all[idx]
        let x = start.box.x
        let y = start.box.y
        let w = start.box.w
        let h = start.box.h

        if (d.mode === 'new') {
          const x1 = clamp(Math.min(start.box.x, start.box.x + dx), 0, censorMeta.w)
          const y1 = clamp(Math.min(start.box.y, start.box.y + dy), 0, censorMeta.h)
          const x2 = clamp(Math.max(start.box.x, start.box.x + dx), 0, censorMeta.w)
          const y2 = clamp(Math.max(start.box.y, start.box.y + dy), 0, censorMeta.h)
          x = x1
          y = y1
          w = Math.max(minSize, x2 - x1)
          h = Math.max(minSize, y2 - y1)
        } else if (d.mode === 'move') {
          x = start.box.x + dx
          y = start.box.y + dy
        } else {
          if (d.mode.includes('w')) {
            x = start.box.x + dx
            w = start.box.w - dx
          }
          if (d.mode.includes('e')) {
            w = start.box.w + dx
          }
          if (d.mode.includes('n')) {
            y = start.box.y + dy
            h = start.box.h - dy
          }
          if (d.mode.includes('s')) {
            h = start.box.h + dy
          }
        }

        w = clamp(w, minSize, censorMeta.w)
        h = clamp(h, minSize, censorMeta.h)
        x = clamp(x, 0, censorMeta.w - w)
        y = clamp(y, 0, censorMeta.h - h)

        const next = all.slice()
        next[idx] = { ...b0, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
        return next
      })
    }
    const onUp = () => {
      censorDragRef.current = null
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [censorMeta.w, censorMeta.h])

  useEffect(() => {
    const t = searchParams.get('tool')
    if (t && TOOLS.some((x) => x.id === t)) setActiveTool(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p)
      next.set('tool', activeTool)
      return next
    })
    const t = TOOLS.find((x) => x.id === activeTool)
    if (t) {
      addRecent({
        key: toolKey('image', activeTool),
        label: `Image: ${t.label}`,
        path: `/image?tool=${activeTool}`,
        tool: activeTool,
      })
      window.dispatchEvent(new Event('oct:prefs'))
    }
  }, [activeTool, setSearchParams])

  function ensureCropDefaults() {
    if (!imgMeta.w || !imgMeta.h) return
    setOpts((s) => {
      const c = s.crop || {}
      if (c.w > 0 && c.h > 0) return s
      const w = Math.round(imgMeta.w * 0.8)
      const h = Math.round(imgMeta.h * 0.8)
      const x = Math.round((imgMeta.w - w) / 2)
      const y = Math.round((imgMeta.h - h) / 2)
      return { ...s, crop: { ...c, enabled: true, x, y, w, h } }
    })
  }

  function startDrag(mode, e) {
    if (!opts.crop.enabled) return
    if (!imgRef.current) return
    e.preventDefault()
    e.stopPropagation()

    const rect = imgRef.current.getBoundingClientRect()
    const scaleX = imgMeta.w / rect.width
    const scaleY = imgMeta.h / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top) * scaleY

    dragRef.current = {
      mode,
      start: {
        px,
        py,
        crop: { x: opts.crop.x, y: opts.crop.y, w: opts.crop.w, h: opts.crop.h },
      },
    }
  }

  function ensureWorker() {
    if (workerRef.current) return workerRef.current
    const w = new Worker(new URL('../../workers/image.worker.js', import.meta.url), {
      type: 'module',
    })
    w.onmessage = (e) => {
      const msg = e.data || {}
      if (msg.type === 'progress') setProgress(msg.value || 0)
      if (msg.type === 'error') {
        setBusy(false)
        setLastError(msg.message || 'Worker error.')
      }
    }
    workerRef.current = w
    return w
  }

  function onFiles(nextFiles) {
    setLastError('')
    setFiles(nextFiles)
    setProgress(0)
    setBusy(false)
  }

  function reset() {
    setFiles([])
    setBusy(false)
    setProgress(0)
    setLastError('')
    setSingleFile(null)
    setOutBlob(null)
    if (outUrl) URL.revokeObjectURL(outUrl)
    if (beforeUrl) URL.revokeObjectURL(beforeUrl)
    setOutUrl('')
    setBeforeUrl('')
    if (censorBeforeUrl) URL.revokeObjectURL(censorBeforeUrl)
    if (censorOutUrl) URL.revokeObjectURL(censorOutUrl)
    setCensorBeforeUrl('')
    setCensorOutUrl('')
    setCensorOutBlob(null)
    setCensorFile(null)
    setCensorBoxes([])
    setCensorSel('')
  }

  async function runSingle() {
    if (!singleFile) return
    setLastError('')
    setBusy(true)
    setProgress(0)
    setOutBlob(null)

    try {
      const before = URL.createObjectURL(singleFile)
      if (beforeUrl) URL.revokeObjectURL(beforeUrl)
      setBeforeUrl(before)

      const blob = await processImageFile(singleFile, {
        ...opts,
        watermarkImage: wmImageFile
          ? { ...opts.watermarkImage, file: wmImageFile }
          : null,
      })
      setOutBlob(blob)
      const url = URL.createObjectURL(blob)
      if (outUrl) URL.revokeObjectURL(outUrl)
      setOutUrl(url)
      setProgress(1)
    } catch (e) {
      setLastError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function runBulkWorkerZip() {
    if (!files.length) return
    setLastError('')
    setBusy(true)
    setProgress(0)
    try {
      const wmImgPayload = wmImageFile
        ? {
            data: await wmImageFile.arrayBuffer(),
            type: wmImageFile.type,
          }
        : null

      const items = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          type: f.type,
          data: await f.arrayBuffer(),
          options: {
            ...opts,
            // Manual crop is single-image only (interactive); disable for bulk.
            crop: { enabled: false, x: 0, y: 0, w: 0, h: 0 },
            watermarkImage: wmImgPayload
              ? { ...opts.watermarkImage, ...wmImgPayload }
              : null,
          },
        })),
      )

      const results = []
      const w = ensureWorker()
      await new Promise((resolve, reject) => {
        let done = false
        const onMessage = (e) => {
          const msg = e.data || {}
          if (msg.type === 'item') {
            const outBlob = new Blob([msg.ab], { type: msg.outType || opts.output.type })
            results.push({
              name: replaceExt(msg.name, extFromMime(outBlob.type)),
              blob: outBlob,
            })
          } else if (msg.type === 'done') {
            done = true
            w.removeEventListener('message', onMessage)
            resolve()
          } else if (msg.type === 'error') {
            w.removeEventListener('message', onMessage)
            reject(new Error(msg.message || 'Worker error.'))
          }
        }
        w.addEventListener('message', onMessage)
        w.postMessage({ type: 'process-bulk', items }, items.map((i) => i.data))
        // Note: transfer list only includes ArrayBuffers; worker can read them.
        // If we fail to transfer on some browser, it still works (structured clone).
        setTimeout(() => {
          if (!done) return
        }, 0)
      })

      const zip = await zipBlobs(results)
      downloadBlob(zip, `images-${Date.now()}.zip`)
      setProgress(1)
    } catch (e) {
      setLastError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function imageToPdf() {
    if (!files.length) return
    setLastError('')
    setBusy(true)
    setProgress(0)
    try {
      const { PDFDocument } = await import('pdf-lib')
      const pdf = await PDFDocument.create()
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        // Normalize by rendering to PNG via our pipeline to strip metadata and ensure embed works.
        const pngBlob = await processImageFile(f, {
          output: { type: 'image/png', quality: 0.92, jpegBackground: '#ffffff' },
          resize: { enabled: false },
          rotate: { degrees: 0 },
          flip: { h: false, v: false },
          filters: { grayscale: 0, blur: 0, brightness: 100, contrast: 100, saturation: 100 },
          sharpen: { strength: 0 },
          watermarkText: { text: '' },
          watermarkImage: null,
        })
        const bytes = new Uint8Array(await pngBlob.arrayBuffer())
        const embedded = await pdf.embedPng(bytes)
        const page = pdf.addPage([embedded.width, embedded.height])
        page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height })
        setProgress((i + 1) / Math.max(1, files.length))
      }
      const out = await pdf.save()
      downloadBlob(new Blob([out], { type: 'application/pdf' }), `images-${Date.now()}.pdf`)
      setProgress(1)
    } catch (e) {
      setLastError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function fromBase64ToDownload() {
    const t = String(opts?.base64Text || '').trim()
    if (!t) return
    setLastError('')
    try {
      const m = t.match(/^data:([^;]+);base64,(.+)$/)
      const mime = m ? m[1] : 'application/octet-stream'
      const b64 = m ? m[2] : t
      const bin = atob(b64.replace(/\s+/g, ''))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      downloadBlob(new Blob([bytes], { type: mime }), `from-base64-${Date.now()}`)
    } catch {
      setLastError('Invalid Base64 input.')
    }
  }

  async function runFaviconValidate() {
    if (!favFiles.length) return
    setLastError('')
    setBusy(true)
    try {
      const out = []
      const present = new Set()
      for (const f of favFiles) {
        try {
          const bmp = await createImageBitmap(f)
          const w = bmp.width
          const h = bmp.height
          const square = w === h
          if (square) present.add(w)
          out.push({
            name: f.name,
            type: f.type || 'unknown',
            size: f.size,
            width: w,
            height: h,
            ok: square && [16, 32, 48, 180, 192, 512].includes(w),
          })
        } catch {
          out.push({
            name: f.name,
            type: f.type || 'unknown',
            size: f.size,
            width: 0,
            height: 0,
            ok: false,
            error: 'Could not decode image in browser',
          })
        }
      }
      const required = [16, 32, 48, 180, 192, 512]
      setFavResults(out)
      setFavMissing(required.filter((s) => !present.has(s)))
    } catch (e) {
      setLastError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function loadExif() {
    if (!exifFile) return
    setLastError('')
    setExifBusy(true)
    try {
      const lower = exifFile.name.toLowerCase()
      const isJpeg = exifFile.type === 'image/jpeg' || lower.endsWith('.jpg') || lower.endsWith('.jpeg')
      if (!isJpeg) throw new Error('EXIF editor currently supports JPEG files.')
      const dataUrl = await toDataUrl(exifFile)
      const mod = await import('piexifjs')
      const piexif = mod.default || mod
      const ex = piexif.load(dataUrl)
      const rows = []
      for (const ifd of ['0th', 'Exif', 'GPS', 'Interop', '1st']) {
        const map = ex[ifd] || {}
        for (const [k, v] of Object.entries(map)) {
          const tag = Number(k)
          const name = piexif.TAGS?.[ifd]?.[tag]?.name || String(tag)
          let value
          if (typeof v === 'string' || typeof v === 'number') value = String(v)
          else value = JSON.stringify(v)
          rows.push({ ifd, tag: name, value })
        }
      }
      setExifRows(rows)
      setExifArtist(String(ex?.['0th']?.[piexif.ImageIFD.Artist] || ''))
      setExifDesc(String(ex?.['0th']?.[piexif.ImageIFD.ImageDescription] || ''))
      setExifCopyright(String(ex?.['0th']?.[piexif.ImageIFD.Copyright] || ''))
      setExifDateTime(String(ex?.['0th']?.[piexif.ImageIFD.DateTime] || ex?.Exif?.[piexif.ExifIFD.DateTimeOriginal] || ''))
    } catch (e) {
      setLastError(e?.message || String(e))
      setExifRows([])
    } finally {
      setExifBusy(false)
    }
  }

  async function applyExifEdits() {
    if (!exifFile) return
    setLastError('')
    setExifBusy(true)
    try {
      const mod = await import('piexifjs')
      const piexif = mod.default || mod
      const dataUrl = await toDataUrl(exifFile)
      const ex = piexif.load(dataUrl)
      ex['0th'] = ex['0th'] || {}
      ex.Exif = ex.Exif || {}

      const putOrDelete = (ifd, tag, val) => {
        const t = String(val || '').trim()
        if (t) ifd[tag] = t
        else delete ifd[tag]
      }
      putOrDelete(ex['0th'], piexif.ImageIFD.Artist, exifArtist)
      putOrDelete(ex['0th'], piexif.ImageIFD.ImageDescription, exifDesc)
      putOrDelete(ex['0th'], piexif.ImageIFD.Copyright, exifCopyright)
      putOrDelete(ex['0th'], piexif.ImageIFD.DateTime, exifDateTime)
      putOrDelete(ex.Exif, piexif.ExifIFD.DateTimeOriginal, exifDateTime)

      const exifBytes = piexif.dump(ex)
      const nextDataUrl = piexif.insert(exifBytes, dataUrl)
      const outBlob = dataUrlToBlob(nextDataUrl)
      downloadBlob(outBlob, replaceExt(exifFile.name || 'image', 'jpg'))
      await loadExif()
    } catch (e) {
      setLastError(e?.message || String(e))
    } finally {
      setExifBusy(false)
    }
  }

  async function stripExifNow() {
    if (!exifFile) return
    setLastError('')
    setExifBusy(true)
    try {
      const mod = await import('piexifjs')
      const piexif = mod.default || mod
      const dataUrl = await toDataUrl(exifFile)
      const stripped = piexif.remove(dataUrl)
      const outBlob = dataUrlToBlob(stripped)
      downloadBlob(outBlob, replaceExt(exifFile.name || 'image', 'jpg'))
    } catch (e) {
      setLastError(e?.message || String(e))
    } finally {
      setExifBusy(false)
    }
  }

  async function extractGifFrames() {
    if (!gifFile) return
    setLastError('')
    setGifBusy(true)
    setProgress(0)
    try {
      if (!('ImageDecoder' in window)) throw new Error('Your browser does not support ImageDecoder for GIF extraction.')
      for (const f of gifFrames) {
        if (f.url) URL.revokeObjectURL(f.url)
      }
      setGifFrames([])
      const ab = await gifFile.arrayBuffer()
      const Decoder = window.ImageDecoder
      const dec = new Decoder({ data: ab, type: 'image/gif' })
      const count = dec.tracks.selectedTrack?.frameCount || 0
      if (!count) throw new Error('No frames found.')
      const max = Math.min(count, 300)
      const entries = []
      for (let i = 0; i < max; i++) {
        const res = await dec.decode({ frameIndex: i })
        const frame = res.image
        const c = document.createElement('canvas')
        c.width = frame.displayWidth || frame.codedWidth
        c.height = frame.displayHeight || frame.codedHeight
        const ctx = c.getContext('2d')
        ctx.drawImage(frame, 0, 0)
        const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
        entries.push({
          index: i + 1,
          name: `frame-${String(i + 1).padStart(4, '0')}.png`,
          blob,
          url: URL.createObjectURL(blob),
        })
        setProgress((i + 1) / Math.max(1, max))
      }
      setGifFrames(entries)
      setProgress(1)
    } catch (e) {
      setLastError(e?.message || String(e))
    } finally {
      setGifBusy(false)
    }
  }

  async function downloadGifFramesZip() {
    if (!gifFrames.length) return
    const zip = await zipBlobs(gifFrames.map((f) => ({ name: f.name, blob: f.blob })))
    downloadBlob(zip, `gif-frames-${Date.now()}.zip`)
  }

  async function exportSpriteFramesZip() {
    if (!spriteBmp) return
    setLastError('')
    setBusy(true)
    setProgress(0)
    try {
      const cols = clamp(Math.floor(Number(spriteCols) || 1), 1, 512)
      const rows = clamp(Math.floor(Number(spriteRows) || 1), 1, 512)
      const frameW = Math.max(1, Math.floor(spriteBmp.width / cols))
      const frameH = Math.max(1, Math.floor(spriteBmp.height / rows))
      const maxFrames = Math.max(1, Math.min(cols * rows, Math.floor(Number(spriteCount) || cols * rows)))
      const entries = []
      for (let i = 0; i < maxFrames; i++) {
        const sx = (i % cols) * frameW
        const sy = Math.floor(i / cols) * frameH
        const c = document.createElement('canvas')
        c.width = frameW
        c.height = frameH
        const ctx = c.getContext('2d')
        ctx.drawImage(spriteBmp, sx, sy, frameW, frameH, 0, 0, frameW, frameH)
        const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
        entries.push({ name: `sprite-frame-${String(i + 1).padStart(4, '0')}.png`, blob })
        setProgress((i + 1) / Math.max(1, maxFrames))
      }
      const zip = await zipBlobs(entries)
      downloadBlob(zip, `sprite-frames-${Date.now()}.zip`)
      setProgress(1)
    } catch (e) {
      setLastError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  function rgbToHex(r, g, b) {
    const rr = clamp(Math.round(r), 0, 255).toString(16).padStart(2, '0')
    const gg = clamp(Math.round(g), 0, 255).toString(16).padStart(2, '0')
    const bb = clamp(Math.round(b), 0, 255).toString(16).padStart(2, '0')
    return ('#' + rr + gg + bb).toUpperCase()
  }

  async function analyzeColors() {
    if (!colorFile) return
    setLastError('')
    setColorBusy(true)
    try {
      const bmp = await createImageBitmap(colorFile)
      const max = 220
      const scale = Math.min(1, max / Math.max(1, bmp.width, bmp.height))
      const w = Math.max(1, Math.round(bmp.width * scale))
      const h = Math.max(1, Math.round(bmp.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bmp, 0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      const data = img.data

      const samples = []
      let sumR = 0
      let sumG = 0
      let sumB = 0
      let count = 0
      const step = Math.max(1, Math.floor((w * h) / 5000))
      for (let i = 0; i < data.length; i += 4 * step) {
        const a = data[i + 3]
        if (a < 16) continue
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        sumR += r
        sumG += g
        sumB += b
        count++
        samples.push([r, g, b])
      }
      if (!count) throw new Error('No opaque pixels found.')
      const avg = { r: sumR / count, g: sumG / count, b: sumB / count }

      // K-means for dominant colors (small + fast).
      const k = clamp(Math.floor(Number(paletteN) || 8), 2, 16)
      const pts = samples.length > 6000 ? samples.slice(0, 6000) : samples
      // Init centers from evenly spaced samples.
      const centers = []
      for (let i = 0; i < k; i++) {
        const p = pts[Math.floor((i / k) * (pts.length - 1))]
        centers.push([p[0], p[1], p[2]])
      }

      let assign = new Array(pts.length).fill(0)
      for (let iter = 0; iter < 10; iter++) {
        // assign
        for (let i = 0; i < pts.length; i++) {
          const [r, g, b] = pts[i]
          let best = 0
          let bestD = Infinity
          for (let c = 0; c < centers.length; c++) {
            const dr = r - centers[c][0]
            const dg = g - centers[c][1]
            const db = b - centers[c][2]
            const d = dr * dr + dg * dg + db * db
            if (d < bestD) {
              bestD = d
              best = c
            }
          }
          assign[i] = best
        }

        // update
        const sums = Array.from({ length: k }, () => ({ r: 0, g: 0, b: 0, n: 0 }))
        for (let i = 0; i < pts.length; i++) {
          const a = assign[i]
          const p = pts[i]
          sums[a].r += p[0]
          sums[a].g += p[1]
          sums[a].b += p[2]
          sums[a].n++
        }
        for (let c = 0; c < k; c++) {
          if (!sums[c].n) continue
          centers[c][0] = sums[c].r / sums[c].n
          centers[c][1] = sums[c].g / sums[c].n
          centers[c][2] = sums[c].b / sums[c].n
        }
      }

      const counts = Array.from({ length: k }, () => 0)
      for (const a of assign) counts[a]++
      const palette = centers
        .map((c, i) => ({ hex: rgbToHex(c[0], c[1], c[2]), count: counts[i] }))
        .sort((a, b) => b.count - a.count)

      setColorStats({
        avgHex: rgbToHex(avg.r, avg.g, avg.b),
        palette,
      })
    } catch (e) {
      setLastError(e?.message || String(e))
      setColorStats(null)
    } finally {
      setColorBusy(false)
    }
  }

  async function loadPickerFile(f) {
    setLastError('')
    setPickerFile(f)
    setPicked(null)
    setHovered(null)
    setPickerData(null)
    if (!f) return
    try {
      const bmp = await createImageBitmap(f)
      setPickerMeta({ w: bmp.width, h: bmp.height })
      const maxW = 900
      const scale = Math.min(1, maxW / Math.max(1, bmp.width))
      const cw = Math.max(1, Math.round(bmp.width * scale))
      const ch = Math.max(1, Math.round(bmp.height * scale))
      const canvas = pickerCanvasRef.current
      if (!canvas) return
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bmp, 0, 0, cw, ch)
      const img = ctx.getImageData(0, 0, cw, ch)
      setPickerData(img)
    } catch {
      setLastError('Failed to load image for picker.')
    }
  }

  function samplePickerAt(clientX, clientY, commit) {
    const canvas = pickerCanvasRef.current
    if (!canvas || !pickerData) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor(((clientX - rect.left) / rect.width) * canvas.width)
    const y = Math.floor(((clientY - rect.top) / rect.height) * canvas.height)
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return
    const i = (y * canvas.width + x) * 4
    const r = pickerData.data[i]
    const g = pickerData.data[i + 1]
    const b = pickerData.data[i + 2]
    const a = pickerData.data[i + 3]
    const p = { x, y, r, g, b, a }
    if (commit) setPicked(p)
    else setHovered(p)
  }

  function startCensorDrag(mode, id, e) {
    if (!censorImgRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const rect = censorImgRef.current.getBoundingClientRect()
    const scaleX = censorMeta.w / rect.width
    const scaleY = censorMeta.h / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top) * scaleY

    const b = censorBoxes.find((x) => x.id === id)
    if (!b) return
    censorDragRef.current = {
      mode,
      id,
      start: { px, py, box: { ...b } },
    }
  }

  function startNewCensor(e) {
    if (!censorImgRef.current) return
    if (!censorMeta.w || !censorMeta.h) return
    e.preventDefault()
    const rect = censorImgRef.current.getBoundingClientRect()
    const scaleX = censorMeta.w / rect.width
    const scaleY = censorMeta.h / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top) * scaleY
    const id = `b_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const box = { id, x: Math.round(clamp(px, 0, censorMeta.w - 1)), y: Math.round(clamp(py, 0, censorMeta.h - 1)), w: 24, h: 24, mode: censorMode }
    setCensorBoxes((s) => s.concat([box]))
    setCensorSel(id)
    censorDragRef.current = { mode: 'new', id, start: { px, py, box } }
  }

  async function applyCensor() {
    if (!censorFile) return
    setLastError('')
    setBusy(true)
    setProgress(0)
    try {
      const bmp = await createImageBitmap(censorFile)
      const canvas = document.createElement('canvas')
      canvas.width = bmp.width
      canvas.height = bmp.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bmp, 0, 0)

      for (let i = 0; i < censorBoxes.length; i++) {
        const b = censorBoxes[i]
        const x = clamp(Math.round(b.x), 0, canvas.width - 1)
        const y = clamp(Math.round(b.y), 0, canvas.height - 1)
        const w = clamp(Math.round(b.w), 1, canvas.width - x)
        const h = clamp(Math.round(b.h), 1, canvas.height - y)

        if (b.mode === 'bar') {
          ctx.fillStyle = '#000000'
          ctx.fillRect(x, y, w, h)
        } else if (b.mode === 'blur') {
          ctx.save()
          ctx.filter = `blur(${clamp(Number(censorBlur) || 10, 1, 40)}px)`
          ctx.drawImage(bmp, x, y, w, h, x, y, w, h)
          ctx.restore()
        } else {
          // pixelate
          const px = clamp(Math.round(Number(censorPixel) || 14), 2, 80)
          const tw = Math.max(1, Math.round(w / px))
          const th = Math.max(1, Math.round(h / px))
          const tmp = document.createElement('canvas')
          tmp.width = tw
          tmp.height = th
          const tctx = tmp.getContext('2d')
          tctx.imageSmoothingEnabled = true
          tctx.imageSmoothingQuality = 'low'
          tctx.drawImage(bmp, x, y, w, h, 0, 0, tw, th)
          ctx.save()
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(tmp, 0, 0, tw, th, x, y, w, h)
          ctx.restore()
        }

        setProgress((i + 1) / Math.max(1, censorBoxes.length))
      }

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Failed to export PNG.')
      setCensorOutBlob(blob)
      const url = URL.createObjectURL(blob)
      if (censorOutUrl) URL.revokeObjectURL(censorOutUrl)
      setCensorOutUrl(url)
      setProgress(1)
    } catch (e) {
      setLastError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  function genSvgBlob() {
    const size = clamp(Math.round(Number(svgSize) || 512), 64, 2048)
    const n = clamp(Math.round(Number(svgComplexity) || 8), 4, 16)
    const pts = []
    const cx = size / 2
    const cy = size / 2
    const r = size * 0.38
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const jitter = (crypto.getRandomValues(new Uint8Array(1))[0] / 255 - 0.5) * 0.55
      const rr = r * (1 + jitter)
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr])
    }
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i]
      const p2 = pts[(i + 1) % pts.length]
      const midX = (p1[0] + p2[0]) / 2
      const midY = (p1[1] + p2[1]) / 2
      d += ` Q ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`
    }
    d += ' Z'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">\n  <rect width="${size}" height="${size}" fill="${svgBg}"/>\n  <path d="${d}" fill="${svgFill}" stroke="${svgStroke}" stroke-width="0"/>\n</svg>\n`
    setSvgCode(svg)
  }

  function genSvgPattern() {
    const size = clamp(Math.round(Number(svgSize) || 512), 64, 2048)
    const cell = clamp(Math.round(Number(svgComplexity) || 8), 4, 64)
    const step = Math.round(size / cell)
    const dot = Math.max(2, Math.round(step * 0.18))
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">\n  <defs>\n    <pattern id="p" width="${step}" height="${step}" patternUnits="userSpaceOnUse">\n      <circle cx="${Math.round(step / 2)}" cy="${Math.round(step / 2)}" r="${dot}" fill="${svgFill}" opacity="0.9"/>\n    </pattern>\n  </defs>\n  <rect width="${size}" height="${size}" fill="${svgBg}"/>\n  <rect width="${size}" height="${size}" fill="url(#p)"/>\n</svg>\n`
    setSvgCode(svg)
  }

  async function downloadSvgAsPng() {
    if (!svgFile) return
    setLastError('')
    setBusy(true)
    setProgress(0)
    try {
      const raw = await svgFile.text()
      const blob = new Blob([raw], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const img = new Image()
      const sizePx = clamp(Math.round(Number(svgScale) || 1024), 64, 4096)
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = url
      })
      const canvas = document.createElement('canvas')
      const scale = sizePx / Math.max(1, img.width)
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!png) throw new Error('Failed to export PNG.')
      downloadBlob(png, replaceExt(svgFile.name || 'image.svg', 'png'))
      setProgress(1)
    } catch {
      setLastError('SVG to PNG failed. (Some SVGs reference external assets or unsupported features.)')
    } finally {
      setBusy(false)
    }
  }

  async function convertImageToSvg() {
    if (!svgImgFile) return
    setLastError('')
    setBusy(true)
    setProgress(0)
    try {
      const bmp = await createImageBitmap(svgImgFile)
      const targetW = clamp(Math.round(Number(svgImgWidth) || 640), 64, 2048)
      const scale = targetW / Math.max(1, bmp.width)
      const targetH = Math.max(1, Math.round(bmp.height * scale))
      const block = clamp(Math.round(Number(svgImgBlock) || 8), 1, 64)
      const levels = clamp(Math.round(Number(svgImgLevels) || 16), 2, 64)

      const canvas = document.createElement('canvas')
      canvas.width = targetW
      canvas.height = targetH
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bmp, 0, 0, targetW, targetH)
      const data = ctx.getImageData(0, 0, targetW, targetH).data

      const cellsX = Math.ceil(targetW / block)
      const cellsY = Math.ceil(targetH / block)
      const maxCells = block === 1 ? 420000 : 28000
      if (cellsX * cellsY > maxCells) throw new Error('Output too large. Increase block size or reduce width.')

      const qChan = (v) => {
        const t = Math.round((v / 255) * (levels - 1))
        return Math.round((t / (levels - 1)) * 255)
      }
      const hex = (r, g, b) =>
        `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`

      const rects = []
      if (block === 1) {
        // High-fidelity path: one-pixel sampling with run merging per row to reduce SVG size.
        for (let y = 0; y < targetH; y++) {
          let runX = 0
          let runFill = ''
          let runAlpha = 1
          let hasRun = false
          const flushRun = (xEnd) => {
            if (!hasRun) return
            const runW = xEnd - runX
            if (runW <= 0) return
            rects.push(
              runAlpha >= 0.995
                ? `<rect x="${runX}" y="${y}" width="${runW}" height="1" fill="${runFill}"/>`
                : `<rect x="${runX}" y="${y}" width="${runW}" height="1" fill="${runFill}" fill-opacity="${runAlpha}"/>`,
            )
            hasRun = false
          }

          for (let x = 0; x < targetW; x++) {
            const i = (y * targetW + x) * 4
            const a = data[i + 3] / 255
            if (a < 0.02) {
              flushRun(x)
              continue
            }
            const fill = hex(qChan(data[i]), qChan(data[i + 1]), qChan(data[i + 2]))
            const alpha = Math.round(a * 1000) / 1000
            if (!hasRun) {
              runX = x
              runFill = fill
              runAlpha = alpha
              hasRun = true
              continue
            }
            if (fill !== runFill || Math.abs(alpha - runAlpha) > 0.0001) {
              flushRun(x)
              runX = x
              runFill = fill
              runAlpha = alpha
              hasRun = true
            }
          }
          flushRun(targetW)
          setProgress((y + 1) / Math.max(1, targetH))
        }
      } else {
        for (let by = 0; by < targetH; by += block) {
          for (let bx = 0; bx < targetW; bx += block) {
            const bw = Math.min(block, targetW - bx)
            const bh = Math.min(block, targetH - by)
            let sr = 0
            let sg = 0
            let sb = 0
            let sa = 0
            let c = 0
            for (let y = 0; y < bh; y++) {
              for (let x = 0; x < bw; x++) {
                const i = ((by + y) * targetW + (bx + x)) * 4
                sr += data[i]
                sg += data[i + 1]
                sb += data[i + 2]
                sa += data[i + 3]
                c++
              }
            }
            if (!c) continue
            const a = sa / (255 * c)
            if (a < 0.02) continue
            const r = qChan(Math.round(sr / c))
            const g = qChan(Math.round(sg / c))
            const b = qChan(Math.round(sb / c))
            const alpha = Math.round(a * 1000) / 1000
            rects.push(
              alpha >= 0.995
                ? `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${hex(r, g, b)}"/>`
                : `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${hex(r, g, b)}" fill-opacity="${alpha}"/>`,
            )
          }
          setProgress((by + block) / Math.max(1, targetH))
        }
      }

      const shapeRendering = block > 1 ? 'crispEdges' : 'geometricPrecision'
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}" viewBox="0 0 ${targetW} ${targetH}" shape-rendering="${shapeRendering}">\n${rects.join('\n')}\n</svg>\n`
      setSvgCode(svg)
      setProgress(1)
    } catch (e) {
      setLastError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>Image Tools</h1>
        <p className="muted">
          Convert, resize/crop, compress, apply filters/sharpen, watermark, Base64, and export.
          All processing stays on your device.
        </p>
      </div>

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Tools</h2>
          <div className="row">
            <ToolTabs tools={TOOLS} activeId={activeTool} onChange={setActiveTool} />
            <FavoriteButton
              entry={{
                key: toolKey('image', activeTool),
                label: `Image: ${TOOLS.find((x) => x.id === activeTool)?.label || activeTool}`,
                path: `/image?tool=${activeTool}`,
                tool: activeTool,
              }}
            />
          </div>
        </div>
        <p className="muted">
          Note: exporting via Canvas strips EXIF/metadata by design (privacy-first).
        </p>
      </section>

      {activeTool === 'edit' ? (
        <section className="panel">
          <h2>Edit/Convert (Single)</h2>
          <div className="two">
            <div className="field">
              <label>Pick one image</label>
              <input
                className="input"
                type="file"
                accept={accept.join(',')}
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null
                  setSingleFile(f)
                  setOutBlob(null)
                  setProgress(0)
                  setLastError('')
                  setImgMeta({ w: 0, h: 0 })
                  setOpts((s) => ({ ...s, crop: { enabled: false, x: 0, y: 0, w: 0, h: 0 } }))
                }}
              />
              <div className="muted">
                Tip: rotate by 90/180/270 for lossless orientation changes (pixels are still re-encoded).
              </div>
            </div>

            <div className="field">
              <label>Output format</label>
              <select
                className="select"
                value={opts.output.type}
                disabled={busy}
                onChange={(e) => setOpts((s) => ({ ...s, output: { ...s.output, type: e.target.value } }))}
              >
                {outputFormats.map((f) => (
                  <option key={f.mime} value={f.mime}>{f.label}</option>
                ))}
              </select>
              <div className="muted" style={{ fontSize: 12 }}>
                Shown formats are supported by your current browser.
              </div>
              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Quality (JPG/WEBP/AVIF)</label>
                  <input
                    className="input"
                    type="range"
                    min="0.05"
                    max="1"
                    step="0.01"
                    value={opts.output.quality}
                    disabled={busy}
                    onChange={(e) =>
                      setOpts((s) => ({
                        ...s,
                        output: { ...s.output, quality: Number(e.target.value) },
                      }))
                    }
                  />
                </div>
                <div className="field" style={{ width: 120 }}>
                  <label>BG (JPG)</label>
                  <input
                    className="input"
                    type="color"
                    value={opts.output.jpegBackground}
                    disabled={busy}
                    onChange={(e) => setOpts((s) => ({ ...s, output: { ...s.output, jpegBackground: e.target.value } }))}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="two">
            <div className="panel" style={{ padding: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="mono muted">Resize</div>
                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={opts.resize.enabled}
                    disabled={busy}
                    onChange={(e) => setOpts((s) => ({ ...s, resize: { ...s.resize, enabled: e.target.checked } }))}
                  />
                  <span className="muted">Enable</span>
                </label>
              </div>
              <div className="two">
                <div className="field">
                  <label>Width</label>
                  <input
                    className="input"
                    type="number"
                    value={opts.resize.width}
                    disabled={busy || !opts.resize.enabled}
                    onChange={(e) => setOpts((s) => ({ ...s, resize: { ...s.resize, width: Number(e.target.value) } }))}
                  />
                </div>
                <div className="field">
                  <label>Height</label>
                  <input
                    className="input"
                    type="number"
                    value={opts.resize.height}
                    disabled={busy || !opts.resize.enabled}
                    onChange={(e) => setOpts((s) => ({ ...s, resize: { ...s.resize, height: Number(e.target.value) } }))}
                  />
                </div>
              </div>
              <div className="field">
                <label>Mode</label>
                <select
                  className="select"
                  value={opts.resize.mode}
                  disabled={busy || !opts.resize.enabled}
                  onChange={(e) => setOpts((s) => ({ ...s, resize: { ...s.resize, mode: e.target.value } }))}
                >
                  <option value="contain">Contain (fit)</option>
                  <option value="cover">Cover (crop)</option>
                  <option value="exact">Exact (stretch)</option>
                </select>
              </div>
            </div>

            <div className="panel" style={{ padding: 14 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="mono muted">Manual Crop</div>
                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!opts.crop.enabled}
                    disabled={busy || !singleFile}
                    onChange={(e) => {
                      const en = e.target.checked
                      setOpts((s) => ({
                        ...s,
                        crop: { ...s.crop, enabled: en },
                      }))
                      if (en) setTimeout(() => ensureCropDefaults(), 0)
                    }}
                  />
                  <span className="muted">Enable</span>
                </label>
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                Drag handles on the preview. Crop applies before resize.
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={busy || !singleFile}
                  onClick={() => {
                    setOpts((s) => ({
                      ...s,
                      crop: { enabled: false, x: 0, y: 0, w: 0, h: 0 },
                    }))
                  }}
                >
                  Disable crop
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={busy || !singleFile}
                  onClick={() => ensureCropDefaults()}
                >
                  Reset crop box
                </button>
              </div>
              {opts.crop.enabled && imgMeta.w ? (
                <div className="muted mono" style={{ marginTop: 10 }}>
                  x:{opts.crop.x} y:{opts.crop.y} w:{opts.crop.w} h:{opts.crop.h}
                </div>
              ) : null}
            </div>
          </div>

          <div className="two">
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>
                Rotate/Flip
              </div>
              <div className="two">
                <div className="field">
                  <label>Rotate (degrees)</label>
                  <input
                    className="input"
                    type="number"
                    value={opts.rotate.degrees}
                    disabled={busy}
                    onChange={(e) => setOpts((s) => ({ ...s, rotate: { degrees: Number(e.target.value) } }))}
                  />
                </div>
                <div className="field">
                  <label>Quick rotate</label>
                  <div className="row">
                    {[0, 90, 180, 270].map((d) => (
                      <button
                        key={d}
                        type="button"
                        className="button button--ghost"
                        disabled={busy}
                        onClick={() => setOpts((s) => ({ ...s, rotate: { degrees: d } }))}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={opts.flip.h}
                    disabled={busy}
                    onChange={(e) => setOpts((s) => ({ ...s, flip: { ...s.flip, h: e.target.checked } }))}
                  />
                  <span className="muted">Flip horizontal</span>
                </label>
                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={opts.flip.v}
                    disabled={busy}
                    onChange={(e) => setOpts((s) => ({ ...s, flip: { ...s.flip, v: e.target.checked } }))}
                  />
                  <span className="muted">Flip vertical</span>
                </label>
              </div>
            </div>

            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>
                Crop Fine-Tune (pixels)
              </div>
              <div className="two">
                <div className="field">
                  <label>X</label>
                  <input
                    className="input"
                    type="number"
                    value={opts.crop.x}
                    disabled={busy || !opts.crop.enabled}
                    onChange={(e) => setOpts((s) => ({ ...s, crop: { ...s.crop, x: Number(e.target.value) } }))}
                  />
                </div>
                <div className="field">
                  <label>Y</label>
                  <input
                    className="input"
                    type="number"
                    value={opts.crop.y}
                    disabled={busy || !opts.crop.enabled}
                    onChange={(e) => setOpts((s) => ({ ...s, crop: { ...s.crop, y: Number(e.target.value) } }))}
                  />
                </div>
              </div>
              <div className="two">
                <div className="field">
                  <label>W</label>
                  <input
                    className="input"
                    type="number"
                    value={opts.crop.w}
                    disabled={busy || !opts.crop.enabled}
                    onChange={(e) => setOpts((s) => ({ ...s, crop: { ...s.crop, w: Number(e.target.value) } }))}
                  />
                </div>
                <div className="field">
                  <label>H</label>
                  <input
                    className="input"
                    type="number"
                    value={opts.crop.h}
                    disabled={busy || !opts.crop.enabled}
                    onChange={(e) => setOpts((s) => ({ ...s, crop: { ...s.crop, h: Number(e.target.value) } }))}
                  />
                </div>
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                Tip: enable crop first to initialize a box.
              </p>
            </div>
          </div>

          <div className="two">
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>
                Filters
              </div>
              <div className="field">
                <label>Preset (approx)</label>
                <select
                  className="select"
                  value={filterPreset}
                  disabled={busy}
                  onChange={(e) => {
                    const id = e.target.value
                    setFilterPreset(id)
                    const p = FILTER_PRESETS.find((x) => x.id === id)
                    if (!p || !p.f) return
                    setOpts((s) => ({
                      ...s,
                      filters: { ...s.filters, ...p.f },
                      sharpen: { strength: p.sharpen ?? s.sharpen?.strength ?? 0 },
                    }))
                  }}
                >
                  {FILTER_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              {[
                ['grayscale', 0, 1, 0.01],
                ['blur', 0, 30, 0.5],
                ['brightness', 0, 300, 1],
                ['contrast', 0, 300, 1],
                ['saturation', 0, 300, 1],
              ].map(([k, min, max, step]) => (
                <div className="field" key={k}>
                  <label>
                    {k} <span className="kbd">{String(opts.filters[k])}</span>
                  </label>
                  <input
                    className="input"
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={opts.filters[k]}
                    disabled={busy}
                    onChange={(e) => {
                      setFilterPreset('custom')
                      setOpts((s) => ({ ...s, filters: { ...s.filters, [k]: Number(e.target.value) } }))
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>
                Sharpen + Watermark
              </div>
              <div className="field">
                <label>
                  Sharpen strength <span className="kbd">{String(opts.sharpen.strength)}</span>
                </label>
                <input
                  className="input"
                  type="range"
                  min="0"
                  max="3"
                  step="0.1"
                  value={opts.sharpen.strength}
                  disabled={busy}
                  onChange={(e) => setOpts((s) => ({ ...s, sharpen: { strength: Number(e.target.value) } }))}
                />
              </div>

              <div className="field">
                <label>Text watermark</label>
                <input
                  className="input"
                  value={opts.watermarkText.text}
                  disabled={busy}
                  placeholder="e.g. CONFIDENTIAL"
                  onChange={(e) => setOpts((s) => ({ ...s, watermarkText: { ...s.watermarkText, text: e.target.value } }))}
                />
              </div>

              <div className="two">
                <div className="field">
                  <label>Opacity</label>
                  <input
                    className="input"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={opts.watermarkText.opacity}
                    disabled={busy}
                    onChange={(e) =>
                      setOpts((s) => ({
                        ...s,
                        watermarkText: { ...s.watermarkText, opacity: Number(e.target.value) },
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Size</label>
                  <input
                    className="input"
                    type="number"
                    value={opts.watermarkText.size}
                    disabled={busy}
                    onChange={(e) =>
                      setOpts((s) => ({
                        ...s,
                        watermarkText: { ...s.watermarkText, size: Number(e.target.value) },
                      }))
                    }
                  />
                </div>
              </div>

              <div className="two">
                <div className="field">
                  <label>Position</label>
                  <select
                    className="select"
                    value={opts.watermarkText.position}
                    disabled={busy}
                    onChange={(e) =>
                      setOpts((s) => ({
                        ...s,
                        watermarkText: { ...s.watermarkText, position: e.target.value },
                      }))
                    }
                  >
                    <option value="tl">Top-left</option>
                    <option value="tr">Top-right</option>
                    <option value="bl">Bottom-left</option>
                    <option value="br">Bottom-right</option>
                    <option value="center">Center</option>
                  </select>
                </div>
                <div className="field">
                  <label>Color</label>
                  <input
                    className="input"
                    type="color"
                    value={opts.watermarkText.color}
                    disabled={busy}
                    onChange={(e) =>
                      setOpts((s) => ({
                        ...s,
                        watermarkText: { ...s.watermarkText, color: e.target.value },
                      }))
                    }
                  />
                </div>
              </div>

              <div className="field">
                <label>Image watermark (optional)</label>
                <input
                  className="input"
                  type="file"
                  accept={accept.join(',')}
                  disabled={busy}
                  onChange={(e) => setWmImageFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>
          </div>

          <div className="row">
            <button className="button" type="button" onClick={runSingle} disabled={!singleFile || busy}>
              Process image
            </button>
            <button className="button button--ghost" type="button" onClick={reset} disabled={busy}>
              Reset
            </button>
            {outBlob ? (
              <button
                className="button"
                type="button"
                onClick={() => {
                  downloadBlob(outBlob, replaceExt(singleFile?.name || 'image', extFromMime(outBlob.type)))
                }}
              >
                Download result
              </button>
            ) : null}
          </div>

          {busy || progress > 0 ? (
            <ProgressBar value={progress} label={busy ? 'Processing' : 'Last run'} />
          ) : null}
          {lastError ? <div className="error">{lastError}</div> : null}
        </section>
      ) : null}

      {activeTool === 'bulk' ? (
        <section className="panel">
          <h2>Bulk Processing (Worker + ZIP)</h2>
          <FileDrop
            label="Drop multiple images"
            hint="We process them in a worker and download a ZIP"
            accept={accept}
            multiple
            disabled={busy}
            onFiles={onFiles}
          />

          <div className="field" style={{ marginTop: 10 }}>
            <label>Optional image watermark (applies to all)</label>
            <input
              className="input"
              type="file"
              accept={accept.join(',')}
              disabled={busy}
              onChange={(e) => setWmImageFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={runBulkWorkerZip} disabled={!files.length || busy}>
              Process all to ZIP
            </button>
            <button className="button button--ghost" type="button" onClick={reset} disabled={busy}>
              Reset
            </button>
          </div>

          {busy || progress > 0 ? <ProgressBar value={progress} label={busy ? 'Bulk processing' : 'Last run'} /> : null}
          {lastError ? <div className="error">{lastError}</div> : null}
        </section>
      ) : null}

      {activeTool === 'base64' ? (
        <section className="panel">
          <h2>Image to/from Base64</h2>
          <div className="two">
            <div className="field">
              <label>Image to Base64</label>
              <input
                className="input"
                type="file"
                accept={accept.join(',')}
                disabled={busy}
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  setLastError('')
                  try {
                    const url = await toDataUrl(f)
                    setOpts((s) => ({ ...s, base64Text: url }))
                  } catch (err) {
                    setLastError(err?.message || String(err))
                  }
                }}
              />
              <div className="muted">Outputs a data URL (safe to paste into CSS/HTML or decode back).</div>
            </div>
            <div className="field">
              <label>Base64 to Download</label>
              <button className="button" type="button" onClick={fromBase64ToDownload} disabled={busy}>
                Decode & download
              </button>
              <div className="muted">Accepts a data URL or raw base64 bytes.</div>
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Base64 / Data URL</label>
            <textarea
              className="textarea"
              value={String(opts?.base64Text || '')}
              disabled={busy}
              onChange={(e) => setOpts((s) => ({ ...s, base64Text: e.target.value }))}
              placeholder="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgA..."
            />
          </div>
          {lastError ? <div className="error">{lastError}</div> : null}
        </section>
      ) : null}

      {activeTool === 'pdf' ? (
        <section className="panel">
          <h2>Images to PDF</h2>
          <p className="muted">Creates a PDF where each image becomes a page sized to the image.</p>
          <FileDrop
            label="Drop images to convert to a single PDF"
            hint="Order = page order"
            accept={accept}
            multiple
            disabled={busy}
            onFiles={onFiles}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={imageToPdf} disabled={!files.length || busy}>
              Create PDF
            </button>
            <button className="button button--ghost" type="button" onClick={reset} disabled={busy}>
              Reset
            </button>
          </div>
          {busy || progress > 0 ? <ProgressBar value={progress} label={busy ? 'Building PDF' : 'Last run'} /> : null}
          {lastError ? <div className="error">{lastError}</div> : null}
        </section>
      ) : null}

      {activeTool === 'colors' ? (
        <section className="panel">
          <h2>Image Average/Dominant Color Finder</h2>
          <div className="two">
            <div className="stack">
              <div className="field">
                <label>Pick one image</label>
                <input
                  className="input"
                  type="file"
                  accept={accept.join(',')}
                  disabled={busy || colorBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null
                    setColorFile(f)
                    setColorStats(null)
                  }}
                />
              </div>
              <div className="row">
                <div className="field" style={{ width: 200 }}>
                  <label>Palette size</label>
                  <input className="input" type="number" value={paletteN} onChange={(e) => setPaletteN(e.target.value)} />
                </div>
                <button className="button" type="button" onClick={analyzeColors} disabled={!colorFile || busy || colorBusy}>
                  {colorBusy ? 'Analyzing...' : 'Analyze'}
                </button>
              </div>
              <p className="muted">
                Extracts a compact palette locally (k-means on a downscaled image). “All colors” isn’t practical for photos, so this tool returns dominant colors.
              </p>
            </div>
            <div className="stack">
              {colorStats ? (
                <>
                  <div className="panel" style={{ padding: 12 }}>
                    <div className="mono muted" style={{ marginBottom: 8 }}>Average color</div>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <div className="mono" style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.16)', background: colorStats.avgHex }}>
                        {colorStats.avgHex}
                      </div>
                      <button className="button button--ghost" type="button" onClick={() => navigator.clipboard?.writeText?.(colorStats.avgHex).catch(() => {})}>
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="panel" style={{ padding: 12 }}>
                    <div className="mono muted" style={{ marginBottom: 8 }}>Dominant colors</div>
                    <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                      {colorStats.palette.map((p) => (
                        <div key={p.hex} className="row" style={{ justifyContent: 'space-between', padding: 10, borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}>
                          <div className="mono" style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.16)', background: p.hex }}>
                            {p.hex}
                          </div>
                          <button className="button button--ghost" type="button" onClick={() => navigator.clipboard?.writeText?.(p.hex).catch(() => {})} style={{ padding: '8px 10px' }}>
                            Copy
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="muted">Pick an image and click Analyze.</div>
              )}
            </div>
          </div>
          {lastError ? <div className="error">{lastError}</div> : null}
        </section>
      ) : null}

      {activeTool === 'picker' ? (
        <section className="panel">
          <h2>Image Color Picker (Eyedropper)</h2>
          <div className="two">
            <div className="stack">
              <div className="field">
                <label>Pick one image</label>
                <input
                  className="input"
                  type="file"
                  accept={accept.join(',')}
                  disabled={busy}
                  onChange={(e) => loadPickerFile(e.target.files?.[0] || null)}
                />
              </div>
              <div className="panel" style={{ padding: 12 }}>
                <div className="mono muted" style={{ marginBottom: 8 }}>Picked</div>
                {picked ? (
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div className="mono" style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.16)', background: rgbToHex(picked.r, picked.g, picked.b) }}>
                      {rgbToHex(picked.r, picked.g, picked.b)}
                    </div>
                    <button className="button button--ghost" type="button" onClick={() => navigator.clipboard?.writeText?.(rgbToHex(picked.r, picked.g, picked.b)).catch(() => {})}>
                      Copy
                    </button>
                  </div>
                ) : (
                  <div className="muted">Click the image to pick a color.</div>
                )}
                {picked ? (
                  <div className="muted mono" style={{ marginTop: 10 }}>
                    x:{picked.x} y:{picked.y} rgba({picked.r},{picked.g},{picked.b},{Math.round((picked.a / 255) * 100) / 100})
                  </div>
                ) : null}
              </div>
            </div>
            <div className="stack">
              {pickerFile ? (
                <div className="panel" style={{ padding: 12, overflow: 'auto' }}>
                  <canvas
                    ref={pickerCanvasRef}
                    style={{ maxWidth: '100%', height: 'auto', borderRadius: 12, display: 'block' }}
                    onPointerMove={(e) => samplePickerAt(e.clientX, e.clientY, false)}
                    onPointerLeave={() => setHovered(null)}
                    onPointerDown={(e) => samplePickerAt(e.clientX, e.clientY, true)}
                  />
                </div>
              ) : (
                <div className="muted">Pick an image to start.</div>
              )}
              {hovered ? (
                <div className="muted mono">
                  Hover: {rgbToHex(hovered.r, hovered.g, hovered.b)}
                </div>
              ) : null}
              {pickerMeta.w ? (
                <div className="muted mono">
                  Original: {pickerMeta.w}×{pickerMeta.h}
                </div>
              ) : null}
            </div>
          </div>
          {lastError ? <div className="error">{lastError}</div> : null}
        </section>
      ) : null}

      {activeTool === 'censor' ? (
        <section className="panel">
          <h2>Photo Censor</h2>
          <p className="muted">Drag to create rectangles. Choose pixelate/blur/black bar. Export stays local.</p>
          <div className="two">
            <div className="stack">
              <div className="field">
                <label>Pick one image</label>
                <input
                  className="input"
                  type="file"
                  accept={accept.join(',')}
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null
                    setCensorFile(f)
                    setCensorBoxes([])
                    setCensorSel('')
                    setCensorOutBlob(null)
                    if (censorOutUrl) URL.revokeObjectURL(censorOutUrl)
                    setCensorOutUrl('')
                    if (!f) return
                    const url = URL.createObjectURL(f)
                    if (censorBeforeUrl) URL.revokeObjectURL(censorBeforeUrl)
                    setCensorBeforeUrl(url)
                  }}
                />
              </div>
              <div className="row">
                <div className="field" style={{ width: 220 }}>
                  <label>Mode</label>
                  <select className="select" value={censorMode} onChange={(e) => setCensorMode(e.target.value)} disabled={busy}>
                    <option value="pixelate">Pixelate</option>
                    <option value="blur">Blur</option>
                    <option value="bar">Black bar</option>
                  </select>
                </div>
                {censorMode === 'pixelate' ? (
                  <div className="field" style={{ width: 260 }}>
                    <label>Pixel size</label>
                    <input className="input" type="range" min="2" max="80" value={censorPixel} onChange={(e) => setCensorPixel(Number(e.target.value))} disabled={busy} />
                  </div>
                ) : null}
                {censorMode === 'blur' ? (
                  <div className="field" style={{ width: 260 }}>
                    <label>Blur</label>
                    <input className="input" type="range" min="1" max="40" value={censorBlur} onChange={(e) => setCensorBlur(Number(e.target.value))} disabled={busy} />
                  </div>
                ) : null}
              </div>
              <div className="row">
                <button className="button" type="button" onClick={applyCensor} disabled={!censorFile || busy}>
                  Apply & preview
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={() => {
                    setCensorBoxes([])
                    setCensorSel('')
                  }}
                  disabled={busy}
                >
                  Clear boxes
                </button>
                {censorOutBlob ? (
                  <button
                    className="button"
                    type="button"
                    onClick={() => downloadBlob(censorOutBlob, replaceExt(censorFile?.name || 'image', 'png'))}
                  >
                    Download PNG
                  </button>
                ) : null}
              </div>
              {busy || progress > 0 ? <ProgressBar value={progress} label={busy ? 'Applying censor' : 'Last run'} /> : null}
              {lastError ? <div className="error">{lastError}</div> : null}
              <div className="panel" style={{ padding: 12 }}>
                <div className="mono muted" style={{ marginBottom: 8 }}>Boxes</div>
                {censorBoxes.length ? (
                  <div className="list">
                    {censorBoxes.map((b) => (
                      <div key={b.id} className="row" style={{ justifyContent: 'space-between' }}>
                        <button className="button button--ghost" type="button" onClick={() => setCensorSel(b.id)} style={{ padding: '6px 10px' }}>
                          {b.mode} x:{b.x} y:{b.y} w:{b.w} h:{b.h}
                        </button>
                        <button className="button button--ghost" type="button" onClick={() => setCensorBoxes((s) => s.filter((x) => x.id !== b.id))} style={{ padding: '6px 10px' }}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="muted">No boxes yet. Drag on the image to add one.</div>
                )}
              </div>
            </div>
            <div className="stack">
              <div className="two">
                <div className="panel" style={{ padding: 12 }}>
                  <div className="mono muted" style={{ marginBottom: 8 }}>Before (add boxes here)</div>
                  {censorBeforeUrl ? (
                    <div className="cropper">
                      <img
                        ref={censorImgRef}
                        src={censorBeforeUrl}
                        alt="Censor input"
                        style={{ width: '100%', height: 'auto', borderRadius: 12, display: 'block' }}
                        onLoad={(e) => {
                          const w = e.currentTarget.naturalWidth || 0
                          const h = e.currentTarget.naturalHeight || 0
                          setCensorMeta({ w, h })
                        }}
                        onPointerDown={(e) => {
                          // Only start a new box when clicking the image itself.
                          if (e.target !== e.currentTarget) return
                          startNewCensor(e)
                        }}
                      />
                      {censorMeta.w && censorMeta.h ? (
                        <div className="cropper__layer" aria-hidden="true">
                          {censorBoxes.map((b) => (
                            <div
                              key={b.id}
                              className="cropper__rect"
                              style={{
                                left: `${(b.x / censorMeta.w) * 100}%`,
                                top: `${(b.y / censorMeta.h) * 100}%`,
                                width: `${(b.w / censorMeta.w) * 100}%`,
                                height: `${(b.h / censorMeta.h) * 100}%`,
                                borderColor: b.id === censorSel ? 'rgba(248,212,107,0.92)' : 'rgba(126,228,255,0.9)',
                                background: b.id === censorSel ? 'rgba(248,212,107,0.06)' : 'rgba(126,228,255,0.06)',
                              }}
                              onPointerDown={(e) => {
                                setCensorSel(b.id)
                                startCensorDrag('move', b.id, e)
                              }}
                              onDoubleClick={() => {
                                setCensorBoxes((s) => s.map((x) => (x.id === b.id ? { ...x, mode: censorMode } : x)))
                              }}
                            >
                              <div className="cropper__handle cropper__handle--nw" onPointerDown={(e) => startCensorDrag('nw', b.id, e)} />
                              <div className="cropper__handle cropper__handle--ne" onPointerDown={(e) => startCensorDrag('ne', b.id, e)} />
                              <div className="cropper__handle cropper__handle--sw" onPointerDown={(e) => startCensorDrag('sw', b.id, e)} />
                              <div className="cropper__handle cropper__handle--se" onPointerDown={(e) => startCensorDrag('se', b.id, e)} />
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="muted">Pick an image.</div>
                  )}
                  <p className="muted" style={{ marginTop: 10 }}>
                    Double-click a box to set its mode to the currently selected mode.
                  </p>
                </div>
                <div className="panel" style={{ padding: 12 }}>
                  <div className="mono muted" style={{ marginBottom: 8 }}>After</div>
                  {censorOutUrl ? (
                    <img src={censorOutUrl} alt="Censored output" style={{ maxWidth: '100%', borderRadius: 12 }} />
                  ) : (
                    <div className="muted">Click Apply & preview.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeTool === 'svg' ? (
        <section className="panel">
          <h2>SVG Tools</h2>
          <ToolTabs
            tools={[
              { id: 'blob', label: 'Blob' },
              { id: 'pattern', label: 'Pattern' },
              { id: 'svg2png', label: 'SVG → PNG' },
              { id: 'img2svg', label: 'Image → SVG' },
            ]}
            activeId={svgTool}
            onChange={setSvgTool}
          />
          <div className="two" style={{ marginTop: 10 }}>
            <div className="stack">
              {svgTool === 'svg2png' ? (
                <>
                  <div className="field">
                    <label>Pick an SVG file</label>
                    <input className="input" type="file" accept=".svg,image/svg+xml" disabled={busy} onChange={(e) => setSvgFile(e.target.files?.[0] || null)} />
                  </div>
                  <div className="row">
                    <div className="field" style={{ width: 220 }}>
                      <label>Target width (px)</label>
                      <input className="input" type="number" value={svgScale} onChange={(e) => setSvgScale(e.target.value)} />
                    </div>
                    <button className="button" type="button" onClick={downloadSvgAsPng} disabled={!svgFile || busy}>
                      Convert & download PNG
                    </button>
                  </div>
                  <p className="muted">
                    Works best for self-contained SVGs. SVGs that reference external images/fonts may not render.
                  </p>
                </>
              ) : svgTool === 'img2svg' ? (
                <>
                  <div className="field">
                    <label>Pick an image file</label>
                    <input className="input" type="file" accept={accept.join(',')} disabled={busy} onChange={(e) => setSvgImgFile(e.target.files?.[0] || null)} />
                  </div>
                  <div className="row">
                    <div className="field" style={{ width: 220 }}>
                      <label>Output width (px)</label>
                      <input className="input" type="number" min="64" max="2048" step="1" value={svgImgWidth} onChange={(e) => setSvgImgWidth(e.target.value)} />
                    </div>
                    <div className="field" style={{ width: 220 }}>
                      <label>Block size (px)</label>
                      <input className="input" type="number" min="1" max="64" step="1" value={svgImgBlock} onChange={(e) => setSvgImgBlock(e.target.value)} />
                    </div>
                    <div className="field" style={{ width: 220 }}>
                      <label>Color levels</label>
                      <input className="input" type="number" min="2" max="64" step="1" value={svgImgLevels} onChange={(e) => setSvgImgLevels(e.target.value)} />
                    </div>
                  </div>
                  <p className="muted">
                    Set block size to <strong>1</strong> for closest visual match. This creates larger SVG files.
                  </p>
                  <div className="row">
                    <button className="button" type="button" onClick={convertImageToSvg} disabled={!svgImgFile || busy}>
                      Convert to SVG
                    </button>
                    <button className="button button--ghost" type="button" onClick={() => navigator.clipboard?.writeText?.(svgCode).catch(() => {})} disabled={!svgCode}>
                      Copy SVG
                    </button>
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() => {
                        if (!svgCode) return
                        const blob = new Blob([svgCode], { type: 'image/svg+xml' })
                        downloadBlob(blob, `image-to-svg-${Date.now()}.svg`)
                      }}
                      disabled={!svgCode}
                    >
                      Download SVG
                    </button>
                  </div>
                  {busy || progress > 0 ? <ProgressBar value={progress} label={busy ? 'Converting image to SVG' : 'Last run'} /> : null}
                  <div className="field">
                    <label>SVG code</label>
                    <textarea className="textarea" value={svgCode} onChange={(e) => setSvgCode(e.target.value)} placeholder="Click Convert to SVG" />
                  </div>
                </>
              ) : (
                <>
                  <div className="row">
                    <div className="field" style={{ width: 220 }}>
                      <label>Size</label>
                      <input className="input" type="number" value={svgSize} onChange={(e) => setSvgSize(e.target.value)} />
                    </div>
                    <div className="field" style={{ width: 220 }}>
                      <label>Complexity</label>
                      <input className="input" type="number" value={svgComplexity} onChange={(e) => setSvgComplexity(e.target.value)} />
                    </div>
                    <div className="field" style={{ width: 160 }}>
                      <label>Fill</label>
                      <input className="input" type="color" value={svgFill} onChange={(e) => setSvgFill(e.target.value)} />
                    </div>
                    <div className="field" style={{ width: 160 }}>
                      <label>Background</label>
                      <input className="input" type="color" value={svgBg} onChange={(e) => setSvgBg(e.target.value)} />
                    </div>
                  </div>
                  <div className="row">
                    <button className="button" type="button" onClick={() => (svgTool === 'blob' ? genSvgBlob() : genSvgPattern())}>
                      Generate
                    </button>
                    <button className="button button--ghost" type="button" onClick={() => navigator.clipboard?.writeText?.(svgCode).catch(() => {})} disabled={!svgCode}>
                      Copy SVG
                    </button>
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() => {
                        if (!svgCode) return
                        const blob = new Blob([svgCode], { type: 'image/svg+xml' })
                        downloadBlob(blob, `generated-${svgTool}-${Date.now()}.svg`)
                      }}
                      disabled={!svgCode}
                    >
                      Download SVG
                    </button>
                  </div>
                  <div className="field">
                    <label>SVG code</label>
                    <textarea className="textarea" value={svgCode} onChange={(e) => setSvgCode(e.target.value)} placeholder="Click Generate" />
                  </div>
                </>
              )}
              {lastError ? <div className="error">{lastError}</div> : null}
            </div>
            <div className="stack">
              <div className="panel" style={{ padding: 12 }}>
                <div className="mono muted" style={{ marginBottom: 8 }}>Preview</div>
                {svgTool === 'svg2png' ? (
                  <div className="muted">This tool exports directly to PNG. (No preview for file conversion.)</div>
                ) : svgCode ? (
                  <div
                    className="panel"
                    style={{
                      padding: 0,
                      borderRadius: 14,
                      overflow: 'hidden',
                      border: '1px solid rgba(255,255,255,0.12)',
                    }}
                    dangerouslySetInnerHTML={{ __html: svgCode }}
                  />
                ) : (
                  <div className="muted">Generate an SVG to preview.</div>
                )}
              </div>
              <p className="muted">
                SVG “stroke to fill” conversion is not included (it requires true stroke-to-path geometry).
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {activeTool === 'favicon' ? (
        <section className="panel">
          <h2>Favicon Validator</h2>
          <p className="muted">Checks local icon files against common favicon/app-icon sizes.</p>
          <FileDrop
            label="Drop favicon/icon files"
            hint="PNG/JPG/WEBP/ICO where browser decodes it"
            accept={accept}
            multiple
            disabled={busy}
            onFiles={(fs) => {
              setFavFiles(fs)
              setFavResults([])
              setFavMissing([])
            }}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={runFaviconValidate} disabled={!favFiles.length || busy}>
              Validate
            </button>
          </div>
          {favMissing.length ? (
            <div className="panel" style={{ marginTop: 10, padding: 12 }}>
              <div className="mono muted">Missing recommended sizes</div>
              <div className="mono" style={{ marginTop: 6 }}>{favMissing.join(', ')} px</div>
            </div>
          ) : null}
          <Preview title="Results">
            {favResults.length ? (
              <div className="table">
                <div className="table__row table__row--head" style={{ gridTemplateColumns: '1fr 120px 120px 90px 120px' }}>
                  <div>Name</div>
                  <div>Type</div>
                  <div>Dimensions</div>
                  <div className="right">Size</div>
                  <div>Status</div>
                </div>
                {favResults.map((r) => (
                  <div key={r.name + r.size} className="table__row" style={{ gridTemplateColumns: '1fr 120px 120px 90px 120px' }}>
                    <div className="mono">{r.name}</div>
                    <div className="muted">{r.type}</div>
                    <div className="mono">{r.width && r.height ? `${r.width}x${r.height}` : '-'}</div>
                    <div className="right">{formatBytes(r.size)}</div>
                    <div className={r.ok ? 'muted' : 'mono'}>{r.error ? r.error : r.ok ? 'Recommended' : 'Non-standard'}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">No validation results yet.</div>
            )}
          </Preview>
          {lastError ? <div className="error">{lastError}</div> : null}
        </section>
      ) : null}

      {activeTool === 'exif' ? (
        <section className="panel">
          <h2>EXIF Viewer/Editor (JPEG)</h2>
          <div className="row">
            <input
              className="input"
              type="file"
              accept=".jpg,.jpeg,image/jpeg"
              disabled={exifBusy}
              onChange={(e) => {
                setExifFile(e.target.files?.[0] || null)
                setExifRows([])
              }}
            />
            <button className="button" type="button" onClick={loadExif} disabled={!exifFile || exifBusy}>
              {exifBusy ? 'Loading...' : 'Load EXIF'}
            </button>
            <button className="button button--ghost" type="button" onClick={stripExifNow} disabled={!exifFile || exifBusy}>
              Strip EXIF & download
            </button>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Artist</label>
              <input className="input mono" value={exifArtist} onChange={(e) => setExifArtist(e.target.value)} />
            </div>
            <div className="field">
              <label>Description</label>
              <input className="input mono" value={exifDesc} onChange={(e) => setExifDesc(e.target.value)} />
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Copyright</label>
              <input className="input mono" value={exifCopyright} onChange={(e) => setExifCopyright(e.target.value)} />
            </div>
            <div className="field">
              <label>DateTime</label>
              <input className="input mono" value={exifDateTime} onChange={(e) => setExifDateTime(e.target.value)} placeholder="YYYY:MM:DD HH:mm:ss" />
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={applyExifEdits} disabled={!exifFile || exifBusy}>
              Save EXIF edits & download
            </button>
          </div>
          <Preview title="EXIF Tags">
            {exifRows.length ? (
              <div className="table">
                <div className="table__row table__row--head" style={{ gridTemplateColumns: '120px 220px 1fr' }}>
                  <div>IFD</div>
                  <div>Tag</div>
                  <div>Value</div>
                </div>
                {exifRows.map((r, i) => (
                  <div key={r.ifd + r.tag + i} className="table__row" style={{ gridTemplateColumns: '120px 220px 1fr' }}>
                    <div className="mono">{r.ifd}</div>
                    <div className="mono">{r.tag}</div>
                    <div className="mono" style={{ wordBreak: 'break-all' }}>{r.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">Load a JPEG to inspect EXIF metadata.</div>
            )}
          </Preview>
          {lastError ? <div className="error">{lastError}</div> : null}
        </section>
      ) : null}

      {activeTool === 'gif' ? (
        <section className="panel">
          <h2>GIF Frame Extractor</h2>
          <div className="row">
            <input className="input" type="file" accept=".gif,image/gif" disabled={gifBusy} onChange={(e) => setGifFile(e.target.files?.[0] || null)} />
            <button className="button" type="button" onClick={extractGifFrames} disabled={!gifFile || gifBusy}>
              {gifBusy ? 'Extracting...' : 'Extract frames'}
            </button>
            <button className="button button--ghost" type="button" onClick={downloadGifFramesZip} disabled={!gifFrames.length}>
              Download frames ZIP
            </button>
          </div>
          {gifBusy || progress > 0 ? <ProgressBar value={progress} label={gifBusy ? 'Extracting frames' : 'Last run'} /> : null}
          <Preview title="Frames">
            {gifFrames.length ? (
              <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {gifFrames.slice(0, 24).map((f) => (
                  <div key={f.name} className="panel" style={{ padding: 8 }}>
                    <img src={f.url} alt={f.name} style={{ width: '100%', borderRadius: 8 }} />
                    <div className="mono muted" style={{ marginTop: 6, fontSize: 12 }}>{f.name}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">No frames extracted yet.</div>
            )}
          </Preview>
          {lastError ? <div className="error">{lastError}</div> : null}
        </section>
      ) : null}

      {activeTool === 'spriteanim' ? (
        <section className="panel">
          <h2>Local Sprite Animator</h2>
          <div className="row">
            <input className="input" type="file" accept={accept.join(',')} onChange={(e) => setSpriteFile(e.target.files?.[0] || null)} />
            <div className="field" style={{ width: 120 }}>
              <label>Cols</label>
              <input className="input mono" type="number" value={spriteCols} onChange={(e) => setSpriteCols(e.target.value)} />
            </div>
            <div className="field" style={{ width: 120 }}>
              <label>Rows</label>
              <input className="input mono" type="number" value={spriteRows} onChange={(e) => setSpriteRows(e.target.value)} />
            </div>
            <div className="field" style={{ width: 140 }}>
              <label>Frames</label>
              <input className="input mono" type="number" value={spriteCount} onChange={(e) => setSpriteCount(e.target.value)} />
            </div>
            <div className="field" style={{ width: 120 }}>
              <label>FPS</label>
              <input className="input mono" type="number" value={spriteFps} onChange={(e) => setSpriteFps(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={() => setSpritePlaying((s) => !s)} disabled={!spriteBmp}>
              {spritePlaying ? 'Pause' : 'Play'}
            </button>
            <button className="button button--ghost" type="button" onClick={() => setSpritePlaying(false)} disabled={!spriteBmp}>
              Stop
            </button>
            <button className="button button--ghost" type="button" onClick={exportSpriteFramesZip} disabled={!spriteBmp || busy}>
              Export frames ZIP
            </button>
          </div>
          <div className="panel" style={{ marginTop: 10, padding: 12, display: 'inline-block' }}>
            <canvas ref={spriteCanvasRef} style={{ imageRendering: 'pixelated', maxWidth: 320, width: '100%', height: 'auto' }} />
          </div>
          {busy || progress > 0 ? <ProgressBar value={progress} label={busy ? 'Exporting frames' : 'Last run'} /> : null}
          {lastError ? <div className="error">{lastError}</div> : null}
        </section>
      ) : null}

      {activeTool === 'bulk' || activeTool === 'pdf' ? (
        <Preview title="Selected Files">
          {files.length ? (
            <div className="table">
              <div className="table__row table__row--head">
                <div>Name</div>
                <div>Type</div>
                <div className="right">Size</div>
              </div>
              {files.map((f) => (
                <div className="table__row" key={f.name + f.size + f.lastModified}>
                  <div className="mono">{f.name}</div>
                  <div className="muted">{f.type || 'unknown'}</div>
                  <div className="right">{formatBytes(f.size)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">No files selected.</div>
          )}
        </Preview>
      ) : null}

      {activeTool === 'edit' ? (
        <Preview title="Preview (Before / After)">
          <div className="two">
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>
                Before
              </div>
              {beforeUrl ? (
                <div className="cropper">
                  <img
                    ref={imgRef}
                    src={beforeUrl}
                    alt="Before preview"
                    style={{ width: '100%', height: 'auto', borderRadius: 12, display: 'block' }}
                    onLoad={(e) => {
                      const w = e.currentTarget.naturalWidth || 0
                      const h = e.currentTarget.naturalHeight || 0
                      setImgMeta({ w, h })
                      if (opts.crop.enabled) setTimeout(() => ensureCropDefaults(), 0)
                    }}
                  />
                  {opts.crop.enabled && imgMeta.w && imgMeta.h ? (
                    <div className="cropper__layer" aria-hidden="true">
                      <div className="cropper__dim" />
                      <div
                        className="cropper__rect"
                        style={{
                          left: `${(opts.crop.x / imgMeta.w) * 100}%`,
                          top: `${(opts.crop.y / imgMeta.h) * 100}%`,
                          width: `${(opts.crop.w / imgMeta.w) * 100}%`,
                          height: `${(opts.crop.h / imgMeta.h) * 100}%`,
                        }}
                        onPointerDown={(e) => startDrag('move', e)}
                      >
                        <div className="cropper__handle cropper__handle--nw" onPointerDown={(e) => startDrag('nw', e)} />
                        <div className="cropper__handle cropper__handle--ne" onPointerDown={(e) => startDrag('ne', e)} />
                        <div className="cropper__handle cropper__handle--sw" onPointerDown={(e) => startDrag('sw', e)} />
                        <div className="cropper__handle cropper__handle--se" onPointerDown={(e) => startDrag('se', e)} />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="muted">Pick an image to preview.</div>
              )}
            </div>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>
                After
              </div>
              {outUrl ? (
                <img src={outUrl} alt="After preview" style={{ maxWidth: '100%', borderRadius: 12 }} />
              ) : (
                <div className="muted">Run processing to see output.</div>
              )}
            </div>
          </div>
        </Preview>
      ) : null}
    </div>
  )
}
