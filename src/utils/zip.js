import { strToU8, zipSync } from 'fflate'

function normalizePath(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|]+/g, '_')
}

export async function zipBlobs(entries) {
  // entries: [{ name, blob }]
  const files = {}
  for (const e of entries) {
    const ab = await e.blob.arrayBuffer()
    files[normalizePath(e.name)] = new Uint8Array(ab)
  }
  const zipped = zipSync(files, { level: 6 })
  return new Blob([zipped], { type: 'application/zip' })
}

export function zipTextFiles(entries) {
  // entries: [{ name, text }]
  const files = {}
  for (const e of entries) files[normalizePath(e.name)] = strToU8(String(e.text || ''), true)
  const zipped = zipSync(files, { level: 6 })
  return new Blob([zipped], { type: 'application/zip' })
}

