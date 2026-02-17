import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ToolTabs from '../../components/ToolTabs.jsx'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import FileDrop from '../../components/FileDrop.jsx'
import { addRecent, toolKey } from '../../utils/toolPrefs.js'
import { downloadBlob } from '../../utils/file.js'

const TOOLS = [
  { id: 'tweet', label: 'Tweet' },
  { id: 'igpost', label: 'IG Post' },
  { id: 'igstory', label: 'IG Story' },
  { id: 'revenue', label: 'Ad Revenue' },
  { id: 'igfilters', label: 'IG Filters' },
  { id: 'ytthumb', label: 'YouTube Thumbs' },
  { id: 'directdl', label: 'Direct URL DL' },
]

const CARD_TOOLS = new Set(['tweet', 'igpost', 'igstory', 'revenue'])

function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w
    if (ctx.measureText(next).width <= maxWidth) cur = next
    else {
      if (cur) lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

async function fileToBitmap(file) {
  const ab = await file.arrayBuffer()
  const blob = new Blob([ab], { type: file.type || 'application/octet-stream' })
  return await createImageBitmap(blob)
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function safeName(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|]+/g, '_')
}

function parseFilenameFromContentDisposition(cd) {
  const s = String(cd || '')
  const m1 = s.match(/filename\*\s*=\s*([^;]+)/i)
  if (m1) {
    const raw = m1[1].trim().replace(/^UTF-8''/i, '').replace(/^"(.*)"$/, '$1')
    try {
      return safeName(decodeURIComponent(raw))
    } catch {
      return safeName(raw)
    }
  }
  const m2 = s.match(/filename\s*=\s*([^;]+)/i)
  if (m2) return safeName(m2[1].trim().replace(/^"(.*)"$/, '$1'))
  return ''
}

function parseFilenameFromUrl(inputUrl) {
  try {
    const u = new URL(inputUrl)
    const name = u.pathname.split('/').filter(Boolean).pop() || ''
    return safeName(decodeURIComponent(name))
  } catch {
    return ''
  }
}

function guessExtFromType(type) {
  const t = String(type || '').toLowerCase()
  if (t.includes('png')) return 'png'
  if (t.includes('jpeg')) return 'jpg'
  if (t.includes('webp')) return 'webp'
  if (t.includes('gif')) return 'gif'
  if (t.includes('svg')) return 'svg'
  if (t.includes('mp4')) return 'mp4'
  if (t.includes('webm')) return 'webm'
  if (t.includes('mpeg')) return 'mp3'
  if (t.includes('wav')) return 'wav'
  return ''
}

function replaceExt(filename, ext) {
  const base = safeName(filename).replace(/\.[^.]+$/, '')
  return ext ? `${base}.${ext}` : base
}

function parseYouTubeVideoId(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw
  try {
    const u = new URL(raw)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0] || ''
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : ''
    }
    if (host.endsWith('youtube.com')) {
      const v = u.searchParams.get('v')
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v
      const parts = u.pathname.split('/').filter(Boolean)
      const idx = parts.findIndex((p) => p === 'shorts' || p === 'embed' || p === 'live')
      if (idx >= 0 && parts[idx + 1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[idx + 1])) return parts[idx + 1]
    }
  } catch {
    return ''
  }
  return ''
}

function buildYouTubeThumbs(id) {
  if (!id) return []
  return [
    { label: 'Max Res', url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` },
    { label: 'Standard', url: `https://i.ytimg.com/vi/${id}/sddefault.jpg` },
    { label: 'High', url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` },
    { label: 'Medium', url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` },
    { label: 'Default', url: `https://i.ytimg.com/vi/${id}/default.jpg` },
    { label: 'WebP Max', url: `https://i.ytimg.com/vi_webp/${id}/maxresdefault.webp` },
    { label: 'WebP High', url: `https://i.ytimg.com/vi_webp/${id}/hqdefault.webp` },
  ]
}

export default function SocialTools() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tool, setTool] = useState('tweet')

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
        key: toolKey('social', tool),
        label: `Social: ${t.label}`,
        path: `/social?tool=${tool}`,
        tool,
      })
      window.dispatchEvent(new Event('oct:prefs'))
    }
  }, [tool, setSearchParams])

  const canvasRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [avatarFile, setAvatarFile] = useState(null)
  const [bgFile, setBgFile] = useState(null)
  const [avatarBmp, setAvatarBmp] = useState(null)
  const [bgBmp, setBgBmp] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!avatarFile) return setAvatarBmp(null)
        const bmp = await fileToBitmap(avatarFile)
        if (!cancelled) setAvatarBmp(bmp)
      } catch {
        if (!cancelled) setAvatarBmp(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [avatarFile])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!bgFile) return setBgBmp(null)
        const bmp = await fileToBitmap(bgFile)
        if (!cancelled) setBgBmp(bmp)
      } catch {
        if (!cancelled) setBgBmp(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bgFile])

  const [common, setCommon] = useState({
    name: 'Alice CEO',
    handle: '@alice',
    text: 'This is an offline social image generator. Your files never leave your device.',
    date: new Date().toLocaleString(),
    theme: 'dark', // dark|light
  })

  const [tweet, setTweet] = useState({
    likes: 128,
    reposts: 32,
    replies: 18,
  })

  const [ig, setIg] = useState({
    headline: 'New post',
    sub: 'Made locally in the browser',
  })

  const [rev, setRev] = useState({
    period: 'Last 28 days',
    impressions: '1.2M',
    earnings: '$4,320.18',
    rpm: '$3.60',
  })

  // Instagram-like local filters
  const [igFilterFile, setIgFilterFile] = useState(null)
  const [igFilterPreset, setIgFilterPreset] = useState('clarendon')
  const [igFilterBusy, setIgFilterBusy] = useState(false)
  const [igFilterBeforeUrl, setIgFilterBeforeUrl] = useState('')
  const [igFilterAfterUrl, setIgFilterAfterUrl] = useState('')
  const [igFilterOutBlob, setIgFilterOutBlob] = useState(null)
  const IG_FILTERS = useMemo(
    () => [
      { id: 'clarendon', label: 'Clarendon (approx)', css: 'contrast(1.2) saturate(1.25) brightness(1.05)' },
      { id: 'gingham', label: 'Gingham (approx)', css: 'contrast(0.92) saturate(0.9) brightness(1.08)' },
      { id: 'moon', label: 'Moon (approx)', css: 'grayscale(1) contrast(1.15) brightness(1.08)' },
      { id: 'lofi', label: 'Lo-Fi (approx)', css: 'contrast(1.35) saturate(1.4) brightness(1.05)' },
      { id: 'earlybird', label: 'Earlybird (approx)', css: 'contrast(1.1) saturate(0.9) brightness(1.1)' },
      { id: 'inkwell', label: 'Inkwell (approx)', css: 'grayscale(1) contrast(1.2) brightness(1.02)' },
    ],
    [],
  )

  useEffect(() => {
    return () => {
      if (igFilterBeforeUrl) URL.revokeObjectURL(igFilterBeforeUrl)
      if (igFilterAfterUrl) URL.revokeObjectURL(igFilterAfterUrl)
    }
  }, [igFilterBeforeUrl, igFilterAfterUrl])

  async function runIgFilter() {
    if (!igFilterFile) return
    setErr('')
    setIgFilterBusy(true)
    try {
      if (igFilterBeforeUrl) URL.revokeObjectURL(igFilterBeforeUrl)
      setIgFilterBeforeUrl(URL.createObjectURL(igFilterFile))

      const bmp = await fileToBitmap(igFilterFile)
      const canvas = document.createElement('canvas')
      canvas.width = bmp.width
      canvas.height = bmp.height
      const ctx = canvas.getContext('2d', { alpha: true })
      const preset = IG_FILTERS.find((x) => x.id === igFilterPreset) || IG_FILTERS[0]
      ctx.filter = preset.css
      ctx.drawImage(bmp, 0, 0)
      ctx.filter = 'none'
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Could not render output image.')
      if (igFilterAfterUrl) URL.revokeObjectURL(igFilterAfterUrl)
      setIgFilterAfterUrl(URL.createObjectURL(blob))
      setIgFilterOutBlob(blob)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setIgFilterBusy(false)
    }
  }

  // YouTube thumbnail grabber
  const [ytInput, setYtInput] = useState('')
  const ytVideoId = useMemo(() => parseYouTubeVideoId(ytInput), [ytInput])
  const ytThumbs = useMemo(() => buildYouTubeThumbs(ytVideoId), [ytVideoId])

  // Direct media URL downloader (CORS required)
  const [dlUrl, setDlUrl] = useState('')
  const [dlName, setDlName] = useState('')
  const [dlBusy, setDlBusy] = useState(false)
  const [dlLog, setDlLog] = useState('')

  async function runDirectDownload() {
    const input = String(dlUrl || '').trim()
    if (!input) return
    setErr('')
    setDlLog('')
    setDlBusy(true)
    try {
      const res = await fetch(input, { method: 'GET', mode: 'cors' })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const blob = await res.blob()
      const cd = res.headers.get('content-disposition') || ''
      const fromCd = parseFilenameFromContentDisposition(cd)
      const fromUrl = parseFilenameFromUrl(input)
      const ext = guessExtFromType(blob.type)
      const raw = String(dlName || fromCd || fromUrl || 'download').trim()
      const finalName = ext && !/\.[a-zA-Z0-9]+$/.test(raw) ? replaceExt(raw, ext) : safeName(raw)
      downloadBlob(blob, finalName)
      setDlLog(`Downloaded ${finalName} (${blob.type || 'unknown type'})`)
    } catch (e) {
      const msg = e?.message || String(e)
      setErr(msg)
      setDlLog(
        'Blocked by CORS or invalid direct file URL. Use a direct media file URL that allows cross-origin browser fetch.',
      )
    } finally {
      setDlBusy(false)
    }
  }

  const size = useMemo(() => {
    if (tool === 'igstory') return { w: 1080, h: 1920 }
    if (tool === 'igpost') return { w: 1080, h: 1080 }
    if (tool === 'revenue') return { w: 1200, h: 675 }
    return { w: 1200, h: 675 }
  }, [tool])

  async function render() {
    const canvas = canvasRef.current
    if (!canvas) return
    setBusy(true)
    setErr('')
    try {
      canvas.width = size.w
      canvas.height = size.h
      const ctx = canvas.getContext('2d')

      // Background
      const isDark = common.theme === 'dark'
      ctx.fillStyle = isDark ? '#0B0E14' : '#F7F1E3'
      ctx.fillRect(0, 0, size.w, size.h)

      // subtle blobs
      ctx.globalAlpha = 1
      const g1 = ctx.createRadialGradient(size.w * 0.25, size.h * 0.1, 10, size.w * 0.25, size.h * 0.1, size.w * 0.7)
      g1.addColorStop(0, isDark ? 'rgba(126,228,255,0.18)' : 'rgba(35,88,196,0.12)')
      g1.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g1
      ctx.fillRect(0, 0, size.w, size.h)

      const g2 = ctx.createRadialGradient(size.w * 0.85, size.h * 0.2, 10, size.w * 0.85, size.h * 0.2, size.w * 0.6)
      g2.addColorStop(0, isDark ? 'rgba(248,212,107,0.14)' : 'rgba(248,212,107,0.20)')
      g2.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g2
      ctx.fillRect(0, 0, size.w, size.h)

      if (bgBmp) {
        // cover background with user image (local file)
        const r = bgBmp.width / bgBmp.height
        const tr = size.w / size.h
        let sw = bgBmp.width
        let sh = bgBmp.height
        let sx = 0
        let sy = 0
        if (r > tr) {
          sw = Math.round(bgBmp.height * tr)
          sx = Math.round((bgBmp.width - sw) / 2)
        } else {
          sh = Math.round(bgBmp.width / tr)
          sy = Math.round((bgBmp.height - sh) / 2)
        }
        ctx.globalAlpha = 0.88
        ctx.drawImage(bgBmp, sx, sy, sw, sh, 0, 0, size.w, size.h)
        ctx.globalAlpha = 1
      }

      // Card area
      const pad = tool === 'igstory' ? 80 : 70
      const cardW = size.w - pad * 2
      const cardH = tool === 'igpost' ? size.h - pad * 2 : Math.min(size.h - pad * 2, 520)
      const cardX = pad
      const cardY = tool === 'igstory' ? 180 : Math.round((size.h - cardH) / 2)

      ctx.save()
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 34)
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
      ctx.shadowBlur = 40
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(20,24,36,0.06)'
      ctx.fill()
      ctx.restore()

      // border
      ctx.save()
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 34)
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(20,24,36,0.14)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()

      const fg = isDark ? 'rgba(255,255,255,0.92)' : '#141824'
      const muted = isDark ? 'rgba(255,255,255,0.70)' : 'rgba(20,24,36,0.70)'
      const faint = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(20,24,36,0.45)'
      const accent = isDark ? '#7EE4FF' : '#2358C4'

      // Header: avatar + name
      const av = 74
      const hx = cardX + 40
      const hy = cardY + 34
      ctx.save()
      ctx.beginPath()
      ctx.arc(hx + av / 2, hy + av / 2, av / 2, 0, Math.PI * 2)
      ctx.closePath()
      ctx.clip()
      if (avatarBmp) {
        // cover in circle
        const r = avatarBmp.width / avatarBmp.height
        let sw = avatarBmp.width
        let sh = avatarBmp.height
        let sx = 0
        let sy = 0
        if (r > 1) {
          sw = Math.round(avatarBmp.height)
          sx = Math.round((avatarBmp.width - sw) / 2)
        } else {
          sh = Math.round(avatarBmp.width)
          sy = Math.round((avatarBmp.height - sh) / 2)
        }
        ctx.drawImage(avatarBmp, sx, sy, sw, sh, hx, hy, av, av)
      } else {
        ctx.fillStyle = isDark ? 'rgba(126,228,255,0.20)' : 'rgba(35,88,196,0.16)'
        ctx.fillRect(hx, hy, av, av)
        ctx.fillStyle = accent
        ctx.font = '700 34px ui-monospace, monospace'
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'center'
        ctx.fillText(String(common.name || 'A').trim().slice(0, 1).toUpperCase(), hx + av / 2, hy + av / 2 + 1)
      }
      ctx.restore()

      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillStyle = fg
      ctx.font = '700 26px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
      ctx.fillText(common.name || '', hx + av + 18, hy + 8)
      ctx.fillStyle = muted
      ctx.font = '500 22px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
      ctx.fillText(common.handle || '', hx + av + 18, hy + 44)

      // Body
      const bodyX = cardX + 40
      const bodyY = hy + av + 26
      const bodyW = cardW - 80
      ctx.fillStyle = fg
      ctx.font = tool === 'igstory' ? '600 44px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' : '500 30px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
      const lines = wrapText(ctx, common.text, bodyW)
      const lineH = tool === 'igstory' ? 56 : 40
      const maxLines = tool === 'igpost' ? 16 : tool === 'igstory' ? 16 : 9
      for (let i = 0; i < Math.min(maxLines, lines.length); i++) {
        ctx.fillText(lines[i], bodyX, bodyY + i * lineH)
      }
      if (lines.length > maxLines) {
        ctx.fillStyle = faint
        ctx.font = '600 28px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
        ctx.fillText('…', bodyX, bodyY + maxLines * lineH - 10)
      }

      // Footer by tool
      if (tool === 'tweet') {
        const fy = cardY + cardH - 92
        ctx.fillStyle = faint
        ctx.font = '500 20px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
        ctx.fillText(common.date || '', bodyX, fy)
        ctx.fillStyle = muted
        ctx.font = '600 20px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
        ctx.fillText(`💬 ${tweet.replies}   🔁 ${tweet.reposts}   ❤ ${tweet.likes}`, bodyX, fy + 34)
      }

      if (tool === 'igpost' || tool === 'igstory') {
        const fy = cardY + cardH - (tool === 'igstory' ? 220 : 140)
        ctx.fillStyle = accent
        ctx.font = tool === 'igstory' ? '800 48px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' : '800 36px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
        ctx.fillText(ig.headline || '', bodyX, fy)
        ctx.fillStyle = muted
        ctx.font = tool === 'igstory' ? '600 30px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' : '600 24px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
        ctx.fillText(ig.sub || '', bodyX, fy + (tool === 'igstory' ? 70 : 52))
      }

      if (tool === 'revenue') {
        const fx = cardX + 44
        const fy = cardY + cardH - 170
        ctx.fillStyle = muted
        ctx.font = '600 22px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
        ctx.fillText(rev.period || '', fx, fy)
        ctx.fillStyle = fg
        ctx.font = '800 56px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
        ctx.fillText(rev.earnings || '', fx, fy + 34)
        ctx.fillStyle = muted
        ctx.font = '600 22px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
        ctx.fillText(`Impressions: ${rev.impressions}   RPM: ${rev.rpm}`, fx, fy + 102)
        ctx.fillStyle = faint
        ctx.font = '600 16px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
        ctx.fillText('Generated locally (not real data).', fx, fy + 132)
      }

      // watermark note
      ctx.fillStyle = faint
      ctx.font = '600 16px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.fillText('offline generator', size.w - 18, size.h - 14)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!CARD_TOOLS.has(tool)) return undefined
    // auto-render on changes; throttled enough for typical inputs
    const t = setTimeout(() => render().catch(() => {}), 50)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, common, tweet, ig, rev, avatarBmp, bgBmp, size.w, size.h])

  const acceptImages = useMemo(() => ['image/*', '.png', '.jpg', '.jpeg', '.webp'], [])

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>Social Tools</h1>
        <p className="muted">
          Browser-only generators and URL helpers. No backend and no file uploads.
        </p>
      </div>

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <ToolTabs tools={TOOLS} activeId={tool} onChange={setTool} />
          <FavoriteButton
            entry={{
              key: toolKey('social', tool),
              label: `Social: ${TOOLS.find((x) => x.id === tool)?.label || tool}`,
              path: `/social?tool=${tool}`,
              tool,
            }}
          />
        </div>
      </section>

      {CARD_TOOLS.has(tool) ? (
        <section className="panel">
          <div className="two">
            <div className="stack">
              <div className="row">
                <div className="field" style={{ width: 220 }}>
                  <label>Theme</label>
                  <select className="select" value={common.theme} onChange={(e) => setCommon((s) => ({ ...s, theme: e.target.value }))}>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Name</label>
                  <input className="input" value={common.name} onChange={(e) => setCommon((s) => ({ ...s, name: e.target.value }))} />
                </div>
                <div className="field" style={{ width: 220 }}>
                  <label>Handle</label>
                  <input className="input" value={common.handle} onChange={(e) => setCommon((s) => ({ ...s, handle: e.target.value }))} />
                </div>
              </div>

              <div className="field">
                <label>Text</label>
                <textarea className="textarea" value={common.text} onChange={(e) => setCommon((s) => ({ ...s, text: e.target.value }))} />
              </div>

              {tool === 'tweet' ? (
                <div className="row">
                  <div className="field" style={{ width: 220 }}>
                    <label>Date</label>
                    <input className="input" value={common.date} onChange={(e) => setCommon((s) => ({ ...s, date: e.target.value }))} />
                  </div>
                  <div className="field" style={{ width: 160 }}>
                    <label>Replies</label>
                    <input className="input" type="number" value={tweet.replies} onChange={(e) => setTweet((s) => ({ ...s, replies: Number(e.target.value) }))} />
                  </div>
                  <div className="field" style={{ width: 160 }}>
                    <label>Reposts</label>
                    <input className="input" type="number" value={tweet.reposts} onChange={(e) => setTweet((s) => ({ ...s, reposts: Number(e.target.value) }))} />
                  </div>
                  <div className="field" style={{ width: 160 }}>
                    <label>Likes</label>
                    <input className="input" type="number" value={tweet.likes} onChange={(e) => setTweet((s) => ({ ...s, likes: Number(e.target.value) }))} />
                  </div>
                </div>
              ) : null}

              {tool === 'igpost' || tool === 'igstory' ? (
                <div className="row">
                  <div className="field" style={{ width: 320 }}>
                    <label>Headline</label>
                    <input className="input" value={ig.headline} onChange={(e) => setIg((s) => ({ ...s, headline: e.target.value }))} />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Subtitle</label>
                    <input className="input" value={ig.sub} onChange={(e) => setIg((s) => ({ ...s, sub: e.target.value }))} />
                  </div>
                </div>
              ) : null}

              {tool === 'revenue' ? (
                <div className="row">
                  <div className="field" style={{ width: 220 }}>
                    <label>Period</label>
                    <input className="input" value={rev.period} onChange={(e) => setRev((s) => ({ ...s, period: e.target.value }))} />
                  </div>
                  <div className="field" style={{ width: 200 }}>
                    <label>Earnings</label>
                    <input className="input" value={rev.earnings} onChange={(e) => setRev((s) => ({ ...s, earnings: e.target.value }))} />
                  </div>
                  <div className="field" style={{ width: 180 }}>
                    <label>Impressions</label>
                    <input className="input" value={rev.impressions} onChange={(e) => setRev((s) => ({ ...s, impressions: e.target.value }))} />
                  </div>
                  <div className="field" style={{ width: 160 }}>
                    <label>RPM</label>
                    <input className="input" value={rev.rpm} onChange={(e) => setRev((s) => ({ ...s, rpm: e.target.value }))} />
                  </div>
                </div>
              ) : null}

              <div className="two">
                <div className="panel" style={{ padding: 12 }}>
                  <div className="mono muted" style={{ marginBottom: 8 }}>Avatar (optional)</div>
                  <FileDrop
                    accept={acceptImages}
                    multiple={false}
                    onFiles={(fs) => setAvatarFile(fs[0] || null)}
                    label="Drop an avatar image"
                    hint="Local file only"
                  />
                  {avatarFile ? (
                    <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                      <div className="muted mono" style={{ fontSize: 12 }}>{avatarFile.name}</div>
                      <button className="button button--ghost" type="button" onClick={() => setAvatarFile(null)}>Remove</button>
                    </div>
                  ) : null}
                </div>
                <div className="panel" style={{ padding: 12 }}>
                  <div className="mono muted" style={{ marginBottom: 8 }}>Background image (optional)</div>
                  <FileDrop
                    accept={acceptImages}
                    multiple={false}
                    onFiles={(fs) => setBgFile(fs[0] || null)}
                    label="Drop a background image"
                    hint="Local file only"
                  />
                  {bgFile ? (
                    <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                      <div className="muted mono" style={{ fontSize: 12 }}>{bgFile.name}</div>
                      <button className="button button--ghost" type="button" onClick={() => setBgFile(null)}>Remove</button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="row">
                <button className="button" type="button" onClick={render} disabled={busy}>
                  {busy ? 'Rendering...' : 'Render now'}
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  onClick={async () => {
                    const c = canvasRef.current
                    if (!c) return
                    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
                    if (!blob) return
                    downloadBlob(blob, `${tool}-${Date.now()}.png`)
                  }}
                >
                  Download PNG
                </button>
              </div>

              {err ? <div className="error">{err}</div> : null}
            </div>

            <div className="stack">
              <div className="panel" style={{ padding: 12, overflow: 'auto' }}>
                <canvas ref={canvasRef} style={{ maxWidth: '100%', height: 'auto' }} />
              </div>
              <p className="muted">
                Generated images are for jokes/mockups. Don’t use them to impersonate people or create misleading screenshots.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {tool === 'igfilters' ? (
        <section className="panel">
          <h2>Instagram Filters (Local)</h2>
          <p className="muted" style={{ marginBottom: 10 }}>
            Upload a photo and apply Instagram-style filter presets in your browser.
          </p>
          <div className="row">
            <div className="field" style={{ minWidth: 280 }}>
              <label>Preset</label>
              <select className="select" value={igFilterPreset} onChange={(e) => setIgFilterPreset(e.target.value)}>
                {IG_FILTERS.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>
            <button className="button" type="button" onClick={runIgFilter} disabled={!igFilterFile || igFilterBusy}>
              {igFilterBusy ? 'Applying...' : 'Apply filter'}
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={!igFilterOutBlob}
              onClick={() => {
                if (!igFilterOutBlob) return
                downloadBlob(igFilterOutBlob, `ig-filter-${Date.now()}.png`)
              }}
            >
              Download PNG
            </button>
          </div>
          <div style={{ marginTop: 10 }}>
            <FileDrop
              accept={acceptImages}
              multiple={false}
              onFiles={(fs) => setIgFilterFile(fs[0] || null)}
              label="Drop a photo"
              hint="No uploads"
            />
          </div>
          <div className="two" style={{ marginTop: 12 }}>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>Before</div>
              {igFilterBeforeUrl ? <img src={igFilterBeforeUrl} alt="Before" style={{ width: '100%', borderRadius: 10 }} /> : <div className="muted">No image yet.</div>}
            </div>
            <div className="panel" style={{ padding: 12 }}>
              <div className="mono muted" style={{ marginBottom: 8 }}>After</div>
              {igFilterAfterUrl ? <img src={igFilterAfterUrl} alt="After" style={{ width: '100%', borderRadius: 10 }} /> : <div className="muted">Apply a preset.</div>}
            </div>
          </div>
          {err ? <div className="error">{err}</div> : null}
        </section>
      ) : null}

      {tool === 'ytthumb' ? (
        <section className="panel">
          <h2>YouTube Thumbnail Grabber</h2>
          <p className="muted" style={{ marginBottom: 10 }}>
            Paste a YouTube URL or 11-character video ID to get thumbnail links.
          </p>
          <div className="row">
            <input
              className="input mono"
              style={{ flex: 1, minWidth: 260 }}
              value={ytInput}
              onChange={(e) => setYtInput(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            />
            <button
              className="button button--ghost"
              type="button"
              onClick={async () => {
                try {
                  if (!ytVideoId) return
                  await navigator.clipboard.writeText(ytVideoId)
                } catch {
                  // ignore
                }
              }}
              disabled={!ytVideoId}
            >
              Copy video ID
            </button>
          </div>
          {!ytVideoId ? <div className="muted" style={{ marginTop: 10 }}>Enter a valid YouTube URL or video ID.</div> : null}
          {ytVideoId ? (
            <div className="grid" style={{ marginTop: 12 }}>
              {ytThumbs.map((t) => (
                <div key={t.url} className="panel" style={{ gridColumn: 'span 6', padding: 10 }}>
                  <div className="mono muted" style={{ marginBottom: 6 }}>{t.label}</div>
                  <img src={t.url} alt={`${t.label} thumbnail`} style={{ width: '100%', borderRadius: 8, marginBottom: 8 }} />
                  <div className="row">
                    <a className="button button--ghost" href={t.url} target="_blank" rel="noreferrer">Open</a>
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(t.url)
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      Copy URL
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {tool === 'directdl' ? (
        <section className="panel">
          <h2>Direct Media URL Downloader</h2>
          <p className="muted" style={{ marginBottom: 10 }}>
            Downloads only work when the remote server allows browser CORS.
          </p>
          <div className="field">
            <label>Direct file URL</label>
            <input
              className="input mono"
              value={dlUrl}
              onChange={(e) => setDlUrl(e.target.value)}
              placeholder="https://cdn.example.com/photo.jpg"
            />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>Output filename (optional)</label>
            <input
              className="input mono"
              value={dlName}
              onChange={(e) => setDlName(e.target.value)}
              placeholder="my-file"
            />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="button" type="button" onClick={runDirectDownload} disabled={!dlUrl || dlBusy}>
              {dlBusy ? 'Downloading...' : 'Download'}
            </button>
            <a className="button button--ghost" href={dlUrl || '#'} target="_blank" rel="noreferrer">Open URL</a>
          </div>
          {dlLog ? <div className="panel mono" style={{ marginTop: 10, padding: 10 }}>{dlLog}</div> : null}
          {err ? <div className="error">{err}</div> : null}
        </section>
      ) : null}
    </div>
  )
}
