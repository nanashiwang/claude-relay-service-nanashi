const zlib = require('zlib')

function normalizeContentEncoding(contentEncoding) {
  const rawValue = Array.isArray(contentEncoding) ? contentEncoding[0] : contentEncoding
  if (typeof rawValue !== 'string') {
    return null
  }

  const [normalized] = rawValue
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)

  if (!normalized || normalized === 'identity') {
    return null
  }

  return normalized
}

function createDecodedUpstreamStream(sourceStream, contentEncoding) {
  const normalizedEncoding = normalizeContentEncoding(contentEncoding)

  if (!normalizedEncoding) {
    return {
      stream: sourceStream,
      contentEncoding: null,
      decoded: false,
      supported: true
    }
  }

  let decoder = null

  switch (normalizedEncoding) {
    case 'gzip':
      decoder = zlib.createGunzip()
      break
    case 'deflate':
      decoder = zlib.createInflate()
      break
    case 'br':
      if (typeof zlib.createBrotliDecompress === 'function') {
        decoder = zlib.createBrotliDecompress()
      }
      break
    default:
      break
  }

  if (!decoder) {
    return {
      stream: sourceStream,
      contentEncoding: normalizedEncoding,
      decoded: false,
      supported: false
    }
  }

  sourceStream.pipe(decoder)

  return {
    stream: decoder,
    contentEncoding: normalizedEncoding,
    decoded: true,
    supported: true
  }
}

function appendPreviewBuffer(currentPreview, chunk, maxBytes = 1024) {
  const existing = Buffer.isBuffer(currentPreview) ? currentPreview : Buffer.alloc(0)

  if (!chunk || existing.length >= maxBytes) {
    return existing
  }

  const nextChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
  if (!nextChunk.length) {
    return existing
  }

  const remaining = maxBytes - existing.length
  return Buffer.concat([existing, nextChunk.subarray(0, remaining)])
}

function toHexPreview(previewBuffer, maxBytes = 64) {
  const source = Buffer.isBuffer(previewBuffer) ? previewBuffer : Buffer.alloc(0)
  if (!source.length) {
    return ''
  }

  return Array.from(source.subarray(0, maxBytes))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join(' ')
}

module.exports = {
  appendPreviewBuffer,
  createDecodedUpstreamStream,
  normalizeContentEncoding,
  toHexPreview
}
