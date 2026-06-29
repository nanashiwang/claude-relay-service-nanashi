function loadScheduler(disableAutoProtection) {
  jest.resetModules()

  const openaiAccountService = {
    setAccountRateLimited: jest.fn(async () => undefined)
  }
  const openaiResponsesAccountService = {
    getAccount: jest.fn(async () => ({
      id: 'account-1',
      disableAutoProtection
    })),
    markAccountRateLimited: jest.fn(async () => undefined),
    updateAccount: jest.fn(async () => undefined)
  }

  jest.doMock('../src/services/openaiAccountService', () => openaiAccountService)
  jest.doMock('../src/services/openaiResponsesAccountService', () => openaiResponsesAccountService)
  jest.doMock('../src/services/accountGroupService', () => ({}))
  jest.doMock('../src/services/claudeRelayConfigService', () => ({}))
  jest.doMock('../src/models/redis', () => ({}))
  jest.doMock('../src/utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }))
  jest.doMock('../src/utils/sessionStickyHelper', () => ({
    resolveStickySessionPolicy: jest.fn(() => ({
      ttlHours: 6,
      fullTTLSeconds: 21600,
      renewalThresholdSeconds: 0
    }))
  }))
  jest.doMock('../src/utils/codexAutoReview', () => ({
    isModelSupportedForCodexAutoReview: jest.fn(() => false)
  }))

  let scheduler
  jest.isolateModules(() => {
    scheduler = require('../src/services/unifiedOpenAIScheduler')
  })

  return { scheduler, openaiResponsesAccountService }
}

describe('UnifiedOpenAIScheduler OpenAI Responses auto protection', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
  })

  it('does not force schedulable=false when OpenAI Responses auto protection is disabled', async () => {
    const { scheduler, openaiResponsesAccountService } = loadScheduler('true')

    await scheduler.markAccountRateLimited('account-1', 'openai-responses', null, 120)

    expect(openaiResponsesAccountService.markAccountRateLimited).toHaveBeenCalledWith(
      'account-1',
      2
    )
    expect(openaiResponsesAccountService.updateAccount).not.toHaveBeenCalled()
  })

  it('keeps disabling scheduling when OpenAI Responses auto protection is enabled', async () => {
    const { scheduler, openaiResponsesAccountService } = loadScheduler('false')

    await scheduler.markAccountRateLimited('account-1', 'openai-responses', null, 120)

    expect(openaiResponsesAccountService.markAccountRateLimited).toHaveBeenCalledWith(
      'account-1',
      2
    )
    expect(openaiResponsesAccountService.updateAccount).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        schedulable: 'false',
        rateLimitResetAt: expect.any(String)
      })
    )
  })
})
