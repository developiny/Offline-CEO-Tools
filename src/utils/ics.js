function pad2(n) {
  return String(Math.floor(n)).padStart(2, '0')
}

function toIcsUtc(dt) {
  const d = new Date(dt)
  if (isNaN(d.getTime())) throw new Error('Invalid date/time')
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    'Z'
  )
}

function foldLine(s) {
  // RFC 5545 line folding at 75 octets (approx). We'll fold at 70 chars for safety.
  const line = String(s || '')
  const out = []
  let i = 0
  while (i < line.length) {
    const chunk = line.slice(i, i + 70)
    out.push((i === 0 ? '' : ' ') + chunk)
    i += 70
  }
  return out.join('\r\n')
}

function escText(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

export function buildIcsEvent({
  uid,
  start,
  end,
  summary,
  description,
  location,
  url,
}) {
  const now = toIcsUtc(Date.now())
  const dtStart = toIcsUtc(start)
  const dtEnd = toIcsUtc(end)
  const eventUid = uid || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Offline CEO Tools//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escText(eventUid)}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escText(summary || 'Event')}`,
  ]
  if (description) lines.push(`DESCRIPTION:${escText(description)}`)
  if (location) lines.push(`LOCATION:${escText(location)}`)
  if (url) lines.push(`URL:${escText(url)}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')

  return lines.map(foldLine).join('\r\n') + '\r\n'
}
