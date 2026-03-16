function isPrimaryPrefixedRedisKey(key, prefix) {
  if (typeof key !== 'string' || typeof prefix !== 'string' || prefix.length === 0) {
    return false
  }

  if (!key.startsWith(prefix)) {
    return false
  }

  const suffix = key.slice(prefix.length)
  return suffix.length > 0 && !suffix.includes(':')
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

module.exports = {
  isPrimaryPrefixedRedisKey,
  filterPrimaryPrefixedRedisKeys,
  getPrimaryPrefixedRedisKeys
}
