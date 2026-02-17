import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ToolTabs from '../../components/ToolTabs.jsx'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import { addRecent, toolKey } from '../../utils/toolPrefs.js'
import { downloadBlob } from '../../utils/file.js'

const TOOLS = [
  { id: 'code2img', label: 'Code → Image' },
  { id: 'rnshadow', label: 'RN Shadow' },
  { id: 'jsontree', label: 'JSON Tree' },
  { id: 'og', label: 'Open Graph Meta' },
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

function safeJsonParse(s) {
  return JSON.parse(String(s || '').trim() || 'null')
}

function renderValue(v) {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `Array(${v.length})`
  return 'Object'
}

function JsonNode({ value, path, depth, expanded, onToggle, onEdit }) {
  const isObj = value && typeof value === 'object' && !Array.isArray(value)
  const isArr = Array.isArray(value)
  const canExpand = isObj || isArr
  const open = !!expanded[path]

  const keys = useMemo(() => {
    if (!canExpand) return []
    if (isArr) return Array.from({ length: value.length }, (_, i) => String(i))
    return Object.keys(value)
  }, [canExpand, isArr, value])

  return (
    <div style={{ marginLeft: depth ? 14 : 0 }}>
      <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        {canExpand ? (
          <button className="button button--ghost" type="button" onClick={() => onToggle(path)} style={{ padding: '6px 10px' }}>
            {open ? '−' : '+'}
          </button>
        ) : (
          <div style={{ width: 38 }} />
        )}
        <div className="mono" style={{ fontSize: 13, color: 'rgba(255,255,255,0.86)' }}>
          <span style={{ color: 'rgba(255,255,255,0.55)' }}>{path ? path.split('.').slice(-1)[0] : '(root)'}</span>
          <span style={{ color: 'rgba(255,255,255,0.40)' }}> : </span>
          <span>{renderValue(value)}</span>
        </div>
        {!canExpand ? (
          <button className="button button--ghost" type="button" onClick={() => onEdit(path)} style={{ padding: '6px 10px' }}>
            Edit
          </button>
        ) : null}
      </div>
      {open && canExpand ? (
        <div style={{ marginTop: 6 }}>
          {keys.length ? (
            keys.map((k) => {
              const nextPath = path ? `${path}.${k}` : k
              const nextVal = isArr ? value[Number(k)] : value[k]
              return (
                <JsonNode
                  key={nextPath}
                  value={nextVal}
                  path={nextPath}
                  depth={depth + 1}
                  expanded={expanded}
                  onToggle={onToggle}
                  onEdit={onEdit}
                />
              )
            })
          ) : (
            <div className="muted mono" style={{ fontSize: 12, marginLeft: 38 }}>
              (empty)
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function getAtPath(obj, path) {
  if (!path) return obj
  const parts = path.split('.')
  let cur = obj
  for (const p of parts) {
    if (cur == null) return undefined
    cur = cur[p]
  }
  return cur
}

function setAtPath(obj, path, value) {
  if (!path) return value
  const parts = path.split('.')
  const root = Array.isArray(obj) ? obj.slice() : { ...(obj || {}) }
  let cur = root
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]
    const next = cur[p]
    const newNext = Array.isArray(next) ? next.slice() : (next && typeof next === 'object' ? { ...next } : {})
    cur[p] = newNext
    cur = newNext
  }
  cur[parts[parts.length - 1]] = value
  return root
}

export default function CodingTools() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tool, setTool] = useState('code2img')

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
        key: toolKey('coding', tool),
        label: `Coding: ${t.label}`,
        path: `/coding?tool=${tool}`,
        tool,
      })
      window.dispatchEvent(new Event('oct:prefs'))
    }
  }, [tool, setSearchParams])

  // Code -> image
  const [code, setCode] = useState('function hello(name) {\n  return `Hello, ${name}!`\n}\n\nconsole.log(hello("CEO"))\n')
  const [theme, setTheme] = useState('night') // night|paper
  const [fontSize, setFontSize] = useState(16)
  const [pad, setPad] = useState(22)
  const [lineNums, setLineNums] = useState(true)
  const [imgBusy, setImgBusy] = useState(false)
  const canvasRef = useRef(null)

  const themeCfg = useMemo(() => {
    if (theme === 'paper') {
      return {
        bg: '#F7F1E3',
        fg: '#141824',
        faint: 'rgba(20,24,36,0.34)',
        accent: '#2358C4',
      }
    }
    return {
      bg: '#0B0E14',
      fg: 'rgba(255,255,255,0.92)',
      faint: 'rgba(255,255,255,0.35)',
      accent: '#7EE4FF',
    }
  }, [theme])

  async function renderCodeToCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    setImgBusy(true)
    try {
      const lines = String(code || '').replace(/\r\n/g, '\n').split('\n')
      const fs = clamp(Math.round(Number(fontSize) || 16), 10, 28)
      const padding = clamp(Math.round(Number(pad) || 22), 8, 60)
      const lnPad = lineNums ? 46 : 0
      const font = `${fs}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`

      const tmp = document.createElement('canvas')
      const tctx = tmp.getContext('2d')
      tctx.font = font
      const maxLineW = Math.max(
        1,
        ...lines.map((l) => tctx.measureText(l || ' ').width),
      )
      const w = Math.ceil(padding * 2 + lnPad + maxLineW)
      const lineH = Math.round(fs * 1.55)
      const h = Math.ceil(padding * 2 + lineH * lines.length)
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')

      ctx.fillStyle = themeCfg.bg
      ctx.fillRect(0, 0, w, h)

      // subtle header bar
      ctx.fillStyle = theme === 'night' ? 'rgba(255,255,255,0.05)' : 'rgba(20,24,36,0.06)'
      ctx.fillRect(0, 0, w, Math.round(padding * 1.2))

      ctx.font = font
      ctx.textBaseline = 'top'
      ctx.fillStyle = themeCfg.fg

      for (let i = 0; i < lines.length; i++) {
        const y = padding + i * lineH
        if (lineNums) {
          ctx.fillStyle = themeCfg.faint
          ctx.fillText(String(i + 1).padStart(2, ' '), padding, y)
          ctx.fillStyle = themeCfg.fg
        }
        ctx.fillText(lines[i] || '', padding + lnPad, y)
      }

      // border
      ctx.strokeStyle = theme === 'night' ? 'rgba(255,255,255,0.10)' : 'rgba(20,24,36,0.14)'
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
    } finally {
      setImgBusy(false)
    }
  }

  // RN shadow
  const [rnColor, setRnColor] = useState('#000000')
  const [rnOpacity, setRnOpacity] = useState(0.25)
  const [rnOffsetX, setRnOffsetX] = useState(0)
  const [rnOffsetY, setRnOffsetY] = useState(12)
  const [rnRadius, setRnRadius] = useState(18)
  const [rnElevation, setRnElevation] = useState(8)
  const rnOut = useMemo(() => {
    const opacity = clamp(Number(rnOpacity) || 0.25, 0, 1)
    const ox = Math.round(Number(rnOffsetX) || 0)
    const oy = Math.round(Number(rnOffsetY) || 12)
    const radius = clamp(Math.round(Number(rnRadius) || 18), 0, 60)
    const elevation = clamp(Math.round(Number(rnElevation) || 8), 0, 40)
    const color = String(rnColor || '#000000')
    const ios = {
      shadowColor: color,
      shadowOpacity: opacity,
      shadowRadius: radius,
      shadowOffset: { width: ox, height: oy },
    }
    const android = { elevation }
    return { ios, android }
  }, [rnColor, rnOpacity, rnOffsetX, rnOffsetY, rnRadius, rnElevation])

  // JSON tree
  const [jsonIn, setJsonIn] = useState('{\n  "user": {\n    "name": "Alice",\n    "age": 30,\n    "tags": ["a", "b"]\n  }\n}\n')
  const [expanded, setExpanded] = useState({})
  const jsonParsed = useMemo(() => {
    try {
      return { obj: safeJsonParse(jsonIn), err: '' }
    } catch (e) {
      return { obj: null, err: e?.message || 'Invalid JSON' }
    }
  }, [jsonIn])
  const jsonObj = jsonParsed.obj
  const jsonErr = jsonParsed.err

  function toggle(path) {
    setExpanded((s) => ({ ...s, [path]: !s[path] }))
  }

  function edit(path) {
    try {
      const obj = safeJsonParse(jsonIn)
      const cur = getAtPath(obj, path)
      const nextRaw = window.prompt(`Edit value at "${path || '(root)'}" (enter valid JSON)`, JSON.stringify(cur, null, 0))
      if (nextRaw === null) return
      const nextVal = JSON.parse(nextRaw)
      const nextObj = setAtPath(obj, path, nextVal)
      setJsonIn(JSON.stringify(nextObj, null, 2))
    } catch {
      // ignore
    }
  }

  // OG meta
  const [og, setOg] = useState({
    title: 'Offline CEO Tools',
    description: 'Frontend-only utilities. Privacy-first.',
    url: 'https://example.com',
    image: 'https://example.com/og.png',
    siteName: 'Offline CEO Tools',
    type: 'website',
    twitterCard: 'summary_large_image',
  })

  const ogHtml = useMemo(() => {
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    const lines = []
    lines.push(`<meta property="og:title" content="${esc(og.title)}">`)
    lines.push(`<meta property="og:description" content="${esc(og.description)}">`)
    lines.push(`<meta property="og:url" content="${esc(og.url)}">`)
    lines.push(`<meta property="og:image" content="${esc(og.image)}">`)
    lines.push(`<meta property="og:site_name" content="${esc(og.siteName)}">`)
    lines.push(`<meta property="og:type" content="${esc(og.type)}">`)
    lines.push(`<meta name="twitter:card" content="${esc(og.twitterCard)}">`)
    lines.push(`<meta name="twitter:title" content="${esc(og.title)}">`)
    lines.push(`<meta name="twitter:description" content="${esc(og.description)}">`)
    lines.push(`<meta name="twitter:image" content="${esc(og.image)}">`)
    return lines.join('\n')
  }, [og])

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>Coding Tools</h1>
        <p className="muted">All generation happens locally. Nothing is sent anywhere.</p>
      </div>

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <ToolTabs tools={TOOLS} activeId={tool} onChange={setTool} />
          <FavoriteButton
            entry={{
              key: toolKey('coding', tool),
              label: `Coding: ${TOOLS.find((x) => x.id === tool)?.label || tool}`,
              path: `/coding?tool=${tool}`,
              tool,
            }}
          />
        </div>
      </section>

      {tool === 'code2img' ? (
        <section className="panel">
          <h2>Code to Image Converter</h2>
          <div className="two">
            <div className="stack">
              <div className="row">
                <div className="field" style={{ width: 220 }}>
                  <label>Theme</label>
                  <select className="select" value={theme} onChange={(e) => setTheme(e.target.value)}>
                    <option value="night">Night</option>
                    <option value="paper">Paper</option>
                  </select>
                </div>
                <div className="field" style={{ width: 180 }}>
                  <label>Font size</label>
                  <input className="input" type="range" min="10" max="28" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
                </div>
                <div className="field" style={{ width: 180 }}>
                  <label>Padding</label>
                  <input className="input" type="range" min="8" max="60" value={pad} onChange={(e) => setPad(Number(e.target.value))} />
                </div>
                <label className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={lineNums} onChange={(e) => setLineNums(e.target.checked)} />
                  <span className="muted">Line numbers</span>
                </label>
              </div>
              <div className="field">
                <label>Code</label>
                <textarea className="textarea" value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div className="row">
                <button className="button" type="button" onClick={renderCodeToCanvas} disabled={imgBusy}>
                  {imgBusy ? 'Rendering...' : 'Render'}
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={async () => {
                    const c = canvasRef.current
                    if (!c) return
                    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
                    if (!blob) return
                    downloadBlob(blob, `code-${Date.now()}.png`)
                  }}
                >
                  Download PNG
                </button>
              </div>
            </div>
            <div className="stack">
              <div className="panel" style={{ padding: 12, overflow: 'auto' }}>
                <canvas ref={canvasRef} style={{ maxWidth: '100%', height: 'auto' }} />
              </div>
              <p className="muted">Rendering is plain-text (no external syntax highlighter).</p>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'rnshadow' ? (
        <section className="panel">
          <h2>React Native Shadow Generator</h2>
          <div className="two">
            <div className="stack">
              <div className="row">
                <div className="field" style={{ width: 180 }}>
                  <label>Shadow color</label>
                  <input className="input" type="color" value={rnColor} onChange={(e) => setRnColor(e.target.value)} />
                </div>
                <div className="field" style={{ width: 260 }}>
                  <label>Opacity</label>
                  <input className="input" type="range" min="0" max="1" step="0.01" value={rnOpacity} onChange={(e) => setRnOpacity(Number(e.target.value))} />
                </div>
                <div className="field" style={{ width: 220 }}>
                  <label>Elevation (Android)</label>
                  <input className="input" type="range" min="0" max="40" value={rnElevation} onChange={(e) => setRnElevation(Number(e.target.value))} />
                </div>
              </div>
              <div className="two">
                <div className="field"><label>Offset X</label><input className="input" type="range" min="-40" max="40" value={rnOffsetX} onChange={(e) => setRnOffsetX(Number(e.target.value))} /></div>
                <div className="field"><label>Offset Y</label><input className="input" type="range" min="-40" max="40" value={rnOffsetY} onChange={(e) => setRnOffsetY(Number(e.target.value))} /></div>
                <div className="field"><label>Radius (iOS)</label><input className="input" type="range" min="0" max="60" value={rnRadius} onChange={(e) => setRnRadius(Number(e.target.value))} /></div>
              </div>
              <div className="two">
                <div className="field">
                  <label>iOS style</label>
                  <textarea className="textarea" value={JSON.stringify(rnOut.ios, null, 2)} readOnly />
                </div>
                <div className="field">
                  <label>Android style</label>
                  <textarea className="textarea" value={JSON.stringify(rnOut.android, null, 2)} readOnly />
                </div>
              </div>
              <div className="row">
                <button className="button button--ghost" type="button" onClick={() => copy(JSON.stringify(rnOut.ios, null, 2))}>Copy iOS</button>
                <button className="button button--ghost" type="button" onClick={() => copy(JSON.stringify(rnOut.android, null, 2))}>Copy Android</button>
              </div>
            </div>
            <div className="stack">
              <div className="panel" style={{ padding: 14 }}>
                <div
                  style={{
                    height: 220,
                    display: 'grid',
                    placeItems: 'center',
                    background:
                      'radial-gradient(800px 260px at 35% 0%, rgba(248,212,107,0.14), transparent 55%), rgba(255,255,255,0.03)',
                    borderRadius: 18,
                  }}
                >
                  <div
                    style={{
                      width: 220,
                      height: 120,
                      borderRadius: 18,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.14)',
                      boxShadow: `${rnOffsetX}px ${rnOffsetY}px ${rnRadius}px rgba(0,0,0,${rnOpacity})`,
                    }}
                  />
                </div>
                <p className="muted" style={{ marginTop: 10 }}>
                  Preview is approximate; React Native renderers differ between platforms.
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'jsontree' ? (
        <section className="panel">
          <h2>JSON Tree Viewer</h2>
          <div className="two">
            <div className="field">
              <label>JSON input</label>
              <textarea className="textarea" value={jsonIn} onChange={(e) => setJsonIn(e.target.value)} />
              <div className="row" style={{ marginTop: 10 }}>
                <button className="button button--ghost" type="button" onClick={() => copy(jsonIn)}>Copy JSON</button>
                <button className="button button--ghost" type="button" onClick={() => setExpanded({ '': true })}>Expand root</button>
                <button className="button button--ghost" type="button" onClick={() => setExpanded({})}>Collapse all</button>
              </div>
              {jsonErr ? <div className="error">{jsonErr}</div> : null}
            </div>
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 10 }}>Tree</div>
              {jsonObj !== null && !jsonErr ? (
                <JsonNode value={jsonObj} path="" depth={0} expanded={expanded} onToggle={toggle} onEdit={edit} />
              ) : (
                <div className="muted">Enter valid JSON to render the tree.</div>
              )}
              <p className="muted" style={{ marginTop: 10 }}>
                Edit uses a prompt and expects valid JSON for the new value (strings need quotes).
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'og' ? (
        <section className="panel">
          <h2>Open Graph Meta Generator</h2>
          <div className="two">
            <div className="stack">
              <div className="field">
                <label>Title</label>
                <input className="input" value={og.title} onChange={(e) => setOg((s) => ({ ...s, title: e.target.value }))} />
              </div>
              <div className="field">
                <label>Description</label>
                <textarea className="textarea" value={og.description} onChange={(e) => setOg((s) => ({ ...s, description: e.target.value }))} />
              </div>
              <div className="field">
                <label>URL</label>
                <input className="input" value={og.url} onChange={(e) => setOg((s) => ({ ...s, url: e.target.value }))} />
              </div>
              <div className="field">
                <label>Image URL</label>
                <input className="input" value={og.image} onChange={(e) => setOg((s) => ({ ...s, image: e.target.value }))} />
              </div>
              <div className="two">
                <div className="field">
                  <label>Site name</label>
                  <input className="input" value={og.siteName} onChange={(e) => setOg((s) => ({ ...s, siteName: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Type</label>
                  <select className="select" value={og.type} onChange={(e) => setOg((s) => ({ ...s, type: e.target.value }))}>
                    <option value="website">website</option>
                    <option value="article">article</option>
                    <option value="profile">profile</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Twitter card</label>
                <select className="select" value={og.twitterCard} onChange={(e) => setOg((s) => ({ ...s, twitterCard: e.target.value }))}>
                  <option value="summary_large_image">summary_large_image</option>
                  <option value="summary">summary</option>
                </select>
              </div>
              <div className="row">
                <button className="button button--ghost" type="button" onClick={() => copy(ogHtml)}>Copy meta tags</button>
              </div>
            </div>
            <div className="stack">
              <div className="field">
                <label>Meta tags</label>
                <textarea className="textarea" value={ogHtml} readOnly />
              </div>
              <p className="muted">
                This generator does not fetch URLs; it only outputs tags based on your inputs.
              </p>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
