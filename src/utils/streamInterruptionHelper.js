const logger = require('./logger')

const STREAM_INTERRUPTION_REASONS = {
  UPSTREAM_STREAM_ERROR: 'upstream_stream_error',
  TIMEOUT: 'timeout',
  CLIENT_ABORT: 'client_abort'
}

const KNOWN_STREAM_INTERRUPTION_REASONS = new Set(Object.values(STREAM_INTERRUPTION_REASONS))
const TIMEOUT_ERROR_CODES = new Set(['ETIMEDOUT', 'ECONNABORTED'])

function normalizeStreamInterruptionReason(reason) {
  if (!reason || typeof reason !== 'string') {
    return STREAM_INTERRUPTION_REASONS.UPSTREAM_STREAM_ERROR
  }

  const normalizedReason = reason.trim().toLowerCase()
  if (!normalizedReason) {
    return STREAM_INTERRUPTION_REASONS.UPSTREAM_STREAM_ERROR
  }

  return KNOWN_STREAM_INTERRUPTION_REASONS.has(normalizedReason)
    ? normalizedReason
    : STREAM_INTERRUPTION_REASONS.UPSTREAM_STREAM_ERROR
}

function resolveStreamInterruptionReasonFromError(
  error,
  fallback = STREAM_INTERRUPTION_REASONS.UPSTREAM_STREAM_ERROR
) {
  const normalizedFallback = normalizeStreamInterruptionReason(fallback)

  const rawCode = error?.code
  const errorCode = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : ''
  const errorMessage =
    typeof error?.message === 'string' ? error.message.trim().toLowerCase() : ''

  if (
    TIMEOUT_ERROR_CODES.has(errorCode) ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('timed out')
  ) {
    return STREAM_INTERRUPTION_REASONS.TIMEOUT
  }

  return normalizedFallback
}

async function recordStreamInterruption(redisClient, reason, provider = 'unknown') {
  if (!redisClient || typeof redisClient.recordStreamInterruption !== 'function') {
    return
  }

  const normalizedReason = normalizeStreamInterruptionReason(reason)
  const normalizedProvider =
    typeof provider === 'string' && provider.trim() ? provider.trim().toLowerCase() : 'unknown'

  try {
    await redisClient.recordStreamInterruption(normalizedReason, normalizedProvider)
  } catch (statsError) {
    logger.debug('Failed to record stream interruption stats:', statsError)
  }
}

module.exports = {
  STREAM_INTERRUPTION_REASONS,
  normalizeStreamInterruptionReason,
  resolveStreamInterruptionReasonFromError,
  recordStreamInterruption
}
