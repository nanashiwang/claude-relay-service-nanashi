const redisClient = require('../models/redis')
const { v4: uuidv4 } = require('uuid')
const crypto = require('crypto')
const axios = require('axios')
const ProxyHelper = require('../utils/proxyHelper')
const config = require('../../config/config')
const logger = require('../utils/logger')
// const { maskToken } = require('../utils/tokenMask')
const {
  logRefreshStart,
  logRefreshSuccess,
  logRefreshError,
  logTokenUsage,
  logRefreshSkipped
} = require('../utils/tokenRefreshLogger')
const LRUCache = require('../utils/lruCache')
const tokenRefreshService = require('./tokenRefreshService')
const { getPrimaryPrefixedRedisKeys } = require('../utils/redisKeyFilter')

// 鍔犲瘑鐩稿叧甯搁噺
const ALGORITHM = 'aes-256-cbc'
const ENCRYPTION_SALT = 'openai-account-salt'
const IV_LENGTH = 16

// 馃殌 鎬ц兘浼樺寲锛氱紦瀛樻淳鐢熺殑鍔犲瘑瀵嗛挜锛岄伩鍏嶆瘡娆￠噸澶嶈绠?
// scryptSync 鏄?CPU 瀵嗛泦鍨嬫搷浣滐紝缂撳瓨鍙互鍑忓皯 95%+ 鐨?CPU 鍗犵敤
let _encryptionKeyCache = null

// 馃攧 瑙ｅ瘑缁撴灉缂撳瓨锛屾彁楂樿В瀵嗘€ц兘
const decryptCache = new LRUCache(500)

// 鐢熸垚鍔犲瘑瀵嗛挜锛堜娇鐢ㄤ笌 claudeAccountService 鐩稿悓鐨勬柟娉曪級
function generateEncryptionKey() {
  if (!_encryptionKeyCache) {
    _encryptionKeyCache = crypto.scryptSync(config.security.encryptionKey, ENCRYPTION_SALT, 32)
    logger.info('馃攽 OpenAI encryption key derived and cached for performance optimization')
  }
  return _encryptionKeyCache
}

// OpenAI 璐︽埛閿墠缂€
const OPENAI_ACCOUNT_KEY_PREFIX = 'openai:account:'
const SHARED_OPENAI_ACCOUNTS_KEY = 'shared_openai_accounts'
const ACCOUNT_SESSION_MAPPING_PREFIX = 'openai_session_account_mapping:'

// 鍔犲瘑鍑芥暟
function encrypt(text) {
  if (!text) {
    return ''
  }
  const key = generateEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(text)
  encrypted = Buffer.concat([encrypted, cipher.final()])
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`
}

// 瑙ｅ瘑鍑芥暟
function decrypt(text) {
  if (!text || text === '') {
    return ''
  }

  // 妫€鏌ユ槸鍚︽槸鏈夋晥鐨勫姞瀵嗘牸寮忥紙鑷冲皯闇€瑕?32 涓瓧绗︾殑 IV + 鍐掑彿 + 鍔犲瘑鏂囨湰锛?
  if (text.length < 33 || text.charAt(32) !== ':') {
    logger.warn('Invalid encrypted text format, returning empty string', {
      textLength: text ? text.length : 0,
      char32: text && text.length > 32 ? text.charAt(32) : 'N/A',
      first50: text ? text.substring(0, 50) : 'N/A'
    })
    return ''
  }

  // 馃幆 妫€鏌ョ紦瀛?
  const cacheKey = crypto.createHash('sha256').update(text).digest('hex')
  const cached = decryptCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  try {
    const key = generateEncryptionKey()
    // IV 鏄浐瀹氶暱搴︾殑 32 涓崄鍏繘鍒跺瓧绗︼紙16 瀛楄妭锛?
    const ivHex = text.substring(0, 32)
    const encryptedHex = text.substring(33) // 璺宠繃鍐掑彿

    const iv = Buffer.from(ivHex, 'hex')
    const encryptedText = Buffer.from(encryptedHex, 'hex')
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    let decrypted = decipher.update(encryptedText)
    decrypted = Buffer.concat([decrypted, decipher.final()])
    const result = decrypted.toString()

    // 馃捑 瀛樺叆缂撳瓨锛?鍒嗛挓杩囨湡锛?
    decryptCache.set(cacheKey, result, 5 * 60 * 1000)

    // 馃搳 瀹氭湡鎵撳嵃缂撳瓨缁熻
    if ((decryptCache.hits + decryptCache.misses) % 1000 === 0) {
      decryptCache.printStats()
    }

    return result
  } catch (error) {
    logger.error('Decryption error:', error)
    return ''
  }
}

// 馃Ч 瀹氭湡娓呯悊缂撳瓨锛堟瘡10鍒嗛挓锛?
setInterval(
  () => {
    decryptCache.cleanup()
    logger.info('馃Ч OpenAI decrypt cache cleanup completed', decryptCache.getStats())
  },
  10 * 60 * 1000
)

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function computeResetMeta(updatedAt, resetAfterSeconds) {
  if (!updatedAt || resetAfterSeconds === null || resetAfterSeconds === undefined) {
    return {
      resetAt: null,
      remainingSeconds: null
    }
  }

  const updatedMs = Date.parse(updatedAt)
  if (Number.isNaN(updatedMs)) {
    return {
      resetAt: null,
      remainingSeconds: null
    }
  }

  const resetMs = updatedMs + resetAfterSeconds * 1000
  return {
    resetAt: new Date(resetMs).toISOString(),
    remainingSeconds: Math.max(0, Math.round((resetMs - Date.now()) / 1000))
  }
}

function buildCodexUsageSnapshot(accountData) {
  const updatedAt = accountData.codexUsageUpdatedAt

  const primaryUsedPercent = toNumberOrNull(accountData.codexPrimaryUsedPercent)
  const primaryResetAfterSeconds = toNumberOrNull(accountData.codexPrimaryResetAfterSeconds)
  const primaryWindowMinutes = toNumberOrNull(accountData.codexPrimaryWindowMinutes)
  const secondaryUsedPercent = toNumberOrNull(accountData.codexSecondaryUsedPercent)
  const secondaryResetAfterSeconds = toNumberOrNull(accountData.codexSecondaryResetAfterSeconds)
  const secondaryWindowMinutes = toNumberOrNull(accountData.codexSecondaryWindowMinutes)
  const overSecondaryPercent = toNumberOrNull(accountData.codexPrimaryOverSecondaryLimitPercent)

  const hasPrimaryData =
    primaryUsedPercent !== null ||
    primaryResetAfterSeconds !== null ||
    primaryWindowMinutes !== null
  const hasSecondaryData =
    secondaryUsedPercent !== null ||
    secondaryResetAfterSeconds !== null ||
    secondaryWindowMinutes !== null

  if (!updatedAt && !hasPrimaryData && !hasSecondaryData) {
    return null
  }

  const primaryMeta = computeResetMeta(updatedAt, primaryResetAfterSeconds)
  const secondaryMeta = computeResetMeta(updatedAt, secondaryResetAfterSeconds)

  return {
    updatedAt,
    primary: {
      usedPercent: primaryUsedPercent,
      resetAfterSeconds: primaryResetAfterSeconds,
      windowMinutes: primaryWindowMinutes,
      resetAt: primaryMeta.resetAt,
      remainingSeconds: primaryMeta.remainingSeconds
    },
    secondary: {
      usedPercent: secondaryUsedPercent,
      resetAfterSeconds: secondaryResetAfterSeconds,
      windowMinutes: secondaryWindowMinutes,
      resetAt: secondaryMeta.resetAt,
      remainingSeconds: secondaryMeta.remainingSeconds
    },
    primaryOverSecondaryPercent: overSecondaryPercent
  }
}

function buildRateLimitInfoFromAccountSnapshot(accountData) {
  const status = accountData.rateLimitStatus || 'normal'
  const rateLimitedAt = accountData.rateLimitedAt || null
  const rateLimitResetAt = accountData.rateLimitResetAt || null

  if (status === 'limited') {
    const now = Date.now()
    let remainingTime = 0

    if (rateLimitResetAt) {
      const resetAt = new Date(rateLimitResetAt).getTime()
      remainingTime = Math.max(0, resetAt - now)
    } else if (rateLimitedAt) {
      const limitedAt = new Date(rateLimitedAt).getTime()
      const limitDuration = 60 * 60 * 1000
      remainingTime = Math.max(0, limitedAt + limitDuration - now)
    }

    const minutesRemaining = remainingTime > 0 ? Math.ceil(remainingTime / (60 * 1000)) : 0

    return {
      status,
      isRateLimited: minutesRemaining > 0,
      rateLimitedAt,
      rateLimitResetAt,
      minutesRemaining
    }
  }

  return {
    status,
    isRateLimited: false,
    rateLimitedAt,
    rateLimitResetAt,
    minutesRemaining: 0
  }
}
// 鍒锋柊璁块棶浠ょ墝
async function refreshAccessToken(refreshToken, proxy = null) {
  try {
    // Codex CLI 鐨勫畼鏂?CLIENT_ID
    const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

    // 鍑嗗璇锋眰鏁版嵁
    const requestData = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
      scope: 'openid profile email'
    }).toString()

    // 閰嶇疆璇锋眰閫夐」
    const requestOptions = {
      method: 'POST',
      url: 'https://auth.openai.com/oauth/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': requestData.length
      },
      data: requestData,
      timeout: config.requestTimeout || 600000 // 浣跨敤缁熶竴鐨勮姹傝秴鏃堕厤缃?
    }

    // 閰嶇疆浠ｇ悊锛堝鏋滄湁锛?
    const proxyAgent = ProxyHelper.createProxyAgent(proxy)
    if (proxyAgent) {
      requestOptions.httpAgent = proxyAgent
      requestOptions.httpsAgent = proxyAgent
      requestOptions.proxy = false
      logger.info(
        `馃寪 Using proxy for OpenAI token refresh: ${ProxyHelper.getProxyDescription(proxy)}`
      )
    } else {
      logger.debug('馃寪 No proxy configured for OpenAI token refresh')
    }

    // 鍙戦€佽姹?
    logger.info('馃攳 鍙戦€?token 鍒锋柊璇锋眰锛屼娇鐢ㄤ唬鐞?', !!requestOptions.httpsAgent)
    const response = await axios(requestOptions)

    if (response.status === 200 && response.data) {
      const result = response.data

      logger.info('鉁?Successfully refreshed OpenAI token')

      // 杩斿洖鏂扮殑 token 淇℃伅
      return {
        access_token: result.access_token,
        id_token: result.id_token,
        refresh_token: result.refresh_token || refreshToken, // 濡傛灉娌℃湁杩斿洖鏂扮殑锛屼繚鐣欏師鏉ョ殑
        expires_in: result.expires_in || 3600,
        expiry_date: Date.now() + (result.expires_in || 3600) * 1000 // 璁＄畻杩囨湡鏃堕棿
      }
    } else {
      throw new Error(`Failed to refresh token: ${response.status} ${response.statusText}`)
    }
  } catch (error) {
    if (error.response) {
      // 鏈嶅姟鍣ㄥ搷搴斾簡閿欒鐘舵€佺爜
      const errorData = error.response.data || {}
      logger.error('OpenAI token refresh failed:', {
        status: error.response.status,
        data: errorData,
        headers: error.response.headers
      })

      // 鏋勫缓璇︾粏鐨勯敊璇俊鎭?
      let errorMessage = `OpenAI 服务返回错误 (${error.response.status})`

      if (error.response.status === 400) {
        if (errorData.error === 'invalid_grant') {
          errorMessage = 'Refresh Token 无效或已过期，请重新授权'
        } else if (errorData.error === 'invalid_request') {
          errorMessage = `请求参数错误: ${errorData.error_description || errorData.error}`
        } else {
          errorMessage = `请求错误: ${errorData.error_description || errorData.error || '未知错误'}`
        }
      } else if (error.response.status === 401) {
        errorMessage = '认证失败：Refresh Token 无效'
      } else if (error.response.status === 403) {
        errorMessage = '访问被拒绝：可能是 IP 被封或账号被禁用'
      } else if (error.response.status === 429) {
        errorMessage = '请求过于频繁，请稍后重试'
      } else if (error.response.status >= 500) {
        errorMessage = 'OpenAI 服务端内部错误，请稍后重试'
      } else if (errorData.error_description) {
        errorMessage = errorData.error_description
      } else if (errorData.error) {
        errorMessage = errorData.error
      } else if (errorData.message) {
        errorMessage = errorData.message
      }

      const fullError = new Error(errorMessage)
      fullError.status = error.response.status
      fullError.details = errorData
      throw fullError
    } else if (error.request) {
      // 璇锋眰宸插彂鍑轰絾娌℃湁鏀跺埌鍝嶅簲
      logger.error('OpenAI token refresh no response:', error.message)

      let errorMessage = '无法连接到 OpenAI 服务'
      if (proxy) {
        errorMessage += `（代理: ${ProxyHelper.getProxyDescription(proxy)}）`
      }
      if (error.code === 'ECONNREFUSED') {
        errorMessage += ' - 连接被拒绝'
      } else if (error.code === 'ETIMEDOUT') {
        errorMessage += ' - 连接超时'
      } else if (error.code === 'ENOTFOUND') {
        errorMessage += ' - 无法解析域名'
      } else if (error.code === 'EPROTO') {
        errorMessage += ' - 协议错误（可能是代理配置问题）'
      } else if (error.message) {
        errorMessage += ` - ${error.message}`
      }

      const fullError = new Error(errorMessage)
      fullError.code = error.code
      throw fullError
    } else {
      // 璁剧疆璇锋眰鏃跺彂鐢熼敊璇?
      logger.error('OpenAI token refresh error:', error.message)
      const fullError = new Error(`璇锋眰璁剧疆閿欒: ${error.message}`)
      fullError.originalError = error
      throw fullError
    }
  }
}

// 妫€鏌?token 鏄惁杩囨湡
function isTokenExpired(account) {
  if (!account.expiresAt) {
    return false
  }
  return new Date(account.expiresAt) <= new Date()
}

/**
 * 妫€鏌ヨ处鎴疯闃呮槸鍚﹁繃鏈?
 * @param {Object} account - 璐︽埛瀵硅薄
 * @returns {boolean} - true: 宸茶繃鏈? false: 鏈繃鏈?
 */
function isSubscriptionExpired(account) {
  if (!account.subscriptionExpiresAt) {
    return false // 未设置视为永不过期
  }
  const expiryDate = new Date(account.subscriptionExpiresAt)
  return expiryDate <= new Date()
}

function shouldDisableAccountAfterRefreshError(error) {
  if (!error) {
    return false
  }

  const status = Number(error.status || error.statusCode || error.response?.status)
  if (status === 401) {
    return true
  }

  const errorCodes = [error.code, error.error, error.details?.error, error.response?.data?.error]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim().toLowerCase())

  if (errorCodes.includes('invalid_grant') || errorCodes.includes('invalid_refresh_token')) {
    return true
  }

  const message = [
    error.message,
    error.details?.error_description,
    error.details?.message,
    error.response?.data?.error_description,
    error.response?.data?.message
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .toLowerCase()

  return (
    message.includes('invalid_grant') ||
    message.includes('refresh token') ||
    message.includes('token expired and refresh failed')
  )
}

// ????? access token???????
async function refreshAccountToken(accountId) {
  let lockAcquired = false
  let account = null
  let accountName = accountId

  try {
    account = await getAccount(accountId)
    if (!account) {
      throw new Error('Account not found')
    }

    accountName = account.name || accountId

    // 妫€鏌ユ槸鍚︽湁 refresh token
    // account.refreshToken 鍦?getAccount 涓凡缁忚瑙ｅ瘑浜嗭紝鐩存帴浣跨敤鍗冲彲
    const refreshToken = account.refreshToken || null

    if (!refreshToken) {
      logRefreshSkipped(accountId, accountName, 'openai', 'No refresh token available')
      throw new Error('No refresh token available')
    }

    // 灏濊瘯鑾峰彇鍒嗗竷寮忛攣
    lockAcquired = await tokenRefreshService.acquireRefreshLock(accountId, 'openai')

    if (!lockAcquired) {
      // 濡傛灉鏃犳硶鑾峰彇閿侊紝璇存槑鍙︿竴涓繘绋嬫鍦ㄥ埛鏂?
      logger.info(
        `馃敀 Token refresh already in progress for OpenAI account: ${accountName} (${accountId})`
      )
      logRefreshSkipped(accountId, accountName, 'openai', 'already_locked')

      // 绛夊緟涓€娈垫椂闂村悗杩斿洖锛屾湡鏈涘叾浠栬繘绋嬪凡瀹屾垚鍒锋柊
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // 閲嶆柊鑾峰彇璐︽埛鏁版嵁锛堝彲鑳藉凡琚叾浠栬繘绋嬪埛鏂帮級
      const updatedAccount = await getAccount(accountId)
      if (updatedAccount && !isTokenExpired(updatedAccount)) {
        return {
          access_token: decrypt(updatedAccount.accessToken),
          id_token: updatedAccount.idToken,
          refresh_token: updatedAccount.refreshToken,
          expires_in: 3600,
          expiry_date: new Date(updatedAccount.expiresAt).getTime()
        }
      }

      throw new Error('Token refresh in progress by another process')
    }

    // 鑾峰彇閿佹垚鍔燂紝寮€濮嬪埛鏂?
    logRefreshStart(accountId, accountName, 'openai')
    logger.info(`馃攧 Starting token refresh for OpenAI account: ${accountName} (${accountId})`)

    // 鑾峰彇浠ｇ悊閰嶇疆
    let proxy = null
    if (account.proxy) {
      try {
        proxy = typeof account.proxy === 'string' ? JSON.parse(account.proxy) : account.proxy
      } catch (e) {
        logger.warn(`Failed to parse proxy config for account ${accountId}:`, e)
      }
    }

    const newTokens = await refreshAccessToken(refreshToken, proxy)
    if (!newTokens) {
      throw new Error('Failed to refresh token')
    }

    // 鍑嗗鏇存柊鏁版嵁 - 涓嶈鍦ㄨ繖閲屽姞瀵嗭紝璁?updateAccount 缁熶竴澶勭悊
    const updates = {
      accessToken: newTokens.access_token, // 涓嶅姞瀵嗭紝璁?updateAccount 澶勭悊
      expiresAt: new Date(newTokens.expiry_date).toISOString()
    }

    // 濡傛灉鏈夋柊鐨?ID token锛屼篃鏇存柊瀹冿紙杩欏浜庨娆℃湭鎻愪緵 ID Token 鐨勮处鎴风壒鍒噸瑕侊級
    if (newTokens.id_token) {
      updates.idToken = newTokens.id_token // 涓嶅姞瀵嗭紝璁?updateAccount 澶勭悊

      // 濡傛灉涔嬪墠娌℃湁 ID Token锛屽皾璇曡В鏋愬苟鏇存柊鐢ㄦ埛淇℃伅
      if (!account.idToken || account.idToken === '') {
        try {
          const idTokenParts = newTokens.id_token.split('.')
          if (idTokenParts.length === 3) {
            const payload = JSON.parse(Buffer.from(idTokenParts[1], 'base64').toString())
            const authClaims = payload['https://api.openai.com/auth'] || {}

            // 鏇存柊璐︽埛淇℃伅 - 浣跨敤姝ｇ‘鐨勫瓧娈靛悕
            // OpenAI ID Token涓敤鎴稩D鍦╟hatgpt_account_id銆乧hatgpt_user_id鍜寀ser_id瀛楁
            if (authClaims.chatgpt_account_id) {
              updates.accountId = authClaims.chatgpt_account_id
            }
            if (authClaims.chatgpt_user_id) {
              updates.chatgptUserId = authClaims.chatgpt_user_id
            } else if (authClaims.user_id) {
              // 鏈変簺鎯呭喌涓嬪彲鑳藉彧鏈塽ser_id瀛楁
              updates.chatgptUserId = authClaims.user_id
            }
            if (authClaims.organizations?.[0]?.id) {
              updates.organizationId = authClaims.organizations[0].id
            }
            if (authClaims.organizations?.[0]?.role) {
              updates.organizationRole = authClaims.organizations[0].role
            }
            if (authClaims.organizations?.[0]?.title) {
              updates.organizationTitle = authClaims.organizations[0].title
            }
            if (payload.email) {
              updates.email = payload.email // 涓嶅姞瀵嗭紝璁?updateAccount 澶勭悊
            }
            if (payload.email_verified !== undefined) {
              updates.emailVerified = payload.email_verified
            }

            logger.info(`Updated user info from ID Token for account ${accountId}`)
          }
        } catch (e) {
          logger.warn(`Failed to parse ID Token for account ${accountId}:`, e)
        }
      }
    }

    // 濡傛灉杩斿洖浜嗘柊鐨?refresh token锛屾洿鏂板畠
    if (newTokens.refresh_token && newTokens.refresh_token !== refreshToken) {
      updates.refreshToken = newTokens.refresh_token // 涓嶅姞瀵嗭紝璁?updateAccount 澶勭悊
      logger.info(`Updated refresh token for account ${accountId}`)
    }

    // 鏇存柊璐︽埛淇℃伅
    await updateAccount(accountId, updates)

    logRefreshSuccess(accountId, accountName, 'openai', newTokens) // 浼犲叆瀹屾暣鐨?newTokens 瀵硅薄
    return newTokens
  } catch (error) {
    logRefreshError(accountId, account?.name || accountName, 'openai', error.message)

    const shouldDisableAccount = shouldDisableAccountAfterRefreshError(error)
    if (shouldDisableAccount) {
      try {
        await markAccountUnauthorized(accountId, `Token refresh failed: ${error.message}`)
        logger.warn(
          `馃毇 Auto-marked OpenAI account ${account?.name || accountName} as unauthorized after refresh failure`
        )
      } catch (markError) {
        logger.error(
          `Failed to mark OpenAI account ${accountId} as unauthorized after refresh failure:`,
          markError
        )
      }
    } else {
      // 鍙戦€?Webhook 閫氱煡锛堝鏋滃惎鐢級
      try {
        const webhookNotifier = require('../utils/webhookNotifier')
        await webhookNotifier.sendAccountAnomalyNotification({
          accountId,
          accountName: account?.name || accountName,
          platform: 'openai',
          status: 'error',
          errorCode: 'OPENAI_TOKEN_REFRESH_FAILED',
          reason: `Token refresh failed: ${error.message}`,
          timestamp: new Date().toISOString()
        })
        logger.info(
          `馃摙 Webhook notification sent for OpenAI account ${account?.name || accountName} refresh failure`
        )
      } catch (webhookError) {
        logger.error('Failed to send webhook notification:', webhookError)
      }
    }

    throw error
  } finally {
    // 纭繚閲婃斁閿?
    if (lockAcquired) {
      await tokenRefreshService.releaseRefreshLock(accountId, 'openai')
      logger.debug(`馃敁 Released refresh lock for OpenAI account ${accountId}`)
    }
  }
}

// 鍒涘缓璐︽埛
async function createAccount(accountData) {
  const accountId = uuidv4()
  const now = new Date().toISOString()

  // 澶勭悊OAuth鏁版嵁
  let oauthData = {}
  if (accountData.openaiOauth) {
    oauthData =
      typeof accountData.openaiOauth === 'string'
        ? JSON.parse(accountData.openaiOauth)
        : accountData.openaiOauth
  }

  // 澶勭悊璐︽埛淇℃伅
  const accountInfo = accountData.accountInfo || {}

  // 妫€鏌ラ偖绠辨槸鍚﹀凡缁忔槸鍔犲瘑鏍煎紡锛堝寘鍚啋鍙峰垎闅旂殑32浣嶅崄鍏繘鍒跺瓧绗︼級
  const isEmailEncrypted =
    accountInfo.email && accountInfo.email.length >= 33 && accountInfo.email.charAt(32) === ':'

  const account = {
    id: accountId,
    platform: accountData.platform || 'openai',
    name: accountData.name,
    description: accountData.description || '',
    accountType: accountData.accountType || 'shared',
    groupId: accountData.groupId || null,
    priority: accountData.priority || 50,
    rateLimitDuration:
      accountData.rateLimitDuration !== undefined && accountData.rateLimitDuration !== null
        ? accountData.rateLimitDuration
        : 60,
    // OAuth鐩稿叧瀛楁锛堝姞瀵嗗瓨鍌級
    // ID Token 鐜板湪鏄彲閫夌殑锛屽鏋滄病鏈夋彁渚涗細鍦ㄩ娆″埛鏂版椂鑷姩鑾峰彇
    idToken: oauthData.idToken && oauthData.idToken.trim() ? encrypt(oauthData.idToken) : '',
    accessToken:
      oauthData.accessToken && oauthData.accessToken.trim() ? encrypt(oauthData.accessToken) : '',
    refreshToken:
      oauthData.refreshToken && oauthData.refreshToken.trim()
        ? encrypt(oauthData.refreshToken)
        : '',
    openaiOauth: encrypt(JSON.stringify(oauthData)),
    // 璐︽埛淇℃伅瀛楁 - 纭繚鎵€鏈夊瓧娈甸兘琚繚瀛橈紝鍗充娇鏄┖瀛楃涓?
    accountId: accountInfo.accountId || '',
    chatgptUserId: accountInfo.chatgptUserId || '',
    organizationId: accountInfo.organizationId || '',
    organizationRole: accountInfo.organizationRole || '',
    organizationTitle: accountInfo.organizationTitle || '',
    planType: accountInfo.planType || '',
    // 閭瀛楁锛氭鏌ユ槸鍚﹀凡缁忓姞瀵嗭紝閬垮厤鍙岄噸鍔犲瘑
    email: isEmailEncrypted ? accountInfo.email : encrypt(accountInfo.email || ''),
    emailVerified: accountInfo.emailVerified === true ? 'true' : 'false',
    // 杩囨湡鏃堕棿
    expiresAt:
      accountData.expiresAt ||
      (oauthData.expires_in
        ? new Date(Date.now() + oauthData.expires_in * 1000).toISOString()
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()), // OAuth Token 杩囨湡鏃堕棿锛堟妧鏈瓧娈碉級

    // 鉁?鏂板锛氳处鎴疯闃呭埌鏈熸椂闂达紙涓氬姟瀛楁锛屾墜鍔ㄧ鐞嗭級
    subscriptionExpiresAt: accountData.subscriptionExpiresAt || null,

    // 鐘舵€佸瓧娈?
    isActive: accountData.isActive !== false ? 'true' : 'false',
    status: 'active',
    schedulable: accountData.schedulable !== false ? 'true' : 'false',
    lastRefresh: accountData.lastRefresh || now,
    createdAt: now,
    updatedAt: now
  }

  // 浠ｇ悊閰嶇疆
  if (accountData.proxy) {
    account.proxy =
      typeof accountData.proxy === 'string' ? accountData.proxy : JSON.stringify(accountData.proxy)
  }

  const client = redisClient.getClientSafe()
  await client.hset(`${OPENAI_ACCOUNT_KEY_PREFIX}${accountId}`, account)

  // 濡傛灉鏄叡浜处鎴凤紝娣诲姞鍒板叡浜处鎴烽泦鍚?
  if (account.accountType === 'shared') {
    await client.sadd(SHARED_OPENAI_ACCOUNTS_KEY, accountId)
  }

  logger.info(`Created OpenAI account: ${accountId}`)
  return account
}

// 鑾峰彇璐︽埛
async function getAccount(accountId) {
  const client = redisClient.getClientSafe()
  const accountData = await client.hgetall(`${OPENAI_ACCOUNT_KEY_PREFIX}${accountId}`)

  if (!accountData || Object.keys(accountData).length === 0) {
    return null
  }

  // 瑙ｅ瘑鏁忔劅鏁版嵁锛堜粎鐢ㄤ簬鍐呴儴澶勭悊锛屼笉杩斿洖缁欏墠绔級
  if (accountData.idToken) {
    accountData.idToken = decrypt(accountData.idToken)
  }
  // 娉ㄦ剰锛歛ccessToken 鍦?openaiRoutes.js 涓細琚崟鐙В瀵嗭紝杩欓噷涓嶈В瀵?
  // if (accountData.accessToken) {
  //   accountData.accessToken = decrypt(accountData.accessToken)
  // }
  if (accountData.refreshToken) {
    accountData.refreshToken = decrypt(accountData.refreshToken)
  }
  if (accountData.email) {
    accountData.email = decrypt(accountData.email)
  }
  if (accountData.openaiOauth) {
    try {
      accountData.openaiOauth = JSON.parse(decrypt(accountData.openaiOauth))
    } catch (e) {
      accountData.openaiOauth = null
    }
  }

  // 瑙ｆ瀽浠ｇ悊閰嶇疆
  if (accountData.proxy && typeof accountData.proxy === 'string') {
    try {
      accountData.proxy = JSON.parse(accountData.proxy)
    } catch (e) {
      accountData.proxy = null
    }
  }

  return accountData
}

// 鏇存柊璐︽埛
async function updateAccount(accountId, updates) {
  const existingAccount = await getAccount(accountId)
  if (!existingAccount) {
    throw new Error('Account not found')
  }

  updates.updatedAt = new Date().toISOString()

  // 鍔犲瘑鏁忔劅鏁版嵁
  if (updates.openaiOauth) {
    const oauthData =
      typeof updates.openaiOauth === 'string'
        ? updates.openaiOauth
        : JSON.stringify(updates.openaiOauth)
    updates.openaiOauth = encrypt(oauthData)
  }
  if (updates.idToken) {
    updates.idToken = encrypt(updates.idToken)
  }
  if (updates.accessToken) {
    updates.accessToken = encrypt(updates.accessToken)
  }
  if (updates.refreshToken && updates.refreshToken.trim()) {
    updates.refreshToken = encrypt(updates.refreshToken)
  }
  if (updates.email) {
    updates.email = encrypt(updates.email)
  }

  // 澶勭悊浠ｇ悊閰嶇疆
  if (updates.proxy !== undefined) {
    updates.proxy = updates.proxy
      ? typeof updates.proxy === 'string'
        ? updates.proxy
        : JSON.stringify(updates.proxy)
      : ''
  }

  // 鉁?濡傛灉閫氳繃璺敱鏄犲皠鏇存柊浜?subscriptionExpiresAt锛岀洿鎺ヤ繚瀛?
  // subscriptionExpiresAt 鏄笟鍔″瓧娈碉紝涓?token 鍒锋柊鐙珛
  if (updates.subscriptionExpiresAt !== undefined) {
    // 鐩存帴淇濆瓨锛屼笉鍋氫换浣曡皟鏁?
  }

  // 鏇存柊璐︽埛绫诲瀷鏃跺鐞嗗叡浜处鎴烽泦鍚?
  const client = redisClient.getClientSafe()
  if (updates.accountType && updates.accountType !== existingAccount.accountType) {
    if (updates.accountType === 'shared') {
      await client.sadd(SHARED_OPENAI_ACCOUNTS_KEY, accountId)
    } else {
      await client.srem(SHARED_OPENAI_ACCOUNTS_KEY, accountId)
    }
  }

  await client.hset(`${OPENAI_ACCOUNT_KEY_PREFIX}${accountId}`, updates)

  logger.info(`Updated OpenAI account: ${accountId}`)

  // 鍚堝苟鏇存柊鍚庣殑璐︽埛鏁版嵁
  const updatedAccount = { ...existingAccount, ...updates }

  // 杩斿洖鏃惰В鏋愪唬鐞嗛厤缃?
  if (updatedAccount.proxy && typeof updatedAccount.proxy === 'string') {
    try {
      updatedAccount.proxy = JSON.parse(updatedAccount.proxy)
    } catch (e) {
      updatedAccount.proxy = null
    }
  }

  return updatedAccount
}

// 鍒犻櫎璐︽埛
async function deleteAccount(accountId) {
  const account = await getAccount(accountId)
  if (!account) {
    throw new Error('Account not found')
  }

  // 浠?Redis 鍒犻櫎
  const client = redisClient.getClientSafe()
  await client.del(`${OPENAI_ACCOUNT_KEY_PREFIX}${accountId}`)

  // 无条件从共享账户集合中移除（srem 对不存在的成员是 no-op）
  await client.srem(SHARED_OPENAI_ACCOUNTS_KEY, accountId)

  // 娓呯悊浼氳瘽鏄犲皠
  const sessionMappings = await client.keys(`${ACCOUNT_SESSION_MAPPING_PREFIX}*`)
  for (const key of sessionMappings) {
    const mappedAccountId = await client.get(key)
    if (mappedAccountId === accountId) {
      await client.del(key)
    }
  }

  logger.info(`Deleted OpenAI account: ${accountId}`)
  return true
}

// 鑾峰彇鎵€鏈夎处鎴?
async function getAllAccounts(options = {}) {
  const forScheduling = options && typeof options === 'object' && options.forScheduling === true
  const client = redisClient.getClientSafe()
  const keys = await getPrimaryPrefixedRedisKeys(client, OPENAI_ACCOUNT_KEY_PREFIX)
  if (keys.length === 0) {
    return []
  }

  const pipeline = client.pipeline()
  keys.forEach((key) => pipeline.hgetall(key))
  const results = await pipeline.exec()
  const accounts = []

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const [error, accountData] = results[i]
    if (error || !accountData || Object.keys(accountData).length === 0) {
      continue
    }

    const accountIdFromKey = key.replace(OPENAI_ACCOUNT_KEY_PREFIX, '')
    if (accountData.id && accountData.id !== accountIdFromKey) {
      logger.warn(
        `OpenAI account id mismatch detected, key id: ${accountIdFromKey}, field id: ${accountData.id}`
      )
    }
    accountData.id = accountIdFromKey

    const codexUsage = buildCodexUsageSnapshot(accountData)
    const rateLimitInfo = buildRateLimitInfoFromAccountSnapshot(accountData)

    if (!forScheduling && accountData.email) {
      accountData.email = decrypt(accountData.email)
    }

    const hasRefreshTokenFlag = !!accountData.refreshToken
    const maskedAccessToken = accountData.accessToken ? '[ENCRYPTED]' : ''
    const maskedRefreshToken = accountData.refreshToken ? '[ENCRYPTED]' : ''
    const maskedOauth = accountData.openaiOauth ? '[ENCRYPTED]' : ''

    delete accountData.idToken
    delete accountData.accessToken
    delete accountData.refreshToken
    delete accountData.openaiOauth
    delete accountData.codexPrimaryUsedPercent
    delete accountData.codexPrimaryResetAfterSeconds
    delete accountData.codexPrimaryWindowMinutes
    delete accountData.codexSecondaryUsedPercent
    delete accountData.codexSecondaryResetAfterSeconds
    delete accountData.codexSecondaryWindowMinutes
    delete accountData.codexPrimaryOverSecondaryLimitPercent
    delete accountData.codexUsageUpdatedAt

    if (!forScheduling && accountData.proxy) {
      try {
        accountData.proxy = JSON.parse(accountData.proxy)
      } catch (e) {
        accountData.proxy = null
      }
    }

    const tokenExpiresAt = accountData.expiresAt || null
    const subscriptionExpiresAt =
      accountData.subscriptionExpiresAt && accountData.subscriptionExpiresAt !== ''
        ? accountData.subscriptionExpiresAt
        : null

    if (forScheduling) {
      let supportedModels = []
      if (Array.isArray(accountData.supportedModels)) {
        ;({ supportedModels } = accountData)
      } else if (typeof accountData.supportedModels === 'string' && accountData.supportedModels) {
        try {
          supportedModels = JSON.parse(accountData.supportedModels)
        } catch {
          supportedModels = []
        }
      }

      accounts.push({
        id: accountData.id,
        name: accountData.name,
        accountType: accountData.accountType || 'shared',
        status: accountData.status || 'active',
        isActive: accountData.isActive === 'true',
        schedulable: accountData.schedulable !== 'false',
        priority: parseInt(accountData.priority) || 50,
        lastUsedAt: accountData.lastUsedAt || '',
        expiresAt: tokenExpiresAt,
        refreshToken: hasRefreshTokenFlag ? '[ENCRYPTED]' : '',
        rateLimitStatus: rateLimitInfo,
        supportedModels
      })
      continue
    }

    accounts.push({
      ...accountData,
      isActive: accountData.isActive === 'true',
      schedulable: accountData.schedulable !== 'false',
      openaiOauth: maskedOauth,
      accessToken: maskedAccessToken,
      refreshToken: maskedRefreshToken,
      tokenExpiresAt,
      subscriptionExpiresAt,
      expiresAt: subscriptionExpiresAt,
      scopes: accountData.scopes && accountData.scopes.trim() ? accountData.scopes.split(' ') : [],
      hasRefreshToken: hasRefreshTokenFlag,
      rateLimitStatus: rateLimitInfo,
      codexUsage
    })
  }

  return accounts
}
async function getAccountOverview(accountId) {
  const client = redisClient.getClientSafe()
  const accountData = await client.hgetall(`${OPENAI_ACCOUNT_KEY_PREFIX}${accountId}`)

  if (!accountData || Object.keys(accountData).length === 0) {
    return null
  }

  const codexUsage = buildCodexUsageSnapshot(accountData)
  const rateLimitInfo = await getAccountRateLimitInfo(accountId)

  if (accountData.proxy) {
    try {
      accountData.proxy = JSON.parse(accountData.proxy)
    } catch (error) {
      accountData.proxy = null
    }
  }

  const scopes =
    accountData.scopes && accountData.scopes.trim() ? accountData.scopes.split(' ') : []

  return {
    id: accountData.id,
    accountType: accountData.accountType || 'shared',
    platform: accountData.platform || 'openai',
    isActive: accountData.isActive === 'true',
    schedulable: accountData.schedulable !== 'false',
    rateLimitStatus: rateLimitInfo || {
      status: 'normal',
      isRateLimited: false,
      rateLimitedAt: null,
      rateLimitResetAt: null,
      minutesRemaining: 0
    },
    codexUsage,
    scopes
  }
}

// 閫夋嫨鍙敤璐︽埛锛堟敮鎸佷笓灞炲拰鍏变韩璐︽埛锛?
async function selectAvailableAccount(apiKeyId, sessionHash = null) {
  // 棣栧厛妫€鏌ユ槸鍚︽湁绮樻€т細璇?
  const client = redisClient.getClientSafe()
  if (sessionHash) {
    const mappedAccountId = await client.get(`${ACCOUNT_SESSION_MAPPING_PREFIX}${sessionHash}`)

    if (mappedAccountId) {
      const account = await getAccount(mappedAccountId)
      if (
        account &&
        account.isActive === 'true' &&
        account.status !== 'error' &&
        account.status !== 'unauthorized' &&
        account.schedulable !== 'false' &&
        !isTokenExpired(account)
      ) {
        logger.debug(`Using sticky session account: ${mappedAccountId}`)
        return account
      }
    }
  }

  // 鑾峰彇 API Key 淇℃伅
  const apiKeyData = await client.hgetall(`api_key:${apiKeyId}`)

  // 妫€鏌ユ槸鍚︾粦瀹氫簡 OpenAI 璐︽埛
  if (apiKeyData.openaiAccountId) {
    const account = await getAccount(apiKeyData.openaiAccountId)
    if (
      account &&
      account.isActive === 'true' &&
      account.status !== 'error' &&
      account.status !== 'unauthorized' &&
      account.schedulable !== 'false'
    ) {
      // 妫€鏌?token 鏄惁杩囨湡
      const isExpired = isTokenExpired(account)

      // 璁板綍token浣跨敤鎯呭喌
      logTokenUsage(account.id, account.name, 'openai', account.expiresAt, isExpired)

      if (isExpired) {
        await refreshAccountToken(account.id)
        return await getAccount(account.id)
      }

      // 鍒涘缓绮樻€т細璇濇槧灏?
      if (sessionHash) {
        await client.setex(
          `${ACCOUNT_SESSION_MAPPING_PREFIX}${sessionHash}`,
          3600, // 1灏忔椂杩囨湡
          account.id
        )
      }

      return account
    }
  }

  // 浠庡叡浜处鎴锋睜閫夋嫨
  const sharedAccountIds = await client.smembers(SHARED_OPENAI_ACCOUNTS_KEY)
  const availableAccounts = []

  for (const accountId of sharedAccountIds) {
    const account = await getAccount(accountId)
    if (
      account &&
      account.isActive === 'true' &&
      account.status !== 'error' &&
      account.status !== 'unauthorized' &&
      account.schedulable !== 'false' &&
      !isRateLimited(account) &&
      !isSubscriptionExpired(account)
    ) {
      availableAccounts.push(account)
    } else if (account && isSubscriptionExpired(account)) {
      logger.debug(
        `鈴?Skipping expired OpenAI account: ${account.name}, expired at ${account.subscriptionExpiresAt}`
      )
    }
  }

  if (availableAccounts.length === 0) {
    throw new Error('No available OpenAI accounts')
  }

  // 閫夋嫨浣跨敤鏈€灏戠殑璐︽埛
  const selectedAccount = availableAccounts.reduce((prev, curr) => {
    const prevUsage = parseInt(prev.totalUsage || 0)
    const currUsage = parseInt(curr.totalUsage || 0)
    return prevUsage <= currUsage ? prev : curr
  })

  // 妫€鏌?token 鏄惁杩囨湡
  if (isTokenExpired(selectedAccount)) {
    await refreshAccountToken(selectedAccount.id)
    return await getAccount(selectedAccount.id)
  }

  // 鍒涘缓绮樻€т細璇濇槧灏?
  if (sessionHash) {
    await client.setex(
      `${ACCOUNT_SESSION_MAPPING_PREFIX}${sessionHash}`,
      3600, // 1灏忔椂杩囨湡
      selectedAccount.id
    )
  }

  return selectedAccount
}

// 妫€鏌ヨ处鎴锋槸鍚﹁闄愭祦
function isRateLimited(account) {
  if (account.rateLimitStatus === 'limited' && account.rateLimitedAt) {
    const limitedAt = new Date(account.rateLimitedAt).getTime()
    const now = Date.now()
    const limitDuration = 60 * 60 * 1000 // 1灏忔椂

    return now < limitedAt + limitDuration
  }
  return false
}

// 璁剧疆璐︽埛闄愭祦鐘舵€?
async function setAccountRateLimited(accountId, isLimited, resetsInSeconds = null) {
  const updates = {
    rateLimitStatus: isLimited ? 'limited' : 'normal',
    rateLimitedAt: isLimited ? new Date().toISOString() : null,
    // 闄愭祦鏃跺仠姝㈣皟搴︼紝瑙ｉ櫎闄愭祦鏃舵仮澶嶈皟搴?
    schedulable: isLimited ? 'false' : 'true'
  }

  // 濡傛灉鎻愪緵浜嗛噸缃椂闂达紙绉掓暟锛夛紝璁＄畻閲嶇疆鏃堕棿鎴?
  if (isLimited && resetsInSeconds !== null && resetsInSeconds > 0) {
    const resetTime = new Date(Date.now() + resetsInSeconds * 1000).toISOString()
    updates.rateLimitResetAt = resetTime
    logger.info(
      `馃晲 Account ${accountId} will be reset at ${resetTime} (in ${resetsInSeconds} seconds / ${Math.ceil(resetsInSeconds / 60)} minutes)`
    )
  } else if (isLimited) {
    // 濡傛灉娌℃湁鎻愪緵閲嶇疆鏃堕棿锛屼娇鐢ㄩ粯璁ょ殑60鍒嗛挓
    const defaultResetSeconds = 60 * 60 // 1灏忔椂
    const resetTime = new Date(Date.now() + defaultResetSeconds * 1000).toISOString()
    updates.rateLimitResetAt = resetTime
    logger.warn(
      `鈿狅笍 No reset time provided for account ${accountId}, using default 60 minutes. Reset at ${resetTime}`
    )
  } else if (!isLimited) {
    updates.rateLimitResetAt = null
  }

  await updateAccount(accountId, updates)
  logger.info(
    `Set rate limit status for OpenAI account ${accountId}: ${updates.rateLimitStatus}, schedulable: ${updates.schedulable}`
  )

  // 濡傛灉琚檺娴侊紝鍙戦€?Webhook 閫氱煡
  if (isLimited) {
    try {
      const account = await getAccount(accountId)
      const webhookNotifier = require('../utils/webhookNotifier')
      await webhookNotifier.sendAccountAnomalyNotification({
        accountId,
        accountName: account.name || accountId,
        platform: 'openai',
        status: 'blocked',
        errorCode: 'OPENAI_RATE_LIMITED',
        reason: resetsInSeconds
          ? `Account rate limited (429 error). Reset in ${Math.ceil(resetsInSeconds / 60)} minutes`
          : 'Account rate limited (429 error). Estimated reset in 1 hour',
        timestamp: new Date().toISOString()
      })
      logger.info(`馃摙 Webhook notification sent for OpenAI account ${account.name} rate limit`)
    } catch (webhookError) {
      logger.error('Failed to send rate limit webhook notification:', webhookError)
    }
  }
}

// 馃毇 鏍囪璐︽埛涓烘湭鎺堟潈鐘舵€侊紙401閿欒锛?
async function markAccountUnauthorized(accountId, reason = 'OpenAI账号认证失败（401错误）') {
  const account = await getAccount(accountId)
  if (!account) {
    throw new Error('Account not found')
  }

  if (account.status === 'unauthorized' && account.schedulable === 'false') {
    logger.info(`OpenAI account ${account.name || accountId} is already unauthorized, skipping`)
    return
  }

  const now = new Date().toISOString()
  const currentCount = parseInt(account.unauthorizedCount || '0', 10)
  const unauthorizedCount = Number.isFinite(currentCount) ? currentCount + 1 : 1

  const updates = {
    status: 'unauthorized',
    schedulable: 'false',
    errorMessage: reason,
    unauthorizedAt: now,
    unauthorizedCount: unauthorizedCount.toString()
  }

  await updateAccount(accountId, updates)
  logger.warn(
    `馃毇 Marked OpenAI account ${account.name || accountId} as unauthorized due to 401 error`
  )

  try {
    const webhookNotifier = require('../utils/webhookNotifier')
    await webhookNotifier.sendAccountAnomalyNotification({
      accountId,
      accountName: account.name || accountId,
      platform: 'openai',
      status: 'unauthorized',
      errorCode: 'OPENAI_UNAUTHORIZED',
      reason,
      timestamp: now
    })
    logger.info(
      `馃摙 Webhook notification sent for OpenAI account ${account.name} unauthorized state`
    )
  } catch (webhookError) {
    logger.error('Failed to send unauthorized webhook notification:', webhookError)
  }
}

// 馃攧 閲嶇疆璐︽埛鎵€鏈夊紓甯哥姸鎬?
async function resetAccountStatus(accountId) {
  const account = await getAccount(accountId)
  if (!account) {
    throw new Error('Account not found')
  }

  const updates = {
    // 鏍规嵁鏄惁鏈夋湁鏁堢殑 accessToken 鏉ヨ缃?status
    status: account.accessToken ? 'active' : 'created',
    // 鎭㈠鍙皟搴︾姸鎬?
    schedulable: 'true',
    // 娓呴櫎閿欒鐩稿叧瀛楁
    errorMessage: null,
    rateLimitedAt: null,
    rateLimitStatus: 'normal',
    rateLimitResetAt: null
  }

  await updateAccount(accountId, updates)
  logger.info(`鉁?Reset all error status for OpenAI account ${accountId}`)

  // 鍙戦€?Webhook 閫氱煡
  try {
    const webhookNotifier = require('../utils/webhookNotifier')
    await webhookNotifier.sendAccountAnomalyNotification({
      accountId,
      accountName: account.name || accountId,
      platform: 'openai',
      status: 'recovered',
      errorCode: 'STATUS_RESET',
      reason: 'Account status manually reset',
      timestamp: new Date().toISOString()
    })
    logger.info(`馃摙 Webhook notification sent for OpenAI account ${account.name} status reset`)
  } catch (webhookError) {
    logger.error('Failed to send status reset webhook notification:', webhookError)
  }

  return { success: true, message: 'Account status reset successfully' }
}

// 鍒囨崲璐︽埛璋冨害鐘舵€?
async function toggleSchedulable(accountId) {
  const account = await getAccount(accountId)
  if (!account) {
    throw new Error('Account not found')
  }

  // 鍒囨崲璋冨害鐘舵€?
  const newSchedulable = account.schedulable === 'false' ? 'true' : 'false'

  await updateAccount(accountId, {
    schedulable: newSchedulable
  })

  logger.info(`Toggled schedulable status for OpenAI account ${accountId}: ${newSchedulable}`)

  return {
    success: true,
    schedulable: newSchedulable === 'true'
  }
}

// 鑾峰彇璐︽埛闄愭祦淇℃伅
async function getAccountRateLimitInfo(accountId) {
  const account = await getAccount(accountId)
  if (!account) {
    return null
  }

  const status = account.rateLimitStatus || 'normal'
  const rateLimitedAt = account.rateLimitedAt || null
  const rateLimitResetAt = account.rateLimitResetAt || null

  if (status === 'limited') {
    const now = Date.now()
    let remainingTime = 0

    if (rateLimitResetAt) {
      const resetAt = new Date(rateLimitResetAt).getTime()
      remainingTime = Math.max(0, resetAt - now)
    } else if (rateLimitedAt) {
      const limitedAt = new Date(rateLimitedAt).getTime()
      const limitDuration = 60 * 60 * 1000 // 榛樿1灏忔椂
      remainingTime = Math.max(0, limitedAt + limitDuration - now)
    }

    const minutesRemaining = remainingTime > 0 ? Math.ceil(remainingTime / (60 * 1000)) : 0

    return {
      status,
      isRateLimited: minutesRemaining > 0,
      rateLimitedAt,
      rateLimitResetAt,
      minutesRemaining
    }
  }

  return {
    status,
    isRateLimited: false,
    rateLimitedAt,
    rateLimitResetAt,
    minutesRemaining: 0
  }
}

// 鏇存柊璐︽埛浣跨敤缁熻锛坱okens鍙傛暟鍙€夛紝榛樿涓?锛屼粎鏇存柊鏈€鍚庝娇鐢ㄦ椂闂达級
async function updateAccountUsage(accountId, tokens = 0) {
  const account = await getAccount(accountId)
  if (!account) {
    return
  }

  const updates = {
    lastUsedAt: new Date().toISOString()
  }

  // 濡傛灉鏈?tokens 鍙傛暟涓斿ぇ浜?锛屽悓鏃舵洿鏂颁娇鐢ㄧ粺璁?
  if (tokens > 0) {
    const totalUsage = parseInt(account.totalUsage || 0) + tokens
    updates.totalUsage = totalUsage.toString()
  }

  await updateAccount(accountId, updates)
}

// 涓轰簡鍏煎鎬э紝淇濈暀recordUsage浣滀负updateAccountUsage鐨勫埆鍚?
const recordUsage = updateAccountUsage

async function updateCodexUsageSnapshot(accountId, usageSnapshot) {
  if (!usageSnapshot || typeof usageSnapshot !== 'object') {
    return
  }

  const fieldMap = {
    primaryUsedPercent: 'codexPrimaryUsedPercent',
    primaryResetAfterSeconds: 'codexPrimaryResetAfterSeconds',
    primaryWindowMinutes: 'codexPrimaryWindowMinutes',
    secondaryUsedPercent: 'codexSecondaryUsedPercent',
    secondaryResetAfterSeconds: 'codexSecondaryResetAfterSeconds',
    secondaryWindowMinutes: 'codexSecondaryWindowMinutes',
    primaryOverSecondaryPercent: 'codexPrimaryOverSecondaryLimitPercent'
  }

  const updates = {}
  let hasPayload = false

  for (const [key, field] of Object.entries(fieldMap)) {
    if (usageSnapshot[key] !== undefined && usageSnapshot[key] !== null) {
      updates[field] = String(usageSnapshot[key])
      hasPayload = true
    }
  }

  if (!hasPayload) {
    return
  }

  updates.codexUsageUpdatedAt = new Date().toISOString()

  const client = redisClient.getClientSafe()
  await client.hset(`${OPENAI_ACCOUNT_KEY_PREFIX}${accountId}`, updates)
}

module.exports = {
  createAccount,
  getAccount,
  getAccountOverview,
  updateAccount,
  deleteAccount,
  getAllAccounts,
  selectAvailableAccount,
  refreshAccountToken,
  isTokenExpired,
  setAccountRateLimited,
  markAccountUnauthorized,
  resetAccountStatus,
  toggleSchedulable,
  getAccountRateLimitInfo,
  updateAccountUsage,
  recordUsage, // 鍒悕锛屾寚鍚憉pdateAccountUsage
  updateCodexUsageSnapshot,
  encrypt,
  decrypt,
  generateEncryptionKey,
  decryptCache // 鏆撮湶缂撳瓨瀵硅薄浠ヤ究娴嬭瘯鍜岀洃鎺?
}
