jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn()
}))

jest.mock('../src/utils/proxyHelper', () => ({
  createProxyAgent: jest.fn(() => null)
}))

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  success: jest.fn()
}))

const { OAUTH_CONFIG } = require('../src/utils/oauthHelper')

describe('oauthHelper Claude OAuth configuration', () => {
  it('uses platform.claude.com for token exchange and redirect callback', () => {
    expect(OAUTH_CONFIG.TOKEN_URL).toBe('https://platform.claude.com/v1/oauth/token')
    expect(OAUTH_CONFIG.REDIRECT_URI).toBe('https://platform.claude.com/oauth/code/callback')
  })

  it('keeps Claude Code file and MCP scopes in browser and cookie OAuth flows', () => {
    expect(OAUTH_CONFIG.SCOPES).toContain('user:mcp_servers')
    expect(OAUTH_CONFIG.SCOPES).toContain('user:file_upload')
    expect(OAUTH_CONFIG.SCOPES_API).toContain('user:mcp_servers')
    expect(OAUTH_CONFIG.SCOPES_API).toContain('user:file_upload')
    expect(OAUTH_CONFIG.SCOPES_API).not.toContain('org:create_api_key')
  })
})
