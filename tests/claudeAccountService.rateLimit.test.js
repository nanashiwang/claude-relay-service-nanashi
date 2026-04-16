describe('ClaudeAccountService transient 429 handling', () => {
  function loadService(initialAccount = {}) {
    jest.resetModules()
    jest.spyOn(global, 'setInterval').mockImplementation(() => 0)

    let currentAccount = {
      id: 'acc-1',
      name: 'Account 1',
      schedulable: 'true',
      ...initialAccount
    }

    const redisMock = {
      getClaudeAccount: jest.fn(async () => ({ ...currentAccount })),
      setClaudeAccount: jest.fn(async (_accountId, data) => {
        currentAccount = { ...data }
      }),
      deleteSessionAccountMapping: jest.fn(async () => undefined),
      client: {
        hdel: jest.fn(async () => 0)
      }
    }

    const webhookNotifier = {
      sendAccountAnomalyNotification: jest.fn(async () => undefined)
    }

    jest.doMock('../src/models/redis', () => redisMock)
    jest.doMock('../config/config', () => ({ claude: { fiveHourWarning: {} } }), {
      virtual: true
    })
    jest.doMock('../src/utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      success: jest.fn()
    }))
    jest.doMock('../src/utils/tokenMask', () => ({ maskToken: jest.fn((value) => value) }))
    jest.doMock('../src/utils/tokenRefreshLogger', () => ({
      logRefreshStart: jest.fn(),
      logRefreshSuccess: jest.fn(),
      logRefreshError: jest.fn(),
      logTokenUsage: jest.fn(),
      logRefreshSkipped: jest.fn()
    }))
    jest.doMock('../src/services/tokenRefreshService', () => ({}))
    jest.doMock('../src/utils/proxyHelper', () => ({
      createProxyAgent: jest.fn(() => null),
      getProxyDescription: jest.fn(() => 'mock-proxy')
    }))
    jest.doMock('../src/utils/dateHelper', () => ({
      formatDateWithTimezone: jest.fn(() => '2026-04-16 00:00:00'),
      getISOStringWithTimezone: jest.fn((date) => date.toISOString())
    }))
    jest.doMock('../src/utils/modelHelper', () => ({
      isOpus45OrNewer: jest.fn(() => false)
    }))
    jest.doMock('../src/utils/lruCache', () => {
      return class MockLRUCache {
        cleanup() {}
        getStats() {
          return {}
        }
      }
    })
    jest.doMock('../src/utils/webhookNotifier', () => webhookNotifier)
    jest.doMock('axios', () => ({}), { virtual: true })
    jest.doMock('uuid', () => ({ v4: jest.fn(() => 'uuid-1') }), { virtual: true })

    let service
    jest.isolateModules(() => {
      service = require('../src/services/claudeAccountService')
    })

    return {
      service,
      redisMock,
      webhookNotifier,
      getAccount: () => ({ ...currentAccount })
    }
  }

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
  })

  it('keeps scheduling enabled for transient 429 without reset timestamp', async () => {
    const { service, getAccount } = loadService()

    await service.markAccountRateLimited('acc-1', null, null)

    expect(getAccount().schedulable).toBe('true')
    expect(getAccount().rateLimitStatus).toBe('limited')
    expect(getAccount().rateLimitEndAt).toBeTruthy()
    expect(getAccount().rateLimitAutoStopped).toBeUndefined()
  })

  it('still auto-stops scheduling when 429 has an explicit reset timestamp', async () => {
    const { service, getAccount } = loadService()
    const resetTimestamp = Math.floor(Date.now() / 1000) + 3600

    await service.markAccountRateLimited('acc-1', null, resetTimestamp)

    expect(getAccount().schedulable).toBe('false')
    expect(getAccount().rateLimitStatus).toBe('limited')
    expect(getAccount().rateLimitEndAt).toBeTruthy()
    expect(getAccount().rateLimitAutoStopped).toBe('true')
  })
})
