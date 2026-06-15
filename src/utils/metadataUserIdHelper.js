/**
 * metadata.user_id 统一解析/构建工具
 *
 * 兼容两种格式：
 * - 旧格式: user_{deviceId}_account_{accountUuid}_session_{sessionId}
 * - 新格式: {"device_id":"...","account_uuid":"...","session_id":"..."}
 */

const OLD_FORMAT_REGEX = /^user_([a-fA-F0-9]{64})_account_(.*?)_session_([a-f0-9-]+)$/

function parse(userId) {
  if (typeof userId !== 'string' || !userId) {
    return null
  }

  if (userId.startsWith('{')) {
    try {
      const obj = JSON.parse(userId)
      const deviceId = obj.device_id
      const sessionId = obj.session_id
      if (
        typeof deviceId !== 'string' ||
        !deviceId ||
        typeof sessionId !== 'string' ||
        !sessionId
      ) {
        return null
      }
      return {
        deviceId,
        accountUuid: typeof obj.account_uuid === 'string' ? obj.account_uuid : '',
        sessionId,
        isJsonFormat: true
      }
    } catch {
      return null
    }
  }

  const match = userId.match(OLD_FORMAT_REGEX)
  if (!match) {
    return null
  }

  return {
    deviceId: match[1],
    accountUuid: match[2],
    sessionId: match[3],
    isJsonFormat: false
  }
}

function extractSessionId(userId) {
  const parsed = parse(userId)
  return parsed ? parsed.sessionId : null
}

function build(parts) {
  const { deviceId, accountUuid, sessionId, isJsonFormat } = parts

  if (isJsonFormat) {
    return JSON.stringify({
      device_id: deviceId,
      account_uuid: accountUuid || '',
      session_id: sessionId
    })
  }

  return `user_${deviceId}_account_${accountUuid || ''}_session_${sessionId}`
}

function isValid(userId) {
  return parse(userId) !== null
}

module.exports = { parse, extractSessionId, build, isValid }
