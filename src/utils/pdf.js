// Placeholder helpers. The PDF module will switch to pdf-lib + pdfjs-dist
// for editing/preview once implemented.
export function isProbablyPdf(file) {
  return file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '')
}

