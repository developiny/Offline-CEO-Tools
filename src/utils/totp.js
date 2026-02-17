function base32ToBytes(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = String(input || '')
    .toUpperCase()
    .replace(/=+$/g, '')
    .replace(/[^A-Z2-7]/g, '')
  if (!clean) return new Uint8Array()

  let bits = 0
  let value = 0
  const out = []
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

function toUint8BE64(nBig) {
  const out = new Uint8Array(8)
  let x = BigInt(nBig)
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(x & 0xffn)
    x >>= 8n
  }
  return out
}

export async function totp({
  secretBase32,
  timeMs = Date.now(),
  stepSec = 30,
  digits = 6,
  algorithm = 'SHA-1',
}) {
  const keyBytes = base32ToBytes(secretBase32)
  if (!keyBytes.length) throw new Error('Invalid/empty Base32 secret.')

  const counter = BigInt(Math.floor(Number(timeMs) / 1000 / stepSec))
  const msg = toUint8BE64(counter)

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: { name: algorithm } },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))

  const offset = sig[sig.length - 1] & 0x0f
  const bin =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff)

  const mod = 10 ** Math.max(1, Math.min(10, Math.floor(digits)))
  const code = String(bin % mod).padStart(digits, '0')
  const periodMs = stepSec * 1000
  const nextAt = (Math.floor(Number(timeMs) / periodMs) + 1) * periodMs
  return { code, nextAt }
}

