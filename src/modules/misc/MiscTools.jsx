import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ToolTabs from '../../components/ToolTabs.jsx'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import { addRecent, toolKey } from '../../utils/toolPrefs.js'

const TOOLS = [
  { id: 'random', label: 'List Randomizer' },
  { id: 'iban', label: 'Fake IBAN' },
  { id: 'dice', label: 'Dice Roller' },
  { id: 'password', label: 'Strong Password' },
]

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function randDigit() {
  const x = new Uint8Array(1)
  crypto.getRandomValues(x)
  return String(x[0] % 10)
}

function randDigits(n) {
  let out = ''
  for (let i = 0; i < n; i++) out += randDigit()
  return out
}

function randLetter() {
  const x = new Uint8Array(1)
  crypto.getRandomValues(x)
  return String.fromCharCode(65 + (x[0] % 26))
}

function randAlnum(n) {
  let out = ''
  for (let i = 0; i < n; i++) {
    const x = new Uint8Array(1)
    crypto.getRandomValues(x)
    const v = x[0] % 36
    out += v < 10 ? String(v) : String.fromCharCode(65 + (v - 10))
  }
  return out
}

function randomUint32() {
  const x = new Uint32Array(1)
  crypto.getRandomValues(x)
  return x[0]
}

function randomIntInclusive(min, max) {
  const a = Math.floor(Math.min(min, max))
  const b = Math.floor(Math.max(min, max))
  const span = b - a + 1
  return a + (randomUint32() % span)
}

function estimateStrength(pw) {
  const s = String(pw || '')
  let pool = 0
  if (/[a-z]/.test(s)) pool += 26
  if (/[A-Z]/.test(s)) pool += 26
  if (/[0-9]/.test(s)) pool += 10
  if (/[^a-zA-Z0-9]/.test(s)) pool += 32
  const entropy = s.length * Math.log2(Math.max(1, pool))
  let label = 'Weak'
  if (entropy >= 60) label = 'Strong'
  else if (entropy >= 40) label = 'Good'
  else if (entropy >= 28) label = 'OK'
  return { entropy: Math.round(entropy), label }
}

function genPassword(len, opts) {
  const lower = 'abcdefghijklmnopqrstuvwxyz'
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const digits = '0123456789'
  const symbols = '!@#$%^&*()-_=+[]{};:,.?'

  let alphabet = ''
  if (opts.lower) alphabet += lower
  if (opts.upper) alphabet += upper
  if (opts.digits) alphabet += digits
  if (opts.symbols) alphabet += symbols
  if (!alphabet) alphabet = lower + upper + digits

  const out = []
  const bytes = crypto.getRandomValues(new Uint32Array(len))
  for (let i = 0; i < len; i++) out.push(alphabet[bytes[i] % alphabet.length])
  return out.join('')
}

function ibanMod97(ibanNumericString) {
  // Compute mod 97 without bigints by chunking.
  let remainder = 0
  const s = String(ibanNumericString || '').replace(/\s+/g, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    if (ch < 48 || ch > 57) continue
    remainder = (remainder * 10 + (ch - 48)) % 97
  }
  return remainder
}

function ibanChecksum(countryCode, bban) {
  const cc = String(countryCode || '').toUpperCase()
  const moved = `${bban}${cc}00`
  let numeric = ''
  for (const ch of moved) {
    const code = ch.charCodeAt(0)
    if (code >= 48 && code <= 57) numeric += ch
    else if (code >= 65 && code <= 90) numeric += String(code - 55) // A=10
  }
  const mod = ibanMod97(numeric)
  const check = String(98 - mod).padStart(2, '0')
  return check
}

const IBAN_COUNTRIES = [
  { cc: 'DE', label: 'Germany (DE)', len: 22, gen: () => randDigits(8) + randDigits(10) },
  { cc: 'GB', label: 'United Kingdom (GB)', len: 22, gen: () => randLetter() + randLetter() + randLetter() + randLetter() + randDigits(6) + randDigits(8) },
  { cc: 'FR', label: 'France (FR)', len: 27, gen: () => randDigits(5) + randDigits(5) + randAlnum(11) + randDigits(2) },
  { cc: 'NL', label: 'Netherlands (NL)', len: 18, gen: () => randLetter() + randLetter() + randLetter() + randLetter() + randDigits(10) },
  { cc: 'BE', label: 'Belgium (BE)', len: 16, gen: () => randDigits(12) },
  { cc: 'CH', label: 'Switzerland (CH)', len: 21, gen: () => randDigits(5) + randDigits(12) },
  { cc: 'ES', label: 'Spain (ES)', len: 24, gen: () => randDigits(20) },
  { cc: 'IT', label: 'Italy (IT)', len: 27, gen: () => randLetter() + randDigits(10) + randAlnum(12) },
  { cc: 'PL', label: 'Poland (PL)', len: 28, gen: () => randDigits(24) },
]

function formatIban(iban) {
  return String(iban || '')
    .replace(/\s+/g, '')
    .replace(/(.{4})/g, '$1 ')
    .trim()
}

export default function MiscTools() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tool, setTool] = useState('random')

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
        key: toolKey('misc', tool),
        label: `Misc: ${t.label}`,
        path: `/misc?tool=${tool}`,
        tool,
      })
      window.dispatchEvent(new Event('oct:prefs'))
    }
  }, [tool, setSearchParams])

  // List randomizer
  const [listIn, setListIn] = useState('Alice\nBob\nCharlie\nDana\nEve')
  const [mode, setMode] = useState('shuffle') // shuffle|pick
  const [pickN, setPickN] = useState(1)
  const items = useMemo(
    () =>
      String(listIn || '')
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean),
    [listIn],
  )

  const [listOut, setListOut] = useState('')
  function runRandomize() {
    const arr = items.slice()
    if (!arr.length) return setListOut('')
    // Fisher-Yates with crypto randomness
    for (let i = arr.length - 1; i > 0; i--) {
      const x = new Uint32Array(1)
      crypto.getRandomValues(x)
      const j = x[0] % (i + 1)
      const tmp = arr[i]
      arr[i] = arr[j]
      arr[j] = tmp
    }
    if (mode === 'pick') {
      const n = clamp(Math.floor(Number(pickN) || 1), 1, arr.length)
      setListOut(arr.slice(0, n).join('\n'))
    } else {
      setListOut(arr.join('\n'))
    }
  }

  // Fake IBAN
  const [ibanCountry, setIbanCountry] = useState('DE')
  const [ibanOut, setIbanOut] = useState('')
  function genIban() {
    const c = IBAN_COUNTRIES.find((x) => x.cc === ibanCountry) || IBAN_COUNTRIES[0]
    const bban = c.gen()
    const check = ibanChecksum(c.cc, bban)
    const iban = `${c.cc}${check}${bban}`
    setIbanOut(formatIban(iban))
  }

  // Dice roller
  const [diceCount, setDiceCount] = useState(2)
  const [diceSides, setDiceSides] = useState(6)
  const [diceMod, setDiceMod] = useState(0)
  const [diceRolls, setDiceRolls] = useState([])
  const [diceTotal, setDiceTotal] = useState(0)
  const [diceHistory, setDiceHistory] = useState([])
  function rollDice() {
    const n = clamp(Math.floor(Number(diceCount) || 1), 1, 30)
    const s = clamp(Math.floor(Number(diceSides) || 6), 2, 1000)
    const m = Math.floor(Number(diceMod) || 0)
    const rolls = Array.from({ length: n }, () => randomIntInclusive(1, s))
    const total = rolls.reduce((a, b) => a + b, 0) + m
    setDiceRolls(rolls)
    setDiceTotal(total)
    setDiceHistory((h) => [`${n}d${s}${m ? (m > 0 ? `+${m}` : `${m}`) : ''} = ${total} [${rolls.join(', ')}]`, ...h].slice(0, 20))
  }

  // Strong random password
  const [pwLen, setPwLen] = useState(24)
  const [pwOpts, setPwOpts] = useState({ lower: true, upper: true, digits: true, symbols: true })
  const [pwOut, setPwOut] = useState('')
  const pwStrength = useMemo(() => estimateStrength(pwOut), [pwOut])
  function runPassword() {
    const n = clamp(Math.floor(Number(pwLen) || 24), 6, 256)
    setPwOut(genPassword(n, pwOpts))
  }

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>Misc Tools</h1>
        <p className="muted">Small offline tools and generators. No uploads, no backend, no external APIs.</p>
      </div>

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <ToolTabs tools={TOOLS} activeId={tool} onChange={setTool} />
          <FavoriteButton
            entry={{
              key: toolKey('misc', tool),
              label: `Misc: ${TOOLS.find((x) => x.id === tool)?.label || tool}`,
              path: `/misc?tool=${tool}`,
              tool,
            }}
          />
        </div>
      </section>

      {tool === 'random' ? (
        <section className="panel">
          <h2>List Randomizer</h2>
          <div className="row">
            <div className="field" style={{ width: 220 }}>
              <label>Mode</label>
              <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="shuffle">Shuffle</option>
                <option value="pick">Pick N</option>
              </select>
            </div>
            {mode === 'pick' ? (
              <div className="field" style={{ width: 160 }}>
                <label>N</label>
                <input className="input" type="number" value={pickN} onChange={(e) => setPickN(e.target.value)} />
              </div>
            ) : null}
            <button className="button" type="button" onClick={runRandomize} disabled={!items.length}>
              Run
            </button>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Input (one per line)</label>
              <textarea className="textarea" value={listIn} onChange={(e) => setListIn(e.target.value)} />
            </div>
            <div className="field">
              <label>Output</label>
              <textarea className="textarea" value={listOut} readOnly />
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Uses `crypto.getRandomValues()` for randomness.
          </p>
        </section>
      ) : null}

      {tool === 'iban' ? (
        <section className="panel">
          <h2>Fake IBAN Generator</h2>
          <div className="row">
            <div className="field" style={{ width: 320 }}>
              <label>Country</label>
              <select className="select" value={ibanCountry} onChange={(e) => setIbanCountry(e.target.value)}>
                {IBAN_COUNTRIES.map((c) => (
                  <option key={c.cc} value={c.cc}>{c.label}</option>
                ))}
              </select>
            </div>
            <button className="button" type="button" onClick={genIban}>
              Generate
            </button>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>IBAN</label>
            <input className="input mono" value={ibanOut} readOnly placeholder="Click Generate" />
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Generates an IBAN that matches the country format and checksum, but it is not linked to a real bank account.
          </p>
        </section>
      ) : null}

      {tool === 'dice' ? (
        <section className="panel">
          <h2>Dice Roller</h2>
          <div className="row">
            <div className="field" style={{ width: 140 }}>
              <label>Dice</label>
              <input className="input" type="number" value={diceCount} onChange={(e) => setDiceCount(e.target.value)} />
            </div>
            <div className="field" style={{ width: 140 }}>
              <label>Sides</label>
              <input className="input" type="number" value={diceSides} onChange={(e) => setDiceSides(e.target.value)} />
            </div>
            <div className="field" style={{ width: 140 }}>
              <label>Modifier</label>
              <input className="input" type="number" value={diceMod} onChange={(e) => setDiceMod(e.target.value)} />
            </div>
            <button className="button" type="button" onClick={rollDice}>
              Roll
            </button>
          </div>
          <div className="panel" style={{ marginTop: 10, padding: 12 }}>
            <div className="mono">Rolls: {diceRolls.length ? diceRolls.join(', ') : '-'}</div>
            <div className="mono" style={{ marginTop: 6 }}>Total: {diceRolls.length ? diceTotal : '-'}</div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>History</label>
            <textarea className="textarea" readOnly value={diceHistory.join('\n')} />
          </div>
        </section>
      ) : null}

      {tool === 'password' ? (
        <section className="panel">
          <h2>Strong Random Password</h2>
          <div className="row">
            <div className="field" style={{ width: 180 }}>
              <label>Length</label>
              <input className="input" type="number" value={pwLen} onChange={(e) => setPwLen(e.target.value)} />
            </div>
            <label className="row">
              <input type="checkbox" checked={pwOpts.lower} onChange={(e) => setPwOpts((s) => ({ ...s, lower: e.target.checked }))} />
              <span className="muted">a-z</span>
            </label>
            <label className="row">
              <input type="checkbox" checked={pwOpts.upper} onChange={(e) => setPwOpts((s) => ({ ...s, upper: e.target.checked }))} />
              <span className="muted">A-Z</span>
            </label>
            <label className="row">
              <input type="checkbox" checked={pwOpts.digits} onChange={(e) => setPwOpts((s) => ({ ...s, digits: e.target.checked }))} />
              <span className="muted">0-9</span>
            </label>
            <label className="row">
              <input type="checkbox" checked={pwOpts.symbols} onChange={(e) => setPwOpts((s) => ({ ...s, symbols: e.target.checked }))} />
              <span className="muted">Symbols</span>
            </label>
            <button className="button" type="button" onClick={runPassword}>
              Generate
            </button>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Password</label>
            <input className="input mono" value={pwOut} readOnly />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <div className="mono">Strength: {pwStrength.label}</div>
            <div className="mono muted">Entropy: {pwStrength.entropy} bits</div>
            <button
              className="button button--ghost"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(String(pwOut || ''))
                } catch {
                  // ignore
                }
              }}
              disabled={!pwOut}
            >
              Copy
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Not Included (By Design)</h2>
        <p className="muted">
          Tools that require private platform APIs or server-side scraping are intentionally excluded because this project is frontend-only, privacy-first, and backend-free.
        </p>
      </section>
    </div>
  )
}
