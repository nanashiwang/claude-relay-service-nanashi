const { v4: uuidv4 } = require('uuid')
const crypto = require('crypto')
const ProxyHelper = require('../utils/proxyHelper')
const redis = require('../models/redis')
const logger = require('../utils/logger')
const config = require('../../config/config')
const LRUCache = require('../utils/lruCache')
const { getPrimaryPrefixedRedisKeys } = require('../utils/redisKeyFilter')

class ClaudeConsoleAccountService {
  constructor() {
    // 鍔犲瘑鐩稿叧甯搁噺
    this.ENCRYPTION_ALGORITHM = 'aes-256-cbc'
    this.ENCRYPTION_SALT = 'claude-console-salt'

    // Redis閿墠缂€
    this.ACCOUNT_KEY_PREFIX = 'claude_console_account:'
    this.SHARED_ACCOUNTS_KEY = 'shared_claude_console_accounts'

    // 馃殌 鎬ц兘浼樺寲锛氱紦瀛樻淳鐢熺殑鍔犲瘑瀵嗛挜锛岄伩鍏嶆瘡娆￠噸澶嶈绠?
    // scryptSync 鏄?CPU 瀵嗛泦鍨嬫搷浣滐紝缂撳瓨鍙互鍑忓皯 95%+ 鐨?CPU 瀵嗛泦鍨嬫搷浣?
    this._encryptionKeyCache = null

    // 馃攧 瑙ｅ瘑缁撴灉缂撳瓨锛屾彁楂樿В瀵嗘€ц兘
    this._decryptCache = new LRUCache(500)

    // 馃Ч 瀹氭湡娓呯悊缂撳瓨锛堟瘡10鍒嗛挓锛?
    setInterval(
      () => {
        this._decryptCache.cleanup()
        logger.info(
          '馃Ч Claude Console decrypt cache cleanup completed',
          this._decryptCache.getStats()
        )
      },
      10 * 60 * 1000
    )
  }

  _getBlockedHandlingMinutes() {
    const raw = process.env.CLAUDE_CONSOLE_BLOCKED_HANDLING_MINUTES
    if (raw === undefined || raw === null || raw === '') {
      return 0
    }

    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0
    }

    return parsed
  }

  // 馃彚 鍒涘缓Claude Console璐︽埛
  async createAccount(options = {}) {
    const {
      name = 'Claude Console Account',
      description = '',
      apiUrl = '',
      apiKey = '',
      priority = 50, // 榛樿浼樺厛绾?0锛?-100锛?
      supportedModels = [], // 鏀寔鐨勬ā鍨嬪垪琛ㄦ垨鏄犲皠琛紝绌烘暟缁?瀵硅薄琛ㄧず鏀寔鎵€鏈?
      userAgent = 'claude-cli/1.0.69 (external, cli)',
      rateLimitDuration = 60, // 闄愭祦鏃堕棿锛堝垎閽燂級
      proxy = null,
      isActive = true,
      accountType = 'shared', // 'dedicated' or 'shared'
      schedulable = true, // 鏄惁鍙璋冨害
      dailyQuota = 0, // 姣忔棩棰濆害闄愬埗锛堢編鍏冿級锛?琛ㄧず涓嶉檺鍒?
      quotaResetTime = '00:00', // 棰濆害閲嶇疆鏃堕棿锛圚H:mm鏍煎紡锛?
      maxConcurrentTasks = 0, // 鏈€澶у苟鍙戜换鍔℃暟锛?琛ㄧず鏃犻檺鍒?
      disableAutoProtection = false, // 鏄惁鍏抽棴鑷姩闃叉姢锛?29/401/400/529 涓嶈嚜鍔ㄧ鐢級
      interceptWarmup = false // 鎷︽埅棰勭儹璇锋眰锛堟爣棰樼敓鎴愩€乄armup绛夛級
    } = options

    // 楠岃瘉蹇呭～瀛楁
    if (!apiUrl || !apiKey) {
      throw new Error('API URL and API Key are required for Claude Console account')
    }

    const accountId = uuidv4()

    // 澶勭悊 supportedModels锛岀‘淇濆悜鍚庡吋瀹?
    const processedModels = this._processModelMapping(supportedModels)

    const accountData = {
      id: accountId,
      platform: 'claude-console',
      name,
      description,
      apiUrl,
      apiKey: this._encryptSensitiveData(apiKey),
      priority: priority.toString(),
      supportedModels: JSON.stringify(processedModels),
      userAgent,
      rateLimitDuration: rateLimitDuration.toString(),
      proxy: proxy ? JSON.stringify(proxy) : '',
      isActive: isActive.toString(),
      accountType,
      createdAt: new Date().toISOString(),
      lastUsedAt: '',
      status: 'active',
      errorMessage: '',

      // 鉁?鏂板锛氳处鎴疯闃呭埌鏈熸椂闂达紙涓氬姟瀛楁锛屾墜鍔ㄧ鐞嗭級
      // 娉ㄦ剰锛欳laude Console 娌℃湁 OAuth token锛屽洜姝ゆ病鏈?expiresAt锛坱oken杩囨湡锛?
      subscriptionExpiresAt: options.subscriptionExpiresAt || null,

      // 闄愭祦鐩稿叧
      rateLimitedAt: '',
      rateLimitStatus: '',
      // 璋冨害鎺у埗
      schedulable: schedulable.toString(),
      // 棰濆害绠＄悊鐩稿叧
      dailyQuota: dailyQuota.toString(), // 姣忔棩棰濆害闄愬埗锛堢編鍏冿級
      dailyUsage: '0', // 褰撴棩浣跨敤閲戦锛堢編鍏冿級
      // 浣跨敤涓庣粺璁′竴鑷寸殑鏃跺尯鏃ユ湡锛岄伩鍏嶈竟鐣岄棶棰?
      lastResetDate: redis.getDateStringInTimezone(), // 鏈€鍚庨噸缃棩鏈燂紙鎸夐厤缃椂鍖猴級
      quotaResetTime, // 棰濆害閲嶇疆鏃堕棿
      quotaStoppedAt: '', // 鍥犻搴﹀仠鐢ㄧ殑鏃堕棿
      maxConcurrentTasks: maxConcurrentTasks.toString(), // 鏈€澶у苟鍙戜换鍔℃暟锛?琛ㄧず鏃犻檺鍒?
      disableAutoProtection: disableAutoProtection.toString(), // 鍏抽棴鑷姩闃叉姢
      interceptWarmup: interceptWarmup.toString() // 鎷︽埅棰勭儹璇锋眰
    }

    const client = redis.getClientSafe()
    logger.debug(
      `[DEBUG] Saving account data to Redis with key: ${this.ACCOUNT_KEY_PREFIX}${accountId}`
    )
    logger.debug(`[DEBUG] Account data to save: ${JSON.stringify(accountData, null, 2)}`)

    await client.hset(`${this.ACCOUNT_KEY_PREFIX}${accountId}`, accountData)

    // 濡傛灉鏄叡浜处鎴凤紝娣诲姞鍒板叡浜处鎴烽泦鍚?
    if (accountType === 'shared') {
      await client.sadd(this.SHARED_ACCOUNTS_KEY, accountId)
    }

    logger.success(`馃彚 Created Claude Console account: ${name} (${accountId})`)

    return {
      id: accountId,
      name,
      description,
      apiUrl,
      priority,
      supportedModels,
      userAgent,
      rateLimitDuration,
      isActive,
      proxy,
      accountType,
      status: 'active',
      createdAt: accountData.createdAt,
      dailyQuota,
      dailyUsage: 0,
      lastResetDate: accountData.lastResetDate,
      quotaResetTime,
      quotaStoppedAt: null,
      maxConcurrentTasks, // 鏂板锛氳繑鍥炲苟鍙戦檺鍒堕厤缃?
      disableAutoProtection, // 鏂板锛氳繑鍥炶嚜鍔ㄩ槻鎶ゅ紑鍏?
      interceptWarmup, // 鏂板锛氳繑鍥為鐑姹傛嫤鎴紑鍏?
      activeTaskCount: 0 // 鏂板锛氭柊寤鸿处鎴峰綋鍓嶅苟鍙戞暟涓?
    }
  }

  // 馃搵 鑾峰彇鎵€鏈塁laude Console璐︽埛
  async getAllAccounts(includeConcurrency = true) {
    try {
      const client = redis.getClientSafe()
      const keys = await getPrimaryPrefixedRedisKeys(client, this.ACCOUNT_KEY_PREFIX)
      if (keys.length === 0) {
        return []
      }

      const pipeline = client.pipeline()
      keys.forEach((key) => pipeline.hgetall(key))
      const results = await pipeline.exec()

      const accountDataList = []
      for (let i = 0; i < results.length; i++) {
        const [error, accountData] = results[i]
        if (error || !accountData || Object.keys(accountData).length === 0) {
          continue
        }

        if (!accountData.id) {
          logger.warn(`⚠️ 检测到缺少ID的Claude Console账户数据，执行清理: ${keys[i]}`)
          await client.del(keys[i])
          continue
        }

        accountDataList.push(accountData)
      }

      const activeTaskCountMap = new Map()
      if (includeConcurrency && accountDataList.length > 0) {
        const concurrencyResults = await Promise.all(
          accountDataList.map(async (accountData) => {
            try {
              const count = await redis.getConsoleAccountConcurrency(accountData.id)
              return [accountData.id, count]
            } catch {
              return [accountData.id, 0]
            }
          })
        )

        for (const [accountId, count] of concurrencyResults) {
          activeTaskCountMap.set(accountId, count)
        }
      }

      return accountDataList.map((accountData) => {
        const rateLimitInfo = this._getRateLimitInfo(accountData)
        const activeTaskCount = includeConcurrency ? activeTaskCountMap.get(accountData.id) || 0 : 0

        return {
          id: accountData.id,
          platform: accountData.platform,
          name: accountData.name,
          description: accountData.description,
          apiUrl: accountData.apiUrl,
          priority: parseInt(accountData.priority) || 50,
          supportedModels: JSON.parse(accountData.supportedModels || '[]'),
          userAgent: accountData.userAgent,
          rateLimitDuration: Number.isNaN(parseInt(accountData.rateLimitDuration))
            ? 60
            : parseInt(accountData.rateLimitDuration),
          isActive: accountData.isActive === 'true',
          proxy: accountData.proxy ? JSON.parse(accountData.proxy) : null,
          accountType: accountData.accountType || 'shared',
          createdAt: accountData.createdAt,
          lastUsedAt: accountData.lastUsedAt,
          status: accountData.status || 'active',
          errorMessage: accountData.errorMessage,
          rateLimitInfo,
          schedulable: accountData.schedulable !== 'false',

          expiresAt: accountData.subscriptionExpiresAt || null,

          dailyQuota: parseFloat(accountData.dailyQuota || '0'),
          dailyUsage: parseFloat(accountData.dailyUsage || '0'),
          lastResetDate: accountData.lastResetDate || '',
          quotaResetTime: accountData.quotaResetTime || '00:00',
          quotaStoppedAt: accountData.quotaStoppedAt || null,

          maxConcurrentTasks: parseInt(accountData.maxConcurrentTasks) || 0,
          activeTaskCount,
          disableAutoProtection: accountData.disableAutoProtection === 'true',
          interceptWarmup: accountData.interceptWarmup === 'true'
        }
      })
    } catch (error) {
      logger.error('❌ Failed to get Claude Console accounts:', error)
      throw error
    }
  }
  async getAccount(accountId) {
    const client = redis.getClientSafe()
    logger.debug(`[DEBUG] Getting account data for ID: ${accountId}`)
    const accountData = await client.hgetall(`${this.ACCOUNT_KEY_PREFIX}${accountId}`)

    if (!accountData || Object.keys(accountData).length === 0) {
      logger.debug(`[DEBUG] No account data found for ID: ${accountId}`)
      return null
    }

    logger.debug(`[DEBUG] Raw account data keys: ${Object.keys(accountData).join(', ')}`)
    logger.debug(`[DEBUG] Raw supportedModels value: ${accountData.supportedModels}`)

    // 瑙ｅ瘑鏁忔劅瀛楁锛堝彧瑙ｅ瘑apiKey锛宎piUrl涓嶅姞瀵嗭級
    const decryptedKey = this._decryptSensitiveData(accountData.apiKey)
    logger.debug(
      `[DEBUG] URL exists: ${!!accountData.apiUrl}, Decrypted key exists: ${!!decryptedKey}`
    )

    accountData.apiKey = decryptedKey

    // 瑙ｆ瀽JSON瀛楁
    const parsedModels = JSON.parse(accountData.supportedModels || '[]')
    logger.debug(`[DEBUG] Parsed supportedModels: ${JSON.stringify(parsedModels)}`)

    accountData.supportedModels = parsedModels
    accountData.priority = parseInt(accountData.priority) || 50
    {
      const _parsedDuration = parseInt(accountData.rateLimitDuration)
      accountData.rateLimitDuration = Number.isNaN(_parsedDuration) ? 60 : _parsedDuration
    }
    accountData.isActive = accountData.isActive === 'true'
    accountData.schedulable = accountData.schedulable !== 'false' // 榛樿涓簍rue
    accountData.disableAutoProtection = accountData.disableAutoProtection === 'true'

    if (accountData.proxy) {
      accountData.proxy = JSON.parse(accountData.proxy)
    }

    // 瑙ｆ瀽骞跺彂鎺у埗瀛楁
    accountData.maxConcurrentTasks = parseInt(accountData.maxConcurrentTasks) || 0
    // 鑾峰彇瀹炴椂骞跺彂璁℃暟
    accountData.activeTaskCount = await redis.getConsoleAccountConcurrency(accountId)

    logger.debug(
      `[DEBUG] Final account data - name: ${accountData.name}, hasApiUrl: ${!!accountData.apiUrl}, hasApiKey: ${!!accountData.apiKey}, supportedModels: ${JSON.stringify(accountData.supportedModels)}`
    )

    return accountData
  }

  // 馃摑 鏇存柊璐︽埛
  async updateAccount(accountId, updates) {
    try {
      const existingAccount = await this.getAccount(accountId)
      if (!existingAccount) {
        throw new Error('Account not found')
      }

      const client = redis.getClientSafe()
      const updatedData = {}

      // 澶勭悊鍚勪釜瀛楁鐨勬洿鏂?
      logger.debug(
        `[DEBUG] Update request received with fields: ${Object.keys(updates).join(', ')}`
      )
      logger.debug(`[DEBUG] Updates content: ${JSON.stringify(updates, null, 2)}`)

      if (updates.name !== undefined) {
        updatedData.name = updates.name
      }
      if (updates.description !== undefined) {
        updatedData.description = updates.description
      }
      if (updates.apiUrl !== undefined) {
        logger.debug(`[DEBUG] Updating apiUrl from frontend: ${updates.apiUrl}`)
        updatedData.apiUrl = updates.apiUrl
      }
      if (updates.apiKey !== undefined) {
        logger.debug(`[DEBUG] Updating apiKey (length: ${updates.apiKey?.length})`)
        updatedData.apiKey = this._encryptSensitiveData(updates.apiKey)
      }
      if (updates.priority !== undefined) {
        updatedData.priority = updates.priority.toString()
      }
      if (updates.supportedModels !== undefined) {
        logger.debug(`[DEBUG] Updating supportedModels: ${JSON.stringify(updates.supportedModels)}`)
        // 澶勭悊 supportedModels锛岀‘淇濆悜鍚庡吋瀹?
        const processedModels = this._processModelMapping(updates.supportedModels)
        updatedData.supportedModels = JSON.stringify(processedModels)
      }
      if (updates.userAgent !== undefined) {
        updatedData.userAgent = updates.userAgent
      }
      if (updates.rateLimitDuration !== undefined) {
        updatedData.rateLimitDuration = updates.rateLimitDuration.toString()
      }
      if (updates.proxy !== undefined) {
        updatedData.proxy = updates.proxy ? JSON.stringify(updates.proxy) : ''
      }
      if (updates.isActive !== undefined) {
        updatedData.isActive = updates.isActive.toString()
      }
      if (updates.schedulable !== undefined) {
        updatedData.schedulable = updates.schedulable.toString()
        // 濡傛灉鏄墜鍔ㄤ慨鏀硅皟搴︾姸鎬侊紝娓呴櫎鎵€鏈夎嚜鍔ㄥ仠姝㈢浉鍏崇殑瀛楁
        // 闃叉鑷姩鎭㈠
        updatedData.rateLimitAutoStopped = ''
        updatedData.quotaAutoStopped = ''
        // 鍏煎鏃х殑鏍囪
        updatedData.autoStoppedAt = ''
        updatedData.stoppedReason = ''

        // 璁板綍鏃ュ織
        if (updates.schedulable === true || updates.schedulable === 'true') {
          logger.info(`鉁?Manually enabled scheduling for Claude Console account ${accountId}`)
        } else {
          logger.info(`鉀?Manually disabled scheduling for Claude Console account ${accountId}`)
        }
      }

      // 棰濆害绠＄悊鐩稿叧瀛楁
      if (updates.dailyQuota !== undefined) {
        updatedData.dailyQuota = updates.dailyQuota.toString()
      }
      if (updates.quotaResetTime !== undefined) {
        updatedData.quotaResetTime = updates.quotaResetTime
      }
      if (updates.dailyUsage !== undefined) {
        updatedData.dailyUsage = updates.dailyUsage.toString()
      }
      if (updates.lastResetDate !== undefined) {
        updatedData.lastResetDate = updates.lastResetDate
      }
      if (updates.quotaStoppedAt !== undefined) {
        updatedData.quotaStoppedAt = updates.quotaStoppedAt
      }

      // 骞跺彂鎺у埗鐩稿叧瀛楁
      if (updates.maxConcurrentTasks !== undefined) {
        updatedData.maxConcurrentTasks = updates.maxConcurrentTasks.toString()
      }
      if (updates.disableAutoProtection !== undefined) {
        updatedData.disableAutoProtection = updates.disableAutoProtection.toString()
      }
      if (updates.interceptWarmup !== undefined) {
        updatedData.interceptWarmup = updates.interceptWarmup.toString()
      }

      // 鉁?鐩存帴淇濆瓨 subscriptionExpiresAt锛堝鏋滄彁渚涳級
      // Claude Console 娌℃湁 token 鍒锋柊閫昏緫锛屼笉浼氳鐩栨瀛楁
      if (updates.subscriptionExpiresAt !== undefined) {
        updatedData.subscriptionExpiresAt = updates.subscriptionExpiresAt
      }

      // 澶勭悊璐︽埛绫诲瀷鍙樻洿
      if (updates.accountType && updates.accountType !== existingAccount.accountType) {
        updatedData.accountType = updates.accountType

        if (updates.accountType === 'shared') {
          await client.sadd(this.SHARED_ACCOUNTS_KEY, accountId)
        } else {
          await client.srem(this.SHARED_ACCOUNTS_KEY, accountId)
        }
      }

      updatedData.updatedAt = new Date().toISOString()

      // 妫€鏌ユ槸鍚︽墜鍔ㄧ鐢ㄤ簡璐﹀彿锛屽鏋滄槸鍒欏彂閫亀ebhook閫氱煡
      if (updates.isActive === false && existingAccount.isActive === true) {
        try {
          const webhookNotifier = require('../utils/webhookNotifier')
          await webhookNotifier.sendAccountAnomalyNotification({
            accountId,
            accountName: updatedData.name || existingAccount.name || 'Unknown Account',
            platform: 'claude-console',
            status: 'disabled',
            errorCode: 'CLAUDE_CONSOLE_MANUALLY_DISABLED',
            reason: 'Account manually disabled by administrator'
          })
        } catch (webhookError) {
          logger.error(
            'Failed to send webhook notification for manual account disable:',
            webhookError
          )
        }
      }

      logger.debug(`[DEBUG] Final updatedData to save: ${JSON.stringify(updatedData, null, 2)}`)
      logger.debug(`[DEBUG] Updating Redis key: ${this.ACCOUNT_KEY_PREFIX}${accountId}`)

      await client.hset(`${this.ACCOUNT_KEY_PREFIX}${accountId}`, updatedData)

      logger.success(`馃摑 Updated Claude Console account: ${accountId}`)

      return { success: true }
    } catch (error) {
      logger.error('鉂?Failed to update Claude Console account:', error)
      throw error
    }
  }

  // 馃棏锔?鍒犻櫎璐︽埛
  async deleteAccount(accountId) {
    try {
      const client = redis.getClientSafe()
      const account = await this.getAccount(accountId)

      if (!account) {
        throw new Error('Account not found')
      }

      // 浠嶳edis鍒犻櫎
      await client.del(`${this.ACCOUNT_KEY_PREFIX}${accountId}`)

      // 浠庡叡浜处鎴烽泦鍚堜腑绉婚櫎
      if (account.accountType === 'shared') {
        await client.srem(this.SHARED_ACCOUNTS_KEY, accountId)
      }

      logger.success(`馃棏锔?Deleted Claude Console account: ${accountId}`)

      return { success: true }
    } catch (error) {
      logger.error('鉂?Failed to delete Claude Console account:', error)
      throw error
    }
  }

  // 馃毇 鏍囪璐﹀彿涓洪檺娴佺姸鎬?
  async markAccountRateLimited(accountId) {
    try {
      const client = redis.getClientSafe()
      const account = await this.getAccount(accountId)

      if (!account) {
        throw new Error('Account not found')
      }

      // 濡傛灉闄愭祦鏃堕棿璁剧疆涓?0锛岃〃绀轰笉鍚敤闄愭祦鏈哄埗锛岀洿鎺ヨ繑鍥?
      if (account.rateLimitDuration === 0) {
        logger.info(
          `鈩癸笍 Claude Console account ${account.name} (${accountId}) has rate limiting disabled, skipping rate limit`
        )
        return { success: true, skipped: true }
      }

      const updates = {
        rateLimitedAt: new Date().toISOString(),
        rateLimitStatus: 'limited',
        isActive: 'false', // 绂佺敤璐︽埛
        schedulable: 'false', // 鍋滄璋冨害锛屼笌鍏朵粬骞冲彴淇濇寔涓€鑷?
        errorMessage: `Rate limited at ${new Date().toISOString()}`,
        // 浣跨敤鐙珛鐨勯檺娴佽嚜鍔ㄥ仠姝㈡爣璁?
        rateLimitAutoStopped: 'true'
      }

      // 鍙湁褰撳墠鐘舵€佷笉鏄痲uota_exceeded鏃舵墠璁剧疆涓簉ate_limited
      // 閬垮厤瑕嗙洊鏇撮噸瑕佺殑閰嶉瓒呴檺鐘舵€?
      const currentStatus = await client.hget(`${this.ACCOUNT_KEY_PREFIX}${accountId}`, 'status')
      if (currentStatus !== 'quota_exceeded') {
        updates.status = 'rate_limited'
      }

      await client.hset(`${this.ACCOUNT_KEY_PREFIX}${accountId}`, updates)

      // 鍙戦€乄ebhook閫氱煡
      try {
        const webhookNotifier = require('../utils/webhookNotifier')
        const { getISOStringWithTimezone } = require('../utils/dateHelper')
        await webhookNotifier.sendAccountAnomalyNotification({
          accountId,
          accountName: account.name || 'Claude Console Account',
          platform: 'claude-console',
          status: 'error',
          errorCode: 'CLAUDE_CONSOLE_RATE_LIMITED',
          reason: `Account rate limited (429 error) and has been disabled. ${account.rateLimitDuration ? `Will be automatically re-enabled after ${account.rateLimitDuration} minutes` : 'Manual intervention required to re-enable'}`,
          timestamp: getISOStringWithTimezone(new Date())
        })
      } catch (webhookError) {
        logger.error('Failed to send rate limit webhook notification:', webhookError)
      }

      logger.warn(
        `馃毇 Claude Console account marked as rate limited: ${account.name} (${accountId})`
      )
      return { success: true }
    } catch (error) {
      logger.error(`鉂?Failed to mark Claude Console account as rate limited: ${accountId}`, error)
      throw error
    }
  }

  // 鉁?绉婚櫎璐﹀彿鐨勯檺娴佺姸鎬?
  async removeAccountRateLimit(accountId) {
    try {
      const client = redis.getClientSafe()
      const accountKey = `${this.ACCOUNT_KEY_PREFIX}${accountId}`

      // 鑾峰彇璐︽埛褰撳墠鐘舵€佸拰棰濆害淇℃伅
      const [currentStatus, quotaStoppedAt] = await client.hmget(
        accountKey,
        'status',
        'quotaStoppedAt'
      )

      // 鍒犻櫎闄愭祦鐩稿叧瀛楁
      await client.hdel(accountKey, 'rateLimitedAt', 'rateLimitStatus')

      // 鏍规嵁涓嶅悓鎯呭喌鍐冲畾鏄惁鎭㈠璐︽埛
      if (currentStatus === 'rate_limited') {
        if (quotaStoppedAt) {
          // 杩樻湁棰濆害闄愬埗锛屾敼涓簈uota_exceeded鐘舵€?
          await client.hset(accountKey, {
            status: 'quota_exceeded'
            // isActive淇濇寔false
          })
          logger.info(
            `鈿狅笍 Rate limit removed but quota exceeded remains for account: ${accountId}`
          )
        } else {
          // 娌℃湁棰濆害闄愬埗锛屽畬鍏ㄦ仮澶?
          const accountData = await client.hgetall(accountKey)
          const updateData = {
            isActive: 'true',
            status: 'active',
            errorMessage: ''
          }

          const hadAutoStop = accountData.rateLimitAutoStopped === 'true'

          // 鍙仮澶嶅洜闄愭祦鑰岃嚜鍔ㄥ仠姝㈢殑璐︽埛
          if (hadAutoStop && accountData.schedulable === 'false') {
            updateData.schedulable = 'true' // 鎭㈠璋冨害
            logger.info(
              `鉁?Auto-resuming scheduling for Claude Console account ${accountId} after rate limit cleared`
            )
          }

          if (hadAutoStop) {
            await client.hdel(accountKey, 'rateLimitAutoStopped')
          }

          await client.hset(accountKey, updateData)
          logger.success(`鉁?Rate limit removed and account re-enabled: ${accountId}`)
        }
      } else {
        if (await client.hdel(accountKey, 'rateLimitAutoStopped')) {
          logger.info(
            `鈩癸笍 Removed stale auto-stop flag for Claude Console account ${accountId} during rate limit recovery`
          )
        }
        logger.success(`鉁?Rate limit removed for Claude Console account: ${accountId}`)
      }

      return { success: true }
    } catch (error) {
      logger.error(`鉂?Failed to remove rate limit for Claude Console account: ${accountId}`, error)
      throw error
    }
  }

  // 馃攳 妫€鏌ヨ处鍙锋槸鍚﹀浜庨檺娴佺姸鎬?
  async isAccountRateLimited(accountId) {
    try {
      const account = await this.getAccount(accountId)
      if (!account) {
        return false
      }

      // 濡傛灉闄愭祦鏃堕棿璁剧疆涓?0锛岃〃绀轰笉鍚敤闄愭祦鏈哄埗
      if (account.rateLimitDuration === 0) {
        return false
      }

      if (account.rateLimitStatus === 'limited' && account.rateLimitedAt) {
        const rateLimitedAt = new Date(account.rateLimitedAt)
        const now = new Date()
        const minutesSinceRateLimit = (now - rateLimitedAt) / (1000 * 60)

        // 浣跨敤璐︽埛閰嶇疆鐨勯檺娴佹椂闂?
        const rateLimitDuration =
          typeof account.rateLimitDuration === 'number' && !Number.isNaN(account.rateLimitDuration)
            ? account.rateLimitDuration
            : 60

        if (minutesSinceRateLimit >= rateLimitDuration) {
          await this.removeAccountRateLimit(accountId)
          return false
        }

        return true
      }

      return false
    } catch (error) {
      logger.error(
        `鉂?Failed to check rate limit status for Claude Console account: ${accountId}`,
        error
      )
      return false
    }
  }

  // 馃攳 妫€鏌ヨ处鍙锋槸鍚﹀洜棰濆害瓒呴檺鑰岃鍋滅敤锛堟噿鎯版鏌ワ級
  async isAccountQuotaExceeded(accountId) {
    try {
      const account = await this.getAccount(accountId)
      if (!account) {
        return false
      }

      // 濡傛灉娌℃湁璁剧疆棰濆害闄愬埗锛屼笉浼氳秴棰?
      const dailyQuota = parseFloat(account.dailyQuota || '0')
      if (isNaN(dailyQuota) || dailyQuota <= 0) {
        return false
      }

      // 濡傛灉璐︽埛娌℃湁琚搴﹀仠鐢紝妫€鏌ュ綋鍓嶄娇鐢ㄦ儏鍐?
      if (!account.quotaStoppedAt) {
        return false
      }

      // 妫€鏌ユ槸鍚﹀簲璇ラ噸缃搴︼紙鍒颁簡鏂扮殑閲嶇疆鏃堕棿鐐癸級
      if (this._shouldResetQuota(account)) {
        await this.resetDailyUsage(accountId)
        return false
      }

      // 浠嶅湪棰濆害瓒呴檺鐘舵€?
      return true
    } catch (error) {
      logger.error(
        `鉂?Failed to check quota exceeded status for Claude Console account: ${accountId}`,
        error
      )
      return false
    }
  }

  // 馃攳 鍒ゆ柇鏄惁搴旇閲嶇疆璐︽埛棰濆害
  _shouldResetQuota(account) {
    // 涓?Redis 缁熻涓€鑷达細鎸夐厤缃椂鍖哄垽鏂€滀粖澶┾€濅笌鏃堕棿鐐?
    const tzNow = redis.getDateInTimezone(new Date())
    const today = redis.getDateStringInTimezone(tzNow)

    // 濡傛灉宸茬粡鏄粖澶╅噸缃繃鐨勶紝涓嶉渶瑕侀噸缃?
    if (account.lastResetDate === today) {
      return false
    }

    // 妫€鏌ユ槸鍚﹀埌浜嗛噸缃椂闂寸偣锛堟寜閰嶇疆鏃跺尯鐨勫皬鏃?鍒嗛挓锛?
    const resetTime = account.quotaResetTime || '00:00'
    const [resetHour, resetMinute] = resetTime.split(':').map((n) => parseInt(n))

    const currentHour = tzNow.getUTCHours()
    const currentMinute = tzNow.getUTCMinutes()

    // 濡傛灉褰撳墠鏃堕棿宸茶繃閲嶇疆鏃堕棿涓斾笉鏄悓涓€澶╅噸缃殑锛屽簲璇ラ噸缃?
    return currentHour > resetHour || (currentHour === resetHour && currentMinute >= resetMinute)
  }

  // 馃毇 鏍囪璐﹀彿涓烘湭鎺堟潈鐘舵€侊紙401閿欒锛?
  async markAccountUnauthorized(accountId) {
    try {
      const client = redis.getClientSafe()
      const account = await this.getAccount(accountId)

      if (!account) {
        throw new Error('Account not found')
      }

      const updates = {
        schedulable: 'false',
        status: 'unauthorized',
        errorMessage: 'API Key无效或已过期（401错误）',
        unauthorizedAt: new Date().toISOString(),
        unauthorizedCount: String((parseInt(account.unauthorizedCount || '0') || 0) + 1)
      }

      await client.hset(`${this.ACCOUNT_KEY_PREFIX}${accountId}`, updates)

      // 鍙戦€乄ebhook閫氱煡
      try {
        const webhookNotifier = require('../utils/webhookNotifier')
        await webhookNotifier.sendAccountAnomalyNotification({
          accountId,
          accountName: account.name || 'Claude Console Account',
          platform: 'claude-console',
          status: 'error',
          errorCode: 'CLAUDE_CONSOLE_UNAUTHORIZED',
          reason: 'API Key无效或已过期（401错误），账号已停止调度',
          timestamp: new Date().toISOString()
        })
      } catch (webhookError) {
        logger.error('Failed to send unauthorized webhook notification:', webhookError)
      }

      logger.warn(
        `馃毇 Claude Console account marked as unauthorized: ${account.name} (${accountId})`
      )
      return { success: true }
    } catch (error) {
      logger.error(`鉂?Failed to mark Claude Console account as unauthorized: ${accountId}`, error)
      throw error
    }
  }

  // 馃毇 鏍囪璐﹀彿涓轰复鏃跺皝绂佺姸鎬侊紙400閿欒 - 璐︽埛涓存椂绂佺敤锛?
  async markConsoleAccountBlocked(accountId, errorDetails = '') {
    try {
      const client = redis.getClientSafe()
      const account = await this.getAccount(accountId)

      if (!account) {
        throw new Error('Account not found')
      }

      const blockedMinutes = this._getBlockedHandlingMinutes()

      if (blockedMinutes <= 0) {
        logger.info(
          `鈩癸笍 CLAUDE_CONSOLE_BLOCKED_HANDLING_MINUTES 鏈缃垨涓?锛岃烦杩囪处鎴峰皝绂侊細${account.name} (${accountId})`
        )

        if (account.blockedStatus === 'blocked') {
          try {
            await this.removeAccountBlocked(accountId)
          } catch (cleanupError) {
            logger.warn(`鈿狅笍 灏濊瘯绉婚櫎璐︽埛灏佺鐘舵€佸け璐ワ細${accountId}`, cleanupError)
          }
        }

        return { success: false, skipped: true }
      }

      const updates = {
        blockedAt: new Date().toISOString(),
        blockedStatus: 'blocked',
        isActive: 'false', // 绂佺敤璐︽埛锛堜笌429淇濇寔涓€鑷达級
        schedulable: 'false', // 鍋滄璋冨害锛堜笌429淇濇寔涓€鑷达級
        status: 'account_blocked', // 璁剧疆鐘舵€侊紙涓?29淇濇寔涓€鑷达級
        errorMessage: '????????400???',
        // 浣跨敤鐙珛鐨勫皝绂佽嚜鍔ㄥ仠姝㈡爣璁?
        blockedAutoStopped: 'true'
      }

      await client.hset(`${this.ACCOUNT_KEY_PREFIX}${accountId}`, updates)

      // 鍙戦€乄ebhook閫氱煡锛屽寘鍚畬鏁撮敊璇鎯?
      try {
        const webhookNotifier = require('../utils/webhookNotifier')
        await webhookNotifier.sendAccountAnomalyNotification({
          accountId,
          accountName: account.name || 'Claude Console Account',
          platform: 'claude-console',
          status: 'error',
          errorCode: 'CLAUDE_CONSOLE_BLOCKED',
          reason: `????????400???????? ${blockedMinutes} ????????`,
          errorDetails: errorDetails || '无错误详情',
          timestamp: new Date().toISOString()
        })
      } catch (webhookError) {
        logger.error('Failed to send blocked webhook notification:', webhookError)
      }

      logger.warn(`馃毇 Claude Console account temporarily blocked: ${account.name} (${accountId})`)
      return { success: true }
    } catch (error) {
      logger.error(`鉂?Failed to mark Claude Console account as blocked: ${accountId}`, error)
      throw error
    }
  }

  // 鉁?绉婚櫎璐﹀彿鐨勪复鏃跺皝绂佺姸鎬?
  async removeAccountBlocked(accountId) {
    try {
      const client = redis.getClientSafe()
      const accountKey = `${this.ACCOUNT_KEY_PREFIX}${accountId}`

      // 鑾峰彇璐︽埛褰撳墠鐘舵€佸拰棰濆害淇℃伅
      const [currentStatus, quotaStoppedAt] = await client.hmget(
        accountKey,
        'status',
        'quotaStoppedAt'
      )

      // 鍒犻櫎灏佺鐩稿叧瀛楁
      await client.hdel(accountKey, 'blockedAt', 'blockedStatus')

      // 鏍规嵁涓嶅悓鎯呭喌鍐冲畾鏄惁鎭㈠璐︽埛
      if (currentStatus === 'account_blocked') {
        if (quotaStoppedAt) {
          // 杩樻湁棰濆害闄愬埗锛屾敼涓簈uota_exceeded鐘舵€?
          await client.hset(accountKey, {
            status: 'quota_exceeded'
            // isActive淇濇寔false
          })
          logger.info(
            `鈿狅笍 Blocked status removed but quota exceeded remains for account: ${accountId}`
          )
        } else {
          // 娌℃湁棰濆害闄愬埗锛屽畬鍏ㄦ仮澶?
          const accountData = await client.hgetall(accountKey)
          const updateData = {
            isActive: 'true',
            status: 'active',
            errorMessage: ''
          }

          const hadAutoStop = accountData.blockedAutoStopped === 'true'

          // 鍙仮澶嶅洜灏佺鑰岃嚜鍔ㄥ仠姝㈢殑璐︽埛
          if (hadAutoStop && accountData.schedulable === 'false') {
            updateData.schedulable = 'true' // 鎭㈠璋冨害
            logger.info(
              `鉁?Auto-resuming scheduling for Claude Console account ${accountId} after blocked status cleared`
            )
          }

          if (hadAutoStop) {
            await client.hdel(accountKey, 'blockedAutoStopped')
          }

          await client.hset(accountKey, updateData)
          logger.success(`鉁?Blocked status removed and account re-enabled: ${accountId}`)
        }
      } else {
        if (await client.hdel(accountKey, 'blockedAutoStopped')) {
          logger.info(
            `鈩癸笍 Removed stale auto-stop flag for Claude Console account ${accountId} during blocked status recovery`
          )
        }
        logger.success(`鉁?Blocked status removed for Claude Console account: ${accountId}`)
      }

      return { success: true }
    } catch (error) {
      logger.error(
        `鉂?Failed to remove blocked status for Claude Console account: ${accountId}`,
        error
      )
      throw error
    }
  }

  // 馃攳 妫€鏌ヨ处鍙锋槸鍚﹀浜庝复鏃跺皝绂佺姸鎬?
  async isAccountBlocked(accountId) {
    try {
      const account = await this.getAccount(accountId)
      if (!account) {
        return false
      }

      if (account.blockedStatus === 'blocked' && account.blockedAt) {
        const blockedDuration = this._getBlockedHandlingMinutes()

        if (blockedDuration <= 0) {
          await this.removeAccountBlocked(accountId)
          return false
        }

        const blockedAt = new Date(account.blockedAt)
        const now = new Date()
        const minutesSinceBlocked = (now - blockedAt) / (1000 * 60)

        // 绂佺敤鏃堕暱杩囧悗鑷姩鎭㈠
        if (minutesSinceBlocked >= blockedDuration) {
          await this.removeAccountBlocked(accountId)
          return false
        }

        return true
      }

      return false
    } catch (error) {
      logger.error(
        `鉂?Failed to check blocked status for Claude Console account: ${accountId}`,
        error
      )
      return false
    }
  }

  // 馃毇 鏍囪璐﹀彿涓鸿繃杞界姸鎬侊紙529閿欒锛?
  async markAccountOverloaded(accountId) {
    try {
      const client = redis.getClientSafe()
      const account = await this.getAccount(accountId)

      if (!account) {
        throw new Error('Account not found')
      }

      const updates = {
        overloadedAt: new Date().toISOString(),
        overloadStatus: 'overloaded',
        errorMessage: '服务过载（429错误）'
      }

      await client.hset(`${this.ACCOUNT_KEY_PREFIX}${accountId}`, updates)

      // 鍙戦€乄ebhook閫氱煡
      try {
        const webhookNotifier = require('../utils/webhookNotifier')
        await webhookNotifier.sendAccountAnomalyNotification({
          accountId,
          accountName: account.name || 'Claude Console Account',
          platform: 'claude-console',
          status: 'error',
          errorCode: 'CLAUDE_CONSOLE_OVERLOADED',
          reason: '鏈嶅姟杩囪浇锛?29閿欒锛夈€傝处鎴峰皢鏆傛椂鍋滄璋冨害',
          timestamp: new Date().toISOString()
        })
      } catch (webhookError) {
        logger.error('Failed to send overload webhook notification:', webhookError)
      }

      logger.warn(
        `馃毇 Claude Console account marked as overloaded: ${account.name} (${accountId})`
      )
      return { success: true }
    } catch (error) {
      logger.error(`鉂?Failed to mark Claude Console account as overloaded: ${accountId}`, error)
      throw error
    }
  }

  // 鉁?绉婚櫎璐﹀彿鐨勮繃杞界姸鎬?
  async removeAccountOverload(accountId) {
    try {
      const client = redis.getClientSafe()

      await client.hdel(`${this.ACCOUNT_KEY_PREFIX}${accountId}`, 'overloadedAt', 'overloadStatus')

      logger.success(`鉁?Overload status removed for Claude Console account: ${accountId}`)
      return { success: true }
    } catch (error) {
      logger.error(
        `鉂?Failed to remove overload status for Claude Console account: ${accountId}`,
        error
      )
      throw error
    }
  }

  // 馃攳 妫€鏌ヨ处鍙锋槸鍚﹀浜庤繃杞界姸鎬?
  async isAccountOverloaded(accountId) {
    try {
      const account = await this.getAccount(accountId)
      if (!account) {
        return false
      }

      if (account.overloadStatus === 'overloaded' && account.overloadedAt) {
        const overloadedAt = new Date(account.overloadedAt)
        const now = new Date()
        const minutesSinceOverload = (now - overloadedAt) / (1000 * 60)

        // 杩囪浇鐘舵€佹寔缁?0鍒嗛挓鍚庤嚜鍔ㄦ仮澶?
        if (minutesSinceOverload >= 10) {
          await this.removeAccountOverload(accountId)
          return false
        }

        return true
      }

      return false
    } catch (error) {
      logger.error(
        `鉂?Failed to check overload status for Claude Console account: ${accountId}`,
        error
      )
      return false
    }
  }

  // 馃毇 鏍囪璐﹀彿涓哄皝閿佺姸鎬侊紙妯″瀷涓嶆敮鎸佺瓑鍘熷洜锛?
  async blockAccount(accountId, reason) {
    try {
      const client = redis.getClientSafe()

      // 鑾峰彇璐︽埛淇℃伅鐢ㄤ簬webhook閫氱煡
      const accountData = await client.hgetall(`${this.ACCOUNT_KEY_PREFIX}${accountId}`)

      const updates = {
        status: 'blocked',
        errorMessage: reason,
        blockedAt: new Date().toISOString()
      }

      await client.hset(`${this.ACCOUNT_KEY_PREFIX}${accountId}`, updates)

      logger.warn(`馃毇 Claude Console account blocked: ${accountId} - ${reason}`)

      // 鍙戦€乄ebhook閫氱煡
      if (accountData && Object.keys(accountData).length > 0) {
        try {
          const webhookNotifier = require('../utils/webhookNotifier')
          await webhookNotifier.sendAccountAnomalyNotification({
            accountId,
            accountName: accountData.name || 'Unknown Account',
            platform: 'claude-console',
            status: 'blocked',
            errorCode: 'CLAUDE_CONSOLE_BLOCKED',
            reason
          })
        } catch (webhookError) {
          logger.error('Failed to send webhook notification:', webhookError)
        }
      }

      return { success: true }
    } catch (error) {
      logger.error(`鉂?Failed to block Claude Console account: ${accountId}`, error)
      throw error
    }
  }

  // 馃寪 鍒涘缓浠ｇ悊agent锛堜娇鐢ㄧ粺涓€鐨勪唬鐞嗗伐鍏凤級
  _createProxyAgent(proxyConfig) {
    const proxyAgent = ProxyHelper.createProxyAgent(proxyConfig)
    if (proxyAgent) {
      logger.info(
        `馃寪 Using proxy for Claude Console request: ${ProxyHelper.getProxyDescription(proxyConfig)}`
      )
    } else if (proxyConfig) {
      logger.debug('馃寪 Failed to create proxy agent for Claude Console')
    } else {
      logger.debug('馃寪 No proxy configured for Claude Console request')
    }
    return proxyAgent
  }

  // 馃攼 鍔犲瘑鏁忔劅鏁版嵁
  _encryptSensitiveData(data) {
    if (!data) {
      return ''
    }

    try {
      const key = this._generateEncryptionKey()
      const iv = crypto.randomBytes(16)

      const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, key, iv)
      let encrypted = cipher.update(data, 'utf8', 'hex')
      encrypted += cipher.final('hex')

      return `${iv.toString('hex')}:${encrypted}`
    } catch (error) {
      logger.error('鉂?Encryption error:', error)
      return data
    }
  }

  // 馃敁 瑙ｅ瘑鏁忔劅鏁版嵁
  _decryptSensitiveData(encryptedData) {
    if (!encryptedData) {
      return ''
    }

    // 馃幆 妫€鏌ョ紦瀛?
    const cacheKey = crypto.createHash('sha256').update(encryptedData).digest('hex')
    const cached = this._decryptCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    try {
      if (encryptedData.includes(':')) {
        const parts = encryptedData.split(':')
        if (parts.length === 2) {
          const key = this._generateEncryptionKey()
          const iv = Buffer.from(parts[0], 'hex')
          const encrypted = parts[1]

          const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, key, iv)
          let decrypted = decipher.update(encrypted, 'hex', 'utf8')
          decrypted += decipher.final('utf8')

          // 馃捑 瀛樺叆缂撳瓨锛?鍒嗛挓杩囨湡锛?
          this._decryptCache.set(cacheKey, decrypted, 5 * 60 * 1000)

          // 馃搳 瀹氭湡鎵撳嵃缂撳瓨缁熻
          if ((this._decryptCache.hits + this._decryptCache.misses) % 1000 === 0) {
            this._decryptCache.printStats()
          }

          return decrypted
        }
      }

      return encryptedData
    } catch (error) {
      logger.error('鉂?Decryption error:', error)
      return encryptedData
    }
  }

  // 馃攽 鐢熸垚鍔犲瘑瀵嗛挜
  _generateEncryptionKey() {
    // 鎬ц兘浼樺寲锛氱紦瀛樺瘑閽ユ淳鐢熺粨鏋滐紝閬垮厤閲嶅鐨?CPU 瀵嗛泦璁＄畻
    // scryptSync 鏄晠鎰忚璁′负鎱㈤€熺殑瀵嗛挜娲剧敓鍑芥暟锛堥槻鏆村姏鐮磋В锛?
    // 浣嗗湪楂樺苟鍙戝満鏅笅锛屾瘡娆￠兘閲嶆柊璁＄畻浼氬鑷?CPU 100% 鍗犵敤
    if (!this._encryptionKeyCache) {
      // 鍙湪绗竴娆¤皟鐢ㄦ椂璁＄畻锛屽悗缁娇鐢ㄧ紦瀛?
      // 鐢变簬杈撳叆鍙傛暟鍥哄畾锛屾淳鐢熺粨鏋滄案杩滅浉鍚岋紝涓嶅奖鍝嶆暟鎹吋瀹规€?
      this._encryptionKeyCache = crypto.scryptSync(
        config.security.encryptionKey,
        this.ENCRYPTION_SALT,
        32
      )
      logger.info('馃攽 Console encryption key derived and cached for performance optimization')
    }
    return this._encryptionKeyCache
  }

  // 馃幁 鎺╃爜API URL
  _maskApiUrl(apiUrl) {
    if (!apiUrl) {
      return ''
    }

    try {
      const url = new URL(apiUrl)
      return `${url.protocol}//${url.hostname}/***`
    } catch {
      return '***'
    }
  }

  // 馃搳 鑾峰彇闄愭祦淇℃伅
  _getRateLimitInfo(accountData) {
    if (accountData.rateLimitStatus === 'limited' && accountData.rateLimitedAt) {
      const rateLimitedAt = new Date(accountData.rateLimitedAt)
      const now = new Date()
      const minutesSinceRateLimit = Math.floor((now - rateLimitedAt) / (1000 * 60))
      const __parsedDuration = parseInt(accountData.rateLimitDuration)
      const rateLimitDuration = Number.isNaN(__parsedDuration) ? 60 : __parsedDuration
      const minutesRemaining = Math.max(0, rateLimitDuration - minutesSinceRateLimit)

      return {
        isRateLimited: minutesRemaining > 0,
        rateLimitedAt: accountData.rateLimitedAt,
        minutesSinceRateLimit,
        minutesRemaining
      }
    }

    return {
      isRateLimited: false,
      rateLimitedAt: null,
      minutesSinceRateLimit: 0,
      minutesRemaining: 0
    }
  }

  // 馃攧 澶勭悊妯″瀷鏄犲皠锛岀‘淇濆悜鍚庡吋瀹?
  _processModelMapping(supportedModels) {
    // 濡傛灉鏄┖鍊硷紝杩斿洖绌哄璞★紙鏀寔鎵€鏈夋ā鍨嬶級
    if (!supportedModels || (Array.isArray(supportedModels) && supportedModels.length === 0)) {
      return {}
    }

    // 濡傛灉宸茬粡鏄璞℃牸寮忥紙鏂扮殑鏄犲皠琛ㄦ牸寮忥級锛岀洿鎺ヨ繑鍥?
    if (typeof supportedModels === 'object' && !Array.isArray(supportedModels)) {
      return supportedModels
    }

    // 濡傛灉鏄暟缁勬牸寮忥紙鏃ф牸寮忥級锛岃浆鎹负鏄犲皠琛?
    if (Array.isArray(supportedModels)) {
      const mapping = {}
      supportedModels.forEach((model) => {
        if (model && typeof model === 'string') {
          mapping[model] = model // 鏄犲皠鍒拌嚜韬?
        }
      })
      return mapping
    }

    // 鍏朵粬鎯呭喌杩斿洖绌哄璞?
    return {}
  }

  // 馃攳 妫€鏌ユā鍨嬫槸鍚︽敮鎸侊紙鐢ㄤ簬璋冨害锛?
  isModelSupported(modelMapping, requestedModel) {
    // 濡傛灉鏄犲皠琛ㄤ负绌猴紝鏀寔鎵€鏈夋ā鍨?
    if (!modelMapping || Object.keys(modelMapping).length === 0) {
      return true
    }

    // 妫€鏌ヨ姹傜殑妯″瀷鏄惁鍦ㄦ槧灏勮〃鐨勯敭涓紙绮剧‘鍖归厤锛?
    if (Object.prototype.hasOwnProperty.call(modelMapping, requestedModel)) {
      return true
    }

    // 灏濊瘯澶у皬鍐欎笉鏁忔劅鍖归厤
    const requestedModelLower = requestedModel.toLowerCase()
    for (const key of Object.keys(modelMapping)) {
      if (key.toLowerCase() === requestedModelLower) {
        return true
      }
    }

    return false
  }

  // 馃攧 鑾峰彇鏄犲皠鍚庣殑妯″瀷鍚嶇О
  getMappedModel(modelMapping, requestedModel) {
    // 濡傛灉鏄犲皠琛ㄤ负绌猴紝杩斿洖鍘熸ā鍨?
    if (!modelMapping || Object.keys(modelMapping).length === 0) {
      return requestedModel
    }

    // 绮剧‘鍖归厤
    if (modelMapping[requestedModel]) {
      return modelMapping[requestedModel]
    }

    // 澶у皬鍐欎笉鏁忔劅鍖归厤
    const requestedModelLower = requestedModel.toLowerCase()
    for (const [key, value] of Object.entries(modelMapping)) {
      if (key.toLowerCase() === requestedModelLower) {
        return value
      }
    }

    // 濡傛灉涓嶅瓨鍦ㄥ垯杩斿洖鍘熸ā鍨?
    return requestedModel
  }

  // 馃挵 妫€鏌ヨ处鎴蜂娇鐢ㄩ搴︼紙鍩轰簬瀹炴椂缁熻鏁版嵁锛?
  async checkQuotaUsage(accountId) {
    try {
      const quotaAccount = await this.getAccount(accountId)
      if (quotaAccount?.quotaPeriod && quotaAccount.quotaPeriod !== 'daily') {
        const accountQuotaService = require('./accountQuotaService')
        return await accountQuotaService.checkAndEnforceQuota(accountId, 'claude-console')
      }

      // 鑾峰彇瀹炴椂鐨勪娇鐢ㄧ粺璁★紙鍖呭惈璐圭敤锛?
      const usageStats = await redis.getAccountUsageStats(accountId)
      const currentDailyCost = usageStats.daily.cost || 0

      // 鑾峰彇璐︽埛閰嶇疆
      const accountData = await this.getAccount(accountId)
      if (!accountData) {
        logger.warn(`Account not found: ${accountId}`)
        return
      }

      // 瑙ｆ瀽棰濆害閰嶇疆锛岀‘淇濇暟鍊兼湁鏁?
      const dailyQuota = parseFloat(accountData.dailyQuota || '0')
      if (isNaN(dailyQuota) || dailyQuota <= 0) {
        // 娌℃湁璁剧疆鏈夋晥棰濆害锛屾棤闇€妫€鏌?
        return
      }

      // 妫€鏌ユ槸鍚﹀凡缁忓洜棰濆害鍋滅敤锛堥伩鍏嶉噸澶嶆搷浣滐級
      if (!accountData.isActive && accountData.quotaStoppedAt) {
        return
      }

      // 妫€鏌ユ槸鍚﹁秴杩囬搴﹂檺鍒?
      if (currentDailyCost >= dailyQuota) {
        // 浣跨敤鍘熷瓙鎿嶄綔閬垮厤绔炴€佹潯浠?- 鍐嶆妫€鏌ユ槸鍚﹀凡璁剧疆quotaStoppedAt
        const client = redis.getClientSafe()
        const accountKey = `${this.ACCOUNT_KEY_PREFIX}${accountId}`

        // double-check locking pattern - 妫€鏌uotaStoppedAt鑰屼笉鏄痵tatus
        const existingQuotaStop = await client.hget(accountKey, 'quotaStoppedAt')
        if (existingQuotaStop) {
          return // 宸茬粡琚叾浠栬繘绋嬪鐞?
        }

        // 瓒呰繃棰濆害锛屽仠鐢ㄨ处鎴?
        const updates = {
          isActive: false,
          quotaStoppedAt: new Date().toISOString(),
          errorMessage: `Daily quota exceeded: $${currentDailyCost.toFixed(2)} / $${dailyQuota.toFixed(2)}`,
          schedulable: false, // 鍋滄璋冨害
          // 浣跨敤鐙珛鐨勯搴﹁秴闄愯嚜鍔ㄥ仠姝㈡爣璁?
          quotaAutoStopped: 'true'
        }

        // 鍙湁褰撳墠鐘舵€佹槸active鏃舵墠鏀逛负quota_exceeded
        // 濡傛灉鏄痳ate_limited绛夊叾浠栫姸鎬侊紝淇濇寔鍘熺姸鎬佷笉鍙?
        const currentStatus = await client.hget(accountKey, 'status')
        if (currentStatus === 'active') {
          updates.status = 'quota_exceeded'
        }

        await this.updateAccount(accountId, updates)

        logger.warn(
          `馃挵 Account ${accountId} exceeded daily quota: $${currentDailyCost.toFixed(2)} / $${dailyQuota.toFixed(2)}`
        )

        // 鍙戦€亀ebhook閫氱煡
        try {
          const webhookNotifier = require('../utils/webhookNotifier')
          await webhookNotifier.sendAccountAnomalyNotification({
            accountId,
            accountName: accountData.name || 'Unknown Account',
            platform: 'claude-console',
            status: 'quota_exceeded',
            errorCode: 'CLAUDE_CONSOLE_QUOTA_EXCEEDED',
            reason: `Daily quota exceeded: $${currentDailyCost.toFixed(2)} / $${dailyQuota.toFixed(2)}`
          })
        } catch (webhookError) {
          logger.error('Failed to send webhook notification for quota exceeded:', webhookError)
        }
      }

      logger.debug(
        `馃挵 Quota check for account ${accountId}: $${currentDailyCost.toFixed(4)} / $${dailyQuota.toFixed(2)}`
      )
    } catch (error) {
      logger.error('Failed to check quota usage:', error)
    }
  }

  // 馃攧 閲嶇疆璐︽埛姣忔棩浣跨敤閲忥紙鎭㈠鍥犻搴﹀仠鐢ㄧ殑璐︽埛锛?
  async resetDailyUsage(accountId) {
    try {
      const accountData = await this.getAccount(accountId)
      if (!accountData) {
        return
      }

      const today = redis.getDateStringInTimezone()
      const updates = {
        lastResetDate: today
      }

      // 濡傛灉璐︽埛鏄洜涓鸿秴棰濊鍋滅敤鐨勶紝鎭㈠璐︽埛
      // 娉ㄦ剰锛氱姸鎬佸彲鑳芥槸 quota_exceeded 鎴?rate_limited锛堝鏋?29閿欒鏃朵篃瓒呴浜嗭級
      if (
        accountData.quotaStoppedAt &&
        accountData.isActive === false &&
        (accountData.status === 'quota_exceeded' || accountData.status === 'rate_limited')
      ) {
        updates.isActive = true
        updates.status = 'active'
        updates.errorMessage = ''
        updates.quotaStoppedAt = ''

        // 鍙仮澶嶅洜棰濆害瓒呴檺鑰岃嚜鍔ㄥ仠姝㈢殑璐︽埛
        if (accountData.quotaAutoStopped === 'true') {
          updates.schedulable = true
          updates.quotaAutoStopped = ''
        }

        // 濡傛灉鏄痳ate_limited鐘舵€侊紝涔熸竻闄ら檺娴佺浉鍏冲瓧娈?
        if (accountData.status === 'rate_limited') {
          const client = redis.getClientSafe()
          const accountKey = `${this.ACCOUNT_KEY_PREFIX}${accountId}`
          await client.hdel(accountKey, 'rateLimitedAt', 'rateLimitStatus', 'rateLimitAutoStopped')
        }

        logger.info(
          `鉁?Restored account ${accountId} after daily reset (was ${accountData.status})`
        )
      }

      await this.updateAccount(accountId, updates)

      logger.debug(`馃攧 Reset daily usage for account ${accountId}`)
    } catch (error) {
      logger.error('Failed to reset daily usage:', error)
    }
  }

  // 馃攧 閲嶇疆鎵€鏈夎处鎴风殑姣忔棩浣跨敤閲?
  async resetAllDailyUsage() {
    try {
      const accounts = await this.getAllAccounts()
      // 涓庣粺璁′竴鑷翠娇鐢ㄩ厤缃椂鍖烘棩鏈?
      const today = redis.getDateStringInTimezone()
      let resetCount = 0

      for (const account of accounts) {
        // 鍙噸缃渶瑕侀噸缃殑璐︽埛
        if (account.lastResetDate !== today) {
          await this.resetDailyUsage(account.id)
          resetCount += 1
        }
      }

      logger.success(`鉁?Reset daily usage for ${resetCount} Claude Console accounts`)
    } catch (error) {
      logger.error('Failed to reset all daily usage:', error)
    }
  }

  // 馃搳 鑾峰彇璐︽埛浣跨敤缁熻锛堝熀浜庡疄鏃舵暟鎹級
  async getAccountUsageStats(accountId) {
    try {
      // 鑾峰彇瀹炴椂鐨勪娇鐢ㄧ粺璁★紙鍖呭惈璐圭敤锛?
      const usageStats = await redis.getAccountUsageStats(accountId)
      const currentDailyCost = usageStats.daily.cost || 0

      // 鑾峰彇璐︽埛閰嶇疆
      const accountData = await this.getAccount(accountId)
      if (!accountData) {
        return null
      }

      const dailyQuota = parseFloat(accountData.dailyQuota || '0')

      return {
        dailyQuota,
        dailyUsage: currentDailyCost, // 浣跨敤瀹炴椂璁＄畻鐨勮垂鐢?
        remainingQuota: dailyQuota > 0 ? Math.max(0, dailyQuota - currentDailyCost) : null,
        usagePercentage: dailyQuota > 0 ? (currentDailyCost / dailyQuota) * 100 : 0,
        lastResetDate: accountData.lastResetDate,
        quotaStoppedAt: accountData.quotaStoppedAt,
        isQuotaExceeded: dailyQuota > 0 && currentDailyCost >= dailyQuota,
        // 棰濆杩斿洖瀹屾暣鐨勪娇鐢ㄧ粺璁?
        fullUsageStats: usageStats
      }
    } catch (error) {
      logger.error('Failed to get account usage stats:', error)
      return null
    }
  }

  // 馃攧 閲嶇疆璐︽埛鎵€鏈夊紓甯哥姸鎬?
  async resetAccountStatus(accountId) {
    try {
      const accountData = await this.getAccount(accountId)
      if (!accountData) {
        throw new Error('Account not found')
      }

      const client = redis.getClientSafe()
      const accountKey = `${this.ACCOUNT_KEY_PREFIX}${accountId}`

      // 鍑嗗瑕佹洿鏂扮殑瀛楁
      const updates = {
        status: 'active',
        errorMessage: '',
        schedulable: 'true',
        isActive: 'true' // 閲嶈锛氬繀椤绘仮澶峣sActive鐘舵€?
      }

      // 鍒犻櫎鎵€鏈夊紓甯哥姸鎬佺浉鍏崇殑瀛楁
      const fieldsToDelete = [
        'rateLimitedAt',
        'rateLimitStatus',
        'unauthorizedAt',
        'unauthorizedCount',
        'overloadedAt',
        'overloadStatus',
        'blockedAt',
        'quotaStoppedAt'
      ]

      // 鎵ц鏇存柊
      await client.hset(accountKey, updates)
      await client.hdel(accountKey, ...fieldsToDelete)

      logger.success(`鉁?Reset all error status for Claude Console account ${accountId}`)

      // 鍙戦€?Webhook 閫氱煡
      try {
        const webhookNotifier = require('../utils/webhookNotifier')
        await webhookNotifier.sendAccountAnomalyNotification({
          accountId,
          accountName: accountData.name || accountId,
          platform: 'claude-console',
          status: 'recovered',
          errorCode: 'STATUS_RESET',
          reason: 'Account status manually reset',
          timestamp: new Date().toISOString()
        })
      } catch (webhookError) {
        logger.warn('Failed to send webhook notification:', webhookError)
      }

      return { success: true, accountId }
    } catch (error) {
      logger.error(`鉂?Failed to reset Claude Console account status: ${accountId}`, error)
      throw error
    }
  }

  /**
   * 鈴?妫€鏌ヨ处鎴疯闃呮槸鍚﹁繃鏈?
   * @param {Object} account - 璐︽埛瀵硅薄
   * @returns {boolean} - true: 宸茶繃鏈? false: 鏈繃鏈?
   */
  isSubscriptionExpired(account) {
    if (!account.subscriptionExpiresAt) {
      return false // 鏈缃涓烘案涓嶈繃鏈?
    }
    const expiryDate = new Date(account.subscriptionExpiresAt)
    return expiryDate <= new Date()
  }

  // 馃毇 鏍囪璐︽埛鐨?count_tokens 绔偣涓嶅彲鐢?
  async markCountTokensUnavailable(accountId) {
    try {
      const client = redis.getClientSafe()
      const accountKey = `${this.ACCOUNT_KEY_PREFIX}${accountId}`

      // 妫€鏌ヨ处鎴锋槸鍚﹀瓨鍦?
      const exists = await client.exists(accountKey)
      if (!exists) {
        logger.warn(
          `鈿狅笍 Cannot mark count_tokens unavailable for non-existent account: ${accountId}`
        )
        return { success: false, reason: 'Account not found' }
      }

      await client.hset(accountKey, {
        countTokensUnavailable: 'true',
        countTokensUnavailableAt: new Date().toISOString()
      })

      logger.info(
        `馃毇 Marked count_tokens endpoint as unavailable for Claude Console account: ${accountId}`
      )
      return { success: true }
    } catch (error) {
      logger.error(`鉂?Failed to mark count_tokens unavailable for account ${accountId}:`, error)
      throw error
    }
  }

  // 鉁?绉婚櫎璐︽埛鐨?count_tokens 涓嶅彲鐢ㄦ爣璁?
  async removeCountTokensUnavailable(accountId) {
    try {
      const client = redis.getClientSafe()
      const accountKey = `${this.ACCOUNT_KEY_PREFIX}${accountId}`

      await client.hdel(accountKey, 'countTokensUnavailable', 'countTokensUnavailableAt')

      logger.info(
        `鉁?Removed count_tokens unavailable mark for Claude Console account: ${accountId}`
      )
      return { success: true }
    } catch (error) {
      logger.error(
        `鉂?Failed to remove count_tokens unavailable mark for account ${accountId}:`,
        error
      )
      throw error
    }
  }

  // 馃攳 妫€鏌ヨ处鎴风殑 count_tokens 绔偣鏄惁涓嶅彲鐢?
  async isCountTokensUnavailable(accountId) {
    try {
      const client = redis.getClientSafe()
      const accountKey = `${this.ACCOUNT_KEY_PREFIX}${accountId}`

      const value = await client.hget(accountKey, 'countTokensUnavailable')
      return value === 'true'
    } catch (error) {
      logger.error(`鉂?Failed to check count_tokens availability for account ${accountId}:`, error)
      return false // 鍑洪敊鏃堕粯璁よ繑鍥炲彲鐢紝閬垮厤璇樆鏂?
    }
  }
}

module.exports = new ClaudeConsoleAccountService()
