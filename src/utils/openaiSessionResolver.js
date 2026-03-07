const crypto = require('crypto')

const SESSION_HEADER_KEYS = ['session_id', 'x-session-id', 'x-session_id']
const SESSION_BODY_KEYS = ['prompt_cache_key', 'session_id', 'conversation_id', 'previous_response_id']
const METADATA_SESSION_KEYS = ['conversation_id', 'session_id', 'thread_id', 'chat_id', 'user_id']
const OBJECT_ID_KEYS = ['id', 'key', 'value', 'prompt_cache_key', 'cache_key']
const MAX_SESSION_VALUE_LENGTH = 2048

function trimAndLimit(value) {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  if (trimmed.length <= MAX_SESSION_VALUE_LENGTH) {
    return trimmed
  }
  return trimmed.slice(0, MAX_SESSION_VALUE_LENGTH)
}

function normalizeScalar(value) {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value === 'string') {
    return trimAndLimit(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return trimAndLimit(String(value))
  }

  return null
}

function parseObjectLike(value) {
  if (!value) {
    return null
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
  } catch (_) {
    return null
  }

  return null
}

function stableNormalize(value, seen) {
  if (value === null || value === undefined) {
    return null
  }

  if (Array.isArray(value)) {
    return value.map((item) => stableNormalize(item, seen))
  }

  if (typeof value !== 'object') {
    return value
  }

  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)

  const keys = Object.keys(value).sort()
  const output = {}
  for (const key of keys) {
    output[key] = stableNormalize(value[key], seen)
  }
  return output
}

function normalizeObject(value) {
  const objectValue = parseObjectLike(value)
  if (!objectValue) {
    return null
  }

  for (const key of OBJECT_ID_KEYS) {
    const normalized = normalizeScalar(objectValue[key])
    if (normalized) {
      return normalized
    }
  }

  try {
    const serialized = JSON.stringify(stableNormalize(objectValue, new WeakSet()))
    return trimAndLimit(serialized)
  } catch (_) {
    return null
  }
}

function normalizeSessionValue(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeSessionValue(item)
      if (normalized) {
        return normalized
      }
    }
    return null
  }

  return normalizeScalar(value) || normalizeObject(value)
}

function extractFromHeaders(headers = {}) {
  for (const key of SESSION_HEADER_KEYS) {
    const normalized = normalizeSessionValue(headers[key])
    if (normalized) {
      return {
        value: normalized,
        source: `header:${key}`
      }
    }
  }
  return null
}

function extractFromPromptCacheKey(body = {}) {
  if (!body || typeof body !== 'object') {
    return null
  }

  const normalized = normalizeSessionValue(body.prompt_cache_key)
  if (!normalized) {
    return null
  }

  return {
    value: normalized,
    source: 'body:prompt_cache_key'
  }
}

function extractFromBody(body = {}) {
  if (!body || typeof body !== 'object') {
    return null
  }

  for (const key of SESSION_BODY_KEYS) {
    const normalized = normalizeSessionValue(body[key])
    if (normalized) {
      return {
        value: normalized,
        source: `body:${key}`
      }
    }
  }

  return null
}

function extractFromMetadata(body = {}) {
  if (!body || typeof body !== 'object') {
    return null
  }

  const metadata = parseObjectLike(body.metadata)
  if (!metadata) {
    return null
  }

  for (const key of METADATA_SESSION_KEYS) {
    const normalized = normalizeSessionValue(metadata[key])
    if (normalized) {
      return {
        value: normalized,
        source: `body:metadata.${key}`
      }
    }
  }

  return null
}

function extractFromConversation(body = {}) {
  if (!body || typeof body !== 'object') {
    return null
  }

  const conversation = parseObjectLike(body.conversation)
  if (!conversation) {
    return null
  }

  const direct = normalizeSessionValue(conversation.id)
  if (direct) {
    return {
      value: direct,
      source: 'body:conversation.id'
    }
  }

  const fallback = normalizeSessionValue(conversation)
  if (fallback) {
    return {
      value: fallback,
      source: 'body:conversation'
    }
  }

  return null
}

function extractOpenAIStickySession(req = {}) {
  const body = req.body && typeof req.body === 'object' ? req.body : {}

  const fromPromptCacheKey = extractFromPromptCacheKey(body)
  if (fromPromptCacheKey) {
    return fromPromptCacheKey
  }

  const fromHeaders = extractFromHeaders(req.headers || {})
  if (fromHeaders) {
    return fromHeaders
  }

  const fromBody = extractFromBody(body)
  if (fromBody) {
    return fromBody
  }

  const fromMetadata = extractFromMetadata(body)
  if (fromMetadata) {
    return fromMetadata
  }

  const fromConversation = extractFromConversation(body)
  if (fromConversation) {
    return fromConversation
  }

  const fromUser = normalizeSessionValue(body.user)
  if (fromUser) {
    return {
      value: fromUser,
      source: 'body:user'
    }
  }

  return null
}

function buildScopedOpenAIStickySessionSeed(sessionId, apiKeyId) {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (!normalizedSessionId) {
    return null
  }

  const normalizedApiKeyId = typeof apiKeyId === 'string' ? apiKeyId.trim() : ''
  if (!normalizedApiKeyId) {
    return normalizedSessionId
  }

  return `${normalizedApiKeyId}:${normalizedSessionId}`
}

function resolveOpenAIStickySessionContext(req = {}, apiKeyId = null) {
  const stickySession = extractOpenAIStickySession(req)
  const sessionId = stickySession?.value || null
  const sessionSeed = buildScopedOpenAIStickySessionSeed(sessionId, apiKeyId)
  const sessionHash = sessionSeed
    ? crypto.createHash('sha256').update(sessionSeed).digest('hex')
    : null

  return {
    sessionId,
    sessionSeed,
    sessionHash,
    source: stickySession?.source || null
  }
}

module.exports = {
  extractOpenAIStickySession,
  buildScopedOpenAIStickySessionSeed,
  resolveOpenAIStickySessionContext
}
