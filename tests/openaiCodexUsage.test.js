describe('OpenAI Codex live usage refresh', () => {
  function loadService(usagePayload) {
    jest.resetModules()
    jest.useFakeTimers()

    let account = {
      id: 'acc-1',
      name: 'OpenAI 1',
      accountId: 'chatgpt-account-1',
      accessToken: '',
      refreshToken: '',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      isActive: 'true',
      schedulable: 'true',
      status: 'active'
    }
    const redisClient = {
      hgetall: jest.fn(async () => ({ ...account })),
      hset: jest.fn(async (_key, updates) => {
        account = { ...account, ...updates }
        return 1
      })
    }
    const axiosGet = jest.fn(async () => ({ status: 200, data: usagePayload }))

    jest.doMock('../src/models/redis', () => ({
      getClientSafe: jest.fn(() => redisClient)
    }))
    jest.doMock(
      '../config/config',
      () => ({
        requestTimeout: 600000,
        security: { encryptionKey: 'test-encryption-key-for-codex-usage' },
        proxy: {}
      }),
      { virtual: true }
    )
    jest.doMock('../src/utils/logger', () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      success: jest.fn()
    }))
    jest.doMock('../src/utils/proxyHelper', () => ({
      createProxyAgent: jest.fn(() => null),
      getProxyDescription: jest.fn(() => 'No proxy')
    }))
    jest.doMock('../src/utils/tokenRefreshLogger', () => ({
      logRefreshStart: jest.fn(),
      logRefreshSuccess: jest.fn(),
      logRefreshError: jest.fn(),
      logTokenUsage: jest.fn(),
      logRefreshSkipped: jest.fn()
    }))
    jest.doMock('../src/services/tokenRefreshService', () => ({
      acquireRefreshLock: jest.fn(async () => true),
      releaseRefreshLock: jest.fn(async () => undefined)
    }))
    jest.doMock('../src/utils/redisKeyFilter', () => ({
      getPrimaryPrefixedRedisKeys: jest.fn(async () => [])
    }))
    jest.doMock('axios', () => ({
      get: axiosGet
    }))

    let service
    jest.isolateModules(() => {
      service = require('../src/services/openaiAccountService')
    })
    account.accessToken = service.encrypt('access-token-1')

    return { service, axiosGet, redisClient, getAccount: () => ({ ...account }) }
  }

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
    jest.resetModules()
  })

  it('fetches wham usage and persists both 5h and weekly windows', async () => {
    const { service, axiosGet, redisClient, getAccount } = loadService({
      rate_limit: {
        primary_window: {
          used_percent: 31,
          limit_window_seconds: 18000,
          reset_after_seconds: 7200
        },
        secondary_window: {
          used_percent: 54,
          limit_window_seconds: 604800,
          reset_after_seconds: 482400
        }
      }
    })

    const result = await service.refreshCodexUsage('acc-1')

    expect(axiosGet).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/wham/usage',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-1',
          'ChatGPT-Account-Id': 'chatgpt-account-1'
        })
      })
    )
    expect(result.codexUsage.primary.windowMinutes).toBe(300)
    expect(result.codexUsage.secondary.windowMinutes).toBe(10080)
    expect(getAccount().codexPrimaryUsedPercent).toBe('31')
    expect(getAccount().codexSecondaryUsedPercent).toBe('54')
    expect(redisClient.hset).toHaveBeenCalled()
  })
})
