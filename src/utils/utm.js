export function buildUtmUrl(baseUrl, params) {
  const isAbsolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(String(baseUrl || ''))
  const url = isAbsolute ? new URL(String(baseUrl)) : new URL(String(baseUrl), 'https://example.com')

  const p = params || {}
  const set = (k, v) => {
    const t = String(v || '').trim()
    if (t) url.searchParams.set(k, t)
    else url.searchParams.delete(k)
  }
  set('utm_source', p.source)
  set('utm_medium', p.medium)
  set('utm_campaign', p.campaign)
  set('utm_term', p.term)
  set('utm_content', p.content)

  if (!isAbsolute) {
    // Remove dummy origin
    const out = url.pathname + (url.search ? url.search : '') + (url.hash ? url.hash : '')
    return out.startsWith('/') ? out.slice(1) : out
  }
  return url.toString()
}
