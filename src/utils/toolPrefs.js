const FAV_KEY = 'oct:favorites:v1'
const REC_KEY = 'oct:recent:v1'

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const v = JSON.parse(raw)
    return v ?? fallback
  } catch {
    return fallback
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore
  }
}

export function toolKey(route, toolId) {
  return `${route}:${toolId}`
}

export function getFavorites() {
  const list = loadJson(FAV_KEY, [])
  return Array.isArray(list) ? list : []
}

export function isFavorite(key) {
  return getFavorites().some((x) => x.key === key)
}

export function toggleFavorite(entry) {
  const list = getFavorites()
  const idx = list.findIndex((x) => x.key === entry.key)
  if (idx >= 0) list.splice(idx, 1)
  else list.unshift({ key: entry.key, label: entry.label, path: entry.path, tool: entry.tool, ts: Date.now() })
  saveJson(FAV_KEY, list.slice(0, 50))
  return list
}

export function getRecent() {
  const list = loadJson(REC_KEY, [])
  return Array.isArray(list) ? list : []
}

export function addRecent(entry) {
  const list = getRecent().filter((x) => x.key !== entry.key)
  list.unshift({ key: entry.key, label: entry.label, path: entry.path, tool: entry.tool, ts: Date.now() })
  saveJson(REC_KEY, list.slice(0, 30))
  return list
}

