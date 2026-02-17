const te = new TextEncoder()
const td = new TextDecoder()

function u8(buf) {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf)
}

function concatU8(parts) {
  let len = 0
  for (const p of parts) len += p.length
  const out = new Uint8Array(len)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

function writeU32LE(n) {
  const b = new Uint8Array(4)
  const v = n >>> 0
  b[0] = v & 255
  b[1] = (v >>> 8) & 255
  b[2] = (v >>> 16) & 255
  b[3] = (v >>> 24) & 255
  return b
}

function readU32LE(bytes, off) {
  return (
    (bytes[off] |
      (bytes[off + 1] << 8) |
      (bytes[off + 2] << 16) |
      (bytes[off + 3] << 24)) >>> 0
  )
}

async function deriveAesKeyFromPassphrase(passphrase, salt, iterations = 200_000) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    te.encode(String(passphrase || '')),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: u8(salt), iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// Binary format (little endian):
// magic "OCTE" (4)
// version (1) = 1
// saltLen (1)
// ivLen (1)
// iterU32 (4)
// nameLenU32 (4)
// salt (saltLen)
// iv (ivLen)
// nameUtf8 (nameLen)
// ciphertext (rest)
const MAGIC = new Uint8Array([0x4f, 0x43, 0x54, 0x45]) // OCTE
const VERSION = 1

export async function encryptFileToBlob(file, passphrase, opts) {
  const saltLen = 16
  const ivLen = 12
  const iterations = Math.max(50_000, Math.floor(Number(opts?.iterations || 200_000)))

  const salt = crypto.getRandomValues(new Uint8Array(saltLen))
  const iv = crypto.getRandomValues(new Uint8Array(ivLen))
  const key = await deriveAesKeyFromPassphrase(passphrase, salt, iterations)

  const nameBytes = te.encode(String(file?.name || 'file'))
  const plain = new Uint8Array(await file.arrayBuffer())
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))

  const header = concatU8([
    MAGIC,
    new Uint8Array([VERSION, saltLen, ivLen]),
    writeU32LE(iterations),
    writeU32LE(nameBytes.length),
    salt,
    iv,
    nameBytes,
  ])
  return new Blob([header, cipher], { type: 'application/octet-stream' })
}

export async function decryptBlobToFile(encBlob, passphrase) {
  const bytes = new Uint8Array(await encBlob.arrayBuffer())
  if (bytes.length < 4 + 1 + 1 + 1 + 4 + 4) throw new Error('Invalid encrypted file.')
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) throw new Error('Invalid encrypted file (magic).')

  const version = bytes[4]
  if (version !== VERSION) throw new Error('Unsupported version.')
  const saltLen = bytes[5]
  const ivLen = bytes[6]
  const iterations = readU32LE(bytes, 7)
  const nameLen = readU32LE(bytes, 11)

  const headerLen = 4 + 1 + 1 + 1 + 4 + 4 + saltLen + ivLen + nameLen
  if (bytes.length < headerLen + 1) throw new Error('Invalid encrypted file (truncated).')

  const saltOff = 15
  const salt = bytes.slice(saltOff, saltOff + saltLen)
  const ivOff = saltOff + saltLen
  const iv = bytes.slice(ivOff, ivOff + ivLen)
  const nameOff = ivOff + ivLen
  const nameBytes = bytes.slice(nameOff, nameOff + nameLen)
  const ciphertext = bytes.slice(headerLen)

  const key = await deriveAesKeyFromPassphrase(passphrase, salt, iterations)
  let plain
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext))
  } catch {
    throw new Error('Decryption failed. Wrong passphrase or corrupted file.')
  }

  const name = td.decode(nameBytes) || 'decrypted'
  return new File([plain], name, { type: 'application/octet-stream' })
}

export async function hmacHex(algorithm, keyText, messageText) {
  const algo = String(algorithm || 'SHA-256')
  const key = await crypto.subtle.importKey(
    'raw',
    te.encode(String(keyText || '')),
    { name: 'HMAC', hash: { name: algo } },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(String(messageText || '')))
  const arr = new Uint8Array(sig)
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

