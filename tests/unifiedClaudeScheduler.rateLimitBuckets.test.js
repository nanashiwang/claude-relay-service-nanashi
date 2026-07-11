function loadScheduler(initialAccount, modelLimitImpl, options = {}) {
  jest.resetModules()

  let account = { ...initialAccount }
  const additionalAccounts = (options.additionalAccounts || []).map((item) => ({ ...item }))
  const redisClient = {
    exists: jest.fn(async () => 0),
    get: jest.fn(async () =>
      options.sessionMapping ? JSON.stringify(options.sessionMapping) : null
    ),
    ttl: jest.fn(async () => -2),
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
    isAccountOverloaded: jest.fn(async () => false),
    getAccountOperationalStatus: jest.fn(async () => null),
    inspectAccountForModel: jest.fn(async (accountData, requestedModel) => {
      const result = await modelLimitImpl(accountData.id, requestedModel, accountData)
      return {
        isRateLimited: result?.limited === true,
        bucket: result?.limited ? 'weekly_model' : null,
        resetAt: null,
        wouldAutoResumeScheduling: false,
        token: { status: 'healthy' }
      }
    })
  }

  jest.doMock('../src/services/claudeAccountService', () => claudeAccountService)
  jest.doMock('../src/services/claudeConsoleAccountService', () => ({
    getAllAccounts: jest.fn(async () => []),
    getAccount: jest.fn(async () => null),
    isSubscriptionExpired: jest.fn(() => false),
    isAccountRateLimited: jest.fn(async () => false),
    isAccountQuotaExceeded: jest.fn(async () => false)
  }))
  jest.doMock('../src/services/bedrockAccountService', () => ({
    getAllAccounts: jest.fn(async () => ({ success: true, data: [] })),
    getAccount: jest.fn(async () => ({ success: false }))
  }))
  jest.doMock('../src/services/ccrAccountService', () => ({
    getAccount: jest.fn(async () => null),
    getAllAccounts: jest.fn(async () => []),
    isSubscriptionExpired: jest.fn(() => false),
    isAccountRateLimited: jest.fn(async () => false),
    isAccountQuotaExceeded: jest.fn(async () => false)
  }))
  jest.doMock('../src/services/accountGroupService', () => ({
    getGroup: jest.fn(async (groupId) =>
      options.group?.id === groupId ? { ...options.group } : null
    ),
    getGroupMembers: jest.fn(async (groupId) =>
      options.group?.id === groupId ? [...(options.groupMembers || [])] : []
    )
  }))
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
  const loggerMock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
  jest.doMock('../src/utils/logger', () => loggerMock)
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
    loggerMock,
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

  it('explains rate-limit exclusions and selects the highest-priority healthy account', async () => {
    const limitedAccount = {
      id: 'acc-1',
      name: 'Limited Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'shared',
      schedulable: 'true',
      priority: '10'
    }
    const healthyAccount = {
      id: 'acc-2',
      name: 'Healthy Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'shared',
      schedulable: 'true',
      priority: '20'
    }
    const { scheduler } = loadScheduler(
      limitedAccount,
      async (accountId) => ({ limited: accountId === 'acc-1' }),
      { additionalAccounts: [healthyAccount] }
    )

    const report = await scheduler.explainAccountSelection({
      requestedModel: 'claude-sonnet-4-6'
    })

    expect(report.selection).toMatchObject({
      mode: 'priority_pool',
      selected: { accountId: 'acc-2', accountType: 'claude-official' }
    })
    expect(report.summary).toMatchObject({
      totalAccounts: 2,
      healthyAccountCount: 1,
      selectableAccountCount: 1
    })
    expect(report.accounts.find((account) => account.accountId === 'acc-1').reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'rate_limited' })])
    )
  })

  it('honors sticky mappings without mutating the session mapping', async () => {
    const firstAccount = {
      id: 'acc-1',
      name: 'Sticky Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'shared',
      schedulable: 'true',
      priority: '50',
      lastUsedAt: new Date().toISOString()
    }
    const secondAccount = {
      id: 'acc-2',
      name: 'Older Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'shared',
      schedulable: 'true',
      priority: '50',
      lastUsedAt: '2025-01-01T00:00:00.000Z'
    }
    const { scheduler, redis } = loadScheduler(firstAccount, async () => ({ limited: false }), {
      additionalAccounts: [secondAccount],
      sessionMapping: { accountId: 'acc-1', accountType: 'claude-official' }
    })

    const report = await scheduler.explainAccountSelection({
      requestedModel: 'claude-sonnet-4-6',
      sessionHash: 'session-hash'
    })

    expect(report.selection).toMatchObject({
      mode: 'sticky_session',
      selected: { accountId: 'acc-1' }
    })
    expect(redis.setSessionAccountMapping).not.toHaveBeenCalled()
    expect(redis.deleteSessionAccountMapping).not.toHaveBeenCalled()
  })

  it('reports API key permission blockers without hiding pool health', async () => {
    const initialAccount = {
      id: 'acc-1',
      name: 'Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'shared',
      schedulable: 'true',
      priority: '50'
    }
    const { scheduler } = loadScheduler(initialAccount, async () => ({ limited: false }))

    const report = await scheduler.explainAccountSelection({
      requestedModel: 'claude-sonnet-4-6',
      apiKeyData: { id: 'key-1', name: 'OpenAI only', isActive: 'true', permissions: 'openai' }
    })

    expect(report.summary).toMatchObject({ healthyAccountCount: 1, selectableAccountCount: 0 })
    expect(report.context.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'api_key_permission_denied' })])
    )
    expect(report.selection).toEqual({ mode: 'blocked_by_api_key', selected: null })
    expect(report.accounts[0]).toMatchObject({ eligible: true, selectable: false })
  })

  it('treats the legacy all permission as unrestricted', async () => {
    const initialAccount = {
      id: 'acc-1',
      name: 'Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'shared',
      schedulable: 'true',
      priority: '50'
    }
    const { scheduler } = loadScheduler(initialAccount, async () => ({ limited: false }))

    const report = await scheduler.explainAccountSelection({
      requestedModel: 'claude-sonnet-4-6',
      apiKeyData: { id: 'key-1', name: 'All services', isActive: 'true', permissions: 'all' }
    })

    expect(report.context.blockers).toEqual([])
    expect(report.selection.selected).toMatchObject({ accountId: 'acc-1' })
  })

  it('limits group diagnostics to group members', async () => {
    const groupAccount = {
      id: 'acc-1',
      name: 'Group Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'group',
      schedulable: 'true',
      priority: '50'
    }
    const poolAccount = {
      id: 'acc-2',
      name: 'Pool Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'shared',
      schedulable: 'true',
      priority: '10'
    }
    const { scheduler } = loadScheduler(groupAccount, async () => ({ limited: false }), {
      additionalAccounts: [poolAccount],
      group: { id: 'group-1', name: 'Pro', platform: 'claude' },
      groupMembers: ['acc-1']
    })

    const report = await scheduler.explainAccountSelection({
      requestedModel: 'claude-sonnet-4-6',
      groupId: 'group-1'
    })

    expect(report.selection).toMatchObject({
      mode: 'group_priority',
      selected: { accountId: 'acc-1' }
    })
    expect(report.accounts.find((account) => account.accountId === 'acc-2').reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'outside_group' })])
    )
  })

  it('logs sequenced real-request decisions and exclusion reasons', async () => {
    const limitedAccount = {
      id: 'acc-1',
      name: 'Limited Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'shared',
      schedulable: 'true',
      priority: '10'
    }
    const healthyAccount = {
      id: 'acc-2',
      name: 'Healthy Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'shared',
      schedulable: 'true',
      priority: '20'
    }
    const { scheduler, loggerMock } = loadScheduler(
      limitedAccount,
      async (accountId) => ({ limited: accountId === 'acc-1' }),
      { additionalAccounts: [healthyAccount] }
    )
    const apiKeyData = { id: 'key-1', name: 'Key', requestId: 'request-123' }

    await scheduler.selectAccountForApiKey(apiKeyData, null, 'claude-sonnet-4-6')
    await scheduler.selectAccountForApiKey(apiKeyData, null, 'claude-sonnet-4-6')

    const decisionLogs = loggerMock.info.mock.calls.filter(([message]) =>
      message.includes('Claude scheduler decision')
    )
    expect(decisionLogs).toHaveLength(2)
    expect(decisionLogs[0]).toEqual([
      expect.stringContaining('[request-123]'),
      expect.objectContaining({
        requestId: 'request-123',
        decisionSequence: 1,
        selectedAccountId: 'acc-2',
        selectedAccountType: 'claude-official',
        excludedReasonCounts: expect.objectContaining({ rate_limited: 1 })
      })
    ])
    expect(decisionLogs[1][1]).toMatchObject({ requestId: 'request-123', decisionSequence: 2 })
  })

  it('reuses account and temporary-state reads across the four-family snapshot', async () => {
    const initialAccount = {
      id: 'acc-1',
      name: 'Claude',
      isActive: 'true',
      status: 'active',
      accountType: 'shared',
      schedulable: 'true',
      priority: '50'
    }
    const { scheduler, redis, redisClient } = loadScheduler(initialAccount, async () => ({
      limited: false
    }))

    const snapshot = await scheduler.getPoolHealthSnapshot()

    expect(snapshot.overview).toHaveLength(4)
    expect(redis.getAllClaudeAccounts).toHaveBeenCalledTimes(1)
    expect(redisClient.ttl).toHaveBeenCalledTimes(1)
  })
})
