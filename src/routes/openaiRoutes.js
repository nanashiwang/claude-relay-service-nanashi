const express = require('express')
const axios = require('axios')
const router = express.Router()
const logger = require('../utils/logger')
const config = require('../../config/config')
const { authenticateApiKey } = require('../middleware/auth')
const unifiedOpenAIScheduler = require('../services/unifiedOpenAIScheduler')
const openaiAccountService = require('../services/openaiAccountService')
const openaiResponsesAccountService = require('../services/openaiResponsesAccountService')
const openaiResponsesRelayService = require('../services/openaiResponsesRelayService')
const apiKeyService = require('../services/apiKeyService')
const claudeRelayConfigService = require('../services/claudeRelayConfigService')
const redis = require('../models/redis')
const ProxyHelper = require('../utils/proxyHelper')
const { resolveOpenAIStickySessionContext } = require('../utils/openaiSessionResolver')
const { updateRateLimitCounters } = require('../utils/rateLimitHelper')
const {
  STREAM_INTERRUPTION_REASONS,
  resolveStreamInterruptionReasonFromError,
  recordStreamInterruption
} = require('../utils/streamInterruptionHelper')

// 创建代理 Agent（使用统一的代理工具）
function createProxyAgent(proxy) {
  return ProxyHelper.createProxyAgent(proxy)
}

// 检查 API Key 是否具备 OpenAI 权限
function checkOpenAIPermissions(apiKeyData) {
  return apiKeyService.hasPermission(apiKeyData?.permissions, 'openai')
}

function normalizeHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') {
    return {}
  }
  const normalized = {}
  for (const [key, value] of Object.entries(headers)) {
    if (!key) {
      continue
    }
    normalized[key.toLowerCase()] = Array.isArray(value) ? value[0] : value
  }
  return normalized
}

function toNumberSafe(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function extractCodexUsageHeaders(headers) {
  const normalized = normalizeHeaders(headers)
  if (!normalized || Object.keys(normalized).length === 0) {
    return null
  }

  const snapshot = {
    primaryUsedPercent: toNumberSafe(normalized['x-codex-primary-used-percent']),
    primaryResetAfterSeconds: toNumberSafe(normalized['x-codex-primary-reset-after-seconds']),
    primaryWindowMinutes: toNumberSafe(normalized['x-codex-primary-window-minutes']),
    secondaryUsedPercent: toNumberSafe(normalized['x-codex-secondary-used-percent']),
    secondaryResetAfterSeconds: toNumberSafe(normalized['x-codex-secondary-reset-after-seconds']),
    secondaryWindowMinutes: toNumberSafe(normalized['x-codex-secondary-window-minutes']),
    primaryOverSecondaryPercent: toNumberSafe(
      normalized['x-codex-primary-over-secondary-limit-percent']
    )
  }

  const hasData = Object.values(snapshot).some((value) => value !== null)
  return hasData ? snapshot : null
}

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
    if (value === undefined || value === null || value === '') {
      continue
    }

    const parsed = Number(value)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }

  return 0
}

async function applyRateLimitTracking(req, usageSummary, model, context = '') {
  if (!req.rateLimitInfo) {
    return
  }

  const label = context ? ` (${context})` : ''

  try {
    const { totalTokens, totalCost } = await updateRateLimitCounters(
      req.rateLimitInfo,
      usageSummary,
      model
    )

    if (totalTokens > 0) {
      logger.api(`📊 Updated rate limit token count${label}: +${totalTokens} tokens`)
    }
    if (typeof totalCost === 'number' && totalCost > 0) {
      logger.api(`💰 Updated rate limit cost count${label}: +$${totalCost.toFixed(6)}`)
    }
  } catch (error) {
    logger.error(`❌ Failed to update rate limit counters${label}:`, error)
  }
}

// 使用统一调度器选择 OpenAI 账户
const OPENAI_AUTH_RETRY_MAX_COUNT = 3
const OPENAI_AUTH_RETRYABLE_STATUS = new Set([401, 402, 403])
const DEFAULT_OPENAI_STREAM_HEARTBEAT_INTERVAL_MS = 15000

function getOpenAIAuthRetryState(req) {
  if (!req._openaiAuthRetryState || typeof req._openaiAuthRetryState !== 'object') {
    req._openaiAuthRetryState = { count: 0 }
  }
  return req._openaiAuthRetryState
}

function tryConsumeOpenAIAuthRetry(req, status, accountId, accountType) {
  if (!OPENAI_AUTH_RETRYABLE_STATUS.has(status) || !accountId) {
    return false
  }

  const retryState = getOpenAIAuthRetryState(req)
  if (retryState.count >= OPENAI_AUTH_RETRY_MAX_COUNT) {
    return false
  }

  retryState.count += 1
  logger.warn(
    `OpenAI auth retry ${retryState.count}/${OPENAI_AUTH_RETRY_MAX_COUNT} after ${status} from account ${accountType}:${accountId}`
  )
  return true
}

async function getOpenAIStreamHeartbeatIntervalMs() {
  try {
    const runtimeConfig = await claudeRelayConfigService.getConfig()
    const interval = Number(runtimeConfig?.openaiStreamHeartbeatIntervalMs)
    if (Number.isInteger(interval) && interval >= 5000 && interval <= 60000) {
      return interval
    }
  } catch (error) {
    logger.debug('Failed to load OpenAI stream heartbeat interval from runtime config:', error)
  }

  return DEFAULT_OPENAI_STREAM_HEARTBEAT_INTERVAL_MS
}

function isWritableSSEStream(res) {
  return !!res && !res.destroyed && !res.writableEnded && !res.socket?.destroyed
}

function sendOpenAIStreamErrorEvent(res, error, source = 'upstream_stream_error') {
  if (!isWritableSSEStream(res)) {
    return false
  }

  const message = error?.message || 'Upstream stream error'
  const payload = {
    type: 'error',
    error: {
      message,
      type: 'stream_error',
      code: source,
      retryable: true,
      timestamp: new Date().toISOString()
    }
  }

  try {
    res.write(`event: relay.error\ndata: ${JSON.stringify(payload)}\n\n`)
    res.write('data: [DONE]\n\n')
    return true
  } catch (writeError) {
    logger.error('Failed to write OpenAI SSE error event:', writeError)
    return false
  }
}

const OPENAI_COMPAT_MODE_CHAT_COMPLETIONS = 'chat_completions'

function isChatCompletionsCompatMode(req) {
  return req?._openaiCompatMode === OPENAI_COMPAT_MODE_CHAT_COMPLETIONS
}

function getChatCompletionsStreamId() {
  return `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function extractTextFromChatMessageContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const chunks = []
    for (const part of content) {
      if (typeof part === 'string') {
        chunks.push(part)
        continue
      }

      if (!part || typeof part !== 'object') {
        continue
      }

      if (typeof part.text === 'string') {
        chunks.push(part.text)
        continue
      }

      if (typeof part.content === 'string') {
        chunks.push(part.content)
      }
    }
    return chunks.join('')
  }

  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') {
      return content.text
    }

    if (typeof content.content === 'string') {
      return content.content
    }
  }

  return ''
}

function normalizeChatRole(role) {
  const normalizedRole = typeof role === 'string' ? role.toLowerCase().trim() : 'user'
  if (['system', 'developer', 'user', 'assistant'].includes(normalizedRole)) {
    return normalizedRole
  }
  return normalizedRole === 'tool' ? 'user' : 'user'
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

function convertChatMessagesToResponsesInput(messages = []) {
  if (!Array.isArray(messages)) {
    return []
  }

  const input = []
  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue
    }

    const originalRole =
      typeof message.role === 'string' ? message.role.toLowerCase().trim() : 'user'
    const role = normalizeChatRole(originalRole)
    let content = extractTextFromChatMessageContent(message.content)

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const toolCallTexts = message.tool_calls
        .map((toolCall) => {
          const toolName = toolCall?.function?.name || 'unknown_tool'
          const argumentsText = stringifyToolArguments(toolCall?.function?.arguments)
          return `[tool_call:${toolName}] ${argumentsText}`
        })
        .filter(Boolean)
      if (toolCallTexts.length > 0) {
        content = content ? `${content}\n${toolCallTexts.join('\n')}` : toolCallTexts.join('\n')
      }
    }

    if (originalRole === 'tool') {
      const toolCallId = message.tool_call_id ? `(${message.tool_call_id})` : ''
      const toolResult = content || ''
      content = `Tool result${toolCallId}: ${toolResult}`
    }

    if (!content && role !== 'assistant') {
      continue
    }

    input.push({
      role,
      content: content || ''
    })
  }

  return input
}

function normalizeChatToolsForResponses(tools) {
  if (!Array.isArray(tools)) {
    return undefined
  }

  const normalizedTools = []
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') {
      continue
    }

    if (tool.type === 'function' && tool.function && typeof tool.function === 'object') {
      const name = tool.function.name || tool.name
      if (!name) {
        continue
      }

      normalizedTools.push({
        type: 'function',
        name,
        description: tool.function.description || tool.description,
        parameters: tool.function.parameters || tool.parameters || {}
      })
      continue
    }

    if (tool.type === 'function' && tool.name) {
      normalizedTools.push(tool)
      continue
    }

    normalizedTools.push(tool)
  }

  return normalizedTools.length > 0 ? normalizedTools : undefined
}

function normalizeChatToolChoiceForResponses(toolChoice) {
  if (toolChoice === undefined || toolChoice === null) {
    return undefined
  }

  if (typeof toolChoice === 'string') {
    return toolChoice
  }

  if (typeof toolChoice !== 'object') {
    return undefined
  }

  if (toolChoice.type === 'function') {
    const name = toolChoice.function?.name || toolChoice.name
    if (name) {
      return { type: 'function', name }
    }
  }

  return undefined
}

function convertChatCompletionsRequestToResponses(body = {}) {
  const sourceBody = body && typeof body === 'object' ? body : {}
  const converted = {
    model: sourceBody.model,
    stream: sourceBody.stream === true
  }

  const input = convertChatMessagesToResponsesInput(sourceBody.messages)
  if (input.length > 0) {
    converted.input = input
  }

  if (sourceBody.max_output_tokens !== undefined) {
    converted.max_output_tokens = sourceBody.max_output_tokens
  } else if (sourceBody.max_tokens !== undefined) {
    converted.max_output_tokens = sourceBody.max_tokens
  } else if (sourceBody.max_completion_tokens !== undefined) {
    converted.max_output_tokens = sourceBody.max_completion_tokens
  }

  const passthroughKeys = [
    'temperature',
    'top_p',
    'stop',
    'presence_penalty',
    'frequency_penalty',
    'reasoning',
    'metadata',
    'parallel_tool_calls',
    'session_id',
    'conversation_id',
    'user',
    'service_tier'
  ]

  for (const key of passthroughKeys) {
    if (sourceBody[key] !== undefined) {
      converted[key] = sourceBody[key]
    }
  }

  const tools = normalizeChatToolsForResponses(sourceBody.tools)
  if (tools) {
    converted.tools = tools
  }

  const toolChoice = normalizeChatToolChoiceForResponses(sourceBody.tool_choice)
  if (toolChoice !== undefined) {
    converted.tool_choice = toolChoice
  }

  return converted
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

async function readStreamBodyToString(stream, timeoutMs = 15000) {
  if (!stream || typeof stream.on !== 'function') {
    return ''
  }

  return await new Promise((resolve) => {
    const chunks = []
    let settled = false

    const finish = () => {
      if (settled) {
        return
      }
      settled = true
      resolve(Buffer.concat(chunks).toString())
    }

    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    stream.on('end', finish)
    stream.on('error', finish)
    setTimeout(finish, timeoutMs)
  })
}

function parseErrorPayloadFromRaw(rawText, fallbackMessage = 'Upstream request failed') {
  const normalized = typeof rawText === 'string' ? rawText.trim() : ''
  if (!normalized) {
    return {
      error: {
        message: fallbackMessage
      }
    }
  }

  const directJson = parseJsonSafely(normalized)
  if (directJson && typeof directJson === 'object') {
    return directJson
  }

  const lines = normalized.split(/\r?\n/)
  for (const line of lines) {
    if (!line.startsWith('data: ')) {
      continue
    }
    const payload = line.slice(6).trim()
    if (!payload || payload === '[DONE]') {
      continue
    }
    const parsed = parseJsonSafely(payload)
    if (parsed && typeof parsed === 'object') {
      return parsed
    }
  }

  return {
    error: {
      message: normalized
    }
  }
}

async function collectResponsesStreamResult(stream) {
  let buffer = ''
  let text = ''
  let completedResponse = null
  let usageData = null
  let model = null

  const processEventBlock = (eventBlock) => {
    const lines = eventBlock.split('\n')
    for (const line of lines) {
      if (!line.startsWith('data: ')) {
        continue
      }

      const payload = line.slice(6).trim()
      if (!payload || payload === '[DONE]') {
        continue
      }

      const eventData = parseJsonSafely(payload)
      if (!eventData || typeof eventData !== 'object') {
        continue
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
      for (const evt of events) {
        if (evt.trim()) {
          processEventBlock(evt)
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

  return { completedResponse, text, usageData, model }
}

async function getOpenAIAuthToken(apiKeyData, sessionHash = null, requestedModel = null) {
  try {
    // 使用统一调度器选择账户
    const result = await unifiedOpenAIScheduler.selectAccountForApiKey(
      apiKeyData,
      sessionHash,
      requestedModel
    )

    if (!result || !result.accountId) {
      const error = new Error('No available OpenAI account found')
      error.statusCode = 402 // Payment Required - 资源耗尽
      throw error
    }

    const attachAccountContext = (error) => {
      if (result?.accountId && !error.accountId) {
        error.accountId = result.accountId
      }
      if (result?.accountType && !error.accountType) {
        error.accountType = result.accountType
      }
      return error
    }

    // 根据账户类型获取账户详情
    let account,
      accessToken,
      proxy = null

    if (result.accountType === 'openai-responses') {
      // 处理 OpenAI-Responses 账户
      account = await openaiResponsesAccountService.getAccount(result.accountId)
      if (!account || !account.apiKey) {
        const error = new Error(`OpenAI-Responses account ${result.accountId} has no valid apiKey`)
        error.statusCode = 403 // Forbidden - 账户配置错误
        throw attachAccountContext(error)
      }

      // OpenAI-Responses 账户不需要 accessToken，直接返回账户信息
      accessToken = null // OpenAI-Responses 使用账户内的 apiKey

      // 解析代理配置
      if (account.proxy) {
        try {
          proxy = typeof account.proxy === 'string' ? JSON.parse(account.proxy) : account.proxy
        } catch (e) {
          logger.warn('Failed to parse proxy configuration:', e)
        }
      }

      logger.info(`Selected OpenAI-Responses account: ${account.name} (${result.accountId})`)
    } else {
      // 处理普通 OpenAI 账户
      account = await openaiAccountService.getAccount(result.accountId)
      if (!account || !account.accessToken) {
        const error = new Error(`OpenAI account ${result.accountId} has no valid accessToken`)
        error.statusCode = 403 // Forbidden - 账户配置错误
        throw attachAccountContext(error)
      }

      // 检查 token 是否过期并自动刷新（双重保护）
      if (openaiAccountService.isTokenExpired(account)) {
        if (account.refreshToken) {
          logger.info(`🔄 Token expired, auto-refreshing for account ${account.name} (fallback)`)
          try {
            await openaiAccountService.refreshAccountToken(result.accountId)
            // 重新获取更新后的账户
            account = await openaiAccountService.getAccount(result.accountId)
            logger.info(`✅ Token refreshed successfully in route handler`)
          } catch (refreshError) {
            logger.error(`Failed to refresh token for ${account.name}:`, refreshError)
            const error = new Error(`Token expired and refresh failed: ${refreshError.message}`)
            error.statusCode = 403 // Forbidden - 认证失败
            throw attachAccountContext(error)
          }
        } else {
          const error = new Error(
            `Token expired and no refresh token available for account ${account.name}`
          )
          error.statusCode = 403 // Forbidden - 认证失败
          throw attachAccountContext(error)
        }
      }

      // 解密 accessToken（account.accessToken 是加密的）
      accessToken = openaiAccountService.decrypt(account.accessToken)
      if (!accessToken) {
        const error = new Error('Failed to decrypt OpenAI accessToken')
        error.statusCode = 403 // Forbidden - 配置/权限错误
        throw attachAccountContext(error)
      }

      // 解析代理配置
      if (account.proxy) {
        try {
          proxy = typeof account.proxy === 'string' ? JSON.parse(account.proxy) : account.proxy
        } catch (e) {
          logger.warn('Failed to parse proxy configuration:', e)
        }
      }

      logger.info(`Selected OpenAI account: ${account.name} (${result.accountId})`)
    }

    return {
      accessToken,
      accountId: result.accountId,
      accountName: account.name,
      accountType: result.accountType,
      proxy,
      account
    }
  } catch (error) {
    logger.error('Failed to get OpenAI auth token:', error)
    throw error
  }
}

// 主处理函数，供两个路由共享
const handleResponses = async (req, res) => {
  let upstream = null
  let accountId = null
  let accountType = 'openai'
  let sessionHash = null
  let account = null
  let proxy = null
  let accessToken = null

  try {
    // 从中间件获取 API Key 数据
    const apiKeyData = req.apiKey || {}

    if (!checkOpenAIPermissions(apiKeyData)) {
      logger.security(
        `🚫 API Key ${apiKeyData.id || 'unknown'} 缺少 OpenAI 权限，拒绝访问 ${req.originalUrl}`
      )
      return res.status(403).json({
        error: {
          message: 'This API key does not have permission to access OpenAI',
          type: 'permission_denied',
          code: 'permission_denied'
        }
      })
    }

    // 从请求头或请求体中提取会话 ID
    const stickySession = resolveOpenAIStickySessionContext(req, apiKeyData.id)
    const sessionId = stickySession.sessionId
    sessionHash = stickySession.sessionHash

    if (sessionHash && stickySession.source) {
      logger.debug(
        `OpenAI sticky session resolved from ${stickySession.source} (apiKeyScoped=${!!apiKeyData.id}): ${sessionHash.substring(0, 12)}...`
      )
    }

    const isChatCompletionsCompat = isChatCompletionsCompatMode(req)
    const originalRequestBody =
      req.body && typeof req.body === 'object' ? { ...req.body } : req.body

    // 从请求体中提取模型和流式标志
    let requestedModel = originalRequestBody?.model || null
    const isCodexModel =
      typeof requestedModel === 'string' && requestedModel.toLowerCase().includes('codex')

    // 如果模型是 gpt-5 开头且后面还有内容（如 gpt-5-2025-08-07），并且不是 Codex 系列，则覆盖为 gpt-5
    if (requestedModel && requestedModel.startsWith('gpt-5-') && !isCodexModel) {
      logger.info(`📝 Model ${requestedModel} detected, normalizing to gpt-5 for Codex API`)
      requestedModel = 'gpt-5'
      if (req.body && typeof req.body === 'object') {
        req.body.model = 'gpt-5' // 同时更新请求体中的模型
      }
      if (originalRequestBody && typeof originalRequestBody === 'object') {
        originalRequestBody.model = 'gpt-5'
      }
    }

    const clientWantsStream = isChatCompletionsCompat
      ? originalRequestBody?.stream === true
      : req.body?.stream !== false
    const upstreamUseStream = isChatCompletionsCompat ? true : clientWantsStream

    // 判断是否为 Codex CLI 的请求（基于 User-Agent）
    const userAgent = req.headers['user-agent'] || ''
    const codexCliPattern = /^(codex_vscode|codex_cli_rs)\/[\d.]+/i
    const isCodexCLI = codexCliPattern.test(userAgent)

    // 如果不是 Codex CLI 请求，则进行适配
    if (!isCodexCLI && !isChatCompletionsCompat) {
      // 移除不需要的请求体字段
      const fieldsToRemove = [
        'temperature',
        'top_p',
        'max_output_tokens',
        'user',
        'text_formatting',
        'truncation',
        'text',
        'service_tier'
      ]
      fieldsToRemove.forEach((field) => {
        delete req.body[field]
      })

      // 设置固定的 Codex CLI instructions
      req.body.instructions =
        "You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer.\n\n## General\n\n- When searching for text or files, prefer using `rg` or `rg --files` respectively because `rg` is much faster than alternatives like `grep`. (If the `rg` command is not found, then use alternatives.)\n\n## Editing constraints\n\n- Default to ASCII when editing or creating files. Only introduce non-ASCII or other Unicode characters when there is a clear justification and the file already uses them.\n- Add succinct code comments that explain what is going on if code is not self-explanatory. You should not add comments like \"Assigns the value to the variable\", but a brief comment might be useful ahead of a complex code block that the user would otherwise have to spend time parsing out. Usage of these comments should be rare.\n- Try to use apply_patch for single file edits, but it is fine to explore other options to make the edit if it does not work well. Do not use apply_patch for changes that are auto-generated (i.e. generating package.json or running a lint or format command like gofmt) or when scripting is more efficient (such as search and replacing a string across a codebase).\n- You may be in a dirty git worktree.\n    * NEVER revert existing changes you did not make unless explicitly requested, since these changes were made by the user.\n    * If asked to make a commit or code edits and there are unrelated changes to your work or changes that you didn't make in those files, don't revert those changes.\n    * If the changes are in files you've touched recently, you should read carefully and understand how you can work with the changes rather than reverting them.\n    * If the changes are in unrelated files, just ignore them and don't revert them.\n- Do not amend a commit unless explicitly requested to do so.\n- While you are working, you might notice unexpected changes that you didn't make. If this happens, STOP IMMEDIATELY and ask the user how they would like to proceed.\n- **NEVER** use destructive commands like `git reset --hard` or `git checkout --` unless specifically requested or approved by the user.\n\n## Plan tool\n\nWhen using the planning tool:\n- Skip using the planning tool for straightforward tasks (roughly the easiest 25%).\n- Do not make single-step plans.\n- When you made a plan, update it after having performed one of the sub-tasks that you shared on the plan.\n\n## Codex CLI harness, sandboxing, and approvals\n\nThe Codex CLI harness supports several different configurations for sandboxing and escalation approvals that the user can choose from.\n\nFilesystem sandboxing defines which files can be read or written. The options for `sandbox_mode` are:\n- **read-only**: The sandbox only permits reading files.\n- **workspace-write**: The sandbox permits reading files, and editing files in `cwd` and `writable_roots`. Editing files in other directories requires approval.\n- **danger-full-access**: No filesystem sandboxing - all commands are permitted.\n\nNetwork sandboxing defines whether network can be accessed without approval. Options for `network_access` are:\n- **restricted**: Requires approval\n- **enabled**: No approval needed\n\nApprovals are your mechanism to get user consent to run shell commands without the sandbox. Possible configuration options for `approval_policy` are\n- **untrusted**: The harness will escalate most commands for user approval, apart from a limited allowlist of safe \"read\" commands.\n- **on-failure**: The harness will allow all commands to run in the sandbox (if enabled), and failures will be escalated to the user for approval to run again without the sandbox.\n- **on-request**: Commands will be run in the sandbox by default, and you can specify in your tool call if you want to escalate a command to run without sandboxing. (Note that this mode is not always available. If it is, you'll see parameters for it in the `shell` command description.)\n- **never**: This is a non-interactive mode where you may NEVER ask the user for approval to run commands. Instead, you must always persist and work around constraints to solve the task for the user. You MUST do your utmost best to finish the task and validate your work before yielding. If this mode is paired with `danger-full-access`, take advantage of it to deliver the best outcome for the user. Further, in this mode, your default testing philosophy is overridden: Even if you don't see local patterns for testing, you may add tests and scripts to validate your work. Just remove them before yielding.\n\nWhen you are running with `approval_policy == on-request`, and sandboxing enabled, here are scenarios where you'll need to request approval:\n- You need to run a command that writes to a directory that requires it (e.g. running tests that write to /var)\n- You need to run a GUI app (e.g., open/xdg-open/osascript) to open browsers or files.\n- You are running sandboxed and need to run a command that requires network access (e.g. installing packages)\n- If you run a command that is important to solving the user's query, but it fails because of sandboxing, rerun the command with approval. ALWAYS proceed to use the `with_escalated_permissions` and `justification` parameters - do not message the user before requesting approval for the command.\n- You are about to take a potentially destructive action such as an `rm` or `git reset` that the user did not explicitly ask for\n- (for all of these, you should weigh alternative paths that do not require approval)\n\nWhen `sandbox_mode` is set to read-only, you'll need to request approval for any command that isn't a read.\n\nYou will be told what filesystem sandboxing, network sandboxing, and approval mode are active in a developer or user message. If you are not told about this, assume that you are running with workspace-write, network sandboxing enabled, and approval on-failure.\n\nAlthough they introduce friction to the user because your work is paused until the user responds, you should leverage them when necessary to accomplish important work. If the completing the task requires escalated permissions, Do not let these settings or the sandbox deter you from attempting to accomplish the user's task unless it is set to \"never\", in which case never ask for approvals.\n\nWhen requesting approval to execute a command that will require escalated privileges:\n  - Provide the `with_escalated_permissions` parameter with the boolean value true\n  - Include a short, 1 sentence explanation for why you need to enable `with_escalated_permissions` in the justification parameter\n\n## Special user requests\n\n- If the user makes a simple request (such as asking for the time) which you can fulfill by running a terminal command (such as `date`), you should do so.\n- If the user asks for a \"review\", default to a code review mindset: prioritise identifying bugs, risks, behavioural regressions, and missing tests. Findings must be the primary focus of the response - keep summaries or overviews brief and only after enumerating the issues. Present findings first (ordered by severity with file/line references), follow with open questions or assumptions, and offer a change-summary only as a secondary detail. If no findings are discovered, state that explicitly and mention any residual risks or testing gaps.\n\n## Frontend tasks\nWhen doing frontend design tasks, avoid collapsing into \"AI slop\" or safe, average-looking layouts.\nAim for interfaces that feel intentional, bold, and a bit surprising.\n- Typography: Use expressive, purposeful fonts and avoid default stacks (Inter, Roboto, Arial, system).\n- Color & Look: Choose a clear visual direction; define CSS variables; avoid purple-on-white defaults. No purple bias or dark mode bias.\n- Motion: Use a few meaningful animations (page-load, staggered reveals) instead of generic micro-motions.\n- Background: Don't rely on flat, single-color backgrounds; use gradients, shapes, or subtle patterns to build atmosphere.\n- Overall: Avoid boilerplate layouts and interchangeable UI patterns. Vary themes, type families, and visual languages across outputs.\n- Ensure the page loads properly on both desktop and mobile\n\nException: If working within an existing website or design system, preserve the established patterns, structure, and visual language.\n\n## Presenting your work and final message\n\nYou are producing plain text that will later be styled by the CLI. Follow these rules exactly. Formatting should make results easy to scan, but not feel mechanical. Use judgment to decide how much structure adds value.\n\n- Default: be very concise; friendly coding teammate tone.\n- Ask only when needed; suggest ideas; mirror the user's style.\n- For substantial work, summarize clearly; follow final‑answer formatting.\n- Skip heavy formatting for simple confirmations.\n- Don't dump large files you've written; reference paths only.\n- No \"save/copy this file\" - User is on the same machine.\n- Offer logical next steps (tests, commits, build) briefly; add verify steps if you couldn't do something.\n- For code changes:\n  * Lead with a quick explanation of the change, and then give more details on the context covering where and why a change was made. Do not start this explanation with \"summary\", just jump right in.\n  * If there are natural next steps the user may want to take, suggest them at the end of your response. Do not make suggestions if there are no natural next steps.\n  * When suggesting multiple options, use numeric lists for the suggestions so the user can quickly respond with a single number.\n- The user does not command execution outputs. When asked to show the output of a command (e.g. `git show`), relay the important details in your answer or summarize the key lines so the user understands the result.\n\n### Final answer structure and style guidelines\n\n- Plain text; CLI handles styling. Use structure only when it helps scanability.\n- Headers: optional; short Title Case (1-3 words) wrapped in **…**; no blank line before the first bullet; add only if they truly help.\n- Bullets: use - ; merge related points; keep to one line when possible; 4–6 per list ordered by importance; keep phrasing consistent.\n- Monospace: backticks for commands/paths/env vars/code ids and inline examples; use for literal keyword bullets; never combine with **.\n- Code samples or multi-line snippets should be wrapped in fenced code blocks; include an info string as often as possible.\n- Structure: group related bullets; order sections general → specific → supporting; for subsections, start with a bolded keyword bullet, then items; match complexity to the task.\n- Tone: collaborative, concise, factual; present tense, active voice; self‑contained; no \"above/below\"; parallel wording.\n- Don'ts: no nested bullets/hierarchies; no ANSI codes; don't cram unrelated keywords; keep keyword lists short—wrap/reformat if long; avoid naming formatting styles in answers.\n- Adaptation: code explanations → precise, structured with code refs; simple tasks → lead with outcome; big changes → logical walkthrough + rationale + next actions; casual one-offs → plain sentences, no headers/bullets.\n- File References: When referencing files in your response follow the below rules:\n  * Use inline code to make file paths clickable.\n  * Each reference should have a stand alone path. Even if it's the same file.\n  * Accepted: absolute, workspace‑relative, a/ or b/ diff prefixes, or bare filename/suffix.\n  * Optionally include line/column (1‑based): :line[:column] or #Lline[Ccolumn] (column defaults to 1).\n  * Do not use URIs like file://, vscode://, or https://.\n  * Do not provide range of lines\n  * Examples: src/app.ts, src/app.ts:42, b/server/index.js#L10, C:\\repo\\project\\main.rs:12:5\n"

      logger.info('📝 Non-Codex CLI request detected, applying Codex CLI adaptation')
    } else if (isChatCompletionsCompat) {
      logger.info('✅ Chat Completions compatibility mode enabled for OpenAI relay')
    } else {
      logger.info('✅ Codex CLI request detected, forwarding as-is')
    }

    // 使用调度器选择账户
    let shouldRetryWithAnotherAccount = false
    do {
      shouldRetryWithAnotherAccount = false
      ;({ accessToken, accountId, accountType, proxy, account } = await getOpenAIAuthToken(
        apiKeyData,
        sessionHash,
        requestedModel
      ))

      if (isChatCompletionsCompat) {
        req.body = convertChatCompletionsRequestToResponses(originalRequestBody || {})
        req.body.stream = true
        req._openaiCompatClientWantsStream = clientWantsStream
      }

      // 如果是 OpenAI-Responses 账户，使用专门的中继服务处理
      if (accountType === 'openai-responses') {
        logger.info(`🔀 Using OpenAI-Responses relay service for account: ${account.name}`)
        return await openaiResponsesRelayService.handleRequest(req, res, account, apiKeyData)
      }
      // 基于白名单构造上游所需的请求头，确保键为小写且值受控
      const incoming = req.headers || {}

      const allowedKeys = ['version', 'openai-beta', 'session_id']

      const headers = {}
      for (const key of allowedKeys) {
        if (incoming[key] !== undefined) {
          headers[key] = incoming[key]
        }
      }
      if (sessionId) {
        headers['session_id'] = sessionId
      }

      // 判断是否访问 compact 端点
      const isCompactRoute =
        req.path === '/responses/compact' ||
        req.path === '/v1/responses/compact' ||
        (req.originalUrl && req.originalUrl.includes('/responses/compact'))

      // 覆盖或新增必要头部
      headers['authorization'] = `Bearer ${accessToken}`
      headers['chatgpt-account-id'] = account.accountId || account.chatgptUserId || accountId
      headers['host'] = 'chatgpt.com'
      headers['accept'] = upstreamUseStream ? 'text/event-stream' : 'application/json'
      headers['content-type'] = 'application/json'
      if (!isCompactRoute) {
        req.body['store'] = false
      } else if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'store')) {
        delete req.body['store']
      }

      // 创建代理 agent
      const proxyAgent = createProxyAgent(proxy)

      // 配置请求选项
      const axiosConfig = {
        headers,
        timeout: config.requestTimeout || 600000,
        validateStatus: () => true
      }

      // 如果有代理，添加代理配置
      if (proxyAgent) {
        axiosConfig.httpAgent = proxyAgent
        axiosConfig.httpsAgent = proxyAgent
        axiosConfig.proxy = false
        logger.info(`🌐 Using proxy for OpenAI request: ${ProxyHelper.getProxyDescription(proxy)}`)
      } else {
        logger.debug('🌐 No proxy configured for OpenAI request')
      }

      const codexEndpoint = isCompactRoute
        ? 'https://chatgpt.com/backend-api/codex/responses/compact'
        : 'https://chatgpt.com/backend-api/codex/responses'

      // 根据 stream 参数决定请求类型
      if (upstreamUseStream) {
        // 流式请求
        upstream = await axios.post(codexEndpoint, req.body, {
          ...axiosConfig,
          responseType: 'stream'
        })
      } else {
        // 非流式请求
        upstream = await axios.post(codexEndpoint, req.body, axiosConfig)
      }

      const codexUsageSnapshot = extractCodexUsageHeaders(upstream.headers)
      if (codexUsageSnapshot) {
        try {
          await openaiAccountService.updateCodexUsageSnapshot(accountId, codexUsageSnapshot)
        } catch (codexError) {
          logger.error('⚠️ 更新 Codex 使用统计失败:', codexError)
        }
      }

      // 处理 429 限流错误
      if (upstream.status === 429) {
        logger.warn(`🚫 Rate limit detected for OpenAI account ${accountId} (Codex API)`)

        // 解析响应体中的限流信息
        let resetsInSeconds = null
        let errorData = null

        try {
          // 对于429错误，无论是否是流式请求，响应都会是完整的JSON错误对象
          if (upstreamUseStream && upstream.data) {
            // 流式响应需要先收集数据
            const chunks = []
            await new Promise((resolve, reject) => {
              upstream.data.on('data', (chunk) => chunks.push(chunk))
              upstream.data.on('end', resolve)
              upstream.data.on('error', reject)
              // 设置超时防止无限等待
              setTimeout(resolve, 5000)
            })

            const fullResponse = Buffer.concat(chunks).toString()
            try {
              errorData = JSON.parse(fullResponse)
            } catch (e) {
              logger.error('Failed to parse 429 error response:', e)
              logger.debug('Raw response:', fullResponse)
            }
          } else {
            // 非流式响应直接使用data
            errorData = upstream.data
          }

          // 提取重置时间
          if (errorData && errorData.error && errorData.error.resets_in_seconds) {
            resetsInSeconds = errorData.error.resets_in_seconds
            logger.info(
              `🕐 Codex rate limit will reset in ${resetsInSeconds} seconds (${Math.ceil(resetsInSeconds / 60)} minutes / ${Math.ceil(resetsInSeconds / 3600)} hours)`
            )
          } else {
            logger.warn(
              '⚠️ Could not extract resets_in_seconds from 429 response, using default 60 minutes'
            )
          }
        } catch (e) {
          logger.error('⚠️ Failed to parse rate limit error:', e)
        }

        // 标记账户为限流状态
        await unifiedOpenAIScheduler.markAccountRateLimited(
          accountId,
          'openai',
          sessionHash,
          resetsInSeconds
        )

        // 返回错误响应给客户端
        const errorResponse = errorData || {
          error: {
            type: 'usage_limit_reached',
            message: 'The usage limit has been reached',
            resets_in_seconds: resetsInSeconds
          }
        }

        if (upstreamUseStream) {
          // 流式响应也需要设置正确的状态码
          res.status(429)
          res.setHeader('Content-Type', 'text/event-stream')
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('Connection', 'keep-alive')
          res.write(`data: ${JSON.stringify(errorResponse)}\n\n`)
          res.end()
        } else {
          res.status(429).json(errorResponse)
        }

        return
      } else if (upstream.status === 401 || upstream.status === 402 || upstream.status === 403) {
        const unauthorizedStatus = upstream.status
        const statusDescription =
          unauthorizedStatus === 401
            ? 'Unauthorized'
            : unauthorizedStatus === 402
              ? 'Payment required'
              : 'Forbidden'
        logger.warn(
          `Auth ${statusDescription} error detected for OpenAI account ${accountId} (Codex API)`
        )

        let errorData = null

        try {
          if (upstreamUseStream && upstream.data && typeof upstream.data.on === 'function') {
            const chunks = []
            await new Promise((resolve, reject) => {
              upstream.data.on('data', (chunk) => chunks.push(chunk))
              upstream.data.on('end', resolve)
              upstream.data.on('error', reject)
              setTimeout(resolve, 5000)
            })

            const fullResponse = Buffer.concat(chunks).toString()
            try {
              errorData = JSON.parse(fullResponse)
            } catch (parseError) {
              logger.error(`Failed to parse ${unauthorizedStatus} error response:`, parseError)
              logger.debug(`Raw ${unauthorizedStatus} response:`, fullResponse)
              errorData = {
                error: {
                  message:
                    fullResponse ||
                    (unauthorizedStatus === 403
                      ? 'Forbidden'
                      : unauthorizedStatus === 402
                        ? 'Payment required'
                        : 'Unauthorized')
                }
              }
            }
          } else {
            errorData = upstream.data
          }
        } catch (parseError) {
          logger.error(`Failed to handle ${unauthorizedStatus} error response:`, parseError)
        }

        const statusLabel =
          unauthorizedStatus === 401 ? '401' : unauthorizedStatus === 402 ? '402' : '403'
        const extraHint = unauthorizedStatus === 402 ? ' (payment required)' : ''
        let reason = `OpenAI authentication failed (${statusLabel}${extraHint})`
        if (errorData) {
          const messageCandidate =
            errorData.error &&
            typeof errorData.error.message === 'string' &&
            errorData.error.message.trim()
              ? errorData.error.message.trim()
              : typeof errorData.message === 'string' && errorData.message.trim()
                ? errorData.message.trim()
                : null
          if (messageCandidate) {
            reason = `OpenAI authentication failed (${statusLabel}${extraHint}): ${messageCandidate}`
          }
        }

        // 先尝试重试（换其他账户），只有重试耗尽后才标记 unauthorized
        // 避免单次 401（可能是临时性的）就永久禁用账户
        if (
          tryConsumeOpenAIAuthRetry(req, unauthorizedStatus, accountId, accountType || 'openai')
        ) {
          shouldRetryWithAnotherAccount = true
          continue
        }

        // 重试耗尽，标记账户为 unauthorized
        try {
          await unifiedOpenAIScheduler.markAccountUnauthorized(
            accountId,
            accountType || 'openai',
            sessionHash,
            reason
          )
        } catch (markError) {
          logger.error(
            `Failed to mark OpenAI account unauthorized after ${unauthorizedStatus}:`,
            markError
          )
        }

        let errorResponse = errorData
        if (!errorResponse || typeof errorResponse !== 'object' || Buffer.isBuffer(errorResponse)) {
          const fallbackMessage =
            typeof errorData === 'string' && errorData.trim()
              ? errorData.trim()
              : unauthorizedStatus === 403
                ? 'Forbidden'
                : unauthorizedStatus === 402
                  ? 'Payment required'
                  : 'Unauthorized'
          errorResponse = {
            error: {
              message: fallbackMessage,
              type:
                unauthorizedStatus === 403
                  ? 'forbidden'
                  : unauthorizedStatus === 402
                    ? 'payment_required'
                    : 'unauthorized',
              code:
                unauthorizedStatus === 403
                  ? 'forbidden'
                  : unauthorizedStatus === 402
                    ? 'payment_required'
                    : 'unauthorized'
            }
          }
        }

        res.status(unauthorizedStatus).json(errorResponse)
        return
      } else if (upstream.status === 200 || upstream.status === 201) {
        // 请求成功，检查并移除限流状态
        const isRateLimited = await unifiedOpenAIScheduler.isAccountRateLimited(accountId)
        if (isRateLimited) {
          logger.info(
            `✅ Removing rate limit for OpenAI account ${accountId} after successful request`
          )
          await unifiedOpenAIScheduler.removeAccountRateLimit(accountId, 'openai')
        }
      }
    } while (shouldRetryWithAnotherAccount)

    if (upstream.status >= 400) {
      let errorResponse = upstream.data

      if (upstreamUseStream && upstream.data && typeof upstream.data.on === 'function') {
        const rawBody = await readStreamBodyToString(upstream.data, 8000)
        errorResponse = parseErrorPayloadFromRaw(
          rawBody,
          `Upstream request failed (${upstream.status})`
        )
      } else if (Buffer.isBuffer(errorResponse)) {
        errorResponse = parseErrorPayloadFromRaw(
          errorResponse.toString(),
          `Upstream request failed (${upstream.status})`
        )
      } else if (typeof errorResponse === 'string') {
        errorResponse = parseErrorPayloadFromRaw(
          errorResponse,
          `Upstream request failed (${upstream.status})`
        )
      } else if (!errorResponse || typeof errorResponse !== 'object') {
        errorResponse = {
          error: {
            message: `Upstream request failed (${upstream.status})`
          }
        }
      }

      res.status(upstream.status).json(errorResponse)
      return
    }

    res.status(upstream.status)

    if (clientWantsStream) {
      // 流式响应头
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
    } else {
      // 非流式响应头
      res.setHeader('Content-Type', 'application/json')
    }

    // 透传关键诊断头，避免传递不安全或与传输相关的头
    const passThroughHeaderKeys = ['openai-version', 'x-request-id', 'openai-processing-ms']
    for (const key of passThroughHeaderKeys) {
      const val = upstream.headers?.[key]
      if (val !== undefined) {
        res.setHeader(key, val)
      }
    }

    if (clientWantsStream) {
      // 立即刷新响应头，开始 SSE
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders()
      }
    }

    // 处理响应并捕获 usage 数据和真实的 model
    let buffer = ''
    let usageData = null
    let actualModel = null
    let usageReported = false
    let rateLimitDetected = false
    let rateLimitResetsInSeconds = null

    if (!clientWantsStream) {
      // 非流式响应处理
      try {
        logger.info(`📄 Processing OpenAI non-stream response for model: ${requestedModel}`)

        // 直接获取完整响应
        let responseData = upstream.data
        if (upstreamUseStream && upstream.data && typeof upstream.data.on === 'function') {
          const {
            completedResponse,
            text,
            usageData: streamUsageData,
            model: streamModel
          } = await collectResponsesStreamResult(upstream.data)

          if (completedResponse && typeof completedResponse === 'object') {
            responseData = completedResponse
          } else {
            const fallbackModel = streamModel || requestedModel || 'gpt-4'
            responseData = {
              id: `resp_${Date.now()}`,
              object: 'response',
              model: fallbackModel,
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
              usage: streamUsageData || null
            }
          }
        }

        // 从响应中获取实际的 model 和 usage
        actualModel =
          responseData.model || responseData.response?.model || requestedModel || 'gpt-4'
        usageData = responseData.usage || responseData.response?.usage

        logger.debug(`📊 Non-stream response - Model: ${actualModel}, Usage:`, usageData)

        // 记录使用统计
        if (usageData) {
          const totalInputTokens = usageData.input_tokens || usageData.prompt_tokens || 0
          const outputTokens = usageData.output_tokens || usageData.completion_tokens || 0
          const cacheReadTokens =
            usageData.input_tokens_details?.cached_tokens ||
            usageData.prompt_tokens_details?.cached_tokens ||
            0
          const cacheCreateTokens = extractCacheCreationTokens(usageData)
          // 计算实际输入token（总输入减去缓存部分）
          const actualInputTokens = Math.max(0, totalInputTokens - cacheReadTokens)

          await apiKeyService.recordUsage(
            apiKeyData.id,
            actualInputTokens, // 传递实际输入（不含缓存）
            outputTokens,
            cacheCreateTokens,
            cacheReadTokens,
            actualModel,
            accountId
          )

          logger.info(
            `📊 Recorded OpenAI non-stream usage - Input: ${totalInputTokens}(actual:${actualInputTokens}+cached:${cacheReadTokens}), CacheCreate: ${cacheCreateTokens}, Output: ${outputTokens}, Total: ${usageData.total_tokens || totalInputTokens + outputTokens + cacheCreateTokens}, Model: ${actualModel}`
          )

          await applyRateLimitTracking(
            req,
            {
              inputTokens: actualInputTokens,
              outputTokens,
              cacheCreateTokens,
              cacheReadTokens
            },
            actualModel,
            'openai-non-stream'
          )
        }

        // 返回响应
        if (isChatCompletionsCompat) {
          const chatCompletionResponse = buildChatCompletionResponse(
            responseData,
            actualModel || requestedModel,
            usageData
          )
          res.json(chatCompletionResponse)
        } else {
          res.json(responseData)
        }
        return
      } catch (error) {
        logger.error('Failed to process non-stream response:', error)
        if (!res.headersSent) {
          res.status(500).json({ error: { message: 'Failed to process response' } })
        }
        return
      }
    }

    // 解析 SSE 事件以捕获 usage 数据和 model
    const heartbeatIntervalMs = await getOpenAIStreamHeartbeatIntervalMs()
    let heartbeatTimer = null
    let lastDataAt = Date.now()
    let streamFinalized = false

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    }

    const sendHeartbeat = () => {
      if (!isWritableSSEStream(res)) {
        stopHeartbeat()
        return
      }

      if (Date.now() - lastDataAt < heartbeatIntervalMs) {
        return
      }

      try {
        res.write(': keep-alive\n\n')
      } catch (heartbeatError) {
        logger.warn('Failed to send OpenAI SSE heartbeat:', heartbeatError.message)
        stopHeartbeat()
      }
    }

    heartbeatTimer = setInterval(sendHeartbeat, heartbeatIntervalMs)
    if (typeof heartbeatTimer.unref === 'function') {
      heartbeatTimer.unref()
    }

    const chatCompatStreamId = isChatCompletionsCompat ? getChatCompletionsStreamId() : null
    let chatCompatInitialChunkSent = false
    let chatCompatFinalChunkSent = false
    let chatCompatDoneSent = false
    let chatCompatCompletedResponse = null

    const sendChatCompatInitialChunk = () => {
      if (!isChatCompletionsCompat || chatCompatInitialChunkSent || !isWritableSSEStream(res)) {
        return
      }

      const chunk = createChatCompletionChunk({
        id: chatCompatStreamId,
        model: actualModel || requestedModel || 'gpt-4',
        delta: { role: 'assistant' },
        finishReason: null
      })

      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      chatCompatInitialChunkSent = true
    }

    const sendChatCompatDeltaChunk = (deltaText) => {
      if (!isChatCompletionsCompat || !deltaText || !isWritableSSEStream(res)) {
        return
      }

      sendChatCompatInitialChunk()
      const chunk = createChatCompletionChunk({
        id: chatCompatStreamId,
        model: actualModel || requestedModel || 'gpt-4',
        delta: { content: deltaText },
        finishReason: null
      })
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
    }

    const sendChatCompatFinalChunk = (usageOverride = null) => {
      if (!isChatCompletionsCompat || chatCompatFinalChunkSent || !isWritableSSEStream(res)) {
        return
      }

      sendChatCompatInitialChunk()

      const responsePayload =
        chatCompatCompletedResponse ||
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

      const chunk = createChatCompletionChunk({
        id: chatCompatStreamId,
        model: responsePayload.model || actualModel || requestedModel || 'gpt-4',
        delta,
        finishReason,
        usage
      })

      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      chatCompatFinalChunkSent = true
    }

    const sendChatCompatDone = () => {
      if (!isChatCompletionsCompat || chatCompatDoneSent || !isWritableSSEStream(res)) {
        return
      }

      res.write('data: [DONE]\n\n')
      chatCompatDoneSent = true
    }

    const forwardChatCompatEventBlock = (eventBlock) => {
      if (!isChatCompletionsCompat) {
        return
      }

      const lines = eventBlock.split('\n')
      for (const line of lines) {
        if (!line.startsWith('data: ')) {
          continue
        }

        const jsonPayload = line.slice(6).trim()
        if (!jsonPayload) {
          continue
        }

        if (jsonPayload === '[DONE]') {
          continue
        }

        try {
          const eventData = JSON.parse(jsonPayload)
          const deltaText = extractCodexDeltaFromEventData(eventData)
          if (deltaText) {
            sendChatCompatDeltaChunk(deltaText)
          }

          if (eventData.type === 'response.completed' && eventData.response) {
            chatCompatCompletedResponse = eventData.response
            if (eventData.response.model) {
              actualModel = eventData.response.model
            }
            if (eventData.response.usage) {
              usageData = eventData.response.usage
            }
            sendChatCompatFinalChunk(eventData.response.usage || null)
            sendChatCompatDone()
          }
        } catch (_) {
          // 忽略解析错误
        }
      }
    }

    const parseSSEForUsage = (data) => {
      const lines = data.split('\n')

      for (const line of lines) {
        if (line.startsWith('event: response.completed')) {
          // 下一行应该是数据
          continue
        }

        if (line.startsWith('data: ')) {
          try {
            const jsonStr = line.slice(6) // 移除 'data: ' 前缀
            const eventData = JSON.parse(jsonStr)

            // 检查是否是 response.completed 事件
            if (eventData.type === 'response.completed' && eventData.response) {
              // 从响应中获取真实的 model
              if (eventData.response.model) {
                actualModel = eventData.response.model
                logger.debug(`📊 Captured actual model: ${actualModel}`)
              }

              // 获取 usage 数据
              if (eventData.response.usage) {
                usageData = eventData.response.usage
                logger.debug('📊 Captured OpenAI usage data:', usageData)
              }
            }

            // 检查是否有限流错误
            if (eventData.error && eventData.error.type === 'usage_limit_reached') {
              rateLimitDetected = true
              if (eventData.error.resets_in_seconds) {
                rateLimitResetsInSeconds = eventData.error.resets_in_seconds
                logger.warn(
                  `🚫 Rate limit detected in stream, resets in ${rateLimitResetsInSeconds} seconds`
                )
              }
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

    if (isChatCompletionsCompat) {
      sendChatCompatInitialChunk()
    }

    upstream.data.on('data', (chunk) => {
      try {
        lastDataAt = Date.now()
        const chunkStr = chunk.toString()

        // 转发数据给客户端
        if (!isChatCompletionsCompat && !res.destroyed) {
          res.write(chunk)
        }

        // 同时解析数据以捕获 usage 信息
        buffer += chunkStr

        // 处理完整的 SSE 事件
        if (buffer.includes('\n\n')) {
          const events = buffer.split('\n\n')
          buffer = events.pop() || '' // 保留最后一个可能不完整的事件

          for (const event of events) {
            if (event.trim()) {
              parseSSEForUsage(event)
              forwardChatCompatEventBlock(event)
            }
          }
        }
      } catch (error) {
        logger.error('Error processing OpenAI stream chunk:', error)
      }
    })

    upstream.data.on('end', async () => {
      if (streamFinalized) {
        return
      }
      streamFinalized = true
      stopHeartbeat()
      // 处理剩余的 buffer
      if (buffer.trim()) {
        parseSSEForUsage(buffer)
        forwardChatCompatEventBlock(buffer)
      }

      // 记录使用统计
      if (!usageReported && usageData) {
        try {
          const totalInputTokens = usageData.input_tokens || usageData.prompt_tokens || 0
          const outputTokens = usageData.output_tokens || usageData.completion_tokens || 0
          const cacheReadTokens =
            usageData.input_tokens_details?.cached_tokens ||
            usageData.prompt_tokens_details?.cached_tokens ||
            0
          const cacheCreateTokens = extractCacheCreationTokens(usageData)
          // 计算实际输入token（总输入减去缓存部分）
          const actualInputTokens = Math.max(0, totalInputTokens - cacheReadTokens)

          // 使用响应中的真实 model，如果没有则使用请求中的 model，最后回退到默认值
          const modelToRecord = actualModel || requestedModel || 'gpt-4'

          await apiKeyService.recordUsage(
            apiKeyData.id,
            actualInputTokens, // 传递实际输入（不含缓存）
            outputTokens,
            cacheCreateTokens,
            cacheReadTokens,
            modelToRecord,
            accountId
          )

          logger.info(
            `📊 Recorded OpenAI usage - Input: ${totalInputTokens}(actual:${actualInputTokens}+cached:${cacheReadTokens}), CacheCreate: ${cacheCreateTokens}, Output: ${outputTokens}, Total: ${usageData.total_tokens || totalInputTokens + outputTokens + cacheCreateTokens}, Model: ${modelToRecord} (actual: ${actualModel}, requested: ${requestedModel})`
          )
          usageReported = true

          await applyRateLimitTracking(
            req,
            {
              inputTokens: actualInputTokens,
              outputTokens,
              cacheCreateTokens,
              cacheReadTokens
            },
            modelToRecord,
            'openai-stream'
          )
        } catch (error) {
          logger.error('Failed to record OpenAI usage:', error)
        }
      }

      // 如果在流式响应中检测到限流
      if (rateLimitDetected) {
        logger.warn(`🚫 Processing rate limit for OpenAI account ${accountId} from stream`)
        await unifiedOpenAIScheduler.markAccountRateLimited(
          accountId,
          'openai',
          sessionHash,
          rateLimitResetsInSeconds
        )
      } else if (upstream.status === 200) {
        // 流式请求成功，检查并移除限流状态
        const isRateLimited = await unifiedOpenAIScheduler.isAccountRateLimited(accountId)
        if (isRateLimited) {
          logger.info(
            `✅ Removing rate limit for OpenAI account ${accountId} after successful stream`
          )
          await unifiedOpenAIScheduler.removeAccountRateLimit(accountId, 'openai')
        }
      }

      if (isChatCompletionsCompat) {
        sendChatCompatFinalChunk(usageData)
        sendChatCompatDone()
      }

      if (isWritableSSEStream(res)) {
        res.end()
      }
    })

    upstream.data.on('error', (err) => {
      if (streamFinalized) {
        return
      }
      streamFinalized = true

      logger.error('Upstream stream error:', err)
      stopHeartbeat()

      const interruptionReason = resolveStreamInterruptionReasonFromError(
        err,
        STREAM_INTERRUPTION_REASONS.UPSTREAM_STREAM_ERROR
      )
      recordStreamInterruption(redis, interruptionReason, 'openai')

      if (!res.headersSent) {
        res.status(502).json({ error: { message: err?.message || 'Upstream stream error' } })
        return
      }

      if (isChatCompletionsCompat && isWritableSSEStream(res)) {
        const errorPayload = {
          error: {
            message: err?.message || 'Upstream stream error',
            type: 'stream_error',
            code: interruptionReason
          }
        }
        res.write(`data: ${JSON.stringify(errorPayload)}\n\n`)
        sendChatCompatDone()
      } else {
        sendOpenAIStreamErrorEvent(res, err, interruptionReason)
      }
      if (isWritableSSEStream(res)) {
        res.end()
      }
    })

    // 客户端断开时清理上游流
    const cleanup = () => {
      if (streamFinalized) {
        return
      }
      streamFinalized = true

      stopHeartbeat()
      recordStreamInterruption(redis, STREAM_INTERRUPTION_REASONS.CLIENT_ABORT, 'openai')

      try {
        upstream.data?.unpipe?.(res)
        upstream.data?.destroy?.()
      } catch (_) {
        //
      }
    }
    req.on('close', cleanup)
    req.on('aborted', cleanup)
  } catch (error) {
    logger.error('Proxy to ChatGPT codex/responses failed:', error)
    // 优先使用主动设置的 statusCode，然后是上游响应的状态码，最后默认 500
    const status = error.statusCode || error.response?.status || 500

    const failedAccountId = accountId || error.accountId || null
    const failedAccountType = accountType || error.accountType || 'openai'

    if ((status === 401 || status === 402 || status === 403) && failedAccountId) {
      const statusLabel = status === 401 ? '401' : status === 402 ? '402' : '403'
      const extraHint = status === 402 ? ' (payment required)' : ''
      let reason = `OpenAI authentication failed (${statusLabel}${extraHint})`
      const errorData = error.response?.data
      if (errorData) {
        if (typeof errorData === 'string' && errorData.trim()) {
          reason = `OpenAI authentication failed (${statusLabel}${extraHint}): ${errorData.trim()}`
        } else if (
          errorData.error &&
          typeof errorData.error.message === 'string' &&
          errorData.error.message.trim()
        ) {
          reason = `OpenAI authentication failed (${statusLabel}${extraHint}): ${errorData.error.message.trim()}`
        } else if (typeof errorData.message === 'string' && errorData.message.trim()) {
          reason = `OpenAI authentication failed (${statusLabel}${extraHint}): ${errorData.message.trim()}`
        }
      } else if (error.message) {
        reason = `OpenAI authentication failed (${statusLabel}${extraHint}): ${error.message}`
      }

      // 先尝试重试（换其他账户），只有重试耗尽后才标记 unauthorized
      if (
        !res.headersSent &&
        tryConsumeOpenAIAuthRetry(req, status, failedAccountId, failedAccountType)
      ) {
        return handleResponses(req, res)
      }

      // 重试耗尽，标记账户为 unauthorized
      try {
        await unifiedOpenAIScheduler.markAccountUnauthorized(
          failedAccountId,
          failedAccountType,
          sessionHash,
          reason
        )
      } catch (markError) {
        logger.error('Failed to mark OpenAI account unauthorized in catch handler:', markError)
      }
    }

    let responsePayload = error.response?.data
    if (!responsePayload) {
      responsePayload = { error: { message: error.message || 'Internal server error' } }
    } else if (typeof responsePayload === 'string') {
      responsePayload = { error: { message: responsePayload } }
    } else if (typeof responsePayload === 'object' && !responsePayload.error) {
      responsePayload = {
        error: { message: responsePayload.message || error.message || 'Internal server error' }
      }
    }

    if (!res.headersSent) {
      res.status(status).json(responsePayload)
    }
  }
}

// 注册两个路由路径，都使用相同的处理函数
router.post('/responses', authenticateApiKey, handleResponses)
router.post('/v1/responses', authenticateApiKey, handleResponses)
router.post('/responses/compact', authenticateApiKey, handleResponses)
router.post('/v1/responses/compact', authenticateApiKey, handleResponses)

// 使用情况统计端点
router.get('/usage', authenticateApiKey, async (req, res) => {
  try {
    const { usage } = req.apiKey

    res.json({
      object: 'usage',
      total_tokens: usage.total.tokens,
      total_requests: usage.total.requests,
      daily_tokens: usage.daily.tokens,
      daily_requests: usage.daily.requests,
      monthly_tokens: usage.monthly.tokens,
      monthly_requests: usage.monthly.requests
    })
  } catch (error) {
    logger.error('Failed to get usage stats:', error)
    res.status(500).json({
      error: {
        message: 'Failed to retrieve usage statistics',
        type: 'api_error'
      }
    })
  }
})

// API Key 信息端点
router.get('/key-info', authenticateApiKey, async (req, res) => {
  try {
    const keyData = req.apiKey
    res.json({
      id: keyData.id,
      name: keyData.name,
      description: keyData.description,
      permissions: keyData.permissions || 'all',
      token_limit: keyData.tokenLimit,
      tokens_used: keyData.usage.total.tokens,
      tokens_remaining:
        keyData.tokenLimit > 0
          ? Math.max(0, keyData.tokenLimit - keyData.usage.total.tokens)
          : null,
      rate_limit: {
        window: keyData.rateLimitWindow,
        requests: keyData.rateLimitRequests
      },
      usage: {
        total: keyData.usage.total,
        daily: keyData.usage.daily,
        monthly: keyData.usage.monthly
      }
    })
  } catch (error) {
    logger.error('Failed to get key info:', error)
    res.status(500).json({
      error: {
        message: 'Failed to retrieve API key information',
        type: 'api_error'
      }
    })
  }
})

module.exports = router
module.exports.handleResponses = handleResponses
