function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function parseNumber(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function normalizeOutputType(type) {
  const t = String(type || '').toLowerCase()
  if (t === 'image/jpg') return 'image/jpeg'
  if (t === 'image/png') return 'image/png'
  if (t === 'image/jpeg') return 'image/jpeg'
  if (t === 'image/webp') return 'image/webp'
  if (t === 'image/avif') return 'image/avif'
  if (t === 'image/bmp') return 'image/bmp'
  return 'image/png'
}

function getBaseSourceRect(srcW, srcH, crop) {
  if (!crop?.enabled) return { sx: 0, sy: 0, sw: srcW, sh: srcH }
  const x = clamp(parseNumber(crop.x, 0), 0, Math.max(0, srcW - 1))
  const y = clamp(parseNumber(crop.y, 0), 0, Math.max(0, srcH - 1))
  const w = clamp(parseNumber(crop.w, srcW), 1, srcW - x)
  const h = clamp(parseNumber(crop.h, srcH), 1, srcH - y)
  return { sx: Math.floor(x), sy: Math.floor(y), sw: Math.floor(w), sh: Math.floor(h) }
}

function calcTargetSize(srcW, srcH, opts) {
  const mode = opts?.mode || 'contain'
  const w = parseNumber(opts?.width, srcW)
  const h = parseNumber(opts?.height, srcH)

  const targetW = Math.max(1, Math.floor(w))
  const targetH = Math.max(1, Math.floor(h))
  if (mode === 'exact') return { w: targetW, h: targetH, sx: 0, sy: 0, sw: srcW, sh: srcH }

  const srcRatio = srcW / srcH
  const targetRatio = targetW / targetH

  if (mode === 'contain') {
    let outW = targetW
    let outH = Math.round(outW / srcRatio)
    if (outH > targetH) {
      outH = targetH
      outW = Math.round(outH * srcRatio)
    }
    return { w: outW, h: outH, sx: 0, sy: 0, sw: srcW, sh: srcH }
  }

  let sw = srcW
  let sh = srcH
  let sx = 0
  let sy = 0
  if (srcRatio > targetRatio) {
    sw = Math.round(srcH * targetRatio)
    sx = Math.round((srcW - sw) / 2)
  } else {
    sh = Math.round(srcW / targetRatio)
    sy = Math.round((srcH - sh) / 2)
  }
  return { w: targetW, h: targetH, sx, sy, sw, sh }
}

function setFilter(ctx, f) {
  const parts = []
  const grayscale = clamp(parseNumber(f?.grayscale, 0), 0, 1)
  const blur = clamp(parseNumber(f?.blur, 0), 0, 30)
  const brightness = clamp(parseNumber(f?.brightness, 100), 0, 300)
  const contrast = clamp(parseNumber(f?.contrast, 100), 0, 300)
  const saturation = clamp(parseNumber(f?.saturation, 100), 0, 300)

  if (grayscale > 0) parts.push(`grayscale(${Math.round(grayscale * 100)}%)`)
  if (blur > 0) parts.push(`blur(${blur}px)`)
  if (brightness !== 100) parts.push(`brightness(${brightness}%)`)
  if (contrast !== 100) parts.push(`contrast(${contrast}%)`)
  if (saturation !== 100) parts.push(`saturate(${saturation}%)`)

  ctx.filter = parts.length ? parts.join(' ') : 'none'
}

function applySharpen(ctx, strength) {
  const s = clamp(parseNumber(strength, 0), 0, 3)
  if (!s) return
  const width = ctx.canvas.width
  const height = ctx.canvas.height
  const src = ctx.getImageData(0, 0, width, height)
  const dst = ctx.createImageData(width, height)

  const kCenter = 1 + 4 * s
  const kSide = -s

  const data = src.data
  const out = dst.data

  function idx(x, y) {
    return (y * width + x) * 4
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y)
      let r = data[i] * kCenter
      let g = data[i + 1] * kCenter
      let b = data[i + 2] * kCenter
      const a = data[i + 3]

      const xl = x > 0 ? x - 1 : x
      const xr = x < width - 1 ? x + 1 : x
      const yu = y > 0 ? y - 1 : y
      const yd = y < height - 1 ? y + 1 : y

      const il = idx(xl, y)
      const ir = idx(xr, y)
      const iu = idx(x, yu)
      const id = idx(x, yd)

      r += (data[il] + data[ir] + data[iu] + data[id]) * kSide
      g += (data[il + 1] + data[ir + 1] + data[iu + 1] + data[id + 1]) * kSide
      b += (data[il + 2] + data[ir + 2] + data[iu + 2] + data[id + 2]) * kSide

      out[i] = clamp(Math.round(r), 0, 255)
      out[i + 1] = clamp(Math.round(g), 0, 255)
      out[i + 2] = clamp(Math.round(b), 0, 255)
      out[i + 3] = a
    }
  }

  ctx.putImageData(dst, 0, 0)
}

function drawWatermarkText(ctx, wm, w, h) {
  const text = String(wm?.text || '').trim()
  if (!text) return
  const opacity = clamp(parseNumber(wm?.opacity, 0.35), 0, 1)
  const size = clamp(parseNumber(wm?.size, 28), 8, 240)
  const color = String(wm?.color || '#ffffff')
  const pos = wm?.position || 'br'
  const rotate = parseNumber(wm?.rotate, -18)
  const pad = clamp(parseNumber(wm?.padding, 18), 0, 80)

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.fillStyle = color
  ctx.textBaseline = 'alphabetic'
  ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`

  const metrics = ctx.measureText(text)
  const tw = metrics.width
  const th = size

  let x = pad
  let y = pad + th
  if (pos === 'tr') {
    x = w - pad - tw
    y = pad + th
  } else if (pos === 'bl') {
    x = pad
    y = h - pad
  } else if (pos === 'br') {
    x = w - pad - tw
    y = h - pad
  } else if (pos === 'center') {
    x = (w - tw) / 2
    y = (h + th) / 2
  }

  const cx = x + tw / 2
  const cy = y - th / 2
  ctx.translate(cx, cy)
  ctx.rotate((rotate * Math.PI) / 180)
  ctx.translate(-cx, -cy)

  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 8
  ctx.fillText(text, x, y)
  ctx.restore()
}

async function drawWatermarkImage(ctx, wm, w, h) {
  if (!wm?.data) return
  const opacity = clamp(parseNumber(wm?.opacity, 0.35), 0, 1)
  const scale = clamp(parseNumber(wm?.scale, 0.25), 0.05, 1)
  const pos = wm?.position || 'br'
  const pad = clamp(parseNumber(wm?.padding, 18), 0, 80)

  const blob = new Blob([wm.data], { type: wm.type || 'image/png' })
  const bitmap = await createImageBitmap(blob)

  const iw = Math.max(1, Math.floor(bitmap.width * scale))
  const ih = Math.max(1, Math.floor(bitmap.height * scale))

  let x = pad
  let y = pad
  if (pos === 'tr') {
    x = w - pad - iw
    y = pad
  } else if (pos === 'bl') {
    x = pad
    y = h - pad - ih
  } else if (pos === 'br') {
    x = w - pad - iw
    y = h - pad - ih
  } else if (pos === 'center') {
    x = (w - iw) / 2
    y = (h - ih) / 2
  }

  ctx.save()
  ctx.globalAlpha = opacity
  ctx.drawImage(bitmap, x, y, iw, ih)
  ctx.restore()
}

async function processOne(payload) {
  const inputBlob = new Blob([payload.data], { type: payload.type || 'image/*' })
  const bitmap = await createImageBitmap(inputBlob)

  const srcW = bitmap.width || 1
  const srcH = bitmap.height || 1

  const opts = payload.options || {}
  const base = getBaseSourceRect(srcW, srcH, opts?.crop)
  const resize = opts?.resize?.enabled
    ? calcTargetSize(base.sw, base.sh, opts.resize)
    : { w: base.sw, h: base.sh, sx: 0, sy: 0, sw: base.sw, sh: base.sh }

  const rotate = parseNumber(opts?.rotate?.degrees, 0)
  const flipH = !!opts?.flip?.h
  const flipV = !!opts?.flip?.v
  const rightAngle = Math.abs(rotate) % 180 === 90
  const outW = rightAngle ? resize.h : resize.w
  const outH = rightAngle ? resize.w : resize.h

  const canvas = new OffscreenCanvas(outW, outH)
  const ctx = canvas.getContext('2d', { alpha: true })

  const outType = normalizeOutputType(opts?.output?.type || 'image/png')
  if (outType === 'image/jpeg') {
    ctx.fillStyle = opts?.output?.jpegBackground || '#ffffff'
    ctx.fillRect(0, 0, outW, outH)
  }

  ctx.save()
  setFilter(ctx, opts?.filters)

  const rad = (rotate * Math.PI) / 180
  ctx.translate(outW / 2, outH / 2)
  if (rotate) ctx.rotate(rad)
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
  ctx.translate(-resize.w / 2, -resize.h / 2)

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    bitmap,
    base.sx + resize.sx,
    base.sy + resize.sy,
    resize.sw,
    resize.sh,
    0,
    0,
    resize.w,
    resize.h,
  )
  ctx.restore()

  applySharpen(ctx, opts?.sharpen?.strength || 0)
  await drawWatermarkImage(ctx, opts?.watermarkImage, outW, outH)
  drawWatermarkText(ctx, opts?.watermarkText, outW, outH)

  const q = clamp(parseNumber(opts?.output?.quality, 0.85), 0.05, 1)
  let blob
  try {
    blob = await canvas.convertToBlob({ type: outType, quality: q })
  } catch {
    blob = await canvas.convertToBlob({ type: 'image/png', quality: q })
  }
  const ab = await blob.arrayBuffer()
  return { ab, outType: blob.type }
}

self.onmessage = async (e) => {
  const msg = e.data || {}
  try {
    if (msg.type === 'process-one') {
      const res = await processOne(msg.payload)
      self.postMessage({ type: 'result', id: msg.id, ...res }, [res.ab])
      return
    }
    if (msg.type === 'process-bulk') {
      const items = Array.isArray(msg.items) ? msg.items : []
      for (let i = 0; i < items.length; i++) {
        const res = await processOne(items[i])
        self.postMessage(
          { type: 'item', index: i, name: items[i].name, ...res },
          [res.ab],
        )
        self.postMessage({ type: 'progress', value: (i + 1) / Math.max(1, items.length) })
      }
      self.postMessage({ type: 'done' })
      return
    }

    self.postMessage({ type: 'error', message: 'Unknown worker message.' })
  } catch (err) {
    self.postMessage({ type: 'error', message: err?.message || String(err) })
  }
}
