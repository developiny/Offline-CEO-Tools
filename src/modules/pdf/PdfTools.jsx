import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ToolTabs from '../../components/ToolTabs.jsx'
import FileDrop from '../../components/FileDrop.jsx'
import ProgressBar from '../../components/ProgressBar.jsx'
import Preview from '../../components/Preview.jsx'
import DownloadButton from '../../components/DownloadButton.jsx'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import { downloadBlob, formatBytes } from '../../utils/file.js'
import { zipBlobs } from '../../utils/zip.js'
import { extractPdfText, loadPdfFromArrayBuffer, renderPdfPageToCanvas, renderPdfPageToDataUrl } from '../../utils/pdfjs.js'
import { addRecent, toolKey } from '../../utils/toolPrefs.js'

const TOOLS = [
  { id: 'merge', label: 'Merge' },
  { id: 'split', label: 'Split' },
  { id: 'pages', label: 'Reorder/Rotate/Delete' },
  { id: 'annotate', label: 'Text/Image/Watermark' },
  { id: 'preview', label: 'Preview/Extract' },
  { id: 'toimages', label: 'PDF to Images' },
  { id: 'imgtopdf', label: 'Images to PDF' },
  { id: 'scan', label: 'Scanned PDF' },
]

function safeName(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|]+/g, '_')
}

function baseName(name) {
  return safeName(name).replace(/\.[^.]+$/, '')
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

async function fileToPngBytes(file) {
  const bmp = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d', { alpha: true })
  ctx.drawImage(bmp, 0, 0)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  const ab = await blob.arrayBuffer()
  return new Uint8Array(ab)
}

export default function PdfTools() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tool, setTool] = useState('merge')
  const [err, setErr] = useState('')

  const workerRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

  function ensureWorker() {
    if (workerRef.current) return workerRef.current
    const w = new Worker(new URL('../../workers/pdf.worker.js', import.meta.url), { type: 'module' })
    w.onmessage = (e) => {
      const msg = e.data || {}
      if (msg.type === 'progress') setProgress(msg.value || 0)
      if (msg.type === 'error') {
        setBusy(false)
        setErr(msg.message || 'Worker error.')
      }
    }
    workerRef.current = w
    return w
  }

  useEffect(() => () => workerRef.current?.terminate?.(), [])

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
        key: toolKey('pdf', tool),
        label: `PDF: ${t.label}`,
        path: `/pdf?tool=${tool}`,
        tool,
      })
      window.dispatchEvent(new Event('oct:prefs'))
    }
  }, [tool, setSearchParams])

  // Merge
  const [mergeFiles, setMergeFiles] = useState([])

  async function runMerge() {
    if (mergeFiles.length < 2) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const items = await Promise.all(
        mergeFiles.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })),
      )
      const transfers = items.map((i) => i.data)
      const w = ensureWorker()
      const ab = await new Promise((resolve, reject) => {
        const onMsg = (e) => {
          const m = e.data || {}
          if (m.type === 'result') {
            w.removeEventListener('message', onMsg)
            resolve(m.ab)
          } else if (m.type === 'error') {
            w.removeEventListener('message', onMsg)
            reject(new Error(m.message || 'Worker error.'))
          }
        }
        w.addEventListener('message', onMsg)
        w.postMessage({ type: 'merge', items }, transfers)
      })
      downloadBlob(new Blob([ab], { type: 'application/pdf' }), `merged-${Date.now()}.pdf`)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // Split
  const [splitFile, setSplitFile] = useState(null)
  const [splitMode, setSplitMode] = useState('each') // each|ranges
  const [splitRanges, setSplitRanges] = useState('1-3,5')

  async function runSplit() {
    if (!splitFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const data = await splitFile.arrayBuffer()
      const w = ensureWorker()
      const outEntries = []
      await new Promise((resolve, reject) => {
        const onMsg = (e) => {
          const m = e.data || {}
          if (m.type === 'item') {
            outEntries.push({ name: m.name, blob: new Blob([m.ab], { type: 'application/pdf' }) })
          } else if (m.type === 'done') {
            w.removeEventListener('message', onMsg)
            resolve()
          } else if (m.type === 'error') {
            w.removeEventListener('message', onMsg)
            reject(new Error(m.message || 'Worker error.'))
          }
        }
        w.addEventListener('message', onMsg)
        if (splitMode === 'each') w.postMessage({ type: 'split-each', data, baseName: baseName(splitFile.name) }, [data])
        else w.postMessage({ type: 'split-ranges', data, baseName: baseName(splitFile.name), ranges: splitRanges }, [data])
      })

      if (!outEntries.length) throw new Error('No output produced.')
      if (outEntries.length === 1) {
        downloadBlob(outEntries[0].blob, outEntries[0].name)
      } else {
        const zip = await zipBlobs(outEntries)
        downloadBlob(zip, `split-${baseName(splitFile.name)}-${Date.now()}.zip`)
      }
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // Reorder/Rotate/Delete
  const [pageFile, setPageFile] = useState(null)
  const [reorderSpec, setReorderSpec] = useState('')
  const [deleteSpec, setDeleteSpec] = useState('')
  const [rotateSpec, setRotateSpec] = useState('')
  const [rotateDegrees, setRotateDegrees] = useState(90)
  const [thumbs, setThumbs] = useState([]) // { page, url }
  const [pageOrder, setPageOrder] = useState([]) // page numbers (1-based)
  const [thumbBusy, setThumbBusy] = useState(false)
  const thumbJobRef = useRef({ id: 0 })

  async function runPagesTransform() {
    if (!pageFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const data = await pageFile.arrayBuffer()
      const ops = { reorderSpec, deleteSpec, rotateSpec, rotateDegrees }
      const w = ensureWorker()
      const ab = await new Promise((resolve, reject) => {
        const onMsg = (e) => {
          const m = e.data || {}
          if (m.type === 'result') {
            w.removeEventListener('message', onMsg)
            resolve(m.ab)
          } else if (m.type === 'error') {
            w.removeEventListener('message', onMsg)
            reject(new Error(m.message || 'Worker error.'))
          }
        }
        w.addEventListener('message', onMsg)
        w.postMessage({ type: 'transform', data, ops }, [data])
      })
      downloadBlob(new Blob([ab], { type: 'application/pdf' }), `pages-${baseName(pageFile.name)}-${Date.now()}.pdf`)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function generateThumbnails() {
    if (!pageFile) return
    setErr('')
    setThumbBusy(true)
    setProgress(0)
    const jobId = ++thumbJobRef.current.id
    try {
      const ab = await pageFile.arrayBuffer()
      const pdf = await loadPdfFromArrayBuffer(ab)
      const total = pdf.numPages
      setPageOrder(Array.from({ length: total }, (_, i) => i + 1))
      setReorderSpec('')
      setThumbs([])

      const out = []
      for (let p = 1; p <= total; p++) {
        if (thumbJobRef.current.id !== jobId) return
        let url = ''
        try {
          url = await renderPdfPageToDataUrl(pdf, p, 0.22)
        } catch {
          url = ''
        }
        out.push({ page: p, url })
        if (p % 4 === 0 || p === total) setThumbs(out.slice())
        setProgress(p / Math.max(1, total))
      }
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      if (thumbJobRef.current.id === jobId) setThumbBusy(false)
    }
  }

  function orderToSpec(order) {
    return (order || []).join(',')
  }

  function onDragStart(index, e) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  function onDrop(index, e) {
    e.preventDefault()
    const from = Number(e.dataTransfer.getData('text/plain'))
    if (!Number.isFinite(from)) return
    if (from === index) return
    setPageOrder((prev) => {
      const next = prev.slice()
      const [item] = next.splice(from, 1)
      next.splice(index, 0, item)
      return next
    })
  }

  function removePage(pageNum) {
    setPageOrder((prev) => prev.filter((p) => p !== pageNum))
  }

  function resetOrder() {
    if (!thumbs.length) return
    const max = Math.max(...thumbs.map((t) => t.page))
    setPageOrder(Array.from({ length: max }, (_, i) => i + 1))
  }

  // Annotate
  const [annFile, setAnnFile] = useState(null)
  const [addTextEnabled, setAddTextEnabled] = useState(false)
  const [addText, setAddText] = useState('Hello')
  const [addTextX, setAddTextX] = useState(40)
  const [addTextY, setAddTextY] = useState(40)
  const [addTextSize, setAddTextSize] = useState(18)
  const [addTextOpacity, setAddTextOpacity] = useState(1)
  const [addTextPages, setAddTextPages] = useState('')

  const [wmEnabled, setWmEnabled] = useState(false)
  const [wmText, setWmText] = useState('CONFIDENTIAL')
  const [wmSize, setWmSize] = useState(48)
  const [wmOpacity, setWmOpacity] = useState(0.2)
  const [wmRotate, setWmRotate] = useState(-30)

  const [pnEnabled, setPnEnabled] = useState(false)
  const [pnStart, setPnStart] = useState(1)
  const [pnSize, setPnSize] = useState(12)
  const [pnMargin, setPnMargin] = useState(24)
  const [pnPos, setPnPos] = useState('br')

  const [imgEnabled, setImgEnabled] = useState(false)
  const [imgFile, setImgFile] = useState(null)
  const [imgOpacity, setImgOpacity] = useState(0.35)
  const [imgScale, setImgScale] = useState(0.25)
  const [imgPos, setImgPos] = useState('br')
  const [imgMargin, setImgMargin] = useState(24)
  const [imgPages, setImgPages] = useState('')

  async function runAnnotate() {
    if (!annFile) return
    if (imgEnabled && !imgFile) {
      setErr('Pick an image for the image overlay.')
      return
    }
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const data = await annFile.arrayBuffer()
      const imgPayload = imgEnabled
        ? { enabled: true, type: imgFile.type, data: await imgFile.arrayBuffer(), opacity: imgOpacity, scale: imgScale, position: imgPos, margin: imgMargin, pages: imgPages }
        : null
      const ops = {
        addText: addTextEnabled
          ? { enabled: true, text: addText, x: addTextX, y: addTextY, size: addTextSize, opacity: addTextOpacity, pages: addTextPages, color: { r: 0, g: 0, b: 0 } }
          : null,
        watermark: wmEnabled ? { enabled: true, text: wmText, size: wmSize, opacity: wmOpacity, rotate: wmRotate } : null,
        pageNumbers: pnEnabled ? { enabled: true, start: pnStart, size: pnSize, margin: pnMargin, position: pnPos } : null,
        addImage: imgPayload,
      }

      const transfers = [data]
      if (imgPayload?.data) transfers.push(imgPayload.data)
      const w = ensureWorker()
      const ab = await new Promise((resolve, reject) => {
        const onMsg = (e) => {
          const m = e.data || {}
          if (m.type === 'result') {
            w.removeEventListener('message', onMsg)
            resolve(m.ab)
          } else if (m.type === 'error') {
            w.removeEventListener('message', onMsg)
            reject(new Error(m.message || 'Worker error.'))
          }
        }
        w.addEventListener('message', onMsg)
        w.postMessage({ type: 'transform', data, ops }, transfers)
      })
      downloadBlob(new Blob([ab], { type: 'application/pdf' }), `annotated-${baseName(annFile.name)}-${Date.now()}.pdf`)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // Preview/Extract
  const [prevFile, setPrevFile] = useState(null)
  const canvasRef = useRef(null)
  const [prevInfo, setPrevInfo] = useState({ pages: 0 })
  const [prevPage, setPrevPage] = useState(1)
  const [extracted, setExtracted] = useState('')

  async function loadPreview() {
    if (!prevFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    setExtracted('')
    try {
      const ab = await prevFile.arrayBuffer()
      const pdf = await loadPdfFromArrayBuffer(ab)
      setPrevInfo({ pages: pdf.numPages })
      const page = Math.max(1, Math.min(pdf.numPages, prevPage || 1))
      setPrevPage(page)
      if (canvasRef.current) await renderPdfPageToCanvas(pdf, page, canvasRef.current, 1.25)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function renderPreviewPage(pageNumber) {
    if (!prevFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const ab = await prevFile.arrayBuffer()
      const pdf = await loadPdfFromArrayBuffer(ab)
      setPrevInfo({ pages: pdf.numPages })
      const page = Math.max(1, Math.min(pdf.numPages, pageNumber))
      setPrevPage(page)
      if (canvasRef.current) await renderPdfPageToCanvas(pdf, page, canvasRef.current, 1.25)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function runExtractText() {
    if (!prevFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const ab = await prevFile.arrayBuffer()
      const pdf = await loadPdfFromArrayBuffer(ab)
      const txt = await extractPdfText(pdf)
      setExtracted(txt)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // PDF -> images
  const [toImgFile, setToImgFile] = useState(null)
  const [toImgScale, setToImgScale] = useState(1.6)

  async function runPdfToImages() {
    if (!toImgFile) return
    setErr('')
    setBusy(true)
    setProgress(0)
    try {
      const ab = await toImgFile.arrayBuffer()
      const pdf = await loadPdfFromArrayBuffer(ab)
      const total = pdf.numPages
      const entries = []
      const canvas = document.createElement('canvas')
      for (let i = 1; i <= total; i++) {
        await renderPdfPageToCanvas(pdf, i, canvas, toImgScale)
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
        entries.push({ name: `${baseName(toImgFile.name)}-page-${i}.png`, blob })
        setProgress(i / total)
      }
      const zip = await zipBlobs(entries)
      downloadBlob(zip, `pdf-images-${baseName(toImgFile.name)}-${Date.now()}.zip`)
      setProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // Images -> PDF
  const [imgFiles, setImgFiles] = useState([])
  const [imgToPdfBusy, setImgToPdfBusy] = useState(false)
  const [imgToPdfProgress, setImgToPdfProgress] = useState(0)
  const [imgToPdfOut, setImgToPdfOut] = useState(null)
  const [imgToPdfName, setImgToPdfName] = useState('images.pdf')

  async function runImagesToPdf() {
    if (!imgFiles.length) return
    setErr('')
    setImgToPdfBusy(true)
    setImgToPdfProgress(0)
    setImgToPdfOut(null)
    try {
      const { PDFDocument } = await import('pdf-lib')
      const pdf = await PDFDocument.create()
      for (let i = 0; i < imgFiles.length; i++) {
        const f = imgFiles[i]
        const isPng = /png/i.test(f.type) || /\.png$/i.test(f.name)
        const isJpg = /jpe?g/i.test(f.type) || /\.jpe?g$/i.test(f.name)
        const bytes = isPng || isJpg ? new Uint8Array(await f.arrayBuffer()) : await fileToPngBytes(f)
        const embedded = isJpg ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes)
        const page = pdf.addPage([embedded.width, embedded.height])
        page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height })
        setImgToPdfProgress((i + 1) / imgFiles.length)
      }
      const out = await pdf.save()
      setImgToPdfOut(new Blob([out], { type: 'application/pdf' }))
      setImgToPdfName(`images-${Date.now()}.pdf`)
      setImgToPdfProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setImgToPdfBusy(false)
    }
  }

  // Scanned PDF converter (offline): render each page to an image and re-embed.
  const [scanFile, setScanFile] = useState(null)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [scanOpts, setScanOpts] = useState({
    scale: 1.6,
    grayscale: true,
    noise: 0.08, // 0..0.25
    blur: 0.6, // 0..3 (applied via canvas filter)
    contrast: 112, // 50..160
    brightness: 104, // 50..160
    jpegQuality: 0.78,
  })

  function applyScanEffects(canvas) {
    const ctx = canvas.getContext('2d', { alpha: false })
    const { width, height } = canvas
    const img = ctx.getImageData(0, 0, width, height)
    const d = img.data
    const contrast = clamp(Number(scanOpts.contrast) || 112, 50, 160) / 100
    const bright = clamp(Number(scanOpts.brightness) || 104, 50, 160)
    const brightOff = (bright - 100) * 2.55
    const noise = clamp(Number(scanOpts.noise) || 0.08, 0, 0.25) * 255
    const gray = !!scanOpts.grayscale

    for (let i = 0; i < d.length; i += 4) {
      let r = d[i]
      let g = d[i + 1]
      let b = d[i + 2]
      if (gray) {
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
        r = g = b = y
      }
      // contrast around midpoint + brightness
      r = (r - 128) * contrast + 128 + brightOff
      g = (g - 128) * contrast + 128 + brightOff
      b = (b - 128) * contrast + 128 + brightOff
      if (noise) {
        const n = (Math.random() * 2 - 1) * noise
        r += n
        g += n
        b += n
      }
      d[i] = clamp(Math.round(r), 0, 255)
      d[i + 1] = clamp(Math.round(g), 0, 255)
      d[i + 2] = clamp(Math.round(b), 0, 255)
      d[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)

    // Optional small blur by re-drawing (makes it feel like a scan).
    const blur = clamp(Number(scanOpts.blur) || 0, 0, 3)
    if (blur > 0) {
      const tmp = document.createElement('canvas')
      tmp.width = width
      tmp.height = height
      const tctx = tmp.getContext('2d', { alpha: false })
      tctx.drawImage(canvas, 0, 0)
      ctx.save()
      ctx.filter = `blur(${blur}px)`
      ctx.drawImage(tmp, 0, 0)
      ctx.restore()
    }
  }

  async function runScanPdf() {
    if (!scanFile) return
    setErr('')
    setScanBusy(true)
    setScanProgress(0)
    try {
      const ab = await scanFile.arrayBuffer()
      const pdf = await loadPdfFromArrayBuffer(ab)
      const total = pdf.numPages
      const { PDFDocument } = await import('pdf-lib')
      const out = await PDFDocument.create()

      const canvas = document.createElement('canvas')
      for (let p = 1; p <= total; p++) {
        await renderPdfPageToCanvas(pdf, p, canvas, clamp(Number(scanOpts.scale) || 1.6, 0.8, 3))
        applyScanEffects(canvas)
        const jpg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', clamp(Number(scanOpts.jpegQuality) || 0.78, 0.35, 0.95)))
        if (!jpg) throw new Error('Failed to export JPEG.')
        const bytes = new Uint8Array(await jpg.arrayBuffer())
        const emb = await out.embedJpg(bytes)
        const page = out.addPage([emb.width, emb.height])
        page.drawImage(emb, { x: 0, y: 0, width: emb.width, height: emb.height })
        setScanProgress(p / Math.max(1, total))
      }

      const bytes = await out.save()
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `scanned-${baseName(scanFile.name)}-${Date.now()}.pdf`)
      setScanProgress(1)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setScanBusy(false)
    }
  }

  const acceptPdf = useMemo(() => ['application/pdf', '.pdf'], [])

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>PDF Tools</h1>
        <p className="muted">All PDF processing stays local. Editing uses a Web Worker; preview uses pdf.js.</p>
      </div>

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <ToolTabs tools={TOOLS} activeId={tool} onChange={(id) => { setTool(id); setErr(''); setProgress(0) }} />
          <FavoriteButton
            entry={{
              key: toolKey('pdf', tool),
              label: `PDF: ${TOOLS.find((x) => x.id === tool)?.label || tool}`,
              path: `/pdf?tool=${tool}`,
              tool,
            }}
          />
        </div>
        {err ? <div className="error">{err}</div> : null}
        {busy || progress > 0 ? <ProgressBar value={progress} label={busy ? 'Working' : 'Last run'} /> : null}
      </section>

      {tool === 'merge' ? (
        <section className="panel">
          <h2>Merge PDFs</h2>
          <FileDrop label="Drop multiple PDFs" hint="Downloads one merged PDF" accept={acceptPdf} multiple disabled={busy} onFiles={setMergeFiles} />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={runMerge} disabled={busy || mergeFiles.length < 2}>
              Merge & download
            </button>
          </div>
          <Preview title="Selected PDFs">
            {mergeFiles.length ? (
              <div className="table">
                <div className="table__row table__row--head" style={{ gridTemplateColumns: '1fr 120px' }}>
                  <div>Name</div>
                  <div className="right">Size</div>
                </div>
                {mergeFiles.map((f) => (
                  <div key={f.name + f.size + f.lastModified} className="table__row" style={{ gridTemplateColumns: '1fr 120px' }}>
                    <div className="mono">{f.name}</div>
                    <div className="right">{formatBytes(f.size)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">Pick at least two PDFs.</div>
            )}
          </Preview>
        </section>
      ) : null}

      {tool === 'split' ? (
        <section className="panel">
          <h2>Split PDF</h2>
          <div className="field">
            <label>Pick a PDF</label>
            <input className="input" type="file" accept={acceptPdf.join(',')} disabled={busy} onChange={(e) => setSplitFile(e.target.files?.[0] || null)} />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="field" style={{ minWidth: 220 }}>
              <label>Mode</label>
              <select className="select" value={splitMode} onChange={(e) => setSplitMode(e.target.value)} disabled={busy}>
                <option value="each">One PDF per page (ZIP)</option>
                <option value="ranges">Select pages/ranges</option>
              </select>
            </div>
            {splitMode === 'ranges' ? (
              <div className="field" style={{ flex: 1 }}>
                <label>Pages (e.g. 1-3,5,7-)</label>
                <input className="input mono" value={splitRanges} onChange={(e) => setSplitRanges(e.target.value)} disabled={busy} />
              </div>
            ) : null}
            <button className="button" type="button" onClick={runSplit} disabled={busy || !splitFile}>
              Split & download
            </button>
          </div>
        </section>
      ) : null}

      {tool === 'pages' ? (
        <section className="panel">
          <h2>Reorder / Rotate / Delete Pages</h2>
          <div className="field">
            <label>Pick a PDF</label>
            <input
              className="input"
              type="file"
              accept={acceptPdf.join(',')}
              disabled={busy || thumbBusy}
              onChange={(e) => {
                const f = e.target.files?.[0] || null
                setPageFile(f)
                setThumbs([])
                setPageOrder([])
                setReorderSpec('')
                setDeleteSpec('')
                setRotateSpec('')
              }}
            />
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={generateThumbnails} disabled={!pageFile || busy || thumbBusy}>
              {thumbBusy ? 'Generating thumbnails...' : 'Generate thumbnails'}
            </button>
            <button className="button button--ghost" type="button" onClick={resetOrder} disabled={!pageOrder.length || busy || thumbBusy}>
              Reset order
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => {
                setReorderSpec(orderToSpec(pageOrder))
                setDeleteSpec('')
              }}
              disabled={!pageOrder.length || busy || thumbBusy}
            >
              Use UI order
            </button>
            {pageOrder.length ? <div className="muted">Keeping {pageOrder.length} pages</div> : null}
          </div>

          {pageOrder.length ? (
            <Preview title="Pages (drag to reorder, remove to delete)">
              <div className="thumbgrid">
                {pageOrder.map((pageNum, idx) => {
                  const t = thumbs.find((x) => x.page === pageNum)
                  return (
                    <div
                      key={pageNum}
                      className="thumb"
                      draggable
                      onDragStart={(e) => onDragStart(idx, e)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onDrop(idx, e)}
                    >
                      <div className="thumb__top">
                        <div className="thumb__label">#{pageNum}</div>
                        <button className="thumb__btn" type="button" onClick={() => removePage(pageNum)} disabled={busy || thumbBusy}>
                          Remove
                        </button>
                      </div>
                      <div className="thumb__img">
                        {t?.url ? <img src={t.url} alt={`Page ${pageNum}`} /> : <div className="muted mono">...</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Preview>
          ) : null}

          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Reorder (comma list, 1-based) e.g. 3,1,2</label>
              <input className="input mono" value={reorderSpec} onChange={(e) => setReorderSpec(e.target.value)} disabled={busy} />
            </div>
            <div className="field">
              <label>Delete pages (ranges) e.g. 2,5-7</label>
              <input className="input mono" value={deleteSpec} onChange={(e) => setDeleteSpec(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Rotate pages (ranges)</label>
              <input className="input mono" value={rotateSpec} onChange={(e) => setRotateSpec(e.target.value)} disabled={busy} placeholder="e.g. 1-2,5" />
            </div>
            <div className="field" style={{ width: 160 }}>
              <label>Degrees</label>
              <select className="select" value={rotateDegrees} onChange={(e) => setRotateDegrees(Number(e.target.value))} disabled={busy}>
                <option value={90}>90</option>
                <option value={180}>180</option>
                <option value={270}>270</option>
              </select>
            </div>
            <button className="button" type="button" onClick={runPagesTransform} disabled={busy || !pageFile}>
              Apply & download
            </button>
          </div>
        </section>
      ) : null}

      {tool === 'annotate' ? (
        <section className="panel">
          <h2>Add Text / Image / Watermark / Page Numbers</h2>
          <div className="field">
            <label>Pick a PDF</label>
            <input className="input" type="file" accept={acceptPdf.join(',')} disabled={busy} onChange={(e) => setAnnFile(e.target.files?.[0] || null)} />
          </div>

          <div className="panel" style={{ padding: 14, marginTop: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="mono muted">Text</div>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={addTextEnabled} onChange={(e) => setAddTextEnabled(e.target.checked)} disabled={busy} />
                <span className="muted">Enable</span>
              </label>
            </div>
            <div className="two">
              <div className="field">
                <label>Text</label>
                <input className="input" value={addText} onChange={(e) => setAddText(e.target.value)} disabled={busy || !addTextEnabled} />
              </div>
              <div className="field">
                <label>Pages (optional ranges)</label>
                <input className="input mono" value={addTextPages} onChange={(e) => setAddTextPages(e.target.value)} disabled={busy || !addTextEnabled} placeholder="e.g. 1-3,5" />
              </div>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <div className="field" style={{ width: 140 }}>
                <label>X</label>
                <input className="input" type="number" value={addTextX} onChange={(e) => setAddTextX(Number(e.target.value))} disabled={busy || !addTextEnabled} />
              </div>
              <div className="field" style={{ width: 140 }}>
                <label>Y</label>
                <input className="input" type="number" value={addTextY} onChange={(e) => setAddTextY(Number(e.target.value))} disabled={busy || !addTextEnabled} />
              </div>
              <div className="field" style={{ width: 140 }}>
                <label>Size</label>
                <input className="input" type="number" value={addTextSize} onChange={(e) => setAddTextSize(Number(e.target.value))} disabled={busy || !addTextEnabled} />
              </div>
              <div className="field" style={{ width: 200 }}>
                <label>Opacity</label>
                <input className="input" type="range" min="0" max="1" step="0.01" value={addTextOpacity} onChange={(e) => setAddTextOpacity(Number(e.target.value))} disabled={busy || !addTextEnabled} />
              </div>
            </div>
          </div>

          <div className="panel" style={{ padding: 14, marginTop: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="mono muted">Watermark (text)</div>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={wmEnabled} onChange={(e) => setWmEnabled(e.target.checked)} disabled={busy} />
                <span className="muted">Enable</span>
              </label>
            </div>
            <div className="two">
              <div className="field">
                <label>Watermark text</label>
                <input className="input" value={wmText} onChange={(e) => setWmText(e.target.value)} disabled={busy || !wmEnabled} />
              </div>
              <div className="row">
                <div className="field" style={{ width: 140 }}>
                  <label>Size</label>
                  <input className="input" type="number" value={wmSize} onChange={(e) => setWmSize(Number(e.target.value))} disabled={busy || !wmEnabled} />
                </div>
                <div className="field" style={{ width: 220 }}>
                  <label>Opacity</label>
                  <input className="input" type="range" min="0" max="1" step="0.01" value={wmOpacity} onChange={(e) => setWmOpacity(Number(e.target.value))} disabled={busy || !wmEnabled} />
                </div>
                <div className="field" style={{ width: 140 }}>
                  <label>Rotate</label>
                  <input className="input" type="number" value={wmRotate} onChange={(e) => setWmRotate(Number(e.target.value))} disabled={busy || !wmEnabled} />
                </div>
              </div>
            </div>
          </div>

          <div className="panel" style={{ padding: 14, marginTop: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="mono muted">Image overlay</div>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={imgEnabled} onChange={(e) => setImgEnabled(e.target.checked)} disabled={busy} />
                <span className="muted">Enable</span>
              </label>
            </div>
            <div className="two">
              <div className="field">
                <label>Image</label>
                <input className="input" type="file" accept="image/*" disabled={busy || !imgEnabled} onChange={(e) => setImgFile(e.target.files?.[0] || null)} />
              </div>
              <div className="field">
                <label>Pages (optional ranges)</label>
                <input className="input mono" value={imgPages} onChange={(e) => setImgPages(e.target.value)} disabled={busy || !imgEnabled} placeholder="e.g. 1-3,5" />
              </div>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <div className="field" style={{ width: 220 }}>
                <label>Opacity</label>
                <input className="input" type="range" min="0" max="1" step="0.01" value={imgOpacity} onChange={(e) => setImgOpacity(Number(e.target.value))} disabled={busy || !imgEnabled} />
              </div>
              <div className="field" style={{ width: 220 }}>
                <label>Scale</label>
                <input className="input" type="range" min="0.05" max="1" step="0.01" value={imgScale} onChange={(e) => setImgScale(Number(e.target.value))} disabled={busy || !imgEnabled} />
              </div>
              <div className="field" style={{ width: 180 }}>
                <label>Position</label>
                <select className="select" value={imgPos} onChange={(e) => setImgPos(e.target.value)} disabled={busy || !imgEnabled}>
                  <option value="tl">Top-left</option>
                  <option value="tr">Top-right</option>
                  <option value="bl">Bottom-left</option>
                  <option value="br">Bottom-right</option>
                  <option value="center">Center</option>
                </select>
              </div>
              <div className="field" style={{ width: 140 }}>
                <label>Margin</label>
                <input className="input" type="number" value={imgMargin} onChange={(e) => setImgMargin(Number(e.target.value))} disabled={busy || !imgEnabled} />
              </div>
            </div>
          </div>

          <div className="panel" style={{ padding: 14, marginTop: 10 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="mono muted">Page numbers</div>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={pnEnabled} onChange={(e) => setPnEnabled(e.target.checked)} disabled={busy} />
                <span className="muted">Enable</span>
              </label>
            </div>
            <div className="row">
              <div className="field" style={{ width: 140 }}>
                <label>Start</label>
                <input className="input" type="number" value={pnStart} onChange={(e) => setPnStart(Number(e.target.value))} disabled={busy || !pnEnabled} />
              </div>
              <div className="field" style={{ width: 140 }}>
                <label>Size</label>
                <input className="input" type="number" value={pnSize} onChange={(e) => setPnSize(Number(e.target.value))} disabled={busy || !pnEnabled} />
              </div>
              <div className="field" style={{ width: 140 }}>
                <label>Margin</label>
                <input className="input" type="number" value={pnMargin} onChange={(e) => setPnMargin(Number(e.target.value))} disabled={busy || !pnEnabled} />
              </div>
              <div className="field" style={{ width: 180 }}>
                <label>Position</label>
                <select className="select" value={pnPos} onChange={(e) => setPnPos(e.target.value)} disabled={busy || !pnEnabled}>
                  <option value="br">Bottom-right</option>
                  <option value="bl">Bottom-left</option>
                  <option value="tr">Top-right</option>
                  <option value="tl">Top-left</option>
                </select>
              </div>
            </div>
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={runAnnotate} disabled={busy || !annFile}>
              Apply & download
            </button>
          </div>
        </section>
      ) : null}

      {tool === 'preview' ? (
        <section className="panel">
          <h2>Preview + Extract Text</h2>
          <div className="field">
            <label>Pick a PDF</label>
            <input className="input" type="file" accept={acceptPdf.join(',')} disabled={busy} onChange={(e) => setPrevFile(e.target.files?.[0] || null)} />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={loadPreview} disabled={busy || !prevFile}>
              Render
            </button>
            <button className="button button--ghost" type="button" onClick={runExtractText} disabled={busy || !prevFile}>
              Extract text
            </button>
            {prevInfo.pages ? <div className="muted">Pages: {prevInfo.pages}</div> : null}
            {prevInfo.pages ? (
              <div className="row">
                <span className="muted">Page</span>
                <input
                  className="input mono"
                  style={{ width: 90 }}
                  type="number"
                  value={prevPage}
                  disabled={busy}
                  onChange={(e) => setPrevPage(Number(e.target.value))}
                />
                <button className="button button--ghost" type="button" disabled={busy || !prevFile} onClick={() => renderPreviewPage(prevPage)}>
                  Go
                </button>
                <button className="button button--ghost" type="button" disabled={busy || prevPage <= 1} onClick={() => renderPreviewPage(prevPage - 1)}>
                  Prev
                </button>
                <button className="button button--ghost" type="button" disabled={busy || prevPage >= prevInfo.pages} onClick={() => renderPreviewPage(prevPage + 1)}>
                  Next
                </button>
              </div>
            ) : null}
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Preview</div>
              <canvas ref={canvasRef} style={{ width: '100%', borderRadius: 12 }} />
            </div>
            <div className="field">
              <label>Extracted text</label>
              <textarea className="textarea" value={extracted} readOnly placeholder="Text will appear here (text-based PDFs only)." />
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'toimages' ? (
        <section className="panel">
          <h2>PDF to Images (PNG)</h2>
          <div className="field">
            <label>Pick a PDF</label>
            <input className="input" type="file" accept={acceptPdf.join(',')} disabled={busy} onChange={(e) => setToImgFile(e.target.files?.[0] || null)} />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="field" style={{ width: 220 }}>
              <label>Scale</label>
              <input className="input" type="range" min="0.8" max="3" step="0.1" value={toImgScale} onChange={(e) => setToImgScale(Number(e.target.value))} disabled={busy} />
            </div>
            <button className="button" type="button" onClick={runPdfToImages} disabled={busy || !toImgFile}>
              Convert & download ZIP
            </button>
          </div>
        </section>
      ) : null}

      {tool === 'imgtopdf' ? (
        <section className="panel">
          <h2>Images to PDF</h2>
          <FileDrop label="Drop images" hint="Each image becomes one page" accept={['image/*']} multiple disabled={imgToPdfBusy} onFiles={setImgFiles} />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={runImagesToPdf} disabled={imgToPdfBusy || !imgFiles.length}>
              Build PDF
            </button>
            <DownloadButton blob={imgToPdfOut} filename={imgToPdfName} disabled={!imgToPdfOut}>
              Download PDF
            </DownloadButton>
          </div>
          {imgToPdfBusy || imgToPdfProgress > 0 ? <ProgressBar value={imgToPdfProgress} label={imgToPdfBusy ? 'Building' : 'Last run'} /> : null}
          <Preview title="Selected images">
            {imgFiles.length ? (
              <div className="table">
                <div className="table__row table__row--head" style={{ gridTemplateColumns: '1fr 120px' }}>
                  <div>Name</div>
                  <div className="right">Size</div>
                </div>
                {imgFiles.map((f) => (
                  <div key={f.name + f.size + f.lastModified} className="table__row" style={{ gridTemplateColumns: '1fr 120px' }}>
                    <div className="mono">{f.name}</div>
                    <div className="right">{formatBytes(f.size)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">No images selected.</div>
            )}
          </Preview>
        </section>
      ) : null}

      {tool === 'scan' ? (
        <section className="panel">
          <h2>Scanned PDF Converter</h2>
          <p className="muted">
            Turns a normal PDF into a “scanned” looking PDF by rasterizing pages locally and re-embedding them.
            This removes selectable text (like a real scan).
          </p>
          <div className="field">
            <label>Pick a PDF</label>
            <input
              className="input"
              type="file"
              accept={acceptPdf.join(',')}
              disabled={scanBusy}
              onChange={(e) => setScanFile(e.target.files?.[0] || null)}
            />
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Scan settings</div>
              <div className="two">
                <div className="field">
                  <label>Render scale</label>
                  <input
                    className="input"
                    type="range"
                    min="0.8"
                    max="3"
                    step="0.1"
                    value={scanOpts.scale}
                    disabled={scanBusy}
                    onChange={(e) => setScanOpts((s) => ({ ...s, scale: Number(e.target.value) }))}
                  />
                </div>
                <div className="field">
                  <label>JPEG quality</label>
                  <input
                    className="input"
                    type="range"
                    min="0.35"
                    max="0.95"
                    step="0.01"
                    value={scanOpts.jpegQuality}
                    disabled={scanBusy}
                    onChange={(e) => setScanOpts((s) => ({ ...s, jpegQuality: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div className="row">
                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={scanOpts.grayscale}
                    disabled={scanBusy}
                    onChange={(e) => setScanOpts((s) => ({ ...s, grayscale: e.target.checked }))}
                  />
                  <span className="muted">Grayscale</span>
                </label>
                <div className="field" style={{ width: 220 }}>
                  <label>Noise</label>
                  <input
                    className="input"
                    type="range"
                    min="0"
                    max="0.25"
                    step="0.01"
                    value={scanOpts.noise}
                    disabled={scanBusy}
                    onChange={(e) => setScanOpts((s) => ({ ...s, noise: Number(e.target.value) }))}
                  />
                </div>
                <div className="field" style={{ width: 220 }}>
                  <label>Blur</label>
                  <input
                    className="input"
                    type="range"
                    min="0"
                    max="3"
                    step="0.1"
                    value={scanOpts.blur}
                    disabled={scanBusy}
                    onChange={(e) => setScanOpts((s) => ({ ...s, blur: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div className="two">
                <div className="field">
                  <label>Contrast</label>
                  <input
                    className="input"
                    type="range"
                    min="50"
                    max="160"
                    step="1"
                    value={scanOpts.contrast}
                    disabled={scanBusy}
                    onChange={(e) => setScanOpts((s) => ({ ...s, contrast: Number(e.target.value) }))}
                  />
                </div>
                <div className="field">
                  <label>Brightness</label>
                  <input
                    className="input"
                    type="range"
                    min="50"
                    max="160"
                    step="1"
                    value={scanOpts.brightness}
                    disabled={scanBusy}
                    onChange={(e) => setScanOpts((s) => ({ ...s, brightness: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="button" type="button" onClick={runScanPdf} disabled={scanBusy || !scanFile}>
                  {scanBusy ? 'Converting...' : 'Convert & download'}
                </button>
              </div>
              {scanBusy || scanProgress > 0 ? <ProgressBar value={scanProgress} label={scanBusy ? 'Scanning' : 'Last run'} /> : null}
            </div>
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Notes</div>
              <div className="muted">
                Output PDF is image-based. Search/copy text will not work. This is intentional for a “scan” effect.
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
