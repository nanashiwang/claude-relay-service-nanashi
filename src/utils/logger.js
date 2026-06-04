const winston = require('winston')
const DailyRotateFile = require('winston-daily-rotate-file')
const config = require('../../config/config')
const { formatDateWithTimezone } = require('../utils/dateHelper')
const path = require('path')
const fs = require('fs')
const os = require('os')

const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|secret|password|passwd|session[_-]?id|jwt|bearer/i
const MAX_LOG_STRING_LENGTH = 1000

function isSensitiveKey(key) {
  return typeof key === 'string' && SENSITIVE_KEY_PATTERN.test(key)
}

function describeBinaryValue(value) {
  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`
  }
  if (value instanceof ArrayBuffer) {
    return `[ArrayBuffer ${value.byteLength} bytes]`
  }
  if (ArrayBuffer.isView(value)) {
    return `[${value.constructor?.name || 'TypedArray'} ${value.byteLength} bytes]`
  }
  return null
}

function getPayloadLength(value) {
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value === 'string') {
    return Buffer.byteLength(value)
  }
  const binaryDescription = describeBinaryValue(value)
  if (binaryDescription) {
    return value.byteLength ?? value.length
  }
  if (Array.isArray(value)) {
    let total = 0
    let hasLength = false
    for (const item of value) {
      const itemLength = getPayloadLength(item?.data ?? item)
      if (typeof itemLength === 'number') {
        total += itemLength
        hasLength = true
      }
    }
    return hasLength ? total : undefined
  }
  if (typeof value === 'object' && typeof value.length === 'number') {
    return value.length
  }
  return undefined
}

function getRequestBodyLength(error) {
  const configLength = getPayloadLength(error?.config?.data)
  if (typeof configLength === 'number') {
    return configLength
  }
  const requestLength = error?.request?._requestBodyLength
  if (
    requestLength !== null &&
    requestLength !== undefined &&
    !Number.isNaN(Number(requestLength))
  ) {
    return Number(requestLength)
  }
  const currentRequestLength = error?.request?._currentRequest?._requestBodyLength
  if (
    currentRequestLength !== null &&
    currentRequestLength !== undefined &&
    !Number.isNaN(Number(currentRequestLength))
  ) {
    return Number(currentRequestLength)
  }
  return undefined
}

function sanitizeAxiosError(error) {
  if (!error || typeof error !== 'object') {
    return error
  }

  const axiosConfig = error.config || {}
  const request = error.request || {}
  const response = error.response || {}
  const responseHeaders = response.headers || {}

  const summary = {
    name: error.name,
    message: error.message,
    code: error.code || error.cause?.code,
    status: response.status || error.status,
    method: axiosConfig.method || request.method,
    url: axiosConfig.url || request._currentUrl || request.path,
    timeout: axiosConfig.timeout,
    responseType: axiosConfig.responseType,
    requestBodyLength: getRequestBodyLength(error),
    responseContentLength: responseHeaders['content-length'],
    responseContentType: responseHeaders['content-type']
  }

  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined))
}

function isAxiosLikeError(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value.isAxiosError || (value.config && (value.request || value.response || value.code)))
  )
}

function sanitizeErrorObject(error) {
  if (isAxiosLikeError(error)) {
    return sanitizeAxiosError(error)
  }
  return {
    name: error.name,
    message: error.message,
    code: error.code,
    stack:
      typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 8).join('\n') : undefined
  }
}

// 安全的 JSON 序列化函数，处理循环引用、二进制大对象和敏感字段
const safeStringify = (obj, maxDepth = 3, fullDepth = false) => {
  const seen = new WeakSet()
  // 如果是fullDepth模式，增加深度限制
  const actualMaxDepth = fullDepth ? 10 : maxDepth

  const replacer = (key, value, depth = 0) => {
    if (isSensitiveKey(key)) {
      return '[REDACTED]'
    }

    if (depth > actualMaxDepth) {
      return '[Max Depth Reached]'
    }

    const binaryDescription = describeBinaryValue(value)
    if (binaryDescription) {
      return binaryDescription
    }

    if (value instanceof Error || isAxiosLikeError(value)) {
      return sanitizeErrorObject(value)
    }

    // 处理字符串值，清理可能导致JSON解析错误的特殊字符
    if (typeof value === 'string') {
      try {
        let cleanValue = value
        if (cleanValue.length > MAX_LOG_STRING_LENGTH) {
          cleanValue = `${cleanValue.substring(0, MAX_LOG_STRING_LENGTH - 3)}...`
        }
        // 移除或转义可能导致JSON解析错误的字符
        cleanValue = cleanValue
          // eslint-disable-next-line no-control-regex
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') // 移除控制字符
          .replace(/[\uD800-\uDFFF]/g, '') // 移除孤立的代理对字符
          // eslint-disable-next-line no-control-regex
          .replace(/\u0000/g, '') // 移除NUL字节

        return cleanValue
      } catch (error) {
        return '[Invalid String Data]'
      }
    }

    if (value !== null && typeof value === 'object') {
      if (seen.has(value)) {
        return '[Circular Reference]'
      }
      seen.add(value)

      // 过滤掉常见的循环引用对象
      if (value.constructor) {
        const constructorName = value.constructor.name
        if (
          [
            'Socket',
            'TLSSocket',
            'HTTPParser',
            'IncomingMessage',
            'ServerResponse',
            'ClientRequest',
            'Agent',
            'FormData'
          ].includes(constructorName)
        ) {
          return `[${constructorName} Object]`
        }
      }

      // 递归处理对象属性
      if (Array.isArray(value)) {
        return value.map((item, index) => replacer(index, item, depth + 1))
      } else {
        const result = {}
        for (const [k, v] of Object.entries(value)) {
          // 确保键名也是安全的
          // eslint-disable-next-line no-control-regex
          const safeKey = typeof k === 'string' ? k.replace(/[\u0000-\u001F\u007F]/g, '') : k
          result[safeKey] = replacer(safeKey, v, depth + 1)
        }
        return result
      }
    }

    return value
  }

  try {
    const processed = replacer('', obj)
    return JSON.stringify(processed)
  } catch (error) {
    // 如果JSON.stringify仍然失败，使用更保守的方法
    try {
      return JSON.stringify({
        error: 'Failed to serialize object',
        message: error.message,
        type: typeof obj,
        keys: obj && typeof obj === 'object' ? Object.keys(obj) : undefined
      })
    } catch (finalError) {
      return '{"error":"Critical serialization failure","message":"Unable to serialize any data"}'
    }
  }
}

// 📝 增强的日志格式
const createLogFormat = (colorize = false) => {
  const formats = [
    winston.format.timestamp({ format: () => formatDateWithTimezone(new Date(), false) }),
    winston.format.errors({ stack: true })
    // 移除 winston.format.metadata() 来避免自动包装
  ]

  if (colorize) {
    formats.push(winston.format.colorize())
  }

  formats.push(
    winston.format.printf(({ level, message, timestamp, stack, ...rest }) => {
      const emoji = {
        error: '❌',
        warn: '⚠️ ',
        info: 'ℹ️ ',
        debug: '🐛',
        verbose: '📝'
      }

      let logMessage = `${emoji[level] || '📝'} [${timestamp}] ${level.toUpperCase()}: ${message}`

      // 直接处理额外数据，不需要metadata包装
      const additionalData = { ...rest }
      delete additionalData.level
      delete additionalData.message
      delete additionalData.timestamp
      delete additionalData.stack

      if (Object.keys(additionalData).length > 0) {
        logMessage += ` | ${safeStringify(additionalData)}`
      }

      return stack ? `${logMessage}\n${stack}` : logMessage
    })
  )

  return winston.format.combine(...formats)
}

const logFormat = createLogFormat(false)
const consoleFormat = createLogFormat(true)
const isTestEnv = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID

// 📁 确保日志目录存在并设置权限
if (!fs.existsSync(config.logging.dirname)) {
  fs.mkdirSync(config.logging.dirname, { recursive: true, mode: 0o755 })
}

// 🔄 增强的日志轮转配置
const createRotateTransport = (filename, level = null) => {
  const transport = new DailyRotateFile({
    filename: path.join(config.logging.dirname, filename),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: config.logging.maxSize,
    maxFiles: config.logging.maxFiles,
    auditFile: path.join(config.logging.dirname, `.${filename.replace('%DATE%', 'audit')}.json`),
    format: logFormat
  })

  if (level) {
    transport.level = level
  }

  // 监听轮转事件（测试环境关闭以避免 Jest 退出后输出）
  if (!isTestEnv) {
    transport.on('rotate', (oldFilename, newFilename) => {
      console.log(`📦 Log rotated: ${oldFilename} -> ${newFilename}`)
    })

    transport.on('new', (newFilename) => {
      console.log(`📄 New log file created: ${newFilename}`)
    })

    transport.on('archive', (zipFilename) => {
      console.log(`🗜️ Log archived: ${zipFilename}`)
    })
  }

  return transport
}

const dailyRotateFileTransport = createRotateTransport('claude-relay-%DATE%.log')
const errorFileTransport = createRotateTransport('claude-relay-error-%DATE%.log', 'error')

// 🔒 创建专门的安全日志记录器
const securityLogger = winston.createLogger({
  level: 'warn',
  format: logFormat,
  transports: [createRotateTransport('claude-relay-security-%DATE%.log', 'warn')],
  silent: false
})

// 🔐 创建专门的认证详细日志记录器（记录完整的认证响应）
const authDetailLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: () => formatDateWithTimezone(new Date(), false) }),
    winston.format.printf(({ level, message, timestamp, data }) => {
      // 认证详情也必须走统一脱敏，避免 token 泄露到日志。
      const jsonData = data ? safeStringify(data, 10, true) : '{}'
      return `[${timestamp}] ${level.toUpperCase()}: ${message}\n${jsonData}\n${'='.repeat(80)}`
    })
  ),
  transports: [createRotateTransport('claude-relay-auth-detail-%DATE%.log', 'info')],
  silent: false
})

// 🌟 增强的 Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || config.logging.level,
  format: logFormat,
  transports: [
    // 📄 文件输出
    dailyRotateFileTransport,
    errorFileTransport,

    // 🖥️ 控制台输出
    new winston.transports.Console({
      format: consoleFormat,
      handleExceptions: false,
      handleRejections: false
    })
  ],

  // 🚨 异常处理
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(config.logging.dirname, 'exceptions.log'),
      format: logFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: consoleFormat
    })
  ],

  // 🔄 未捕获异常处理
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(config.logging.dirname, 'rejections.log'),
      format: logFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: consoleFormat
    })
  ],

  // 防止进程退出
  exitOnError: false
})

// 🎯 增强的自定义方法
logger.success = (message, metadata = {}) => {
  logger.info(`✅ ${message}`, { type: 'success', ...metadata })
}

logger.start = (message, metadata = {}) => {
  logger.info(`🚀 ${message}`, { type: 'startup', ...metadata })
}

logger.request = (method, url, status, duration, metadata = {}) => {
  const emoji = status >= 400 ? '🔴' : status >= 300 ? '🟡' : '🟢'
  const level = status >= 400 ? 'error' : status >= 300 ? 'warn' : 'info'

  logger[level](`${emoji} ${method} ${url} - ${status} (${duration}ms)`, {
    type: 'request',
    method,
    url,
    status,
    duration,
    ...metadata
  })
}

logger.api = (message, metadata = {}) => {
  logger.info(`🔗 ${message}`, { type: 'api', ...metadata })
}

logger.security = (message, metadata = {}) => {
  const securityData = {
    type: 'security',
    timestamp: new Date().toISOString(),
    pid: process.pid,
    hostname: os.hostname(),
    ...metadata
  }

  // 记录到主日志
  logger.warn(`🔒 ${message}`, securityData)

  // 记录到专门的安全日志文件
  try {
    securityLogger.warn(`🔒 ${message}`, securityData)
  } catch (error) {
    // 如果安全日志文件不可用，只记录到主日志
    console.warn('Security logger not available:', error.message)
  }
}

logger.database = (message, metadata = {}) => {
  logger.debug(`💾 ${message}`, { type: 'database', ...metadata })
}

logger.performance = (message, metadata = {}) => {
  logger.info(`⚡ ${message}`, { type: 'performance', ...metadata })
}

logger.audit = (message, metadata = {}) => {
  logger.info(`📋 ${message}`, {
    type: 'audit',
    timestamp: new Date().toISOString(),
    pid: process.pid,
    ...metadata
  })
}

// 🔧 性能监控方法
logger.timer = (label) => {
  const start = Date.now()
  return {
    end: (message = '', metadata = {}) => {
      const duration = Date.now() - start
      logger.performance(`${label} ${message}`, { duration, ...metadata })
      return duration
    }
  }
}

// 📊 日志统计
logger.stats = {
  requests: 0,
  errors: 0,
  warnings: 0
}

// 重写原始方法以统计
const originalError = logger.error
const originalWarn = logger.warn
const originalInfo = logger.info

logger.error = function (message, ...args) {
  logger.stats.errors++
  return originalError.call(this, message, ...args)
}

logger.warn = function (message, ...args) {
  logger.stats.warnings++
  return originalWarn.call(this, message, ...args)
}

logger.info = function (message, ...args) {
  // 检查是否是请求类型的日志
  if (args.length > 0 && typeof args[0] === 'object' && args[0].type === 'request') {
    logger.stats.requests++
  }
  return originalInfo.call(this, message, ...args)
}

// 📈 获取日志统计
logger.getStats = () => ({ ...logger.stats })

// 🧹 清理统计
logger.resetStats = () => {
  logger.stats.requests = 0
  logger.stats.errors = 0
  logger.stats.warnings = 0
}

logger.safeStringify = safeStringify
logger.sanitizeAxiosError = sanitizeAxiosError

// 📡 健康检查
logger.healthCheck = () => {
  try {
    const testMessage = 'Logger health check'
    logger.debug(testMessage)
    return { healthy: true, timestamp: new Date().toISOString() }
  } catch (error) {
    return { healthy: false, error: error.message, timestamp: new Date().toISOString() }
  }
}

// 🔐 记录认证详细信息的方法
logger.authDetail = (message, data = {}) => {
  try {
    // 记录到主日志（简化版）
    logger.info(`🔐 ${message}`, {
      type: 'auth-detail',
      summary: {
        hasAccessToken: !!data.access_token,
        hasRefreshToken: !!data.refresh_token,
        scopes: data.scope || data.scopes,
        organization: data.organization?.name,
        account: data.account?.email_address
      }
    })

    // 记录到专门的认证详细日志文件（完整数据）
    authDetailLogger.info(message, { data })
  } catch (error) {
    logger.error('Failed to log auth detail:', error)
  }
}

// 🎬 启动日志记录系统
logger.start('Logger initialized', {
  level: process.env.LOG_LEVEL || config.logging.level,
  directory: config.logging.dirname,
  maxSize: config.logging.maxSize,
  maxFiles: config.logging.maxFiles,
  envOverride: process.env.LOG_LEVEL ? true : false
})

module.exports = logger
