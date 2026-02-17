let _pdfjsPromise = null

async function getPdfjs() {
  if (_pdfjsPromise) return _pdfjsPromise
  _pdfjsPromise = (async () => {
    // Keep pdf.js out of the initial bundle. This will code-split into a separate chunk.
    const pdfjs = await import('pdfjs-dist/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
    return pdfjs
  })()
  return _pdfjsPromise
}

export async function loadPdfFromArrayBuffer(ab) {
  const pdfjs = await getPdfjs()
  const task = pdfjs.getDocument({ data: ab })
  return await task.promise
}

export async function renderPdfPageToCanvas(pdf, pageNumber, canvas, scale = 1.2) {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const ctx = canvas.getContext('2d', { alpha: false })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const renderTask = page.render({ canvasContext: ctx, viewport })
  await renderTask.promise
}

export async function renderPdfPageToDataUrl(pdf, pageNumber, scale = 0.2) {
  const canvas = document.createElement('canvas')
  await renderPdfPageToCanvas(pdf, pageNumber, canvas, scale)
  return canvas.toDataURL('image/png')
}

export async function extractPdfText(pdf) {
  const total = pdf.numPages
  const chunks = []
  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i)
    const tc = await page.getTextContent()
    const line = tc.items.map((it) => it.str).join(' ')
    chunks.push(line)
  }
  return chunks.join('\n\n')
}
