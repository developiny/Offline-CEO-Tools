const enc = new TextEncoder()

function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function hashText(algorithm, text) {
  const data = enc.encode(text || '')
  const digest = await crypto.subtle.digest(algorithm, data)
  return toHex(digest)
}

export async function hashBytes(algorithm, bytes) {
  const digest = await crypto.subtle.digest(algorithm, bytes)
  return toHex(digest)
}

export async function hashFileSha256(file) {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return toHex(digest)
}

export async function hashFile(algorithm, file) {
  const buf = await file.arrayBuffer()
  return await hashBytes(algorithm, buf)
}
