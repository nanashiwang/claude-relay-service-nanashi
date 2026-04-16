describe('ClaudeAccountService allowed_warning handling', () => {
  function loadService(initialAccount = {}) {
    jest.resetModules()
    jest.spyOn(global, 'setInterval').mockImplementation(() => 0)

    let currentAccount = {
      id: 'acc-1',
      name: 'Account 1',
      autoStopOnWarning: 'true',
      schedulable: 'true',
      sessionWindowStart: '2026-04-16T00:00:00.000Z',
      sessionWindowEnd: '2026-04-16T05:00:00.000Z',
      ...initialAccount
    }

    const redisMock = {
      getClaudeAccount: jest.fn(async () => ({ ...currentAccount })),
      setClaudeAccount: jest.fn(async (_accountId, data) => {
        currentAccount = { ...data }
      }),
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
      getAccount: () => ({ ...currentAccount }),
      updateAccount: (patch) => {
        currentAccount = { ...currentAccount, ...patch }
      }
    }
  }

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
  })

  it('keeps scheduling enabled even after repeated warnings in the same window', async () => {
    const { service, getAccount, webhookNotifier } = loadService()

    await service.updateSessionWindowStatus('acc-1', 'allowed_warning')
    await service.updateSessionWindowStatus('acc-1', 'allowed_warning')
    await service.updateSessionWindowStatus('acc-1', 'allowed_warning')
    await service.updateSessionWindowStatus('acc-1', 'allowed_warning')

    expect(getAccount().schedulable).toBe('true')
    expect(getAccount().fiveHourAutoStopped).toBeUndefined()
    expect(getAccount().stoppedReason).toBeUndefined()
    expect(getAccount().sessionWindowStatus).toBe('allowed_warning')
    expect(webhookNotifier.sendAccountAnomalyNotification).not.toHaveBeenCalled()
  })

  it('only records warning status without storing auto-stop metadata', async () => {
    const { service, getAccount } = loadService()

    await service.updateSessionWindowStatus('acc-1', 'allowed_warning')

    expect(getAccount().schedulable).toBe('true')
    expect(getAccount().fiveHourAutoStopped).toBeUndefined()
    expect(getAccount().stoppedReason).toBeUndefined()
    expect(getAccount().fiveHourConsecutiveWarningCount).toBeUndefined()
    expect(getAccount().sessionWindowStatus).toBe('allowed_warning')
  })

  it('keeps scheduling enabled across warnings from multiple windows', async () => {
    const { service, getAccount, updateAccount } = loadService()

    await service.updateSessionWindowStatus('acc-1', 'allowed_warning')
    await service.updateSessionWindowStatus('acc-1', 'allowed_warning')

    updateAccount({
      sessionWindowStart: '2026-04-16T05:00:00.000Z',
      sessionWindowEnd: '2026-04-16T10:00:00.000Z'
    })

    await service.updateSessionWindowStatus('acc-1', 'allowed_warning')

    expect(getAccount().schedulable).toBe('true')
    expect(getAccount().fiveHourAutoStopped).toBeUndefined()
    expect(getAccount().stoppedReason).toBeUndefined()
  })
})
