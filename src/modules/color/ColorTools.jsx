import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ToolTabs from '../../components/ToolTabs.jsx'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import { addRecent, toolKey } from '../../utils/toolPrefs.js'
import { bestTextColor, hslToRgb, mix, parseHex, rgbToHsl, rgbaToHex, toHex } from '../../utils/color.js'

const TOOLS = [
  { id: 'hex', label: 'HEX ↔ RGBA' },
  { id: 'shades', label: 'Shades' },
  { id: 'mixer', label: 'Mixer' },
  { id: 'palette', label: 'Palette' },
]

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function fmtRgba({ r, g, b, a }) {
  const na = Number(a)
  const aa = clamp(Number.isFinite(na) ? na : 1, 0, 1)
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(aa * 1000) / 1000})`
}

function swatchStyle(hex) {
  const rgb = parseHex(hex) || { r: 0, g: 0, b: 0, a: 1 }
  return {
    background: rgbaToHex(rgb),
    color: bestTextColor(rgb),
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: 12,
    padding: '10px 12px',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: 12,
  }
}

export default function ColorTools() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tool, setTool] = useState('hex')

  useEffect(() => {
    const t = searchParams.get('tool')
    if (t && TOOLS.some((x) => x.id === t)) setTool(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p)
      next.set('tool', tool)
      return next
    })
    const t = TOOLS.find((x) => x.id === tool)
    if (t) {
      addRecent({
        key: toolKey('color', tool),
        label: `Color: ${t.label}`,
        path: `/color?tool=${tool}`,
        tool,
      })
      window.dispatchEvent(new Event('oct:prefs'))
    }
  }, [tool, setSearchParams])

  // HEX <-> RGBA
  const [hexIn, setHexIn] = useState('#F8D46B')
  const [rgbaIn, setRgbaIn] = useState({ r: 248, g: 212, b: 107, a: 1 })
  const parsedHex = useMemo(() => parseHex(hexIn), [hexIn])
  useEffect(() => {
    if (!parsedHex) return
    setRgbaIn(parsedHex)
  }, [parsedHex])

  const rgbaHex6 = useMemo(() => rgbaToHex(rgbaIn), [rgbaIn])
  const rgbaHex8 = useMemo(() => rgbaToHex(rgbaIn, { includeAlpha: true }), [rgbaIn])
  const rgbaStr = useMemo(() => fmtRgba(rgbaIn), [rgbaIn])
  const hsl = useMemo(() => rgbToHsl(rgbaIn), [rgbaIn])

  // Shades
  const [base, setBase] = useState('#7EE4FF')
  const [steps, setSteps] = useState(9)
  const [spread, setSpread] = useState(0.35) // +/- lightness delta
  const shades = useMemo(() => {
    const p = parseHex(base)
    if (!p) return []
    const { h, s, l } = rgbToHsl(p)
    const n = clamp(Math.floor(Number(steps) || 9), 2, 21)
    const d = clamp(Number(spread) || 0.35, 0.05, 0.8)
    const out = []
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const ll = clamp(l - d + t * (2 * d), 0, 1)
      out.push(toHex(hslToRgb({ h, s, l: ll })))
    }
    return out
  }, [base, steps, spread])

  // Mixer
  const [mixA, setMixA] = useState('#FF6B6B')
  const [mixB, setMixB] = useState('#7EE4FF')
  const [mixSteps, setMixSteps] = useState(7)
  const mixes = useMemo(() => {
    const a = parseHex(mixA)
    const b = parseHex(mixB)
    if (!a || !b) return []
    const n = clamp(Math.floor(Number(mixSteps) || 7), 2, 21)
    return Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1)
      return toHex(mix(a, b, t))
    })
  }, [mixA, mixB, mixSteps])

  // Palette (non-AI)
  const [palBase, setPalBase] = useState('#F8D46B')
  const [palMode, setPalMode] = useState('complementary') // complementary|analogous|triadic|tetradic|monochrome
  const [palCount, setPalCount] = useState(5)
  const palette = useMemo(() => {
    const p = parseHex(palBase)
    if (!p) return []
    const { h, s, l } = rgbToHsl(p)
    const n = clamp(Math.floor(Number(palCount) || 5), 2, 12)
    const out = []

    const pushHsl = (hh, ss, ll) => out.push(toHex(hslToRgb({ h: hh, s: clamp(ss, 0, 1), l: clamp(ll, 0, 1) })))

    if (palMode === 'complementary') {
      pushHsl(h, s, l)
      pushHsl(h + 180, s, l)
      // add accents around base for extra slots
      for (let i = 2; i < n; i++) pushHsl(h + (i % 2 ? 25 : -25) * i, s * 0.85, clamp(l + (i % 2 ? 0.08 : -0.08), 0, 1))
      return out.slice(0, n)
    }
    if (palMode === 'analogous') {
      const span = 35
      for (let i = 0; i < n; i++) {
        const t = i / Math.max(1, n - 1)
        pushHsl(h - span + t * (2 * span), s, l)
      }
      return out
    }
    if (palMode === 'triadic') {
      pushHsl(h, s, l)
      pushHsl(h + 120, s, l)
      pushHsl(h + 240, s, l)
      for (let i = 3; i < n; i++) pushHsl(h + (i * 18), clamp(s * 0.9, 0, 1), clamp(l + (i % 2 ? 0.1 : -0.1), 0, 1))
      return out.slice(0, n)
    }
    if (palMode === 'tetradic') {
      pushHsl(h, s, l)
      pushHsl(h + 60, s, l)
      pushHsl(h + 180, s, l)
      pushHsl(h + 240, s, l)
      for (let i = 4; i < n; i++) pushHsl(h + i * 12, clamp(s * 0.88, 0, 1), clamp(l + (i % 2 ? 0.08 : -0.08), 0, 1))
      return out.slice(0, n)
    }
    // monochrome
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1)
      pushHsl(h, clamp(s * (0.7 + t * 0.3), 0, 1), clamp(0.18 + t * 0.68, 0, 1))
    }
    return out
  }, [palBase, palMode, palCount])

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(String(text || ''))
    } catch {
      // ignore
    }
  }

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>Color Tools</h1>
        <p className="muted">Everything runs locally in your browser. Nothing is sent anywhere.</p>
      </div>

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <ToolTabs tools={TOOLS} activeId={tool} onChange={setTool} />
          <FavoriteButton
            entry={{
              key: toolKey('color', tool),
              label: `Color: ${TOOLS.find((x) => x.id === tool)?.label || tool}`,
              path: `/color?tool=${tool}`,
              tool,
            }}
          />
        </div>
      </section>

      {tool === 'hex' ? (
        <section className="panel">
          <h2>HEX ↔ RGBA</h2>
          <div className="two">
            <div className="field">
              <label>HEX</label>
              <input className="input mono" value={hexIn} onChange={(e) => setHexIn(e.target.value)} placeholder="#RRGGBB or #RRGGBBAA" />
              <div className="row" style={{ marginTop: 10 }}>
                <div style={swatchStyle(parsedHex ? rgbaToHex(parsedHex) : '#000000')}>{parsedHex ? rgbaToHex(parsedHex) : 'Invalid'}</div>
                <button className="button button--ghost" type="button" onClick={() => copy(parsedHex ? rgbaToHex(parsedHex) : '')} disabled={!parsedHex}>
                  Copy
                </button>
              </div>
            </div>
            <div className="field">
              <label>RGBA</label>
              <div className="row">
                <input className="input mono" style={{ width: 110 }} type="number" value={rgbaIn.r} onChange={(e) => setRgbaIn((s) => ({ ...s, r: Number(e.target.value) }))} />
                <input className="input mono" style={{ width: 110 }} type="number" value={rgbaIn.g} onChange={(e) => setRgbaIn((s) => ({ ...s, g: Number(e.target.value) }))} />
                <input className="input mono" style={{ width: 110 }} type="number" value={rgbaIn.b} onChange={(e) => setRgbaIn((s) => ({ ...s, b: Number(e.target.value) }))} />
                <input className="input mono" style={{ width: 110 }} type="number" min="0" max="1" step="0.01" value={rgbaIn.a} onChange={(e) => setRgbaIn((s) => ({ ...s, a: Number(e.target.value) }))} />
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <div style={swatchStyle(rgbaHex6)}>{rgbaHex6}</div>
                <div style={swatchStyle(rgbaHex8)}>{rgbaHex8}</div>
                <button className="button button--ghost" type="button" onClick={() => copy(rgbaStr)}>Copy rgba()</button>
              </div>
              <div className="panel" style={{ marginTop: 10, padding: 12 }}>
                <div className="mono muted" style={{ marginBottom: 6 }}>HSL</div>
                <div className="mono" style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>
                  h: {Math.round(hsl.h)}°, s: {Math.round(hsl.s * 100)}%, l: {Math.round(hsl.l * 100)}%
                </div>
              </div>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Tip: HEX supports `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`.
          </p>
        </section>
      ) : null}

      {tool === 'shades' ? (
        <section className="panel">
          <h2>Color Shades Generator</h2>
          <div className="row">
            <div className="field" style={{ width: 220 }}>
              <label>Base</label>
              <input className="input mono" value={base} onChange={(e) => setBase(e.target.value)} />
            </div>
            <div className="field" style={{ width: 180 }}>
              <label>Steps</label>
              <input className="input" type="number" value={steps} onChange={(e) => setSteps(e.target.value)} />
            </div>
            <div className="field" style={{ width: 260 }}>
              <label>Spread</label>
              <input className="input" type="range" min="0.05" max="0.8" step="0.01" value={spread} onChange={(e) => setSpread(Number(e.target.value))} />
            </div>
            <button className="button button--ghost" type="button" onClick={() => copy(shades.join('\n'))} disabled={!shades.length}>
              Copy list
            </button>
          </div>
          <div className="grid" style={{ marginTop: 12 }}>
            {shades.map((c) => (
              <div key={c} className="card" style={{ gridColumn: 'span 6', padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div style={swatchStyle(c)}>{c}</div>
                  <button className="button button--ghost" type="button" onClick={() => copy(c)}>Copy</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tool === 'mixer' ? (
        <section className="panel">
          <h2>Color Mixer</h2>
          <div className="row">
            <div className="field" style={{ width: 220 }}>
              <label>Color A</label>
              <input className="input mono" value={mixA} onChange={(e) => setMixA(e.target.value)} />
            </div>
            <div className="field" style={{ width: 220 }}>
              <label>Color B</label>
              <input className="input mono" value={mixB} onChange={(e) => setMixB(e.target.value)} />
            </div>
            <div className="field" style={{ width: 180 }}>
              <label>Steps</label>
              <input className="input" type="number" value={mixSteps} onChange={(e) => setMixSteps(e.target.value)} />
            </div>
            <button className="button button--ghost" type="button" onClick={() => copy(mixes.join('\n'))} disabled={!mixes.length}>
              Copy list
            </button>
          </div>
          <div className="grid" style={{ marginTop: 12 }}>
            {mixes.map((c) => (
              <div key={c} className="card" style={{ gridColumn: 'span 6', padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div style={swatchStyle(c)}>{c}</div>
                  <button className="button button--ghost" type="button" onClick={() => copy(c)}>Copy</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tool === 'palette' ? (
        <section className="panel">
          <h2>Palette Generator (Offline)</h2>
          <div className="row">
            <div className="field" style={{ width: 220 }}>
              <label>Base</label>
              <input className="input mono" value={palBase} onChange={(e) => setPalBase(e.target.value)} />
            </div>
            <div className="field" style={{ width: 260 }}>
              <label>Mode</label>
              <select className="select" value={palMode} onChange={(e) => setPalMode(e.target.value)}>
                <option value="complementary">Complementary</option>
                <option value="analogous">Analogous</option>
                <option value="triadic">Triadic</option>
                <option value="tetradic">Tetradic</option>
                <option value="monochrome">Monochrome</option>
              </select>
            </div>
            <div className="field" style={{ width: 180 }}>
              <label>Count</label>
              <input className="input" type="number" value={palCount} onChange={(e) => setPalCount(e.target.value)} />
            </div>
            <button className="button button--ghost" type="button" onClick={() => copy(palette.join('\n'))} disabled={!palette.length}>
              Copy list
            </button>
          </div>
          <div className="grid" style={{ marginTop: 12 }}>
            {palette.map((c) => (
              <div key={c} className="card" style={{ gridColumn: 'span 6', padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div style={swatchStyle(c)}>{c}</div>
                  <button className="button button--ghost" type="button" onClick={() => copy(c)}>Copy</button>
                </div>
              </div>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            This is not an “AI palette generator”. It uses standard color theory transforms in HSL.
          </p>
        </section>
      ) : null}
    </div>
  )
}
