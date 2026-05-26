const EventEmitter = require('events')

function makeReq(body = {}) {
  const req = new EventEmitter()
  req.body = body
  req.headers = {}
  return req
}

function makeRes() {
  const res = new EventEmitter()
  res.headers = {}
  res.statusCode = 200
  res.writableEnded = false
  res.setHeader = jest.fn((key, value) => {
    res.headers[key] = value
  })
  res.status = jest.fn((statusCode) => {
    res.statusCode = statusCode
    return res
  })
  res.json = jest.fn((payload) => {
    res.body = payload
    res.writableEnded = true
    res.emit('close')
    return res
  })
  return res
}

function loadService(openaiImages = {}) {
  jest.resetModules()

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }

  jest.doMock(
    '../config/config',
    () => ({
      requestTimeout: 1000,
      openaiImages: {
        maxCodexN: 10,
        codexParallelism: 2,
        codexRetries: 1,
        ...openaiImages
      }
    }),
    { virtual: true }
  )
  jest.doMock('../src/utils/logger', () => logger)
  jest.doMock('../src/utils/proxyHelper', () => ({
    createProxyAgent: jest.fn(() => null),
    getProxyDescription: jest.fn(() => 'mock-proxy')
  }))
  jest.doMock('../src/services/apiKeyService', () => ({
    recordUsage: jest.fn(async () => undefined)
  }))
  jest.doMock('../src/services/openaiAccountService', () => ({
    recordUsage: jest.fn(async () => undefined),
    updateCodexUsageSnapshot: jest.fn(async () => undefined)
  }))
  jest.doMock('../src/services/openaiResponsesAccountService', () => ({
    getAccount: jest.fn(),
    updateAccount: jest.fn()
  }))
  jest.doMock('../src/services/unifiedOpenAIScheduler', () => ({
    markAccountRateLimited: jest.fn(async () => undefined),
    markAccountUnauthorized: jest.fn(async () => undefined)
  }))
  jest.doMock('../src/utils/headerFilter', () => ({
    filterForOpenAI: jest.fn((headers) => headers)
  }))
  jest.doMock('../src/utils/rateLimitHelper', () => ({
    updateRateLimitCounters: jest.fn(async () => undefined)
  }))

  let service
  jest.isolateModules(() => {
    service = require('../src/services/openaiImagesRelayService')
  })

  return { service, logger }
}

describe('openaiImagesRelayService Codex image batching', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
  })

  it('aggregates n=5 Codex image generation results', async () => {
    const { service } = loadService()
    const req = makeReq()
    const res = makeRes()
    const context = { model: 'gpt-image-2', responseFormat: 'b64_json' }

    service._requestCodexImageResponses = jest.fn(async () => ({
      headers: { 'x-request-id': 'req-1' }
    }))
    service._recordCodexImageUsage = jest.fn(async () => undefined)

    let imageIndex = 0
    service._collectCodexImageCompleted = jest.fn(async () => {
      imageIndex += 1
      return {
        createdAt: 1700000000 + imageIndex,
        model: 'gpt-5.4-mini',
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          total_tokens: 3,
          input_tokens_details: { cached_tokens: 1 }
        },
        results: [{ result: `b64-${imageIndex}`, outputFormat: 'png' }]
      }
    })

    await service._collectCodexImageResponsesBatch(req, res, context, {}, 5)

    expect(service._requestCodexImageResponses).toHaveBeenCalledTimes(5)
    expect(service._recordCodexImageUsage).toHaveBeenCalledTimes(5)
    expect(res.body.data).toHaveLength(5)
    expect(res.body.data.map((item) => item.b64_json)).toEqual([
      'b64-1',
      'b64-2',
      'b64-3',
      'b64-4',
      'b64-5'
    ])
    expect(res.body.usage).toMatchObject({
      input_tokens: 5,
      output_tokens: 10,
      total_tokens: 15,
      input_tokens_details: { cached_tokens: 5 }
    })
  })

  it('retries a failed batch item once before failing the whole batch', async () => {
    const { service, logger } = loadService({ codexParallelism: 1, codexRetries: 1 })
    const req = makeReq()
    const res = makeRes()
    const context = { model: 'gpt-image-2', responseFormat: 'b64_json' }

    let requestCount = 0
    service._requestCodexImageResponses = jest.fn(async () => {
      requestCount += 1
      if (requestCount === 1) {
        const error = new Error('temporary upstream error')
        error.statusCode = 502
        throw error
      }
      return { headers: {} }
    })
    service._collectCodexImageCompleted = jest.fn(async () => ({
      createdAt: 1700000000,
      model: 'gpt-5.4-mini',
      usage: null,
      results: [{ result: `b64-${requestCount}`, outputFormat: 'png' }]
    }))
    service._recordCodexImageUsage = jest.fn(async () => undefined)

    await service._collectCodexImageResponsesBatch(req, res, context, {}, 2)

    expect(service._requestCodexImageResponses).toHaveBeenCalledTimes(3)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('retrying'))
    expect(res.body.data).toHaveLength(2)
  })

  it('allows disabling Codex image batch retries', async () => {
    const { service, logger } = loadService({ codexParallelism: 1, codexRetries: 0 })
    const req = makeReq()
    const res = makeRes()
    const context = { model: 'gpt-image-2', responseFormat: 'b64_json' }
    const error = new Error('temporary upstream error')
    error.statusCode = 502

    service._requestCodexImageResponses = jest.fn(async () => {
      throw error
    })
    service._collectCodexImageCompleted = jest.fn()
    service._recordCodexImageUsage = jest.fn()

    await expect(service._collectCodexImageResponsesBatch(req, res, context, {}, 2)).rejects.toBe(
      error
    )

    expect(service._requestCodexImageResponses).toHaveBeenCalledTimes(1)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('does not retry a generated image when usage recording fails', async () => {
    const { service } = loadService({ codexParallelism: 1, codexRetries: 1 })
    const req = makeReq()
    const res = makeRes()
    const context = { model: 'gpt-image-2', responseFormat: 'b64_json' }
    const error = new Error('usage write failed')

    service._requestCodexImageResponses = jest.fn(async () => ({ headers: {} }))
    service._collectCodexImageCompleted = jest.fn(async () => ({
      createdAt: 1700000000,
      model: 'gpt-5.4-mini',
      usage: null,
      results: [{ result: 'b64-1', outputFormat: 'png' }]
    }))
    service._recordCodexImageUsage = jest.fn(async () => {
      throw error
    })

    await expect(service._collectCodexImageResponsesBatch(req, res, context, {}, 1)).rejects.toBe(
      error
    )

    expect(service._requestCodexImageResponses).toHaveBeenCalledTimes(1)
  })

  it('rejects stream=true with n>1 for Codex OAuth image generation', async () => {
    const { service } = loadService()
    const req = makeReq({ prompt: 'cat', model: 'gpt-image-2', n: 5, stream: true })
    const res = makeRes()
    service._forwardCodexImageResponses = jest.fn()

    await service.handleGeneration(req, res, { accountType: 'openai' })

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.body.error.param).toBe('n')
    expect(service._forwardCodexImageResponses).not.toHaveBeenCalled()
  })

  it('rejects Codex OAuth image n above the configured maximum', async () => {
    const { service } = loadService()
    const req = makeReq({ prompt: 'cat', model: 'gpt-image-2', n: 11 })
    const res = makeRes()

    await expect(
      service.handleGeneration(req, res, { accountType: 'openai' })
    ).rejects.toMatchObject({
      statusCode: 400,
      response: {
        data: {
          error: {
            param: 'n'
          }
        }
      }
    })
  })

  it('keeps batch edit reference images and mask when converting to Codex Responses', async () => {
    const { service } = loadService()
    const req = makeReq()
    const res = makeRes()
    const body = {
      prompt: 'edit',
      model: 'gpt-image-2',
      n: 2,
      images: ['data:image/png;base64,ref1', { image_url: { url: 'data:image/png;base64,ref2' } }],
      mask: { image_url: { url: 'data:image/png;base64,mask' } }
    }
    service._forwardCodexImageResponses = jest.fn(async () => undefined)

    await service._handleCodexJsonEdit(req, res, { accountType: 'openai' }, body)

    const [, , imageContext, responsesBody] = service._forwardCodexImageResponses.mock.calls[0]
    const imageParts = responsesBody.input[0].content.filter((item) => item.type === 'input_image')

    expect(imageContext.imageCount).toBe(2)
    expect(imageParts.map((item) => item.image_url)).toEqual([
      'data:image/png;base64,ref1',
      'data:image/png;base64,ref2'
    ])
    expect(responsesBody.tools[0].input_image_mask.image_url).toBe('data:image/png;base64,mask')
  })
})
