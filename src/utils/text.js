export function wordCount(text = '') {
  const t = String(text).trim()
  if (!t) return 0
  return t.split(/\s+/).length
}

export function charCount(text = '') {
  return String(text).length
}

export function toSlug(text = '') {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

