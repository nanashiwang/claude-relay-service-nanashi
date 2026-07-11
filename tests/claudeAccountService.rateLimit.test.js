describe('ClaudeAccountService transient 429 handling', () => {
  function loadService(initialAccount = {}, options = {}) {
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
        hdel: jest.fn(async () => 0),
        ttl: jest.fn(async () => options.tempUnavailableTtl ?? -2),
        del: jest.fn(async () => 1)
      },
      getClientSafe: jest.fn(() => redisMock.client)
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
      isOpus45OrNewer: jest.fn(() => false),
      getRateLimitModelFamily: jest.fn((model) => {
        const normalized = typeof model === 'string' ? model.toLowerCase() : ''
        return ['opus', 'sonnet', 'haiku', 'fable'].find((family) => normalized.includes(family))
      }),
      RATE_LIMITED_MODEL_FAMILIES: ['opus', 'sonnet', 'haiku', 'fable']
    }))
    jest.doMock(
      '../src/utils/lruCache',
      () =>
        class MockLRUCache {
          cleanup() {}
          getStats() {
            return {}
          }
        }
    )
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

  it('skips rate-limit state for 429 without reset timestamp', async () => {
    const { service, getAccount, redisMock, webhookNotifier } = loadService()

    const result = await service.markAccountRateLimited('acc-1', null, null)

    expect(result).toEqual({ success: true, skipped: true })
    expect(getAccount().schedulable).toBe('true')
    expect(getAccount().rateLimitStatus).toBeUndefined()
    expect(getAccount().rateLimitEndAt).toBeUndefined()
    expect(getAccount().rateLimitAutoStopped).toBeUndefined()
    expect(redisMock.setClaudeAccount).not.toHaveBeenCalled()
    expect(webhookNotifier.sendAccountAnomalyNotification).not.toHaveBeenCalled()
  })

  it('skips rate-limit state entirely when 429 auto cooldown is disabled', async () => {
    const { service, getAccount, redisMock } = loadService({ rateLimitDuration: '0' })

    await service.markAccountRateLimited('acc-1', 'session-1', null)

    expect(getAccount().schedulable).toBe('true')
    expect(getAccount().rateLimitStatus).toBeUndefined()
    expect(getAccount().rateLimitEndAt).toBeUndefined()
    expect(getAccount().rateLimitAutoStopped).toBeUndefined()
    expect(redisMock.deleteSessionAccountMapping).not.toHaveBeenCalled()
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

  it('stores model bucket rate limits without disabling the whole account', async () => {
    const { service, getAccount } = loadService()
    const resetTimestamp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600

    await service.markAccountModelRateLimited('acc-1', 'weekly_fable', resetTimestamp, {
      requestedModel: 'claude-fable-5'
    })

    const account = getAccount()
    expect(account.schedulable).toBe('true')
    expect(account.rateLimitStatus).toBeUndefined()
    expect(account.rateLimitAutoStopped).toBeUndefined()
    const buckets = JSON.parse(account.claudeRateLimitBuckets)
    expect(buckets.weekly_fable.requestedModel).toBe('claude-fable-5')
    expect(buckets.weekly_fable.resetAt).toBe(new Date(resetTimestamp * 1000).toISOString())
  })

  it('classifies Fable by account reset time before using the 6h fallback', () => {
    const { service } = loadService()
    const resetTimestamp = Math.floor((Date.now() + 2 * 60 * 60 * 1000) / 1000)
    const resetAt = new Date(resetTimestamp * 1000).toISOString()

    expect(
      service.classifyClaudeRateLimitBucket({
        requestedModel: 'claude-fable-5',
        headers: {},
        rateLimitResetTimestamp: resetTimestamp,
        accountData: {
          claudeSevenDayResetsAt: resetAt,
          claudeFiveHourResetsAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()
        }
      })
    ).toBe('weekly_fable')
  })

  it('classifies Sonnet into its own weekly bucket', () => {
    const { service } = loadService()
    const resetTimestamp = Math.floor((Date.now() + 2 * 60 * 60 * 1000) / 1000)
    const resetAt = new Date(resetTimestamp * 1000).toISOString()

    expect(
      service.classifyClaudeRateLimitBucket({
        requestedModel: 'claude-sonnet-4-6',
        headers: {},
        rateLimitResetTimestamp: resetTimestamp,
        accountData: {
          claudeSevenDayResetsAt: resetAt,
          claudeFiveHourResetsAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()
        }
      })
    ).toBe('weekly_sonnet')
  })

  it('does not treat allowed rate-limit statuses as rejected', () => {
    const { service } = loadService()

    expect(
      service.classifyClaudeRateLimitBucket({
        requestedModel: 'claude-sonnet-4',
        headers: {
          'anthropic-ratelimit-unified-5h-status': 'not_limited',
          'anthropic-ratelimit-unified-7d-status': 'within_limit'
        }
      })
    ).toBeNull()
  })

  it('treats legacy non-Opus buckets as Fable-only and lets other weekly models through', async () => {
    const resetTimestamp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600
    const { service } = loadService({
      claudeRateLimitBuckets: JSON.stringify({
        weekly_non_opus: {
          bucket: 'weekly_non_opus',
          resetAt: new Date(resetTimestamp * 1000).toISOString(),
          rateLimitedAt: new Date().toISOString()
        }
      })
    })

    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-fable-5')).resolves.toBe(
      true
    )
    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-sonnet-4-6')).resolves.toBe(
      false
    )
    await expect(
      service.isAccountRateLimitedForModel('acc-1', 'claude-haiku-4-5-20251001')
    ).resolves.toBe(false)
    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-sonnet-5')).resolves.toBe(
      false
    )
    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-opus-4-8')).resolves.toBe(
      false
    )
  })

  it('blocks standard weekly models without blocking Fable or Opus buckets', async () => {
    const resetTimestamp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600
    const { service } = loadService({
      claudeRateLimitBuckets: JSON.stringify({
        weekly_standard: {
          bucket: 'weekly_standard',
          resetAt: new Date(resetTimestamp * 1000).toISOString(),
          rateLimitedAt: new Date().toISOString()
        }
      })
    })

    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-sonnet-4-6')).resolves.toBe(
      true
    )
    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-haiku-4-5')).resolves.toBe(
      true
    )
    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-fable-5')).resolves.toBe(
      false
    )
    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-opus-4-8')).resolves.toBe(
      false
    )
  })

  it('keeps Sonnet and Haiku weekly limits independent', async () => {
    const resetAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    const { service } = loadService({
      claudeRateLimitBuckets: JSON.stringify({
        weekly_sonnet: { bucket: 'weekly_sonnet', resetAt },
        weekly_haiku: { bucket: 'weekly_haiku', resetAt }
      })
    })

    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-sonnet-4-6')).resolves.toBe(
      true
    )
    await service.clearAccountModelRateLimit('acc-1', 'weekly_sonnet')
    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-sonnet-4-6')).resolves.toBe(
      false
    )
    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-haiku-4-5')).resolves.toBe(
      true
    )
    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-opus-4-8')).resolves.toBe(
      false
    )
  })

  it('blocks every model when the 5h bucket is active', async () => {
    const resetTimestamp = Math.floor(Date.now() / 1000) + 5 * 3600
    const { service } = loadService({
      claudeRateLimitBuckets: JSON.stringify({
        five_hour: {
          bucket: 'five_hour',
          resetAt: new Date(resetTimestamp * 1000).toISOString(),
          rateLimitedAt: new Date().toISOString()
        }
      })
    })

    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-sonnet-4')).resolves.toBe(
      true
    )
    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-opus-4-8')).resolves.toBe(
      true
    )
  })

  it('migrates legacy weekly global limits into Fable-only buckets', async () => {
    const resetTimestamp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600
    const { service, getAccount } = loadService({
      schedulable: 'false',
      rateLimitStatus: 'limited',
      rateLimitedAt: new Date().toISOString(),
      rateLimitEndAt: new Date(resetTimestamp * 1000).toISOString(),
      rateLimitAutoStopped: 'true',
      claudeSevenDayUtilization: '80',
      claudeSevenDayOpusUtilization: '4'
    })

    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-opus-4-8')).resolves.toBe(
      false
    )

    const account = getAccount()
    expect(account.schedulable).toBe('true')
    expect(account.rateLimitStatus).toBeUndefined()
    expect(account.rateLimitAutoStopped).toBeUndefined()
    const buckets = JSON.parse(account.claudeRateLimitBuckets)
    expect(buckets.weekly_fable).toBeTruthy()

    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-fable-5')).resolves.toBe(
      true
    )
    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-sonnet-4-6')).resolves.toBe(
      false
    )
  })

  it('does not migrate a near-reset weekly legacy limit into the 5h bucket', async () => {
    const resetTimestamp = Math.floor(Date.now() / 1000) + 2 * 3600
    const resetAt = new Date(resetTimestamp * 1000).toISOString()
    const { service, getAccount } = loadService({
      schedulable: 'false',
      rateLimitStatus: 'limited',
      rateLimitedAt: new Date().toISOString(),
      rateLimitEndAt: resetAt,
      rateLimitAutoStopped: 'true',
      claudeSevenDayResetsAt: resetAt,
      claudeFiveHourResetsAt: new Date((resetTimestamp + 3600) * 1000).toISOString(),
      claudeSevenDayUtilization: '99',
      claudeSevenDayOpusUtilization: '10'
    })

    await expect(service.isAccountRateLimitedForModel('acc-1', 'claude-opus-4-8')).resolves.toBe(
      false
    )

    const buckets = JSON.parse(getAccount().claudeRateLimitBuckets)
    expect(buckets.weekly_fable).toBeTruthy()
    expect(buckets.five_hour).toBeUndefined()
  })

  it('clears current rate-limit state when 429 auto cooldown is turned off in edit mode', async () => {
    const { service, getAccount } = loadService({
      schedulable: 'false',
      rateLimitDuration: '5',
      rateLimitStatus: 'limited',
      rateLimitedAt: new Date().toISOString(),
      rateLimitEndAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      rateLimitAutoStopped: 'true'
    })

    await service.updateAccount('acc-1', { rateLimitDuration: 0 })

    expect(getAccount().schedulable).toBe('true')
    expect(getAccount().rateLimitStatus).toBeUndefined()
    expect(getAccount().rateLimitEndAt).toBeUndefined()
    expect(getAccount().rateLimitAutoStopped).toBeUndefined()
  })

  it('reports a family-only limit without marking the whole account unavailable', async () => {
    const resetAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    const { service } = loadService({
      isActive: 'true',
      status: 'active',
      accessToken: 'encrypted-token',
      refreshToken: 'encrypted-refresh-token',
      expiresAt: String(Date.now() + 24 * 60 * 60 * 1000),
      claudeRateLimitBuckets: JSON.stringify({
        weekly_sonnet: {
          bucket: 'weekly_sonnet',
          resetAt,
          rateLimitedAt: new Date().toISOString(),
          requestedModel: 'claude-sonnet-4-6'
        }
      })
    })

    const status = await service.getAccountOperationalStatus('acc-1')

    expect(status.availability).toMatchObject({
      scope: 'model',
      accountUnavailable: false,
      partialModelUnavailable: true,
      modelLimitedCount: 1
    })
    expect(status.modelRateLimits.sonnet).toMatchObject({
      isRateLimited: true,
      bucket: 'weekly_sonnet',
      resetAt
    })
    expect(status.modelRateLimits.haiku.isRateLimited).toBe(false)
    expect(status.token.status).toBe('healthy')
  })

  it('maps the shared five-hour bucket to an account-wide limit', async () => {
    const resetAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    const { service } = loadService({
      isActive: 'true',
      status: 'active',
      accessToken: 'encrypted-token',
      expiresAt: String(Date.now() + 24 * 60 * 60 * 1000),
      claudeRateLimitBuckets: JSON.stringify({
        five_hour: {
          bucket: 'five_hour',
          resetAt,
          rateLimitedAt: new Date().toISOString()
        }
      })
    })

    const status = await service.getAccountOperationalStatus('acc-1')

    expect(status.availability).toMatchObject({
      scope: 'account',
      accountUnavailable: true,
      modelLimitedCount: 4
    })
    expect(status.availability.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'five_hour_rate_limited' })])
    )
    expect(Object.values(status.modelRateLimits)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bucket: 'five_hour', isRateLimited: true, resetAt })
      ])
    )
  })

  it('keeps a valid token refresh failure separate from account availability', async () => {
    const { service } = loadService({
      isActive: 'true',
      status: 'active',
      accessToken: 'encrypted-token',
      refreshToken: 'encrypted-refresh-token',
      expiresAt: String(Date.now() + 24 * 60 * 60 * 1000),
      lastRefreshAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      lastRefreshErrorAt: new Date().toISOString(),
      errorMessage: 'refresh request failed'
    })

    const status = await service.getAccountOperationalStatus('acc-1')

    expect(status.availability.scope).toBe('available')
    expect(status.availability.reasons).toEqual([])
    expect(status.token).toMatchObject({ status: 'refresh_failed', isExpired: false })
  })

  it('maps the legacy shared standard bucket to Sonnet and Haiku only', async () => {
    const resetAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
    const { service } = loadService({
      isActive: 'true',
      status: 'active',
      accessToken: 'encrypted-token',
      expiresAt: String(Date.now() + 24 * 60 * 60 * 1000),
      claudeRateLimitBuckets: JSON.stringify({
        weekly_standard: {
          bucket: 'weekly_standard',
          resetAt,
          rateLimitedAt: new Date().toISOString()
        }
      })
    })

    const status = await service.getAccountOperationalStatus('acc-1')

    expect(status.availability).toMatchObject({ scope: 'model', modelLimitedCount: 2 })
    expect(status.modelRateLimits.sonnet.isRateLimited).toBe(true)
    expect(status.modelRateLimits.haiku.isRateLimited).toBe(true)
    expect(status.modelRateLimits.opus.isRateLimited).toBe(false)
    expect(status.modelRateLimits.fable.isRateLimited).toBe(false)
  })

  it('reports temp-unavailable and refresh failures separately', async () => {
    const { service } = loadService(
      {
        isActive: 'true',
        status: 'active',
        accessToken: 'encrypted-token',
        refreshToken: 'encrypted-refresh-token',
        expiresAt: String(Date.now() + 24 * 60 * 60 * 1000),
        lastRefreshAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        lastRefreshErrorAt: new Date().toISOString(),
        errorMessage: 'refresh request failed'
      },
      { tempUnavailableTtl: 120 }
    )

    const status = await service.getAccountOperationalStatus('acc-1')

    expect(status.availability.scope).toBe('account')
    expect(status.availability.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'temp_unavailable' })])
    )
    expect(status.tempUnavailable).toMatchObject({ active: true, ttlSeconds: 120 })
    expect(status.token).toMatchObject({ status: 'refresh_failed', refreshFailed: true })
  })

  it('clears only the temporary cooldown key', async () => {
    const { service, redisMock } = loadService({ isActive: 'true', status: 'active' })

    await expect(service.clearAccountTempUnavailable('acc-1')).resolves.toEqual({
      success: true,
      cleared: true
    })
    expect(redisMock.client.del).toHaveBeenCalledWith('temp_unavailable:claude-official:acc-1')
    expect(redisMock.client.hdel).not.toHaveBeenCalled()
  })
})

describe('Claude rate-limit model family parsing', () => {
  it('maps supported model names after removing vendor prefixes', () => {
    const { getRateLimitModelFamily, RATE_LIMITED_MODEL_FAMILIES } = jest.requireActual(
      '../src/utils/modelHelper'
    )

    expect(RATE_LIMITED_MODEL_FAMILIES).toEqual(['opus', 'sonnet', 'haiku', 'fable'])
    expect(getRateLimitModelFamily('ccr,claude-sonnet-4-6')).toBe('sonnet')
    expect(getRateLimitModelFamily('claude-haiku-4-5')).toBe('haiku')
    expect(getRateLimitModelFamily('deepseek-chat')).toBeNull()
  })
})
