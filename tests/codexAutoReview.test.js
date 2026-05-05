const {
  isCodexAutoReviewModel,
  getCodexAutoReviewModelCandidates,
  isModelSupportedForCodexAutoReview,
  isCodexClientUserAgent,
  shouldPassThroughCodexRequest
} = require('../src/utils/codexAutoReview')

describe('codexAutoReview helpers', () => {
  describe('isCodexAutoReviewModel', () => {
    it('matches the canonical name', () => {
      expect(isCodexAutoReviewModel('codex-auto-review')).toBe(true)
    })

    it('trims whitespace before comparing', () => {
      expect(isCodexAutoReviewModel('  codex-auto-review  ')).toBe(true)
    })

    it('rejects unrelated names including the routing model', () => {
      expect(isCodexAutoReviewModel('gpt-5.3-codex')).toBe(false)
      expect(isCodexAutoReviewModel(' gpt-5.3-codex ')).toBe(false)
      expect(isCodexAutoReviewModel('')).toBe(false)
      expect(isCodexAutoReviewModel(null)).toBe(false)
      expect(isCodexAutoReviewModel(undefined)).toBe(false)
    })
  })

  describe('getCodexAutoReviewModelCandidates', () => {
    it('returns both routing candidates for codex-auto-review', () => {
      expect(getCodexAutoReviewModelCandidates('codex-auto-review')).toEqual([
        'codex-auto-review',
        'gpt-5.3-codex'
      ])
    })

    it('returns the trimmed model itself for any other value', () => {
      expect(getCodexAutoReviewModelCandidates(' gpt-5 ')).toEqual(['gpt-5'])
    })

    it('returns an empty array for empty input', () => {
      expect(getCodexAutoReviewModelCandidates('')).toEqual([])
      expect(getCodexAutoReviewModelCandidates(null)).toEqual([])
    })
  })

  describe('isModelSupportedForCodexAutoReview', () => {
    it('allows when no requestedModel is provided', () => {
      expect(isModelSupportedForCodexAutoReview(['gpt-5'], null)).toBe(true)
      expect(isModelSupportedForCodexAutoReview([], '')).toBe(true)
    })

    it('allows when supportedModels is empty/undefined (preserves existing behavior)', () => {
      expect(isModelSupportedForCodexAutoReview(undefined, 'codex-auto-review')).toBe(true)
      expect(isModelSupportedForCodexAutoReview([], 'codex-auto-review')).toBe(true)
    })

    it('allows codex-auto-review when account supports gpt-5.3-codex', () => {
      expect(
        isModelSupportedForCodexAutoReview(['gpt-5.3-codex'], 'codex-auto-review')
      ).toBe(true)
    })

    it('allows codex-auto-review when account explicitly supports it', () => {
      expect(
        isModelSupportedForCodexAutoReview(['codex-auto-review'], 'codex-auto-review')
      ).toBe(true)
    })

    it('rejects codex-auto-review when account only supports unrelated models', () => {
      expect(isModelSupportedForCodexAutoReview(['gpt-5'], 'codex-auto-review')).toBe(false)
      expect(
        isModelSupportedForCodexAutoReview(['gpt-4o', 'gpt-5'], 'codex-auto-review')
      ).toBe(false)
    })

    it('still enforces strict matching for non codex-auto-review models', () => {
      expect(isModelSupportedForCodexAutoReview(['gpt-5'], 'gpt-5')).toBe(true)
      expect(isModelSupportedForCodexAutoReview(['gpt-5'], 'gpt-5.3-codex')).toBe(false)
    })

    it('handles whitespace and non-string entries in supportedModels', () => {
      expect(
        isModelSupportedForCodexAutoReview(
          [' gpt-5.3-codex ', null, undefined, 42],
          'codex-auto-review'
        )
      ).toBe(true)
    })
  })

  describe('isCodexClientUserAgent', () => {
    it('matches official Codex client UAs', () => {
      expect(isCodexClientUserAgent('codex_cli_rs/0.42.0')).toBe(true)
      expect(isCodexClientUserAgent('codex_vscode/1.2.3')).toBe(true)
    })

    it('rejects desktop / unrelated UAs', () => {
      expect(isCodexClientUserAgent('Codex Desktop')).toBe(false)
      expect(isCodexClientUserAgent('Mozilla/5.0')).toBe(false)
      expect(isCodexClientUserAgent('')).toBe(false)
      expect(isCodexClientUserAgent(undefined)).toBe(false)
    })
  })

  describe('shouldPassThroughCodexRequest', () => {
    it('passes through when UA matches', () => {
      const req = { headers: { 'user-agent': 'codex_cli_rs/0.42.0' } }
      expect(shouldPassThroughCodexRequest(req, 'gpt-5')).toBe(true)
    })

    it('passes through codex-auto-review even when UA does not match', () => {
      const req = { headers: { 'user-agent': 'Codex Desktop' } }
      expect(shouldPassThroughCodexRequest(req, 'codex-auto-review')).toBe(true)
    })

    it('does not pass through when neither UA nor model match', () => {
      const req = { headers: { 'user-agent': 'Mozilla/5.0' } }
      expect(shouldPassThroughCodexRequest(req, 'gpt-5')).toBe(false)
      expect(shouldPassThroughCodexRequest(req, null)).toBe(false)
    })

    it('handles missing headers gracefully', () => {
      expect(shouldPassThroughCodexRequest({}, 'codex-auto-review')).toBe(true)
      expect(shouldPassThroughCodexRequest(undefined, 'codex-auto-review')).toBe(true)
      expect(shouldPassThroughCodexRequest(undefined, 'gpt-5')).toBe(false)
    })
  })
})
