const redis = require('../models/redis')
const logger = require('../utils/logger')
const CostCalculator = require('../utils/costCalculator')
const {
  filterAccountUsageModelStatsKeys,
  isReservedRedisEntityId
} = require('../utils/redisKeyFilter')

const VALID_PERIODS = new Set(['daily', 'weekly', 'monthly', 'total'])

const ACCOUNT_STORES = [
  {
    platform: 'claude',
    aliases: ['claude', 'claude-oauth', 'claude-official'],
    prefix: 'claude:account:',
    type: 'hash'
  },
  {
    platform: 'claude-console',
    aliases: ['claude-console', 'claude_console'],
    prefix: 'claude_console_account:',
    type: 'hash'
  },
  {
    platform: 'ccr',
    aliases: ['ccr'],
    prefix: 'ccr_account:',
    type: 'hash'
  },
  {
    platform: 'gemini',
    aliases: ['gemini'],
    prefix: 'gemini_account:',
    type: 'hash'
  },
  {
    platform: 'gemini-api',
    aliases: ['gemini-api', 'gemini_api'],
    prefix: 'gemini_api_account:',
    type: 'hash'
  },
  {
    platform: 'openai',
    aliases: ['openai'],
    prefix: 'openai:account:',
    type: 'hash'
  },
  {
    platform: 'openai-responses',
    aliases: ['openai-responses', 'openai_responses', 'responses'],
    prefix: 'openai_responses_account:',
    type: 'hash'
  },
  {
    platform: 'azure_openai',
    aliases: ['azure_openai', 'azure-openai'],
    prefix: 'azure_openai:account:',
    type: 'hash'
  },
  {
    platform: 'droid',
    aliases: ['droid'],
    prefix: 'droid:account:',
    type: 'hash'
  },
  {
    platform: 'bedrock',
    aliases: ['bedrock'],
    prefix: 'bedrock_account:',
    type: 'json'
  }
]

class AccountQuotaService {
  normalizePlatform(platform) {
    if (!platform) {
      return null
    }

    const value = String(platform).trim().toLowerCase()
    const store = ACCOUNT_STORES.find((item) => item.aliases.includes(value))
    return store ? store.platform : value
  }

  getSupportedPlatforms() {
    return ACCOUNT_STORES.map((store) => store.platform)
  }

  _normalizePeriod(period) {
    const normalized = String(period || 'daily')
      .trim()
      .toLowerCase()
    return VALID_PERIODS.has(normalized) ? normalized : 'daily'
  }

  _getStore(platform) {
    const normalized = this.normalizePlatform(platform)
    if (!normalized) {
      return null
    }
    return ACCOUNT_STORES.find((store) => store.platform === normalized) || null
  }

  async _readByStore(store, accountId) {
    const client = redis.getClientSafe()
    const key = `${store.prefix}${accountId}`

    if (store.type === 'json') {
      const raw = await client.get(key)
      if (!raw) {
        return null
      }
      try {
        return { key, store, account: JSON.parse(raw) }
      } catch (error) {
        logger.warn(`Failed to parse account json for quota: ${key}, ${error.message}`)
        return null
      }
    }

    const account = await client.hgetall(key)
    if (!account || Object.keys(account).length === 0) {
      return null
    }
    if (!account.id) {
      account.id = accountId
    }
    return { key, store, account }
  }

  async _readAccount(accountId, platform = null) {
    if (!accountId) {
      return null
    }

    const store = this._getStore(platform)
    if (store) {
      const matched = await this._readByStore(store, accountId)
      if (matched) {
        return matched
      }
    }

    for (const candidate of ACCOUNT_STORES) {
      if (store && candidate.platform === store.platform) {
        continue
      }
      const matched = await this._readByStore(candidate, accountId)
      if (matched) {
        return matched
      }
    }

    return null
  }

  async _writeFields(record, fields) {
    const client = redis.getClientSafe()
    const { key, store, account } = record

    if (store.type === 'json') {
      const updated = { ...account, ...fields, updatedAt: new Date().toISOString() }
      await client.set(key, JSON.stringify(updated))
      record.account = updated
      return updated
    }

    const normalizedFields = {}
    for (const [field, value] of Object.entries(fields)) {
      if (value === null || value === undefined) {
        normalizedFields[field] = ''
      } else if (typeof value === 'boolean' || typeof value === 'number') {
        normalizedFields[field] = value.toString()
      } else {
        normalizedFields[field] = value
      }
    }

    await client.hset(key, normalizedFields)
    record.account = { ...account, ...normalizedFields }
    return record.account
  }

  _getQuotaConfig(account = {}) {
    const rawLimit =
      account.dailyQuota !== undefined && account.dailyQuota !== ''
        ? account.dailyQuota
        : account.quotaLimit
    const quotaLimit = Number(rawLimit || 0)

    return {
      enabled: Number.isFinite(quotaLimit) && quotaLimit > 0,
      quotaLimit: Number.isFinite(quotaLimit) && quotaLimit > 0 ? quotaLimit : 0,
      quotaPeriod: this._normalizePeriod(account.quotaPeriod || 'daily'),
      quotaResetTime: account.quotaResetTime || '00:00',
      quotaStoppedAt: account.quotaStoppedAt || null,
      quotaAutoStopped: account.quotaAutoStopped === true || account.quotaAutoStopped === 'true',
      quotaLastPeriodKey: account.quotaLastPeriodKey || ''
    }
  }

  _formatDate(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
      date.getUTCDate()
    ).padStart(2, '0')}`
  }

  _getTzNow() {
    return redis.getDateInTimezone(new Date())
  }

  _getCurrentMonth() {
    const tzNow = this._getTzNow()
    return `${tzNow.getUTCFullYear()}-${String(tzNow.getUTCMonth() + 1).padStart(2, '0')}`
  }

  _getIsoWeekKey(date) {
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    const dayNumber = target.getUTCDay() || 7
    target.setUTCDate(target.getUTCDate() + 4 - dayNumber)
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
    const week = Math.ceil(((target - yearStart) / 86400000 + 1) / 7)
    return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
  }

  _getCurrentWeekDates() {
    const tzNow = this._getTzNow()
    const dayNumber = tzNow.getUTCDay() || 7
    const monday = new Date(tzNow)
    monday.setUTCDate(tzNow.getUTCDate() - dayNumber + 1)

    const dates = []
    for (let index = 0; index < 7; index++) {
      const date = new Date(monday)
      date.setUTCDate(monday.getUTCDate() + index)
      dates.push(this._formatDate(date))
    }
    return dates
  }

  _buildUsageFromHash(data = {}) {
    return {
      input_tokens: parseInt(data.inputTokens || data.totalInputTokens || 0, 10) || 0,
      output_tokens: parseInt(data.outputTokens || data.totalOutputTokens || 0, 10) || 0,
      cache_creation_input_tokens:
        parseInt(data.cacheCreateTokens || data.totalCacheCreateTokens || 0, 10) || 0,
      cache_read_input_tokens:
        parseInt(data.cacheReadTokens || data.totalCacheReadTokens || 0, 10) || 0
    }
  }

  async _sumModelKeys(keys, period) {
    const client = redis.getClientSafe()
    const filteredKeys = period ? filterAccountUsageModelStatsKeys(keys, period) : keys
    let totalCost = 0
    let requests = 0
    let allTokens = 0

    for (const key of filteredKeys) {
      const parts = key.split(':')
      const model = parts[4] || 'unknown'
      const data = await client.hgetall(key)
      if (!data || Object.keys(data).length === 0) {
        continue
      }

      const usage = this._buildUsageFromHash(data)
      const costResult = CostCalculator.calculateCost(usage, model)
      totalCost += costResult.costs.total || 0
      requests += parseInt(data.requests || 0, 10) || 0
      allTokens +=
        parseInt(data.allTokens || 0, 10) ||
        usage.input_tokens +
          usage.output_tokens +
          usage.cache_creation_input_tokens +
          usage.cache_read_input_tokens
    }

    return { totalCost, requests, allTokens, usedModelBreakdown: filteredKeys.length > 0 }
  }

  async _fallbackAggregateCost(accountId, aggregateKeys) {
    const client = redis.getClientSafe()
    let totalCost = 0
    let requests = 0
    let allTokens = 0

    for (const key of aggregateKeys) {
      const data = await client.hgetall(key)
      if (!data || Object.keys(data).length === 0) {
        continue
      }

      const usage = this._buildUsageFromHash(data)
      const costResult = CostCalculator.calculateCost(usage, 'unknown')
      totalCost += costResult.costs.total || 0
      requests += parseInt(data.requests || data.totalRequests || 0, 10) || 0
      allTokens +=
        parseInt(data.allTokens || data.totalAllTokens || 0, 10) ||
        usage.input_tokens +
          usage.output_tokens +
          usage.cache_creation_input_tokens +
          usage.cache_read_input_tokens
    }

    logger.debug(`Account quota fallback aggregate cost used for ${accountId}`)
    return { totalCost, requests, allTokens, usedModelBreakdown: false }
  }

  async getPeriodUsage(accountId, quotaPeriod = 'daily') {
    const client = redis.getClientSafe()
    const period = this._normalizePeriod(quotaPeriod)

    if (period === 'daily') {
      const date = redis.getDateStringInTimezone()
      const modelKeys = await client.keys(`account_usage:model:daily:${accountId}:*:${date}`)
      const result = await this._sumModelKeys(modelKeys, 'daily')
      if (!result.usedModelBreakdown) {
        return {
          ...(await this._fallbackAggregateCost(accountId, [
            `account_usage:daily:${accountId}:${date}`
          ])),
          period,
          periodKey: date
        }
      }
      return { ...result, period, periodKey: date }
    }

    if (period === 'weekly') {
      const dates = this._getCurrentWeekDates()
      let modelKeys = []
      for (const date of dates) {
        const keys = await client.keys(`account_usage:model:daily:${accountId}:*:${date}`)
        modelKeys = modelKeys.concat(keys)
      }
      const result = await this._sumModelKeys(modelKeys, 'daily')
      if (!result.usedModelBreakdown) {
        const aggregateKeys = dates.map((date) => `account_usage:daily:${accountId}:${date}`)
        return {
          ...(await this._fallbackAggregateCost(accountId, aggregateKeys)),
          period,
          periodKey: this._getIsoWeekKey(this._getTzNow())
        }
      }
      return { ...result, period, periodKey: this._getIsoWeekKey(this._getTzNow()) }
    }

    if (period === 'monthly') {
      const month = this._getCurrentMonth()
      const modelKeys = await client.keys(`account_usage:model:monthly:${accountId}:*:${month}`)
      const result = await this._sumModelKeys(modelKeys, 'monthly')
      if (!result.usedModelBreakdown) {
        return {
          ...(await this._fallbackAggregateCost(accountId, [
            `account_usage:monthly:${accountId}:${month}`
          ])),
          period,
          periodKey: month
        }
      }
      return { ...result, period, periodKey: month }
    }

    const modelKeys = await client.keys(`account_usage:model:monthly:${accountId}:*`)
    const result = await this._sumModelKeys(modelKeys, 'monthly')
    if (!result.usedModelBreakdown) {
      return {
        ...(await this._fallbackAggregateCost(accountId, [`account_usage:${accountId}`])),
        period,
        periodKey: 'total'
      }
    }
    return { ...result, period, periodKey: 'total' }
  }

  _buildStatus(record, config, usage, state = 'active') {
    const used = Number(usage?.totalCost || 0)
    const limit = Number(config.quotaLimit || 0)
    const remaining = limit > 0 ? Math.max(0, limit - used) : null

    return {
      success: true,
      accountId: record.account.id,
      platform: record.store.platform,
      state,
      config,
      usage: {
        period: usage.period,
        periodKey: usage.periodKey,
        cost: Math.round(used * 1_000_000) / 1_000_000,
        requests: usage.requests || 0,
        allTokens: usage.allTokens || 0,
        remaining,
        percentage: limit > 0 ? Math.round((used / limit) * 10000) / 100 : 0
      },
      stopped: {
        quotaStoppedAt: record.account.quotaStoppedAt || null,
        quotaAutoStopped: config.quotaAutoStopped
      }
    }
  }

  async _stopAccount(record, config, usage) {
    const used = Number(usage.totalCost || 0)
    const limit = Number(config.quotaLimit || 0)
    const message = `Quota exceeded (${config.quotaPeriod}): $${used.toFixed(2)} / $${limit.toFixed(
      2
    )}`

    await this._writeFields(record, {
      isActive: false,
      schedulable: false,
      status: 'quota_exceeded',
      errorMessage: message,
      quotaStoppedAt: new Date().toISOString(),
      quotaAutoStopped: true,
      quotaLastPeriodKey: usage.periodKey,
      dailyUsage: used
    })

    logger.warn(
      `💰 Account quota exceeded: ${record.store.platform}:${record.account.id} ${message}`
    )

    try {
      const webhookNotifier = require('../utils/webhookNotifier')
      await webhookNotifier.sendAccountAnomalyNotification({
        accountId: record.account.id,
        accountName: record.account.name || record.account.email || record.account.id,
        platform: record.store.platform,
        status: 'quota_exceeded',
        errorCode: 'ACCOUNT_QUOTA_EXCEEDED',
        reason: message,
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      logger.warn(`Failed to send quota exceeded webhook: ${error.message}`)
    }
  }

  async _recoverAccount(record, usage) {
    await this._writeFields(record, {
      isActive: true,
      schedulable: true,
      status: 'active',
      errorMessage: '',
      quotaStoppedAt: '',
      quotaAutoStopped: '',
      quotaLastPeriodKey: usage.periodKey
    })

    logger.info(`✅ Account quota restored: ${record.store.platform}:${record.account.id}`)
  }

  async getQuotaStatus(accountId, platform = null) {
    const record = await this._readAccount(accountId, platform)
    if (!record) {
      return { success: false, error: 'Account not found' }
    }

    const config = this._getQuotaConfig(record.account)
    const usage = await this.getPeriodUsage(record.account.id, config.quotaPeriod)
    return this._buildStatus(record, config, usage, config.enabled ? 'active' : 'disabled')
  }

  async updateQuotaConfig(accountId, platform, payload = {}) {
    const record = await this._readAccount(accountId, platform)
    if (!record) {
      return { success: false, error: 'Account not found' }
    }

    const quotaLimit = Number(payload.quotaLimit ?? payload.dailyQuota ?? 0)
    if (!Number.isFinite(quotaLimit) || quotaLimit < 0) {
      return { success: false, error: '额度必须是大于等于 0 的数字' }
    }

    const quotaPeriod = this._normalizePeriod(payload.quotaPeriod || 'daily')
    const quotaResetTime = payload.quotaResetTime || '00:00'
    const usage = await this.getPeriodUsage(record.account.id, quotaPeriod)

    await this._writeFields(record, {
      quotaLimit,
      quotaPeriod,
      quotaResetTime,
      // 兼容旧字段和已有余额展示逻辑。
      dailyQuota: quotaLimit,
      lastResetDate: redis.getDateStringInTimezone(),
      quotaLastPeriodKey: usage.periodKey
    })

    return this.checkAndEnforceQuota(accountId, record.store.platform)
  }

  async checkAndEnforceQuota(accountId, platform = null) {
    const record = await this._readAccount(accountId, platform)
    if (!record) {
      return { success: false, error: 'Account not found' }
    }

    const config = this._getQuotaConfig(record.account)
    if (!config.enabled && !config.quotaAutoStopped) {
      return this._buildStatus(
        record,
        config,
        {
          period: config.quotaPeriod,
          periodKey: '',
          totalCost: 0,
          requests: 0,
          allTokens: 0
        },
        'disabled'
      )
    }

    const usage = await this.getPeriodUsage(record.account.id, config.quotaPeriod)
    const used = Number(usage.totalCost || 0)
    const limit = Number(config.quotaLimit || 0)

    if (!config.enabled) {
      if (config.quotaAutoStopped) {
        await this._recoverAccount(record, usage)
        return this._buildStatus(record, config, usage, 'recovered')
      }
      return this._buildStatus(record, config, usage, 'disabled')
    }

    if (config.quotaAutoStopped && config.quotaLastPeriodKey !== usage.periodKey && used < limit) {
      await this._recoverAccount(record, usage)
      return this._buildStatus(record, config, usage, 'recovered')
    }

    if (used >= limit) {
      if (!config.quotaAutoStopped || config.quotaLastPeriodKey !== usage.periodKey) {
        await this._stopAccount(record, config, usage)
      }
      return this._buildStatus(record, config, usage, 'exceeded')
    }

    if (config.quotaAutoStopped) {
      await this._recoverAccount(record, usage)
      return this._buildStatus(record, config, usage, 'recovered')
    }

    return this._buildStatus(record, config, usage, 'active')
  }

  async refreshQuotaStates() {
    const client = redis.getClientSafe()
    const stats = { checked: 0, stopped: 0, recovered: 0, errors: [] }

    for (const store of ACCOUNT_STORES) {
      const keys = await client.keys(`${store.prefix}*`)
      for (const key of keys) {
        const accountId = key.replace(store.prefix, '')
        if (!accountId || accountId.includes(':') || isReservedRedisEntityId(accountId)) {
          continue
        }

        try {
          const result = await this.checkAndEnforceQuota(accountId, store.platform)
          if (!result.success || (!result.config.enabled && !result.stopped.quotaAutoStopped)) {
            continue
          }

          stats.checked++
          if (result.state === 'exceeded') {
            stats.stopped++
          } else if (result.state === 'recovered') {
            stats.recovered++
          }
        } catch (error) {
          stats.errors.push({
            platform: store.platform,
            accountId,
            error: error.message
          })
        }
      }
    }

    return stats
  }
}

module.exports = new AccountQuotaService()
