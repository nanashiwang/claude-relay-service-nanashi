const {
  DEFAULT_CODEX_CLIENT_VERSION,
  DEFAULT_CODEX_ORIGINATOR,
  DEFAULT_CODEX_USER_AGENT,
  normalizeChatGPTCodexModel,
  resolveCodexClientVersion,
  buildChatGPTCodexClientHeaders
} = require('../src/utils/openaiCodexRequest')

describe('openaiCodexRequest helpers', () => {
  describe('normalizeChatGPTCodexModel', () => {
    it('maps the common gpt-5.6 Terra typo to the upstream slug', () => {
      expect(normalizeChatGPTCodexModel('gpt-5.6-tarre')).toBe('gpt-5.6-terra')
      expect(normalizeChatGPTCodexModel(' GPT-5.6-TARRE ')).toBe('gpt-5.6-terra')
    })

    it('keeps canonical and non-string models intact', () => {
      expect(normalizeChatGPTCodexModel(' gpt-5.6-luna ')).toBe('gpt-5.6-luna')
      expect(normalizeChatGPTCodexModel(null)).toBeNull()
    })
  })

  describe('resolveCodexClientVersion', () => {
    it('defaults missing or invalid versions', () => {
      expect(resolveCodexClientVersion('', 'gpt-5.6-luna')).toBe(DEFAULT_CODEX_CLIENT_VERSION)
      expect(resolveCodexClientVersion('invalid', 'gpt-5.6-luna')).toBe(
        DEFAULT_CODEX_CLIENT_VERSION
      )
    })

    it('upgrades old client versions for gpt-5.6 models', () => {
      expect(resolveCodexClientVersion('0.118.0', 'gpt-5.6-luna')).toBe(
        DEFAULT_CODEX_CLIENT_VERSION
      )
    })

    it('preserves modern versions', () => {
      expect(resolveCodexClientVersion('0.144.1', 'gpt-5.6-luna')).toBe('0.144.1')
      expect(resolveCodexClientVersion('0.145.0', 'gpt-5.6-luna')).toBe('0.145.0')
    })
  })

  describe('buildChatGPTCodexClientHeaders', () => {
    it('adds Codex client identity headers by default', () => {
      expect(buildChatGPTCodexClientHeaders({}, 'gpt-5.6-luna')).toEqual({
        version: DEFAULT_CODEX_CLIENT_VERSION,
        originator: DEFAULT_CODEX_ORIGINATOR,
        'user-agent': DEFAULT_CODEX_USER_AGENT
      })
    })

    it('preserves valid incoming Codex identity headers', () => {
      expect(
        buildChatGPTCodexClientHeaders(
          {
            version: '0.145.0',
            originator: 'codex_vscode',
            'user-agent': 'codex_vscode/1.2.3'
          },
          'gpt-5.6-luna'
        )
      ).toEqual({
        version: '0.145.0',
        originator: 'codex_vscode',
        'user-agent': 'codex_vscode/1.2.3'
      })
    })

    it('replaces invalid originator and non-Codex user-agent', () => {
      expect(
        buildChatGPTCodexClientHeaders(
          {
            originator: 'Codex Desktop',
            'user-agent': 'Mozilla/5.0'
          },
          'gpt-5.6-luna'
        )
      ).toEqual({
        version: DEFAULT_CODEX_CLIENT_VERSION,
        originator: DEFAULT_CODEX_ORIGINATOR,
        'user-agent': DEFAULT_CODEX_USER_AGENT
      })
    })
  })
})
