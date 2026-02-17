import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ToolTabs from '../../components/ToolTabs.jsx'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import { charCount, toSlug, wordCount } from '../../utils/text.js'
import { addRecent, toolKey } from '../../utils/toolPrefs.js'

import { diffLines } from 'diff'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const TOOLS = [
  { id: 'case', label: 'Case' },
  { id: 'count', label: 'Count' },
  { id: 'whitespace', label: 'Whitespace' },
  { id: 'bionic', label: 'Bionic' },
  { id: 'handwriting', label: 'Handwriting' },
  { id: 'fontpair', label: 'Font Pairs' },
  { id: 'lines', label: 'Lines' },
  { id: 'find', label: 'Find/Replace' },
  { id: 'diff', label: 'Diff' },
  { id: 'slug', label: 'Slug' },
  { id: 'lorem', label: 'Lorem' },
  { id: 'md', label: 'Markdown' },
  { id: 'data', label: 'Data' },
]

function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function sentenceCase(s) {
  const t = String(s || '').trim()
  if (!t) return ''
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

function camelCase(s) {
  const words = String(s || '')
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
  if (!words.length) return ''
  return (
    words[0].toLowerCase() +
    words
      .slice(1)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('')
  )
}

function snakeCase(s) {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function kebabCase(s) {
  return toSlug(s)
}

function removeEmptyLines(lines) {
  return lines.filter((l) => l.trim() !== '')
}

function removeDuplicateLines(lines, caseInsensitive) {
  const seen = new Set()
  const out = []
  for (const l of lines) {
    const key = caseInsensitive ? l.toLowerCase() : l
    if (seen.has(key)) continue
    seen.add(key)
    out.push(l)
  }
  return out
}

function loremParagraph(words) {
  const seed =
    'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'
  const pool = seed.split(' ')
  const n = Math.max(3, Math.min(500, Math.floor(words)))
  const out = []
  for (let i = 0; i < n; i++) out.push(pool[i % pool.length])
  const s = out.join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1) + '.'
}

export default function TextTools() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tool, setTool] = useState('case')

  const [text, setText] = useState('')
  const [caseMode, setCaseMode] = useState('lower')

  const [lineInput, setLineInput] = useState('')
  const [removeEmpty, setRemoveEmpty] = useState(true)
  const [removeDupes, setRemoveDupes] = useState(false)
  const [dupeCi, setDupeCi] = useState(true)
  const [sortDir, setSortDir] = useState('asc')
  const [sortCi, setSortCi] = useState(true)

  const [findIn, setFindIn] = useState('')
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [useRegex, setUseRegex] = useState(false)
  const [regexFlags, setRegexFlags] = useState('g')

  const [a, setA] = useState('')
  const [b, setB] = useState('')

  const [slugIn, setSlugIn] = useState('')

  const [loremParas, setLoremParas] = useState(3)
  const [loremWords, setLoremWords] = useState(60)

  const [md, setMd] = useState('# Markdown\\n\\nType on the left. Preview on the right.')

  // Whitespace
  const [wsIn, setWsIn] = useState('')
  const [wsMode, setWsMode] = useState('collapse') // collapse|trimLines|removeLineBreaks
  const wsOut = useMemo(() => {
    const s = String(wsIn || '')
    if (wsMode === 'removeLineBreaks') return s.replace(/\s*\r?\n\s*/g, ' ').replace(/\s+/g, ' ').trim()
    if (wsMode === 'trimLines') return s.split(/\r?\n/).map((l) => l.trim()).join('\n')
    return s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
  }, [wsIn, wsMode])

  // Bionic reading
  const [bioIn, setBioIn] = useState('Bionic reading makes the first part of each word bold to guide the eye.')
  const [bioStrength, setBioStrength] = useState(0.5) // 0.2..0.8
  const bioHtml = useMemo(() => {
    const t = String(bioIn || '')
    const strength = Math.max(0.2, Math.min(0.8, Number(bioStrength) || 0.5))
    // Split on word boundaries; preserve whitespace/punctuation.
    const parts = t.split(/(\b)/)
    const out = parts
      .map((p) => {
        // Only transform tokens that contain letters/numbers and are not just boundary markers.
        if (!p || p === '\b') return p
        if (!/[A-Za-z0-9]/.test(p)) return p
        const m = p.match(/^([A-Za-z0-9]+)(.*)$/)
        if (!m) return p
        const word = m[1]
        const rest = m[2] || ''
        const n = Math.max(1, Math.floor(word.length * strength))
        const a = word.slice(0, n)
        const b = word.slice(n)
        return `<strong>${a}</strong>${b}${rest}`
      })
      .join('')
    return DOMPurify.sanitize(out)
  }, [bioIn, bioStrength])

  // Handwriting (render to PDF via canvas -> pdf-lib)
  const [hwText, setHwText] = useState('Dear John,\n\nThis is handwriting-like text rendered locally.\n\nRegards,\nCEO')
  const [hwPaper, setHwPaper] = useState('a4') // a4|letter
  const [hwInk, setHwInk] = useState('#1b4dff')
  const [hwFontSize, setHwFontSize] = useState(22)
  const [hwBusy, setHwBusy] = useState(false)

  // Font pairs (offline generator: outputs CSS/HTML snippets; does not fetch fonts)
  const fontPairs = useMemo(
    () => [
      {
        id: 'system-editorial',
        name: 'Editorial (system)',
        heading: { label: 'Georgia', css: 'Georgia, Cambria, "Times New Roman", Times, serif' },
        body: { label: 'System sans', css: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
        google: null,
      },
      {
        id: 'system-mono',
        name: 'Mono UI (system)',
        heading: { label: 'System mono', css: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' },
        body: { label: 'System sans', css: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
        google: null,
      },
      {
        id: 'playfair-inter',
        name: 'Playfair Display + Inter',
        heading: { label: 'Playfair Display', css: '"Playfair Display", Georgia, serif' },
        body: { label: 'Inter', css: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
        google: {
          // User can paste this into their own site; app itself does not request it.
          link: '<link rel="preconnect" href="https://fonts.googleapis.com">\\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\\n<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=Playfair+Display:wght@600;800&display=swap" rel="stylesheet">',
        },
      },
      {
        id: 'montserrat-source',
        name: 'Montserrat + Source Sans 3',
        heading: { label: 'Montserrat', css: 'Montserrat, ui-sans-serif, system-ui, sans-serif' },
        body: { label: 'Source Sans 3', css: '"Source Sans 3", ui-sans-serif, system-ui, sans-serif' },
        google: {
          link: '<link rel="preconnect" href="https://fonts.googleapis.com">\\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\\n<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;800&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">',
        },
      },
    ],
    [],
  )
  const [fpId, setFpId] = useState('system-editorial')
  const fp = useMemo(() => fontPairs.find((p) => p.id === fpId) || fontPairs[0], [fontPairs, fpId])

  async function downloadHandwritingPdf() {
    setHwBusy(true)
    try {
      const { PDFDocument } = await import('pdf-lib')

      const page = hwPaper === 'letter' ? { w: 612, h: 792 } : { w: 595.28, h: 841.89 } // points
      const margin = 54
      const lineGap = 1.45
      const fontSize = Math.max(12, Math.min(42, Math.floor(Number(hwFontSize) || 22)))

      // Render "paper" on a canvas at 2x for decent quality.
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(page.w * scale)
      canvas.height = Math.floor(page.h * scale)
      const ctx = canvas.getContext('2d')

      function drawPaper() {
        // light warm paper with subtle blue lines
        ctx.fillStyle = '#fbf5e9'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = 'rgba(35, 88, 196, 0.10)'
        const lineY = Math.floor((margin + fontSize * 1.2) * scale)
        const step = Math.floor(fontSize * lineGap * scale)
        for (let y = lineY; y < canvas.height - margin * scale; y += step) {
          ctx.fillRect(margin * scale, y, canvas.width - margin * 2 * scale, 1)
        }
        // left margin line
        ctx.fillStyle = 'rgba(255, 0, 0, 0.10)'
        ctx.fillRect(Math.floor((margin + 24) * scale), margin * scale, 1, canvas.height - margin * 2 * scale)
      }

      function wrapLines(text, maxWidthPx) {
        const paras = String(text || '').split(/\r?\n/)
        const lines = []
        for (const para of paras) {
          if (!para.trim()) {
            lines.push('')
            continue
          }
          const words = para.split(/\s+/)
          let cur = ''
          for (const w of words) {
            const next = cur ? cur + ' ' + w : w
            if (ctx.measureText(next).width <= maxWidthPx) cur = next
            else {
              if (cur) lines.push(cur)
              cur = w
            }
          }
          if (cur) lines.push(cur)
        }
        return lines
      }

      const pdf = await PDFDocument.create()

      // font fallback: relies on system cursive fonts; still local.
      ctx.font = `${Math.floor(fontSize * scale)}px cursive`
      ctx.textBaseline = 'top'
      ctx.fillStyle = hwInk

      const usableWidth = (page.w - margin * 2) * scale
      const lines = wrapLines(hwText, usableWidth)
      const linePx = Math.floor(fontSize * lineGap * scale)
      const maxLinesPerPage = Math.floor(((page.h - margin * 2) * scale) / linePx)

      let i = 0
      while (i < lines.length) {
        drawPaper()
        ctx.fillStyle = hwInk
        ctx.font = `${Math.floor(fontSize * scale)}px cursive`

        let y = margin * scale
        const end = Math.min(lines.length, i + maxLinesPerPage)
        for (; i < end; i++) {
          const line = lines[i]
          // jitter for handwriting feel
          const jx = (Math.random() - 0.5) * 1.2 * scale
          const jy = (Math.random() - 0.5) * 0.6 * scale
          ctx.fillText(line, margin * scale + jx, y + jy)
          y += linePx
        }

        const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
        const bytes = new Uint8Array(await png.arrayBuffer())
        const emb = await pdf.embedPng(bytes)
        const p = pdf.addPage([page.w, page.h])
        p.drawImage(emb, { x: 0, y: 0, width: page.w, height: page.h })
      }

      const out = await pdf.save()
      const blob = new Blob([out], { type: 'application/pdf' })
      const { downloadBlob } = await import('../../utils/file.js')
      downloadBlob(blob, `handwriting-${Date.now()}.pdf`)
    } finally {
      setHwBusy(false)
    }
  }

  // Data tools
  const [dataTool, setDataTool] = useState('csv')
  const [csvIn, setCsvIn] = useState('name,age\nAlice,30\nBob,28')
  const [csvFilter, setCsvFilter] = useState('')
  const [csvOut, setCsvOut] = useState('')
  const [jsonIn, setJsonIn] = useState('{\n  "user": { "name": "Alice", "tags": ["a", "b"] }\n}')
  const [jsonFlatSep, setJsonFlatSep] = useState('.')
  const [jsonFlatOut, setJsonFlatOut] = useState('')
  const [jsonUnflatIn, setJsonUnflatIn] = useState('{\n  "user.name": "Alice",\n  "user.tags.0": "a"\n}')
  const [jsonUnflatOut, setJsonUnflatOut] = useState('')
  const [jsonPathIn, setJsonPathIn] = useState('{\n  "store": { "book": [ { "title": "A" }, { "title": "B" } ] }\n}')
  const [jsonPathExpr, setJsonPathExpr] = useState('$.store.book[*].title')
  const [jsonPathOut, setJsonPathOut] = useState('')
  const [rexText, setRexText] = useState('id=123 name=alice\nid=456 name=bob')
  const [rexPat, setRexPat] = useState('id=(\\d+)\\s+name=(\\w+)')
  const [rexFlags, setRexFlags] = useState('g')
  const [rexCsv, setRexCsv] = useState('')

  const dataTools = [
    { id: 'csv', label: 'CSV viewer' },
    { id: 'json', label: 'JSON flatten' },
    { id: 'jsonpath', label: 'JSONPath' },
    { id: 'extract', label: 'Regex extract' },
  ]

  async function runCsvParse() {
    try {
      const mod = await import('papaparse')
      const Papa = mod.default || mod
      const res = Papa.parse(csvIn || '', { header: true, skipEmptyLines: true })
      const rows = Array.isArray(res.data) ? res.data : []
      const cols = res.meta?.fields || Object.keys(rows[0] || {})
      const f = csvFilter.trim().toLowerCase()
      const filtered = f
        ? rows.filter((r) => cols.some((c) => String(r?.[c] ?? '').toLowerCase().includes(f)))
        : rows
      const out = Papa.unparse(filtered)
      setCsvOut(out)
    } catch {
      setCsvOut('')
    }
  }

  async function runJsonFlatten() {
    try {
      const { flattenJson } = await import('../../utils/jsonTools.js')
      const obj = JSON.parse(jsonIn || 'null')
      const flat = flattenJson(obj, { sep: jsonFlatSep || '.' })
      setJsonFlatOut(JSON.stringify(flat, null, 2))
    } catch {
      setJsonFlatOut('')
    }
  }

  async function runJsonUnflatten() {
    try {
      const { unflattenJson } = await import('../../utils/jsonTools.js')
      const map = JSON.parse(jsonUnflatIn || 'null')
      const obj = unflattenJson(map, { sep: jsonFlatSep || '.' })
      setJsonUnflatOut(JSON.stringify(obj, null, 2))
    } catch {
      setJsonUnflatOut('')
    }
  }

  async function runJsonPath() {
    try {
      const mod = await import('jsonpath-plus')
      const JSONPath = mod.JSONPath || mod.default?.JSONPath || mod.default || mod
      const obj = JSON.parse(jsonPathIn || 'null')
      const res = JSONPath({ path: jsonPathExpr || '$', json: obj, wrap: true })
      setJsonPathOut(JSON.stringify(res, null, 2))
    } catch {
      setJsonPathOut('')
    }
  }

  async function runRegexExtract() {
    try {
      const re = new RegExp(rexPat, rexFlags || 'g')
      const lines = []
      const header = ['match', 'g1', 'g2', 'g3', 'g4', 'g5']
      lines.push(header.join(','))
      let m
      let count = 0
      while ((m = re.exec(rexText)) !== null) {
        const row = [
          JSON.stringify(m[0] ?? ''),
          JSON.stringify(m[1] ?? ''),
          JSON.stringify(m[2] ?? ''),
          JSON.stringify(m[3] ?? ''),
          JSON.stringify(m[4] ?? ''),
          JSON.stringify(m[5] ?? ''),
        ]
        lines.push(row.join(','))
        count++
        if (!rexFlags.includes('g')) break
        if (m[0] === '') re.lastIndex++
        if (count > 2000) break
      }
      setRexCsv(lines.join('\n'))
    } catch {
      setRexCsv('')
    }
  }

  const caseOut = useMemo(() => {
    const t = text
    if (caseMode === 'upper') return t.toUpperCase()
    if (caseMode === 'lower') return t.toLowerCase()
    if (caseMode === 'title') return titleCase(t)
    if (caseMode === 'sentence') return sentenceCase(t)
    if (caseMode === 'camel') return camelCase(t)
    if (caseMode === 'snake') return snakeCase(t)
    if (caseMode === 'kebab') return kebabCase(t)
    return t
  }, [text, caseMode])

  const lineOut = useMemo(() => {
    const lines = String(lineInput || '').split(/\r?\n/)
    let out = lines
    if (removeEmpty) out = removeEmptyLines(out)
    if (removeDupes) out = removeDuplicateLines(out, dupeCi)
    return out.join('\n')
  }, [lineInput, removeEmpty, removeDupes, dupeCi])

  const sortedLines = useMemo(() => {
    const lines = String(lineInput || '').split(/\r?\n/)
    const out = lines.slice()
    out.sort((x, y) => {
      const a1 = sortCi ? x.toLowerCase() : x
      const b1 = sortCi ? y.toLowerCase() : y
      return a1.localeCompare(b1)
    })
    if (sortDir === 'desc') out.reverse()
    return out.join('\n')
  }, [lineInput, sortDir, sortCi])

  const findOut = useMemo(() => {
    const input = String(findIn || '')
    if (!find) return input
    try {
      if (useRegex) {
        const re = new RegExp(find, regexFlags || 'g')
        return input.replace(re, replace)
      }
      if (regexFlags?.includes('g')) return input.split(find).join(replace)
      const i = input.indexOf(find)
      if (i < 0) return input
      return input.slice(0, i) + replace + input.slice(i + find.length)
    } catch {
      return input
    }
  }, [findIn, find, replace, useRegex, regexFlags])

  const diffParts = useMemo(() => diffLines(a || '', b || ''), [a, b])

  const mdHtml = useMemo(() => {
    const raw = marked.parse(md || '', { breaks: true, gfm: true })
    return DOMPurify.sanitize(String(raw))
  }, [md])

  const loremOut = useMemo(() => {
    const p = Math.max(1, Math.min(20, Math.floor(loremParas)))
    const w = Math.max(10, Math.min(500, Math.floor(loremWords)))
    const parts = []
    for (let i = 0; i < p; i++) parts.push(loremParagraph(w))
    return parts.join('\n\n')
  }, [loremParas, loremWords])

  const lineTools = [
    { id: 'lines-clean', label: 'Clean lines' },
    { id: 'lines-sort', label: 'Sort lines' },
  ]
  const [lineTool, setLineTool] = useState('lines-clean')

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
        key: toolKey('text', tool),
        label: `Text: ${t.label}`,
        path: `/text?tool=${tool}`,
        tool,
      })
      window.dispatchEvent(new Event('oct:prefs'))
    }
  }, [tool, setSearchParams])

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>Text Tools</h1>
        <p className="muted">All transformations are local. Nothing is sent anywhere.</p>
      </div>

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <ToolTabs tools={TOOLS} activeId={tool} onChange={setTool} />
          <FavoriteButton
            entry={{
              key: toolKey('text', tool),
              label: `Text: ${TOOLS.find((x) => x.id === tool)?.label || tool}`,
              path: `/text?tool=${tool}`,
              tool,
            }}
          />
        </div>
      </section>

      {tool === 'case' ? (
        <section className="panel">
          <h2>Case Converter</h2>
          <div className="row">
            <div className="field" style={{ minWidth: 240 }}>
              <label>Mode</label>
              <select className="select" value={caseMode} onChange={(e) => setCaseMode(e.target.value)}>
                <option value="lower">lowercase</option>
                <option value="upper">UPPERCASE</option>
                <option value="title">Title Case</option>
                <option value="sentence">Sentence case</option>
                <option value="camel">camelCase</option>
                <option value="snake">snake_case</option>
                <option value="kebab">kebab-case</option>
              </select>
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Input</label>
              <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <div className="field">
              <label>Output</label>
              <textarea className="textarea" value={caseOut} readOnly />
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'count' ? (
        <section className="panel">
          <h2>Word / Character Count</h2>
          <div className="two">
            <div className="field">
              <label>Text</label>
              <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 10 }}>
                Stats
              </div>
              <div className="table" style={{ minWidth: 0 }}>
                <div className="table__row">
                  <div>Words</div>
                  <div className="right mono">{wordCount(text)}</div>
                </div>
                <div className="table__row">
                  <div>Characters</div>
                  <div className="right mono">{charCount(text)}</div>
                </div>
                <div className="table__row">
                  <div>Characters (no spaces)</div>
                  <div className="right mono">{charCount(String(text || '').replace(/\s+/g, ''))}</div>
                </div>
                <div className="table__row">
                  <div>Lines</div>
                  <div className="right mono">{String(text || '').split(/\r?\n/).length}</div>
                </div>
                <div className="table__row">
                  <div>Sentences (approx)</div>
                  <div className="right mono">
                    {
                      (String(text || '').match(/[^.!?]+[.!?]+/g) || [])
                        .map((s) => s.trim())
                        .filter(Boolean).length
                    }
                  </div>
                </div>
                <div className="table__row">
                  <div>Paragraphs</div>
                  <div className="right mono">
                    {
                      String(text || '')
                        .split(/\n{2,}/)
                        .map((p) => p.trim())
                        .filter(Boolean).length
                    }
                  </div>
                </div>
                <div className="table__row">
                  <div>Reading time (200 wpm)</div>
                  <div className="right mono">
                    {Math.max(1, Math.ceil(wordCount(text) / 200))} min
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'whitespace' ? (
        <section className="panel">
          <h2>Multiple Whitespace Remover</h2>
          <div className="row">
            <div className="field" style={{ minWidth: 260 }}>
              <label>Mode</label>
              <select className="select" value={wsMode} onChange={(e) => setWsMode(e.target.value)}>
                <option value="collapse">Collapse spaces + extra blank lines</option>
                <option value="trimLines">Trim each line</option>
                <option value="removeLineBreaks">Remove line breaks</option>
              </select>
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Input</label>
              <textarea className="textarea" value={wsIn} onChange={(e) => setWsIn(e.target.value)} />
            </div>
            <div className="field">
              <label>Output</label>
              <textarea className="textarea" value={wsOut} readOnly />
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'bionic' ? (
        <section className="panel">
          <h2>Bionic Reading Converter</h2>
          <div className="row">
            <div className="field" style={{ width: 260 }}>
              <label>Strength</label>
              <input
                className="input"
                type="range"
                min="0.2"
                max="0.8"
                step="0.05"
                value={bioStrength}
                onChange={(e) => setBioStrength(Number(e.target.value))}
              />
            </div>
            <button
              className="button button--ghost"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(bioHtml)
                } catch {
                  // ignore
                }
              }}
            >
              Copy HTML
            </button>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Input</label>
              <textarea className="textarea" value={bioIn} onChange={(e) => setBioIn(e.target.value)} />
            </div>
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Preview</div>
              <div className="prose" dangerouslySetInnerHTML={{ __html: bioHtml }} />
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Output is HTML (sanitized) so you can paste into documents that support rich text/HTML.
          </p>
        </section>
      ) : null}

      {tool === 'handwriting' ? (
        <section className="panel">
          <h2>Text to Handwriting (PDF)</h2>
          <p className="muted">
            Renders a handwriting-like PDF locally (uses system cursive font + paper lines). No uploads.
          </p>
          <div className="two">
            <div className="field">
              <label>Paper</label>
              <select className="select" value={hwPaper} onChange={(e) => setHwPaper(e.target.value)} disabled={hwBusy}>
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
              </select>
            </div>
            <div className="row">
              <div className="field" style={{ width: 160 }}>
                <label>Ink</label>
                <input className="input" type="color" value={hwInk} onChange={(e) => setHwInk(e.target.value)} disabled={hwBusy} />
              </div>
              <div className="field" style={{ width: 160 }}>
                <label>Font size</label>
                <input className="input" type="number" value={hwFontSize} onChange={(e) => setHwFontSize(Number(e.target.value))} disabled={hwBusy} />
              </div>
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Text</label>
            <textarea className="textarea" value={hwText} onChange={(e) => setHwText(e.target.value)} disabled={hwBusy} />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={downloadHandwritingPdf} disabled={hwBusy || !hwText.trim()}>
              {hwBusy ? 'Rendering...' : 'Download PDF'}
            </button>
          </div>
        </section>
      ) : null}

      {tool === 'fontpair' ? (
        <section className="panel">
          <h2>Font Pair Finder (Offline)</h2>
          <p className="muted">
            This tool suggests font pairings and generates CSS/HTML snippets. The app does not download fonts.
            If you use the Google Fonts snippet in your own website, your website will fetch fonts from Google.
          </p>
          <div className="row">
            <div className="field" style={{ minWidth: 320 }}>
              <label>Pair</label>
              <select className="select" value={fpId} onChange={(e) => setFpId(e.target.value)}>
                {fontPairs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="button button--ghost"
              type="button"
              onClick={async () => {
                const css = `:root {\\n  --font-heading: ${fp.heading.css};\\n  --font-body: ${fp.body.css};\\n}\\n\\nh1, h2, h3 { font-family: var(--font-heading); }\\nbody { font-family: var(--font-body); }\\n`
                try {
                  await navigator.clipboard.writeText(css)
                } catch {
                  // ignore
                }
              }}
            >
              Copy CSS
            </button>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 10 }}>Preview (system fonts only)</div>
              <div style={{ fontFamily: fp.body.css, color: 'rgba(255,255,255,0.86)' }}>
                <div style={{ fontFamily: fp.heading.css, fontSize: 34, fontWeight: 800, marginBottom: 8 }}>
                  The quick brown fox
                </div>
                <div style={{ fontSize: 15, lineHeight: 1.6 }}>
                  Headings use <span className="mono">{fp.heading.label}</span>. Body uses <span className="mono">{fp.body.label}</span>. This preview uses whatever fonts you already have locally.
                </div>
              </div>
            </div>
            <div className="stack">
              <div className="field">
                <label>CSS variables</label>
                <textarea
                  className="textarea"
                  value={`:root {\\n  --font-heading: ${fp.heading.css};\\n  --font-body: ${fp.body.css};\\n}\\n\\nh1, h2, h3 { font-family: var(--font-heading); }\\nbody { font-family: var(--font-body); }\\n`}
                  readOnly
                />
              </div>
              {fp.google ? (
                <div className="field">
                  <label>Google Fonts (optional snippet)</label>
                  <textarea className="textarea" value={fp.google.link} readOnly />
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'lines' ? (
        <section className="panel">
          <h2>Line Tools</h2>
          <ToolTabs tools={lineTools} activeId={lineTool} onChange={setLineTool} />

          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Input</label>
              <textarea className="textarea" value={lineInput} onChange={(e) => setLineInput(e.target.value)} />
            </div>
            <div className="field">
              <label>Output</label>
              <textarea
                className="textarea"
                value={lineTool === 'lines-sort' ? sortedLines : lineOut}
                readOnly
              />
            </div>
          </div>

          {lineTool === 'lines-clean' ? (
            <div className="row" style={{ marginTop: 10 }}>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={removeEmpty} onChange={(e) => setRemoveEmpty(e.target.checked)} />
                <span className="muted">Remove empty lines</span>
              </label>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={removeDupes} onChange={(e) => setRemoveDupes(e.target.checked)} />
                <span className="muted">Remove duplicates</span>
              </label>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={dupeCi} onChange={(e) => setDupeCi(e.target.checked)} />
                <span className="muted">Case-insensitive</span>
              </label>
            </div>
          ) : null}

          {lineTool === 'lines-sort' ? (
            <div className="row" style={{ marginTop: 10 }}>
              <div className="field" style={{ minWidth: 160 }}>
                <label>Direction</label>
                <select className="select" value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </div>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={sortCi} onChange={(e) => setSortCi(e.target.checked)} />
                <span className="muted">Case-insensitive</span>
              </label>
            </div>
          ) : null}
        </section>
      ) : null}

      {tool === 'find' ? (
        <section className="panel">
          <h2>Find & Replace</h2>
          <div className="two">
            <div className="field">
              <label>Input</label>
              <textarea className="textarea" value={findIn} onChange={(e) => setFindIn(e.target.value)} />
            </div>
            <div className="field">
              <label>Output</label>
              <textarea className="textarea" value={findOut} readOnly />
            </div>
          </div>

          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Find</label>
              <input className="input" value={find} onChange={(e) => setFind(e.target.value)} />
            </div>
            <div className="field">
              <label>Replace</label>
              <input className="input" value={replace} onChange={(e) => setReplace(e.target.value)} />
            </div>
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} />
              <span className="muted">Use regex</span>
            </label>
            <div className="field" style={{ minWidth: 180 }}>
              <label>Regex flags</label>
              <input
                className="input"
                value={regexFlags}
                onChange={(e) => setRegexFlags(e.target.value)}
                disabled={!useRegex}
                placeholder="gim"
              />
            </div>
            {useRegex ? <div className="muted">If the regex is invalid, output stays unchanged.</div> : null}
          </div>
        </section>
      ) : null}

      {tool === 'diff' ? (
        <section className="panel">
          <h2>Diff Checker (Line)</h2>
          <div className="two">
            <div className="field">
              <label>Text A</label>
              <textarea className="textarea" value={a} onChange={(e) => setA(e.target.value)} />
            </div>
            <div className="field">
              <label>Text B</label>
              <textarea className="textarea" value={b} onChange={(e) => setB(e.target.value)} />
            </div>
          </div>

          <div className="panel" style={{ padding: 14, marginTop: 10 }}>
            <div className="mono muted" style={{ marginBottom: 8 }}>
              Diff output
            </div>
            <div className="mono" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>
              {diffParts.map((p, i) => (
                <span
                  key={i}
                  style={{
                    background: p.added ? 'rgba(126,228,255,0.12)' : p.removed ? 'rgba(255,107,107,0.12)' : 'transparent',
                    color: p.added ? 'rgba(255,255,255,0.92)' : p.removed ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.78)',
                  }}
                >
                  {p.value}
                </span>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'slug' ? (
        <section className="panel">
          <h2>Slug Generator</h2>
          <div className="two">
            <div className="field">
              <label>Input</label>
              <input className="input" value={slugIn} onChange={(e) => setSlugIn(e.target.value)} />
            </div>
            <div className="field">
              <label>Slug</label>
              <input className="input mono" value={toSlug(slugIn)} readOnly />
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'lorem' ? (
        <section className="panel">
          <h2>Lorem Ipsum Generator</h2>
          <div className="row">
            <div className="field" style={{ width: 160 }}>
              <label>Paragraphs</label>
              <input className="input" type="number" value={loremParas} onChange={(e) => setLoremParas(e.target.value)} />
            </div>
            <div className="field" style={{ width: 160 }}>
              <label>Words per paragraph</label>
              <input className="input" type="number" value={loremWords} onChange={(e) => setLoremWords(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Output</label>
            <textarea className="textarea" value={loremOut} readOnly />
          </div>
        </section>
      ) : null}

      {tool === 'md' ? (
        <section className="panel">
          <h2>Markdown Preview</h2>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Markdown</label>
              <textarea className="textarea" value={md} onChange={(e) => setMd(e.target.value)} />
            </div>
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>
                Preview
              </div>
              <div
                className="prose"
                dangerouslySetInnerHTML={{ __html: mdHtml }}
              />
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            HTML is sanitized before rendering.
          </p>
        </section>
      ) : null}

      {tool === 'data' ? (
        <section className="panel">
          <h2>Data Tools</h2>
          <ToolTabs tools={dataTools} activeId={dataTool} onChange={setDataTool} />

          {dataTool === 'csv' ? (
            <div className="stack" style={{ marginTop: 10 }}>
              <div className="row">
                <button className="button" type="button" onClick={runCsvParse}>
                  Parse & export filtered CSV
                </button>
                <div className="field" style={{ flex: 1 }}>
                  <label>Filter (contains)</label>
                  <input className="input" value={csvFilter} onChange={(e) => setCsvFilter(e.target.value)} placeholder="type to filter rows" />
                </div>
              </div>
              <div className="two">
                <div className="field">
                  <label>CSV input</label>
                  <textarea className="textarea" value={csvIn} onChange={(e) => setCsvIn(e.target.value)} />
                </div>
                <div className="field">
                  <label>Filtered CSV output</label>
                  <textarea className="textarea" value={csvOut} readOnly placeholder="Click parse to generate output" />
                </div>
              </div>
            </div>
          ) : null}

          {dataTool === 'json' ? (
            <div className="stack" style={{ marginTop: 10 }}>
              <div className="row">
                <div className="field" style={{ width: 160 }}>
                  <label>Separator</label>
                  <input className="input mono" value={jsonFlatSep} onChange={(e) => setJsonFlatSep(e.target.value)} />
                </div>
                <button className="button" type="button" onClick={runJsonFlatten}>
                  Flatten
                </button>
                <button className="button button--ghost" type="button" onClick={runJsonUnflatten}>
                  Unflatten
                </button>
              </div>
              <div className="two">
                <div className="field">
                  <label>JSON input</label>
                  <textarea className="textarea" value={jsonIn} onChange={(e) => setJsonIn(e.target.value)} />
                </div>
                <div className="field">
                  <label>Flattened output</label>
                  <textarea className="textarea" value={jsonFlatOut} readOnly />
                </div>
              </div>
              <div className="two">
                <div className="field">
                  <label>Flattened map (JSON)</label>
                  <textarea className="textarea" value={jsonUnflatIn} onChange={(e) => setJsonUnflatIn(e.target.value)} />
                </div>
                <div className="field">
                  <label>Unflattened output</label>
                  <textarea className="textarea" value={jsonUnflatOut} readOnly />
                </div>
              </div>
            </div>
          ) : null}

          {dataTool === 'jsonpath' ? (
            <div className="stack" style={{ marginTop: 10 }}>
              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>JSONPath</label>
                  <input className="input mono" value={jsonPathExpr} onChange={(e) => setJsonPathExpr(e.target.value)} />
                </div>
                <button className="button" type="button" onClick={runJsonPath}>
                  Run
                </button>
              </div>
              <div className="two">
                <div className="field">
                  <label>JSON input</label>
                  <textarea className="textarea" value={jsonPathIn} onChange={(e) => setJsonPathIn(e.target.value)} />
                </div>
                <div className="field">
                  <label>Result</label>
                  <textarea className="textarea" value={jsonPathOut} readOnly />
                </div>
              </div>
            </div>
          ) : null}

          {dataTool === 'extract' ? (
            <div className="stack" style={{ marginTop: 10 }}>
              <div className="row">
                <div className="field" style={{ flex: 1 }}>
                  <label>Regex (capture groups)</label>
                  <input className="input mono" value={rexPat} onChange={(e) => setRexPat(e.target.value)} />
                </div>
                <div className="field" style={{ width: 160 }}>
                  <label>Flags</label>
                  <input className="input mono" value={rexFlags} onChange={(e) => setRexFlags(e.target.value)} />
                </div>
                <button className="button" type="button" onClick={runRegexExtract}>
                  Extract to CSV
                </button>
              </div>
              <div className="two">
                <div className="field">
                  <label>Text</label>
                  <textarea className="textarea" value={rexText} onChange={(e) => setRexText(e.target.value)} />
                </div>
                <div className="field">
                  <label>CSV output</label>
                  <textarea className="textarea" value={rexCsv} readOnly />
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
