const { extractOpenAIStickySession } = require('../src/utils/openaiSessionResolver')

describe('openaiSessionResolver', () => {
  it('prefers session_id header when present', () => {
    const result = extractOpenAIStickySession({
      headers: {
        session_id: '  header-session  '
      },
      body: {
        prompt_cache_key: 'body-key'
      }
    })

    expect(result).toEqual({
      value: 'header-session',
      source: 'header:session_id'
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
})
