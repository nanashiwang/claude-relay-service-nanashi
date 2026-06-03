describe('AccountQuotaService Codex quota windows', () => {
  function loadService(initialAccount = {}, usageByKey = {}) {
    jest.resetModules()

    const accountKey = `openai:account:${initialAccount.id || 'acc-1'}`
    let currentAccount = {
      id: 'acc-1',
      name: 'OpenAI 1',
      dailyQuota: '0',
      quotaPeriod: 'weekly',
      quotaLimitMode: 'cost',
      isActive: 'true',
      schedulable: 'true',
      status: 'active',
      ...initialAccount
    }

    const redisClient = {
      hgetall: jest.fn(async (key) => {
        if (key === accountKey) {
          return { ...currentAccount }
        }
        return usageByKey[key] ? { ...usageByKey[key] } : {}
      }),
      hset: jest.fn(async (key, fields) => {
        if (key === accountKey) {
          currentAccount = { ...currentAccount, ...fields }
        }
        return 1
      }),
      keys: jest.fn(async (pattern) => {
        const source = Object.keys(usageByKey)
        if (pattern.includes('account_usage:model:hourly')) {
          const matcher = new RegExp(
            `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`
          )
          return source.filter((key) => matcher.test(key))
        }
        return []
      })
    }

    jest.doMock('../src/models/redis', () => ({
      getClientSafe: jest.fn(() => redisClient),
      getDateStringInTimezone: jest.fn((date = new Date()) => {
        const value = new Date(date)
        return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(
          2,
          '0'
        )}-${String(value.getUTCDate()).padStart(2, '0')}`
      }),
      getDateInTimezone: jest.fn((date = new Date()) => new Date(date)),
      getHourInTimezone: jest.fn((date = new Date()) => new Date(date).getUTCHours())
    }))
    jest.doMock('../src/utils/logger', () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }))
    jest.doMock('../src/utils/webhookNotifier', () => ({
      sendAccountAnomalyNotification: jest.fn(async () => undefined)
    }))
    jest.doMock('../src/utils/costCalculator', () => ({
      calculateCost: jest.fn((usage) => ({
        costs: {
          total:
            (Number(usage.input_tokens || 0) +
              Number(usage.output_tokens || 0) +
              Number(usage.cache_creation_input_tokens || 0) +
              Number(usage.cache_read_input_tokens || 0)) /
            1000
        }
      }))
    }))

    let service
    jest.isolateModules(() => {
      service = require('../src/services/accountQuotaService')
    })

    return {
      service,
      redisClient,
      getAccount: () => ({ ...currentAccount })
    }
  }

  afterEach(() => {
    jest.restoreAllMocks()
    jest.resetModules()
  })

  it('uses Codex secondary percent window for weekly OpenAI quota', async () => {
    const { service, getAccount } = loadService({
      dailyQuota: '90',
      quotaPeriod: 'weekly',
      quotaLimitMode: 'percent',
      codexSecondaryUsedPercent: '91',
      codexSecondaryResetAfterSeconds: '3600',
      codexSecondaryWindowMinutes: '10080',
      codexUsageUpdatedAt: new Date().toISOString()
    })

    const result = await service.checkAndEnforceQuota('acc-1', 'openai')

    expect(result.state).toBe('exceeded')
    expect(result.usage.period).toBe('weekly')
    expect(result.usage.value).toBe(91)
    expect(getAccount().quotaStoppedPeriod).toBe('weekly')
    expect(getAccount().errorMessage).toContain('91.00% / 90.00%')
  })

  it('can enforce a separate Codex 5h percent quota', async () => {
    const { service, getAccount } = loadService({
      dailyQuota: '0',
      quotaPeriod: 'weekly',
      codexFiveHourQuotaLimit: '80',
      codexFiveHourQuotaMode: 'percent',
      codexPrimaryUsedPercent: '82',
      codexPrimaryResetAfterSeconds: '600',
      codexPrimaryWindowMinutes: '300',
      codexUsageUpdatedAt: new Date().toISOString()
    })

    const result = await service.checkAndEnforceQuota('acc-1', 'openai')
    const fiveHourRule = result.rules.find((rule) => rule.id === 'codex_5h')

    expect(result.state).toBe('exceeded')
    expect(fiveHourRule.exceeded).toBe(true)
    expect(fiveHourRule.usage.period).toBe('codex_5h')
    expect(getAccount().quotaStoppedRule).toBe('codex_5h')
  })

  it('does not stop weekly percent quota when Codex window headers are not available', async () => {
    const { service, getAccount } = loadService({
      dailyQuota: '90',
      quotaPeriod: 'weekly',
      quotaLimitMode: 'percent'
    })

    const result = await service.checkAndEnforceQuota('acc-1', 'openai')

    expect(result.state).toBe('active')
    expect(result.usage.periodKey).toBe('weekly:pending')
    expect(result.usage.value).toBeNull()
    expect(getAccount().status).toBe('active')
  })
})
