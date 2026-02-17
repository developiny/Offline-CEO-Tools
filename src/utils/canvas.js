export function createCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(width))
  canvas.height = Math.max(1, Math.floor(height))
  const ctx = canvas.getContext('2d', { alpha: true })
  return { canvas, ctx }
}

export async function loadImageFromFile(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImageFromUrl(url)
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}

