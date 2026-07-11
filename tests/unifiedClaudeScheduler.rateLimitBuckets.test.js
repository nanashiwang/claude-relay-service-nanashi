function loadScheduler(initialAccount, modelLimitImpl, options = {}) {
  jest.resetModules()

  let account = { ...initialAccount }
  const additionalAccounts = (options.additionalAccounts || []).map((item) => ({ ...item }))
  const redisClient = {
    exists: jest.fn(async () => 0),
    setex: jest.fn(async () => 'OK')
  }

  const redis = {
    getClaudeAccount: jest.fn(async (accountId) => {
      if (accountId === account.id) {
        return { ...account }
      }
      const additionalAccount = additionalAccounts.find((item) => item.id === accountId)
      return additionalAccount ? { ...additionalAccount } : null
    }),
    getAllClaudeAccounts: jest.fn(async () => [
      { ...account },
      ...additionalAccounts.map((item) => ({ ...item }))
    ]),
    getClientSafe: jest.fn(() => redisClient),
    getSessionAccountMapping: jest.fn(async () => null),
    setSessionAccountMapping: jest.fn(async () => undefined),
    deleteSessionAccountMapping: jest.fn(async () => undefined)
  }

  const claudeAccountService = {
    isAccountRateLimitedForModel: jest.fn(async (accountId, requestedModel) => {
      const result = await modelLimitImpl(accountId, requestedModel, account)
      if (result?.account && accountId === account.id) {
        account = { ...result.account }
      }
      return result?.limited === true
    }),
    getAccountRateLimitInfoForModel: jest.fn(async () => null),
    clearExpiredOpusRateLimit: jest.fn(async () => undefined),
    isAccountOpusRateLimited: jest.fn(async () => false),
    isAccountOverloaded: jest.fn(async () => false)
  }

  jest.doMock('../src/services/claudeAccountService', () => claudeAccountService)
  jest.doMock('../src/services/claudeConsoleAccountService', () => ({
    getAllAccounts: jest.fn(async () => []),
    getAccount: jest.fn(async () => null)
  }))
  jest.doMock('../src/services/bedrockAccountService', () => ({
    getAllAccounts: jest.fn(async () => ({ success: true, data: [] })),
    getAccount: jest.fn(async () => ({ success: false }))
  }))
  jest.doMock('../src/services/ccrAccountService', () => ({
    getAccount: jest.fn(async () => null),
    getAllAccounts: jest.fn(async () => [])
  }))
  jest.doMock('../src/services/accountGroupService', () => ({}))
  jest.doMock('../src/services/claudeRelayConfigService', () => ({}))
  jest.doMock(
    '../config/config',
    () => ({
      claude: { dedicatedAccountFallback: options.dedicatedAccountFallback === true },
      upstreamError: { maxCustomTtlSeconds: 1800 }
    }),
    { virtual: true }
  )
  jest.doMock('../src/models/redis', () => redis)
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
  jest.doMock('../src/utils/modelHelper', () => ({
    parseVendorPrefixedModel: jest.fn((model) => ({ vendor: null, baseModel: model })),
    isOpus45OrNewer: jest.fn(() => true)
  }))

  let scheduler
  jest.isolateModules(() => {
    scheduler = require('../src/services/unifiedClaudeScheduler')
  })

  return {
    scheduler,
    redis,
    redisClient,
    claudeAccountService,
    getAccount: () => ({ ...account })
  }
}

describe('UnifiedClaudeScheduler Claude bucket rate limits', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
  })

  it('allows Opus after a legacy non-Opus weekly limit is migrated out of global schedulable=false', async () => {
    const initialAccount = {
      id: 'acc-1',
      name: 'Claude Max',
      isActive: 'true',
      status: 'active',
      accountType: 'shared',
      schedulable: 'false',
      priority: '50'
    }

    const { scheduler, claudeAccountService, getAccount } = loadScheduler(
      initialAccount,
      async (_accountId, requestedModel, currentAccount) => {
        if (requestedModel.includes('opus')) {
          return {
            limited: false,
            account: { ...currentAccount, schedulable: 'true' }
          }
        }
        return { limited: true, account: currentAccount }
      }
    )

    const selected = await scheduler.selectAccountForApiKey({}, null, 'claude-opus-4-8')

    expect(selected).toEqual({ accountId: 'acc-1', accountType: 'claude-official' })
    expect(claudeAccountService.isAccountRateLimitedForModel).toHaveBeenCalledWith(
      'acc-1',
      'claude-opus-4-8'
    )
    expect(getAccount().schedulable).toBe('true')
  })

  it('allows Sonnet when only the Fable bucket is limited', async () => {
    const initialAccount = {
      id: 'acc-1',
      name: 'Claude Pro',
      isActive: 'true',
      status: 'active',
      accountType: 'shared',
      schedulable: 'true',
      priority: '50'
    }

    const { scheduler, claudeAccountService } = loadScheduler(
      initialAccount,
      async (_accountId, requestedModel, currentAccount) => ({
        limited: requestedModel.includes('fable'),
        account: currentAccount
      })
    )

    const selected = await scheduler.selectAccountForApiKey({}, null, 'claude-sonnet-4-6')

    expect(selected).toEqual({ accountId: 'acc-1', accountType: 'claude-official' })
    expect(claudeAccountService.isAccountRateLimitedForModel).toHaveBeenCalledWith(
      'acc-1',
      'claude-sonnet-4-6'
    )
  })

  it('rejects a temporarily unavailable dedicated account instead of using the shared pool', async () => {
    const initialAccount = {
      id: 'acc-1',
      name: 'Dedicated Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'dedicated',
      schedulable: 'true'
    }
    const { scheduler } = loadScheduler(initialAccount, async () => ({ limited: false }))
    jest.spyOn(scheduler, 'isAccountTemporarilyUnavailable').mockResolvedValue(true)

    await expect(
      scheduler.selectAccountForApiKey(
        { name: 'Dedicated key', claudeAccountId: 'acc-1' },
        null,
        'claude-sonnet-4-6'
      )
    ).rejects.toMatchObject({
      code: 'CLAUDE_DEDICATED_UNAVAILABLE',
      accountId: 'acc-1',
      reason: 'temporarily_unavailable'
    })
  })

  it('reports a dedicated model limit before checking temp-unavailable', async () => {
    const initialAccount = {
      id: 'acc-1',
      name: 'Dedicated Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'dedicated',
      schedulable: 'false',
      rateLimitAutoStopped: 'true'
    }
    const { scheduler } = loadScheduler(initialAccount, async () => ({ limited: true }))
    const tempSpy = jest.spyOn(scheduler, 'isAccountTemporarilyUnavailable').mockResolvedValue(true)

    await expect(
      scheduler.selectAccountForApiKey(
        { name: 'Dedicated key', claudeAccountId: 'acc-1' },
        null,
        'claude-sonnet-4-6'
      )
    ).rejects.toMatchObject({ code: 'CLAUDE_DEDICATED_RATE_LIMITED', accountId: 'acc-1' })
    expect(tempSpy).not.toHaveBeenCalled()
  })

  it('allows explicit dedicated-account fallback', async () => {
    const dedicatedAccount = {
      id: 'acc-1',
      name: 'Dedicated Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'dedicated',
      schedulable: 'true'
    }
    const { scheduler } = loadScheduler(dedicatedAccount, async () => ({ limited: false }), {
      dedicatedAccountFallback: true,
      additionalAccounts: [
        {
          id: 'shared-1',
          name: 'Shared Claude',
          isActive: 'true',
          status: 'active',
          accountType: 'shared',
          schedulable: 'true',
          priority: '50'
        }
      ]
    })
    jest
      .spyOn(scheduler, 'isAccountTemporarilyUnavailable')
      .mockImplementation(async (accountId) => accountId === 'acc-1')

    await expect(
      scheduler.selectAccountForApiKey(
        { name: 'Dedicated key', claudeAccountId: 'acc-1' },
        null,
        'claude-sonnet-4-6'
      )
    ).resolves.toEqual({ accountId: 'shared-1', accountType: 'claude-official' })
  })

  it('caps temp-unavailable TTL at 30 minutes', async () => {
    const initialAccount = {
      id: 'acc-1',
      name: 'Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'shared',
      schedulable: 'true'
    }
    const { scheduler, redisClient } = loadScheduler(initialAccount, async () => ({
      limited: false
    }))

    await scheduler.markAccountTemporarilyUnavailable('acc-1', 'claude-official', null, 443300)

    expect(redisClient.setex).toHaveBeenCalledWith(
      'temp_unavailable:claude-official:acc-1',
      1800,
      '1'
    )
  })
})
