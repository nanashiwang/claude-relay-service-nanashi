function toPositiveNumber(value, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) {
    return fallback
  }
  return num
}

function resolveStickySessionPolicy(sessionConfig = {}, options = {}) {
  const ttlHours = toPositiveNumber(sessionConfig.stickyTtlHours, 1)
  const fullTTLSeconds = Math.max(1, Math.floor(ttlHours * 60 * 60))

  const autoRenewOverride = options.autoRenewEnabledOverride
  const autoRenewDisabled =
    typeof autoRenewOverride === 'boolean'
      ? !autoRenewOverride
      : sessionConfig.disableAutoRenewal === true
  const thresholdValue = Number(sessionConfig.renewalThresholdMinutes)

  let renewalThresholdMinutes = 0
  if (!autoRenewDisabled) {
    if (Number.isFinite(thresholdValue) && thresholdValue > 0) {
      renewalThresholdMinutes = thresholdValue
    } else {
      renewalThresholdMinutes = Math.min(Math.max(Math.ceil((ttlHours * 60) / 3), 5), 60)
    }
  }

  const renewalThresholdSeconds = Math.max(0, Math.floor(renewalThresholdMinutes * 60))

  return {
    ttlHours,
    fullTTLSeconds,
    renewalThresholdMinutes,
    renewalThresholdSeconds,
    autoRenewDisabled
  }
}

module.exports = {
  resolveStickySessionPolicy
}
