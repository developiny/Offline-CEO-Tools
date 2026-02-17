function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

export function parseHex(input) {
  const s = String(input || '').trim()
  if (!s) return null
  const m = s.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (!m) return null
  let hex = m[1].toLowerCase()
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('') + 'ff'
  else if (hex.length === 4) hex = hex.split('').map((c) => c + c).join('')
  else if (hex.length === 6) hex = hex + 'ff'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const a = parseInt(hex.slice(6, 8), 16) / 255
  return { r, g, b, a }
}

export function toHex({ r, g, b }) {
  const rr = clamp(Math.round(r), 0, 255).toString(16).padStart(2, '0')
  const gg = clamp(Math.round(g), 0, 255).toString(16).padStart(2, '0')
  const bb = clamp(Math.round(b), 0, 255).toString(16).padStart(2, '0')
  return `#${rr}${gg}${bb}`.toUpperCase()
}

export function rgbaToHex({ r, g, b, a }, { includeAlpha = false } = {}) {
  const base = toHex({ r, g, b })
  if (!includeAlpha) return base
  const aa = clamp(Math.round(clamp(Number(a) || 1, 0, 1) * 255), 0, 255)
    .toString(16)
    .padStart(2, '0')
  return (base + aa).toUpperCase()
}

export function rgbToHsl({ r, g, b }) {
  const rr = clamp(r / 255, 0, 1)
  const gg = clamp(g / 255, 0, 1)
  const bb = clamp(b / 255, 0, 1)
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const d = max - min
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === rr) h = ((gg - bb) / d) % 6
    else if (max === gg) h = (bb - rr) / d + 2
    else h = (rr - gg) / d + 4
    h *= 60
    if (h < 0) h += 360
  }

  return { h, s, l }
}

export function hslToRgb({ h, s, l }) {
  const hh = ((Number(h) || 0) % 360 + 360) % 360
  const ss = clamp(Number(s) || 0, 0, 1)
  const ll = clamp(Number(l) || 0, 0, 1)

  const c = (1 - Math.abs(2 * ll - 1)) * ss
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = ll - c / 2
  let r1 = 0
  let g1 = 0
  let b1 = 0

  if (hh < 60) [r1, g1, b1] = [c, x, 0]
  else if (hh < 120) [r1, g1, b1] = [x, c, 0]
  else if (hh < 180) [r1, g1, b1] = [0, c, x]
  else if (hh < 240) [r1, g1, b1] = [0, x, c]
  else if (hh < 300) [r1, g1, b1] = [x, 0, c]
  else [r1, g1, b1] = [c, 0, x]

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
}

export function mix(a, b, t) {
  const tt = clamp(Number(t) || 0, 0, 1)
  return {
    r: Math.round(a.r + (b.r - a.r) * tt),
    g: Math.round(a.g + (b.g - a.g) * tt),
    b: Math.round(a.b + (b.b - a.b) * tt),
    a: (a.a ?? 1) + ((b.a ?? 1) - (a.a ?? 1)) * tt,
  }
}

export function bestTextColor(rgb) {
  // Relative luminance heuristic for readable text on a solid bg.
  const r = clamp(rgb.r / 255, 0, 1)
  const g = clamp(rgb.g / 255, 0, 1)
  const b = clamp(rgb.b / 255, 0, 1)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.55 ? '#0B0E14' : '#FFFFFF'
}

