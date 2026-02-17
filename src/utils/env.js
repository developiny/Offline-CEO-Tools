export function parseEnv(text) {
  const lines = String(text || '').split(/\r?\n/)
  const entries = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) {
      entries.push({ type: 'blank', raw })
      continue
    }
    if (/^\s*#/.test(raw)) {
      entries.push({ type: 'comment', raw })
      continue
    }
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) {
      entries.push({ type: 'unknown', raw })
      continue
    }
    const key = m[1]
    let value = m[2] || ''
    // Strip matching quotes
    const q = value[0]
    if ((q === '"' || q === "'") && value[value.length - 1] === q) value = value.slice(1, -1)
    entries.push({ type: 'pair', key, value, raw })
  }
  return entries
}

export function stringifyEnv(entries, opts) {
  const preserveComments = opts?.preserveComments !== false
  const preserveUnknown = opts?.preserveUnknown !== false
  const quote = opts?.quote || 'auto' // auto|always|never

  const out = []
  for (const e of entries) {
    if (e.type === 'pair') {
      let v = String(e.value ?? '')
      const needsQuote = /\s|#|=|"/.test(v)
      if (quote === 'always' || (quote === 'auto' && needsQuote)) v = JSON.stringify(v)
      out.push(`${e.key}=${v}`)
    } else if (e.type === 'comment' || e.type === 'blank') {
      if (preserveComments) out.push(e.raw)
    } else {
      if (preserveUnknown) out.push(e.raw)
    }
  }
  return out.join('\n')
}

export function sortEnv(entries, opts) {
  const pairs = entries.filter((e) => e.type === 'pair')
  const others = entries.filter((e) => e.type !== 'pair')
  pairs.sort((a, b) => a.key.localeCompare(b.key))
  if (opts?.keepOtherLines) return [...others, ...pairs]
  return pairs
}

export function dedupeEnv(entries, opts) {
  const strategy = opts?.strategy || 'last' // first|last
  const map = new Map()
  const order = []
  for (const e of entries) {
    if (e.type !== 'pair') continue
    if (!map.has(e.key)) order.push(e.key)
    if (strategy === 'first') {
      if (!map.has(e.key)) map.set(e.key, e)
    } else {
      map.set(e.key, e)
    }
  }
  return order.map((k) => map.get(k))
}

