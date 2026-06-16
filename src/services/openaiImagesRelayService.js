const axios = require('axios')
const crypto = require('crypto')
const { Readable } = require('stream')
const FormData = require('form-data')
const config = require('../../config/config')
const logger = require('../utils/logger')
const ProxyHelper = require('../utils/proxyHelper')
const apiKeyService = require('./apiKeyService')
const openaiAccountService = require('./openaiAccountService')
const openaiResponsesAccountService = require('./openaiResponsesAccountService')
const unifiedOpenAIScheduler = require('./unifiedOpenAIScheduler')
const { filterForOpenAI } = require('../utils/headerFilter')
const { updateRateLimitCounters } = require('../utils/rateLimitHelper')

const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
const CODEX_IMAGE_MAIN_MODEL = 'gpt-5.4-mini'
const CODEX_RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'
const CODEX_IMAGE_USER_AGENT = 'codex_cli_rs/0.118.0 (Mac OS 26.3.1; arm64) iTerm.app/3.6.9'
const CODEX_IMAGE_ORIGINATOR = 'codex_cli_rs'
const DEFAULT_CODEX_IMAGE_MAX_COUNT = 10
const DEFAULT_CODEX_IMAGE_PARALLELISM = 2
const DEFAULT_CODEX_IMAGE_RETRIES = 1
function isWritableResponse(res) {
  return !!res && !res.destroyed && !res.writableEnded && !res.socket?.destroyed
}

function parseJsonSafely(value) {
  if (!value || typeof value !== 'string') {
    return null
  }
  try {
    return JSON.parse(value)
  } catch (_) {
    return null
  }
}

function mimeTypeFromOutputFormat(outputFormat) {
  const normalized = String(outputFormat || '')
    .trim()
    .toLowerCase()
  if (normalized.includes('/')) {
    return normalized
  }
  if (normalized === 'jpg' || normalized === 'jpeg') {
    return 'image/jpeg'
  }
  if (normalized === 'webp') {
    return 'image/webp'
  }
  return 'image/png'
}

function normalizeImageResponseFormat(responseFormat) {
  return String(responseFormat || '')
    .trim()
    .toLowerCase() === 'url'
    ? 'url'
    : 'b64_json'
}

function toBool(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value
  }
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
  if (!normalized) {
    return fallback
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }
  return fallback
}

function toInteger(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getPositiveIntegerConfig(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = toInteger(value, fallback)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }
  return Math.max(1, Math.min(parsed, max))
}

function getNonNegativeIntegerConfig(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = toInteger(value, fallback)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }
  return Math.max(0, Math.min(parsed, max))
}

function getCodexImageMaxCount() {
  return getPositiveIntegerConfig(
    config.openaiImages?.maxCodexN ?? process.env.OPENAI_IMAGES_MAX_CODEX_N,
    DEFAULT_CODEX_IMAGE_MAX_COUNT,
    10
  )
}

function getCodexImageParallelism() {
  return getPositiveIntegerConfig(
    config.openaiImages?.codexParallelism ?? process.env.OPENAI_IMAGES_CODEX_PARALLELISM,
    DEFAULT_CODEX_IMAGE_PARALLELISM,
    getCodexImageMaxCount()
  )
}

function getCodexImageRetryCount() {
  return getNonNegativeIntegerConfig(
    config.openaiImages?.codexRetries ?? process.env.OPENAI_IMAGES_CODEX_RETRIES,
    DEFAULT_CODEX_IMAGE_RETRIES,
    3
  )
}

function parseCodexImageCount(value) {
  if (value === undefined || value === null || value === '') {
    return 1
  }

  const parsed = Number(value)
  const maxCount = getCodexImageMaxCount()
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxCount) {
    const error = new Error(`n must be an integer between 1 and ${maxCount}`)
    error.statusCode = 400
    error.response = {
      status: 400,
      data: {
        error: {
          message: error.message,
          type: 'invalid_request_error',
          param: 'n'
        }
      }
    }
    throw error
  }

  return parsed
}

function getFirstFormValue(formData, key) {
  const value = formData.get(key)
  if (value === null || value === undefined || typeof value === 'object') {
    return ''
  }
  return String(value).trim()
}

function getAllFiles(formData, key) {
  return formData.getAll(key).filter((value) => value && typeof value.arrayBuffer === 'function')
}

function normalizeCodexImageToolModel(model) {
  const requested = String(model || DEFAULT_IMAGE_MODEL).trim() || DEFAULT_IMAGE_MODEL
  if (requested === DEFAULT_IMAGE_MODEL) {
    return requested
  }

  logger.warn(`OpenAI OAuth image model ${requested} is mapped to ${DEFAULT_IMAGE_MODEL}`)
  return DEFAULT_IMAGE_MODEL
}

async function fileToDataUrl(file) {
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const mimeType = file.type || 'application/octet-stream'
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

function getContentType(req) {
  return String(req.headers?.['content-type'] || '').trim()
}

function writeUpstreamHeaders(res, upstreamHeaders = {}) {
  const allowed = [
    'openai-version',
    'x-request-id',
    'openai-processing-ms',
    'x-ratelimit-limit-requests',
    'x-ratelimit-remaining-requests',
    'x-ratelimit-reset-requests',
    'x-ratelimit-limit-tokens',
    'x-ratelimit-remaining-tokens',
    'x-ratelimit-reset-tokens'
  ]

  for (const key of allowed) {
    const value = upstreamHeaders[key]
    if (value !== undefined) {
      res.setHeader(key, value)
    }
  }
}

function buildCodexImageHeaders(req, account, context, accessToken) {
  const incoming = req.headers || {}
  const headers = {
    authorization: `Bearer ${accessToken}`,
    'chatgpt-account-id': account.accountId || account.chatgptUserId || context.accountId,
    host: 'chatgpt.com',
    accept: 'text/event-stream',
    'content-type': 'application/json',
    connection: 'Keep-Alive',
    'user-agent': incoming['user-agent']?.includes('codex_cli_rs')
      ? incoming['user-agent']
      : CODEX_IMAGE_USER_AGENT,
    originator: incoming.originator || CODEX_IMAGE_ORIGINATOR,
    Session_id: incoming.session_id || incoming['session-id'] || crypto.randomUUID()
  }

  for (const key of ['version', 'x-codex-beta-features', 'x-codex-turn-metadata']) {
    if (incoming[key]) {
      headers[key] = incoming[key]
    }
  }

  if (incoming['x-client-request-id']) {
    headers['x-client-request-id'] = incoming['x-client-request-id']
  }

  return headers
}

async function applyRateLimitTracking(req, usageSummary, model, context = '') {
  if (!req.rateLimitInfo) {
    return
  }

  try {
    await updateRateLimitCounters(req.rateLimitInfo, usageSummary, model)
  } catch (error) {
    logger.error(`❌ Failed to update image rate limit counters${context}:`, error)
  }
}

async function recordUsageFromUsageData({
  apiKeyData,
  accountId,
  usageData,
  model,
  req,
  context = 'openai-image'
}) {
  if (!usageData || typeof usageData !== 'object' || !apiKeyData?.id) {
    return
  }

  const totalInputTokens = Number(usageData.input_tokens || usageData.prompt_tokens || 0) || 0
  const outputTokens = Number(usageData.output_tokens || usageData.completion_tokens || 0) || 0
  const cacheReadTokens =
    Number(
      usageData.input_tokens_details?.cached_tokens ||
        usageData.prompt_tokens_details?.cached_tokens ||
        usageData.cache_read_input_tokens ||
        0
    ) || 0
  const cacheCreateTokens =
    Number(
      usageData.input_tokens_details?.cache_creation_tokens ||
        usageData.input_tokens_details?.cache_creation_input_tokens ||
        usageData.prompt_tokens_details?.cache_creation_tokens ||
        usageData.cache_creation_input_tokens ||
        usageData.cache_creation_tokens ||
        0
    ) || 0
  const actualInputTokens = Math.max(0, totalInputTokens - cacheReadTokens)
  const modelToRecord = model || DEFAULT_IMAGE_MODEL

  await apiKeyService.recordUsage(
    apiKeyData.id,
    actualInputTokens,
    outputTokens,
    cacheCreateTokens,
    cacheReadTokens,
    modelToRecord,
    accountId
  )

  await applyRateLimitTracking(
    req,
    {
      inputTokens: actualInputTokens,
      outputTokens,
      cacheCreateTokens,
      cacheReadTokens
    },
    modelToRecord,
    ` (${context})`
  )

  logger.info(
    `📊 Recorded OpenAI image usage - Input: ${totalInputTokens}(actual:${actualInputTokens}+cached:${cacheReadTokens}), CacheCreate: ${cacheCreateTokens}, Output: ${outputTokens}, Model: ${modelToRecord}`
  )
}

function createImageTool(source = {}, action = 'generate', routeModel = DEFAULT_IMAGE_MODEL) {
  const model = normalizeCodexImageToolModel(source.model || routeModel)
  const tool = {
    type: 'image_generation',
    action,
    model
  }

  const stringFields =
    action === 'edit'
      ? ['size', 'quality', 'background', 'output_format', 'input_fidelity', 'moderation']
      : ['size', 'quality', 'background', 'output_format', 'moderation']
  for (const field of stringFields) {
    if (source[field] !== undefined && source[field] !== null && String(source[field]).trim()) {
      tool[field] = String(source[field]).trim()
    }
  }

  for (const field of ['output_compression', 'partial_images']) {
    const parsed = toInteger(source[field], null)
    if (parsed !== null) {
      tool[field] = parsed
    }
  }

  return tool
}

function buildImagesResponsesRequest(prompt, images, tool, mainModel = CODEX_IMAGE_MAIN_MODEL) {
  const content = [{ type: 'input_text', text: prompt || '' }]
  for (const image of images || []) {
    if (typeof image === 'string' && image.trim()) {
      content.push({ type: 'input_image', image_url: image.trim() })
    }
  }

  return {
    instructions: '',
    stream: true,
    reasoning: {
      effort: 'medium',
      summary: 'auto'
    },
    parallel_tool_calls: true,
    include: ['reasoning.encrypted_content'],
    model: mainModel,
    store: false,
    tool_choice: { type: 'image_generation' },
    input: [
      {
        type: 'message',
        role: 'user',
        content
      }
    ],
    tools: [tool]
  }
}

function parseSSEBlock(block) {
  const lines = String(block || '').split(/\r?\n/)
  const dataLines = []
  let event = ''
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }

  const data = dataLines.join('\n').trim()
  if (!data || data === '[DONE]') {
    return { event, data: null }
  }

  return { event, data: parseJsonSafely(data) }
}

function extractImagesFromResponsesCompleted(eventData) {
  if (!eventData || eventData.type !== 'response.completed' || !eventData.response) {
    return null
  }

  const { response } = eventData
  const results = []
  for (const item of response.output || []) {
    if (!item || item.type !== 'image_generation_call' || !item.result) {
      continue
    }
    results.push({
      result: String(item.result).trim(),
      revisedPrompt: item.revised_prompt || '',
      outputFormat: item.output_format || '',
      size: item.size || '',
      background: item.background || '',
      quality: item.quality || ''
    })
  }

  return {
    id: response.id,
    createdAt: response.created_at || Math.floor(Date.now() / 1000),
    model: response.model,
    usage: response.tool_usage?.image_gen || response.usage || null,
    results
  }
}

function extractImageFromOutputItemDone(eventData) {
  if (
    !eventData ||
    eventData.type !== 'response.output_item.done' ||
    eventData.item?.type !== 'image_generation_call' ||
    !eventData.item.result
  ) {
    return null
  }

  const { item } = eventData
  return {
    result: String(item.result).trim(),
    revisedPrompt: item.revised_prompt || '',
    outputFormat: item.output_format || '',
    size: item.size || '',
    background: item.background || '',
    quality: item.quality || ''
  }
}

function extractImageFromPartialImage(eventData) {
  if (
    !eventData ||
    eventData.type !== 'response.image_generation_call.partial_image' ||
    !eventData.partial_image_b64
  ) {
    return null
  }

  return {
    itemId: eventData.item_id || '',
    result: String(eventData.partial_image_b64).trim(),
    revisedPrompt: '',
    outputFormat: eventData.output_format || '',
    size: eventData.size || '',
    background: eventData.background || '',
    quality: eventData.quality || ''
  }
}

function extractCodexImageNoOutputHint(eventData) {
  if (!eventData || typeof eventData !== 'object') {
    return ''
  }

  if (eventData.error?.message) {
    return eventData.error.message
  }

  const response = eventData.response
  if (response && typeof response === 'object') {
    if (response.error?.message) {
      return response.error.message
    }
    if (response.incomplete_details?.reason) {
      return `response incomplete: ${response.incomplete_details.reason}`
    }

    for (const item of response.output || []) {
      const text = extractOutputTextFromItem(item)
      if (text) {
        return text
      }
    }
  }

  if (eventData.item) {
    return extractOutputTextFromItem(eventData.item)
  }

  return ''
}

function extractOutputTextFromItem(item) {
  if (!item || typeof item !== 'object' || !Array.isArray(item.content)) {
    return ''
  }

  return item.content
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return ''
      }
      return String(part.text || part.output_text || part.content || '').trim()
    })
    .filter(Boolean)
    .join(' ')
    .trim()
}

function buildImagesApiResponse(completed, responseFormat) {
  const normalizedFormat = normalizeImageResponseFormat(responseFormat)
  const data = []

  for (const image of completed.results || []) {
    const item = {}
    if (normalizedFormat === 'url') {
      item.url = `data:${mimeTypeFromOutputFormat(image.outputFormat)};base64,${image.result}`
    } else {
      item.b64_json = image.result
    }
    if (image.revisedPrompt) {
      item.revised_prompt = image.revisedPrompt
    }
    data.push(item)
  }

  const response = {
    created: completed.createdAt || Math.floor(Date.now() / 1000),
    data
  }

  const first = completed.results?.[0]
  if (first?.background) {
    response.background = first.background
  }
  if (first?.outputFormat) {
    response.output_format = first.outputFormat
  }
  if (first?.quality) {
    response.quality = first.quality
  }
  if (first?.size) {
    response.size = first.size
  }
  if (completed.usage) {
    response.usage = completed.usage
  }

  return response
}

function mergeUsageData(usages) {
  const mergeValue = (left, right) => {
    if (typeof right === 'number') {
      return (typeof left === 'number' ? left : 0) + right
    }
    if (right && typeof right === 'object' && !Array.isArray(right)) {
      const out = left && typeof left === 'object' && !Array.isArray(left) ? { ...left } : {}
      for (const [key, value] of Object.entries(right)) {
        out[key] = mergeValue(out[key], value)
      }
      return out
    }
    return left === undefined ? right : left
  }

  let merged = null
  for (const usage of usages || []) {
    if (!usage || typeof usage !== 'object') {
      continue
    }
    merged = mergeValue(merged || {}, usage)
  }
  return merged
}

function mergeCompletedImages(completedItems, model) {
  const results = []
  const usages = []
  let createdAt = Math.floor(Date.now() / 1000)

  for (const completed of completedItems || []) {
    if (!completed) {
      continue
    }
    const { createdAt: itemCreatedAt, usage, results: itemResults } = completed
    if (itemCreatedAt && itemCreatedAt < createdAt) {
      createdAt = itemCreatedAt
    }
    if (usage) {
      usages.push(usage)
    }
    for (const result of itemResults || []) {
      results.push(result)
    }
  }

  return {
    createdAt,
    model,
    usage: mergeUsageData(usages),
    results
  }
}

async function runLimitedTasks(tasks, limit, onFirstError) {
  const results = new Array(tasks.length)
  let nextIndex = 0
  let firstError = null

  const worker = async () => {
    while (nextIndex < tasks.length && !firstError) {
      const currentIndex = nextIndex
      nextIndex += 1
      try {
        results[currentIndex] = await tasks[currentIndex]()
      } catch (error) {
        if (!firstError) {
          firstError = error
          if (typeof onFirstError === 'function') {
            onFirstError(error)
          }
        }
      }
    }
  }

  const workerCount = Math.min(Math.max(1, limit), tasks.length)
  await Promise.all(Array.from({ length: workerCount }, worker))

  if (firstError) {
    throw firstError
  }
  return results
}

function createRelayError(statusCode, errorData, fallbackMessage, fallbackType = 'server_error') {
  const payload =
    errorData && typeof errorData === 'object'
      ? errorData
      : {
          error: {
            message: fallbackMessage,
            type: fallbackType
          }
        }
  const message = payload.error?.message || payload.message || fallbackMessage
  const error = new Error(message)
  error.statusCode = statusCode
  error.response = {
    status: statusCode,
    data: payload
  }
  return error
}

function isRetryableCodexImageError(error, signal) {
  if (signal?.aborted || error?.code === 'ERR_CANCELED') {
    return false
  }

  const status = error?.statusCode || error?.response?.status
  if (!status) {
    return true
  }
  if (status === 408 || status === 409 || status === 425) {
    return true
  }
  return status >= 500
}

function bindAbortSignalToStream(signal, stream) {
  if (!signal || !stream || typeof stream.destroy !== 'function') {
    return
  }

  const destroyStream = () => stream.destroy(new Error('OpenAI image request aborted'))
  if (signal.aborted) {
    destroyStream()
    return
  }

  signal.addEventListener('abort', destroyStream, { once: true })
  const cleanup = () => signal.removeEventListener('abort', destroyStream)
  stream.once('end', cleanup)
  stream.once('error', cleanup)
  stream.once('close', cleanup)
}

function buildImageStreamEventData({ itemId, b64, outputFormat, responseFormat, partial = false }) {
  const normalizedFormat = normalizeImageResponseFormat(responseFormat)
  const data = {
    type: partial ? 'image_generation.partial' : 'image_generation.completed',
    created: Math.floor(Date.now() / 1000),
    data: [{}]
  }

  if (itemId) {
    data.item_id = itemId
  }
  if (normalizedFormat === 'url') {
    data.data[0].url = `data:${mimeTypeFromOutputFormat(outputFormat)};base64,${b64}`
  } else {
    data.data[0].b64_json = b64
  }
  return data
}

async function readMultipartFormData(req) {
  const contentType = getContentType(req)
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    const error = new Error(`Unsupported Content-Type: ${contentType || 'none'}`)
    error.statusCode = 400
    throw error
  }

  const request = new Request('http://localhost/openai/v1/images/edits', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'content-length': req.headers['content-length'] || '0'
    },
    body: Readable.toWeb(req),
    duplex: 'half'
  })

  return await request.formData()
}

async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body
  }

  const chunks = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const raw = Buffer.concat(chunks).toString('utf8')
  const parsed = parseJsonSafely(raw)
  if (!parsed || typeof parsed !== 'object') {
    const error = new Error('Request body must be valid JSON')
    error.statusCode = 400
    throw error
  }
  return parsed
}

async function collectStreamToErrorData(stream) {
  if (!stream || typeof stream.on !== 'function') {
    return null
  }

  const chunks = []
  await new Promise((resolve) => {
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    stream.on('end', resolve)
    stream.on('error', resolve)
    setTimeout(resolve, 8000)
  })

  const raw = Buffer.concat(chunks).toString('utf8')
  const direct = parseJsonSafely(raw)
  if (direct) {
    return direct
  }

  for (const block of raw.split(/\n\n/)) {
    const parsed = parseSSEBlock(block).data
    if (parsed) {
      return parsed
    }
  }
  return raw ? { error: { message: raw } } : null
}

class OpenAIImagesRelayService {
  async handleGeneration(req, res, context) {
    const body = await parseJsonBody(req)
    if (!body.prompt || !String(body.prompt).trim()) {
      return res.status(400).json({
        error: {
          message: 'prompt is required',
          type: 'invalid_request_error'
        }
      })
    }

    const imageContext = {
      ...context,
      endpoint: 'generations',
      model: String(body.model || DEFAULT_IMAGE_MODEL).trim() || DEFAULT_IMAGE_MODEL,
      responseFormat: normalizeImageResponseFormat(body.response_format),
      stream: body.stream === true,
      body
    }

    if (context.accountType === 'openai-responses') {
      return this._forwardOpenAIResponsesJSON(req, res, imageContext)
    }

    const imageCount = parseCodexImageCount(body.n)
    if (imageContext.stream && imageCount > 1) {
      return res.status(400).json({
        error: {
          message: 'stream=true with n>1 is not supported for OpenAI OAuth image accounts',
          type: 'invalid_request_error',
          param: 'n'
        }
      })
    }

    const tool = createImageTool(body, 'generate', imageContext.model)
    const responsesBody = buildImagesResponsesRequest(String(body.prompt).trim(), [], tool)
    return this._forwardCodexImageResponses(
      req,
      res,
      { ...imageContext, imageCount },
      responsesBody
    )
  }

  async handleEdit(req, res, context) {
    const contentType = getContentType(req).toLowerCase()
    if (context.accountType === 'openai-responses') {
      if (contentType.startsWith('multipart/form-data')) {
        const formData = await readMultipartFormData(req)
        return this._forwardOpenAIResponsesMultipart(req, res, context, formData)
      }

      const body = await parseJsonBody(req)
      return this._forwardOpenAIResponsesJSON(req, res, {
        ...context,
        endpoint: 'edits',
        model: String(body.model || DEFAULT_IMAGE_MODEL).trim() || DEFAULT_IMAGE_MODEL,
        responseFormat: normalizeImageResponseFormat(body.response_format),
        stream: body.stream === true,
        body
      })
    }

    if (contentType.startsWith('application/json')) {
      const body = await parseJsonBody(req)
      return this._handleCodexJsonEdit(req, res, context, body)
    }

    const formData = await readMultipartFormData(req)
    return this._handleCodexMultipartEdit(req, res, context, formData)
  }

  async _handleCodexJsonEdit(req, res, context, body) {
    const prompt = String(body.prompt || '').trim()
    if (!prompt) {
      return res.status(400).json({
        error: {
          message: 'prompt is required',
          type: 'invalid_request_error'
        }
      })
    }

    const images = []
    for (const image of body.images || []) {
      if (typeof image === 'string' && image.trim()) {
        images.push(image.trim())
      } else if (image?.image_url && typeof image.image_url === 'string') {
        images.push(image.image_url.trim())
      } else if (image?.image_url?.url) {
        images.push(String(image.image_url.url).trim())
      }
    }
    if (typeof body.image === 'string' && body.image.trim()) {
      images.push(body.image.trim())
    } else if (body.image?.image_url?.url) {
      images.push(String(body.image.image_url.url).trim())
    }

    if (images.length === 0) {
      return res.status(400).json({
        error: {
          message: 'image is required',
          type: 'invalid_request_error'
        }
      })
    }

    const model = String(body.model || DEFAULT_IMAGE_MODEL).trim() || DEFAULT_IMAGE_MODEL
    const tool = createImageTool(body, 'edit', model)
    if (body.mask?.image_url) {
      tool.input_image_mask = {
        image_url:
          typeof body.mask.image_url === 'string' ? body.mask.image_url : body.mask.image_url.url
      }
    }

    const imageContext = {
      ...context,
      endpoint: 'edits',
      model,
      responseFormat: normalizeImageResponseFormat(body.response_format),
      stream: body.stream === true,
      imageCount: parseCodexImageCount(body.n),
      body
    }

    if (imageContext.stream && imageContext.imageCount > 1) {
      return res.status(400).json({
        error: {
          message: 'stream=true with n>1 is not supported for OpenAI OAuth image accounts',
          type: 'invalid_request_error',
          param: 'n'
        }
      })
    }

    const responsesBody = buildImagesResponsesRequest(prompt, images, tool)
    return this._forwardCodexImageResponses(req, res, imageContext, responsesBody)
  }

  async _handleCodexMultipartEdit(req, res, context, formData) {
    const prompt = getFirstFormValue(formData, 'prompt')
    if (!prompt) {
      return res.status(400).json({
        error: {
          message: 'prompt is required',
          type: 'invalid_request_error'
        }
      })
    }

    const imageArrayFiles = getAllFiles(formData, 'image[]')
    const imageFiles = imageArrayFiles.length > 0 ? imageArrayFiles : getAllFiles(formData, 'image')
    if (imageFiles.length === 0) {
      return res.status(400).json({
        error: {
          message: 'image is required',
          type: 'invalid_request_error'
        }
      })
    }

    const images = []
    for (const file of imageFiles) {
      images.push(await fileToDataUrl(file))
    }

    const model = getFirstFormValue(formData, 'model') || DEFAULT_IMAGE_MODEL
    const source = {
      model,
      size: getFirstFormValue(formData, 'size'),
      quality: getFirstFormValue(formData, 'quality'),
      background: getFirstFormValue(formData, 'background'),
      output_format: getFirstFormValue(formData, 'output_format'),
      input_fidelity: getFirstFormValue(formData, 'input_fidelity'),
      moderation: getFirstFormValue(formData, 'moderation'),
      output_compression: getFirstFormValue(formData, 'output_compression'),
      partial_images: getFirstFormValue(formData, 'partial_images')
    }
    const tool = createImageTool(source, 'edit', model)

    const maskFile = getAllFiles(formData, 'mask')[0]
    if (maskFile) {
      tool.input_image_mask = { image_url: await fileToDataUrl(maskFile) }
    }

    const imageContext = {
      ...context,
      endpoint: 'edits',
      model,
      responseFormat: normalizeImageResponseFormat(getFirstFormValue(formData, 'response_format')),
      stream: toBool(getFirstFormValue(formData, 'stream'), false),
      imageCount: parseCodexImageCount(getFirstFormValue(formData, 'n')),
      body: source
    }

    if (imageContext.stream && imageContext.imageCount > 1) {
      return res.status(400).json({
        error: {
          message: 'stream=true with n>1 is not supported for OpenAI OAuth image accounts',
          type: 'invalid_request_error',
          param: 'n'
        }
      })
    }

    const responsesBody = buildImagesResponsesRequest(prompt, images, tool)
    return this._forwardCodexImageResponses(req, res, imageContext, responsesBody)
  }

  async _forwardOpenAIResponsesJSON(req, res, context) {
    const fullAccount = await openaiResponsesAccountService.getAccount(context.account.id)
    if (!fullAccount) {
      return res.status(403).json({ error: { message: 'OpenAI-Responses account not found' } })
    }

    const endpointPath =
      context.endpoint === 'edits' ? '/v1/images/edits' : '/v1/images/generations'
    const targetUrl = `${fullAccount.baseApi}${endpointPath}`
    const upstreamBody = { ...(context.body || {}) }
    upstreamBody.model = context.model || upstreamBody.model || DEFAULT_IMAGE_MODEL

    const headers = {
      ...filterForOpenAI(req.headers || {}),
      Authorization: `Bearer ${fullAccount.apiKey}`,
      'Content-Type': 'application/json',
      Accept: context.stream ? 'text/event-stream' : 'application/json'
    }
    delete headers['content-length']
    delete headers['Content-Length']

    if (fullAccount.userAgent) {
      headers['User-Agent'] = fullAccount.userAgent
    }

    const response = await axios({
      method: 'POST',
      url: targetUrl,
      headers,
      data: upstreamBody,
      timeout: config.requestTimeout || 600000,
      responseType: context.stream ? 'stream' : 'json',
      validateStatus: () => true,
      ...this._getProxyOptions(fullAccount.proxy, 'OpenAI-Responses image')
    })

    return this._forwardOpenAIResponsesImageResponse(req, res, response, context)
  }

  async _forwardOpenAIResponsesMultipart(req, res, context, formData) {
    const fullAccount = await openaiResponsesAccountService.getAccount(context.account.id)
    if (!fullAccount) {
      return res.status(403).json({ error: { message: 'OpenAI-Responses account not found' } })
    }

    const model = getFirstFormValue(formData, 'model') || DEFAULT_IMAGE_MODEL
    const stream = toBool(getFirstFormValue(formData, 'stream'), false)
    const upstreamForm = new FormData()
    const keys = Array.from(new Set(Array.from(formData.keys())))

    upstreamForm.append('model', model)
    if (stream) {
      upstreamForm.append('stream', 'true')
    }

    for (const key of keys) {
      if (key === 'model' || key === 'stream') {
        continue
      }
      for (const value of formData.getAll(key)) {
        if (value && typeof value.arrayBuffer === 'function') {
          upstreamForm.append(key, Buffer.from(await value.arrayBuffer()), {
            filename: value.name || 'file',
            contentType: value.type || 'application/octet-stream'
          })
        } else {
          upstreamForm.append(key, String(value ?? ''))
        }
      }
    }

    const targetUrl = `${fullAccount.baseApi}/v1/images/edits`
    const headers = {
      ...filterForOpenAI(req.headers || {}),
      ...upstreamForm.getHeaders(),
      Authorization: `Bearer ${fullAccount.apiKey}`,
      Accept: stream ? 'text/event-stream' : 'application/json'
    }
    delete headers['content-length']
    delete headers['Content-Length']

    if (fullAccount.userAgent) {
      headers['User-Agent'] = fullAccount.userAgent
    }

    const response = await axios({
      method: 'POST',
      url: targetUrl,
      headers,
      data: upstreamForm,
      maxBodyLength: Infinity,
      timeout: config.requestTimeout || 600000,
      responseType: stream ? 'stream' : 'json',
      validateStatus: () => true,
      ...this._getProxyOptions(fullAccount.proxy, 'OpenAI-Responses image')
    })

    return this._forwardOpenAIResponsesImageResponse(req, res, response, {
      ...context,
      endpoint: 'edits',
      model,
      responseFormat: normalizeImageResponseFormat(getFirstFormValue(formData, 'response_format')),
      stream
    })
  }

  async _forwardOpenAIResponsesImageResponse(req, res, response, context) {
    if (response.status >= 400) {
      const errorData =
        response.data && typeof response.data.on === 'function'
          ? await collectStreamToErrorData(response.data)
          : response.data
      return res.status(response.status).json(
        errorData || {
          error: {
            message: `Upstream image request failed (${response.status})`
          }
        }
      )
    }

    writeUpstreamHeaders(res, response.headers)
    await openaiResponsesAccountService.updateAccount(context.account.id, {
      lastUsedAt: new Date().toISOString()
    })

    if (context.stream && response.data && typeof response.data.pipe === 'function') {
      res.status(response.status)
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      response.data.pipe(res)
      return
    }

    const responseData = response.data
    if (responseData?.usage) {
      await recordUsageFromUsageData({
        apiKeyData: context.apiKeyData,
        accountId: context.account.id,
        usageData: responseData.usage,
        model: responseData.model || context.model,
        req,
        context: 'openai-responses-image'
      })
    }

    return res.status(response.status).json(responseData)
  }

  async _requestCodexImageResponses(req, context, responsesBody, options = {}) {
    const { account, accessToken } = context
    if (!account || !accessToken) {
      throw createRelayError(403, null, 'OpenAI OAuth account is not available', 'forbidden')
    }

    const headers = buildCodexImageHeaders(req, account, context, accessToken)

    const axiosConfig = {
      headers,
      timeout: config.requestTimeout || 600000,
      responseType: 'stream',
      validateStatus: () => true,
      ...this._getProxyOptions(context.proxy, 'OpenAI OAuth image')
    }
    if (options.signal) {
      axiosConfig.signal = options.signal
    }

    const response = await axios.post(CODEX_RESPONSES_ENDPOINT, responsesBody, axiosConfig)
    bindAbortSignalToStream(options.signal, response.data)

    const usageSnapshot = this._extractCodexUsageHeaders(response.headers)
    if (usageSnapshot) {
      await openaiAccountService.updateCodexUsageSnapshot(context.accountId, usageSnapshot)
    }

    if (response.status === 429) {
      const errorData = await collectStreamToErrorData(response.data)
      const resetsInSeconds =
        errorData?.error?.resets_in_seconds || errorData?.resets_in_seconds || null
      await unifiedOpenAIScheduler.markAccountRateLimited(
        context.accountId,
        'openai',
        context.sessionHash,
        resetsInSeconds
      )
      throw createRelayError(
        429,
        errorData || {
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_error',
            code: 'rate_limit_exceeded',
            resets_in_seconds: resetsInSeconds
          }
        },
        'Rate limit exceeded',
        'rate_limit_error'
      )
    }

    if (response.status === 401 || response.status === 402 || response.status === 403) {
      const errorData = await collectStreamToErrorData(response.data)
      const message =
        errorData?.error?.message ||
        errorData?.message ||
        (response.status === 402
          ? 'Payment required'
          : response.status === 403
            ? 'Forbidden'
            : 'Unauthorized')
      await unifiedOpenAIScheduler.markAccountUnauthorized(
        context.accountId,
        'openai',
        context.sessionHash,
        `OpenAI image authentication failed (${response.status}): ${message}`
      )
      throw createRelayError(
        response.status,
        errorData || {
          error: {
            message,
            type:
              response.status === 402
                ? 'payment_required'
                : response.status === 403
                  ? 'forbidden'
                  : 'unauthorized'
          }
        },
        message
      )
    }

    if (response.status >= 400) {
      const errorData = await collectStreamToErrorData(response.data)
      throw createRelayError(
        response.status,
        errorData || {
          error: {
            message: `Codex image request failed (${response.status})`
          }
        },
        `Codex image request failed (${response.status})`
      )
    }

    await openaiAccountService.recordUsage(context.accountId, 0)
    return response
  }

  async _forwardCodexImageResponses(req, res, context, responsesBody) {
    const imageCount = context.imageCount || 1
    if (imageCount > 1) {
      return this._collectCodexImageResponsesBatch(req, res, context, responsesBody, imageCount)
    }

    const response = await this._requestCodexImageResponses(req, context, responsesBody)

    if (context.stream) {
      return this._streamCodexImageResponse(req, res, response, context)
    }

    return this._collectCodexImageResponse(req, res, response, context)
  }

  _streamCodexImageResponse(req, res, response, context) {
    res.status(response.status)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    writeUpstreamHeaders(res, response.headers)

    let buffer = ''
    let usageData = null
    let actualModel = null
    let finalized = false

    const finish = async () => {
      if (finalized) {
        return
      }
      finalized = true

      if (usageData) {
        try {
          await recordUsageFromUsageData({
            apiKeyData: context.apiKeyData,
            accountId: context.accountId,
            usageData,
            model: context.model || actualModel,
            req,
            context: 'openai-oauth-image-stream'
          })
        } catch (error) {
          logger.error('Failed to record OpenAI OAuth image stream usage:', error)
        }
      }

      if (isWritableResponse(res)) {
        res.write('data: [DONE]\n\n')
        res.end()
      }
    }

    const processBlock = (block) => {
      const { data } = parseSSEBlock(block)
      if (!data) {
        return
      }

      if (data.type === 'response.image_generation_call.partial_image') {
        const b64 = data.partial_image_b64
        if (b64 && isWritableResponse(res)) {
          res.write(
            `data: ${JSON.stringify(
              buildImageStreamEventData({
                itemId: data.item_id,
                b64,
                outputFormat: data.output_format,
                responseFormat: context.responseFormat,
                partial: true
              })
            )}\n\n`
          )
        }
        return
      }

      if (
        data.type === 'response.output_item.done' &&
        data.item?.type === 'image_generation_call'
      ) {
        const b64 = data.item.result
        if (b64 && isWritableResponse(res)) {
          res.write(
            `data: ${JSON.stringify(
              buildImageStreamEventData({
                itemId: data.item.id,
                b64,
                outputFormat: data.item.output_format,
                responseFormat: context.responseFormat,
                partial: false
              })
            )}\n\n`
          )
        }
        return
      }

      const completed = extractImagesFromResponsesCompleted(data)
      if (completed) {
        usageData = completed.usage
        actualModel = completed.model
      }
    }

    response.data.on('data', (chunk) => {
      buffer += chunk.toString()
      if (!buffer.includes('\n\n')) {
        return
      }
      const blocks = buffer.split(/\n\n/)
      buffer = blocks.pop() || ''
      for (const block of blocks) {
        processBlock(block)
      }
    })

    response.data.on('end', async () => {
      if (buffer.trim()) {
        processBlock(buffer)
      }
      await finish()
    })

    response.data.on('error', (error) => {
      logger.error('OpenAI OAuth image stream error:', error)
      if (isWritableResponse(res)) {
        res.write(
          `event: error\ndata: ${JSON.stringify({
            error: {
              message: error.message || 'Upstream stream error',
              type: 'stream_error'
            }
          })}\n\n`
        )
        res.end()
      }
    })

    req.on('close', () => {
      if (!finalized) {
        response.data?.destroy?.()
      }
    })
  }

  async _collectCodexImageCompleted(response, context) {
    let buffer = ''
    let completed = null
    const outputItemResults = []
    const partialImageResults = new Map()
    let upstreamError = null
    let noOutputHint = ''

    const processData = (data) => {
      if (!data) {
        return
      }
      if (data.error && !upstreamError) {
        upstreamError = data
      }

      const hint = extractCodexImageNoOutputHint(data)
      if (hint) {
        noOutputHint = hint
      }

      const partialImage = extractImageFromPartialImage(data)
      if (partialImage) {
        const key = partialImage.itemId || `partial-${partialImageResults.size}`
        partialImageResults.set(key, partialImage)
      }

      const outputItem = extractImageFromOutputItemDone(data)
      if (outputItem) {
        outputItemResults.push(outputItem)
      }

      const result = extractImagesFromResponsesCompleted(data)
      if (result) {
        completed = result
      }
    }

    await new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        buffer += chunk.toString()
        if (!buffer.includes('\n\n')) {
          return
        }
        const blocks = buffer.split(/\n\n/)
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          processData(parseSSEBlock(block).data)
        }
      })
      response.data.on('end', resolve)
      response.data.on('error', reject)
    })

    if (buffer.trim()) {
      processData(parseSSEBlock(buffer).data)
    }

    const fallbackPartialResults = Array.from(partialImageResults.values()).map(
      ({ itemId: _itemId, ...result }) => result
    )
    if (completed && (!completed.results || completed.results.length === 0)) {
      completed.results = outputItemResults.length > 0 ? outputItemResults : fallbackPartialResults
    } else if (!completed && outputItemResults.length > 0) {
      completed = {
        createdAt: Math.floor(Date.now() / 1000),
        model: context.model,
        usage: null,
        results: outputItemResults
      }
    } else if (!completed && fallbackPartialResults.length > 0) {
      logger.warn('OpenAI OAuth image response used latest partial image as fallback')
      completed = {
        createdAt: Math.floor(Date.now() / 1000),
        model: context.model,
        usage: null,
        results: fallbackPartialResults
      }
    }

    if (upstreamError && !completed) {
      throw createRelayError(502, upstreamError, 'Codex image stream returned an error')
    }

    if (!completed || !completed.results || completed.results.length === 0) {
      const message = noOutputHint
        ? `Upstream did not return image output: ${noOutputHint}`
        : 'Upstream did not return image output'
      throw createRelayError(502, null, message, 'bad_gateway')
    }

    return completed
  }

  async _recordCodexImageUsage(req, context, completed, usageContext) {
    if (completed.usage) {
      await recordUsageFromUsageData({
        apiKeyData: context.apiKeyData,
        accountId: context.accountId,
        usageData: completed.usage,
        model: context.model || completed.model,
        req,
        context: usageContext
      })
    }
  }

  async _collectCodexImageResponse(req, res, response, context) {
    const completed = await this._collectCodexImageCompleted(response, context)
    await this._recordCodexImageUsage(req, context, completed, 'openai-oauth-image')

    writeUpstreamHeaders(res, response.headers)
    return res.json(buildImagesApiResponse(completed, context.responseFormat))
  }

  async _collectCodexImageBatchItem(req, context, responsesBody, index, signal) {
    const maxAttempts = getCodexImageRetryCount() + 1
    let lastError

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let output
      try {
        const response = await this._requestCodexImageResponses(req, context, responsesBody, {
          signal
        })
        const completed = await this._collectCodexImageCompleted(response, context)
        output = { completed, headers: response.headers }
      } catch (error) {
        lastError = error
        if (attempt >= maxAttempts || !isRetryableCodexImageError(error, signal)) {
          throw error
        }
        logger.warn(
          `OpenAI OAuth image batch item ${index + 1} failed, retrying (${attempt}/${maxAttempts - 1}): ${error.message}`
        )
        continue
      }

      // Usage recording happens after generation succeeds; do not retry a paid image on stats errors.
      await this._recordCodexImageUsage(
        req,
        context,
        output.completed,
        `openai-oauth-image-batch-${index + 1}`
      )
      return output
    }

    throw lastError
  }

  async _collectCodexImageResponsesBatch(req, res, context, responsesBody, imageCount) {
    const abortController = new AbortController()
    let settled = false
    const abortIfPending = () => {
      if (!settled && !abortController.signal.aborted) {
        abortController.abort()
      }
    }
    const abortOnResponseClose = () => {
      if (!res.writableEnded) {
        abortIfPending()
      }
    }

    req.on('aborted', abortIfPending)
    res.on('close', abortOnResponseClose)

    const tasks = Array.from(
      { length: imageCount },
      (_, index) => () =>
        this._collectCodexImageBatchItem(req, context, responsesBody, index, abortController.signal)
    )

    try {
      const outputs = await runLimitedTasks(tasks, getCodexImageParallelism(), abortIfPending)
      settled = true

      const merged = mergeCompletedImages(
        outputs.map((item) => item.completed),
        context.model
      )
      if (!merged.results.length) {
        throw createRelayError(502, null, 'Upstream did not return image output', 'bad_gateway')
      }

      writeUpstreamHeaders(res, outputs[0]?.headers || {})
      return res.json(buildImagesApiResponse(merged, context.responseFormat))
    } finally {
      settled = true
      req.removeListener('aborted', abortIfPending)
      res.removeListener('close', abortOnResponseClose)
    }
  }

  _getProxyOptions(proxy, label) {
    const proxyAgent = ProxyHelper.createProxyAgent(proxy)
    if (!proxyAgent) {
      return {}
    }

    logger.info(`🌐 Using proxy for ${label}: ${ProxyHelper.getProxyDescription(proxy)}`)
    return {
      httpAgent: proxyAgent,
      httpsAgent: proxyAgent,
      proxy: false
    }
  }

  _extractCodexUsageHeaders(headers = {}) {
    const normalized = {}
    for (const [key, value] of Object.entries(headers || {})) {
      normalized[key.toLowerCase()] = Array.isArray(value) ? value[0] : value
    }

    const toNumberSafe = (value) => {
      if (value === undefined || value === null || value === '') {
        return null
      }
      const num = Number(value)
      return Number.isFinite(num) ? num : null
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

    return Object.values(snapshot).some((value) => value !== null) ? snapshot : null
  }
}

module.exports = new OpenAIImagesRelayService()
module.exports.DEFAULT_IMAGE_MODEL = DEFAULT_IMAGE_MODEL
