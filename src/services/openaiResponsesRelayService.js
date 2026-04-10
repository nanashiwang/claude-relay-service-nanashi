const axios = require('axios')
const ProxyHelper = require('../utils/proxyHelper')
const logger = require('../utils/logger')
const { filterForOpenAI } = require('../utils/headerFilter')
const openaiResponsesAccountService = require('./openaiResponsesAccountService')
const apiKeyService = require('./apiKeyService')
const unifiedOpenAIScheduler = require('./unifiedOpenAIScheduler')
const claudeRelayConfigService = require('./claudeRelayConfigService')
const redis = require('../models/redis')
const config = require('../../config/config')
const { resolveOpenAIStickySessionContext } = require('../utils/openaiSessionResolver')
const {
  STREAM_INTERRUPTION_REASONS,
  resolveStreamInterruptionReasonFromError,
  recordStreamInterruption
} = require('../utils/streamInterruptionHelper')

const DEFAULT_OPENAI_RESPONSES_STREAM_HEARTBEAT_INTERVAL_MS = 15000
const OPENAI_COMPAT_MODE_CHAT_COMPLETIONS = 'chat_completions'

// 抽取缓存写入 token，兼容多种字段命名
function extractCacheCreationTokens(usageData) {
  if (!usageData || typeof usageData !== 'object') {
    return 0
  }

  const details = usageData.input_tokens_details || usageData.prompt_tokens_details || {}
  const candidates = [
    details.cache_creation_input_tokens,
    details.cache_creation_tokens,
    usageData.cache_creation_input_tokens,
    usageData.cache_creation_tokens
  ]

  for (const value of candidates) {
    if (value !== undefined && value !== null && value !== '') {
      const parsed = Number(value)
      if (!Number.isNaN(parsed)) {
        return parsed
      }
    }
  }

  return 0
}

function isWritableSSEStream(res) {
  return !!res && !res.destroyed && !res.writableEnded && !res.socket?.destroyed
}

function sendOpenAIResponsesStreamErrorEvent(
  res,
  error,
  reason = STREAM_INTERRUPTION_REASONS.UPSTREAM_STREAM_ERROR
) {
  if (!isWritableSSEStream(res)) {
    return false
  }

  const payload = {
    type: 'error',
    error: {
      message: error?.message || 'Upstream stream error',
      type: 'stream_error',
      code: reason,
      retryable: true,
      timestamp: new Date().toISOString()
    }
  }

  try {
    res.write(`event: relay.error\ndata: ${JSON.stringify(payload)}\n\n`)
    res.write('data: [DONE]\n\n')
    return true
  } catch (writeError) {
    logger.error('Failed to write OpenAI-Responses SSE error event:', writeError)
    return false
  }
}

async function getOpenAIResponsesStreamHeartbeatIntervalMs() {
  try {
    const runtimeConfig = await claudeRelayConfigService.getConfig()
    const interval = Number(runtimeConfig?.openaiStreamHeartbeatIntervalMs)
    if (Number.isInteger(interval) && interval >= 5000 && interval <= 60000) {
      return interval
    }
  } catch (error) {
    logger.debug('Failed to load OpenAI-Responses heartbeat interval from runtime config:', error)
  }

  return DEFAULT_OPENAI_RESPONSES_STREAM_HEARTBEAT_INTERVAL_MS
}

function isChatCompletionsCompatMode(req) {
  return req?._openaiCompatMode === OPENAI_COMPAT_MODE_CHAT_COMPLETIONS
}

function parseJsonSafely(payload) {
  if (!payload || typeof payload !== 'string') {
    return null
  }

  try {
    return JSON.parse(payload)
  } catch (_) {
    return null
  }
}

function extractCodexDeltaFromEventData(eventData) {
  if (!eventData || typeof eventData !== 'object') {
    return ''
  }

  if (eventData.type === 'response.output_text.delta' && typeof eventData.delta === 'string') {
    return eventData.delta
  }

  if (
    eventData.type === 'response.output_item.delta' &&
    typeof eventData.delta?.text === 'string'
  ) {
    return eventData.delta.text
  }

  if (eventData.type === 'content_block_delta' && typeof eventData.delta?.text === 'string') {
    return eventData.delta.text
  }

  if (typeof eventData.text === 'string') {
    return eventData.text
  }

  return ''
}

function parseSSEDataLine(line) {
  if (!line || typeof line !== 'string' || !line.startsWith('data:')) {
    return ''
  }
  return line.slice(5).trim()
}

function stringifyToolArguments(argumentsPayload) {
  if (typeof argumentsPayload === 'string') {
    return argumentsPayload
  }

  if (argumentsPayload === undefined || argumentsPayload === null) {
    return '{}'
  }

  try {
    return JSON.stringify(argumentsPayload)
  } catch (_) {
    return '{}'
  }
}

function extractTextFromResponseContentBlocks(content = []) {
  if (!Array.isArray(content)) {
    return ''
  }

  const chunks = []
  for (const block of content) {
    if (typeof block === 'string') {
      chunks.push(block)
      continue
    }

    if (!block || typeof block !== 'object') {
      continue
    }

    if (typeof block.text === 'string') {
      chunks.push(block.text)
      continue
    }

    if (typeof block.content === 'string') {
      chunks.push(block.content)
    }
  }

  return chunks.join('')
}

function extractToolCallsFromResponseOutput(output = []) {
  if (!Array.isArray(output)) {
    return []
  }

  const toolCalls = []

  const pushToolCall = (toolCall, index, nestedIndex = null) => {
    if (!toolCall || typeof toolCall !== 'object') {
      return
    }

    const rawName = toolCall.name || toolCall.function?.name
    if (!rawName) {
      return
    }

    const rawArguments =
      toolCall.arguments ||
      toolCall.function?.arguments ||
      toolCall.input ||
      toolCall.params ||
      '{}'

    const idFallback = nestedIndex === null ? `call_${index}` : `call_${index}_${nestedIndex}`
    const toolCallId = toolCall.call_id || toolCall.id || idFallback

    toolCalls.push({
      id: String(toolCallId),
      type: 'function',
      function: {
        name: rawName,
        arguments: stringifyToolArguments(rawArguments)
      }
    })
  }

  output.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      return
    }

    if (item.type === 'function_call' || item.type === 'tool_call') {
      pushToolCall(item, index)
      return
    }

    if (item.type === 'message' && Array.isArray(item.content)) {
      item.content.forEach((block, nestedIndex) => {
        if (block?.type === 'function_call' || block?.type === 'tool_call') {
          pushToolCall(block, index, nestedIndex)
        }
      })
    }
  })

  return toolCalls
}

function collectResponseOutputSummary(responsePayload = {}) {
  const output = Array.isArray(responsePayload?.output)
    ? responsePayload.output
    : Array.isArray(responsePayload?.response?.output)
      ? responsePayload.response.output
      : []

  let text = ''
  for (const item of output) {
    if (!item || typeof item !== 'object') {
      continue
    }

    if (item.type === 'message') {
      text += extractTextFromResponseContentBlocks(item.content)
      continue
    }

    if ((item.type === 'output_text' || item.type === 'text') && typeof item.text === 'string') {
      text += item.text
      continue
    }

    if (Array.isArray(item.content)) {
      text += extractTextFromResponseContentBlocks(item.content)
    }
  }

  if (!text && typeof responsePayload?.output_text === 'string') {
    text = responsePayload.output_text
  }

  const toolCalls = extractToolCallsFromResponseOutput(output)
  return { text, toolCalls }
}

function convertUsageToChatCompletionUsage(usageData) {
  if (!usageData || typeof usageData !== 'object') {
    return null
  }

  const promptTokens = Number(usageData.input_tokens ?? usageData.prompt_tokens ?? 0) || 0
  const completionTokens = Number(usageData.output_tokens ?? usageData.completion_tokens ?? 0) || 0
  const cacheReadTokens =
    Number(
      usageData.input_tokens_details?.cached_tokens ??
        usageData.prompt_tokens_details?.cached_tokens ??
        0
    ) || 0
  const cacheCreateTokens = extractCacheCreationTokens(usageData)
  const totalTokens =
    Number(usageData.total_tokens ?? promptTokens + completionTokens + cacheCreateTokens) || 0

  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens
  }

  if (cacheReadTokens > 0 || cacheCreateTokens > 0) {
    usage.prompt_tokens_details = {
      cached_tokens: cacheReadTokens,
      cache_creation_tokens: cacheCreateTokens
    }
  }

  return usage
}

function resolveUnixTimestamp(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value)
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return Math.floor(numeric)
    }

    const parsedTime = Date.parse(value)
    if (!Number.isNaN(parsedTime)) {
      return Math.floor(parsedTime / 1000)
    }
  }

  return fallback
}

function inferChatCompletionFinishReason(responsePayload, hasToolCalls = false) {
  if (hasToolCalls) {
    return 'tool_calls'
  }

  const rawReason =
    responsePayload?.stop_reason ||
    responsePayload?.response?.stop_reason ||
    responsePayload?.reason
  if (typeof rawReason === 'string') {
    const normalized = rawReason.toLowerCase()
    if (
      normalized === 'max_output_tokens' ||
      normalized === 'max_tokens' ||
      normalized === 'length'
    ) {
      return 'length'
    }
    if (normalized === 'content_filter') {
      return 'content_filter'
    }
  }

  const status = responsePayload?.status || responsePayload?.response?.status
  if (status === 'incomplete') {
    return 'length'
  }

  return 'stop'
}

function getChatCompletionsStreamId() {
  return `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function createChatCompletionChunk({
  id,
  model,
  delta = {},
  finishReason = null,
  usage = null,
  created = Math.floor(Date.now() / 1000)
}) {
  const chunk = {
    id: id || getChatCompletionsStreamId(),
    object: 'chat.completion.chunk',
    created,
    model: model || 'gpt-4',
    choices: [
      {
        index: 0,
        delta: delta && typeof delta === 'object' ? delta : {},
        finish_reason: finishReason
      }
    ]
  }

  if (usage && typeof usage === 'object') {
    chunk.usage = usage
  }

  return chunk
}

function buildChatCompletionResponse(responseData, requestedModel, usageDataOverride = null) {
  const source = responseData && typeof responseData === 'object' ? responseData : {}
  const model = source.model || source.response?.model || requestedModel || 'gpt-4'
  const rawId = source.id || source.response?.id || `resp_${Date.now()}`
  const id =
    typeof rawId === 'string' && rawId.startsWith('chatcmpl-')
      ? rawId
      : `chatcmpl-${String(rawId).replace(/[^a-zA-Z0-9_-]/g, '') || Date.now()}`

  const created = resolveUnixTimestamp(
    source.created || source.created_at || source.response?.created || source.response?.created_at,
    Math.floor(Date.now() / 1000)
  )

  const { text, toolCalls } = collectResponseOutputSummary(source)
  const finishReason = inferChatCompletionFinishReason(source, toolCalls.length > 0)
  const message = {
    role: 'assistant',
    content: text || (toolCalls.length > 0 ? null : '')
  }

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls
  }

  const result = {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason
      }
    ]
  }

  const usageData = usageDataOverride || source.usage || source.response?.usage
  const usage = convertUsageToChatCompletionUsage(usageData)
  if (usage) {
    result.usage = usage
  }

  return result
}

function buildResponsesJsonFromCollectedStream({
  completedResponse,
  text,
  usageData,
  model,
  requestedModel
}) {
  if (completedResponse && typeof completedResponse === 'object') {
    return completedResponse
  }

  return {
    id: `resp_${Date.now()}`,
    object: 'response',
    model: model || requestedModel || 'gpt-4',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: text
          ? [
              {
                type: 'output_text',
                text
              }
            ]
          : []
      }
    ],
    usage: usageData || null
  }
}

function extractInstructionTextFromInput(input) {
  if (!Array.isArray(input)) {
    return ''
  }

  const chunks = []
  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue
    }

    const role = typeof item.role === 'string' ? item.role.toLowerCase() : ''
    if (role !== 'system' && role !== 'developer') {
      continue
    }

    if (typeof item.content === 'string' && item.content.trim()) {
      chunks.push(item.content.trim())
      continue
    }

    if (Array.isArray(item.content)) {
      const text = extractTextFromResponseContentBlocks(item.content).trim()
      if (text) {
        chunks.push(text)
      }
    }
  }

  return chunks.join('\n\n')
}

function ensureResponsesInstructions(body = {}) {
  if (!body || typeof body !== 'object') {
    return body
  }

  const normalized = { ...body }
  if (typeof normalized.instructions === 'string' && normalized.instructions.trim()) {
    normalized.instructions = normalized.instructions.trim()
    return normalized
  }

  const inferred = extractInstructionTextFromInput(normalized.input)
  normalized.instructions = inferred || 'You are a helpful assistant.'
  return normalized
}

async function collectResponsesStreamResult(stream) {
  let buffer = ''
  let text = ''
  let completedResponse = null
  let usageData = null
  let model = null
  let errorData = null

  const processEventBlock = (eventBlock) => {
    const lines = eventBlock.split('\n')
    for (const line of lines) {
      const payload = parseSSEDataLine(line)
      if (!payload || payload === '[DONE]') {
        continue
      }

      const eventData = parseJsonSafely(payload)
      if (!eventData || typeof eventData !== 'object') {
        continue
      }

      if (eventData.error && !errorData) {
        errorData = eventData
      }

      const delta = extractCodexDeltaFromEventData(eventData)
      if (delta) {
        text += delta
      }

      if (eventData.type === 'response.completed' && eventData.response) {
        completedResponse = eventData.response
        if (eventData.response.model) {
          model = eventData.response.model
        }
        if (eventData.response.usage) {
          usageData = eventData.response.usage
        }
      }
    }
  }

  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      buffer += chunk.toString()
      if (!buffer.includes('\n\n')) {
        return
      }

      const events = buffer.split('\n\n')
      buffer = events.pop() || ''
      for (const event of events) {
        if (event.trim()) {
          processEventBlock(event)
        }
      }
    })

    stream.on('end', () => {
      if (buffer.trim()) {
        processEventBlock(buffer)
      }
      resolve()
    })

    stream.on('error', reject)
  })

  return { completedResponse, text, usageData, model, errorData }
}

class OpenAIResponsesRelayService {
  constructor() {
    this.defaultTimeout = config.requestTimeout || 600000
  }

  // 处理请求转发
  async handleRequest(req, res, account, apiKeyData) {
    let abortController = null
    const stickySession = resolveOpenAIStickySessionContext(req, apiKeyData?.id || null)
    const sessionHash = stickySession.sessionHash

    if (sessionHash && stickySession.source) {
      logger.debug(
        `OpenAI-Responses sticky session resolved from ${stickySession.source} (apiKeyScoped=${!!apiKeyData?.id}): ${sessionHash.substring(0, 12)}...`
      )
    }

    try {
      // 获取完整的账户信息（包含解密的 API Key）
      const fullAccount = await openaiResponsesAccountService.getAccount(account.id)
      if (!fullAccount) {
        throw new Error('Account not found')
      }

      // 创建 AbortController 用于取消请求
      abortController = new AbortController()

      // 设置客户端断开监听器
      const handleClientDisconnect = () => {
        logger.info('🔌 Client disconnected, aborting OpenAI-Responses request')
        if (abortController && !abortController.signal.aborted) {
          abortController.abort()
        }
      }

      // 监听客户端断开事件
      req.once('close', handleClientDisconnect)
      res.once('close', handleClientDisconnect)

      const isChatCompletionsCompat = isChatCompletionsCompatMode(req)
      const clientWantsStream = isChatCompletionsCompat
        ? req._openaiCompatClientWantsStream === true
        : req.body?.stream === true
      const upstreamUseStream = true
      const upstreamPath = isChatCompletionsCompat ? '/v1/responses' : req.path
      const upstreamBody = isChatCompletionsCompat
        ? ensureResponsesInstructions(req.body || {})
        : { ...(req.body || {}) }
      upstreamBody.stream = upstreamUseStream

      // 构建目标 URL
      const targetUrl = `${fullAccount.baseApi}${upstreamPath}`
      logger.info(`🎯 Forwarding to: ${targetUrl}`)

      // 构建请求头 - 使用统一的 headerFilter 移除 CDN headers
      const headers = {
        ...filterForOpenAI(req.headers),
        Authorization: `Bearer ${fullAccount.apiKey}`,
        'Content-Type': 'application/json'
      }
      if (stickySession.sessionId) {
        headers['session_id'] = stickySession.sessionId
      }
      delete headers['content-length']
      delete headers['Content-Length']

      // 处理 User-Agent
      if (fullAccount.userAgent) {
        // 使用自定义 User-Agent
        headers['User-Agent'] = fullAccount.userAgent
        logger.debug(`📱 Using custom User-Agent: ${fullAccount.userAgent}`)
      } else if (req.headers['user-agent']) {
        // 透传原始 User-Agent
        headers['User-Agent'] = req.headers['user-agent']
        logger.debug(`📱 Forwarding original User-Agent: ${req.headers['user-agent']}`)
      }

      // 配置请求选项
      const requestOptions = {
        method: req.method,
        url: targetUrl,
        headers,
        data: upstreamBody,
        timeout: this.defaultTimeout,
        responseType: upstreamUseStream ? 'stream' : 'json',
        validateStatus: () => true, // 允许处理所有状态码
        signal: abortController.signal
      }

      // 配置代理（如果有）
      if (fullAccount.proxy) {
        const proxyAgent = ProxyHelper.createProxyAgent(fullAccount.proxy)
        if (proxyAgent) {
          requestOptions.httpAgent = proxyAgent
          requestOptions.httpsAgent = proxyAgent
          requestOptions.proxy = false
          logger.info(
            `🌐 Using proxy for OpenAI-Responses: ${ProxyHelper.getProxyDescription(fullAccount.proxy)}`
          )
        }
      }

      // 记录请求信息
      logger.info('📤 OpenAI-Responses relay request', {
        accountId: account.id,
        accountName: account.name,
        targetUrl,
        method: req.method,
        stream: clientWantsStream,
        upstreamStream: upstreamUseStream,
        compatMode: isChatCompletionsCompat ? OPENAI_COMPAT_MODE_CHAT_COMPLETIONS : 'none',
        model: upstreamBody?.model || req.body?.model || 'unknown',
        userAgent: headers['User-Agent'] || 'not set',
        upstreamPath
      })

      // 发送请求
      const response = await axios(requestOptions)

      // 处理 429 限流错误
      if (response.status === 429) {
        const { resetsInSeconds, errorData } = await this._handle429Error(
          account,
          response,
          upstreamUseStream,
          sessionHash
        )

        // 返回错误响应（使用处理后的数据，避免循环引用）
        const errorResponse = errorData || {
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
            resets_in_seconds: resetsInSeconds
          }
        }
        return res.status(429).json(errorResponse)
      }

      // 处理其他错误状态码
      if (response.status >= 400) {
        // 处理流式错误响应
        let errorData = response.data
        if (response.data && typeof response.data.pipe === 'function') {
          // 流式响应需要先读取内容
          const chunks = []
          await new Promise((resolve) => {
            response.data.on('data', (chunk) => chunks.push(chunk))
            response.data.on('end', resolve)
            response.data.on('error', resolve)
            setTimeout(resolve, 5000) // 超时保护
          })
          const fullResponse = Buffer.concat(chunks).toString()

          // 尝试解析错误响应
          try {
            if (fullResponse.includes('data: ')) {
              // SSE格式
              const lines = fullResponse.split('\n')
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const jsonStr = line.slice(6).trim()
                  if (jsonStr && jsonStr !== '[DONE]') {
                    errorData = JSON.parse(jsonStr)
                    break
                  }
                }
              }
            } else {
              // 普通JSON
              errorData = JSON.parse(fullResponse)
            }
          } catch (e) {
            logger.error('Failed to parse error response:', e)
            errorData = { error: { message: fullResponse || 'Unknown error' } }
          }
        }

        logger.error('OpenAI-Responses API error', {
          status: response.status,
          statusText: response.statusText,
          errorData
        })

        if (response.status === 401) {
          let reason = 'OpenAI Responses账号认证失败（401错误）'
          if (errorData) {
            if (typeof errorData === 'string' && errorData.trim()) {
              reason = `OpenAI Responses账号认证失败（401错误）：${errorData.trim()}`
            } else if (
              errorData.error &&
              typeof errorData.error.message === 'string' &&
              errorData.error.message.trim()
            ) {
              reason = `OpenAI Responses账号认证失败（401错误）：${errorData.error.message.trim()}`
            } else if (typeof errorData.message === 'string' && errorData.message.trim()) {
              reason = `OpenAI Responses账号认证失败（401错误）：${errorData.message.trim()}`
            }
          }

          // 不立即标记 unauthorized —— 单次 401 可能是临时性的（token 过期、代理抖动等）。
          // 仅记录警告日志；如果同一账户持续返回 401，由上层重试机制耗尽后再标记。
          logger.warn(
            `⚠️ Auth Unauthorized error detected for OpenAI-Responses account ${account.id}: ${reason}`
          )

          let unauthorizedResponse = errorData
          if (
            !unauthorizedResponse ||
            typeof unauthorizedResponse !== 'object' ||
            unauthorizedResponse.pipe ||
            Buffer.isBuffer(unauthorizedResponse)
          ) {
            const fallbackMessage =
              typeof errorData === 'string' && errorData.trim() ? errorData.trim() : 'Unauthorized'
            unauthorizedResponse = {
              error: {
                message: fallbackMessage,
                type: 'unauthorized',
                code: 'unauthorized'
              }
            }
          }

          // 清理监听器
          req.removeListener('close', handleClientDisconnect)
          res.removeListener('close', handleClientDisconnect)

          return res.status(401).json(unauthorizedResponse)
        }

        // 清理监听器
        req.removeListener('close', handleClientDisconnect)
        res.removeListener('close', handleClientDisconnect)

        return res.status(response.status).json(errorData)
      }

      // 更新最后使用时间
      await openaiResponsesAccountService.updateAccount(account.id, {
        lastUsedAt: new Date().toISOString()
      })

      // 处理 chat/completions 兼容响应
      if (isChatCompletionsCompat && response.data && typeof response.data.pipe === 'function') {
        if (clientWantsStream) {
          return this._handleChatCompatStreamResponse(
            response,
            res,
            account,
            apiKeyData,
            upstreamBody?.model || req.body?.model,
            handleClientDisconnect,
            req,
            sessionHash
          )
        }

        return this._handleCollectedStreamJsonResponse(
          response,
          res,
          account,
          apiKeyData,
          upstreamBody?.model || req.body?.model,
          true,
          sessionHash
        )
      }

      // 处理原生 responses 请求
      if (upstreamUseStream && response.data && typeof response.data.pipe === 'function') {
        if (!clientWantsStream) {
          return this._handleCollectedStreamJsonResponse(
            response,
            res,
            account,
            apiKeyData,
            upstreamBody?.model || req.body?.model,
            false,
            sessionHash
          )
        }

        return this._handleStreamResponse(
          response,
          res,
          account,
          apiKeyData,
          upstreamBody?.model || req.body?.model,
          handleClientDisconnect,
          req,
          sessionHash
        )
      }

      // 处理非流式响应
      return this._handleNormalResponse(
        response,
        res,
        account,
        apiKeyData,
        upstreamBody?.model || req.body?.model
      )
    } catch (error) {
      // 清理 AbortController
      if (abortController && !abortController.signal.aborted) {
        abortController.abort()
      }

      // 安全地记录错误，避免循环引用
      const errorInfo = {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        statusText: error.response?.statusText
      }
      logger.error('OpenAI-Responses relay error:', errorInfo)

      // 检查是否是网络错误
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        await openaiResponsesAccountService.updateAccount(account.id, {
          status: 'error',
          errorMessage: `Connection error: ${error.code}`
        })
      }

      // 如果已经发送了响应头，直接结束
      if (res.headersSent) {
        return res.end()
      }

      // 检查是否是axios错误并包含响应
      if (error.response) {
        // 处理axios错误响应
        const status = error.response.status || 500
        let errorData = {
          error: {
            message: error.response.statusText || 'Request failed',
            type: 'api_error',
            code: error.code || 'unknown'
          }
        }

        // 如果响应包含数据，尝试使用它
        if (error.response.data) {
          // 检查是否是流
          if (typeof error.response.data === 'object' && !error.response.data.pipe) {
            errorData = error.response.data
          } else if (typeof error.response.data === 'string') {
            try {
              errorData = JSON.parse(error.response.data)
            } catch (e) {
              errorData.error.message = error.response.data
            }
          }
        }

        if (status === 401) {
          let reason = 'OpenAI Responses账号认证失败（401错误）'
          if (errorData) {
            if (typeof errorData === 'string' && errorData.trim()) {
              reason = `OpenAI Responses账号认证失败（401错误）：${errorData.trim()}`
            } else if (
              errorData.error &&
              typeof errorData.error.message === 'string' &&
              errorData.error.message.trim()
            ) {
              reason = `OpenAI Responses账号认证失败（401错误）：${errorData.error.message.trim()}`
            } else if (typeof errorData.message === 'string' && errorData.message.trim()) {
              reason = `OpenAI Responses账号认证失败（401错误）：${errorData.message.trim()}`
            }
          }

          // 不立即标记 unauthorized —— 单次 401 可能是临时性的
          logger.warn(
            `⚠️ Auth Unauthorized error detected for OpenAI-Responses account ${account.id} (catch): ${reason}`
          )

          let unauthorizedResponse = errorData
          if (
            !unauthorizedResponse ||
            typeof unauthorizedResponse !== 'object' ||
            unauthorizedResponse.pipe ||
            Buffer.isBuffer(unauthorizedResponse)
          ) {
            const fallbackMessage =
              typeof errorData === 'string' && errorData.trim() ? errorData.trim() : 'Unauthorized'
            unauthorizedResponse = {
              error: {
                message: fallbackMessage,
                type: 'unauthorized',
                code: 'unauthorized'
              }
            }
          }

          return res.status(401).json(unauthorizedResponse)
        }

        return res.status(status).json(errorData)
      }

      // 其他错误
      return res.status(500).json({
        error: {
          message: 'Internal server error',
          type: 'internal_error',
          details: error.message
        }
      })
    }
  }

  // 处理流式响应
  async _handleStreamResponse(
    response,
    res,
    account,
    apiKeyData,
    requestedModel,
    handleClientDisconnect,
    req,
    sessionHash = null
  ) {
    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    const heartbeatIntervalMs = await getOpenAIResponsesStreamHeartbeatIntervalMs()

    let usageData = null
    let actualModel = null
    let buffer = ''
    let rateLimitDetected = false
    let rateLimitResetsInSeconds = null
    let streamEnded = false
    let heartbeatTimer = null
    let lastDataAt = Date.now()

    const clearHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    }

    const sendHeartbeat = () => {
      if (streamEnded || !isWritableSSEStream(res)) {
        clearHeartbeat()
        return
      }

      if (Date.now() - lastDataAt < heartbeatIntervalMs) {
        return
      }

      try {
        res.write(': keep-alive\n\n')
      } catch (heartbeatError) {
        logger.warn('Failed to send OpenAI-Responses SSE heartbeat:', heartbeatError.message)
        clearHeartbeat()
      }
    }

    heartbeatTimer = setInterval(sendHeartbeat, heartbeatIntervalMs)
    if (typeof heartbeatTimer.unref === 'function') {
      heartbeatTimer.unref()
    }

    // 解析 SSE 事件以捕获 usage 数据和 model
    const parseSSEForUsage = (data) => {
      const lines = data.split('\n')

      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const jsonStr = line.slice(5).trim()
            if (jsonStr === '[DONE]') {
              continue
            }

            const eventData = JSON.parse(jsonStr)

            // 检查是否是 response.completed 事件（OpenAI-Responses 格式）
            if (eventData.type === 'response.completed' && eventData.response) {
              // 从响应中获取真实的 model
              if (eventData.response.model) {
                actualModel = eventData.response.model
                logger.debug(`📊 Captured actual model from response.completed: ${actualModel}`)
              }

              // 获取 usage 数据 - OpenAI-Responses 格式在 response.usage 下
              if (eventData.response.usage) {
                usageData = eventData.response.usage
                logger.info('📊 Successfully captured usage data from OpenAI-Responses:', {
                  input_tokens: usageData.input_tokens,
                  output_tokens: usageData.output_tokens,
                  total_tokens: usageData.total_tokens
                })
              }
            }

            // 检查是否有限流错误
            if (eventData.error) {
              // 检查多种可能的限流错误类型
              if (
                eventData.error.type === 'rate_limit_error' ||
                eventData.error.type === 'usage_limit_reached' ||
                eventData.error.type === 'rate_limit_exceeded'
              ) {
                rateLimitDetected = true
                if (eventData.error.resets_in_seconds) {
                  rateLimitResetsInSeconds = eventData.error.resets_in_seconds
                  logger.warn(
                    `🚫 Rate limit detected in stream, resets in ${rateLimitResetsInSeconds} seconds (${Math.ceil(rateLimitResetsInSeconds / 60)} minutes)`
                  )
                }
              }
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

    // 监听数据流
    response.data.on('data', (chunk) => {
      try {
        lastDataAt = Date.now()
        const chunkStr = chunk.toString()

        // 转发数据给客户端
        if (!res.destroyed && !streamEnded) {
          res.write(chunk)
        }

        // 同时解析数据以捕获 usage 信息
        buffer += chunkStr

        // 处理完整的 SSE 事件
        if (buffer.includes('\n\n')) {
          const events = buffer.split('\n\n')
          buffer = events.pop() || ''

          for (const event of events) {
            if (event.trim()) {
              parseSSEForUsage(event)
            }
          }
        }
      } catch (error) {
        logger.error('Error processing stream chunk:', error)
      }
    })

    response.data.on('end', async () => {
      if (streamEnded) {
        return
      }
      streamEnded = true
      clearHeartbeat()

      // 处理剩余的 buffer
      if (buffer.trim()) {
        parseSSEForUsage(buffer)
      }

      // 记录使用统计
      if (usageData) {
        try {
          // OpenAI-Responses 使用 input_tokens/output_tokens，标准 OpenAI 使用 prompt_tokens/completion_tokens
          const totalInputTokens = usageData.input_tokens || usageData.prompt_tokens || 0
          const outputTokens = usageData.output_tokens || usageData.completion_tokens || 0

          // 提取缓存相关的 tokens（如果存在）
          const cacheReadTokens = usageData.input_tokens_details?.cached_tokens || 0
          const cacheCreateTokens = extractCacheCreationTokens(usageData)
          // 计算实际输入token（总输入减去缓存部分）
          const actualInputTokens = Math.max(0, totalInputTokens - cacheReadTokens)

          const totalTokens =
            usageData.total_tokens || totalInputTokens + outputTokens + cacheCreateTokens
          const modelToRecord = actualModel || requestedModel || 'gpt-4'

          await apiKeyService.recordUsage(
            apiKeyData.id,
            actualInputTokens, // 传递实际输入（不含缓存）
            outputTokens,
            cacheCreateTokens,
            cacheReadTokens,
            modelToRecord,
            account.id
          )

          logger.info(
            `📊 Recorded usage - Input: ${totalInputTokens}(actual:${actualInputTokens}+cached:${cacheReadTokens}), CacheCreate: ${cacheCreateTokens}, Output: ${outputTokens}, Total: ${totalTokens}, Model: ${modelToRecord}`
          )

          // 更新账户的 token 使用统计
          await openaiResponsesAccountService.updateAccountUsage(account.id, totalTokens)

          // 更新账户使用额度（如果设置了额度限制）
          if (parseFloat(account.dailyQuota) > 0) {
            // 使用CostCalculator正确计算费用（考虑缓存token的不同价格）
            const CostCalculator = require('../utils/costCalculator')
            const costInfo = CostCalculator.calculateCost(
              {
                input_tokens: actualInputTokens, // 实际输入（不含缓存）
                output_tokens: outputTokens,
                cache_creation_input_tokens: cacheCreateTokens,
                cache_read_input_tokens: cacheReadTokens
              },
              modelToRecord
            )
            await openaiResponsesAccountService.updateUsageQuota(account.id, costInfo.costs.total)
          }
        } catch (error) {
          logger.error('Failed to record usage:', error)
        }
      }

      // 如果在流式响应中检测到限流
      if (rateLimitDetected) {
        await unifiedOpenAIScheduler.markAccountRateLimited(
          account.id,
          'openai-responses',
          sessionHash,
          rateLimitResetsInSeconds
        )

        logger.warn(
          `🚫 Processing rate limit for OpenAI-Responses account ${account.id} from stream`
        )
      }

      // 清理监听器
      req.removeListener('close', handleClientDisconnect)
      res.removeListener('close', handleClientDisconnect)

      if (!res.destroyed) {
        res.end()
      }

      logger.info('Stream response completed', {
        accountId: account.id,
        hasUsage: !!usageData,
        actualModel: actualModel || 'unknown'
      })
    })

    response.data.on('error', (error) => {
      if (streamEnded) {
        return
      }
      streamEnded = true
      clearHeartbeat()
      logger.error('Stream error:', error)

      const interruptionReason = resolveStreamInterruptionReasonFromError(
        error,
        STREAM_INTERRUPTION_REASONS.UPSTREAM_STREAM_ERROR
      )
      recordStreamInterruption(redis, interruptionReason, 'openai-responses')

      // Clean up listeners
      req.removeListener('close', handleClientDisconnect)
      res.removeListener('close', handleClientDisconnect)

      if (!res.headersSent) {
        res.status(502).json({ error: { message: error?.message || 'Upstream stream error' } })
      } else if (isWritableSSEStream(res)) {
        sendOpenAIResponsesStreamErrorEvent(res, error, interruptionReason)
        res.end()
      }
    })

    // Handle client disconnection
    const cleanup = () => {
      if (streamEnded) {
        return
      }
      streamEnded = true
      clearHeartbeat()
      recordStreamInterruption(redis, STREAM_INTERRUPTION_REASONS.CLIENT_ABORT, 'openai-responses')
      try {
        response.data?.unpipe?.(res)
        response.data?.destroy?.()
      } catch (_) {
        // 忽略清理错误
      }
    }

    req.on('close', cleanup)
    req.on('aborted', cleanup)
  }

  async _handleCollectedStreamJsonResponse(
    response,
    res,
    account,
    apiKeyData,
    requestedModel,
    asChatCompletion = false,
    sessionHash = null
  ) {
    try {
      const { completedResponse, text, usageData, model, errorData } =
        await collectResponsesStreamResult(response.data)

      if (errorData && !completedResponse) {
        const errorPayload =
          errorData && typeof errorData === 'object'
            ? errorData
            : { error: { message: 'Upstream stream returned an error event' } }
        const errorType = errorPayload.error?.type || ''
        const status =
          errorType.includes('rate_limit') || errorType.includes('usage_limit') ? 429 : 502

        if (status === 429) {
          const resetsInSeconds = Number(
            errorPayload.error?.resets_in_seconds ?? errorPayload.error?.resets_in ?? 0
          )
          await unifiedOpenAIScheduler.markAccountRateLimited(
            account.id,
            'openai-responses',
            sessionHash,
            Number.isFinite(resetsInSeconds) && resetsInSeconds > 0 ? resetsInSeconds : null
          )
        }

        return res.status(status).json(errorPayload)
      }

      const upstreamResponsePayload = buildResponsesJsonFromCollectedStream({
        completedResponse,
        text,
        usageData,
        model,
        requestedModel
      })

      if (asChatCompletion) {
        const chatResponse = buildChatCompletionResponse(
          upstreamResponsePayload,
          model || requestedModel,
          usageData || upstreamResponsePayload?.usage || null
        )
        return this._handleNormalResponse(
          { status: 200, data: chatResponse },
          res,
          account,
          apiKeyData,
          model || requestedModel
        )
      }

      return this._handleNormalResponse(
        { status: 200, data: upstreamResponsePayload },
        res,
        account,
        apiKeyData,
        model || requestedModel
      )
    } catch (error) {
      logger.error('Failed to collect OpenAI-Responses stream for non-stream output:', error)
      return res.status(502).json({
        error: {
          message: 'Failed to process upstream stream response',
          type: 'stream_error',
          code: 'stream_collect_failed'
        }
      })
    }
  }

  async _handleChatCompatStreamResponse(
    response,
    res,
    account,
    apiKeyData,
    requestedModel,
    handleClientDisconnect,
    req,
    sessionHash = null
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    const heartbeatIntervalMs = await getOpenAIResponsesStreamHeartbeatIntervalMs()
    const streamId = getChatCompletionsStreamId()

    let usageData = null
    let actualModel = null
    let completedResponse = null
    let buffer = ''
    let streamEnded = false
    let heartbeatTimer = null
    let lastDataAt = Date.now()
    let initialChunkSent = false
    let finalChunkSent = false
    let doneSent = false
    let usageReported = false
    let rateLimitDetected = false
    let rateLimitResetsInSeconds = null

    const clearHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    }

    const sendHeartbeat = () => {
      if (streamEnded || !isWritableSSEStream(res)) {
        clearHeartbeat()
        return
      }

      if (Date.now() - lastDataAt < heartbeatIntervalMs) {
        return
      }

      try {
        res.write(': keep-alive\n\n')
      } catch (heartbeatError) {
        logger.warn(
          'Failed to send OpenAI-Responses chat-compat heartbeat:',
          heartbeatError.message
        )
        clearHeartbeat()
      }
    }

    const sendInitialChunk = () => {
      if (initialChunkSent || !isWritableSSEStream(res)) {
        return
      }

      const initialChunk = createChatCompletionChunk({
        id: streamId,
        model: actualModel || requestedModel || 'gpt-4',
        delta: { role: 'assistant' },
        finishReason: null
      })

      res.write(`data: ${JSON.stringify(initialChunk)}\n\n`)
      initialChunkSent = true
    }

    const sendDeltaChunk = (deltaText) => {
      if (!deltaText || !isWritableSSEStream(res)) {
        return
      }

      sendInitialChunk()
      const chunk = createChatCompletionChunk({
        id: streamId,
        model: actualModel || requestedModel || 'gpt-4',
        delta: { content: deltaText },
        finishReason: null
      })
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
    }

    const sendFinalChunk = (usageOverride = null) => {
      if (finalChunkSent || !isWritableSSEStream(res)) {
        return
      }

      sendInitialChunk()
      const responsePayload =
        completedResponse ||
        (actualModel || usageData
          ? {
              model: actualModel || requestedModel || 'gpt-4',
              usage: usageOverride || usageData
            }
          : {})

      const { toolCalls } = collectResponseOutputSummary(responsePayload)
      const finishReason = inferChatCompletionFinishReason(responsePayload, toolCalls.length > 0)
      const delta = toolCalls.length > 0 ? { tool_calls: toolCalls } : {}
      const usage = convertUsageToChatCompletionUsage(
        usageOverride || responsePayload.usage || usageData
      )

      const finalChunk = createChatCompletionChunk({
        id: streamId,
        model: responsePayload.model || actualModel || requestedModel || 'gpt-4',
        delta,
        finishReason,
        usage
      })

      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`)
      finalChunkSent = true
    }

    const sendDone = () => {
      if (doneSent || !isWritableSSEStream(res)) {
        return
      }
      res.write('data: [DONE]\n\n')
      doneSent = true
    }

    const maybeMarkRateLimit = async () => {
      if (!rateLimitDetected) {
        return
      }

      await unifiedOpenAIScheduler.markAccountRateLimited(
        account.id,
        'openai-responses',
        sessionHash,
        rateLimitResetsInSeconds
      )
    }

    const maybeRecordUsage = async () => {
      if (!usageData || usageReported) {
        return
      }

      const totalInputTokens = usageData.input_tokens || usageData.prompt_tokens || 0
      const outputTokens = usageData.output_tokens || usageData.completion_tokens || 0
      const cacheReadTokens =
        usageData.input_tokens_details?.cached_tokens ||
        usageData.prompt_tokens_details?.cached_tokens ||
        0
      const cacheCreateTokens = extractCacheCreationTokens(usageData)
      const actualInputTokens = Math.max(0, totalInputTokens - cacheReadTokens)
      const totalTokens =
        usageData.total_tokens || totalInputTokens + outputTokens + cacheCreateTokens
      const modelToRecord = actualModel || requestedModel || 'gpt-4'

      await apiKeyService.recordUsage(
        apiKeyData.id,
        actualInputTokens,
        outputTokens,
        cacheCreateTokens,
        cacheReadTokens,
        modelToRecord,
        account.id
      )
      await openaiResponsesAccountService.updateAccountUsage(account.id, totalTokens)

      if (parseFloat(account.dailyQuota) > 0) {
        const CostCalculator = require('../utils/costCalculator')
        const costInfo = CostCalculator.calculateCost(
          {
            input_tokens: actualInputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: cacheCreateTokens,
            cache_read_input_tokens: cacheReadTokens
          },
          modelToRecord
        )
        await openaiResponsesAccountService.updateUsageQuota(account.id, costInfo.costs.total)
      }

      usageReported = true
      logger.info(
        `📊 Recorded chat-compat stream usage - Input: ${totalInputTokens}(actual:${actualInputTokens}+cached:${cacheReadTokens}), CacheCreate: ${cacheCreateTokens}, Output: ${outputTokens}, Total: ${totalTokens}, Model: ${modelToRecord}`
      )
    }

    const processEventBlock = (eventBlock) => {
      const lines = eventBlock.split('\n')
      for (const line of lines) {
        const payload = parseSSEDataLine(line)
        if (!payload || payload === '[DONE]') {
          continue
        }

        const eventData = parseJsonSafely(payload)
        if (!eventData || typeof eventData !== 'object') {
          continue
        }

        const deltaText = extractCodexDeltaFromEventData(eventData)
        if (deltaText) {
          sendDeltaChunk(deltaText)
        }

        if (eventData.error) {
          if (
            eventData.error.type === 'rate_limit_error' ||
            eventData.error.type === 'usage_limit_reached' ||
            eventData.error.type === 'rate_limit_exceeded'
          ) {
            rateLimitDetected = true
            if (eventData.error.resets_in_seconds) {
              rateLimitResetsInSeconds = eventData.error.resets_in_seconds
            }
          }
        }

        if (eventData.type === 'response.completed' && eventData.response) {
          completedResponse = eventData.response
          if (eventData.response.model) {
            actualModel = eventData.response.model
          }
          if (eventData.response.usage) {
            usageData = eventData.response.usage
          }
          sendFinalChunk(eventData.response.usage || null)
          sendDone()
        }
      }
    }

    heartbeatTimer = setInterval(sendHeartbeat, heartbeatIntervalMs)
    if (typeof heartbeatTimer.unref === 'function') {
      heartbeatTimer.unref()
    }
    sendInitialChunk()

    response.data.on('data', (chunk) => {
      if (streamEnded) {
        return
      }

      try {
        lastDataAt = Date.now()
        buffer += chunk.toString()

        if (!buffer.includes('\n\n')) {
          return
        }

        const events = buffer.split('\n\n')
        buffer = events.pop() || ''
        for (const eventBlock of events) {
          if (eventBlock.trim()) {
            processEventBlock(eventBlock)
          }
        }
      } catch (error) {
        logger.error('Failed to process OpenAI-Responses chat-compat stream chunk:', error)
      }
    })

    response.data.on('end', async () => {
      if (streamEnded) {
        return
      }
      streamEnded = true
      clearHeartbeat()

      if (buffer.trim()) {
        processEventBlock(buffer)
      }

      try {
        await maybeRecordUsage()
      } catch (error) {
        logger.error('Failed to record chat-compat stream usage:', error)
      }

      try {
        await maybeMarkRateLimit()
      } catch (error) {
        logger.error('Failed to mark chat-compat stream rate limit:', error)
      }

      req.removeListener('close', handleClientDisconnect)
      res.removeListener('close', handleClientDisconnect)

      sendFinalChunk(usageData)
      sendDone()
      if (isWritableSSEStream(res)) {
        res.end()
      }
    })

    response.data.on('error', (error) => {
      if (streamEnded) {
        return
      }
      streamEnded = true
      clearHeartbeat()
      logger.error('OpenAI-Responses chat-compat stream error:', error)

      const interruptionReason = resolveStreamInterruptionReasonFromError(
        error,
        STREAM_INTERRUPTION_REASONS.UPSTREAM_STREAM_ERROR
      )
      recordStreamInterruption(redis, interruptionReason, 'openai-responses')

      req.removeListener('close', handleClientDisconnect)
      res.removeListener('close', handleClientDisconnect)

      if (!res.headersSent) {
        res.status(502).json({ error: { message: error?.message || 'Upstream stream error' } })
      } else if (isWritableSSEStream(res)) {
        const payload = {
          error: {
            message: error?.message || 'Upstream stream error',
            type: 'stream_error',
            code: interruptionReason
          }
        }
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
        sendDone()
        res.end()
      }
    })

    const cleanup = () => {
      if (streamEnded) {
        return
      }
      streamEnded = true
      clearHeartbeat()
      recordStreamInterruption(redis, STREAM_INTERRUPTION_REASONS.CLIENT_ABORT, 'openai-responses')
      try {
        response.data?.unpipe?.(res)
        response.data?.destroy?.()
      } catch (_) {
        //
      }
    }
    req.on('close', cleanup)
    req.on('aborted', cleanup)
  }

  // 处理非流式响应
  async _handleNormalResponse(response, res, account, apiKeyData, requestedModel) {
    const responseData = response.data

    // 提取 usage 数据和实际 model
    // 支持两种格式：直接的 usage 或嵌套在 response 中的 usage
    const usageData = responseData?.usage || responseData?.response?.usage
    const actualModel =
      responseData?.model || responseData?.response?.model || requestedModel || 'gpt-4'

    // 记录使用统计
    if (usageData) {
      try {
        // OpenAI-Responses 使用 input_tokens/output_tokens，标准 OpenAI 使用 prompt_tokens/completion_tokens
        const totalInputTokens = usageData.input_tokens || usageData.prompt_tokens || 0
        const outputTokens = usageData.output_tokens || usageData.completion_tokens || 0

        // 提取缓存相关的 tokens（如果存在）
        const cacheReadTokens = usageData.input_tokens_details?.cached_tokens || 0
        const cacheCreateTokens = extractCacheCreationTokens(usageData)
        // 计算实际输入token（总输入减去缓存部分）
        const actualInputTokens = Math.max(0, totalInputTokens - cacheReadTokens)

        const totalTokens =
          usageData.total_tokens || totalInputTokens + outputTokens + cacheCreateTokens

        await apiKeyService.recordUsage(
          apiKeyData.id,
          actualInputTokens, // 传递实际输入（不含缓存）
          outputTokens,
          cacheCreateTokens,
          cacheReadTokens,
          actualModel,
          account.id
        )

        logger.info(
          `📊 Recorded non-stream usage - Input: ${totalInputTokens}(actual:${actualInputTokens}+cached:${cacheReadTokens}), CacheCreate: ${cacheCreateTokens}, Output: ${outputTokens}, Total: ${totalTokens}, Model: ${actualModel}`
        )

        // 更新账户的 token 使用统计
        await openaiResponsesAccountService.updateAccountUsage(account.id, totalTokens)

        // 更新账户使用额度（如果设置了额度限制）
        if (parseFloat(account.dailyQuota) > 0) {
          // 使用CostCalculator正确计算费用（考虑缓存token的不同价格）
          const CostCalculator = require('../utils/costCalculator')
          const costInfo = CostCalculator.calculateCost(
            {
              input_tokens: actualInputTokens, // 实际输入（不含缓存）
              output_tokens: outputTokens,
              cache_creation_input_tokens: cacheCreateTokens,
              cache_read_input_tokens: cacheReadTokens
            },
            actualModel
          )
          await openaiResponsesAccountService.updateUsageQuota(account.id, costInfo.costs.total)
        }
      } catch (error) {
        logger.error('Failed to record usage:', error)
      }
    }

    // 返回响应
    res.status(response.status).json(responseData)

    logger.info('Normal response completed', {
      accountId: account.id,
      status: response.status,
      hasUsage: !!usageData,
      model: actualModel
    })
  }

  // 处理 429 限流错误
  async _handle429Error(account, response, isStream = false, sessionHash = null) {
    let resetsInSeconds = null
    let errorData = null

    try {
      // 对于429错误，响应可能是JSON或SSE格式
      if (isStream && response.data && typeof response.data.pipe === 'function') {
        // 流式响应需要先收集数据
        const chunks = []
        await new Promise((resolve, reject) => {
          response.data.on('data', (chunk) => chunks.push(chunk))
          response.data.on('end', resolve)
          response.data.on('error', reject)
          // 设置超时防止无限等待
          setTimeout(resolve, 5000)
        })

        const fullResponse = Buffer.concat(chunks).toString()

        // 尝试解析SSE格式的错误响应
        if (fullResponse.includes('data: ')) {
          const lines = fullResponse.split('\n')
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const jsonStr = line.slice(6).trim()
                if (jsonStr && jsonStr !== '[DONE]') {
                  errorData = JSON.parse(jsonStr)
                  break
                }
              } catch (e) {
                // 继续尝试下一行
              }
            }
          }
        }

        // 如果SSE解析失败，尝试直接解析为JSON
        if (!errorData) {
          try {
            errorData = JSON.parse(fullResponse)
          } catch (e) {
            logger.error('Failed to parse 429 error response:', e)
            logger.debug('Raw response:', fullResponse)
          }
        }
      } else if (response.data && typeof response.data !== 'object') {
        // 如果response.data是字符串，尝试解析为JSON
        try {
          errorData = JSON.parse(response.data)
        } catch (e) {
          logger.error('Failed to parse 429 error response as JSON:', e)
          errorData = { error: { message: response.data } }
        }
      } else if (response.data && typeof response.data === 'object' && !response.data.pipe) {
        // 非流式响应，且是对象，直接使用
        errorData = response.data
      }

      // 从响应体中提取重置时间（OpenAI 标准格式）
      if (errorData && errorData.error) {
        if (errorData.error.resets_in_seconds) {
          resetsInSeconds = errorData.error.resets_in_seconds
          logger.info(
            `🕐 Rate limit will reset in ${resetsInSeconds} seconds (${Math.ceil(resetsInSeconds / 60)} minutes / ${Math.ceil(resetsInSeconds / 3600)} hours)`
          )
        } else if (errorData.error.resets_in) {
          // 某些 API 可能使用不同的字段名
          resetsInSeconds = parseInt(errorData.error.resets_in)
          logger.info(
            `🕐 Rate limit will reset in ${resetsInSeconds} seconds (${Math.ceil(resetsInSeconds / 60)} minutes / ${Math.ceil(resetsInSeconds / 3600)} hours)`
          )
        }
      }

      if (!resetsInSeconds) {
        logger.warn('⚠️ Could not extract reset time from 429 response, using default 60 minutes')
      }
    } catch (e) {
      logger.error('⚠️ Failed to parse rate limit error:', e)
    }

    // 使用统一调度器标记账户为限流状态（与普通OpenAI账号保持一致）
    await unifiedOpenAIScheduler.markAccountRateLimited(
      account.id,
      'openai-responses',
      sessionHash,
      resetsInSeconds
    )

    logger.warn('OpenAI-Responses account rate limited', {
      accountId: account.id,
      accountName: account.name,
      resetsInSeconds: resetsInSeconds || 'unknown',
      resetInMinutes: resetsInSeconds ? Math.ceil(resetsInSeconds / 60) : 60,
      resetInHours: resetsInSeconds ? Math.ceil(resetsInSeconds / 3600) : 1
    })

    // 返回处理后的数据，避免循环引用
    return { resetsInSeconds, errorData }
  }

  // 过滤请求头 - 已迁移到 headerFilter 工具类
  // 此方法保留用于向后兼容，实际使用 filterForOpenAI()
  _filterRequestHeaders(headers) {
    return filterForOpenAI(headers)
  }

  // 估算费用（简化版本，实际应该根据不同的定价模型）
  _estimateCost(model, inputTokens, outputTokens) {
    // 这是一个简化的费用估算，实际应该根据不同的 API 提供商和模型定价
    const rates = {
      'gpt-4': { input: 0.03, output: 0.06 }, // per 1K tokens
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'claude-3-opus': { input: 0.015, output: 0.075 },
      'claude-3-sonnet': { input: 0.003, output: 0.015 },
      'claude-3-haiku': { input: 0.00025, output: 0.00125 }
    }

    // 查找匹配的模型定价
    let rate = rates['gpt-3.5-turbo'] // 默认使用 GPT-3.5 的价格
    for (const [modelKey, modelRate] of Object.entries(rates)) {
      if (model.toLowerCase().includes(modelKey.toLowerCase())) {
        rate = modelRate
        break
      }
    }

    const inputCost = (inputTokens / 1000) * rate.input
    const outputCost = (outputTokens / 1000) * rate.output
    return inputCost + outputCost
  }
}

module.exports = new OpenAIResponsesRelayService()
