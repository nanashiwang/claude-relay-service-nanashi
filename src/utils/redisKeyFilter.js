const RESERVED_REDIS_ENTITY_IDS = new Set(['index', 'idx', 'set', 'tags', 'hash_map'])

function isReservedRedisEntityId(value) {
  return typeof value === 'string' && RESERVED_REDIS_ENTITY_IDS.has(value)
}

function isPrimaryPrefixedRedisKey(key, prefix) {
  if (typeof key !== 'string' || typeof prefix !== 'string' || prefix.length === 0) {
    return false
  }

  if (!key.startsWith(prefix)) {
    return false
  }

  const suffix = key.slice(prefix.length)
  return suffix.length > 0 && !suffix.includes(':') && !isReservedRedisEntityId(suffix)
}

function filterPrimaryPrefixedRedisKeys(keys, prefix) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return []
  }

  return keys.filter((key) => isPrimaryPrefixedRedisKey(key, prefix))
}

async function getPrimaryPrefixedRedisKeys(client, prefix) {
  const keys = await client.keys(`${prefix}*`)
  return filterPrimaryPrefixedRedisKeys(keys, prefix)
}

function filterUsageModelStatsKeys(keys, period) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return []
  }

  const patterns = {
    daily: /^usage:model:daily:(.+):\d{4}-\d{2}-\d{2}$/,
    monthly: /^usage:model:monthly:(.+):\d{4}-\d{2}$/,
    hourly: /^usage:model:hourly:(.+):\d{4}-\d{2}-\d{2}:\d{2}$/
  }

  const pattern = patterns[period]
  if (!pattern) {
    return keys
  }

  return keys.filter((key) => {
    const match = String(key).match(pattern)
    return !!match && !isReservedRedisEntityId(match[1])
  })
}

function filterApiKeyUsageModelStatsKeys(keys, period) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return []
  }

  const patterns = {
    daily: /^usage:(.+?):model:daily:(.+):\d{4}-\d{2}-\d{2}$/,
    monthly: /^usage:(.+?):model:monthly:(.+):\d{4}-\d{2}$/,
    hourly: /^usage:(.+?):model:hourly:(.+):\d{4}-\d{2}-\d{2}:\d{2}$/
  }

  const pattern = patterns[period]
  if (!pattern) {
    return keys
  }

  return keys.filter((key) => {
    const match = String(key).match(pattern)
    return !!match && !isReservedRedisEntityId(match[2])
  })
}

function filterAccountUsageModelStatsKeys(keys, period) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return []
  }

  const patterns = {
    daily: /^account_usage:model:daily:(.+?):(.+):\d{4}-\d{2}-\d{2}$/,
    monthly: /^account_usage:model:monthly:(.+?):(.+):\d{4}-\d{2}$/,
    hourly: /^account_usage:model:hourly:(.+?):(.+):\d{4}-\d{2}-\d{2}:\d{2}$/
  }

  const pattern = patterns[period]
  if (!pattern) {
    return keys
  }

  return keys.filter((key) => {
    const match = String(key).match(pattern)
    return !!match && !isReservedRedisEntityId(match[2])
  })
}

module.exports = {
  isReservedRedisEntityId,
  isPrimaryPrefixedRedisKey,
  filterPrimaryPrefixedRedisKeys,
  getPrimaryPrefixedRedisKeys,
  filterUsageModelStatsKeys,
  filterApiKeyUsageModelStatsKeys,
  filterAccountUsageModelStatsKeys
}
