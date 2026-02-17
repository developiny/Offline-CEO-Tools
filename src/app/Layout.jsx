import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toolRegistry } from './toolRegistry.js'
import { getFavorites } from '../utils/toolPrefs.js'
import { downloadBlob } from '../utils/file.js'

function NavItem({ to, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        'nav__link' + (isActive ? ' nav__link--active' : '')
      }
      end={to === '/'}
    >
      {children}
    </NavLink>
  )
}

function PlatformIcon({ kind }) {
  if (kind === 'windows') {
    return (
      <svg className="dl__icon" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="1" y="1" width="6" height="6" rx="1" />
        <rect x="9" y="1" width="6" height="6" rx="1" />
        <rect x="1" y="9" width="6" height="6" rx="1" />
        <rect x="9" y="9" width="6" height="6" rx="1" />
      </svg>
    )
  }
  if (kind === 'linux') {
    return (
      <svg className="dl__icon" viewBox="0 0 16 16" aria-hidden="true">
        <ellipse cx="8" cy="8.5" rx="4.2" ry="5.4" />
        <circle cx="6.8" cy="7.2" r="0.6" fill="currentColor" />
        <circle cx="9.2" cy="7.2" r="0.6" fill="currentColor" />
      </svg>
    )
  }
  if (kind === 'macos') {
    return (
      <svg className="dl__icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M10.8 2.2c-.5.2-1.2.7-1.5 1.2-.3.4-.6 1.1-.5 1.7.6.1 1.3-.2 1.7-.7.4-.4.7-1 .8-1.7-.1-.2-.3-.5-.5-.5z" />
        <path d="M11.9 8.9c0 2.2 1.6 3 1.6 3-.1.2-.3.6-.7 1-.5.6-1 .9-1.6.9-.6 0-.8-.3-1.5-.3-.7 0-.9.3-1.5.3-.6 0-1.1-.3-1.6-.9-1-.9-1.8-2.6-1.8-4.2 0-2.4 1.6-3.7 3.2-3.7.6 0 1.1.2 1.5.4.4.2.7.3 1.1.3.3 0 .6-.1 1-.3.4-.2.9-.4 1.5-.4.2 0 .9 0 1.6.5-.1.1-1.3.8-1.3 2.4z" />
      </svg>
    )
  }
  if (kind === 'repo') {
    return (
      <svg className="dl__icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6.6" />
        <path d="M5.4 10.4a2 2 0 0 0 1.2.4h2.8a2 2 0 0 0 0-4H8.2a2 2 0 0 1 0-4h1.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg className="dl__icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 5.2 8 2l6 3.2v5.6L8 14l-6-3.2z" />
      <path d="M8 2v12M2 5.2l6 3 6-3" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

export default function Layout() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [downloadLinks, setDownloadLinks] = useState({
    repo: '',
    releases: '',
    macos: '',
    windows: '',
    linux: '',
  })
  const boxRef = useRef(null)
  const inputRef = useRef(null)
  const [prefTick, setPrefTick] = useState(0)
  const [seq, setSeq] = useState('')
  void prefTick
  const isDesktopApp = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    return toolRegistry
      .filter((x) => x.label.toLowerCase().includes(t))
      .slice(0, 10)
  }, [q])

  const favorites = getFavorites().slice(0, 10)

  useEffect(() => {
    const onDown = (e) => {
      if (!boxRef.current) return
      if (!boxRef.current.contains(e.target)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])

  useEffect(() => {
    const onPrefs = () => setPrefTick((x) => x + 1)
    window.addEventListener('oct:prefs', onPrefs)
    window.addEventListener('storage', onPrefs)
    return () => {
      window.removeEventListener('oct:prefs', onPrefs)
      window.removeEventListener('storage', onPrefs)
    }
  }, [])

  useEffect(() => {
    let alive = true
    async function loadDownloadLinks() {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}download_linkf.json`, {
          cache: 'no-store',
        })
        if (!res.ok) return
        const data = await res.json()
        if (!alive || !data || typeof data !== 'object') return
        setDownloadLinks((prev) => ({
          ...prev,
          repo: typeof data.repo === 'string' ? data.repo : prev.repo,
          releases: typeof data.releases === 'string' ? data.releases : prev.releases,
          macos: typeof data.macos === 'string' ? data.macos : prev.macos,
          windows: typeof data.windows === 'string' ? data.windows : prev.windows,
          linux: typeof data.linux === 'string' ? data.linux : prev.linux,
        }))
      } catch {
        // ignore
      }
    }
    loadDownloadLinks()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let timer = 0
    const routes = {
      h: '/',
      i: '/image',
      p: '/pdf',
      t: '/text',
      c: '/css',
      l: '/color',
      d: '/developer',
      o: '/coding',
      w: '/wasm',
      r: '/productivity',
      s: '/social',
      m: '/misc',
    }
    const onKey = (e) => {
      if (e.defaultPrevented) return
      const target = e.target
      const inField =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (e.key === '/' && !inField) {
        e.preventDefault()
        inputRef.current?.focus?.()
        setOpen(true)
        return
      }

      if (inField) return
      if (e.key.toLowerCase() === 'g') {
        setSeq('g')
        window.clearTimeout(timer)
        timer = window.setTimeout(() => setSeq(''), 800)
        return
      }
      if (seq === 'g') {
        const k = e.key.toLowerCase()
        const to = routes[k]
        if (to) {
          e.preventDefault()
          setSeq('')
          navigate(to)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
    }
  }, [navigate, seq])

  function exportSettings() {
    try {
      const data = {}
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k) continue
        if (!k.startsWith('oct:')) continue
        data[k] = localStorage.getItem(k)
      }
      const blob = new Blob([JSON.stringify({ version: 1, ts: Date.now(), data }, null, 2)], { type: 'application/json' })
      void downloadBlob(blob, `oct-settings-${Date.now()}.json`)
    } catch {
      // ignore
    }
  }

  async function importSettings(file) {
    if (!file) return
    try {
      const raw = await file.text()
      const parsed = JSON.parse(raw)
      const data = parsed?.data
      if (!data || typeof data !== 'object') return
      for (const [k, v] of Object.entries(data)) {
        if (!String(k).startsWith('oct:')) continue
        localStorage.setItem(k, String(v))
      }
      window.dispatchEvent(new Event('oct:prefs'))
      setPrefTick((x) => x + 1)
    } catch {
      // ignore
    }
  }

  function openExternal(url) {
    const href = String(url || '').trim()
    if (!href) return
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="container">
          <div className="header__top">
            <div className="brand">
              <div className="brand__title">Offline CEO Tools</div>
              <div className="brand__tag">Frontend-only utilities. Privacy-first.</div>
            </div>
            <div className="search" ref={boxRef}>
              <input
                ref={inputRef}
                className="input search__input"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                placeholder="Search tools..."
              />
              {open && results.length ? (
                <div className="search__results">
                  {results.map((r) => (
                    <button
                      key={r.path}
                      type="button"
                      className="search__item"
                      onClick={() => {
                        setOpen(false)
                        setQ('')
                        navigate(r.path)
                      }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <nav className="nav nav--header">
            <NavItem to="/">Home</NavItem>
            <NavItem to="/image">Image</NavItem>
            <NavItem to="/pdf">PDF</NavItem>
            <NavItem to="/text">Text</NavItem>
            <NavItem to="/css">CSS</NavItem>
            <NavItem to="/color">Color</NavItem>
            <NavItem to="/developer">Developer</NavItem>
            <NavItem to="/coding">Coding</NavItem>
            <NavItem to="/wasm">WASM</NavItem>
            <NavItem to="/productivity">Productivity</NavItem>
            <NavItem to="/social">Social</NavItem>
            <NavItem to="/misc">Misc</NavItem>
          </nav>
          <div className="notice">
            <strong>Privacy notice:</strong> All processing happens locally in your
            browser. Files never leave your device. No uploads, no backend, no
            external APIs.
          </div>
          {!isDesktopApp ? (
            <div className="row" style={{ flexWrap: 'wrap', margin: '0 0 10px', gap: 8 }}>
              <span className="muted mono">Download app:</span>
              <button
                className="button button--ghost dl__btn"
                type="button"
                onClick={() => openExternal(downloadLinks.releases)}
                disabled={!downloadLinks.releases}
              >
                <PlatformIcon kind="release" />
                <span>Releases</span>
              </button>
              <button
                className="button button--ghost dl__btn"
                type="button"
                onClick={() => openExternal(downloadLinks.repo)}
                disabled={!downloadLinks.repo}
              >
                <PlatformIcon kind="repo" />
                <span>Source Repo</span>
              </button>
              <button
                className="button button--ghost dl__btn"
                type="button"
                onClick={() => openExternal(downloadLinks.macos)}
                disabled={!downloadLinks.macos}
              >
                <PlatformIcon kind="macos" />
                <span>macOS</span>
              </button>
              <button
                className="button button--ghost dl__btn"
                type="button"
                onClick={() => openExternal(downloadLinks.windows)}
                disabled={!downloadLinks.windows}
              >
                <PlatformIcon kind="windows" />
                <span>Windows</span>
              </button>
              <button
                className="button button--ghost dl__btn"
                type="button"
                onClick={() => openExternal(downloadLinks.linux)}
                disabled={!downloadLinks.linux}
              >
                <PlatformIcon kind="linux" />
                <span>Linux</span>
              </button>
            </div>
          ) : null}
          <div className="row" style={{ justifyContent: 'space-between', margin: '0 0 12px' }}>
            <div className="row">
              <span className="muted mono">Shortcuts:</span>
              <span className="kbd">/</span>
              <span className="muted">Search</span>
              <span className="kbd">g</span>
              <span className="kbd">i</span>
              <span className="muted">Image</span>
              <span className="kbd">g</span>
              <span className="kbd">w</span>
              <span className="muted">WASM</span>
            </div>
            <div className="row">
              <button className="button button--ghost" type="button" onClick={exportSettings}>
                Export settings
              </button>
              <label className="button button--ghost" style={{ display: 'inline-flex', alignItems: 'center' }}>
                Import settings
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  onChange={(e) => importSettings(e.target.files?.[0] || null)}
                />
              </label>
            </div>
          </div>
          {favorites.length ? (
            <div className="panel" style={{ padding: 10, margin: '0 0 14px' }}>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <span className="mono muted" style={{ marginRight: 6 }}>Favorites:</span>
                {favorites.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className="button button--ghost"
                    style={{ padding: '6px 10px' }}
                    onClick={() => navigate(f.path)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <main className="app__main">
        <div className="container">
          <Outlet />
        </div>
      </main>

      <footer className="app__footer">
        <div className="container footer__row">
          <div className="muted">
            Built with React + Vite. Works offline once loaded.
          </div>
          <div className="muted">© {new Date().getFullYear()}</div>
        </div>
      </footer>
    </div>
  )
}
