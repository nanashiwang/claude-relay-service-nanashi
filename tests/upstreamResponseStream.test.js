const { PassThrough } = require('stream')
const zlib = require('zlib')
const {
  appendPreviewBuffer,
  createDecodedUpstreamStream,
  normalizeContentEncoding,
  toHexPreview
} = require('../src/utils/upstreamResponseStream')

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    stream.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    stream.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    stream.on('error', reject)
  })
}

describe('upstreamResponseStream', () => {
  test('normalizeContentEncoding handles empty and comma-separated values', () => {
    expect(normalizeContentEncoding()).toBeNull()
    expect(normalizeContentEncoding('identity')).toBeNull()
    expect(normalizeContentEncoding('gzip, br')).toBe('gzip')
    expect(normalizeContentEncoding(['Br'])).toBe('br')
  })

  test('appendPreviewBuffer respects max length', () => {
    let preview = Buffer.alloc(0)
    preview = appendPreviewBuffer(preview, Buffer.from('abcd'), 6)
    preview = appendPreviewBuffer(preview, Buffer.from('efgh'), 6)

    expect(preview.toString()).toBe('abcdef')
  })

  test('createDecodedUpstreamStream decodes gzip payloads', async () => {
    const source = new PassThrough()
    const result = createDecodedUpstreamStream(source, 'gzip')
    const outputPromise = readAll(result.stream)

    source.end(zlib.gzipSync(Buffer.from('data: {"type":"ping"}\n\n')))

    await expect(outputPromise).resolves.toEqual(Buffer.from('data: {"type":"ping"}\n\n'))
    expect(result.decoded).toBe(true)
    expect(result.contentEncoding).toBe('gzip')
  })

  test('createDecodedUpstreamStream decodes deflate payloads', async () => {
    const source = new PassThrough()
    const result = createDecodedUpstreamStream(source, 'deflate')
    const outputPromise = readAll(result.stream)

    source.end(zlib.deflateSync(Buffer.from('data: {"type":"pong"}\n\n')))

    await expect(outputPromise).resolves.toEqual(Buffer.from('data: {"type":"pong"}\n\n'))
    expect(result.decoded).toBe(true)
    expect(result.contentEncoding).toBe('deflate')
  })

  test('toHexPreview returns spaced hex output', () => {
    expect(toHexPreview(Buffer.from([0x00, 0x0f, 0xff]))).toBe('00 0f ff')
  })
})
