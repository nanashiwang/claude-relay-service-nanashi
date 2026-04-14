const {
  decodeJwtPayload,
  normalizeImportedOpenAIJson,
  normalizeRawImportPayload
} = require('../src/utils/openaiJsonImport')

function buildJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

describe('openaiJsonImport', () => {
  it('normalizes a standard CLIProxyAPI codex json payload', () => {
    const idToken = buildJwt({
      email: 'demo@example.com',
      email_verified: true,
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acc_cli_proxy',
        chatgpt_user_id: 'user_cli_proxy',
        chatgpt_plan_type: 'plus',
        organizations: [
          {
            id: 'org_default',
            role: 'owner',
            title: 'Default Org',
            is_default: true
          }
        ]
      }
    })

    const normalized = normalizeImportedOpenAIJson(
      {
        type: 'codex',
        email: 'demo@example.com',
        id_token: idToken,
        access_token: 'access-token-value',
        refresh_token: 'refresh-token-value',
        expired: '2026-04-15T13:00:00Z',
        last_refresh: '2026-04-15T12:00:00Z'
      },
      {
        fileName: 'codex-demo.json',
        namePrefix: 'CPA - '
      }
    )

    expect(normalized.name).toBe('CPA - demo@example.com (plus)')
    expect(normalized.description).toBe('Imported from codex-demo.json')
    expect(normalized.openaiOauth).toEqual({
      idToken,
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value'
    })
    expect(normalized.accountInfo).toMatchObject({
      accountId: 'acc_cli_proxy',
      chatgptUserId: 'user_cli_proxy',
      organizationId: 'org_default',
      organizationRole: 'owner',
      organizationTitle: 'Default Org',
      planType: 'plus',
      email: 'demo@example.com',
      emailVerified: true
    })
    expect(normalized.accountInfo.organizations).toHaveLength(1)
    expect(normalized.expiresAt).toBe('2026-04-15T13:00:00.000Z')
    expect(normalized.lastRefresh).toBe('2026-04-15T12:00:00.000Z')
    expect(normalized.sourceType).toBe('codex')
  })

  it('supports nested tokens payloads and derives expiresAt from expires_in', () => {
    const idToken = buildJwt({
      email: 'nested@example.com',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acc_nested',
        organizations: [{ id: 'org_nested', is_default: true }]
      }
    })

    const before = Date.now()
    const normalized = normalizeImportedOpenAIJson({
      provider: 'openai',
      tokens: {
        id_token: idToken,
        access_token: 'nested-access',
        refresh_token: 'nested-refresh',
        last_refresh: '2026-04-15T08:30:00Z',
        expires_in: 7200
      }
    })
    const after = Date.now()

    expect(normalized.accountInfo.accountId).toBe('acc_nested')
    expect(normalized.accountInfo.email).toBe('nested@example.com')
    expect(normalized.lastRefresh).toBe('2026-04-15T08:30:00.000Z')

    const expiresAtMs = Date.parse(normalized.expiresAt)
    expect(Number.isNaN(expiresAtMs)).toBe(false)
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 7195 * 1000)
    expect(expiresAtMs).toBeLessThanOrEqual(after + 7205 * 1000)
  })

  it('accepts json string payloads', () => {
    const normalized = normalizeRawImportPayload('{"type":"codex","access_token":"a"}')
    expect(normalized).toEqual({
      type: 'codex',
      access_token: 'a'
    })
  })

  it('decodes jwt payload', () => {
    const token = buildJwt({
      sub: 'user_123',
      email: 'decode@example.com'
    })

    expect(decodeJwtPayload(token)).toEqual({
      sub: 'user_123',
      email: 'decode@example.com'
    })
  })

  it('throws when both access_token and refresh_token are missing', () => {
    expect(() =>
      normalizeImportedOpenAIJson({
        type: 'codex',
        email: 'missing@example.com'
      })
    ).toThrow('缺少 access_token 或 refresh_token')
  })

  it('throws when import type is unsupported', () => {
    expect(() =>
      normalizeImportedOpenAIJson({
        type: 'claude',
        access_token: 'a'
      })
    ).toThrow('暂不支持导入 type=claude 的 JSON')
  })

  it('throws when payload is not a plain object', () => {
    expect(() => normalizeRawImportPayload('[1,2,3]')).toThrow('JSON 内容必须是对象')
  })
})
