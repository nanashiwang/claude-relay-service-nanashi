function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function safeJsonParse(value) {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return value
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function readPath(source, path) {
  if (!source || !path) {
    return undefined
  }

  const keys = path.split('.')
  let current = source

  for (const key of keys) {
    if (!current || typeof current !== 'object' || !(key in current)) {
      return undefined
    }
    current = current[key]
  }

  return current
}

function readFirst(source, paths) {
  for (const path of paths) {
    const value = readPath(source, path)
    if (value !== undefined && value !== null) {
      return value
    }
  }
  return undefined
}

function readFirstString(source, paths) {
  const value = readFirst(source, paths)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || ''
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return ''
}

function readFirstBoolean(source, paths) {
  const value = readFirst(source, paths)
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false
    }
  }
  return undefined
}

function normalizeIsoDate(value) {
  if (!value) {
    return ''
  }

  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return ''
  }

  return new Date(parsed).toISOString()
}

function buildDateFromExpiresIn(source) {
  const rawValue = readFirst(source, ['expires_in', 'credentials.expires_in', 'tokens.expires_in'])
  const expiresIn = Number(rawValue)
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    return ''
  }

  return new Date(Date.now() + expiresIn * 1000).toISOString()
}

function decodeJwtPayload(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    return null
  }

  const parts = idToken.split('.')
  if (parts.length !== 3 || !parts[1]) {
    return null
  }

  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function normalizeOrganizations(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => isPlainObject(item))
  }
  return []
}

function buildImportedName({ explicitName, email, fileName, planType, accountId, namePrefix }) {
  let baseName = explicitName

  if (!baseName && email) {
    baseName = email
  }

  if (!baseName && fileName) {
    baseName = fileName.replace(/\.json$/i, '')
  }

  if (!baseName && accountId) {
    baseName = `account-${accountId.slice(0, 8)}`
  }

  if (!baseName) {
    baseName = 'Imported OpenAI Account'
  }

  if (planType && !baseName.includes(planType)) {
    baseName = `${baseName} (${planType})`
  }

  if (namePrefix) {
    return `${namePrefix}${baseName}`
  }

  return baseName
}

function normalizeRawImportPayload(payload) {
  const parsed = safeJsonParse(payload)
  if (!isPlainObject(parsed)) {
    throw new Error('JSON 内容必须是对象')
  }
  return parsed
}

function normalizeImportedOpenAIJson(payload, options = {}) {
  const raw = normalizeRawImportPayload(payload)
  const fileName = typeof options.fileName === 'string' ? options.fileName.trim() : ''
  const namePrefix = typeof options.namePrefix === 'string' ? options.namePrefix : ''

  const type = readFirstString(raw, ['type', 'provider', 'authType']).toLowerCase()
  if (type && !['codex', 'openai', 'openai-oauth-account'].includes(type)) {
    throw new Error(`暂不支持导入 type=${type} 的 JSON`)
  }

  const idToken = readFirstString(raw, [
    'id_token',
    'idToken',
    'credentials.id_token',
    'tokens.id_token'
  ])
  const accessToken = readFirstString(raw, [
    'access_token',
    'accessToken',
    'credentials.access_token',
    'tokens.access_token'
  ])
  const refreshToken = readFirstString(raw, [
    'refresh_token',
    'refreshToken',
    'credentials.refresh_token',
    'tokens.refresh_token'
  ])

  if (!accessToken && !refreshToken) {
    throw new Error('缺少 access_token 或 refresh_token')
  }

  const jwtPayload = decodeJwtPayload(idToken)
  const authClaims = isPlainObject(jwtPayload?.['https://api.openai.com/auth'])
    ? jwtPayload['https://api.openai.com/auth']
    : {}
  const organizations = normalizeOrganizations(authClaims.organizations)
  const defaultOrg =
    organizations.find((organization) => organization.is_default) || organizations[0] || {}

  const email =
    readFirstString(raw, ['email', 'accountInfo.email', 'extra.crs_email']) ||
    readFirstString(jwtPayload, ['email'])
  const accountId =
    readFirstString(raw, [
      'account_id',
      'accountId',
      'chatgpt_account_id',
      'credentials.chatgpt_account_id',
      'extra.crs_chatgpt_account_id'
    ]) || readFirstString(authClaims, ['chatgpt_account_id'])
  const chatgptUserId =
    readFirstString(raw, [
      'chatgpt_user_id',
      'chatgptUserId',
      'credentials.chatgpt_user_id',
      'extra.crs_chatgpt_user_id'
    ]) || readFirstString(authClaims, ['chatgpt_user_id', 'user_id'])
  const organizationId =
    readFirstString(raw, [
      'organization_id',
      'organizationId',
      'credentials.organization_id',
      'extra.crs_organization_id'
    ]) || readFirstString(defaultOrg, ['id'])
  const organizationRole =
    readFirstString(raw, ['organization_role', 'organizationRole']) ||
    readFirstString(defaultOrg, ['role'])
  const organizationTitle =
    readFirstString(raw, ['organization_title', 'organizationTitle']) ||
    readFirstString(defaultOrg, ['title'])
  const planType =
    readFirstString(raw, ['plan_type', 'planType', 'accountInfo.planType']) ||
    readFirstString(authClaims, ['chatgpt_plan_type'])
  const emailVerified =
    readFirstBoolean(raw, ['email_verified', 'emailVerified', 'accountInfo.emailVerified']) ??
    readFirstBoolean(jwtPayload, ['email_verified']) ??
    false

  const explicitName = readFirstString(raw, ['name', 'label', 'extra.crs_name'])
  const name = buildImportedName({
    explicitName,
    email,
    fileName,
    planType,
    accountId,
    namePrefix
  })

  const expiresAt =
    normalizeIsoDate(
      readFirstString(raw, [
        'expired',
        'expiresAt',
        'expires_at',
        'credentials.expires_at',
        'credentials.expiresAt',
        'tokens.expires_at',
        'tokens.expiresAt',
        'token.expires_at'
      ])
    ) || buildDateFromExpiresIn(raw)
  const lastRefresh = normalizeIsoDate(
    readFirstString(raw, [
      'last_refresh',
      'lastRefresh',
      'tokens.last_refresh',
      'tokens.lastRefresh',
      'token.last_refresh'
    ])
  )

  return {
    name,
    description: fileName ? `Imported from ${fileName}` : 'Imported from JSON',
    openaiOauth: {
      idToken,
      accessToken,
      refreshToken
    },
    accountInfo: {
      accountId,
      chatgptUserId,
      organizationId,
      organizationRole,
      organizationTitle,
      planType,
      email,
      emailVerified,
      organizations
    },
    expiresAt,
    lastRefresh,
    sourceType: type || 'codex',
    raw
  }
}

module.exports = {
  decodeJwtPayload,
  normalizeImportedOpenAIJson,
  normalizeRawImportPayload
}
