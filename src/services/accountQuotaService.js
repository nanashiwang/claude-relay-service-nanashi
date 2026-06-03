const redis = require('../models/redis')
const logger = require('../utils/logger')
const CostCalculator = require('../utils/costCalculator')
const {
  filterAccountUsageModelStatsKeys,
  isReservedRedisEntityId
} = require('../utils/redisKeyFilter')

const VALID_PERIODS = new Set(['daily', 'weekly', 'monthly', 'total', 'codex_5h'])
const VALID_LIMIT_MODES = new Set(['cost', 'percent'])
const CODEX_WEEKLY_MINUTES = 7 * 24 * 60
const CODEX_FIVE_HOUR_MINUTES = 5 * 60
const CODEX_WINDOW_PERIODS = new Set(['weekly', 'codex_5h'])

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

  _normalizeLimitMode(mode) {
    const normalized = String(mode || 'cost')
      .trim()
      .toLowerCase()
    return VALID_LIMIT_MODES.has(normalized) ? normalized : 'cost'
  }

  _isOpenAICodexWindow(platform, period) {
    return this.normalizePlatform(platform) === 'openai' && CODEX_WINDOW_PERIODS.has(period)
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
    const codexFiveHourQuotaLimit = Number(account.codexFiveHourQuotaLimit || 0)

    return {
      id: 'primary',
      label: '账号额度',
      enabled: Number.isFinite(quotaLimit) && quotaLimit > 0,
      quotaLimit: Number.isFinite(quotaLimit) && quotaLimit > 0 ? quotaLimit : 0,
      quotaPeriod: this._normalizePeriod(account.quotaPeriod || 'daily'),
      quotaLimitMode: this._normalizeLimitMode(account.quotaLimitMode || 'cost'),
      quotaResetTime: account.quotaResetTime || '00:00',
      quotaStoppedAt: account.quotaStoppedAt || null,
      quotaAutoStopped: account.quotaAutoStopped === true || account.quotaAutoStopped === 'true',
      quotaLastPeriodKey: account.quotaLastPeriodKey || '',
      quotaStoppedPeriod: account.quotaStoppedPeriod || '',
      codexFiveHourQuotaLimit:
        Number.isFinite(codexFiveHourQuotaLimit) && codexFiveHourQuotaLimit > 0
          ? codexFiveHourQuotaLimit
          : 0,
      codexFiveHourQuotaMode: this._normalizeLimitMode(
        account.codexFiveHourQuotaMode || account.codexFiveHourQuotaLimitMode || 'cost'
      )
    }
  }

  _getCodexFiveHourQuotaConfig(account = {}, platform = null) {
    if (this.normalizePlatform(platform) !== 'openai') {
      return null
    }

    const quotaLimit = Number(account.codexFiveHourQuotaLimit || 0)
    return {
      id: 'codex_5h',
      label: 'Codex 5h 限制',
      enabled: Number.isFinite(quotaLimit) && quotaLimit > 0,
      quotaLimit: Number.isFinite(quotaLimit) && quotaLimit > 0 ? quotaLimit : 0,
      quotaPeriod: 'codex_5h',
      quotaLimitMode: this._normalizeLimitMode(
        account.codexFiveHourQuotaMode || account.codexFiveHourQuotaLimitMode || 'cost'
      ),
      quotaResetTime: account.quotaResetTime || '00:00',
      quotaStoppedAt: account.quotaStoppedAt || null,
      quotaAutoStopped: account.quotaAutoStopped === true || account.quotaAutoStopped === 'true',
      quotaLastPeriodKey: account.quotaLastPeriodKey || '',
      quotaStoppedPeriod: account.quotaStoppedPeriod || ''
    }
  }

  _getEnabledQuotaConfigs(account = {}, platform = null) {
    const mainConfig = this._getQuotaConfig(account)
    const configs = mainConfig.enabled ? [mainConfig] : []
    const codexFiveHourConfig = this._getCodexFiveHourQuotaConfig(account, platform)

    if (codexFiveHourConfig?.enabled) {
      configs.push(codexFiveHourConfig)
    }

    return { mainConfig, configs }
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

  _getHourKeyInTimezone(date) {
    const dateKey = redis.getDateStringInTimezone(date)
    const tzDate = redis.getDateInTimezone(date)
    return `${dateKey}:${String(tzDate.getUTCHours()).padStart(2, '0')}`
  }

  _getCodexWindowSnapshot(account = {}, period = 'weekly') {
    const isFiveHour = period === 'codex_5h'
    const prefix = isFiveHour ? 'Primary' : 'Secondary'
    const defaultWindowMinutes = isFiveHour ? CODEX_FIVE_HOUR_MINUTES : CODEX_WEEKLY_MINUTES

    const updatedAt = account.codexUsageUpdatedAt
    const usedPercent = Number(account[`codex${prefix}UsedPercent`])
    const resetAfterSeconds = Number(account[`codex${prefix}ResetAfterSeconds`])
    const windowMinutes = Number(account[`codex${prefix}WindowMinutes`] || defaultWindowMinutes)

    const updatedMs = Date.parse(updatedAt)
    if (
      !updatedAt ||
      Number.isNaN(updatedMs) ||
      !Number.isFinite(resetAfterSeconds) ||
      resetAfterSeconds < 0
    ) {
      return {
        available: false,
        periodKey: `${period}:pending`,
        resetAt: null,
        remainingSeconds: null,
        usedPercent: null,
        windowMinutes: Number.isFinite(windowMinutes) ? windowMinutes : defaultWindowMinutes
      }
    }

    const safeWindowMinutes =
      Number.isFinite(windowMinutes) && windowMinutes > 0 ? windowMinutes : defaultWindowMinutes
    const resetAtMs = updatedMs + resetAfterSeconds * 1000
    const nowMs = Date.now()
    const expired = resetAtMs <= nowMs
    const resetAt = new Date(resetAtMs).toISOString()
    const startAtMs = resetAtMs - safeWindowMinutes * 60 * 1000

    return {
      available: true,
      expired,
      periodKey: `${period}:${expired ? 'expired:' : ''}${resetAt}`,
      startAt: new Date(startAtMs),
      resetAt,
      remainingSeconds: Math.max(0, Math.round((resetAtMs - nowMs) / 1000)),
      usedPercent: expired || !Number.isFinite(usedPercent) ? 0 : Math.max(0, usedPercent),
      windowMinutes: safeWindowMinutes
    }
  }

  _roundCost(value) {
    if (value === null || value === undefined || value === '') {
      return null
    }
    return Math.round(Number(value || 0) * 1_000_000) / 1_000_000
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

  async _sumCodexWindowUsage(accountId, snapshot) {
    if (!snapshot?.available || snapshot.expired || !snapshot.startAt) {
      return {
        totalCost: 0,
        requests: 0,
        allTokens: 0,
        usedModelBreakdown: false
      }
    }

    const client = redis.getClientSafe()
    const endMs = Math.min(Date.now(), Date.parse(snapshot.resetAt))
    const cursorHour = new Date(snapshot.startAt)
    cursorHour.setMinutes(0, 0, 0)

    let modelKeys = []
    while (cursorHour.getTime() <= endMs) {
      const hourKey = this._getHourKeyInTimezone(cursorHour)
      const keys = await client.keys(`account_usage:model:hourly:${accountId}:*:${hourKey}`)
      modelKeys = modelKeys.concat(keys)
      cursorHour.setHours(cursorHour.getHours() + 1)
    }

    const result = await this._sumModelKeys(modelKeys, 'hourly')
    if (result.usedModelBreakdown) {
      return result
    }

    const aggregateKeys = []
    const aggregateCursor = new Date(snapshot.startAt)
    aggregateCursor.setMinutes(0, 0, 0)
    while (aggregateCursor.getTime() <= endMs) {
      aggregateKeys.push(
        `account_usage:hourly:${accountId}:${this._getHourKeyInTimezone(aggregateCursor)}`
      )
      aggregateCursor.setHours(aggregateCursor.getHours() + 1)
    }

    return await this._fallbackAggregateCost(accountId, aggregateKeys)
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

  async _getUsageForConfig(record, config) {
    const period = this._normalizePeriod(config.quotaPeriod)

    if (this._isOpenAICodexWindow(record.store.platform, period)) {
      const snapshot = this._getCodexWindowSnapshot(record.account, period)
      const baseUsage = {
        period,
        periodKey: snapshot.periodKey,
        totalCost: 0,
        requests: 0,
        allTokens: 0,
        usedPercent: snapshot.usedPercent,
        resetAt: snapshot.resetAt,
        remainingSeconds: snapshot.remainingSeconds,
        windowMinutes: snapshot.windowMinutes,
        windowAvailable: snapshot.available,
        windowExpired: snapshot.expired === true
      }

      if (config.quotaLimitMode === 'percent') {
        return {
          ...baseUsage,
          value:
            snapshot.usedPercent === null || snapshot.usedPercent === undefined
              ? null
              : Number(snapshot.usedPercent),
          unit: 'percent'
        }
      }

      const windowUsage = await this._sumCodexWindowUsage(record.account.id, snapshot)
      return {
        ...baseUsage,
        ...windowUsage,
        period,
        periodKey: snapshot.periodKey,
        value: this._roundCost(windowUsage.totalCost),
        unit: 'cost'
      }
    }

    const usage = await this.getPeriodUsage(record.account.id, period)
    return {
      ...usage,
      value: this._roundCost(usage.totalCost),
      unit: 'cost'
    }
  }

  _getUsageValue(config, usage) {
    if (config.quotaLimitMode === 'percent') {
      const rawPercent =
        usage?.value !== null && usage?.value !== undefined ? usage.value : usage?.usedPercent
      if (rawPercent === null || rawPercent === undefined || rawPercent === '') {
        return null
      }
      const percent = Number(rawPercent)
      return Number.isFinite(percent) ? percent : null
    }

    const rawCost =
      usage?.value !== null && usage?.value !== undefined ? usage.value : usage?.totalCost
    if (rawCost === null || rawCost === undefined || rawCost === '') {
      return null
    }
    const cost = Number(rawCost)
    return Number.isFinite(cost) ? cost : null
  }

  _isConfigExceeded(config, usage) {
    if (!config.enabled) {
      return false
    }

    const limit = Number(config.quotaLimit || 0)
    const used = this._getUsageValue(config, usage)
    return Number.isFinite(limit) && limit > 0 && Number.isFinite(used) && used >= limit
  }

  _formatQuotaValue(config, value) {
    const safeValue = Number(value || 0)
    if (config.quotaLimitMode === 'percent') {
      return `${safeValue.toFixed(2)}%`
    }
    return `$${safeValue.toFixed(2)}`
  }

  _buildUsageStatus(config, usage = {}) {
    const used = this._getUsageValue(config, usage)
    const limit = Number(config.quotaLimit || 0)
    const safeUsed = Number.isFinite(used) ? used : 0
    const remaining = limit > 0 && Number.isFinite(used) ? Math.max(0, limit - used) : null

    return {
      period: usage.period || config.quotaPeriod,
      periodKey: usage.periodKey || '',
      cost: this._roundCost(usage.totalCost) || 0,
      requests: usage.requests || 0,
      allTokens: usage.allTokens || 0,
      used: Number.isFinite(used) ? this._roundCost(used) : null,
      value: Number.isFinite(used) ? this._roundCost(used) : null,
      unit: config.quotaLimitMode === 'percent' ? 'percent' : 'cost',
      limitMode: config.quotaLimitMode,
      remaining,
      percentage:
        limit > 0 && Number.isFinite(used) ? Math.round((safeUsed / limit) * 10000) / 100 : 0,
      usedPercent:
        usage.usedPercent === null || usage.usedPercent === undefined
          ? null
          : Math.round(Number(usage.usedPercent) * 100) / 100,
      resetAt: usage.resetAt || null,
      remainingSeconds: usage.remainingSeconds ?? null,
      windowMinutes: usage.windowMinutes ?? null,
      windowAvailable: usage.windowAvailable,
      windowExpired: usage.windowExpired
    }
  }

  _buildStatus(record, config, usage, state = 'active', evaluations = []) {
    return {
      success: true,
      accountId: record.account.id,
      platform: record.store.platform,
      state,
      config,
      usage: this._buildUsageStatus(config, usage),
      rules: evaluations.map((evaluation) => ({
        id: evaluation.config.id,
        label: evaluation.config.label,
        config: evaluation.config,
        usage: this._buildUsageStatus(evaluation.config, evaluation.usage),
        exceeded: evaluation.exceeded
      })),
      stopped: {
        quotaStoppedAt: record.account.quotaStoppedAt || null,
        quotaAutoStopped: config.quotaAutoStopped,
        quotaStoppedPeriod: record.account.quotaStoppedPeriod || '',
        quotaStoppedRule: record.account.quotaStoppedRule || '',
        quotaLastPeriodKey: record.account.quotaLastPeriodKey || ''
      }
    }
  }

  async _stopAccount(record, config, usage) {
    const used = this._getUsageValue(config, usage)
    const limit = Number(config.quotaLimit || 0)
    const message = `Quota exceeded (${config.label || config.quotaPeriod}): ${this._formatQuotaValue(
      config,
      used
    )} / ${this._formatQuotaValue(config, limit)}`

    await this._writeFields(record, {
      isActive: false,
      schedulable: false,
      status: 'quota_exceeded',
      errorMessage: message,
      quotaStoppedAt: new Date().toISOString(),
      quotaAutoStopped: true,
      quotaLastPeriodKey: usage.periodKey,
      quotaStoppedPeriod: usage.period || config.quotaPeriod,
      quotaStoppedRule: config.id,
      dailyUsage:
        config.quotaLimitMode === 'cost' ? Number(used || 0) : record.account.dailyUsage || 0
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
      quotaLastPeriodKey: usage?.periodKey || '',
      quotaStoppedPeriod: '',
      quotaStoppedRule: ''
    })

    logger.info(`✅ Account quota restored: ${record.store.platform}:${record.account.id}`)
  }

  async getQuotaStatus(accountId, platform = null) {
    const record = await this._readAccount(accountId, platform)
    if (!record) {
      return { success: false, error: 'Account not found' }
    }

    const config = this._getQuotaConfig(record.account)
    const { configs } = this._getEnabledQuotaConfigs(record.account, record.store.platform)
    const usage = await this._getUsageForConfig(record, config)
    const evaluations = []
    for (const quotaConfig of configs) {
      const ruleUsage =
        quotaConfig.id === config.id ? usage : await this._getUsageForConfig(record, quotaConfig)
      evaluations.push({
        config: quotaConfig,
        usage: ruleUsage,
        exceeded: this._isConfigExceeded(quotaConfig, ruleUsage)
      })
    }
    return this._buildStatus(
      record,
      config,
      usage,
      configs.length > 0 ? 'active' : 'disabled',
      evaluations
    )
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
    const quotaLimitMode = this._normalizeLimitMode(payload.quotaLimitMode || 'cost')
    if (quotaLimitMode === 'percent' && quotaLimit > 100) {
      return { success: false, error: '百分比额度必须小于等于 100' }
    }

    const codexFiveHourQuotaLimit = Number(payload.codexFiveHourQuotaLimit || 0)
    if (!Number.isFinite(codexFiveHourQuotaLimit) || codexFiveHourQuotaLimit < 0) {
      return { success: false, error: '5h 额度必须是大于等于 0 的数字' }
    }

    const codexFiveHourQuotaMode = this._normalizeLimitMode(
      payload.codexFiveHourQuotaMode || payload.codexFiveHourQuotaLimitMode || 'cost'
    )
    if (codexFiveHourQuotaMode === 'percent' && codexFiveHourQuotaLimit > 100) {
      return { success: false, error: '5h 百分比额度必须小于等于 100' }
    }

    const quotaResetTime = payload.quotaResetTime || '00:00'

    await this._writeFields(record, {
      quotaLimit,
      quotaPeriod,
      quotaLimitMode,
      quotaResetTime,
      codexFiveHourQuotaLimit,
      codexFiveHourQuotaMode,
      // 兼容旧字段和已有余额展示逻辑。
      dailyQuota: quotaLimit,
      lastResetDate: redis.getDateStringInTimezone()
    })

    return this.checkAndEnforceQuota(accountId, record.store.platform)
  }

  async checkAndEnforceQuota(accountId, platform = null) {
    const record = await this._readAccount(accountId, platform)
    if (!record) {
      return { success: false, error: 'Account not found' }
    }

    const { mainConfig: config, configs } = this._getEnabledQuotaConfigs(
      record.account,
      record.store.platform
    )

    if (configs.length === 0 && !config.quotaAutoStopped) {
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

    const evaluations = []
    for (const quotaConfig of configs) {
      const usage = await this._getUsageForConfig(record, quotaConfig)
      evaluations.push({
        config: quotaConfig,
        usage,
        exceeded: this._isConfigExceeded(quotaConfig, usage)
      })
    }

    const mainEvaluation = evaluations.find((evaluation) => evaluation.config.id === config.id) || {
      config,
      usage: await this._getUsageForConfig(record, config),
      exceeded: false
    }
    const exceededEvaluation = evaluations.find((evaluation) => evaluation.exceeded)

    if (configs.length === 0) {
      if (config.quotaAutoStopped) {
        await this._recoverAccount(record, mainEvaluation.usage)
        return this._buildStatus(record, config, mainEvaluation.usage, 'recovered', evaluations)
      }
      return this._buildStatus(record, config, mainEvaluation.usage, 'disabled', evaluations)
    }

    if (exceededEvaluation) {
      const stoppedRule = record.account.quotaStoppedRule || ''
      const stoppedPeriodKey = record.account.quotaLastPeriodKey || ''
      if (
        !config.quotaAutoStopped ||
        stoppedRule !== exceededEvaluation.config.id ||
        stoppedPeriodKey !== exceededEvaluation.usage.periodKey
      ) {
        await this._stopAccount(record, exceededEvaluation.config, exceededEvaluation.usage)
      }
      return this._buildStatus(record, config, mainEvaluation.usage, 'exceeded', evaluations)
    }

    if (config.quotaAutoStopped) {
      await this._recoverAccount(record, mainEvaluation.usage)
      return this._buildStatus(record, config, mainEvaluation.usage, 'recovered', evaluations)
    }

    return this._buildStatus(record, config, mainEvaluation.usage, 'active', evaluations)
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
          const hasEnabledRule =
            result.config.enabled || result.rules?.some((rule) => rule.config?.enabled)
          if (!result.success || (!hasEnabledRule && !result.stopped.quotaAutoStopped)) {
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
