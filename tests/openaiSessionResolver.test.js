const {
  extractOpenAIStickySession,
  resolveOpenAIStickySessionContext
} = require('../src/utils/openaiSessionResolver')

describe('openaiSessionResolver', () => {
  it('prefers prompt_cache_key over session_id header when both are present', () => {
    const result = extractOpenAIStickySession({
      headers: {
        session_id: '  header-session  '
      },
      body: {
        prompt_cache_key: 'body-key'
      }
    })

    expect(result).toEqual({
      value: 'body-key',
      source: 'body:prompt_cache_key'
    })
  })

  it('supports repeated header values and uses first valid session id', () => {
    const result = extractOpenAIStickySession({
      headers: {
        session_id: ['', 'header-array-session']
      }
    })

    expect(result).toEqual({
      value: 'header-array-session',
      source: 'header:session_id'
    })
  })

  it('uses prompt_cache_key from body when no explicit session fields', () => {
    const result = extractOpenAIStickySession({
      body: {
        prompt_cache_key: 'cache-key-1'
      }
    })

    expect(result).toEqual({
      value: 'cache-key-1',
      source: 'body:prompt_cache_key'
    })
  })

  it('prefers prompt_cache_key over previous_response_id for stable cache affinity', () => {
    const result = extractOpenAIStickySession({
      body: {
        previous_response_id: 'resp_123',
        prompt_cache_key: 'cache-key-stable'
      }
    })

    expect(result).toEqual({
      value: 'cache-key-stable',
      source: 'body:prompt_cache_key'
    })
  })

  it('extracts metadata conversation_id from object', () => {
    const result = extractOpenAIStickySession({
      body: {
        metadata: {
          conversation_id: 'conv-meta-1'
        }
      }
    })

    expect(result).toEqual({
      value: 'conv-meta-1',
      source: 'body:metadata.conversation_id'
    })
  })

  it('extracts metadata session key from JSON string', () => {
    const result = extractOpenAIStickySession({
      body: {
        metadata: '{"session_id":"meta-session-1"}'
      }
    })

    expect(result).toEqual({
      value: 'meta-session-1',
      source: 'body:metadata.session_id'
    })
  })

  it('extracts conversation id from conversation object', () => {
    const result = extractOpenAIStickySession({
      body: {
        conversation: {
          id: 'conversation-1'
        }
      }
    })

    expect(result).toEqual({
      value: 'conversation-1',
      source: 'body:conversation.id'
    })
  })

  it('falls back to body user when no stronger key exists', () => {
    const result = extractOpenAIStickySession({
      body: {
        user: 'user-abc'
      }
    })

    expect(result).toEqual({
      value: 'user-abc',
      source: 'body:user'
    })
  })

  it('returns null when no sticky session candidate is available', () => {
    const result = extractOpenAIStickySession({
      headers: {},
      body: {}
    })

    expect(result).toBeNull()
  })

  it('scopes sticky hash by api key while keeping session id stable', () => {
    const req = {
      body: {
        prompt_cache_key: 'cache-key-1'
      }
    }

    const scopedA = resolveOpenAIStickySessionContext(req, 'key-a')
    const scopedB = resolveOpenAIStickySessionContext(req, 'key-b')
    const scopedARepeat = resolveOpenAIStickySessionContext(req, 'key-a')

    expect(scopedA.sessionId).toBe('cache-key-1')
    expect(scopedA.source).toBe('body:prompt_cache_key')
    expect(scopedA.sessionHash).toBe(scopedARepeat.sessionHash)
    expect(scopedA.sessionHash).not.toBe(scopedB.sessionHash)
  })

  it('uses prompt_cache_key as the canonical session id even when header session_id conflicts', () => {
    const scoped = resolveOpenAIStickySessionContext(
      {
        headers: {
          session_id: 'header-session'
        },
        body: {
          prompt_cache_key: 'body-cache-key'
        }
      },
      'key-a'
    )

    expect(scoped.sessionId).toBe('body-cache-key')
    expect(scoped.source).toBe('body:prompt_cache_key')
  })
})
