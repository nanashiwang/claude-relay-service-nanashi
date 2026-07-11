const claudeAccountService = require('./claudeAccountService')
const claudeConsoleAccountService = require('./claudeConsoleAccountService')
const bedrockAccountService = require('./bedrockAccountService')
const ccrAccountService = require('./ccrAccountService')
const accountGroupService = require('./accountGroupService')
const claudeRelayConfigService = require('./claudeRelayConfigService')
const redis = require('../models/redis')
const logger = require('../utils/logger')
const { parseVendorPrefixedModel, isOpus45OrNewer } = require('../utils/modelHelper')
const { resolveStickySessionPolicy } = require('../utils/sessionStickyHelper')
const config = require('../../config/config')

const CLAUDE_POOL_MODEL_PROBES = Object.freeze([
  { family: 'opus', label: 'Opus', model: 'claude-opus-4-8' },
  { family: 'sonnet', label: 'Sonnet', model: 'claude-sonnet-4-6' },
  { family: 'haiku', label: 'Haiku', model: 'claude-haiku-4-5-20251001' },
  { family: 'fable', label: 'Fable', model: 'claude-fable-5' }
])

const DIAGNOSTIC_REASON_LABELS = Object.freeze({
  inactive: '账号未启用',
  invalid_status: '账号状态异常',
  not_shared_pool: '不属于共享账户池',
  model_not_supported: '不支持该模型',
  subscription_expired: '订阅已过期',
  temporarily_unavailable: '临时冷却中',
  rate_limited: '模型或账号限流',
  quota_exceeded: '额度已用尽',
  concurrency_full: '并发已满',
  not_schedulable: '调度已停用',
  outside_group: '不在所选账号组',
  dedicated_binding_precedence: 'API Key 专属绑定优先',
  dedicated_fallback_disabled: '专属账号不可用且禁止回退',
  api_key_inactive: 'API Key 未启用',
  api_key_deleted: 'API Key 已删除',
  api_key_permission_denied: 'API Key 无 Claude 权限',
  api_key_model_restricted: 'API Key 禁止该模型'
})

const TOKEN_STATUS_LABELS = Object.freeze({
  expiring: 'Token 即将过期',
  refresh_failed: 'Token 刷新失败',
  expired: 'Token 已过期',
  missing: 'Token 缺失'
})

/**
 * Check if account is Pro (not Max)
 *
 * ACCOUNT TYPE LOGIC (as of 2025-12-05):
 * Pro accounts can be identified by either:
 *   1. API real-time data: hasClaudePro=true && hasClaudeMax=false
 *   2. Local config data: accountType='claude_pro'
 *
 * Account type restrictions for Opus models:
 *   - Free account: No Opus access at all
 *   - Pro account: Only Opus 4.5+ (new versions)
 *   - Max account: All Opus versions (legacy 3.x, 4.0, 4.1 and new 4.5+)
 *
 * Compatible with both API real-time data (hasClaudePro) and local config (accountType)
 * @param {Object} info - Subscription info object
 * @returns {boolean} - true if Pro account (not Free, not Max)
 */
function isProAccount(info) {
  // API real-time status takes priority
  if (info.hasClaudePro === true && info.hasClaudeMax !== true) {
    return true
  }
  // Local configured account type
  return info.accountType === 'claude_pro'
}

class UnifiedClaudeScheduler {
  constructor() {
    this.SESSION_MAPPING_PREFIX = 'unified_claude_session_mapping:'
  }

  // 🔧 辅助方法：检查账户是否可调度（兼容字符串和布尔值）
  _isSchedulable(schedulable) {
    // 如果是 undefined 或 null，默认为可调度
    if (schedulable === undefined || schedulable === null) {
      return true
    }
    // 明确设置为 false（布尔值）或 'false'（字符串）时不可调度
    return schedulable !== false && schedulable !== 'false'
  }

  async _checkClaudeOfficialSchedulingState(account, requestedModel = null) {
    const accountId = account?.id || account?.accountId
    if (!accountId) {
      return { canUse: false, reason: 'missing_account_id', account }
    }

    const isModelRateLimited = await claudeAccountService.isAccountRateLimitedForModel(
      accountId,
      requestedModel
    )
    const latestAccount = (await redis.getClaudeAccount(accountId)) || account

    if (isModelRateLimited) {
      return { canUse: false, reason: 'rate_limited', account: latestAccount }
    }

    if (!this._isSchedulable(latestAccount.schedulable)) {
      return { canUse: false, reason: 'not_schedulable', account: latestAccount }
    }

    return { canUse: true, account: latestAccount }
  }

  // 🔍 检查账户是否支持请求的模型
  _isModelSupportedByAccount(account, accountType, requestedModel, context = '') {
    if (!requestedModel) {
      return true // 没有指定模型时，默认支持
    }

    // Claude OAuth 账户的模型检查
    if (accountType === 'claude-official') {
      // 1. 首先检查是否为 Claude 官方支持的模型
      // Claude Official API 只支持 Anthropic 自己的模型,不支持第三方模型(如 deepseek-chat)
      const isClaudeOfficialModel =
        requestedModel.startsWith('claude-') ||
        requestedModel.includes('claude') ||
        requestedModel.includes('sonnet') ||
        requestedModel.includes('opus') ||
        requestedModel.includes('haiku')

      if (!isClaudeOfficialModel) {
        logger.info(
          `🚫 Claude official account ${account.name} does not support non-Claude model ${requestedModel}${context ? ` ${context}` : ''}`
        )
        return false
      }

      // 2. Opus model subscription level check
      // VERSION RESTRICTION LOGIC:
      // - Free: No Opus models
      // - Pro: Only Opus 4.5+ (isOpus45OrNewer = true)
      // - Max: All Opus versions
      if (requestedModel.toLowerCase().includes('opus')) {
        const isNewOpus = isOpus45OrNewer(requestedModel)

        if (account.subscriptionInfo) {
          try {
            const info =
              typeof account.subscriptionInfo === 'string'
                ? JSON.parse(account.subscriptionInfo)
                : account.subscriptionInfo

            // Free account: does not support any Opus model
            if (info.accountType === 'free') {
              logger.info(
                `🚫 Claude account ${account.name} (Free) does not support Opus model${context ? ` ${context}` : ''}`
              )
              return false
            }

            // Pro account: only supports Opus 4.5+
            // Reject legacy Opus (3.x, 4.0-4.4) but allow new Opus (4.5+)
            if (isProAccount(info)) {
              if (!isNewOpus) {
                logger.info(
                  `🚫 Claude account ${account.name} (Pro) does not support legacy Opus model${context ? ` ${context}` : ''}`
                )
                return false
              }
              // Opus 4.5+ supported
              return true
            }

            // Max account: supports all Opus versions (no restriction)
          } catch (e) {
            // Parse failed, assume legacy data (Max), default support
            logger.debug(
              `Account ${account.name} has invalid subscriptionInfo${context ? ` ${context}` : ''}, assuming Max`
            )
          }
        }
        // Account without subscription info, default to supported (legacy data compatibility)
      }
    }

    // Claude Console 账户的模型支持检查
    if (accountType === 'claude-console' && account.supportedModels) {
      // 兼容旧格式（数组）和新格式（对象）
      if (Array.isArray(account.supportedModels)) {
        // 旧格式：数组
        if (
          account.supportedModels.length > 0 &&
          !account.supportedModels.includes(requestedModel)
        ) {
          logger.info(
            `🚫 Claude Console account ${account.name} does not support model ${requestedModel}${context ? ` ${context}` : ''}`
          )
          return false
        }
      } else if (typeof account.supportedModels === 'object') {
        // 新格式：映射表
        if (
          Object.keys(account.supportedModels).length > 0 &&
          !claudeConsoleAccountService.isModelSupported(account.supportedModels, requestedModel)
        ) {
          logger.info(
            `🚫 Claude Console account ${account.name} does not support model ${requestedModel}${context ? ` ${context}` : ''}`
          )
          return false
        }
      }
    }

    // CCR 账户的模型支持检查
    if (accountType === 'ccr' && account.supportedModels) {
      // 兼容旧格式（数组）和新格式（对象）
      if (Array.isArray(account.supportedModels)) {
        // 旧格式：数组
        if (
          account.supportedModels.length > 0 &&
          !account.supportedModels.includes(requestedModel)
        ) {
          logger.info(
            `🚫 CCR account ${account.name} does not support model ${requestedModel}${context ? ` ${context}` : ''}`
          )
          return false
        }
      } else if (typeof account.supportedModels === 'object') {
        // 新格式：映射表
        if (
          Object.keys(account.supportedModels).length > 0 &&
          !ccrAccountService.isModelSupported(account.supportedModels, requestedModel)
        ) {
          logger.info(
            `🚫 CCR account ${account.name} does not support model ${requestedModel}${context ? ` ${context}` : ''}`
          )
          return false
        }
      }
    }

    return true
  }

  _diagnosticReason(code, detail = null) {
    return {
      code,
      label: DIAGNOSTIC_REASON_LABELS[code] || code,
      detail
    }
  }

  _recordDecisionExclusion(trace, account, accountType, reason) {
    if (!trace) {
      return
    }
    const accountId = account?.id || account?.accountId || null
    if (
      trace.excluded.some(
        (item) =>
          item.accountId === accountId && item.accountType === accountType && item.reason === reason
      )
    ) {
      return
    }
    trace.excluded.push({
      accountId,
      name: account?.name || null,
      accountType,
      reason
    })
  }

  _parseDiagnosticList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean)
    }
    if (typeof value !== 'string' || !value.trim()) {
      return []
    }
    const trimmed = value.trim()
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        return Array.isArray(parsed)
          ? parsed.map((item) => String(item).trim()).filter(Boolean)
          : []
      } catch {
        return []
      }
    }
    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  _getDiagnosticApiKeyBlockers(apiKeyData, requestedModel) {
    if (!apiKeyData) {
      return []
    }

    const blockers = []
    if (apiKeyData.isDeleted === true || apiKeyData.isDeleted === 'true') {
      blockers.push(this._diagnosticReason('api_key_deleted'))
    }
    if (apiKeyData.isActive === false || apiKeyData.isActive === 'false') {
      blockers.push(this._diagnosticReason('api_key_inactive'))
    }

    const permissions = this._parseDiagnosticList(apiKeyData.permissions).map((permission) =>
      permission.toLowerCase()
    )
    if (permissions.length > 0 && !permissions.includes('all') && !permissions.includes('claude')) {
      blockers.push(this._diagnosticReason('api_key_permission_denied'))
    }

    const modelRestrictionEnabled =
      apiKeyData.enableModelRestriction === true || apiKeyData.enableModelRestriction === 'true'
    const restrictedModels = this._parseDiagnosticList(apiKeyData.restrictedModels)
    if (modelRestrictionEnabled && requestedModel && restrictedModels.includes(requestedModel)) {
      blockers.push(this._diagnosticReason('api_key_model_restricted', requestedModel))
    }

    return blockers
  }

  async _getDiagnosticTempState(accountId, accountType, cache = null) {
    const client = redis.getClientSafe()
    const key = `temp_unavailable:${accountType}:${accountId}`
    if (cache?.has(key)) {
      return await cache.get(key)
    }

    const readState = async () => {
      let ttlSeconds = -2

      try {
        if (typeof client.ttl === 'function') {
          ttlSeconds = await client.ttl(key)
        } else if (typeof client.exists === 'function' && (await client.exists(key))) {
          ttlSeconds = -1
        }
      } catch (error) {
        logger.debug(`Failed to inspect diagnostic temp state for ${accountId}:`, error.message)
      }

      return {
        active: ttlSeconds > 0 || ttlSeconds === -1,
        ttlSeconds: ttlSeconds > 0 ? ttlSeconds : null,
        expiresAt: ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null
      }
    }

    const statePromise = readState()
    if (cache) {
      cache.set(key, statePromise)
    }
    return await statePromise
  }

  async _evaluateDiagnosticAccount(
    account,
    accountType,
    requestedModel,
    allowNonSharedIds,
    tempStateCache = null
  ) {
    const currentAccount = account
    const reasons = []
    const warnings = []
    const addReason = (code, detail = null) => reasons.push(this._diagnosticReason(code, detail))
    const allowNonShared = allowNonSharedIds.has(account.id)
    let tempUnavailable = { active: false, ttlSeconds: null, expiresAt: null }
    let concurrency = null
    let tokenStatus = null

    if (accountType === 'claude-official') {
      const isActive = account.isActive === true || account.isActive === 'true'
      if (!isActive) {
        addReason('inactive')
      }
      if (['error', 'blocked', 'temp_error'].includes(account.status)) {
        addReason('invalid_status', account.status)
      }
      if (!allowNonShared && account.accountType && account.accountType !== 'shared') {
        addReason('not_shared_pool', account.accountType)
      }
      if (!this._isModelSupportedByAccount(account, accountType, requestedModel, 'in diagnostic')) {
        addReason('model_not_supported', requestedModel)
      }

      const inspection = await claudeAccountService.inspectAccountForModel(account, requestedModel)
      if (inspection.isRateLimited) {
        addReason('rate_limited', inspection.bucket)
      }
      if (
        !inspection.wouldAutoResumeScheduling &&
        !this._isSchedulable(currentAccount.schedulable)
      ) {
        addReason('not_schedulable')
      }

      tempUnavailable = await this._getDiagnosticTempState(account.id, accountType, tempStateCache)
      if (tempUnavailable.active) {
        addReason('temporarily_unavailable')
      }

      tokenStatus = inspection.token?.status || null
      if (['expiring', 'refresh_failed', 'expired', 'missing'].includes(tokenStatus)) {
        warnings.push({
          code: `token_${tokenStatus}`,
          label: TOKEN_STATUS_LABELS[tokenStatus]
        })
      }
    } else if (accountType === 'claude-console') {
      if (account.isActive !== true) {
        addReason('inactive')
      }
      if (account.status !== 'active') {
        addReason('invalid_status', account.status)
      }
      if (!allowNonShared && account.accountType !== 'shared') {
        addReason('not_shared_pool', account.accountType)
      }
      if (!this._isSchedulable(account.schedulable)) {
        addReason('not_schedulable')
      }
      if (!this._isModelSupportedByAccount(account, accountType, requestedModel, 'in diagnostic')) {
        addReason('model_not_supported', requestedModel)
      }
      if (claudeConsoleAccountService.isSubscriptionExpired(account)) {
        addReason('subscription_expired', account.expiresAt || account.subscriptionExpiresAt)
      }

      tempUnavailable = await this._getDiagnosticTempState(account.id, accountType, tempStateCache)
      if (tempUnavailable.active) {
        addReason('temporarily_unavailable')
      }
      if (account.rateLimitInfo?.isRateLimited) {
        addReason('rate_limited')
      }
      if (account.dailyQuota > 0 && account.dailyUsage >= account.dailyQuota) {
        addReason('quota_exceeded')
      }

      concurrency = {
        current: Number(account.activeTaskCount || 0),
        limit: Number(account.maxConcurrentTasks || 0)
      }
      if (concurrency.limit > 0 && concurrency.current >= concurrency.limit) {
        addReason('concurrency_full', `${concurrency.current}/${concurrency.limit}`)
      }
    } else if (accountType === 'bedrock') {
      if (account.isActive !== true) {
        addReason('inactive')
      }
      if (!allowNonShared && account.accountType !== 'shared') {
        addReason('not_shared_pool', account.accountType)
      }
      if (!this._isSchedulable(account.schedulable)) {
        addReason('not_schedulable')
      }
      tempUnavailable = await this._getDiagnosticTempState(account.id, accountType, tempStateCache)
      if (tempUnavailable.active) {
        addReason('temporarily_unavailable')
      }
    } else if (accountType === 'ccr') {
      if (account.isActive !== true) {
        addReason('inactive')
      }
      if (account.status !== 'active') {
        addReason('invalid_status', account.status)
      }
      if (!allowNonShared && account.accountType !== 'shared') {
        addReason('not_shared_pool', account.accountType)
      }
      if (!this._isSchedulable(account.schedulable)) {
        addReason('not_schedulable')
      }
      if (!this._isModelSupportedByAccount(account, accountType, requestedModel, 'in diagnostic')) {
        addReason('model_not_supported', requestedModel)
      }
      if (ccrAccountService.isSubscriptionExpired(account)) {
        addReason('subscription_expired', account.expiresAt || account.subscriptionExpiresAt)
      }
      tempUnavailable = await this._getDiagnosticTempState(account.id, accountType, tempStateCache)
      if (tempUnavailable.active) {
        addReason('temporarily_unavailable')
      }
      if (account.rateLimitInfo?.isRateLimited) {
        addReason('rate_limited')
      }
      if (account.dailyQuota > 0 && account.dailyUsage >= account.dailyQuota) {
        addReason('quota_exceeded')
      }
    }

    return {
      accountId: currentAccount.id,
      name: currentAccount.name || currentAccount.id,
      accountType,
      poolType: currentAccount.accountType || 'shared',
      priority: parseInt(currentAccount.priority) || 50,
      lastUsedAt: currentAccount.lastUsedAt || null,
      status: currentAccount.status || (currentAccount.isActive ? 'active' : 'inactive'),
      schedulable: this._isSchedulable(currentAccount.schedulable),
      eligible: reasons.length === 0,
      reasons,
      warnings,
      tempUnavailable,
      concurrency,
      tokenStatus,
      selected: false
    }
  }

  async _collectDiagnosticAccounts(includeCcr = false) {
    if (includeCcr) {
      const ccrAccounts = await ccrAccountService.getAllAccounts()
      return ccrAccounts.map((account) => ({ account, accountType: 'ccr' }))
    }

    const [officialAccounts, consoleAccounts, bedrockResult] = await Promise.all([
      redis.getAllClaudeAccounts(),
      claudeConsoleAccountService.getAllAccounts(true),
      bedrockAccountService.getAllAccounts()
    ])

    return [
      ...officialAccounts.map((account) => ({ account, accountType: 'claude-official' })),
      ...consoleAccounts.map((account) => ({ account, accountType: 'claude-console' })),
      ...(bedrockResult.success
        ? bedrockResult.data.map((account) => ({ account, accountType: 'bedrock' }))
        : [])
    ]
  }

  async explainAccountSelection(options = {}) {
    const requestedModel = options.requestedModel || 'claude-sonnet-4-6'
    const { vendor, baseModel } = parseVendorPrefixedModel(requestedModel)
    const effectiveModel = vendor === 'ccr' ? baseModel : requestedModel
    const apiKeyData = options.apiKeyData || null
    const apiKeyBlockers = this._getDiagnosticApiKeyBlockers(apiKeyData, requestedModel)
    const directOfficialBinding =
      apiKeyData?.claudeAccountId && !apiKeyData.claudeAccountId.startsWith('group:')
        ? apiKeyData.claudeAccountId
        : null
    const boundGroupId = apiKeyData?.claudeAccountId?.startsWith('group:')
      ? apiKeyData.claudeAccountId.slice('group:'.length)
      : null
    const directConsoleBinding = apiKeyData?.claudeConsoleAccountId || null
    const directBedrockBinding = apiKeyData?.bedrockAccountId || null
    const effectiveGroupId = vendor === 'ccr' ? null : boundGroupId || options.groupId || null
    let group = null
    let groupMemberIds = []

    if (effectiveGroupId) {
      group = await accountGroupService.getGroup(effectiveGroupId)
      if (group) {
        groupMemberIds = await accountGroupService.getGroupMembers(effectiveGroupId)
      }
    }

    const allowNonSharedIds = new Set(
      [...groupMemberIds, directOfficialBinding, directConsoleBinding, directBedrockBinding].filter(
        Boolean
      )
    )
    const accountCacheKey = vendor === 'ccr' ? 'ccr' : 'claude'
    let collectedAccounts = options.accountCache?.[accountCacheKey]
    if (!collectedAccounts) {
      collectedAccounts = await this._collectDiagnosticAccounts(vendor === 'ccr')
      if (options.accountCache) {
        options.accountCache[accountCacheKey] = collectedAccounts
      }
    }
    const accounts = await Promise.all(
      collectedAccounts.map(({ account, accountType }) =>
        this._evaluateDiagnosticAccount(
          account,
          accountType,
          effectiveModel,
          allowNonSharedIds,
          options.tempStateCache
        )
      )
    )

    if (effectiveGroupId) {
      const groupMemberSet = new Set(groupMemberIds)
      for (const account of accounts) {
        if (!groupMemberSet.has(account.accountId)) {
          account.reasons.push(
            this._diagnosticReason('outside_group', group?.name || effectiveGroupId)
          )
          account.eligible = false
        }
      }
    }

    let selected = null
    let selectionMode = 'priority_pool'
    let fallbackLocked = false
    const findEligibleBinding = (accountId, accountType) =>
      accounts.find(
        (account) =>
          account.accountId === accountId && account.accountType === accountType && account.eligible
      )

    if (vendor !== 'ccr' && directOfficialBinding) {
      selected = findEligibleBinding(directOfficialBinding, 'claude-official')
      selectionMode = 'dedicated_claude'
      if (!selected && config.claude?.dedicatedAccountFallback !== true) {
        fallbackLocked = true
      }
    }
    if (!selected && !fallbackLocked && vendor !== 'ccr' && directConsoleBinding) {
      selected = findEligibleBinding(directConsoleBinding, 'claude-console')
      if (selected) {
        selectionMode = 'dedicated_console'
      }
    }
    if (!selected && !fallbackLocked && vendor !== 'ccr' && directBedrockBinding) {
      selected = findEligibleBinding(directBedrockBinding, 'bedrock')
      if (selected) {
        selectionMode = 'dedicated_bedrock'
      }
    }

    if (selected) {
      for (const account of accounts) {
        if (account.accountId !== selected.accountId && account.eligible) {
          account.reasons.push(this._diagnosticReason('dedicated_binding_precedence'))
          account.eligible = false
        }
      }
    } else if (fallbackLocked) {
      for (const account of accounts) {
        if (account.accountId !== directOfficialBinding && account.eligible) {
          account.reasons.push(this._diagnosticReason('dedicated_fallback_disabled'))
          account.eligible = false
        }
      }
    }

    if (!selected && !fallbackLocked && options.sessionHash) {
      const mappedAccount = await this._getSessionMapping(options.sessionHash)
      if (mappedAccount) {
        selected = accounts.find(
          (account) =>
            account.accountId === mappedAccount.accountId &&
            account.accountType === mappedAccount.accountType &&
            account.eligible
        )
        if (selected) {
          selectionMode = 'sticky_session'
        }
      }
    }

    if (!selected && !fallbackLocked) {
      const sortedEligible = this._sortAccountsByPriority(
        accounts.filter((account) => account.eligible).map((account) => ({ ...account }))
      )
      selected = sortedEligible[0] || null
      selectionMode = effectiveGroupId ? 'group_priority' : 'priority_pool'
    }

    if (apiKeyBlockers.length > 0) {
      selected = null
      selectionMode = 'blocked_by_api_key'
    }
    if (selected) {
      const selectedAccount = accounts.find(
        (account) =>
          account.accountId === selected.accountId && account.accountType === selected.accountType
      )
      if (selectedAccount) {
        selectedAccount.selected = true
      }
    }

    for (const account of accounts) {
      account.selectable = account.eligible && apiKeyBlockers.length === 0
    }

    const reasonCounts = {}
    for (const account of accounts) {
      for (const reason of account.reasons) {
        reasonCounts[reason.code] = (reasonCounts[reason.code] || 0) + 1
      }
    }
    const healthyAccountCount = accounts.filter((account) => account.eligible).length
    const selectableAccountCount = accounts.filter((account) => account.selectable).length

    return {
      requestedModel,
      effectiveModel,
      generatedAt: new Date().toISOString(),
      context: {
        apiKey: apiKeyData ? { id: apiKeyData.id, name: apiKeyData.name } : null,
        group: group ? { id: group.id, name: group.name } : null,
        groupMissing: !!effectiveGroupId && !group,
        scope: vendor === 'ccr' ? 'ccr' : effectiveGroupId ? 'group' : 'pool',
        bindings: {
          claudeAccountId: directOfficialBinding,
          claudeConsoleAccountId: directConsoleBinding,
          bedrockAccountId: directBedrockBinding,
          groupId: boundGroupId
        },
        sessionMappingChecked: !!options.sessionHash,
        blockers: apiKeyBlockers
      },
      summary: {
        totalAccounts: accounts.length,
        healthyAccountCount,
        selectableAccountCount,
        excludedAccountCount: accounts.length - selectableAccountCount,
        poolExcludedAccountCount: accounts.length - healthyAccountCount,
        warningAccountCount: accounts.filter((account) => account.warnings.length > 0).length,
        reasonCounts
      },
      selection: {
        mode: selectionMode,
        selected: selected
          ? {
              accountId: selected.accountId,
              name: selected.name,
              accountType: selected.accountType,
              priority: selected.priority
            }
          : null
      },
      accounts: accounts.sort((left, right) => {
        if (left.selected !== right.selected) {
          return left.selected ? -1 : 1
        }
        if (left.eligible !== right.eligible) {
          return left.eligible ? -1 : 1
        }
        if (left.priority !== right.priority) {
          return left.priority - right.priority
        }
        return left.name.localeCompare(right.name)
      })
    }
  }

  async getPoolHealthSnapshot(options = {}) {
    const requestedModel = options.requestedModel || 'claude-sonnet-4-6'
    const sharedOptions = {
      ...options,
      accountCache: {},
      tempStateCache: new Map()
    }
    const familyReports = []
    for (const probe of CLAUDE_POOL_MODEL_PROBES) {
      familyReports.push(
        await this.explainAccountSelection({ ...sharedOptions, requestedModel: probe.model })
      )
    }
    const matchingFamilyReport = familyReports.find(
      (report) => report.requestedModel === requestedModel
    )
    const diagnostic =
      matchingFamilyReport ||
      (await this.explainAccountSelection({ ...sharedOptions, requestedModel }))

    return {
      generatedAt: new Date().toISOString(),
      overview: familyReports.map((report, index) => ({
        ...CLAUDE_POOL_MODEL_PROBES[index],
        summary: report.summary,
        selected: report.selection.selected
      })),
      diagnostic
    }
  }

  // 🎯 统一调度Claude账号（官方和Console）
  async selectAccountForApiKey(
    apiKeyData,
    sessionHash = null,
    requestedModel = null,
    forcedAccount = null
  ) {
    const requestId = apiKeyData?.requestId || null
    const shouldLogDecision = !!requestId
    const decisionSequence = shouldLogDecision
      ? Number(apiKeyData.schedulerDecisionSequence || 0) + 1
      : 0
    if (shouldLogDecision) {
      apiKeyData.schedulerDecisionSequence = decisionSequence
    }
    const trace = shouldLogDecision ? { excluded: [] } : null

    try {
      const selection = await this._selectAccountForApiKeyInternal(
        apiKeyData,
        sessionHash,
        requestedModel,
        forcedAccount,
        trace
      )

      if (shouldLogDecision) {
        const reasonCounts = trace.excluded.reduce((counts, item) => {
          counts[item.reason] = (counts[item.reason] || 0) + 1
          return counts
        }, {})
        logger.info(`🧭 [${requestId}] Claude scheduler decision`, {
          requestId,
          decisionSequence,
          apiKeyId: apiKeyData.id || null,
          model: requestedModel || null,
          sessionHashPresent: !!sessionHash,
          selectedAccountId: selection.accountId,
          selectedAccountType: selection.accountType,
          excludedReasonCounts: reasonCounts,
          excludedAccounts: trace.excluded.slice(0, 20)
        })
      }

      return selection
    } catch (error) {
      if (shouldLogDecision) {
        const reasonCounts = trace.excluded.reduce((counts, item) => {
          counts[item.reason] = (counts[item.reason] || 0) + 1
          return counts
        }, {})
        logger.warn(`🧭 [${requestId}] Claude scheduler rejected request`, {
          requestId,
          decisionSequence,
          apiKeyId: apiKeyData.id || null,
          model: requestedModel || null,
          errorCode: error.code || null,
          errorMessage: error.message,
          excludedReasonCounts: reasonCounts,
          excludedAccounts: trace.excluded.slice(0, 20)
        })
      }
      throw error
    }
  }

  async _selectAccountForApiKeyInternal(
    apiKeyData,
    sessionHash = null,
    requestedModel = null,
    forcedAccount = null,
    decisionTrace = null
  ) {
    try {
      // 🔒 如果有强制绑定的账户（全局会话绑定），仅 claude-official 类型受影响
      if (forcedAccount && forcedAccount.accountId && forcedAccount.accountType) {
        // ⚠️ 只有 claude-official 类型账户受全局会话绑定限制
        // 其他类型（bedrock, ccr, claude-console等）忽略绑定，走正常调度
        if (forcedAccount.accountType !== 'claude-official') {
          logger.info(
            `🔗 Session binding ignored for non-official account type: ${forcedAccount.accountType}, proceeding with normal scheduling`
          )
          // 不使用 forcedAccount，继续走下面的正常调度逻辑
        } else {
          // claude-official 类型需要检查可用性并强制使用
          logger.info(
            `🔗 Forced session binding detected: ${forcedAccount.accountId} (${forcedAccount.accountType})`
          )

          const isAvailable = await this._isAccountAvailableForSessionBinding(
            forcedAccount.accountId,
            forcedAccount.accountType,
            requestedModel
          )

          if (isAvailable) {
            logger.info(
              `✅ Using forced session binding account: ${forcedAccount.accountId} (${forcedAccount.accountType})`
            )
            return {
              accountId: forcedAccount.accountId,
              accountType: forcedAccount.accountType
            }
          } else {
            // 绑定账户不可用，抛出特定错误（不 fallback）
            logger.warn(
              `❌ Forced session binding account unavailable: ${forcedAccount.accountId} (${forcedAccount.accountType})`
            )
            const error = new Error('Session binding account unavailable')
            error.code = 'SESSION_BINDING_ACCOUNT_UNAVAILABLE'
            error.accountId = forcedAccount.accountId
            error.accountType = forcedAccount.accountType
            throw error
          }
        }
      }

      // 解析供应商前缀
      const { vendor, baseModel } = parseVendorPrefixedModel(requestedModel)
      const effectiveModel = vendor === 'ccr' ? baseModel : requestedModel

      logger.debug(
        `🔍 Model parsing - Original: ${requestedModel}, Vendor: ${vendor}, Effective: ${effectiveModel}`
      )
      const isOpusRequest =
        effectiveModel && typeof effectiveModel === 'string'
          ? effectiveModel.toLowerCase().includes('opus')
          : false

      // 如果是 CCR 前缀，只在 CCR 账户池中选择
      if (vendor === 'ccr') {
        logger.info(`🎯 CCR vendor prefix detected, routing to CCR accounts only`)
        return await this._selectCcrAccount(apiKeyData, sessionHash, effectiveModel, decisionTrace)
      }
      // 如果API Key绑定了专属账户或分组，优先使用
      if (apiKeyData.claudeAccountId) {
        // 检查是否是分组
        if (apiKeyData.claudeAccountId.startsWith('group:')) {
          const groupId = apiKeyData.claudeAccountId.replace('group:', '')
          logger.info(
            `🎯 API key ${apiKeyData.name} is bound to group ${groupId}, selecting from group`
          )
          return await this.selectAccountFromGroup(
            groupId,
            sessionHash,
            effectiveModel,
            vendor === 'ccr',
            apiKeyData,
            decisionTrace
          )
        }

        // 普通专属账户
        const boundAccount = await redis.getClaudeAccount(apiKeyData.claudeAccountId)
        const allowDedicatedFallback = config.claude?.dedicatedAccountFallback === true
        const createUnavailableError = (reason) => {
          const error = new Error(`Dedicated Claude account is unavailable (${reason})`)
          error.code = 'CLAUDE_DEDICATED_UNAVAILABLE'
          error.accountId = apiKeyData.claudeAccountId
          error.reason = reason
          return error
        }

        if (
          !boundAccount ||
          boundAccount.isActive !== 'true' ||
          ['error', 'blocked', 'temp_error'].includes(boundAccount.status)
        ) {
          logger.warn(
            `⚠️ Bound Claude OAuth account ${apiKeyData.claudeAccountId} is not available (isActive: ${boundAccount?.isActive}, status: ${boundAccount?.status})`
          )
          if (!allowDedicatedFallback) {
            throw createUnavailableError('inactive_or_error')
          }
        } else {
          // 限流必须早于 temp_unavailable 判断，避免专属账号静默落入共享池。
          const schedulingState = await this._checkClaudeOfficialSchedulingState(
            boundAccount,
            effectiveModel
          )
          const latestBoundAccount = schedulingState.account || boundAccount
          const rateLimitAutoStopped = latestBoundAccount.rateLimitAutoStopped === 'true'
          if (
            schedulingState.reason === 'rate_limited' ||
            (rateLimitAutoStopped && !this._isSchedulable(latestBoundAccount.schedulable))
          ) {
            const rateInfo = await claudeAccountService.getAccountRateLimitInfoForModel(
              boundAccount.id,
              effectiveModel
            )
            const error = new Error('Dedicated Claude account is rate limited')
            error.code = 'CLAUDE_DEDICATED_RATE_LIMITED'
            error.accountId = boundAccount.id
            error.rateLimitEndAt = rateInfo?.rateLimitEndAt || boundAccount.rateLimitEndAt || null
            error.rateLimitBucket = rateInfo?.bucket || null
            throw error
          }

          const isTempUnavailable = await this.isAccountTemporarilyUnavailable(
            boundAccount.id,
            'claude-official'
          )
          if (isTempUnavailable) {
            logger.warn(
              `⏱️ Bound Claude OAuth account ${boundAccount.id} is temporarily unavailable`
            )
            if (!allowDedicatedFallback) {
              throw createUnavailableError('temporarily_unavailable')
            }
          } else if (!schedulingState.canUse) {
            logger.warn(
              `⚠️ Bound Claude OAuth account ${apiKeyData.claudeAccountId} is not schedulable (schedulable: ${latestBoundAccount?.schedulable})`
            )
            if (!allowDedicatedFallback) {
              throw createUnavailableError('not_schedulable')
            }
          } else {
            if (isOpusRequest) {
              await claudeAccountService.clearExpiredOpusRateLimit(boundAccount.id)
            }
            logger.info(
              `🎯 Using bound dedicated Claude OAuth account: ${latestBoundAccount.name} (${apiKeyData.claudeAccountId}) for API key ${apiKeyData.name}`
            )
            return {
              accountId: apiKeyData.claudeAccountId,
              accountType: 'claude-official'
            }
          }
        }
      }

      // 2. 检查Claude Console账户绑定
      if (apiKeyData.claudeConsoleAccountId) {
        const boundConsoleAccount = await claudeConsoleAccountService.getAccount(
          apiKeyData.claudeConsoleAccountId
        )
        if (
          boundConsoleAccount &&
          boundConsoleAccount.isActive === true &&
          boundConsoleAccount.status === 'active' &&
          this._isSchedulable(boundConsoleAccount.schedulable)
        ) {
          // 检查是否临时不可用
          const isTempUnavailable = await this.isAccountTemporarilyUnavailable(
            boundConsoleAccount.id,
            'claude-console'
          )
          if (isTempUnavailable) {
            logger.warn(
              `⏱️ Bound Claude Console account ${boundConsoleAccount.id} is temporarily unavailable, falling back to pool`
            )
          } else {
            logger.info(
              `🎯 Using bound dedicated Claude Console account: ${boundConsoleAccount.name} (${apiKeyData.claudeConsoleAccountId}) for API key ${apiKeyData.name}`
            )
            return {
              accountId: apiKeyData.claudeConsoleAccountId,
              accountType: 'claude-console'
            }
          }
        } else {
          logger.warn(
            `⚠️ Bound Claude Console account ${apiKeyData.claudeConsoleAccountId} is not available (isActive: ${boundConsoleAccount?.isActive}, status: ${boundConsoleAccount?.status}, schedulable: ${boundConsoleAccount?.schedulable}), falling back to pool`
          )
        }
      }

      // 3. 检查Bedrock账户绑定
      if (apiKeyData.bedrockAccountId) {
        const boundBedrockAccountResult = await bedrockAccountService.getAccount(
          apiKeyData.bedrockAccountId
        )
        if (
          boundBedrockAccountResult.success &&
          boundBedrockAccountResult.data.isActive === true &&
          this._isSchedulable(boundBedrockAccountResult.data.schedulable)
        ) {
          // 检查是否临时不可用
          const isTempUnavailable = await this.isAccountTemporarilyUnavailable(
            apiKeyData.bedrockAccountId,
            'bedrock'
          )
          if (isTempUnavailable) {
            logger.warn(
              `⏱️ Bound Bedrock account ${apiKeyData.bedrockAccountId} is temporarily unavailable, falling back to pool`
            )
          } else {
            logger.info(
              `🎯 Using bound dedicated Bedrock account: ${boundBedrockAccountResult.data.name} (${apiKeyData.bedrockAccountId}) for API key ${apiKeyData.name}`
            )
            return {
              accountId: apiKeyData.bedrockAccountId,
              accountType: 'bedrock'
            }
          }
        } else {
          logger.warn(
            `⚠️ Bound Bedrock account ${apiKeyData.bedrockAccountId} is not available (isActive: ${boundBedrockAccountResult?.data?.isActive}, schedulable: ${boundBedrockAccountResult?.data?.schedulable}), falling back to pool`
          )
        }
      }

      // CCR 账户不支持绑定（仅通过 ccr, 前缀进行 CCR 路由）

      // 如果有会话哈希，检查是否有已映射的账户
      if (sessionHash) {
        const mappedAccount = await this._getSessionMapping(sessionHash)
        if (mappedAccount) {
          // 当本次请求不是 CCR 前缀时，不允许使用指向 CCR 的粘性会话映射
          if (vendor !== 'ccr' && mappedAccount.accountType === 'ccr') {
            logger.info(
              `ℹ️ Skipping CCR sticky session mapping for non-CCR request; removing mapping for session ${sessionHash}`
            )
            await this._deleteSessionMapping(sessionHash)
          } else {
            // 验证映射的账户是否仍然可用
            const isAvailable = await this._isAccountAvailable(
              mappedAccount.accountId,
              mappedAccount.accountType,
              effectiveModel
            )
            if (isAvailable) {
              // 🚀 智能会话续期：剩余时间少于14天时自动续期到15天（续期正确的 unified 映射键）
              await this._extendSessionMappingTTL(sessionHash)
              logger.info(
                `🎯 Using sticky session account: ${mappedAccount.accountId} (${mappedAccount.accountType}) for session ${sessionHash}`
              )
              return mappedAccount
            } else {
              logger.warn(
                `⚠️ Mapped account ${mappedAccount.accountId} is no longer available, selecting new account`
              )
              await this._deleteSessionMapping(sessionHash)
            }
          }
        }
      }

      // 获取所有可用账户（传递请求的模型进行过滤）
      const availableAccounts = await this._getAllAvailableAccounts(
        apiKeyData,
        effectiveModel,
        false, // 仅前缀才走 CCR：默认池不包含 CCR 账户
        decisionTrace
      )

      if (availableAccounts.length === 0) {
        // 提供更详细的错误信息
        if (effectiveModel) {
          throw new Error(
            `No available Claude accounts support the requested model: ${effectiveModel}`
          )
        } else {
          throw new Error('No available Claude accounts (neither official nor console)')
        }
      }

      // 按优先级和最后使用时间排序
      const sortedAccounts = this._sortAccountsByPriority(availableAccounts)

      // 选择第一个账户
      const selectedAccount = sortedAccounts[0]

      // 如果有会话哈希，建立新的映射
      if (sessionHash) {
        await this._setSessionMapping(
          sessionHash,
          selectedAccount.accountId,
          selectedAccount.accountType,
          apiKeyData?.id || null
        )
        logger.info(
          `🎯 Created new sticky session mapping: ${selectedAccount.name} (${selectedAccount.accountId}, ${selectedAccount.accountType}) for session ${sessionHash}`
        )
      }

      logger.info(
        `🎯 Selected account: ${selectedAccount.name} (${selectedAccount.accountId}, ${selectedAccount.accountType}) with priority ${selectedAccount.priority} for API key ${apiKeyData.name}`
      )

      return {
        accountId: selectedAccount.accountId,
        accountType: selectedAccount.accountType
      }
    } catch (error) {
      logger.error('❌ Failed to select account for API key:', error)
      throw error
    }
  }

  // 📋 获取所有可用账户（合并官方和Console）
  async _getAllAvailableAccounts(
    apiKeyData,
    requestedModel = null,
    includeCcr = false,
    decisionTrace = null
  ) {
    const availableAccounts = []
    const record = (account, accountType, reason) =>
      this._recordDecisionExclusion(decisionTrace, account, accountType, reason)
    const isOpusRequest =
      requestedModel && typeof requestedModel === 'string'
        ? requestedModel.toLowerCase().includes('opus')
        : false

    // 如果API Key绑定了专属账户，优先返回
    // 1. 检查Claude OAuth账户绑定
    if (apiKeyData.claudeAccountId) {
      const boundAccount = await redis.getClaudeAccount(apiKeyData.claudeAccountId)
      if (
        boundAccount &&
        boundAccount.isActive === 'true' &&
        boundAccount.status !== 'error' &&
        boundAccount.status !== 'blocked' &&
        boundAccount.status !== 'temp_error'
      ) {
        const isTempUnavailable = await this.isAccountTemporarilyUnavailable(
          boundAccount.id,
          'claude-official'
        )
        if (isTempUnavailable) {
          record(boundAccount, 'claude-official', 'temporarily_unavailable')
          logger.warn(
            `⏱️ Bound Claude OAuth account ${apiKeyData.claudeAccountId} is temporarily unavailable in pool selection`
          )
        } else {
          const schedulingState = await this._checkClaudeOfficialSchedulingState(
            boundAccount,
            requestedModel
          )
          const latestBoundAccount = schedulingState.account || boundAccount
          if (schedulingState.reason === 'rate_limited') {
            record(boundAccount, 'claude-official', 'rate_limited')
            const rateInfo = await claudeAccountService.getAccountRateLimitInfoForModel(
              boundAccount.id,
              requestedModel
            )
            const error = new Error('Dedicated Claude account is rate limited')
            error.code = 'CLAUDE_DEDICATED_RATE_LIMITED'
            error.accountId = boundAccount.id
            error.rateLimitEndAt = rateInfo?.rateLimitEndAt || boundAccount.rateLimitEndAt || null
            error.rateLimitBucket = rateInfo?.bucket || null
            throw error
          }

          if (!schedulingState.canUse) {
            record(boundAccount, 'claude-official', schedulingState.reason || 'not_schedulable')
            logger.warn(
              `⚠️ Bound Claude OAuth account ${apiKeyData.claudeAccountId} is not schedulable (schedulable: ${latestBoundAccount?.schedulable})`
            )
          } else {
            logger.info(
              `🎯 Using bound dedicated Claude OAuth account: ${latestBoundAccount.name} (${apiKeyData.claudeAccountId})`
            )
            return [
              {
                ...latestBoundAccount,
                accountId: latestBoundAccount.id,
                accountType: 'claude-official',
                priority: parseInt(latestBoundAccount.priority) || 50,
                lastUsedAt: latestBoundAccount.lastUsedAt || '0'
              }
            ]
          }
        }
      } else {
        record(
          boundAccount || { id: apiKeyData.claudeAccountId },
          'claude-official',
          'inactive_or_error'
        )
        logger.warn(
          `⚠️ Bound Claude OAuth account ${apiKeyData.claudeAccountId} is not available (isActive: ${boundAccount?.isActive}, status: ${boundAccount?.status})`
        )
      }
    }

    // 2. 检查Claude Console账户绑定
    if (apiKeyData.claudeConsoleAccountId) {
      const boundConsoleAccount = await claudeConsoleAccountService.getAccount(
        apiKeyData.claudeConsoleAccountId
      )
      if (
        boundConsoleAccount &&
        boundConsoleAccount.isActive === true &&
        boundConsoleAccount.status === 'active' &&
        this._isSchedulable(boundConsoleAccount.schedulable)
      ) {
        // 主动触发一次额度检查
        try {
          await claudeConsoleAccountService.checkQuotaUsage(boundConsoleAccount.id)
        } catch (e) {
          logger.warn(
            `Failed to check quota for bound Claude Console account ${boundConsoleAccount.name}: ${e.message}`
          )
          // 继续使用该账号
        }

        // 检查限流状态和额度状态
        const isRateLimited = await claudeConsoleAccountService.isAccountRateLimited(
          boundConsoleAccount.id
        )
        const isQuotaExceeded = await claudeConsoleAccountService.isAccountQuotaExceeded(
          boundConsoleAccount.id
        )

        if (!isRateLimited && !isQuotaExceeded) {
          logger.info(
            `🎯 Using bound dedicated Claude Console account: ${boundConsoleAccount.name} (${apiKeyData.claudeConsoleAccountId})`
          )
          return [
            {
              ...boundConsoleAccount,
              accountId: boundConsoleAccount.id,
              accountType: 'claude-console',
              priority: parseInt(boundConsoleAccount.priority) || 50,
              lastUsedAt: boundConsoleAccount.lastUsedAt || '0'
            }
          ]
        }
        if (isRateLimited) {
          record(boundConsoleAccount, 'claude-console', 'rate_limited')
        }
        if (isQuotaExceeded) {
          record(boundConsoleAccount, 'claude-console', 'quota_exceeded')
        }
      } else {
        record(
          boundConsoleAccount || { id: apiKeyData.claudeConsoleAccountId },
          'claude-console',
          'inactive_or_error'
        )
        logger.warn(
          `⚠️ Bound Claude Console account ${apiKeyData.claudeConsoleAccountId} is not available (isActive: ${boundConsoleAccount?.isActive}, status: ${boundConsoleAccount?.status}, schedulable: ${boundConsoleAccount?.schedulable})`
        )
      }
    }

    // 3. 检查Bedrock账户绑定
    if (apiKeyData.bedrockAccountId) {
      const boundBedrockAccountResult = await bedrockAccountService.getAccount(
        apiKeyData.bedrockAccountId
      )
      if (
        boundBedrockAccountResult.success &&
        boundBedrockAccountResult.data.isActive === true &&
        this._isSchedulable(boundBedrockAccountResult.data.schedulable)
      ) {
        logger.info(
          `🎯 Using bound dedicated Bedrock account: ${boundBedrockAccountResult.data.name} (${apiKeyData.bedrockAccountId})`
        )
        return [
          {
            ...boundBedrockAccountResult.data,
            accountId: boundBedrockAccountResult.data.id,
            accountType: 'bedrock',
            priority: parseInt(boundBedrockAccountResult.data.priority) || 50,
            lastUsedAt: boundBedrockAccountResult.data.lastUsedAt || '0'
          }
        ]
      } else {
        record(
          boundBedrockAccountResult?.data || { id: apiKeyData.bedrockAccountId },
          'bedrock',
          'inactive_or_not_schedulable'
        )
        logger.warn(
          `⚠️ Bound Bedrock account ${apiKeyData.bedrockAccountId} is not available (isActive: ${boundBedrockAccountResult?.data?.isActive}, schedulable: ${boundBedrockAccountResult?.data?.schedulable})`
        )
      }
    }

    // 获取官方Claude账户（共享池）
    const claudeAccounts = await redis.getAllClaudeAccounts()
    for (const account of claudeAccounts) {
      if (
        account.isActive === 'true' &&
        account.status !== 'error' &&
        account.status !== 'blocked' &&
        account.status !== 'temp_error' &&
        (account.accountType === 'shared' || !account.accountType) // 兼容旧数据
      ) {
        // 检查是否可调度

        // 检查模型支持
        if (!this._isModelSupportedByAccount(account, 'claude-official', requestedModel)) {
          record(account, 'claude-official', 'model_not_supported')
          continue
        }

        // 检查是否临时不可用
        const isTempUnavailable = await this.isAccountTemporarilyUnavailable(
          account.id,
          'claude-official'
        )
        if (isTempUnavailable) {
          record(account, 'claude-official', 'temporarily_unavailable')
          logger.debug(
            `⏭️ Skipping Claude Official account ${account.name} - temporarily unavailable`
          )
          continue
        }

        const schedulingState = await this._checkClaudeOfficialSchedulingState(
          account,
          requestedModel
        )
        if (!schedulingState.canUse) {
          record(account, 'claude-official', schedulingState.reason || 'not_schedulable')
          logger.debug(
            `⏭️ Skipping Claude Official account ${account.name} - ${schedulingState.reason}`
          )
          continue
        }
        const latestAccount = schedulingState.account || account

        if (isOpusRequest) {
          const isOpusRateLimited = await claudeAccountService.isAccountOpusRateLimited(account.id)
          if (isOpusRateLimited) {
            record(account, 'claude-official', 'rate_limited')
            logger.debug(
              `🚫 Skipping account ${account.name} (${account.id}) due to active Opus limit`
            )
            continue
          }
        }

        availableAccounts.push({
          ...latestAccount,
          accountId: latestAccount.id,
          accountType: 'claude-official',
          priority: parseInt(latestAccount.priority) || 50, // 默认优先级50
          lastUsedAt: latestAccount.lastUsedAt || '0'
        })
      } else {
        const reason =
          account.isActive !== 'true'
            ? 'inactive'
            : ['error', 'blocked', 'temp_error'].includes(account.status)
              ? 'invalid_status'
              : 'not_shared_pool'
        record(account, 'claude-official', reason)
      }
    }

    // 获取Claude Console账户
    // 调度热路径不需要预先查询 activeTaskCount，后续会按需批量检查并发
    const consoleAccounts = await claudeConsoleAccountService.getAllAccounts(false)
    logger.debug(`📋 Found ${consoleAccounts.length} total Claude Console accounts`)

    // 🔢 统计Console账户并发排除情况
    let consoleAccountsEligibleCount = 0 // 符合基本条件的账户数
    let consoleAccountsExcludedByConcurrency = 0 // 因并发满额被排除的账户数

    // 🚀 收集需要并发检查的账户ID列表（批量查询优化）
    const accountsNeedingConcurrencyCheck = []

    for (const account of consoleAccounts) {
      // 主动检查封禁状态并尝试恢复（在过滤之前执行，确保可以恢复被封禁的账户）
      const wasBlocked = await claudeConsoleAccountService.isAccountBlocked(account.id)

      // 如果账户之前被封禁但现在已恢复，重新获取最新状态
      let currentAccount = account
      if (wasBlocked === false && account.status === 'account_blocked') {
        // 可能刚刚被恢复，重新获取账户状态
        const freshAccount = await claudeConsoleAccountService.getAccount(account.id)
        if (freshAccount) {
          currentAccount = freshAccount
          logger.debug(`🔄 Account ${account.name} was recovered from blocked status`)
        }
      }

      logger.debug(
        `🔍 Checking Claude Console account: ${currentAccount.name} - isActive: ${currentAccount.isActive}, status: ${currentAccount.status}, accountType: ${currentAccount.accountType}, schedulable: ${currentAccount.schedulable}`
      )

      // 注意：getAllAccounts返回的isActive是布尔值，getAccount返回的也是布尔值
      if (
        currentAccount.isActive === true &&
        currentAccount.status === 'active' &&
        currentAccount.accountType === 'shared' &&
        this._isSchedulable(currentAccount.schedulable)
      ) {
        // 检查是否可调度

        // 检查模型支持
        if (!this._isModelSupportedByAccount(currentAccount, 'claude-console', requestedModel)) {
          record(currentAccount, 'claude-console', 'model_not_supported')
          continue
        }

        // 检查订阅是否过期
        if (claudeConsoleAccountService.isSubscriptionExpired(currentAccount)) {
          record(currentAccount, 'claude-console', 'subscription_expired')
          logger.debug(
            `⏰ Claude Console account ${currentAccount.name} (${currentAccount.id}) expired at ${currentAccount.subscriptionExpiresAt}`
          )
          continue
        }

        // 主动触发一次额度检查，确保状态即时生效
        try {
          await claudeConsoleAccountService.checkQuotaUsage(currentAccount.id)
        } catch (e) {
          logger.warn(
            `Failed to check quota for Claude Console account ${currentAccount.name}: ${e.message}`
          )
          // 继续处理该账号
        }

        // 检查是否临时不可用
        const isTempUnavailable = await this.isAccountTemporarilyUnavailable(
          currentAccount.id,
          'claude-console'
        )
        if (isTempUnavailable) {
          record(currentAccount, 'claude-console', 'temporarily_unavailable')
          logger.debug(
            `⏭️ Skipping Claude Console account ${currentAccount.name} - temporarily unavailable`
          )
          continue
        }

        // 检查是否被限流
        const isRateLimited = await claudeConsoleAccountService.isAccountRateLimited(
          currentAccount.id
        )
        const isQuotaExceeded = await claudeConsoleAccountService.isAccountQuotaExceeded(
          currentAccount.id
        )

        // 🔢 记录符合基本条件的账户（通过了前面所有检查，但可能因并发被排除）
        if (!isRateLimited && !isQuotaExceeded) {
          consoleAccountsEligibleCount++
          // 🚀 将符合条件且需要并发检查的账户加入批量查询列表
          if (currentAccount.maxConcurrentTasks > 0) {
            accountsNeedingConcurrencyCheck.push(currentAccount)
          } else {
            // 未配置并发限制的账户直接加入可用池
            availableAccounts.push({
              ...currentAccount,
              accountId: currentAccount.id,
              accountType: 'claude-console',
              priority: parseInt(currentAccount.priority) || 50,
              lastUsedAt: currentAccount.lastUsedAt || '0'
            })
            logger.debug(
              `✅ Added Claude Console account to available pool: ${currentAccount.name} (priority: ${currentAccount.priority}, no concurrency limit)`
            )
          }
        } else {
          if (isRateLimited) {
            record(currentAccount, 'claude-console', 'rate_limited')
            logger.warn(`⚠️ Claude Console account ${currentAccount.name} is rate limited`)
          }
          if (isQuotaExceeded) {
            record(currentAccount, 'claude-console', 'quota_exceeded')
            logger.warn(`💰 Claude Console account ${currentAccount.name} quota exceeded`)
          }
        }
      } else {
        const reason =
          currentAccount.isActive !== true
            ? 'inactive'
            : currentAccount.status !== 'active'
              ? 'invalid_status'
              : currentAccount.accountType !== 'shared'
                ? 'not_shared_pool'
                : 'not_schedulable'
        record(currentAccount, 'claude-console', reason)
        logger.debug(
          `❌ Claude Console account ${currentAccount.name} not eligible - isActive: ${currentAccount.isActive}, status: ${currentAccount.status}, accountType: ${currentAccount.accountType}, schedulable: ${currentAccount.schedulable}`
        )
      }
    }

    // 🚀 批量查询所有账户的并发数（Promise.all 并行执行）
    if (accountsNeedingConcurrencyCheck.length > 0) {
      logger.debug(
        `🚀 Batch checking concurrency for ${accountsNeedingConcurrencyCheck.length} accounts`
      )

      const concurrencyCheckPromises = accountsNeedingConcurrencyCheck.map((account) =>
        redis.getConsoleAccountConcurrency(account.id).then((currentConcurrency) => ({
          account,
          currentConcurrency
        }))
      )

      const concurrencyResults = await Promise.all(concurrencyCheckPromises)

      // 处理批量查询结果
      for (const { account, currentConcurrency } of concurrencyResults) {
        const isConcurrencyFull = currentConcurrency >= account.maxConcurrentTasks

        if (!isConcurrencyFull) {
          availableAccounts.push({
            ...account,
            accountId: account.id,
            accountType: 'claude-console',
            priority: parseInt(account.priority) || 50,
            lastUsedAt: account.lastUsedAt || '0'
          })
          logger.debug(
            `✅ Added Claude Console account to available pool: ${account.name} (priority: ${account.priority}, concurrency: ${currentConcurrency}/${account.maxConcurrentTasks})`
          )
        } else {
          // 🔢 因并发满额被排除，计数器加1
          consoleAccountsExcludedByConcurrency++
          record(account, 'claude-console', 'concurrency_full')
          logger.warn(
            `⚠️ Claude Console account ${account.name} reached concurrency limit: ${currentConcurrency}/${account.maxConcurrentTasks}`
          )
        }
      }
    }

    // 获取Bedrock账户（共享池）
    const bedrockAccountsResult = await bedrockAccountService.getAllAccounts()
    if (bedrockAccountsResult.success) {
      const bedrockAccounts = bedrockAccountsResult.data
      logger.debug(`📋 Found ${bedrockAccounts.length} total Bedrock accounts`)

      for (const account of bedrockAccounts) {
        logger.debug(
          `🔍 Checking Bedrock account: ${account.name} - isActive: ${account.isActive}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
        )

        if (
          account.isActive === true &&
          account.accountType === 'shared' &&
          this._isSchedulable(account.schedulable)
        ) {
          // 检查是否临时不可用
          const isTempUnavailable = await this.isAccountTemporarilyUnavailable(
            account.id,
            'bedrock'
          )
          if (isTempUnavailable) {
            record(account, 'bedrock', 'temporarily_unavailable')
            logger.debug(`⏭️ Skipping Bedrock account ${account.name} - temporarily unavailable`)
            continue
          }

          availableAccounts.push({
            ...account,
            accountId: account.id,
            accountType: 'bedrock',
            priority: parseInt(account.priority) || 50,
            lastUsedAt: account.lastUsedAt || '0'
          })
          logger.debug(
            `✅ Added Bedrock account to available pool: ${account.name} (priority: ${account.priority})`
          )
        } else {
          const reason =
            account.isActive !== true
              ? 'inactive'
              : account.accountType !== 'shared'
                ? 'not_shared_pool'
                : 'not_schedulable'
          record(account, 'bedrock', reason)
          logger.debug(
            `❌ Bedrock account ${account.name} not eligible - isActive: ${account.isActive}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
          )
        }
      }
    }

    // 获取CCR账户（共享池）- 仅当明确要求包含时
    if (includeCcr) {
      const ccrAccounts = await ccrAccountService.getAllAccounts()
      logger.debug(`📋 Found ${ccrAccounts.length} total CCR accounts`)

      for (const account of ccrAccounts) {
        logger.debug(
          `🔍 Checking CCR account: ${account.name} - isActive: ${account.isActive}, status: ${account.status}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
        )

        if (
          account.isActive === true &&
          account.status === 'active' &&
          account.accountType === 'shared' &&
          this._isSchedulable(account.schedulable)
        ) {
          // 检查模型支持
          if (!this._isModelSupportedByAccount(account, 'ccr', requestedModel)) {
            record(account, 'ccr', 'model_not_supported')
            continue
          }

          // 检查订阅是否过期
          if (ccrAccountService.isSubscriptionExpired(account)) {
            record(account, 'ccr', 'subscription_expired')
            logger.debug(
              `⏰ CCR account ${account.name} (${account.id}) expired at ${account.subscriptionExpiresAt}`
            )
            continue
          }

          // 检查是否临时不可用
          const isTempUnavailable = await this.isAccountTemporarilyUnavailable(account.id, 'ccr')
          if (isTempUnavailable) {
            record(account, 'ccr', 'temporarily_unavailable')
            logger.debug(`⏭️ Skipping CCR account ${account.name} - temporarily unavailable`)
            continue
          }

          // 检查是否被限流
          const isRateLimited = await ccrAccountService.isAccountRateLimited(account.id)
          const isQuotaExceeded = await ccrAccountService.isAccountQuotaExceeded(account.id)

          if (!isRateLimited && !isQuotaExceeded) {
            availableAccounts.push({
              ...account,
              accountId: account.id,
              accountType: 'ccr',
              priority: parseInt(account.priority) || 50,
              lastUsedAt: account.lastUsedAt || '0'
            })
            logger.debug(
              `✅ Added CCR account to available pool: ${account.name} (priority: ${account.priority})`
            )
          } else {
            if (isRateLimited) {
              record(account, 'ccr', 'rate_limited')
              logger.warn(`⚠️ CCR account ${account.name} is rate limited`)
            }
            if (isQuotaExceeded) {
              record(account, 'ccr', 'quota_exceeded')
              logger.warn(`💰 CCR account ${account.name} quota exceeded`)
            }
          }
        } else {
          const reason =
            account.isActive !== true
              ? 'inactive'
              : account.status !== 'active'
                ? 'invalid_status'
                : account.accountType !== 'shared'
                  ? 'not_shared_pool'
                  : 'not_schedulable'
          record(account, 'ccr', reason)
          logger.debug(
            `❌ CCR account ${account.name} not eligible - isActive: ${account.isActive}, status: ${account.status}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
          )
        }
      }
    }

    logger.info(
      `📊 Total available accounts: ${availableAccounts.length} (Claude: ${availableAccounts.filter((a) => a.accountType === 'claude-official').length}, Console: ${availableAccounts.filter((a) => a.accountType === 'claude-console').length}, Bedrock: ${availableAccounts.filter((a) => a.accountType === 'bedrock').length}, CCR: ${availableAccounts.filter((a) => a.accountType === 'ccr').length})`
    )

    // 🚨 最终检查：只有在没有任何可用账户时，才根据Console并发排除情况抛出专用错误码
    if (availableAccounts.length === 0) {
      // 如果所有Console账户都因并发满额被排除，抛出专用错误码（503）
      if (
        consoleAccountsEligibleCount > 0 &&
        consoleAccountsExcludedByConcurrency === consoleAccountsEligibleCount
      ) {
        logger.error(
          `❌ All ${consoleAccountsEligibleCount} eligible Console accounts are at concurrency limit (no other account types available)`
        )
        const error = new Error(
          'All available Claude Console accounts have reached their concurrency limit'
        )
        error.code = 'CONSOLE_ACCOUNT_CONCURRENCY_FULL'
        throw error
      }
      // 否则走通用的"无可用账户"错误处理（由上层 selectAccountForApiKey 捕获）
    }

    return availableAccounts
  }

  // 🔢 按优先级和最后使用时间排序账户
  _sortAccountsByPriority(accounts) {
    return accounts.sort((a, b) => {
      // 首先按优先级排序（数字越小优先级越高）
      if (a.priority !== b.priority) {
        return a.priority - b.priority
      }

      // 优先级相同时，按最后使用时间排序（最久未使用的优先）
      const aLastUsed = new Date(a.lastUsedAt || 0).getTime()
      const bLastUsed = new Date(b.lastUsedAt || 0).getTime()
      return aLastUsed - bLastUsed
    })
  }

  // 🔍 检查账户是否可用
  async _isAccountAvailable(accountId, accountType, requestedModel = null) {
    try {
      if (accountType === 'claude-official') {
        const account = await redis.getClaudeAccount(accountId)
        if (
          !account ||
          account.isActive !== 'true' ||
          account.status === 'error' ||
          account.status === 'temp_error'
        ) {
          return false
        }
        // 检查模型兼容性
        if (
          !this._isModelSupportedByAccount(
            account,
            'claude-official',
            requestedModel,
            'in session check'
          )
        ) {
          return false
        }

        const schedulingState = await this._checkClaudeOfficialSchedulingState(
          account,
          requestedModel
        )
        if (!schedulingState.canUse) {
          logger.info(`🚫 Account ${accountId} skipped in session check: ${schedulingState.reason}`)
          return false
        }

        // 检查是否过载
        const isOverloaded = await claudeAccountService.isAccountOverloaded(accountId)
        if (isOverloaded) {
          return false
        }

        if (
          requestedModel &&
          typeof requestedModel === 'string' &&
          requestedModel.toLowerCase().includes('opus')
        ) {
          const isOpusRateLimited = await claudeAccountService.isAccountOpusRateLimited(accountId)
          if (isOpusRateLimited) {
            logger.debug(`🚫 Account ${accountId} skipped due to active Opus limit (session check)`)
            return false
          }
        }

        return true
      } else if (accountType === 'claude-console') {
        const account = await claudeConsoleAccountService.getAccount(accountId)
        if (!account || !account.isActive) {
          return false
        }
        // 检查账户状态
        if (
          account.status !== 'active' &&
          account.status !== 'unauthorized' &&
          account.status !== 'overloaded'
        ) {
          return false
        }
        // 检查是否可调度
        if (!this._isSchedulable(account.schedulable)) {
          logger.info(`🚫 Claude Console account ${accountId} is not schedulable`)
          return false
        }
        // 检查模型支持
        if (
          !this._isModelSupportedByAccount(
            account,
            'claude-console',
            requestedModel,
            'in session check'
          )
        ) {
          return false
        }
        // 检查订阅是否过期
        if (claudeConsoleAccountService.isSubscriptionExpired(account)) {
          logger.debug(
            `⏰ Claude Console account ${account.name} (${accountId}) expired at ${account.subscriptionExpiresAt} (session check)`
          )
          return false
        }
        // 检查是否超额
        try {
          await claudeConsoleAccountService.checkQuotaUsage(accountId)
        } catch (e) {
          logger.warn(`Failed to check quota for Claude Console account ${accountId}: ${e.message}`)
          // 继续处理
        }

        // 检查是否被限流
        if (await claudeConsoleAccountService.isAccountRateLimited(accountId)) {
          return false
        }
        if (await claudeConsoleAccountService.isAccountQuotaExceeded(accountId)) {
          return false
        }
        // 检查是否未授权（401错误）
        if (account.status === 'unauthorized') {
          return false
        }
        // 检查是否过载（529错误）
        if (await claudeConsoleAccountService.isAccountOverloaded(accountId)) {
          return false
        }

        // 检查并发限制（预检查，真正的原子抢占在 relayService 中进行）
        if (account.maxConcurrentTasks > 0) {
          const currentConcurrency = await redis.getConsoleAccountConcurrency(accountId)
          if (currentConcurrency >= account.maxConcurrentTasks) {
            logger.info(
              `🚫 Claude Console account ${accountId} reached concurrency limit: ${currentConcurrency}/${account.maxConcurrentTasks} (pre-check)`
            )
            return false
          }
        }

        return true
      } else if (accountType === 'bedrock') {
        const accountResult = await bedrockAccountService.getAccount(accountId)
        if (!accountResult.success || !accountResult.data.isActive) {
          return false
        }
        // 检查是否可调度
        if (!this._isSchedulable(accountResult.data.schedulable)) {
          logger.info(`🚫 Bedrock account ${accountId} is not schedulable`)
          return false
        }
        // Bedrock账户暂不需要限流检查，因为AWS管理限流
        return true
      } else if (accountType === 'ccr') {
        const account = await ccrAccountService.getAccount(accountId)
        if (!account || !account.isActive) {
          return false
        }
        // 检查账户状态
        if (
          account.status !== 'active' &&
          account.status !== 'unauthorized' &&
          account.status !== 'overloaded'
        ) {
          return false
        }
        // 检查是否可调度
        if (!this._isSchedulable(account.schedulable)) {
          logger.info(`🚫 CCR account ${accountId} is not schedulable`)
          return false
        }
        // 检查模型支持
        if (!this._isModelSupportedByAccount(account, 'ccr', requestedModel, 'in session check')) {
          return false
        }
        // 检查订阅是否过期
        if (ccrAccountService.isSubscriptionExpired(account)) {
          logger.debug(
            `⏰ CCR account ${account.name} (${accountId}) expired at ${account.subscriptionExpiresAt} (session check)`
          )
          return false
        }
        // 检查是否超额
        try {
          await ccrAccountService.checkQuotaUsage(accountId)
        } catch (e) {
          logger.warn(`Failed to check quota for CCR account ${accountId}: ${e.message}`)
          // 继续处理
        }

        // 检查是否被限流
        if (await ccrAccountService.isAccountRateLimited(accountId)) {
          return false
        }
        if (await ccrAccountService.isAccountQuotaExceeded(accountId)) {
          return false
        }
        // 检查是否未授权（401错误）
        if (account.status === 'unauthorized') {
          return false
        }
        // 检查是否过载（529错误）
        if (await ccrAccountService.isAccountOverloaded(accountId)) {
          return false
        }
        return true
      }
      return false
    } catch (error) {
      logger.warn(`⚠️ Failed to check account availability: ${accountId}`, error)
      return false
    }
  }

  // 🔗 获取会话映射
  async _getSessionMapping(sessionHash) {
    const client = redis.getClientSafe()
    const mappingData = await client.get(`${this.SESSION_MAPPING_PREFIX}${sessionHash}`)

    if (mappingData) {
      try {
        return JSON.parse(mappingData)
      } catch (error) {
        logger.warn('⚠️ Failed to parse session mapping:', error)
        return null
      }
    }

    return null
  }

  // 💾 设置会话映射
  async _resolveStickyPolicy() {
    const appConfig = require('../../config/config')
    let autoRenewEnabledOverride

    try {
      const runtimeConfig = await claudeRelayConfigService.getConfig()
      if (typeof runtimeConfig?.stickySessionAutoRenewalEnabled === 'boolean') {
        autoRenewEnabledOverride = runtimeConfig.stickySessionAutoRenewalEnabled
      }
    } catch (error) {
      logger.debug('Failed to load runtime sticky policy override for Claude scheduler:', error)
    }

    return resolveStickySessionPolicy(appConfig.session, {
      autoRenewEnabledOverride
    })
  }

  async _setSessionMapping(sessionHash, accountId, accountType, apiKeyId = null) {
    const client = redis.getClientSafe()
    const mappingPayload = { accountId, accountType }
    if (apiKeyId) {
      mappingPayload.apiKeyId = apiKeyId
    }
    const mappingData = JSON.stringify(mappingPayload)
    // 依据配置设置TTL（小时）
    const policy = await this._resolveStickyPolicy()
    await client.setex(
      `${this.SESSION_MAPPING_PREFIX}${sessionHash}`,
      policy.fullTTLSeconds,
      mappingData
    )
  }

  // 🗑️ 删除会话映射
  async _deleteSessionMapping(sessionHash) {
    const client = redis.getClientSafe()
    await client.del(`${this.SESSION_MAPPING_PREFIX}${sessionHash}`)
  }

  /**
   * 🧹 公共方法：清理粘性会话映射（用于并发满额时的降级处理）
   * @param {string} sessionHash - 会话哈希值
   */
  async clearSessionMapping(sessionHash) {
    // 防御空会话哈希
    if (!sessionHash || typeof sessionHash !== 'string') {
      logger.debug('⚠️ Skipping session mapping clear - invalid sessionHash')
      return
    }

    try {
      await this._deleteSessionMapping(sessionHash)
      logger.info(
        `🧹 Cleared sticky session mapping for session: ${sessionHash.substring(0, 8)}...`
      )
    } catch (error) {
      logger.error(`❌ Failed to clear session mapping for ${sessionHash}:`, error)
      throw error
    }
  }

  // 🔁 续期统一调度会话映射TTL（针对 unified_claude_session_mapping:* 键），遵循会话配置
  async _extendSessionMappingTTL(sessionHash) {
    try {
      const client = redis.getClientSafe()
      const key = `${this.SESSION_MAPPING_PREFIX}${sessionHash}`
      const remainingTTL = await client.ttl(key)

      // -2: key 不存在；-1: 无过期时间
      if (remainingTTL === -2) {
        return false
      }
      if (remainingTTL === -1) {
        return true
      }

      const policy = await this._resolveStickyPolicy()

      if (policy.renewalThresholdSeconds <= 0) {
        return true
      }

      if (remainingTTL < policy.renewalThresholdSeconds) {
        await client.expire(key, policy.fullTTLSeconds)
        logger.debug(
          `Renewed unified Claude session TTL: ${sessionHash} (was ${Math.round(remainingTTL / 60)}m, renewed to ${policy.ttlHours}h)`
        )
      } else {
        logger.debug(
          `Unified Claude session TTL sufficient: ${sessionHash} (remaining ${Math.round(remainingTTL / 60)}m)`
        )
      }
      return true
    } catch (error) {
      logger.error('❌ Failed to extend unified session TTL:', error)
      return false
    }
  }

  // ⏱️ 标记账户为临时不可用状态（用于5xx等临时故障，默认5分钟后自动恢复）
  async markAccountTemporarilyUnavailable(
    accountId,
    accountType,
    sessionHash = null,
    ttlSeconds = 300
  ) {
    try {
      const client = redis.getClientSafe()
      const key = `temp_unavailable:${accountType}:${accountId}`
      const parsedTtl = Number(ttlSeconds)
      const configuredMaxTtl = Number(config.upstreamError?.maxCustomTtlSeconds)
      const maxTtl =
        Number.isFinite(configuredMaxTtl) && configuredMaxTtl > 0 ? configuredMaxTtl : 1800
      const normalizedTtl = Number.isFinite(parsedTtl) && parsedTtl > 0 ? Math.ceil(parsedTtl) : 300
      const cappedTtl = Math.min(normalizedTtl, maxTtl)
      if (cappedTtl < normalizedTtl) {
        logger.warn(
          `⚠️ Temp-unavailable TTL ${normalizedTtl}s for account ${accountId} exceeds cap, clamping to ${cappedTtl}s`
        )
      }
      await client.setex(key, cappedTtl, '1')
      if (sessionHash) {
        await this._deleteSessionMapping(sessionHash)
      }
      logger.warn(
        `⏱️ Account ${accountId} (${accountType}) marked temporarily unavailable for ${cappedTtl}s`
      )
      return { success: true }
    } catch (error) {
      logger.error(`❌ Failed to mark account temporarily unavailable: ${accountId}`, error)
      return { success: false }
    }
  }

  // 🔍 检查账户是否临时不可用
  async isAccountTemporarilyUnavailable(accountId, accountType) {
    try {
      const client = redis.getClientSafe()
      const key = `temp_unavailable:${accountType}:${accountId}`
      return (await client.exists(key)) === 1
    } catch (error) {
      logger.error(`❌ Failed to check temp unavailable status: ${accountId}`, error)
      return false
    }
  }

  // 🚫 标记账户为限流状态
  async markAccountRateLimited(
    accountId,
    accountType,
    sessionHash = null,
    rateLimitResetTimestamp = null
  ) {
    try {
      if (accountType === 'claude-official') {
        await claudeAccountService.markAccountRateLimited(
          accountId,
          sessionHash,
          rateLimitResetTimestamp
        )
      } else if (accountType === 'claude-console') {
        await claudeConsoleAccountService.markAccountRateLimited(accountId)
      } else if (accountType === 'ccr') {
        await ccrAccountService.markAccountRateLimited(accountId)
      }

      // 删除会话映射
      if (sessionHash) {
        await this._deleteSessionMapping(sessionHash)
      }

      return { success: true }
    } catch (error) {
      logger.error(
        `❌ Failed to mark account as rate limited: ${accountId} (${accountType})`,
        error
      )
      throw error
    }
  }

  // ✅ 移除账户的限流状态
  async removeAccountRateLimit(accountId, accountType) {
    try {
      if (accountType === 'claude-official') {
        await claudeAccountService.removeAccountRateLimit(accountId)
      } else if (accountType === 'claude-console') {
        await claudeConsoleAccountService.removeAccountRateLimit(accountId)
      } else if (accountType === 'ccr') {
        await ccrAccountService.removeAccountRateLimit(accountId)
      }

      return { success: true }
    } catch (error) {
      logger.error(
        `❌ Failed to remove rate limit for account: ${accountId} (${accountType})`,
        error
      )
      throw error
    }
  }

  // 🔍 检查账户是否处于限流状态
  async isAccountRateLimited(accountId, accountType) {
    try {
      if (accountType === 'claude-official') {
        return await claudeAccountService.isAccountRateLimited(accountId)
      } else if (accountType === 'claude-console') {
        return await claudeConsoleAccountService.isAccountRateLimited(accountId)
      } else if (accountType === 'ccr') {
        return await ccrAccountService.isAccountRateLimited(accountId)
      }
      return false
    } catch (error) {
      logger.error(`❌ Failed to check rate limit status: ${accountId} (${accountType})`, error)
      return false
    }
  }

  // 🚫 标记账户为未授权状态（401错误）
  async markAccountUnauthorized(accountId, accountType, sessionHash = null) {
    try {
      // 只处理claude-official类型的账户，不处理claude-console和gemini
      if (accountType === 'claude-official') {
        await claudeAccountService.markAccountUnauthorized(accountId, sessionHash)

        // 删除会话映射
        if (sessionHash) {
          await this._deleteSessionMapping(sessionHash)
        }

        logger.warn(`🚫 Account ${accountId} marked as unauthorized due to consecutive 401 errors`)
      } else {
        logger.info(
          `ℹ️ Skipping unauthorized marking for non-Claude OAuth account: ${accountId} (${accountType})`
        )
      }

      return { success: true }
    } catch (error) {
      logger.error(
        `❌ Failed to mark account as unauthorized: ${accountId} (${accountType})`,
        error
      )
      throw error
    }
  }

  // 🚫 标记账户为被封锁状态（403错误）
  async markAccountBlocked(accountId, accountType, sessionHash = null) {
    try {
      // 只处理claude-official类型的账户，不处理claude-console和gemini
      if (accountType === 'claude-official') {
        await claudeAccountService.markAccountBlocked(accountId, sessionHash)

        // 删除会话映射
        if (sessionHash) {
          await this._deleteSessionMapping(sessionHash)
        }

        logger.warn(`🚫 Account ${accountId} marked as blocked due to 403 error`)
      } else {
        logger.info(
          `ℹ️ Skipping blocked marking for non-Claude OAuth account: ${accountId} (${accountType})`
        )
      }

      return { success: true }
    } catch (error) {
      logger.error(`❌ Failed to mark account as blocked: ${accountId} (${accountType})`, error)
      throw error
    }
  }

  // 🚫 标记Claude Console账户为封锁状态（模型不支持）
  async blockConsoleAccount(accountId, reason) {
    try {
      await claudeConsoleAccountService.blockAccount(accountId, reason)
      return { success: true }
    } catch (error) {
      logger.error(`❌ Failed to block console account: ${accountId}`, error)
      throw error
    }
  }

  // 👥 从分组中选择账户
  async selectAccountFromGroup(
    groupId,
    sessionHash = null,
    requestedModel = null,
    allowCcr = false,
    apiKeyData = null,
    decisionTrace = null
  ) {
    try {
      // 获取分组信息
      const group = await accountGroupService.getGroup(groupId)
      if (!group) {
        throw new Error(`Group ${groupId} not found`)
      }

      logger.info(`👥 Selecting account from group: ${group.name} (${group.platform})`)

      // 如果有会话哈希，检查是否有已映射的账户
      if (sessionHash) {
        const mappedAccount = await this._getSessionMapping(sessionHash)
        if (mappedAccount) {
          // 验证映射的账户是否属于这个分组
          const memberIds = await accountGroupService.getGroupMembers(groupId)
          if (memberIds.includes(mappedAccount.accountId)) {
            // 非 CCR 请求时不允许 CCR 粘性映射
            if (!allowCcr && mappedAccount.accountType === 'ccr') {
              await this._deleteSessionMapping(sessionHash)
            } else {
              const isAvailable = await this._isAccountAvailable(
                mappedAccount.accountId,
                mappedAccount.accountType,
                requestedModel
              )
              if (isAvailable) {
                // 🚀 智能会话续期：续期 unified 映射键
                await this._extendSessionMappingTTL(sessionHash)
                logger.info(
                  `🎯 Using sticky session account from group: ${mappedAccount.accountId} (${mappedAccount.accountType}) for session ${sessionHash}`
                )
                return mappedAccount
              }
            }
          }
          // 如果映射的账户不可用或不在分组中，删除映射
          await this._deleteSessionMapping(sessionHash)
        }
      }

      // 获取分组内的所有账户
      const memberIds = await accountGroupService.getGroupMembers(groupId)
      if (memberIds.length === 0) {
        throw new Error(`Group ${group.name} has no members`)
      }

      const availableAccounts = []
      const isOpusRequest =
        requestedModel && typeof requestedModel === 'string'
          ? requestedModel.toLowerCase().includes('opus')
          : false

      // 获取所有成员账户的详细信息
      for (const memberId of memberIds) {
        let account = null
        let accountType = null

        // 根据平台类型获取账户
        if (group.platform === 'claude') {
          // 先尝试官方账户
          account = await redis.getClaudeAccount(memberId)
          if (account?.id) {
            accountType = 'claude-official'
          } else {
            // 尝试Console账户
            account = await claudeConsoleAccountService.getAccount(memberId)
            if (account) {
              accountType = 'claude-console'
            } else {
              // 尝试CCR账户（仅允许在 allowCcr 为 true 时）
              if (allowCcr) {
                account = await ccrAccountService.getAccount(memberId)
                if (account) {
                  accountType = 'ccr'
                }
              }
            }
          }
        } else if (group.platform === 'gemini') {
          // Gemini暂时不支持，预留接口
          logger.warn('⚠️ Gemini group scheduling not yet implemented')
          continue
        }

        if (!account) {
          this._recordDecisionExclusion(
            decisionTrace,
            { id: memberId, name: memberId },
            'unknown',
            'account_not_found'
          )
          logger.warn(`⚠️ Account ${memberId} not found in group ${group.name}`)
          continue
        }

        // 检查账户是否可用
        const isActive =
          accountType === 'claude-official'
            ? account.isActive === 'true'
            : account.isActive === true

        const status =
          accountType === 'claude-official'
            ? account.status !== 'error' && account.status !== 'blocked'
            : accountType === 'ccr'
              ? account.status === 'active'
              : account.status === 'active'

        const isSchedulableForGroup =
          accountType === 'claude-official' || this._isSchedulable(account.schedulable)

        if (isActive && status && isSchedulableForGroup) {
          // 检查模型支持
          if (!this._isModelSupportedByAccount(account, accountType, requestedModel, 'in group')) {
            this._recordDecisionExclusion(
              decisionTrace,
              account,
              accountType,
              'model_not_supported'
            )
            continue
          }

          // 检查是否被限流
          if (accountType === 'claude-official') {
            const schedulingState = await this._checkClaudeOfficialSchedulingState(
              account,
              requestedModel
            )
            if (!schedulingState.canUse) {
              this._recordDecisionExclusion(
                decisionTrace,
                account,
                accountType,
                schedulingState.reason || 'not_schedulable'
              )
              logger.debug(
                `⏭️ Skipping group member ${account.name} (${account.id}) - ${schedulingState.reason}`
              )
              continue
            }
            account = schedulingState.account || account
          } else {
            const isRateLimited = await this.isAccountRateLimited(account.id, accountType)
            if (isRateLimited) {
              this._recordDecisionExclusion(decisionTrace, account, accountType, 'rate_limited')
              continue
            }
          }

          if (accountType === 'claude-official' && isOpusRequest) {
            const isOpusRateLimited = await claudeAccountService.isAccountOpusRateLimited(
              account.id
            )
            if (isOpusRateLimited) {
              this._recordDecisionExclusion(decisionTrace, account, accountType, 'rate_limited')
              logger.debug(
                `🚫 Skipping group member ${account.name} (${account.id}) due to active Opus limit`
              )
              continue
            }
          }

          // 🔒 检查 Claude Console 账户的并发限制
          if (accountType === 'claude-console' && account.maxConcurrentTasks > 0) {
            const currentConcurrency = await redis.getConsoleAccountConcurrency(account.id)
            if (currentConcurrency >= account.maxConcurrentTasks) {
              this._recordDecisionExclusion(decisionTrace, account, accountType, 'concurrency_full')
              logger.info(
                `🚫 Skipping group member ${account.name} (${account.id}) due to concurrency limit: ${currentConcurrency}/${account.maxConcurrentTasks}`
              )
              continue
            }
          }

          availableAccounts.push({
            ...account,
            accountId: account.id,
            accountType,
            priority: parseInt(account.priority) || 50,
            lastUsedAt: account.lastUsedAt || '0'
          })
        } else {
          const reason = !isActive ? 'inactive' : !status ? 'invalid_status' : 'not_schedulable'
          this._recordDecisionExclusion(decisionTrace, account, accountType, reason)
        }
      }

      if (availableAccounts.length === 0) {
        throw new Error(`No available accounts in group ${group.name}`)
      }

      // 使用现有的优先级排序逻辑
      const sortedAccounts = this._sortAccountsByPriority(availableAccounts)

      // 选择第一个账户
      const selectedAccount = sortedAccounts[0]

      // 如果有会话哈希，建立新的映射
      if (sessionHash) {
        await this._setSessionMapping(
          sessionHash,
          selectedAccount.accountId,
          selectedAccount.accountType,
          apiKeyData?.id || null
        )
        logger.info(
          `🎯 Created new sticky session mapping in group: ${selectedAccount.name} (${selectedAccount.accountId}, ${selectedAccount.accountType}) for session ${sessionHash}`
        )
      }

      logger.info(
        `🎯 Selected account from group ${group.name}: ${selectedAccount.name} (${selectedAccount.accountId}, ${selectedAccount.accountType}) with priority ${selectedAccount.priority}`
      )

      return {
        accountId: selectedAccount.accountId,
        accountType: selectedAccount.accountType
      }
    } catch (error) {
      logger.error(`❌ Failed to select account from group ${groupId}:`, error)
      throw error
    }
  }

  // 🎯 专门选择CCR账户（仅限CCR前缀路由使用）
  async _selectCcrAccount(
    apiKeyData,
    sessionHash = null,
    effectiveModel = null,
    decisionTrace = null
  ) {
    try {
      // 1. 检查会话粘性
      if (sessionHash) {
        const mappedAccount = await this._getSessionMapping(sessionHash)
        if (mappedAccount && mappedAccount.accountType === 'ccr') {
          // 验证映射的CCR账户是否仍然可用
          const isAvailable = await this._isAccountAvailable(
            mappedAccount.accountId,
            mappedAccount.accountType,
            effectiveModel
          )
          if (isAvailable) {
            // 🚀 智能会话续期：续期 unified 映射键
            await this._extendSessionMappingTTL(sessionHash)
            logger.info(
              `🎯 Using sticky CCR session account: ${mappedAccount.accountId} for session ${sessionHash}`
            )
            return mappedAccount
          } else {
            logger.warn(
              `⚠️ Mapped CCR account ${mappedAccount.accountId} is no longer available, selecting new account`
            )
            await this._deleteSessionMapping(sessionHash)
          }
        }
      }

      // 2. 获取所有可用的CCR账户
      const availableCcrAccounts = await this._getAvailableCcrAccounts(
        effectiveModel,
        decisionTrace
      )

      if (availableCcrAccounts.length === 0) {
        throw new Error(
          `No available CCR accounts support the requested model: ${effectiveModel || 'unspecified'}`
        )
      }

      // 3. 按优先级和最后使用时间排序
      const sortedAccounts = this._sortAccountsByPriority(availableCcrAccounts)
      const selectedAccount = sortedAccounts[0]

      // 4. 建立会话映射
      if (sessionHash) {
        await this._setSessionMapping(
          sessionHash,
          selectedAccount.accountId,
          selectedAccount.accountType,
          apiKeyData?.id || null
        )
        logger.info(
          `🎯 Created new sticky CCR session mapping: ${selectedAccount.name} (${selectedAccount.accountId}) for session ${sessionHash}`
        )
      }

      logger.info(
        `🎯 Selected CCR account: ${selectedAccount.name} (${selectedAccount.accountId}) with priority ${selectedAccount.priority} for API key ${apiKeyData.name}`
      )

      return {
        accountId: selectedAccount.accountId,
        accountType: selectedAccount.accountType
      }
    } catch (error) {
      logger.error('❌ Failed to select CCR account:', error)
      throw error
    }
  }

  // 📋 获取所有可用的CCR账户
  async _getAvailableCcrAccounts(requestedModel = null, decisionTrace = null) {
    const availableAccounts = []

    try {
      const ccrAccounts = await ccrAccountService.getAllAccounts()
      logger.debug(`📋 Found ${ccrAccounts.length} total CCR accounts for CCR-only selection`)

      for (const account of ccrAccounts) {
        logger.debug(
          `🔍 Checking CCR account: ${account.name} - isActive: ${account.isActive}, status: ${account.status}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
        )

        if (
          account.isActive === true &&
          account.status === 'active' &&
          account.accountType === 'shared' &&
          this._isSchedulable(account.schedulable)
        ) {
          // 检查模型支持
          if (!this._isModelSupportedByAccount(account, 'ccr', requestedModel)) {
            this._recordDecisionExclusion(decisionTrace, account, 'ccr', 'model_not_supported')
            logger.debug(`CCR account ${account.name} does not support model ${requestedModel}`)
            continue
          }

          // 检查订阅是否过期
          if (ccrAccountService.isSubscriptionExpired(account)) {
            this._recordDecisionExclusion(decisionTrace, account, 'ccr', 'subscription_expired')
            logger.debug(
              `⏰ CCR account ${account.name} (${account.id}) expired at ${account.subscriptionExpiresAt}`
            )
            continue
          }

          // 检查是否被限流或超额
          const isRateLimited = await ccrAccountService.isAccountRateLimited(account.id)
          const isQuotaExceeded = await ccrAccountService.isAccountQuotaExceeded(account.id)
          const isOverloaded = await ccrAccountService.isAccountOverloaded(account.id)

          if (!isRateLimited && !isQuotaExceeded && !isOverloaded) {
            availableAccounts.push({
              ...account,
              accountId: account.id,
              accountType: 'ccr',
              priority: parseInt(account.priority) || 50,
              lastUsedAt: account.lastUsedAt || '0'
            })
            logger.debug(`✅ Added CCR account to available pool: ${account.name}`)
          } else {
            if (isRateLimited) {
              this._recordDecisionExclusion(decisionTrace, account, 'ccr', 'rate_limited')
            }
            if (isQuotaExceeded) {
              this._recordDecisionExclusion(decisionTrace, account, 'ccr', 'quota_exceeded')
            }
            if (isOverloaded) {
              this._recordDecisionExclusion(decisionTrace, account, 'ccr', 'overloaded')
            }
            logger.debug(
              `❌ CCR account ${account.name} not available - rateLimited: ${isRateLimited}, quotaExceeded: ${isQuotaExceeded}, overloaded: ${isOverloaded}`
            )
          }
        } else {
          const reason =
            account.isActive !== true
              ? 'inactive'
              : account.status !== 'active'
                ? 'invalid_status'
                : account.accountType !== 'shared'
                  ? 'not_shared_pool'
                  : 'not_schedulable'
          this._recordDecisionExclusion(decisionTrace, account, 'ccr', reason)
          logger.debug(
            `❌ CCR account ${account.name} not eligible - isActive: ${account.isActive}, status: ${account.status}, accountType: ${account.accountType}, schedulable: ${account.schedulable}`
          )
        }
      }

      logger.info(`📊 Total available CCR accounts: ${availableAccounts.length}`)
      return availableAccounts
    } catch (error) {
      logger.error('❌ Failed to get available CCR accounts:', error)
      return []
    }
  }

  /**
   * 🔒 检查 claude-official 账户是否可用于会话绑定
   * 注意：此方法仅用于 claude-official 类型账户，其他类型不受会话绑定限制
   * @param {string} accountId - 账户ID
   * @param {string} accountType - 账户类型（应为 'claude-official'）
   * @param {string} requestedModel - 请求的模型，用于模型额度桶判断
   * @returns {Promise<boolean>}
   */
  async _isAccountAvailableForSessionBinding(accountId, accountType, requestedModel = null) {
    try {
      // 此方法仅处理 claude-official 类型
      if (accountType !== 'claude-official') {
        logger.warn(
          `Session binding: _isAccountAvailableForSessionBinding called for non-official type: ${accountType}`
        )
        return true // 非 claude-official 类型不受限制
      }

      const account = await redis.getClaudeAccount(accountId)
      if (!account) {
        logger.warn(`Session binding: Claude OAuth account ${accountId} not found`)
        return false
      }

      const isActive = account.isActive === 'true' || account.isActive === true
      const { status } = account

      if (!isActive) {
        logger.warn(`Session binding: Claude OAuth account ${accountId} is not active`)
        return false
      }

      if (status === 'error' || status === 'temp_error') {
        logger.warn(
          `Session binding: Claude OAuth account ${accountId} has error status: ${status}`
        )
        return false
      }

      const schedulingState = await this._checkClaudeOfficialSchedulingState(
        account,
        requestedModel
      )
      if (!schedulingState.canUse) {
        logger.warn(
          `Session binding: Claude OAuth account ${accountId} unavailable: ${schedulingState.reason}`
        )
        return false
      }

      // 检查临时不可用
      if (await this.isAccountTemporarilyUnavailable(accountId, accountType)) {
        logger.warn(`Session binding: Claude OAuth account ${accountId} is temporarily unavailable`)
        return false
      }

      return true
    } catch (error) {
      logger.error(
        `❌ Error checking account availability for session binding: ${accountId} (${accountType})`,
        error
      )
      return false
    }
  }
}

module.exports = new UnifiedClaudeScheduler()
