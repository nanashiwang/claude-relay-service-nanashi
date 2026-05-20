const CODEX_AUTO_REVIEW_MODEL = 'codex-auto-review'
const CODEX_AUTO_REVIEW_ROUTING_MODEL = 'gpt-5.3-codex'

function normalizeModelName(model) {
  return typeof model === 'string' ? model.trim() : ''
}

function isCodexAutoReviewModel(model) {
  return normalizeModelName(model) === CODEX_AUTO_REVIEW_MODEL
}

function getCodexAutoReviewModelCandidates(model) {
  const normalized = normalizeModelName(model)
  if (!normalized) {
    return []
  }

  if (isCodexAutoReviewModel(normalized)) {
    return [CODEX_AUTO_REVIEW_MODEL, CODEX_AUTO_REVIEW_ROUTING_MODEL]
  }

  return [normalized]
}

function isModelSupportedForCodexAutoReview(supportedModels, requestedModel) {
  if (!requestedModel) {
    return true
  }

  if (!Array.isArray(supportedModels) || supportedModels.length === 0) {
    return true
  }

  const supportedSet = new Set(
    supportedModels
      .filter((model) => typeof model === 'string')
      .map((model) => model.trim())
      .filter(Boolean)
  )

  return getCodexAutoReviewModelCandidates(requestedModel).some((model) =>
    supportedSet.has(model)
  )
}

function isCodexClientUserAgent(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : ''
  return /^(codex_vscode|codex_cli_rs)\/[\d.]+/i.test(ua)
}

function shouldPassThroughCodexRequest(req, requestedModel) {
  const userAgent = req?.headers?.['user-agent'] || ''
  return isCodexClientUserAgent(userAgent) || isCodexAutoReviewModel(requestedModel)
}

module.exports = {
  CODEX_AUTO_REVIEW_MODEL,
  CODEX_AUTO_REVIEW_ROUTING_MODEL,
  isCodexAutoReviewModel,
  getCodexAutoReviewModelCandidates,
  isModelSupportedForCodexAutoReview,
  isCodexClientUserAgent,
  shouldPassThroughCodexRequest
}
