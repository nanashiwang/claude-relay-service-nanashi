function toSafeInt(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return 0
  }
  return Math.max(0, Math.floor(numeric))
}

function roundRate(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  return Math.round(value * 10000) / 10000
}

function resolveCacheStatus({ cacheReadTokens = 0, cacheCreateTokens = 0 } = {}) {
  const safeCacheReadTokens = toSafeInt(cacheReadTokens)
  const safeCacheCreateTokens = toSafeInt(cacheCreateTokens)

  if (safeCacheReadTokens > 0 && safeCacheCreateTokens > 0) {
    return 'mixed'
  }
  if (safeCacheReadTokens > 0) {
    return 'hit'
  }
  if (safeCacheCreateTokens > 0) {
    return 'warmup'
  }
  return 'miss'
}

function buildCacheMetrics({
  inputTokens = 0,
  cacheReadTokens = 0,
  cacheCreateTokens = 0,
  requests = 0,
  cacheReadRequests = 0,
  cacheCreateRequests = 0
} = {}) {
  const safeInputTokens = toSafeInt(inputTokens)
  const safeCacheReadTokens = toSafeInt(cacheReadTokens)
  const safeCacheCreateTokens = toSafeInt(cacheCreateTokens)
  const safeRequests = toSafeInt(requests)
  const safeCacheReadRequests = Math.min(safeRequests, toSafeInt(cacheReadRequests))
  const safeCacheCreateRequests = Math.min(safeRequests, toSafeInt(cacheCreateRequests))

  const effectiveInputTokens = safeInputTokens + safeCacheReadTokens
  const promptTokensWithCacheLifecycle = effectiveInputTokens + safeCacheCreateTokens

  const cacheHitRate =
    effectiveInputTokens > 0 ? roundRate(safeCacheReadTokens / effectiveInputTokens) : 0
  const cacheCreateRate =
    promptTokensWithCacheLifecycle > 0
      ? roundRate(safeCacheCreateTokens / promptTokensWithCacheLifecycle)
      : 0
  const cacheReadRequestRate =
    safeRequests > 0 ? roundRate(safeCacheReadRequests / safeRequests) : 0
  const cacheCreateRequestRate =
    safeRequests > 0 ? roundRate(safeCacheCreateRequests / safeRequests) : 0

  return {
    effectiveInputTokens,
    cacheReadRequests: safeCacheReadRequests,
    cacheCreateRequests: safeCacheCreateRequests,
    cacheHitRate,
    cacheReadTokenRate: cacheHitRate,
    cacheCreateRate,
    cacheCreateTokenRate: cacheCreateRate,
    cacheReadRequestRate,
    cacheCreateRequestRate
  }
}

function buildRequestCacheMetrics({
  inputTokens = 0,
  cacheReadTokens = 0,
  cacheCreateTokens = 0
} = {}) {
  const safeCacheReadTokens = toSafeInt(cacheReadTokens)
  const safeCacheCreateTokens = toSafeInt(cacheCreateTokens)

  return {
    cacheStatus: resolveCacheStatus({
      cacheReadTokens: safeCacheReadTokens,
      cacheCreateTokens: safeCacheCreateTokens
    }),
    ...buildCacheMetrics({
      inputTokens,
      cacheReadTokens: safeCacheReadTokens,
      cacheCreateTokens: safeCacheCreateTokens,
      requests: 1,
      cacheReadRequests: safeCacheReadTokens > 0 ? 1 : 0,
      cacheCreateRequests: safeCacheCreateTokens > 0 ? 1 : 0
    })
  }
}

module.exports = {
  buildCacheMetrics,
  buildRequestCacheMetrics,
  resolveCacheStatus
}
