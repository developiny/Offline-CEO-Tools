function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function sniffFileType(file) {
  const ab = await file.slice(0, 32).arrayBuffer()
  const bytes = new Uint8Array(ab)
  const hex = bytesToHex(bytes)

  const starts = (h) => hex.startsWith(h.toLowerCase())

  if (starts('89504e470d0a1a0a')) return { ext: 'png', mime: 'image/png', kind: 'PNG' }
  if (starts('ffd8ff')) return { ext: 'jpg', mime: 'image/jpeg', kind: 'JPEG' }
  if (starts('474946383761') || starts('474946383961')) return { ext: 'gif', mime: 'image/gif', kind: 'GIF' }
  if (starts('25504446')) return { ext: 'pdf', mime: 'application/pdf', kind: 'PDF' }
  if (starts('504b0304')) return { ext: 'zip', mime: 'application/zip', kind: 'ZIP' }
  if (starts('1f8b08')) return { ext: 'gz', mime: 'application/gzip', kind: 'GZIP' }
  if (starts('52494646') && hex.slice(16, 24) === '57454250') return { ext: 'webp', mime: 'image/webp', kind: 'WEBP' }
  if (starts('424d')) return { ext: 'bmp', mime: 'image/bmp', kind: 'BMP' }
  if (starts('0000001866747970') || starts('0000002066747970')) return { ext: 'mp4', mime: 'video/mp4', kind: 'MP4' }
  if (starts('494433')) return { ext: 'mp3', mime: 'audio/mpeg', kind: 'MP3' }

  return { ext: '', mime: file.type || 'application/octet-stream', kind: 'Unknown' }
}

