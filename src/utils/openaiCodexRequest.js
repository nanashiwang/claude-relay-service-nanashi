const DEFAULT_CODEX_CLIENT_VERSION = process.env.OPENAI_CODEX_CLIENT_VERSION || '0.144.1'
const DEFAULT_CODEX_USER_AGENT =
  process.env.OPENAI_CODEX_USER_AGENT ||
  `codex_cli_rs/${DEFAULT_CODEX_CLIENT_VERSION} (Mac OS 26.5.0; arm64) Terminal/2.14.0`
const DEFAULT_CODEX_ORIGINATOR = process.env.OPENAI_CODEX_ORIGINATOR || 'codex_cli_rs'

const CHATGPT_CODEX_MODEL_ALIASES = Object.freeze({
  'gpt-5.6-tarre': 'gpt-5.6-terra'
})

function normalizeChatGPTCodexModel(model) {
  if (typeof model !== 'string') {
    return model
  }

  const trimmed = model.trim()
  const aliasKey = trimmed.toLowerCase()
  return CHATGPT_CODEX_MODEL_ALIASES[aliasKey] || trimmed
}

function parseVersionParts(version) {
  if (typeof version !== 'string') {
    return null
  }

  const normalized = version.trim()
  if (!/^\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)) {
    return null
  }

  return normalized
    .split(/[+-]/, 1)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10))
}

function compareVersions(left, right) {
  const leftParts = parseVersionParts(left)
  const rightParts = parseVersionParts(right)
  if (!leftParts || !rightParts) {
    return 0
  }

  const maxLength = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] || 0
    const rightPart = rightParts[index] || 0
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1
    }
  }

  return 0
}

function requiresModernCodexClient(model) {
  return typeof model === 'string' && model.trim().toLowerCase().startsWith('gpt-5.6-')
}

function resolveCodexClientVersion(incomingVersion, requestedModel) {
  const normalizedVersion = typeof incomingVersion === 'string' ? incomingVersion.trim() : ''
  const validIncoming = parseVersionParts(normalizedVersion) ? normalizedVersion : ''
  if (
    validIncoming &&
    (!requiresModernCodexClient(requestedModel) ||
      compareVersions(validIncoming, DEFAULT_CODEX_CLIENT_VERSION) >= 0)
  ) {
    return validIncoming
  }

  return DEFAULT_CODEX_CLIENT_VERSION
}

function sanitizeHeaderToken(value, fallback) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_.-]{1,64}$/.test(normalized) ? normalized : fallback
}

function resolveCodexUserAgent(incomingUserAgent) {
  const normalized = typeof incomingUserAgent === 'string' ? incomingUserAgent.trim() : ''
  if (/^(codex_vscode|codex_cli_rs)\//i.test(normalized)) {
    return normalized
  }

  return DEFAULT_CODEX_USER_AGENT
}

function buildChatGPTCodexClientHeaders(incomingHeaders = {}, requestedModel = null) {
  const incoming = incomingHeaders && typeof incomingHeaders === 'object' ? incomingHeaders : {}

  return {
    version: resolveCodexClientVersion(incoming.version, requestedModel),
    originator: sanitizeHeaderToken(incoming.originator, DEFAULT_CODEX_ORIGINATOR),
    'user-agent': resolveCodexUserAgent(incoming['user-agent'])
  }
}

module.exports = {
  DEFAULT_CODEX_CLIENT_VERSION,
  DEFAULT_CODEX_ORIGINATOR,
  DEFAULT_CODEX_USER_AGENT,
  CHATGPT_CODEX_MODEL_ALIASES,
  normalizeChatGPTCodexModel,
  resolveCodexClientVersion,
  buildChatGPTCodexClientHeaders
}
