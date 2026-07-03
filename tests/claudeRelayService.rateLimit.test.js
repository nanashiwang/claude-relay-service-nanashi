const EventEmitter = require('events')
const https = require('https')

function makeResponseStream() {
  const responseStream = new EventEmitter()
  responseStream.headers = {}
  responseStream.headersSent = false
  responseStream.writableEnded = false
  responseStream.bytesWritten = 0
  responseStream.status = jest.fn((statusCode) => {
    responseStream.statusCode = statusCode
    responseStream.headersSent = true
    return responseStream
  })
  responseStream.setHeader = jest.fn((key, value) => {
    responseStream.headers[key] = value
  })
  responseStream.getHeader = jest.fn((key) => responseStream.headers[key])
  responseStream.writeHead = jest.fn((statusCode, headers) => {
    responseStream.statusCode = statusCode
    responseStream.headers = { ...responseStream.headers, ...headers }
    responseStream.headersSent = true
  })
  responseStream.write = jest.fn((chunk) => {
    responseStream.bytesWritten += Buffer.byteLength(String(chunk))
  })
  responseStream.end = jest.fn(() => {
    responseStream.writableEnded = true
  })
  return responseStream
}

function loadRelayService() {
  jest.resetModules()

  const claudeAccountService = {
    getAccount: jest.fn(async () => ({ id: 'acc-1', name: 'Account 1' })),
    getValidAccessToken: jest.fn(async () => 'access-token'),
    clearExpiredOpusRateLimit: jest.fn(async () => undefined),
    isAccountOpusRateLimited: jest.fn(async () => false),
    markAccountOpusRateLimited: jest.fn(async () => undefined),
    markAccountModelRateLimited: jest.fn(async () => undefined),
    classifyClaudeRateLimitBucket: jest.fn(({ requestedModel, rateLimitResetTimestamp }) => {
      if (!rateLimitResetTimestamp) {
        return null
      }
      return requestedModel && requestedModel.toLowerCase().includes('opus')
        ? 'weekly_opus'
        : 'weekly_non_opus'
    }),
    updateSessionWindowStatus: jest.fn(async () => undefined),
    clearInternalErrors: jest.fn(async () => undefined),
    isAccountOverloaded: jest.fn(async () => false),
    removeAccountOverload: jest.fn(async () => undefined),
    markAccountOverloaded: jest.fn(async () => undefined)
  }
  const unifiedClaudeScheduler = {
    selectAccountForApiKey: jest.fn(async () => ({
      accountId: 'acc-1',
      accountType: 'claude-official'
    })),
    markAccountRateLimited: jest.fn(async () => undefined),
    markAccountBlocked: jest.fn(async () => undefined),
    markAccountUnauthorized: jest.fn(async () => undefined),
    isAccountRateLimited: jest.fn(async () => false),
    removeAccountRateLimit: jest.fn(async () => undefined)
  }

  jest.doMock(
    '../config/config',
    () => ({
      requestTimeout: 1000,
      claude: {
        apiVersion: '2023-06-01',
        betaHeader: 'claude-code-20250219',
        systemPrompt: '',
        overloadHandling: { enabled: 0 }
      }
    }),
    { virtual: true }
  )
  jest.doMock('../src/services/claudeAccountService', () => claudeAccountService)
  jest.doMock('../src/services/unifiedClaudeScheduler', () => unifiedClaudeScheduler)
  jest.doMock('../src/utils/sessionHelper', () => ({
    generateSessionHash: jest.fn(() => 'session-1')
  }))
  jest.doMock('../src/services/userMessageQueueService', () => ({
    isUserMessageRequest: jest.fn(() => false),
    acquireQueueLock: jest.fn(),
    releaseQueueLock: jest.fn()
  }))
  jest.doMock('../src/utils/headerFilter', () => ({
    filterForClaude: jest.fn((headers) => headers)
  }))
  jest.doMock('../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    success: jest.fn(),
    performance: jest.fn()
  }))
  jest.doMock('../src/services/claudeCodeHeadersService', () => ({
    storeAccountHeaders: jest.fn(async () => undefined)
  }))
  jest.doMock('../src/models/redis', () => ({
    getClaudeAccount: jest.fn(async () => ({ id: 'acc-1', name: 'Account 1' }))
  }))
  jest.doMock('../src/services/requestIdentityService', () => ({}))
  jest.doMock('../src/utils/metadataUserIdHelper', () => ({}))
  jest.doMock('../src/utils/proxyHelper', () => ({
    createProxyAgent: jest.fn(() => null),
    getProxyDescription: jest.fn(() => 'mock-proxy')
  }))
  jest.doMock('../src/utils/dateHelper', () => ({
    formatDateWithTimezone: jest.fn((value) => `reset-${value}`)
  }))
  jest.doMock('../src/utils/streamHelper', () => ({
    isStreamWritable: jest.fn((stream) => !stream.writableEnded)
  }))
  jest.doMock('../src/utils/upstreamResponseStream', () => ({
    appendPreviewBuffer: jest.fn((current, chunk) => Buffer.concat([current, Buffer.from(chunk)])),
    createDecodedUpstreamStream: jest.fn((res) => ({
      stream: res,
      decoded: false,
      supported: true
    })),
    normalizeContentEncoding: jest.fn(() => null),
    toHexPreview: jest.fn(() => '')
  }))

  let service
  jest.isolateModules(() => {
    service = require('../src/services/claudeRelayService')
  })

  service._getProxyAgent = jest.fn(async () => null)
  service._processRequestBody = jest.fn((body) => body)
  service._prepareRequestHeadersAndPayload = jest.fn(async (body) => ({
    bodyString: JSON.stringify(body),
    headers: {}
  }))
  service._sleep = jest.fn(async () => undefined)

  return { service, claudeAccountService, unifiedClaudeScheduler }
}

function makeDedicatedApiKey() {
  return {
    id: 'key-1',
    name: 'Dedicated key',
    claudeAccountId: 'acc-1'
  }
}

describe('ClaudeRelayService transient 429 handling', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
  })

  it('passes through dedicated-account 429 without reset header instead of rewriting it to 403', async () => {
    const { service, unifiedClaudeScheduler } = loadRelayService()
    service._makeClaudeRequest = jest.fn(async () => ({
      statusCode: 429,
      headers: {},
      body: JSON.stringify({ error: { message: 'quota exceeded' } })
    }))

    const response = await service.relayRequest(
      { model: 'claude-sonnet-4', messages: [] },
      makeDedicatedApiKey(),
      null,
      null,
      {}
    )

    expect(response.statusCode).toBe(429)
    expect(JSON.parse(response.body).error.message).toBe('quota exceeded')
    expect(unifiedClaudeScheduler.markAccountRateLimited).not.toHaveBeenCalled()
  })

  it('marks a non-Opus weekly bucket instead of globally stopping the account', async () => {
    const { service, claudeAccountService, unifiedClaudeScheduler } = loadRelayService()
    service._makeClaudeRequest = jest.fn(async () => ({
      statusCode: 429,
      headers: {
        'anthropic-ratelimit-unified-reset': '1800000000'
      },
      body: JSON.stringify({ error: { message: 'rate limited' } })
    }))

    const response = await service.relayRequest(
      { model: 'claude-sonnet-4', messages: [] },
      makeDedicatedApiKey(),
      null,
      null,
      {}
    )

    expect(response.statusCode).toBe(403)
    expect(JSON.parse(response.body)).toEqual({
      error: 'non_opus_weekly_limit',
      message:
        '此专属账号的非 Opus 模型周额度已达到限制，将于 reset-1800000000 自动恢复；如 Opus 额度仍可用，可切换 Opus 模型继续。'
    })
    expect(claudeAccountService.markAccountModelRateLimited).toHaveBeenCalledWith(
      'acc-1',
      'weekly_non_opus',
      1800000000,
      expect.objectContaining({ requestedModel: 'claude-sonnet-4' })
    )
    expect(unifiedClaudeScheduler.markAccountRateLimited).not.toHaveBeenCalled()
  })

  it('marks an Opus weekly bucket without globally stopping the account', async () => {
    const { service, claudeAccountService, unifiedClaudeScheduler } = loadRelayService()
    service._makeClaudeRequest = jest.fn(async () => ({
      statusCode: 429,
      headers: {
        'anthropic-ratelimit-unified-reset': '1800000000'
      },
      body: JSON.stringify({ error: { message: 'rate limited' } })
    }))

    const response = await service.relayRequest(
      { model: 'claude-opus-4-8', messages: [] },
      makeDedicatedApiKey(),
      null,
      null,
      {}
    )

    expect(response.statusCode).toBe(403)
    expect(JSON.parse(response.body)).toEqual({
      error: 'opus_weekly_limit',
      message:
        '此专属账号的Opus模型已达到周使用限制，将于 reset-1800000000 自动恢复，请尝试切换其他模型后再试。'
    })
    expect(claudeAccountService.markAccountModelRateLimited).toHaveBeenCalledWith(
      'acc-1',
      'weekly_opus',
      1800000000,
      expect.objectContaining({ requestedModel: 'claude-opus-4-8' })
    )
    expect(unifiedClaudeScheduler.markAccountRateLimited).not.toHaveBeenCalled()
  })

  it('does not mark an account rate-limited when a stream reports rate limit without reset header', async () => {
    const { service, unifiedClaudeScheduler } = loadRelayService()
    const requestSpy = jest.spyOn(https, 'request').mockImplementation((_options, callback) => {
      const req = new EventEmitter()
      req.destroyed = false
      req.write = jest.fn()
      req.destroy = jest.fn(() => {
        req.destroyed = true
      })
      req.end = jest.fn(() => {
        process.nextTick(() => {
          const res = new EventEmitter()
          res.statusCode = 200
          res.headers = {}
          callback(res)
          process.nextTick(() => {
            res.emit(
              'data',
              Buffer.from(
                'data: {"type":"error","error":{"message":"exceed your account\'s rate limit"}}\n\n'
              )
            )
            res.emit('end')
          })
        })
      })
      return req
    })
    const responseStream = makeResponseStream()

    await service._makeClaudeStreamRequestWithUsageCapture(
      { model: 'claude-sonnet-4', messages: [], stream: true },
      'access-token',
      null,
      {},
      responseStream,
      null,
      'acc-1',
      'claude-official',
      'session-1',
      null,
      {},
      true
    )

    expect(requestSpy).toHaveBeenCalled()
    expect(responseStream.end).toHaveBeenCalled()
    expect(unifiedClaudeScheduler.markAccountRateLimited).not.toHaveBeenCalled()
  })
})
