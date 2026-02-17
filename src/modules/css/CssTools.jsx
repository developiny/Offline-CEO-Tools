import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ToolTabs from '../../components/ToolTabs.jsx'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import { addRecent, toolKey } from '../../utils/toolPrefs.js'

const TOOLS = [
  { id: 'gradient', label: 'Gradient' },
  { id: 'shadow', label: 'Box Shadow' },
  { id: 'radius', label: 'Border Radius' },
  { id: 'bezier', label: 'Cubic Bezier' },
  { id: 'clip', label: 'Clip Path' },
  { id: 'pattern', label: 'Background Pattern' },
  { id: 'glass', label: 'Glassmorphism' },
  { id: 'loader', label: 'Loader' },
  { id: 'checkbox', label: 'Checkbox' },
  { id: 'switch', label: 'Switch' },
  { id: 'glitch', label: 'Text Glitch' },
  { id: 'triangle', label: 'Triangle' },
]

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(String(text || ''))
  } catch {
    // ignore
  }
}

function wrapCssBlock(selector, css) {
  const body = String(css || '').trim().replace(/\n{3,}/g, '\n\n')
  if (!body) return ''
  return `${selector} {\n${body
    .split('\n')
    .map((l) => (l.trim() ? `  ${l.trim()}` : ''))
    .join('\n')}\n}`
}

export default function CssTools() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tool, setTool] = useState('gradient')

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
        key: toolKey('css', tool),
        label: `CSS: ${t.label}`,
        path: `/css?tool=${tool}`,
        tool,
      })
      window.dispatchEvent(new Event('oct:prefs'))
    }
  }, [tool, setSearchParams])

  // Gradient
  const [gradType, setGradType] = useState('linear') // linear|radial
  const [gradAngle, setGradAngle] = useState(135)
  const [gradStops, setGradStops] = useState([
    { color: '#7EE4FF', pos: 0 },
    { color: '#F8D46B', pos: 55 },
    { color: '#FF6B6B', pos: 100 },
  ])
  const gradientCss = useMemo(() => {
    const stops = gradStops
      .map((s) => ({
        color: String(s.color || '#000000'),
        pos: clamp(Math.round(Number(s.pos) || 0), 0, 100),
      }))
      .sort((a, b) => a.pos - b.pos)
      .map((s) => `${s.color} ${s.pos}%`)
      .join(', ')
    if (gradType === 'radial') return `radial-gradient(circle at 35% 20%, ${stops})`
    return `linear-gradient(${clamp(Math.round(Number(gradAngle) || 0), 0, 360)}deg, ${stops})`
  }, [gradStops, gradType, gradAngle])

  // Shadow
  const [shInset, setShInset] = useState(false)
  const [shX, setShX] = useState(0)
  const [shY, setShY] = useState(18)
  const [shBlur, setShBlur] = useState(40)
  const [shSpread, setShSpread] = useState(0)
  const [shColor, setShColor] = useState('rgba(0,0,0,0.35)')
  const shadowCss = useMemo(() => {
    const inset = shInset ? 'inset ' : ''
    return `${inset}${Math.round(Number(shX) || 0)}px ${Math.round(Number(shY) || 0)}px ${Math.round(
      Number(shBlur) || 0,
    )}px ${Math.round(Number(shSpread) || 0)}px ${String(shColor || 'rgba(0,0,0,0.35)')}`.trim()
  }, [shInset, shX, shY, shBlur, shSpread, shColor])

  // Radius (supports elliptical via " / ")
  const [rTLx, setRTLx] = useState(18)
  const [rTRx, setRTRx] = useState(18)
  const [rBRx, setRBRx] = useState(18)
  const [rBLx, setRBLx] = useState(18)
  const [rTLy, setRTLy] = useState(18)
  const [rTRy, setRTRy] = useState(18)
  const [rBRy, setRBRy] = useState(18)
  const [rBLy, setRBLy] = useState(18)
  const radiusCss = useMemo(() => {
    const hx = `${rTLx}px ${rTRx}px ${rBRx}px ${rBLx}px`
    const vy = `${rTLy}px ${rTRy}px ${rBRy}px ${rBLy}px`
    const same = hx === vy
    return same ? hx : `${hx} / ${vy}`
  }, [rTLx, rTRx, rBRx, rBLx, rTLy, rTRy, rBRy, rBLy])

  // Bezier
  const [bx1, setBx1] = useState(0.2)
  const [by1, setBy1] = useState(0.8)
  const [bx2, setBx2] = useState(0.2)
  const [by2, setBy2] = useState(1)
  const bezierCss = useMemo(() => {
    const fmt = (v) => Math.round(clamp(Number(v) || 0, 0, 1) * 1000) / 1000
    return `cubic-bezier(${fmt(bx1)}, ${fmt(by1)}, ${fmt(bx2)}, ${fmt(by2)})`
  }, [bx1, by1, bx2, by2])

  // Clip path
  const [clipKind, setClipKind] = useState('inset') // inset|circle|polygon
  const [clipInset, setClipInset] = useState(12)
  const [clipRound, setClipRound] = useState(16)
  const [clipCircle, setClipCircle] = useState(46)
  const [clipPoly, setClipPoly] = useState('triangle') // triangle|hex|star
  const clipCss = useMemo(() => {
    if (clipKind === 'circle') return `circle(${clamp(Number(clipCircle) || 46, 5, 100)}% at 50% 50%)`
    if (clipKind === 'polygon') {
      if (clipPoly === 'hex') return 'polygon(25% 6%, 75% 6%, 95% 50%, 75% 94%, 25% 94%, 5% 50%)'
      if (clipPoly === 'star') return 'polygon(50% 3%, 61% 35%, 95% 35%, 67% 56%, 78% 90%, 50% 70%, 22% 90%, 33% 56%, 5% 35%, 39% 35%)'
      return 'polygon(50% 8%, 92% 92%, 8% 92%)'
    }
    const i = clamp(Number(clipInset) || 12, 0, 45)
    const r = clamp(Number(clipRound) || 16, 0, 80)
    return `inset(${i}% round ${r}px)`
  }, [clipKind, clipInset, clipRound, clipCircle, clipPoly])

  // Background patterns
  const [patKind, setPatKind] = useState('grid') // grid|dots|stripes
  const [patSize, setPatSize] = useState(22)
  const [patFg, setPatFg] = useState('rgba(255,255,255,0.10)')
  const [patBg, setPatBg] = useState('rgba(0,0,0,0)')
  const patternCss = useMemo(() => {
    const size = clamp(Math.round(Number(patSize) || 22), 6, 120)
    const fg = String(patFg || 'rgba(255,255,255,0.10)')
    const bg = String(patBg || 'rgba(0,0,0,0)')
    if (patKind === 'dots') {
      return `background-color: ${bg};\nbackground-image: radial-gradient(${fg} 1px, transparent 1px);\nbackground-size: ${size}px ${size}px;`
    }
    if (patKind === 'stripes') {
      return `background-color: ${bg};\nbackground-image: repeating-linear-gradient(135deg, ${fg} 0 8px, transparent 8px 16px);\nbackground-size: ${size}px ${size}px;`
    }
    // grid
    return `background-color: ${bg};\nbackground-image:\n  linear-gradient(${fg} 1px, transparent 1px),\n  linear-gradient(90deg, ${fg} 1px, transparent 1px);\nbackground-size: ${size}px ${size}px;`
  }, [patKind, patSize, patFg, patBg])

  // Glassmorphism
  const [glassTint, setGlassTint] = useState('#FFFFFF')
  const [glassOpacity, setGlassOpacity] = useState(0.12)
  const [glassBlur, setGlassBlur] = useState(14)
  const [glassBorder, setGlassBorder] = useState(0.18)
  const [glassShadow, setGlassShadow] = useState(true)
  const glassCss = useMemo(() => {
    const op = clamp(Number(glassOpacity) || 0.12, 0.02, 0.4)
    const border = clamp(Number(glassBorder) || 0.18, 0.02, 0.5)
    const blur = clamp(Math.round(Number(glassBlur) || 14), 0, 40)
    const tint = String(glassTint || '#ffffff')
    const shadow = glassShadow ? 'box-shadow: 0 20px 60px rgba(0,0,0,0.35);\n' : ''
    return `background: color-mix(in srgb, ${tint} ${Math.round(op * 100)}%, transparent);\nbackdrop-filter: blur(${blur}px);\n-webkit-backdrop-filter: blur(${blur}px);\nborder: 1px solid rgba(255,255,255,${border});\n${shadow}border-radius: 18px;`
  }, [glassTint, glassOpacity, glassBlur, glassBorder, glassShadow])

  // Loader
  const [loaderKind, setLoaderKind] = useState('spinner') // spinner|dots|bars
  const [loaderSize, setLoaderSize] = useState(42)
  const [loaderColor, setLoaderColor] = useState('#7EE4FF')
  const loader = useMemo(() => {
    const size = clamp(Math.round(Number(loaderSize) || 42), 12, 180)
    const c = String(loaderColor || '#7EE4FF')
    if (loaderKind === 'dots') {
      const html = `<div class="oct-loader oct-loader--dots" aria-label="Loading"></div>`
      const css = [
        `.oct-loader--dots {`,
        `  width: ${size}px;`,
        `  height: ${Math.max(10, Math.round(size / 4))}px;`,
        `  background: transparent;`,
        `  position: relative;`,
        `}`,
        `.oct-loader--dots::before, .oct-loader--dots::after {`,
        `  content: "";`,
        `  position: absolute;`,
        `  top: 50%;`,
        `  width: ${Math.max(8, Math.round(size / 5))}px;`,
        `  height: ${Math.max(8, Math.round(size / 5))}px;`,
        `  border-radius: 999px;`,
        `  background: ${c};`,
        `  transform: translateY(-50%);`,
        `  animation: oct-dot 900ms ease-in-out infinite;`,
        `  opacity: 0.35;`,
        `}`,
        `.oct-loader--dots::before { left: 0; }`,
        `.oct-loader--dots::after { right: 0; animation-delay: 140ms; }`,
        `.oct-loader--dots {`,
        `  background: ${c};`,
        `  border-radius: 999px;`,
        `  opacity: 0.35;`,
        `  transform: translateY(-50%);`,
        `  top: 50%;`,
        `}`,
        `@keyframes oct-dot {`,
        `  0%, 100% { transform: translateY(-50%) scale(0.85); opacity: 0.35; }`,
        `  50% { transform: translateY(-50%) scale(1.15); opacity: 0.9; }`,
        `}`,
      ].join('\n')
      return { html, css, preview: { kind: 'dots', size, c } }
    }
    if (loaderKind === 'bars') {
      const html = `<div class="oct-loader oct-loader--bars" aria-label="Loading"><span></span><span></span><span></span></div>`
      const w = Math.max(30, size)
      const h = Math.max(16, Math.round(size / 2))
      const bw = Math.max(6, Math.round(w / 7))
      const css = [
        `.oct-loader--bars { display: flex; gap: ${Math.max(4, Math.round(bw / 2))}px; align-items: flex-end; height: ${h}px; }`,
        `.oct-loader--bars span { width: ${bw}px; height: ${Math.round(h * 0.4)}px; background: ${c}; border-radius: 999px; opacity: 0.75; animation: oct-bar 900ms ease-in-out infinite; }`,
        `.oct-loader--bars span:nth-child(2) { animation-delay: 120ms; opacity: 0.55; }`,
        `.oct-loader--bars span:nth-child(3) { animation-delay: 240ms; opacity: 0.35; }`,
        `@keyframes oct-bar { 0%, 100% { transform: scaleY(0.45); } 50% { transform: scaleY(1.15); } }`,
      ].join('\n')
      return { html, css, preview: { kind: 'bars', size, c } }
    }
    // spinner
    const html = `<div class="oct-loader oct-loader--spinner" aria-label="Loading"></div>`
    const css = [
      `.oct-loader--spinner {`,
      `  width: ${size}px;`,
      `  height: ${size}px;`,
      `  border-radius: 999px;`,
      `  border: ${Math.max(3, Math.round(size / 10))}px solid rgba(255,255,255,0.14);`,
      `  border-top-color: ${c};`,
      `  animation: oct-spin 900ms linear infinite;`,
      `}`,
      `@keyframes oct-spin { to { transform: rotate(360deg); } }`,
    ].join('\n')
    return { html, css, preview: { kind: 'spinner', size, c } }
  }, [loaderKind, loaderSize, loaderColor])

  // Checkbox
  const [cbColor, setCbColor] = useState('#F8D46B')
  const [cbSize, setCbSize] = useState(22)
  const checkbox = useMemo(() => {
    const size = clamp(Math.round(Number(cbSize) || 22), 14, 48)
    const c = String(cbColor || '#F8D46B')
    const html = `<label class="oct-check"><input type="checkbox" checked /><span></span> Remember me</label>`
    const css = [
      `.oct-check { display: inline-flex; gap: 10px; align-items: center; font: 14px ui-monospace, monospace; color: rgba(255,255,255,0.86); }`,
      `.oct-check input { position: absolute; opacity: 0; width: 1px; height: 1px; }`,
      `.oct-check span { width: ${size}px; height: ${size}px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.20); background: rgba(0,0,0,0.20); position: relative; display: inline-block; }`,
      `.oct-check input:focus-visible + span { outline: 2px solid rgba(126,228,255,0.45); outline-offset: 2px; }`,
      `.oct-check input:checked + span { background: color-mix(in srgb, ${c} 22%, transparent); border-color: color-mix(in srgb, ${c} 55%, rgba(255,255,255,0.2)); }`,
      `.oct-check input:checked + span::after { content: ""; position: absolute; left: 50%; top: 50%; width: ${Math.round(
        size * 0.45,
      )}px; height: ${Math.round(size * 0.25)}px; border-left: 2px solid ${c}; border-bottom: 2px solid ${c}; transform: translate(-50%, -55%) rotate(-45deg); }`,
    ].join('\n')
    return { html, css, size, c }
  }, [cbColor, cbSize])

  // Switch
  const [swColor, setSwColor] = useState('#7EE4FF')
  const [swW, setSwW] = useState(52)
  const switcher = useMemo(() => {
    const w = clamp(Math.round(Number(swW) || 52), 34, 120)
    const h = Math.round(w * 0.56)
    const knob = h - 6
    const c = String(swColor || '#7EE4FF')
    const html = `<label class="oct-switch"><input type="checkbox" checked /><span></span> Notifications</label>`
    const css = [
      `.oct-switch { display: inline-flex; gap: 10px; align-items: center; font: 14px ui-monospace, monospace; color: rgba(255,255,255,0.86); }`,
      `.oct-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }`,
      `.oct-switch span { width: ${w}px; height: ${h}px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.20); background: rgba(0,0,0,0.20); position: relative; display: inline-block; transition: background 160ms ease, border-color 160ms ease; }`,
      `.oct-switch span::after { content: ""; position: absolute; top: 50%; left: 3px; width: ${knob}px; height: ${knob}px; border-radius: 999px; background: rgba(255,255,255,0.86); transform: translate(0, -50%); transition: transform 160ms ease; }`,
      `.oct-switch input:focus-visible + span { outline: 2px solid rgba(126,228,255,0.45); outline-offset: 2px; }`,
      `.oct-switch input:checked + span { background: color-mix(in srgb, ${c} 24%, transparent); border-color: color-mix(in srgb, ${c} 55%, rgba(255,255,255,0.2)); }`,
      `.oct-switch input:checked + span::after { transform: translate(${w - knob - 6}px, -50%); }`,
    ].join('\n')
    return { html, css, w, h, c }
  }, [swColor, swW])

  // Glitch text
  const [glText, setGlText] = useState('GLITCH')
  const [glColor, setGlColor] = useState('#FF6B6B')
  const [glAccent, setGlAccent] = useState('#7EE4FF')
  const glitch = useMemo(() => {
    const html = `<div class="oct-glitch" data-text="${String(glText || 'GLITCH').replaceAll('"', '')}">${String(
      glText || 'GLITCH',
    )}</div>`
    const css = [
      `.oct-glitch {`,
      `  position: relative;`,
      `  font: 800 44px ui-monospace, monospace;`,
      `  letter-spacing: 0.12em;`,
      `  color: ${glColor};`,
      `  text-transform: uppercase;`,
      `  display: inline-block;`,
      `}`,
      `.oct-glitch::before, .oct-glitch::after {`,
      `  content: attr(data-text);`,
      `  position: absolute;`,
      `  left: 0; top: 0;`,
      `  width: 100%;`,
      `  overflow: hidden;`,
      `  opacity: 0.75;`,
      `}`,
      `.oct-glitch::before {`,
      `  color: ${glAccent};`,
      `  transform: translate(-2px, 0);`,
      `  clip-path: inset(0 0 55% 0);`,
      `  animation: oct-glitch1 1100ms steps(2, end) infinite;`,
      `}`,
      `.oct-glitch::after {`,
      `  color: rgba(255,255,255,0.86);`,
      `  transform: translate(2px, 0);`,
      `  clip-path: inset(55% 0 0 0);`,
      `  animation: oct-glitch2 900ms steps(2, end) infinite;`,
      `}`,
      `@keyframes oct-glitch1 {`,
      `  0%, 100% { transform: translate(-2px, 0); }`,
      `  25% { transform: translate(-4px, -1px); }`,
      `  50% { transform: translate(1px, 0); }`,
      `  75% { transform: translate(-3px, 1px); }`,
      `}`,
      `@keyframes oct-glitch2 {`,
      `  0%, 100% { transform: translate(2px, 0); }`,
      `  20% { transform: translate(4px, 1px); }`,
      `  55% { transform: translate(-1px, 0); }`,
      `  80% { transform: translate(3px, -1px); }`,
      `}`,
    ].join('\n')
    return { html, css }
  }, [glText, glColor, glAccent])

  // Triangle
  const [triW, setTriW] = useState(120)
  const [triH, setTriH] = useState(80)
  const [triDir, setTriDir] = useState('up') // up|down|left|right
  const [triColor, setTriColor] = useState('#F8D46B')
  const triangleCss = useMemo(() => {
    const w = clamp(Math.round(Number(triW) || 120), 4, 400)
    const h = clamp(Math.round(Number(triH) || 80), 4, 400)
    const c = String(triColor || '#F8D46B')
    const base = ['width: 0;', 'height: 0;']
    if (triDir === 'down') {
      base.push(`border-left: ${Math.round(w / 2)}px solid transparent;`)
      base.push(`border-right: ${Math.round(w / 2)}px solid transparent;`)
      base.push(`border-top: ${h}px solid ${c};`)
    } else if (triDir === 'left') {
      base.push(`border-top: ${Math.round(h / 2)}px solid transparent;`)
      base.push(`border-bottom: ${Math.round(h / 2)}px solid transparent;`)
      base.push(`border-right: ${w}px solid ${c};`)
    } else if (triDir === 'right') {
      base.push(`border-top: ${Math.round(h / 2)}px solid transparent;`)
      base.push(`border-bottom: ${Math.round(h / 2)}px solid transparent;`)
      base.push(`border-left: ${w}px solid ${c};`)
    } else {
      base.push(`border-left: ${Math.round(w / 2)}px solid transparent;`)
      base.push(`border-right: ${Math.round(w / 2)}px solid transparent;`)
      base.push(`border-bottom: ${h}px solid ${c};`)
    }
    return base.join('\n')
  }, [triW, triH, triDir, triColor])

  const previewBoxStyle = {
    width: 280,
    height: 180,
    borderRadius: 18,
    border: '1px solid rgba(255,255,255,0.12)',
    background:
      'radial-gradient(700px 260px at 30% 0%, rgba(248,212,107,0.14), transparent 60%), rgba(255,255,255,0.03)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
    position: 'relative',
    overflow: 'hidden',
  }

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>CSS Tools</h1>
        <p className="muted">Generate CSS snippets locally with live preview.</p>
      </div>

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <ToolTabs tools={TOOLS} activeId={tool} onChange={setTool} />
          <FavoriteButton
            entry={{
              key: toolKey('css', tool),
              label: `CSS: ${TOOLS.find((x) => x.id === tool)?.label || tool}`,
              path: `/css?tool=${tool}`,
              tool,
            }}
          />
        </div>
      </section>

      {tool === 'gradient' ? (
        <section className="panel">
          <h2>CSS Gradient Generator</h2>
          <div className="two">
            <div className="stack">
              <div className="row">
                <div className="field" style={{ width: 200 }}>
                  <label>Type</label>
                  <select className="select" value={gradType} onChange={(e) => setGradType(e.target.value)}>
                    <option value="linear">Linear</option>
                    <option value="radial">Radial</option>
                  </select>
                </div>
                {gradType === 'linear' ? (
                  <div className="field" style={{ width: 220 }}>
                    <label>Angle</label>
                    <input className="input" type="range" min="0" max="360" value={gradAngle} onChange={(e) => setGradAngle(Number(e.target.value))} />
                  </div>
                ) : null}
                <button className="button button--ghost" type="button" onClick={() => copy(`background: ${gradientCss};`)}>
                  Copy CSS
                </button>
              </div>

              <div className="stack">
                {gradStops.map((s, idx) => (
                  <div key={idx} className="row">
                    <input
                      className="input"
                      style={{ width: 56, padding: 4 }}
                      type="color"
                      value={s.color}
                      onChange={(e) =>
                        setGradStops((all) => all.map((x, i) => (i === idx ? { ...x, color: e.target.value } : x)))
                      }
                    />
                    <input
                      className="input mono"
                      style={{ width: 140 }}
                      value={s.color}
                      onChange={(e) =>
                        setGradStops((all) => all.map((x, i) => (i === idx ? { ...x, color: e.target.value } : x)))
                      }
                    />
                    <input
                      className="input"
                      style={{ width: 220 }}
                      type="range"
                      min="0"
                      max="100"
                      value={s.pos}
                      onChange={(e) =>
                        setGradStops((all) => all.map((x, i) => (i === idx ? { ...x, pos: Number(e.target.value) } : x)))
                      }
                    />
                    <div className="mono muted" style={{ width: 44, textAlign: 'right' }}>
                      {Math.round(Number(s.pos) || 0)}%
                    </div>
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() => setGradStops((all) => all.filter((_, i) => i !== idx))}
                      disabled={gradStops.length <= 2}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  className="button"
                  type="button"
                  onClick={() =>
                    setGradStops((all) => (all.length >= 4 ? all : all.concat([{ color: '#FFFFFF', pos: 100 }])))
                  }
                  disabled={gradStops.length >= 4}
                >
                  Add stop
                </button>
              </div>
            </div>
            <div className="stack">
              <div style={{ ...previewBoxStyle, background: gradientCss }} />
              <div className="field">
                <label>CSS</label>
                <textarea className="textarea" value={wrapCssBlock('.box', `background: ${gradientCss};`)} readOnly />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'shadow' ? (
        <section className="panel">
          <h2>CSS Box Shadow Generator</h2>
          <div className="two">
            <div className="stack">
              <div className="row">
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={shInset} onChange={(e) => setShInset(e.target.checked)} />
                  <span className="muted">Inset</span>
                </label>
                <button className="button button--ghost" type="button" onClick={() => copy(`box-shadow: ${shadowCss};`)}>
                  Copy CSS
                </button>
              </div>
              <div className="two">
                <div className="field">
                  <label>X</label>
                  <input className="input" type="range" min="-60" max="60" value={shX} onChange={(e) => setShX(Number(e.target.value))} />
                </div>
                <div className="field">
                  <label>Y</label>
                  <input className="input" type="range" min="-60" max="60" value={shY} onChange={(e) => setShY(Number(e.target.value))} />
                </div>
                <div className="field">
                  <label>Blur</label>
                  <input className="input" type="range" min="0" max="120" value={shBlur} onChange={(e) => setShBlur(Number(e.target.value))} />
                </div>
                <div className="field">
                  <label>Spread</label>
                  <input className="input" type="range" min="-40" max="60" value={shSpread} onChange={(e) => setShSpread(Number(e.target.value))} />
                </div>
              </div>
              <div className="field">
                <label>Color</label>
                <input className="input mono" value={shColor} onChange={(e) => setShColor(e.target.value)} placeholder="rgba(0,0,0,0.35)" />
              </div>
            </div>
            <div className="stack">
              <div style={{ ...previewBoxStyle, background: 'rgba(255,255,255,0.06)' }}>
                <div
                  style={{
                    position: 'absolute',
                    inset: 28,
                    borderRadius: 18,
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    boxShadow: shadowCss,
                  }}
                />
              </div>
              <div className="field">
                <label>CSS</label>
                <textarea className="textarea" value={wrapCssBlock('.box', `box-shadow: ${shadowCss};`)} readOnly />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'radius' ? (
        <section className="panel">
          <h2>CSS Border Radius Generator</h2>
          <div className="two">
            <div className="stack">
              <button className="button button--ghost" type="button" onClick={() => copy(`border-radius: ${radiusCss};`)}>
                Copy CSS
              </button>
              <div className="panel" style={{ padding: 12 }}>
                <div className="mono muted" style={{ marginBottom: 6 }}>Horizontal radii (px)</div>
                <div className="two">
                  <div className="field"><label>Top-left</label><input className="input" type="range" min="0" max="120" value={rTLx} onChange={(e) => setRTLx(Number(e.target.value))} /></div>
                  <div className="field"><label>Top-right</label><input className="input" type="range" min="0" max="120" value={rTRx} onChange={(e) => setRTRx(Number(e.target.value))} /></div>
                  <div className="field"><label>Bottom-right</label><input className="input" type="range" min="0" max="120" value={rBRx} onChange={(e) => setRBRx(Number(e.target.value))} /></div>
                  <div className="field"><label>Bottom-left</label><input className="input" type="range" min="0" max="120" value={rBLx} onChange={(e) => setRBLx(Number(e.target.value))} /></div>
                </div>
              </div>
              <div className="panel" style={{ padding: 12 }}>
                <div className="mono muted" style={{ marginBottom: 6 }}>Vertical radii (px)</div>
                <div className="two">
                  <div className="field"><label>Top-left</label><input className="input" type="range" min="0" max="120" value={rTLy} onChange={(e) => setRTLy(Number(e.target.value))} /></div>
                  <div className="field"><label>Top-right</label><input className="input" type="range" min="0" max="120" value={rTRy} onChange={(e) => setRTRy(Number(e.target.value))} /></div>
                  <div className="field"><label>Bottom-right</label><input className="input" type="range" min="0" max="120" value={rBRy} onChange={(e) => setRBRy(Number(e.target.value))} /></div>
                  <div className="field"><label>Bottom-left</label><input className="input" type="range" min="0" max="120" value={rBLy} onChange={(e) => setRBLy(Number(e.target.value))} /></div>
                </div>
              </div>
            </div>
            <div className="stack">
              <div style={{ ...previewBoxStyle, background: 'rgba(255,255,255,0.03)' }}>
                <div
                  style={{
                    position: 'absolute',
                    inset: 24,
                    background: gradientCss,
                    border: '1px solid rgba(255,255,255,0.16)',
                    borderRadius: radiusCss,
                  }}
                />
              </div>
              <div className="field">
                <label>CSS</label>
                <textarea className="textarea" value={wrapCssBlock('.box', `border-radius: ${radiusCss};`)} readOnly />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'bezier' ? (
        <section className="panel">
          <h2>CSS Cubic Bezier Generator</h2>
          <div className="two">
            <div className="stack">
              <button className="button button--ghost" type="button" onClick={() => copy(`transition-timing-function: ${bezierCss};`)}>
                Copy CSS
              </button>
              <div className="two">
                <div className="field"><label>x1</label><input className="input" type="range" min="0" max="1" step="0.01" value={bx1} onChange={(e) => setBx1(Number(e.target.value))} /></div>
                <div className="field"><label>y1</label><input className="input" type="range" min="0" max="1" step="0.01" value={by1} onChange={(e) => setBy1(Number(e.target.value))} /></div>
                <div className="field"><label>x2</label><input className="input" type="range" min="0" max="1" step="0.01" value={bx2} onChange={(e) => setBx2(Number(e.target.value))} /></div>
                <div className="field"><label>y2</label><input className="input" type="range" min="0" max="1" step="0.01" value={by2} onChange={(e) => setBy2(Number(e.target.value))} /></div>
              </div>
              <div className="panel" style={{ padding: 12 }}>
                <div className="mono muted" style={{ marginBottom: 6 }}>Value</div>
                <div className="mono" style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>{bezierCss}</div>
              </div>
            </div>
            <div className="stack">
              <div style={previewBoxStyle}>
                <div
                  style={{
                    position: 'absolute',
                    left: 18,
                    top: '50%',
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    background: 'rgba(126,228,255,0.85)',
                    transform: 'translateY(-50%)',
                    animation: `oct-move 1600ms ${bezierCss} infinite alternate`,
                  }}
                />
              </div>
              <style>{`@keyframes oct-move { from { transform: translate(0, -50%); } to { transform: translate(220px, -50%); } }`}</style>
              <div className="field">
                <label>CSS</label>
                <textarea className="textarea" value={wrapCssBlock('.box', `transition-timing-function: ${bezierCss};`)} readOnly />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'clip' ? (
        <section className="panel">
          <h2>CSS Clip Path Generator</h2>
          <div className="two">
            <div className="stack">
              <div className="row">
                <div className="field" style={{ width: 240 }}>
                  <label>Kind</label>
                  <select className="select" value={clipKind} onChange={(e) => setClipKind(e.target.value)}>
                    <option value="inset">Inset (rounded)</option>
                    <option value="circle">Circle</option>
                    <option value="polygon">Polygon</option>
                  </select>
                </div>
                <button className="button button--ghost" type="button" onClick={() => copy(`clip-path: ${clipCss};`)}>
                  Copy CSS
                </button>
              </div>
              {clipKind === 'inset' ? (
                <div className="two">
                  <div className="field"><label>Inset (%)</label><input className="input" type="range" min="0" max="45" value={clipInset} onChange={(e) => setClipInset(Number(e.target.value))} /></div>
                  <div className="field"><label>Round (px)</label><input className="input" type="range" min="0" max="80" value={clipRound} onChange={(e) => setClipRound(Number(e.target.value))} /></div>
                </div>
              ) : null}
              {clipKind === 'circle' ? (
                <div className="field">
                  <label>Radius (%)</label>
                  <input className="input" type="range" min="5" max="100" value={clipCircle} onChange={(e) => setClipCircle(Number(e.target.value))} />
                </div>
              ) : null}
              {clipKind === 'polygon' ? (
                <div className="field" style={{ width: 240 }}>
                  <label>Preset</label>
                  <select className="select" value={clipPoly} onChange={(e) => setClipPoly(e.target.value)}>
                    <option value="triangle">Triangle</option>
                    <option value="hex">Hexagon</option>
                    <option value="star">Star</option>
                  </select>
                </div>
              ) : null}
              <div className="field">
                <label>Value</label>
                <input className="input mono" value={clipCss} readOnly />
              </div>
            </div>
            <div className="stack">
              <div style={previewBoxStyle}>
                <div
                  style={{
                    position: 'absolute',
                    inset: 18,
                    background: gradientCss,
                    border: '1px solid rgba(255,255,255,0.16)',
                    clipPath: clipCss,
                  }}
                />
              </div>
              <div className="field">
                <label>CSS</label>
                <textarea className="textarea" value={wrapCssBlock('.box', `clip-path: ${clipCss};`)} readOnly />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'pattern' ? (
        <section className="panel">
          <h2>CSS Background Pattern Generator</h2>
          <div className="two">
            <div className="stack">
              <div className="row">
                <div className="field" style={{ width: 240 }}>
                  <label>Pattern</label>
                  <select className="select" value={patKind} onChange={(e) => setPatKind(e.target.value)}>
                    <option value="grid">Grid</option>
                    <option value="dots">Dots</option>
                    <option value="stripes">Stripes</option>
                  </select>
                </div>
                <div className="field" style={{ width: 220 }}>
                  <label>Size</label>
                  <input className="input" type="range" min="6" max="120" value={patSize} onChange={(e) => setPatSize(Number(e.target.value))} />
                </div>
                <button className="button button--ghost" type="button" onClick={() => copy(patternCss)}>
                  Copy CSS
                </button>
              </div>
              <div className="two">
                <div className="field">
                  <label>Foreground</label>
                  <input className="input mono" value={patFg} onChange={(e) => setPatFg(e.target.value)} />
                </div>
                <div className="field">
                  <label>Background</label>
                  <input className="input mono" value={patBg} onChange={(e) => setPatBg(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>CSS</label>
                <textarea className="textarea" value={wrapCssBlock('.box', patternCss)} readOnly />
              </div>
            </div>
            <div className="stack">
              <div
                style={{
                  ...previewBoxStyle,
                  width: 320,
                  height: 220,
                  ...(patternCss
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .reduce((acc, line) => {
                      const m = line.match(/^([a-z-]+):\s*(.+);$/)
                      if (!m) return acc
                      const k = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())
                      acc[k] = m[2]
                      return acc
                    }, {})),
                }}
              />
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'glass' ? (
        <section className="panel">
          <h2>Glassmorphism Generator</h2>
          <div className="two">
            <div className="stack">
              <div className="row">
                <div className="field" style={{ width: 180 }}>
                  <label>Tint</label>
                  <input className="input" type="color" value={glassTint} onChange={(e) => setGlassTint(e.target.value)} />
                </div>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={glassShadow} onChange={(e) => setGlassShadow(e.target.checked)} />
                  <span className="muted">Shadow</span>
                </label>
                <button className="button button--ghost" type="button" onClick={() => copy(glassCss)}>
                  Copy CSS
                </button>
              </div>
              <div className="two">
                <div className="field"><label>Opacity</label><input className="input" type="range" min="0.02" max="0.4" step="0.01" value={glassOpacity} onChange={(e) => setGlassOpacity(Number(e.target.value))} /></div>
                <div className="field"><label>Blur</label><input className="input" type="range" min="0" max="40" value={glassBlur} onChange={(e) => setGlassBlur(Number(e.target.value))} /></div>
                <div className="field"><label>Border alpha</label><input className="input" type="range" min="0.02" max="0.5" step="0.01" value={glassBorder} onChange={(e) => setGlassBorder(Number(e.target.value))} /></div>
              </div>
              <div className="field">
                <label>CSS</label>
                <textarea className="textarea" value={wrapCssBlock('.glass', glassCss)} readOnly />
              </div>
            </div>
            <div className="stack">
              <div style={{ ...previewBoxStyle, width: 320, height: 220, background: gradientCss }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 22,
                    top: 22,
                    right: 22,
                    bottom: 22,
                    ...(glassCss
                      .split('\n')
                      .map((l) => l.trim())
                      .filter(Boolean)
                      .reduce((acc, line) => {
                        const m = line.match(/^([a-z-]+):\s*(.+);$/)
                        if (!m) return acc
                        const k = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())
                        acc[k] = m[2]
                        return acc
                      }, {})),
                  }}
                />
              </div>
              <p className="muted">
                Note: `backdrop-filter` only works when the element is over other content.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'loader' ? (
        <section className="panel">
          <h2>CSS Loader Generator</h2>
          <div className="two">
            <div className="stack">
              <div className="row">
                <div className="field" style={{ width: 220 }}>
                  <label>Type</label>
                  <select className="select" value={loaderKind} onChange={(e) => setLoaderKind(e.target.value)}>
                    <option value="spinner">Spinner</option>
                    <option value="dots">Dots</option>
                    <option value="bars">Bars</option>
                  </select>
                </div>
                <div className="field" style={{ width: 220 }}>
                  <label>Size</label>
                  <input className="input" type="range" min="12" max="180" value={loaderSize} onChange={(e) => setLoaderSize(Number(e.target.value))} />
                </div>
                <div className="field" style={{ width: 180 }}>
                  <label>Color</label>
                  <input className="input" type="color" value={loaderColor} onChange={(e) => setLoaderColor(e.target.value)} />
                </div>
              </div>
              <div className="row">
                <button className="button button--ghost" type="button" onClick={() => copy(loader.html)}>Copy HTML</button>
                <button className="button button--ghost" type="button" onClick={() => copy(loader.css)}>Copy CSS</button>
              </div>
              <div className="two">
                <div className="field">
                  <label>HTML</label>
                  <textarea className="textarea" value={loader.html} readOnly />
                </div>
                <div className="field">
                  <label>CSS</label>
                  <textarea className="textarea" value={loader.css} readOnly />
                </div>
              </div>
            </div>
            <div className="stack">
              <div style={{ ...previewBoxStyle, width: 320, height: 220, display: 'grid', placeItems: 'center' }}>
                <div style={{ all: 'initial' }}>
                  <style>{loader.css}</style>
                  <div dangerouslySetInnerHTML={{ __html: loader.html }} />
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'checkbox' ? (
        <section className="panel">
          <h2>CSS Checkbox Generator</h2>
          <div className="two">
            <div className="stack">
              <div className="row">
                <div className="field" style={{ width: 180 }}>
                  <label>Color</label>
                  <input className="input" type="color" value={cbColor} onChange={(e) => setCbColor(e.target.value)} />
                </div>
                <div className="field" style={{ width: 220 }}>
                  <label>Size</label>
                  <input className="input" type="range" min="14" max="48" value={cbSize} onChange={(e) => setCbSize(Number(e.target.value))} />
                </div>
                <button className="button button--ghost" type="button" onClick={() => copy(checkbox.html)}>Copy HTML</button>
                <button className="button button--ghost" type="button" onClick={() => copy(checkbox.css)}>Copy CSS</button>
              </div>
              <div className="two">
                <div className="field"><label>HTML</label><textarea className="textarea" value={checkbox.html} readOnly /></div>
                <div className="field"><label>CSS</label><textarea className="textarea" value={checkbox.css} readOnly /></div>
              </div>
            </div>
            <div className="stack">
              <div style={{ ...previewBoxStyle, width: 320, height: 220, display: 'grid', placeItems: 'center' }}>
                <div style={{ all: 'initial' }}>
                  <style>{checkbox.css}</style>
                  <div dangerouslySetInnerHTML={{ __html: checkbox.html }} />
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'switch' ? (
        <section className="panel">
          <h2>CSS Switch Generator</h2>
          <div className="two">
            <div className="stack">
              <div className="row">
                <div className="field" style={{ width: 180 }}>
                  <label>Color</label>
                  <input className="input" type="color" value={swColor} onChange={(e) => setSwColor(e.target.value)} />
                </div>
                <div className="field" style={{ width: 220 }}>
                  <label>Width</label>
                  <input className="input" type="range" min="34" max="120" value={swW} onChange={(e) => setSwW(Number(e.target.value))} />
                </div>
                <button className="button button--ghost" type="button" onClick={() => copy(switcher.html)}>Copy HTML</button>
                <button className="button button--ghost" type="button" onClick={() => copy(switcher.css)}>Copy CSS</button>
              </div>
              <div className="two">
                <div className="field"><label>HTML</label><textarea className="textarea" value={switcher.html} readOnly /></div>
                <div className="field"><label>CSS</label><textarea className="textarea" value={switcher.css} readOnly /></div>
              </div>
            </div>
            <div className="stack">
              <div style={{ ...previewBoxStyle, width: 320, height: 220, display: 'grid', placeItems: 'center' }}>
                <div style={{ all: 'initial' }}>
                  <style>{switcher.css}</style>
                  <div dangerouslySetInnerHTML={{ __html: switcher.html }} />
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'glitch' ? (
        <section className="panel">
          <h2>CSS Text Glitch Effect</h2>
          <div className="two">
            <div className="stack">
              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Text</label>
                  <input className="input" value={glText} onChange={(e) => setGlText(e.target.value)} />
                </div>
                <div className="field" style={{ width: 160 }}>
                  <label>Color</label>
                  <input className="input" type="color" value={glColor} onChange={(e) => setGlColor(e.target.value)} />
                </div>
                <div className="field" style={{ width: 160 }}>
                  <label>Accent</label>
                  <input className="input" type="color" value={glAccent} onChange={(e) => setGlAccent(e.target.value)} />
                </div>
              </div>
              <div className="row">
                <button className="button button--ghost" type="button" onClick={() => copy(glitch.html)}>Copy HTML</button>
                <button className="button button--ghost" type="button" onClick={() => copy(glitch.css)}>Copy CSS</button>
              </div>
              <div className="two">
                <div className="field"><label>HTML</label><textarea className="textarea" value={glitch.html} readOnly /></div>
                <div className="field"><label>CSS</label><textarea className="textarea" value={glitch.css} readOnly /></div>
              </div>
            </div>
            <div className="stack">
              <div style={{ ...previewBoxStyle, width: 320, height: 220, display: 'grid', placeItems: 'center' }}>
                <div style={{ all: 'initial' }}>
                  <style>{glitch.css}</style>
                  <div dangerouslySetInnerHTML={{ __html: glitch.html }} />
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'triangle' ? (
        <section className="panel">
          <h2>CSS Triangle Generator</h2>
          <div className="two">
            <div className="stack">
              <div className="row">
                <div className="field" style={{ width: 180 }}>
                  <label>Direction</label>
                  <select className="select" value={triDir} onChange={(e) => setTriDir(e.target.value)}>
                    <option value="up">Up</option>
                    <option value="down">Down</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </div>
                <div className="field" style={{ width: 160 }}>
                  <label>Color</label>
                  <input className="input" type="color" value={triColor} onChange={(e) => setTriColor(e.target.value)} />
                </div>
                <button className="button button--ghost" type="button" onClick={() => copy(triangleCss)}>Copy CSS</button>
              </div>
              <div className="two">
                <div className="field"><label>Width</label><input className="input" type="range" min="4" max="400" value={triW} onChange={(e) => setTriW(Number(e.target.value))} /></div>
                <div className="field"><label>Height</label><input className="input" type="range" min="4" max="400" value={triH} onChange={(e) => setTriH(Number(e.target.value))} /></div>
              </div>
              <div className="field">
                <label>CSS</label>
                <textarea className="textarea" value={wrapCssBlock('.triangle', triangleCss)} readOnly />
              </div>
            </div>
            <div className="stack">
              <div style={{ ...previewBoxStyle, width: 320, height: 220, display: 'grid', placeItems: 'center' }}>
                <div style={{ all: 'initial' }}>
                  <div style={{ ...(triangleCss
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .reduce((acc, line) => {
                      const m = line.match(/^([a-z-]+):\s*(.+);$/)
                      if (!m) return acc
                      const k = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())
                      acc[k] = m[2]
                      return acc
                    }, {})) }} />
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
