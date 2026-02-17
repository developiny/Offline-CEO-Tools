function isPlainObject(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

export function flattenJson(obj, opts) {
  const sep = opts?.sep || '.'
  const out = {}
  const walk = (cur, path) => {
    if (Array.isArray(cur)) {
      for (let i = 0; i < cur.length; i++) walk(cur[i], path ? `${path}${sep}${i}` : String(i))
      if (!cur.length && path) out[path] = []
      return
    }
    if (isPlainObject(cur)) {
      const keys = Object.keys(cur)
      for (const k of keys) walk(cur[k], path ? `${path}${sep}${k}` : k)
      if (!keys.length && path) out[path] = {}
      return
    }
    out[path || ''] = cur
  }
  walk(obj, '')
  return out
}

export function unflattenJson(map, opts) {
  const sep = opts?.sep || '.'
  const out = {}
  for (const [k, v] of Object.entries(map || {})) {
    const parts = k === '' ? [''] : k.split(sep)
    let cur = out
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      const last = i === parts.length - 1
      const idx = p !== '' && String(Number(p)) === p ? Number(p) : null

      if (last) {
        if (idx !== null) {
          if (!Array.isArray(cur)) cur = []
          cur[idx] = v
        } else {
          cur[p] = v
        }
        continue
      }

      const nextPart = parts[i + 1]
      const nextIsIndex = nextPart !== '' && String(Number(nextPart)) === nextPart
      const nextContainer = nextIsIndex ? [] : {}

      if (idx !== null) {
        if (!Array.isArray(cur)) {
          // Convert object to array-like if needed
          // This is a best-effort; for mixed structures prefer JSONPath tool.
        }
        if (!cur[idx]) cur[idx] = nextContainer
        cur = cur[idx]
      } else {
        if (!cur[p]) cur[p] = nextContainer
        cur = cur[p]
      }
    }
  }
  return out
}

