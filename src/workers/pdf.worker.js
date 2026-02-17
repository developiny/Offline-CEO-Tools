import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function parseNumber(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function parsePageRanges(spec, maxPages) {
  // spec like: "1-3,5,7-"
  const max = Math.max(0, Math.floor(maxPages))
  const out = new Set()
  const s = String(spec || '').trim()
  if (!s) return []
  for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+)?)?$/)
    if (!m) continue
    const a = Math.max(1, Math.min(max, parseInt(m[1], 10)))
    const b = m[2] ? Math.max(1, Math.min(max, parseInt(m[2], 10))) : null
    if (!m[2]) {
      out.add(a - 1)
      continue
    }
    const end = b === null ? max : b
    for (let i = a; i <= end; i++) out.add(i - 1)
  }
  return Array.from(out).sort((x, y) => x - y)
}

function parseReorder(spec, maxPages) {
  // spec like: "3,1,2" (1-based)
  const max = Math.max(0, Math.floor(maxPages))
  const parts = String(spec || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const out = []
  for (const p of parts) {
    const n = parseInt(p, 10)
    if (!Number.isFinite(n)) continue
    if (n < 1 || n > max) continue
    out.push(n - 1)
  }
  return out
}

async function mergePdfs(items) {
  const out = await PDFDocument.create()
  for (const it of items) {
    const src = await PDFDocument.load(it.data)
    const pages = await out.copyPages(src, src.getPageIndices())
    for (const p of pages) out.addPage(p)
  }
  const ab = await out.save()
  return ab.buffer
}

async function splitEach(pdfBytes, baseName) {
  const src = await PDFDocument.load(pdfBytes)
  const total = src.getPageCount()
  for (let i = 0; i < total; i++) {
    const d = await PDFDocument.create()
    const [p] = await d.copyPages(src, [i])
    d.addPage(p)
    const out = await d.save()
    self.postMessage({ type: 'item', name: `${baseName}-page-${i + 1}.pdf`, ab: out.buffer }, [out.buffer])
    self.postMessage({ type: 'progress', value: (i + 1) / Math.max(1, total) })
  }
  self.postMessage({ type: 'done' })
}

async function splitRanges(pdfBytes, baseName, rangesSpec) {
  const src = await PDFDocument.load(pdfBytes)
  const total = src.getPageCount()
  const pages = parsePageRanges(rangesSpec, total)
  if (!pages.length) throw new Error('No valid pages/ranges.')

  // Produce one PDF containing the selected pages.
  const d = await PDFDocument.create()
  const copied = await d.copyPages(src, pages)
  for (const p of copied) d.addPage(p)
  const out = await d.save()
  self.postMessage({ type: 'item', name: `${baseName}-pages.pdf`, ab: out.buffer }, [out.buffer])
  self.postMessage({ type: 'done' })
}

async function transformPdf(pdfBytes, ops) {
  const pdf = await PDFDocument.load(pdfBytes)
  const total = pdf.getPageCount()

  // delete pages
  if (ops?.deleteSpec) {
    const del = new Set(parsePageRanges(ops.deleteSpec, total))
    // Remove from end so indices remain valid.
    const toRemove = Array.from(del).sort((a, b) => b - a)
    for (const i of toRemove) pdf.removePage(i)
  }

  // rotate pages
  if (ops?.rotateSpec) {
    const pages = parsePageRanges(ops.rotateSpec, pdf.getPageCount())
    const angle = parseNumber(ops.rotateDegrees, 0)
    for (const i of pages) {
      const p = pdf.getPage(i)
      const cur = p.getRotation().angle || 0
      p.setRotation(degrees((cur + angle) % 360))
    }
  }

  // reorder
  if (ops?.reorderSpec) {
    const count = pdf.getPageCount()
    const order = parseReorder(ops.reorderSpec, count)
    if (order.length) {
      const newDoc = await PDFDocument.create()
      const copied = await newDoc.copyPages(pdf, order)
      for (const p of copied) newDoc.addPage(p)
      pdfBytes = await newDoc.save()
      // swap
      return await transformPdf(pdfBytes, { ...ops, reorderSpec: '' })
    }
  }

  // text/watermark/page numbers
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pageCount = pdf.getPageCount()

  // Add image (overlay) to pages.
  if (ops?.addImage?.enabled && ops.addImage.data) {
    const type = String(ops.addImage.type || 'image/png')
    const bytes = ops.addImage.data instanceof ArrayBuffer ? new Uint8Array(ops.addImage.data) : new Uint8Array(ops.addImage.data)
    const embedded = type.includes('jpeg') || type.includes('jpg')
      ? await pdf.embedJpg(bytes)
      : await pdf.embedPng(bytes)

    const opacity = clamp(parseNumber(ops.addImage.opacity, 0.35), 0, 1)
    const scale = clamp(parseNumber(ops.addImage.scale, 0.25), 0.02, 1.5)
    const pos = ops.addImage.position || 'br'
    const margin = clamp(parseNumber(ops.addImage.margin, 24), 0, 200)
    const spec = ops.addImage.pages || ''
    const pages = spec ? parsePageRanges(spec, pageCount) : [...Array(pageCount).keys()]

    for (const i of pages) {
      const page = pdf.getPage(i)
      const { width, height } = page.getSize()
      const w = embedded.width * scale
      const h = embedded.height * scale

      let x = margin
      let y = margin
      if (pos === 'tr') {
        x = width - margin - w
        y = height - margin - h
      } else if (pos === 'bl') {
        x = margin
        y = margin
      } else if (pos === 'br') {
        x = width - margin - w
        y = margin
      } else if (pos === 'tl') {
        x = margin
        y = height - margin - h
      } else if (pos === 'center') {
        x = (width - w) / 2
        y = (height - h) / 2
      }
      page.drawImage(embedded, { x, y, width: w, height: h, opacity })
    }
  }

  if (ops?.addText?.enabled) {
    const t = String(ops.addText.text || '')
    const x = parseNumber(ops.addText.x, 40)
    const y = parseNumber(ops.addText.y, 40)
    const size = clamp(parseNumber(ops.addText.size, 18), 6, 96)
    const color = ops.addText.color || { r: 0, g: 0, b: 0 }
    const opacity = clamp(parseNumber(ops.addText.opacity, 1), 0, 1)
    const spec = ops.addText.pages || ''
    const pages = spec ? parsePageRanges(spec, pageCount) : [...Array(pageCount).keys()]
    for (const i of pages) {
      const page = pdf.getPage(i)
      page.drawText(t, {
        x,
        y,
        size,
        font,
        color: rgb(color.r, color.g, color.b),
        opacity,
      })
    }
  }

  if (ops?.watermark?.enabled) {
    const t = String(ops.watermark.text || '')
    const size = clamp(parseNumber(ops.watermark.size, 48), 8, 200)
    const opacity = clamp(parseNumber(ops.watermark.opacity, 0.2), 0, 1)
    const angle = parseNumber(ops.watermark.rotate, -30)
    for (let i = 0; i < pageCount; i++) {
      const page = pdf.getPage(i)
      const { width, height } = page.getSize()
      page.drawText(t, {
        x: width * 0.15,
        y: height * 0.5,
        size,
        font,
        color: rgb(0.6, 0.6, 0.6),
        opacity,
        rotate: degrees(angle),
      })
    }
  }

  if (ops?.pageNumbers?.enabled) {
    const start = parseNumber(ops.pageNumbers.start, 1)
    const size = clamp(parseNumber(ops.pageNumbers.size, 12), 6, 40)
    const margin = clamp(parseNumber(ops.pageNumbers.margin, 24), 0, 120)
    const position = ops.pageNumbers.position || 'br' // bl|br|tr|tl
    for (let i = 0; i < pageCount; i++) {
      const page = pdf.getPage(i)
      const { width, height } = page.getSize()
      const label = String(start + i)
      const textWidth = font.widthOfTextAtSize(label, size)
      let x = margin
      let y = margin
      if (position === 'br') {
        x = width - margin - textWidth
        y = margin
      } else if (position === 'tr') {
        x = width - margin - textWidth
        y = height - margin - size
      } else if (position === 'tl') {
        x = margin
        y = height - margin - size
      }
      page.drawText(label, { x, y, size, font, color: rgb(0.2, 0.2, 0.2) })
    }
  }

  const out = await pdf.save()
  return out.buffer
}

self.onmessage = async (e) => {
  const msg = e.data || {}
  try {
    if (msg.type === 'merge') {
      const ab = await mergePdfs(msg.items || [])
      self.postMessage({ type: 'result', ab }, [ab])
      return
    }

    if (msg.type === 'split-each') {
      await splitEach(msg.data, msg.baseName || 'split')
      return
    }

    if (msg.type === 'split-ranges') {
      await splitRanges(msg.data, msg.baseName || 'split', msg.ranges || '')
      return
    }

    if (msg.type === 'transform') {
      const ab = await transformPdf(msg.data, msg.ops || {})
      self.postMessage({ type: 'result', ab }, [ab])
      return
    }

    self.postMessage({ type: 'error', message: 'Unknown worker message.' })
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) })
  }
}
