import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ToolTabs from '../../components/ToolTabs.jsx'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import { hashBytes, hashFile, hashText } from '../../utils/crypto.js'
import { downloadBlob } from '../../utils/file.js'
import { encryptFileToBlob, decryptBlobToFile, hmacHex } from '../../utils/security.js'
import { totp } from '../../utils/totp.js'
import { parseEnv, dedupeEnv, sortEnv, stringifyEnv } from '../../utils/env.js'
import { addRecent, toolKey } from '../../utils/toolPrefs.js'

import YAML from 'yaml'
import Papa from 'papaparse'
import { css as beautifyCss, html as beautifyHtml, js as beautifyJs } from 'js-beautify'

const TOOLS = [
  { id: 'base64', label: 'Base64' },
  { id: 'encode', label: 'URL/HTML' },
  { id: 'jwt', label: 'JWT' },
  { id: 'hash', label: 'Hash' },
  { id: 'checksum', label: 'Checksum Suite' },
  { id: 'security', label: 'Security' },
  { id: 'headers', label: 'Headers' },
  { id: 'env', label: '.env' },
  { id: 'schema', label: 'JSON Schema' },
  { id: 'password', label: 'Password' },
  { id: 'format', label: 'Format/Convert' },
  { id: 'regex', label: 'Regex' },
  { id: 'uuid', label: 'UUID' },
  { id: 'time', label: 'Timestamp' },
  { id: 'cron', label: 'Cron' },
  { id: 'beautify', label: 'Beautify/Minify' },
]

const INITIAL_NOW = Date.now()
const INITIAL_EPOCH = String(INITIAL_NOW)
const INITIAL_ISO = new Date(INITIAL_NOW).toISOString()

function b64EncodeUtf8(s) {
  const bytes = new TextEncoder().encode(String(s || ''))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function b64DecodeUtf8(s) {
  const bin = atob(String(s || '').trim())
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function b64UrlDecode(s) {
  const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/')
  const pad = t.length % 4 ? '='.repeat(4 - (t.length % 4)) : ''
  return b64DecodeUtf8(t + pad)
}

function b64UrlEncodeBytes(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function b64UrlEncodeUtf8(s) {
  return b64UrlEncodeBytes(new TextEncoder().encode(String(s || '')))
}

function htmlEncode(s) {
  const div = document.createElement('div')
  div.innerText = String(s || '')
  return div.innerHTML
}

function htmlDecode(s) {
  const div = document.createElement('div')
  div.innerHTML = String(s || '')
  return div.innerText
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

function parseXml(xml) {
  const doc = new DOMParser().parseFromString(String(xml || ''), 'application/xml')
  const err = doc.querySelector('parsererror')
  if (err) throw new Error('Invalid XML.')
  return doc
}

function xmlToJson(node) {
  // Minimal XML->JSON representation: elements, attributes, and text nodes.
  if (node.nodeType === Node.TEXT_NODE) {
    const t = node.nodeValue?.trim()
    return t ? t : null
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null

  const obj = { _name: node.nodeName }
  if (node.attributes?.length) {
    obj._attrs = {}
    for (const a of Array.from(node.attributes)) obj._attrs[a.name] = a.value
  }

  const children = Array.from(node.childNodes || [])
    .map(xmlToJson)
    .filter((x) => x !== null)

  if (!children.length) return obj
  if (children.length === 1 && typeof children[0] === 'string') {
    obj._text = children[0]
    return obj
  }
  obj._children = children
  return obj
}

function jsonToXml(obj, name = 'root') {
  // Minimal JSON->XML conversion: expects plain objects/arrays/primitives.
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (obj === null || obj === undefined) return `<${name}/>`
  if (typeof obj !== 'object') return `<${name}>${esc(obj)}</${name}>`
  if (Array.isArray(obj)) return obj.map((v) => jsonToXml(v, name)).join('')

  const attrs = obj._attrs && typeof obj._attrs === 'object'
    ? Object.entries(obj._attrs)
        .map(([k, v]) => ` ${k}="${esc(v)}"`)
        .join('')
    : ''

  const children = obj._children
  const text = obj._text

  if (typeof text === 'string') return `<${name}${attrs}>${esc(text)}</${name}>`
  if (Array.isArray(children)) {
    const inner = children
      .map((c) => {
        if (typeof c === 'string') return esc(c)
        if (c && typeof c === 'object') return jsonToXml(c, c._name || 'node')
        return ''
      })
      .join('')
    return `<${name}${attrs}>${inner}</${name}>`
  }

  const inner = Object.entries(obj)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => jsonToXml(v, k))
    .join('')
  if (!inner) return `<${name}${attrs}/>`
  return `<${name}${attrs}>${inner}</${name}>`
}

function simpleMinify(kind, input) {
  const s = String(input || '')
  if (kind === 'css') return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim()
  if (kind === 'html') return s.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim()
  if (kind === 'js') return s.replace(/\/\/[^\n]*\n/g, '\n').replace(/\s+/g, ' ').trim()
  return s
}

function toHexN(n) {
  return (n >>> 0).toString(16).padStart(8, '0')
}

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i]
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes) {
  const MOD = 65521
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % MOD
    b = (b + a) % MOD
  }
  return (((b << 16) | a) >>> 0)
}

export default function DeveloperTools() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tool, setTool] = useState('base64')
  const [err, setErr] = useState('')

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
        key: toolKey('developer', tool),
        label: `Dev: ${t.label}`,
        path: `/developer?tool=${tool}`,
        tool,
      })
      window.dispatchEvent(new Event('oct:prefs'))
    }
  }, [tool, setSearchParams])

  // Base64
  const [b64In, setB64In] = useState('')
  const [b64Mode, setB64Mode] = useState('encode')
  const b64Out = useMemo(() => {
    try {
      if (b64Mode === 'encode') return b64EncodeUtf8(b64In)
      return b64DecodeUtf8(b64In)
    } catch {
      return ''
    }
  }, [b64In, b64Mode])

  // URL/HTML
  const [encIn, setEncIn] = useState('')
  const [encKind, setEncKind] = useState('url')
  const [encDir, setEncDir] = useState('encode')
  const encOut = useMemo(() => {
    try {
      if (encKind === 'url') return encDir === 'encode' ? encodeURIComponent(encIn) : decodeURIComponent(encIn)
      return encDir === 'encode' ? htmlEncode(encIn) : htmlDecode(encIn)
    } catch {
      return ''
    }
  }, [encIn, encKind, encDir])

  // JWT
  const [jwt, setJwt] = useState('')
  const [jwtHeaderIn, setJwtHeaderIn] = useState('{\n  "alg": "none",\n  "typ": "JWT"\n}')
  const [jwtPayloadIn, setJwtPayloadIn] = useState('{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": 1516239022\n}')
  const [jwtSignAlg, setJwtSignAlg] = useState('none')
  const [jwtSecret, setJwtSecret] = useState('')
  const [jwtOut, setJwtOut] = useState('')
  const jwtParts = useMemo(() => {
    const parts = String(jwt || '').trim().split('.')
    if (parts.length < 2) return null
    try {
      const header = JSON.parse(b64UrlDecode(parts[0]))
      const payload = JSON.parse(b64UrlDecode(parts[1]))
      return { header, payload }
    } catch {
      return null
    }
  }, [jwt])

  // Hash
  const [hashAlg, setHashAlg] = useState('SHA-256')
  const [hashIn, setHashIn] = useState('')
  const [hashOut, setHashOut] = useState('')
  const [hashFileOut, setHashFileOut] = useState('')
  const [hashExpected, setHashExpected] = useState('')

  // Checksum suite
  const [chkText, setChkText] = useState('')
  const [chkFile, setChkFile] = useState(null)
  const [chkOut, setChkOut] = useState({})
  const [chkBusy, setChkBusy] = useState(false)

  // Security
  const [secPass, setSecPass] = useState('')
  const [secEncFile, setSecEncFile] = useState(null)
  const [secDecFile, setSecDecFile] = useState(null)
  const [secBusy, setSecBusy] = useState(false)

  const [secHmacAlg, setSecHmacAlg] = useState('SHA-256')
  const [secHmacKey, setSecHmacKey] = useState('')
  const [secHmacMsg, setSecHmacMsg] = useState('')
  const [secHmacOut, setSecHmacOut] = useState('')

  const [secTotpSecret, setSecTotpSecret] = useState('')
  const [secTotpDigits, setSecTotpDigits] = useState(6)
  const [secTotpStep, setSecTotpStep] = useState(30)
  const [secTotpAlg, setSecTotpAlg] = useState('SHA-1')
  const [secTotpCode, setSecTotpCode] = useState('')
  const [secTotpLeft, setSecTotpLeft] = useState(0)
  const totpTimerRef = useRef(null)

  // Headers (CSP)
  const [cspDefault, setCspDefault] = useState("'self'")
  const [cspScript, setCspScript] = useState("'self'")
  const [cspStyle, setCspStyle] = useState("'self' 'unsafe-inline'")
  const [cspImg, setCspImg] = useState("'self' data:")
  const [cspConnect, setCspConnect] = useState("'self'")
  const [cspFrameAnc, setCspFrameAnc] = useState("'none'")

  const cspValue = useMemo(() => {
    const parts = []
    const add = (k, v) => {
      const t = String(v || '').trim()
      if (t) parts.push(`${k} ${t}`)
    }
    add('default-src', cspDefault)
    add('script-src', cspScript)
    add('style-src', cspStyle)
    add('img-src', cspImg)
    add('connect-src', cspConnect)
    add('frame-ancestors', cspFrameAnc)
    return parts.join('; ')
  }, [cspDefault, cspScript, cspStyle, cspImg, cspConnect, cspFrameAnc])

  // .env
  const [envIn, setEnvIn] = useState('')
  const [envQuote, setEnvQuote] = useState('auto')
  const [envStrategy, setEnvStrategy] = useState('last')
  const [envSort, setEnvSort] = useState(true)
  const envParsed = useMemo(() => parseEnv(envIn), [envIn])
  const envPairs = useMemo(() => envParsed.filter((e) => e.type === 'pair'), [envParsed])
  const envDupes = useMemo(() => {
    const seen = new Set()
    const dup = new Set()
    for (const p of envPairs) {
      if (seen.has(p.key)) dup.add(p.key)
      else seen.add(p.key)
    }
    return Array.from(dup).sort()
  }, [envPairs])
  const envOut = useMemo(() => {
    let pairs = dedupeEnv(envParsed, { strategy: envStrategy })
    if (envSort) pairs = sortEnv(pairs)
    return stringifyEnv(pairs, { quote: envQuote, preserveComments: false, preserveUnknown: false })
  }, [envParsed, envStrategy, envSort, envQuote])

  // JSON Schema (Ajv)
  const [schemaIn, setSchemaIn] = useState('{\n  "$schema": "https://json-schema.org/draft/2020-12/schema",\n  "type": "object",\n  "properties": { "name": { "type": "string" } },\n  "required": ["name"]\n}')
  const [schemaData, setSchemaData] = useState('{\n  "name": "Alice"\n}')
  const [schemaOut, setSchemaOut] = useState('')

  // Password
  const [pwLen, setPwLen] = useState(24)
  const [pwOpts, setPwOpts] = useState({ lower: true, upper: true, digits: true, symbols: false })
  const [pw, setPw] = useState('')
  const strength = useMemo(() => estimateStrength(pw), [pw])

  // Format/Convert
  const [fmtIn, setFmtIn] = useState('')
  const [fmtFrom, setFmtFrom] = useState('json')
  const [fmtTo, setFmtTo] = useState('yaml')
  const [fmtOut, setFmtOut] = useState('')

  // Regex
  const [rePat, setRePat] = useState('')
  const [reFlags, setReFlags] = useState('g')
  const [reText, setReText] = useState('')
  const reMatches = useMemo(() => {
    try {
      if (!rePat) return []
      const re = new RegExp(rePat, reFlags)
      const out = []
      let m
      while ((m = re.exec(reText)) !== null) {
        out.push({ index: m.index, match: m[0], groups: m.slice(1) })
        if (!reFlags.includes('g')) break
        if (m[0] === '') re.lastIndex++
      }
      return out
    } catch {
      return null
    }
  }, [rePat, reFlags, reText])

  // UUID
  const [uuid, setUuid] = useState('')

  // Timestamp
  const [epoch, setEpoch] = useState(INITIAL_EPOCH)
  const timeOut = useMemo(() => {
    const n = Number(epoch)
    if (!Number.isFinite(n)) return null
    const ms = epoch.length <= 10 ? n * 1000 : n
    const d = new Date(ms)
    if (isNaN(d.getTime())) return null
    return { iso: d.toISOString(), local: d.toLocaleString() }
  }, [epoch])
  const [dateIn, setDateIn] = useState(INITIAL_ISO)
  const dateToEpoch = useMemo(() => {
    const d = new Date(dateIn)
    if (isNaN(d.getTime())) return null
    return { ms: d.getTime(), s: Math.floor(d.getTime() / 1000) }
  }, [dateIn])

  // Cron generator (5-field, minute hour day month weekday)
  const [cronKind, setCronKind] = useState('every_n_minutes')
  const [cronN, setCronN] = useState(5)
  const [cronHour, setCronHour] = useState(9)
  const [cronMinute, setCronMinute] = useState(0)
  const [cronWeekday, setCronWeekday] = useState('1') // 0=Sun..6=Sat
  const cron = useMemo(() => {
    if (cronKind === 'every_n_minutes') return `*/${Math.max(1, Math.floor(cronN))} * * * *`
    if (cronKind === 'hourly') return `${Math.floor(cronMinute)} * * * *`
    if (cronKind === 'daily') return `${Math.floor(cronMinute)} ${Math.floor(cronHour)} * * *`
    if (cronKind === 'weekly') return `${Math.floor(cronMinute)} ${Math.floor(cronHour)} * * ${cronWeekday}`
    return '* * * * *'
  }, [cronKind, cronN, cronHour, cronMinute, cronWeekday])

  // Beautify/Minify
  const [codeKind, setCodeKind] = useState('js')
  const [codeMode, setCodeMode] = useState('beautify')
  const [codeIn, setCodeIn] = useState('')
  const codeOut = useMemo(() => {
    try {
      if (codeMode === 'minify') return simpleMinify(codeKind, codeIn)
      if (codeKind === 'js') return beautifyJs(codeIn, { indent_size: 2 })
      if (codeKind === 'css') return beautifyCss(codeIn, { indent_size: 2 })
      return beautifyHtml(codeIn, { indent_size: 2 })
    } catch {
      return ''
    }
  }, [codeKind, codeMode, codeIn])

  useEffect(() => {
    if (tool !== 'security') {
      if (totpTimerRef.current) clearInterval(totpTimerRef.current)
      totpTimerRef.current = null
      return
    }
    if (totpTimerRef.current) clearInterval(totpTimerRef.current)

    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      if (!secTotpSecret.trim()) {
        setSecTotpCode('')
        setSecTotpLeft(0)
        return
      }
      try {
        const now = Date.now()
        const res = await totp({
          secretBase32: secTotpSecret,
          timeMs: now,
          stepSec: Number(secTotpStep) || 30,
          digits: Number(secTotpDigits) || 6,
          algorithm: secTotpAlg,
        })
        setSecTotpCode(res.code)
        setSecTotpLeft(Math.max(0, Math.ceil((res.nextAt - now) / 1000)))
      } catch {
        setSecTotpCode('')
        setSecTotpLeft(0)
      }
    }

    tick()
    totpTimerRef.current = setInterval(tick, 1000)
    return () => {
      cancelled = true
      if (totpTimerRef.current) clearInterval(totpTimerRef.current)
      totpTimerRef.current = null
    }
  }, [tool, secTotpSecret, secTotpAlg, secTotpDigits, secTotpStep])

  async function runEncrypt() {
    if (!secEncFile) return
    if (!secPass) {
      setErr('Passphrase is required.')
      return
    }
    setErr('')
    setSecBusy(true)
    try {
      const out = await encryptFileToBlob(secEncFile, secPass, {})
      downloadBlob(out, `${secEncFile.name}.octenc`)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setSecBusy(false)
    }
  }

  async function runDecrypt() {
    if (!secDecFile) return
    if (!secPass) {
      setErr('Passphrase is required.')
      return
    }
    setErr('')
    setSecBusy(true)
    try {
      const file = await decryptBlobToFile(secDecFile, secPass)
      downloadBlob(file, file.name)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setSecBusy(false)
    }
  }

  async function runHmac() {
    setErr('')
    try {
      const out = await hmacHex(secHmacAlg, secHmacKey, secHmacMsg)
      setSecHmacOut(out)
    } catch (e) {
      setErr(e?.message || String(e))
      setSecHmacOut('')
    }
  }

  async function runSchemaValidate() {
    setErr('')
    setSchemaOut('')
    try {
      const schema = JSON.parse(schemaIn || 'null')
      const data = JSON.parse(schemaData || 'null')
      const mod = await import('ajv')
      const Ajv = mod.default || mod
      const ajv = new Ajv({ allErrors: true, strict: false })
      const validate = ajv.compile(schema)
      const ok = validate(data)
      if (ok) {
        setSchemaOut('Valid ✅')
      } else {
        const errs = (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message || ''}`).join('\n')
        setSchemaOut(errs || 'Invalid.')
      }
    } catch (e) {
      setErr(e?.message || 'Schema validation failed.')
    }
  }

  async function runJwtBuild() {
    setErr('')
    setJwtOut('')
    try {
      const headerObj = JSON.parse(jwtHeaderIn || '{}')
      const payloadObj = JSON.parse(jwtPayloadIn || '{}')
      const alg = jwtSignAlg
      const nextHeader = { ...headerObj, alg, typ: headerObj?.typ || 'JWT' }
      const head = b64UrlEncodeUtf8(JSON.stringify(nextHeader))
      const body = b64UrlEncodeUtf8(JSON.stringify(payloadObj))
      const signingInput = `${head}.${body}`
      if (alg === 'none') {
        const tok = `${signingInput}.`
        setJwtOut(tok)
        setJwt(tok)
        return
      }
      const secret = String(jwtSecret || '')
      if (!secret) throw new Error('Secret is required for HS algorithms.')
      const hashName = alg === 'HS256' ? 'SHA-256' : alg === 'HS384' ? 'SHA-384' : 'SHA-512'
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: { name: hashName } },
        false,
        ['sign'],
      )
      const sigAb = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
      const sig = b64UrlEncodeBytes(new Uint8Array(sigAb))
      const tok = `${signingInput}.${sig}`
      setJwtOut(tok)
      setJwt(tok)
    } catch (e) {
      setErr(e?.message || 'JWT build failed.')
    }
  }

  async function runHash() {
    setErr('')
    try {
      const out = await hashText(hashAlg, hashIn)
      setHashOut(out)
    } catch (e) {
      setErr(e?.message || String(e))
    }
  }

  async function onHashFile(f) {
    setErr('')
    setHashFileOut('')
    try {
      const out = await hashFile(hashAlg, f)
      setHashFileOut(out)
    } catch (e) {
      setErr(e?.message || String(e))
    }
  }

  async function runChecksum() {
    setErr('')
    setChkBusy(true)
    try {
      let bytes
      if (chkFile) {
        bytes = new Uint8Array(await chkFile.arrayBuffer())
      } else {
        bytes = new TextEncoder().encode(chkText || '')
      }
      const algs = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']
      const out = {}
      for (const a of algs) out[a] = await hashBytes(a, bytes)
      out.CRC32 = toHexN(crc32(bytes))
      out.ADLER32 = toHexN(adler32(bytes))
      setChkOut(out)
    } catch (e) {
      setErr(e?.message || String(e))
      setChkOut({})
    } finally {
      setChkBusy(false)
    }
  }

  function runFormat() {
    setErr('')
    try {
      let data
      if (fmtFrom === 'json') data = JSON.parse(fmtIn || 'null')
      else if (fmtFrom === 'yaml') data = YAML.parse(fmtIn || '')
      else if (fmtFrom === 'csv') data = Papa.parse(fmtIn || '', { header: true, skipEmptyLines: true }).data
      else if (fmtFrom === 'xml') data = xmlToJson(parseXml(fmtIn).documentElement)

      let out = ''
      if (fmtTo === 'json') out = JSON.stringify(data, null, 2)
      else if (fmtTo === 'yaml') out = YAML.stringify(data)
      else if (fmtTo === 'csv') out = Papa.unparse(Array.isArray(data) ? data : [data])
      else if (fmtTo === 'xml') out = jsonToXml(data, (data && data._name) || 'root')

      setFmtOut(out)
    } catch (e) {
      setErr(e?.message || 'Conversion failed.')
      setFmtOut('')
    }
  }

  function runUuid() {
    setUuid(crypto.randomUUID())
  }

  function runPw() {
    const n = Math.max(6, Math.min(128, Math.floor(pwLen)))
    setPw(genPassword(n, pwOpts))
  }

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>Developer Tools</h1>
        <p className="muted">Local-only encoders, decoders, hashers, formatters, and generators.</p>
      </div>

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <ToolTabs tools={TOOLS} activeId={tool} onChange={(id) => { setTool(id); setErr('') }} />
          <FavoriteButton
            entry={{
              key: toolKey('developer', tool),
              label: `Dev: ${TOOLS.find((x) => x.id === tool)?.label || tool}`,
              path: `/developer?tool=${tool}`,
              tool,
            }}
          />
        </div>
        {err ? <div className="error">{err}</div> : null}
      </section>

      {tool === 'base64' ? (
        <section className="panel">
          <h2>Base64 Encoder/Decoder (UTF-8)</h2>
          <div className="row">
            <div className="field" style={{ minWidth: 220 }}>
              <label>Mode</label>
              <select className="select" value={b64Mode} onChange={(e) => setB64Mode(e.target.value)}>
                <option value="encode">Encode</option>
                <option value="decode">Decode</option>
              </select>
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Input</label>
              <textarea className="textarea" value={b64In} onChange={(e) => setB64In(e.target.value)} />
            </div>
            <div className="field">
              <label>Output</label>
              <textarea className="textarea" value={b64Out} readOnly />
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'encode' ? (
        <section className="panel">
          <h2>URL / HTML Encode-Decode</h2>
          <div className="row">
            <div className="field" style={{ minWidth: 220 }}>
              <label>Kind</label>
              <select className="select" value={encKind} onChange={(e) => setEncKind(e.target.value)}>
                <option value="url">URL</option>
                <option value="html">HTML</option>
              </select>
            </div>
            <div className="field" style={{ minWidth: 220 }}>
              <label>Direction</label>
              <select className="select" value={encDir} onChange={(e) => setEncDir(e.target.value)}>
                <option value="encode">Encode</option>
                <option value="decode">Decode</option>
              </select>
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Input</label>
              <textarea className="textarea" value={encIn} onChange={(e) => setEncIn(e.target.value)} />
            </div>
            <div className="field">
              <label>Output</label>
              <textarea className="textarea" value={encOut} readOnly />
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'jwt' ? (
        <section className="panel">
          <h2>JWT Decoder / Encoder (Local)</h2>
          <div className="field">
            <label>Decode JWT</label>
            <textarea className="textarea" value={jwt} onChange={(e) => setJwt(e.target.value)} placeholder="header.payload.signature" />
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Header</label>
              <textarea className="textarea" value={jwtParts ? JSON.stringify(jwtParts.header, null, 2) : ''} readOnly />
            </div>
            <div className="field">
              <label>Payload</label>
              <textarea className="textarea" value={jwtParts ? JSON.stringify(jwtParts.payload, null, 2) : ''} readOnly />
            </div>
          </div>

          <div className="panel" style={{ marginTop: 12, padding: 12 }}>
            <div className="mono muted" style={{ marginBottom: 8 }}>Build JWT</div>
            <div className="row">
              <div className="field" style={{ minWidth: 220 }}>
                <label>Algorithm</label>
                <select className="select" value={jwtSignAlg} onChange={(e) => setJwtSignAlg(e.target.value)}>
                  <option value="none">none</option>
                  <option value="HS256">HS256</option>
                  <option value="HS384">HS384</option>
                  <option value="HS512">HS512</option>
                </select>
              </div>
              {jwtSignAlg !== 'none' ? (
                <div className="field" style={{ flex: 1, minWidth: 240 }}>
                  <label>HMAC Secret</label>
                  <input className="input mono" value={jwtSecret} onChange={(e) => setJwtSecret(e.target.value)} />
                </div>
              ) : null}
              <button className="button" type="button" onClick={runJwtBuild}>
                Build token
              </button>
            </div>
            <div className="two" style={{ marginTop: 10 }}>
              <div className="field">
                <label>Header JSON</label>
                <textarea className="textarea" value={jwtHeaderIn} onChange={(e) => setJwtHeaderIn(e.target.value)} />
              </div>
              <div className="field">
                <label>Payload JSON</label>
                <textarea className="textarea" value={jwtPayloadIn} onChange={(e) => setJwtPayloadIn(e.target.value)} />
              </div>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Generated JWT</label>
              <textarea className="textarea" value={jwtOut} readOnly />
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Decoding does not verify signatures. Token generation supports local `none` and HMAC algorithms.
          </p>
        </section>
      ) : null}

      {tool === 'hash' ? (
        <section className="panel">
          <h2>Hash Generator</h2>
          <div className="row">
            <div className="field" style={{ minWidth: 220 }}>
              <label>Algorithm</label>
              <select className="select" value={hashAlg} onChange={(e) => setHashAlg(e.target.value)}>
                <option value="SHA-1">SHA-1</option>
                <option value="SHA-256">SHA-256</option>
                <option value="SHA-384">SHA-384</option>
                <option value="SHA-512">SHA-512</option>
              </select>
            </div>
            <button className="button" type="button" onClick={runHash}>Hash text</button>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Text</label>
              <textarea className="textarea" value={hashIn} onChange={(e) => setHashIn(e.target.value)} />
            </div>
            <div className="field">
              <label>Digest (hex)</label>
              <textarea className="textarea" value={hashOut} readOnly />
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>File (hashes file bytes)</label>
            <input className="input" type="file" onChange={(e) => (e.target.files?.[0] ? onHashFile(e.target.files[0]) : null)} />
            <textarea className="textarea" value={hashFileOut} readOnly placeholder="File digest appears here" />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Verify against expected digest (optional)</label>
            <input className="input mono" value={hashExpected} onChange={(e) => setHashExpected(e.target.value)} placeholder="paste expected hex hash" />
            {hashFileOut && hashExpected.trim() ? (
              <div className="panel" style={{ padding: 12, marginTop: 10 }}>
                <div className="mono">
                  {hashFileOut.toLowerCase() === hashExpected.trim().toLowerCase() ? 'Match ✅' : 'No match ❌'}
                </div>
              </div>
            ) : null}
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Uses Web Crypto API; some browsers may restrict SHA-1.
          </p>
        </section>
      ) : null}

      {tool === 'checksum' ? (
        <section className="panel">
          <h2>Checksum Suite</h2>
          <p className="muted">
            Computes checksums locally for text or file bytes.
          </p>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Text input (used when no file selected)</label>
              <textarea className="textarea" value={chkText} onChange={(e) => setChkText(e.target.value)} />
            </div>
            <div className="field">
              <label>Or choose file</label>
              <input className="input" type="file" onChange={(e) => setChkFile(e.target.files?.[0] || null)} />
              <div className="muted">{chkFile ? `Selected: ${chkFile.name}` : 'No file selected'}</div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={runChecksum} disabled={chkBusy}>
              {chkBusy ? 'Computing...' : 'Compute checksums'}
            </button>
          </div>
          <div className="panel" style={{ padding: 12, marginTop: 10 }}>
            <div className="table" style={{ minWidth: 0 }}>
              {Object.entries(chkOut).length ? (
                Object.entries(chkOut).map(([k, v]) => (
                  <div key={k} className="table__row" style={{ gridTemplateColumns: '160px 1fr' }}>
                    <div className="mono muted">{k}</div>
                    <div className="mono" style={{ wordBreak: 'break-all' }}>{v}</div>
                  </div>
                ))
              ) : (
                <div className="muted">No checksum output yet.</div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'security' ? (
        <section className="panel">
          <h2>Security (Local Only)</h2>
          <p className="muted">
            Encrypt/decrypt uses AES-256-GCM with PBKDF2-SHA256 (200k iterations by default). No network calls.
          </p>

          <div className="panel" style={{ padding: 14, marginTop: 10 }}>
            <div className="mono muted" style={{ marginBottom: 8 }}>File Encrypt / Decrypt</div>
            <div className="field">
              <label>Passphrase</label>
              <input className="input mono" value={secPass} onChange={(e) => setSecPass(e.target.value)} placeholder="Enter a strong passphrase" />
            </div>
            <div className="two" style={{ marginTop: 10 }}>
              <div className="field">
                <label>Encrypt file</label>
                <input className="input" type="file" disabled={secBusy} onChange={(e) => setSecEncFile(e.target.files?.[0] || null)} />
                <button className="button" type="button" onClick={runEncrypt} disabled={!secEncFile || secBusy}>
                  Encrypt & download (.octenc)
                </button>
              </div>
              <div className="field">
                <label>Decrypt .octenc</label>
                <input className="input" type="file" disabled={secBusy} onChange={(e) => setSecDecFile(e.target.files?.[0] || null)} />
                <button className="button" type="button" onClick={runDecrypt} disabled={!secDecFile || secBusy}>
                  Decrypt & download
                </button>
              </div>
            </div>
          </div>

          <div className="panel" style={{ padding: 14, marginTop: 10 }}>
            <div className="mono muted" style={{ marginBottom: 8 }}>HMAC</div>
            <div className="row">
              <div className="field" style={{ minWidth: 200 }}>
                <label>Algorithm</label>
                <select className="select" value={secHmacAlg} onChange={(e) => setSecHmacAlg(e.target.value)}>
                  <option value="SHA-1">SHA-1</option>
                  <option value="SHA-256">SHA-256</option>
                  <option value="SHA-384">SHA-384</option>
                  <option value="SHA-512">SHA-512</option>
                </select>
              </div>
              <button className="button" type="button" onClick={runHmac}>
                Compute HMAC
              </button>
            </div>
            <div className="two" style={{ marginTop: 10 }}>
              <div className="field">
                <label>Key</label>
                <textarea className="textarea" value={secHmacKey} onChange={(e) => setSecHmacKey(e.target.value)} />
              </div>
              <div className="field">
                <label>Message</label>
                <textarea className="textarea" value={secHmacMsg} onChange={(e) => setSecHmacMsg(e.target.value)} />
              </div>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>HMAC (hex)</label>
              <textarea className="textarea" value={secHmacOut} readOnly />
            </div>
          </div>

          <div className="panel" style={{ padding: 14, marginTop: 10 }}>
            <div className="mono muted" style={{ marginBottom: 8 }}>TOTP (2FA)</div>
            <div className="two">
              <div className="field">
                <label>Base32 secret</label>
                <input className="input mono" value={secTotpSecret} onChange={(e) => setSecTotpSecret(e.target.value)} placeholder="JBSWY3DPEHPK3PXP" />
              </div>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div className="field" style={{ width: 140 }}>
                  <label>Digits</label>
                  <select className="select" value={secTotpDigits} onChange={(e) => setSecTotpDigits(Number(e.target.value))}>
                    <option value={6}>6</option>
                    <option value={8}>8</option>
                  </select>
                </div>
                <div className="field" style={{ width: 140 }}>
                  <label>Step (s)</label>
                  <input className="input mono" type="number" value={secTotpStep} onChange={(e) => setSecTotpStep(Number(e.target.value))} />
                </div>
                <div className="field" style={{ width: 180 }}>
                  <label>HMAC</label>
                  <select className="select" value={secTotpAlg} onChange={(e) => setSecTotpAlg(e.target.value)}>
                    <option value="SHA-1">SHA-1</option>
                    <option value="SHA-256">SHA-256</option>
                    <option value="SHA-512">SHA-512</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="panel" style={{ padding: 14, marginTop: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="mono" style={{ fontSize: 28, letterSpacing: '0.12em' }}>
                  {secTotpCode || '------'}
                </div>
                <div className="mono muted">refresh in {secTotpLeft}s</div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'headers' ? (
        <section className="panel">
          <h2>HTTP Headers (CSP Builder)</h2>
          <p className="muted">Build a Content-Security-Policy value. Adjust sources per your site needs.</p>
          <div className="two">
            <div className="field">
              <label>default-src</label>
              <input className="input mono" value={cspDefault} onChange={(e) => setCspDefault(e.target.value)} />
            </div>
            <div className="field">
              <label>script-src</label>
              <input className="input mono" value={cspScript} onChange={(e) => setCspScript(e.target.value)} />
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>style-src</label>
              <input className="input mono" value={cspStyle} onChange={(e) => setCspStyle(e.target.value)} />
            </div>
            <div className="field">
              <label>img-src</label>
              <input className="input mono" value={cspImg} onChange={(e) => setCspImg(e.target.value)} />
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>connect-src</label>
              <input className="input mono" value={cspConnect} onChange={(e) => setCspConnect(e.target.value)} />
            </div>
            <div className="field">
              <label>frame-ancestors</label>
              <input className="input mono" value={cspFrameAnc} onChange={(e) => setCspFrameAnc(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Header value</label>
            <textarea className="textarea" value={cspValue} readOnly />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="button"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(cspValue)
                } catch {
                  setErr('Clipboard blocked by browser permissions.')
                }
              }}
            >
              Copy value
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={async () => {
                const meta = `<meta http-equiv="Content-Security-Policy" content="${cspValue.replaceAll('"', '&quot;')}" />`
                try {
                  await navigator.clipboard.writeText(meta)
                } catch {
                  setErr('Clipboard blocked by browser permissions.')
                }
              }}
            >
              Copy meta tag
            </button>
          </div>
        </section>
      ) : null}

      {tool === 'env' ? (
        <section className="panel">
          <h2>.env Cleaner</h2>
          <p className="muted">Sort keys, remove duplicates, and normalize quoting. Comments are not preserved in output.</p>
          <div className="two">
            <div className="field">
              <label>Input</label>
              <textarea className="textarea" value={envIn} onChange={(e) => setEnvIn(e.target.value)} placeholder="KEY=value" />
            </div>
            <div className="field">
              <label>Output</label>
              <textarea className="textarea" value={envOut} readOnly />
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="field" style={{ minWidth: 180 }}>
              <label>Dedupe</label>
              <select className="select" value={envStrategy} onChange={(e) => setEnvStrategy(e.target.value)}>
                <option value="last">Keep last</option>
                <option value="first">Keep first</option>
              </select>
            </div>
            <div className="field" style={{ minWidth: 180 }}>
              <label>Quoting</label>
              <select className="select" value={envQuote} onChange={(e) => setEnvQuote(e.target.value)}>
                <option value="auto">Auto</option>
                <option value="always">Always</option>
                <option value="never">Never</option>
              </select>
            </div>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={envSort} onChange={(e) => setEnvSort(e.target.checked)} />
              <span className="muted">Sort keys</span>
            </label>
            <button
              className="button button--ghost"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(envOut)
                } catch {
                  setErr('Clipboard blocked by browser permissions.')
                }
              }}
            >
              Copy output
            </button>
          </div>
          {envDupes.length ? (
            <div className="panel" style={{ padding: 14, marginTop: 10 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Duplicate keys</div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {envDupes.map((k) => (
                  <span key={k} className="kbd">{k}</span>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {tool === 'schema' ? (
        <section className="panel">
          <h2>JSON Schema Validator (Ajv)</h2>
          <div className="row">
            <button className="button" type="button" onClick={runSchemaValidate}>
              Validate
            </button>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Schema (JSON)</label>
              <textarea className="textarea" value={schemaIn} onChange={(e) => setSchemaIn(e.target.value)} />
            </div>
            <div className="field">
              <label>Data (JSON)</label>
              <textarea className="textarea" value={schemaData} onChange={(e) => setSchemaData(e.target.value)} />
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Result</label>
            <textarea className="textarea" value={schemaOut} readOnly placeholder="Validation output appears here" />
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Draft support depends on Ajv configuration; this uses a permissive mode for broad compatibility.
          </p>
        </section>
      ) : null}

      {tool === 'password' ? (
        <section className="panel">
          <h2>Password Generator + Strength</h2>
          <div className="row">
            <div className="field" style={{ width: 160 }}>
              <label>Length</label>
              <input className="input" type="number" value={pwLen} onChange={(e) => setPwLen(e.target.value)} />
            </div>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={pwOpts.lower} onChange={(e) => setPwOpts((s) => ({ ...s, lower: e.target.checked }))} />
              <span className="muted">a-z</span>
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={pwOpts.upper} onChange={(e) => setPwOpts((s) => ({ ...s, upper: e.target.checked }))} />
              <span className="muted">A-Z</span>
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={pwOpts.digits} onChange={(e) => setPwOpts((s) => ({ ...s, digits: e.target.checked }))} />
              <span className="muted">0-9</span>
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={pwOpts.symbols} onChange={(e) => setPwOpts((s) => ({ ...s, symbols: e.target.checked }))} />
              <span className="muted">Symbols</span>
            </label>
            <button className="button" type="button" onClick={runPw}>Generate</button>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Password</label>
              <input className="input mono" value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Strength</div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="mono">{strength.label}</div>
                <div className="mono muted">{strength.entropy} bits</div>
              </div>
              <p className="muted" style={{ marginTop: 10 }}>
                This is a rough entropy estimate, not a guarantee.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'format' ? (
        <section className="panel">
          <h2>JSON / XML / YAML / CSV Formatter & Converter</h2>
          <div className="row">
            <div className="field" style={{ minWidth: 160 }}>
              <label>From</label>
              <select className="select" value={fmtFrom} onChange={(e) => setFmtFrom(e.target.value)}>
                <option value="json">JSON</option>
                <option value="yaml">YAML</option>
                <option value="csv">CSV</option>
                <option value="xml">XML</option>
              </select>
            </div>
            <div className="field" style={{ minWidth: 160 }}>
              <label>To</label>
              <select className="select" value={fmtTo} onChange={(e) => setFmtTo(e.target.value)}>
                <option value="json">JSON</option>
                <option value="yaml">YAML</option>
                <option value="csv">CSV</option>
                <option value="xml">XML</option>
              </select>
            </div>
            <button className="button" type="button" onClick={runFormat}>Convert</button>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Input</label>
              <textarea className="textarea" value={fmtIn} onChange={(e) => setFmtIn(e.target.value)} />
            </div>
            <div className="field">
              <label>Output</label>
              <textarea className="textarea" value={fmtOut} readOnly />
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            XML conversion is intentionally minimal and may not preserve complex structures.
          </p>
        </section>
      ) : null}

      {tool === 'regex' ? (
        <section className="panel">
          <h2>Regex Tester</h2>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Pattern</label>
              <input className="input mono" value={rePat} onChange={(e) => setRePat(e.target.value)} placeholder="\\b\\w+\\b" />
            </div>
            <div className="field" style={{ width: 140 }}>
              <label>Flags</label>
              <input className="input mono" value={reFlags} onChange={(e) => setReFlags(e.target.value)} placeholder="gim" />
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Text</label>
              <textarea className="textarea" value={reText} onChange={(e) => setReText(e.target.value)} />
            </div>
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Matches</div>
              {reMatches === null ? (
                <div className="error">Invalid regex.</div>
              ) : reMatches.length ? (
                <div className="table" style={{ minWidth: 0 }}>
                  {reMatches.slice(0, 200).map((m, i) => (
                    <div className="table__row" key={i} style={{ gridTemplateColumns: '90px 1fr' }}>
                      <div className="mono muted">@{m.index}</div>
                      <div className="mono">{m.match}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted">No matches.</div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'uuid' ? (
        <section className="panel">
          <h2>UUID Generator</h2>
          <div className="row">
            <button className="button" type="button" onClick={runUuid}>Generate UUID</button>
            <input className="input mono" value={uuid} readOnly placeholder="uuid appears here" />
          </div>
        </section>
      ) : null}

      {tool === 'time' ? (
        <section className="panel">
          <h2>Timestamp / Date Converter</h2>
          <div className="two">
            <div className="field">
              <label>Epoch (seconds or milliseconds)</label>
              <input className="input mono" value={epoch} onChange={(e) => setEpoch(e.target.value)} />
              <div className="panel" style={{ padding: 14, marginTop: 10 }}>
                {timeOut ? (
                  <>
                    <div className="mono muted">ISO</div>
                    <div className="mono" style={{ marginBottom: 8 }}>{timeOut.iso}</div>
                    <div className="mono muted">Local</div>
                    <div className="mono">{timeOut.local}</div>
                  </>
                ) : (
                  <div className="muted">Invalid epoch.</div>
                )}
              </div>
            </div>
            <div className="field">
              <label>Date (parseable string)</label>
              <input className="input mono" value={dateIn} onChange={(e) => setDateIn(e.target.value)} />
              <div className="panel" style={{ padding: 14, marginTop: 10 }}>
                {dateToEpoch ? (
                  <>
                    <div className="mono muted">Milliseconds</div>
                    <div className="mono" style={{ marginBottom: 8 }}>{dateToEpoch.ms}</div>
                    <div className="mono muted">Seconds</div>
                    <div className="mono">{dateToEpoch.s}</div>
                  </>
                ) : (
                  <div className="muted">Invalid date.</div>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'cron' ? (
        <section className="panel">
          <h2>Cron Expression Generator (5-field)</h2>
          <div className="row">
            <div className="field" style={{ minWidth: 220 }}>
              <label>Preset</label>
              <select className="select" value={cronKind} onChange={(e) => setCronKind(e.target.value)}>
                <option value="every_n_minutes">Every N minutes</option>
                <option value="hourly">Hourly at minute</option>
                <option value="daily">Daily at time</option>
                <option value="weekly">Weekly at time</option>
              </select>
            </div>
            {cronKind === 'every_n_minutes' ? (
              <div className="field" style={{ width: 160 }}>
                <label>N minutes</label>
                <input className="input" type="number" value={cronN} onChange={(e) => setCronN(e.target.value)} />
              </div>
            ) : null}
            {cronKind !== 'every_n_minutes' ? (
              <>
                <div className="field" style={{ width: 140 }}>
                  <label>Minute</label>
                  <input className="input" type="number" value={cronMinute} onChange={(e) => setCronMinute(e.target.value)} />
                </div>
              </>
            ) : null}
            {cronKind === 'daily' || cronKind === 'weekly' ? (
              <div className="field" style={{ width: 140 }}>
                <label>Hour</label>
                <input className="input" type="number" value={cronHour} onChange={(e) => setCronHour(e.target.value)} />
              </div>
            ) : null}
            {cronKind === 'weekly' ? (
              <div className="field" style={{ minWidth: 200 }}>
                <label>Weekday</label>
                <select className="select" value={cronWeekday} onChange={(e) => setCronWeekday(e.target.value)}>
                  <option value="0">Sunday</option>
                  <option value="1">Monday</option>
                  <option value="2">Tuesday</option>
                  <option value="3">Wednesday</option>
                  <option value="4">Thursday</option>
                  <option value="5">Friday</option>
                  <option value="6">Saturday</option>
                </select>
              </div>
            ) : null}
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Expression</label>
            <input className="input mono" value={cron} readOnly />
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Format: minute hour day-of-month month day-of-week
          </p>
        </section>
      ) : null}

      {tool === 'beautify' ? (
        <section className="panel">
          <h2>Beautify / Minify (Basic)</h2>
          <div className="row">
            <div className="field" style={{ minWidth: 160 }}>
              <label>Type</label>
              <select className="select" value={codeKind} onChange={(e) => setCodeKind(e.target.value)}>
                <option value="js">JS</option>
                <option value="css">CSS</option>
                <option value="html">HTML</option>
              </select>
            </div>
            <div className="field" style={{ minWidth: 180 }}>
              <label>Mode</label>
              <select className="select" value={codeMode} onChange={(e) => setCodeMode(e.target.value)}>
                <option value="beautify">Beautify</option>
                <option value="minify">Minify (simple)</option>
              </select>
            </div>
          </div>
          <div className="two" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Input</label>
              <textarea className="textarea" value={codeIn} onChange={(e) => setCodeIn(e.target.value)} />
            </div>
            <div className="field">
              <label>Output</label>
              <textarea className="textarea" value={codeOut} readOnly />
            </div>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            Minify is whitespace/comment oriented (not a full parser/minifier).
          </p>
        </section>
      ) : null}
    </div>
  )
}
