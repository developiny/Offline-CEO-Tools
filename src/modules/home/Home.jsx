import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getFavorites, getRecent } from '../../utils/toolPrefs.js'
import { toolRegistry } from '../../app/toolRegistry.js'

function Card({ title, description, to }) {
  return (
    <Link to={to} className="card">
      <div className="card__title">{title}</div>
      <div className="card__body">{description}</div>
      <div className="card__cta">Open</div>
    </Link>
  )
}

export default function Home() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const on = () => setTick((x) => x + 1)
    window.addEventListener('oct:prefs', on)
    window.addEventListener('storage', on)
    return () => {
      window.removeEventListener('oct:prefs', on)
      window.removeEventListener('storage', on)
    }
  }, [])

  void tick
  const favorites = getFavorites()
  const recent = getRecent()

  const quickIds = new Set([
    'image:edit',
    'image:colors',
    'pdf:merge',
    'pdf:pages',
    'text:find',
    'developer:hash',
    'css:gradient',
    'color:hex',
    'wasm:ocr',
    'productivity:qr',
    'productivity:utm',
    'social:tweet',
  ])
  const quick = toolRegistry.filter((t) => quickIds.has(`${t.route}:${t.tool}`))

  return (
    <div className="stack">
      <section className="hero">
        <h1 className="hero__title">A suite of offline-capable browser tools</h1>
        <p className="hero__subtitle">
          Convert images, edit PDFs, transform text, run developer utilities, and
          handle productivity tasks without sending files anywhere.
        </p>
      </section>

      {favorites.length ? (
        <section className="panel">
          <h2>Favorites</h2>
          <div className="grid">
            {favorites.slice(0, 8).map((f) => (
              <Link key={f.key} to={f.path} className="card">
                <div className="card__title">{f.label}</div>
                <div className="card__body muted">Pinned tool shortcut</div>
                <div className="card__cta">Open</div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {recent.length ? (
        <section className="panel">
          <h2>Recent</h2>
          <div className="grid">
            {recent.slice(0, 8).map((r) => (
              <Link key={r.key} to={r.path} className="card">
                <div className="card__title">{r.label}</div>
                <div className="card__body muted">Recently used</div>
                <div className="card__cta">Open</div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Quick Tools</h2>
        <div className="grid">
          {quick.map((t) => (
            <Link key={t.path} to={t.path} className="card">
              <div className="card__title">{t.label}</div>
              <div className="card__body muted">Shortcut</div>
              <div className="card__cta">Open</div>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid">
        <Card
          title="Image Tools"
          description="Convert, resize, compress, watermark, bulk-process (worker), and export."
          to="/image"
        />
        <Card
          title="PDF Tools"
          description="Merge, split, reorder, annotate, extract text, preview, and convert."
          to="/pdf"
        />
        <Card
          title="Text Tools"
          description="Case, counts, line ops, diff, slug, lorem, markdown preview."
          to="/text"
        />
        <Card
          title="CSS Tools"
          description="Generate modern CSS snippets with live preview: gradients, shadows, loaders, and more."
          to="/css"
        />
        <Card
          title="Color Tools"
          description="Convert, mix, generate shades, and build palettes locally."
          to="/color"
        />
        <Card
          title="Developer Tools"
          description="Encode/decode, hashes, UUID/JWT, formatters, regex, timestamps, minify/beautify."
          to="/developer"
        />
        <Card
          title="Coding Tools"
          description="Code-to-image, JSON tree viewer, Open Graph meta generator, and more."
          to="/coding"
        />
        <Card
          title="WASM Tools"
          description="Heavy local tools: OCR, ffmpeg conversion, icon/sprite builders, form fill/flatten."
          to="/wasm"
        />
        <Card
          title="Productivity Tools"
          description="QR/barcodes, converters, calculators, local renamer, file hash/type detector."
          to="/productivity"
        />
        <Card
          title="Social Tools"
          description="Generate offline social images (tweet/IG post/story) from your own inputs."
          to="/social"
        />
        <Card
          title="Misc Tools"
          description="Randomizers and generators that work entirely in your browser."
          to="/misc"
        />
      </section>

      <section className="panel">
        <h2>Local-first</h2>
        <p className="muted">
          This app is designed to keep your data on-device. Some tools use Web
          Workers to keep the UI responsive during heavy processing.
        </p>
      </section>
    </div>
  )
}
