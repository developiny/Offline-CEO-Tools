export function formatBytes(bytes) {
  const n = Number(bytes || 0)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const val = n / Math.pow(1024, i)
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
}

async function downloadBlobInTauri(blob, filename) {
  const [{ save }, { writeFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ])
  const defaultName = String(filename || 'download.bin').trim() || 'download.bin'
  const selectedPath = await save({
    title: 'Save Result File',
    defaultPath: defaultName,
    canCreateDirectories: true,
  })
  if (!selectedPath) return
  const bytes = new Uint8Array(await blob.arrayBuffer())
  await writeFile(selectedPath, bytes)
}

export async function downloadBlob(blob, filename) {
  if (isTauriRuntime()) {
    await downloadBlobInTauri(blob, filename)
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function readAsArrayBuffer(file) {
  return await file.arrayBuffer()
}

export async function readAsText(file) {
  return await file.text()
}

export function extname(name = '') {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}
