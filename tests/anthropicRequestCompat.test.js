const {
  sanitizeAnthropicMessagesRequest,
  sanitizeAnthropicRequestForService,
  sanitizeClaudeMessagesRequest,
  validateAnthropicMessagesRequest
} = require('../src/utils/anthropicRequestCompat')
const {
  buildAnthropicErrorResponse,
  resolveClientRequestId
} = require('../src/utils/errorSanitizer')

describe('anthropicRequestCompat', () => {
  const unchangedSummary = {
    changed: false,
    removedContextManagement: false,
    removedToolInputExamples: 0,
    removedEmptyTextBlocks: 0,
    removedEmptyMessages: 0,
    removedEmptyToolResultContents: 0,
    removedEmptyContentContainers: 0,
    removedEmptySystem: false
  }

  it('removes context_management when present', () => {
    const body = {
      model: 'claude-opus-4-6',
      context_management: {
        strategy: 'auto'
      },
      messages: [{ role: 'user', content: 'hi' }]
    }

    const result = sanitizeClaudeMessagesRequest(body)

    expect(result).toEqual({
      ...unchangedSummary,
      changed: true,
      removedContextManagement: true
    })
    expect(body.context_management).toBeUndefined()
  })

  it('removes input_examples from tools while preserving other fields', () => {
    const body = {
      tools: [
        {
          name: 'editor',
          description: 'edit files',
          input_examples: [{ path: 'a.js' }],
          input_schema: { type: 'object' }
        },
        {
          name: 'noop',
          input_schema: { type: 'object' }
        },
        null
      ]
    }

    const result = sanitizeClaudeMessagesRequest(body)

    expect(result).toEqual({
      ...unchangedSummary,
      changed: true,
      removedToolInputExamples: 1
    })
    expect(body.tools[0]).toEqual({
      name: 'editor',
      description: 'edit files',
      input_schema: { type: 'object' }
    })
    expect(body.tools[1]).toEqual({
      name: 'noop',
      input_schema: { type: 'object' }
    })
  })

  it('keeps request untouched when compat fields are absent', () => {
    const body = {
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'search', input_schema: { type: 'object' } }]
    }

    const snapshot = JSON.parse(JSON.stringify(body))

    const result = sanitizeClaudeMessagesRequest(body)

    expect(result).toEqual(unchangedSummary)
    expect(body).toEqual(snapshot)
  })

  it('keeps Claude-only compatibility fields on non-Claude services', () => {
    const body = {
      context_management: { strategy: 'auto' },
      tools: [
        {
          name: 'search',
          input_examples: [{ query: 'docs' }],
          input_schema: { type: 'object' }
        }
      ],
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '' },
            { type: 'text', text: 'kept' }
          ]
        }
      ]
    }

    const result = sanitizeAnthropicRequestForService(body, 'gemini')

    expect(result).toEqual({
      ...unchangedSummary,
      changed: true,
      removedEmptyTextBlocks: 1
    })
    expect(body.context_management).toEqual({ strategy: 'auto' })
    expect(body.tools[0].input_examples).toEqual([{ query: 'docs' }])
    expect(body.messages[0].content).toEqual([{ type: 'text', text: 'kept' }])
  })

  it('removes empty text blocks while preserving all meaningful content', () => {
    const toolInput = {
      content: [{ type: 'text', text: '' }]
    }
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '' },
            { type: 'text', text: ' \n\t ' },
            { type: 'text', text: '  answer  ' },
            { type: 'thinking', thinking: '', signature: 'sig' },
            { type: 'tool_use', id: 'tool_1', name: 'read', input: toolInput },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }
          ]
        },
        { role: 'user', content: [{ type: 'text', text: '你好' }] }
      ]
    }

    const result = sanitizeClaudeMessagesRequest(body)

    expect(result).toEqual({
      ...unchangedSummary,
      changed: true,
      removedEmptyTextBlocks: 1
    })
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: ' \n\t ' },
      { type: 'text', text: '  answer  ' },
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 'tool_1', name: 'read', input: toolInput },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }
    ])
    expect(body.messages[1].content).toEqual([{ type: 'text', text: '你好' }])
    expect(toolInput).toEqual({ content: [{ type: 'text', text: '' }] })
  })

  it('sanitizes nested tool_result content without removing the tool result', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool_1',
              content: [
                { type: 'text', text: '' },
                { type: 'text', text: 'result' },
                { type: 'image', source: { type: 'base64', data: 'AA==' } }
              ]
            },
            {
              type: 'tool_result',
              tool_use_id: 'tool_2',
              content: [{ type: 'text', text: '' }]
            }
          ]
        }
      ]
    }

    const result = sanitizeClaudeMessagesRequest(body)

    expect(result).toEqual({
      ...unchangedSummary,
      changed: true,
      removedEmptyTextBlocks: 2,
      removedEmptyToolResultContents: 1
    })
    expect(body.messages[0].content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'tool_1',
        content: [
          { type: 'text', text: 'result' },
          { type: 'image', source: { type: 'base64', data: 'AA==' } }
        ]
      },
      {
        type: 'tool_result',
        tool_use_id: 'tool_2'
      }
    ])
  })

  it('sanitizes only official nested search result and document content', () => {
    const arbitraryToolInput = {
      type: 'search_result',
      content: [{ type: 'text', text: '' }]
    }
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool_1',
              content: [
                {
                  type: 'search_result',
                  source: 'https://example.com/1',
                  title: 'one',
                  content: [
                    { type: 'text', text: '' },
                    { type: 'text', text: 'result' }
                  ]
                },
                {
                  type: 'search_result',
                  source: 'https://example.com/2',
                  title: 'two',
                  content: [{ type: 'text', text: '' }]
                },
                {
                  type: 'document',
                  source: {
                    type: 'content',
                    content: [
                      { type: 'text', text: '' },
                      { type: 'image', source: { type: 'base64', data: 'AA==' } }
                    ]
                  }
                },
                {
                  type: 'document',
                  source: { type: 'content', content: '' }
                }
              ]
            },
            {
              type: 'tool_use',
              id: 'tool_2',
              name: 'custom',
              input: arbitraryToolInput
            }
          ]
        }
      ]
    }

    const result = sanitizeAnthropicMessagesRequest(body)

    expect(result).toEqual({
      ...unchangedSummary,
      changed: true,
      removedEmptyTextBlocks: 3,
      removedEmptyContentContainers: 2
    })
    expect(body.messages[0].content[0].content).toEqual([
      {
        type: 'search_result',
        source: 'https://example.com/1',
        title: 'one',
        content: [{ type: 'text', text: 'result' }]
      },
      {
        type: 'document',
        source: {
          type: 'content',
          content: [{ type: 'image', source: { type: 'base64', data: 'AA==' } }]
        }
      }
    ])
    expect(arbitraryToolInput).toEqual({
      type: 'search_result',
      content: [{ type: 'text', text: '' }]
    })
  })

  it('preserves malformed text blocks for strict validation', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'text' }, { type: 'text', text: null }, { type: 'text', text: 0 }]
        }
      ]
    }
    const snapshot = JSON.parse(JSON.stringify(body))

    expect(sanitizeAnthropicMessagesRequest(body)).toEqual(unchangedSummary)
    expect(body).toEqual(snapshot)
  })

  it('bounds malformed nested content traversal', () => {
    const body = {
      messages: [{ role: 'user', content: [] }]
    }
    let nested = { type: 'text', text: '' }
    for (let index = 0; index < 100; index += 1) {
      nested = {
        type: 'tool_result',
        tool_use_id: `tool_${index}`,
        content: [nested]
      }
    }
    body.messages[0].content.push(nested)

    expect(() => sanitizeAnthropicMessagesRequest(body)).not.toThrow()
    expect(body.messages).toHaveLength(1)
  })

  it('drops only semantically empty messages and keeps the current user input', () => {
    const body = {
      messages: [
        { role: 'assistant', content: '' },
        { role: 'user', content: [] },
        { role: 'assistant', content: [{ type: 'text', text: '' }] },
        { role: 'user', content: [{ type: 'text', text: '你好' }] }
      ]
    }

    const result = sanitizeClaudeMessagesRequest(body)

    expect(result).toEqual({
      ...unchangedSummary,
      changed: true,
      removedEmptyTextBlocks: 1,
      removedEmptyMessages: 3
    })
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: '你好' }] }])
  })

  it('repairs tool history from another relay without changing the current input', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '' },
            { type: 'tool_use', id: 'tool_1', name: 'read', input: { path: 'README.md' } }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool_1',
              content: [{ type: 'text', text: '' }]
            }
          ]
        },
        { role: 'user', content: [{ type: 'text', text: '你好' }] }
      ]
    }

    const result = sanitizeClaudeMessagesRequest(body)

    expect(result).toEqual({
      ...unchangedSummary,
      changed: true,
      removedEmptyTextBlocks: 2,
      removedEmptyToolResultContents: 1
    })
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool_1', name: 'read', input: { path: 'README.md' } }]
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool_1' }]
      },
      { role: 'user', content: [{ type: 'text', text: '你好' }] }
    ])
  })

  it('removes empty system content while preserving non-empty system text', () => {
    const body = {
      system: [
        { type: 'text', text: '' },
        { type: 'text', text: '  keep spacing  ' }
      ],
      messages: [{ role: 'user', content: 'hi' }]
    }

    const result = sanitizeClaudeMessagesRequest(body)

    expect(result).toEqual({
      ...unchangedSummary,
      changed: true,
      removedEmptyTextBlocks: 1
    })
    expect(body.system).toEqual([{ type: 'text', text: '  keep spacing  ' }])

    const emptySystemBody = {
      system: '',
      messages: [{ role: 'user', content: 'hi' }]
    }
    expect(sanitizeClaudeMessagesRequest(emptySystemBody)).toEqual({
      ...unchangedSummary,
      changed: true,
      removedEmptySystem: true
    })
    expect(emptySystemBody.system).toBeUndefined()

    const whitespaceSystemBody = {
      system: ' \n ',
      messages: [{ role: 'user', content: 'hi' }]
    }
    expect(sanitizeClaudeMessagesRequest(whitespaceSystemBody)).toEqual(unchangedSummary)
    expect(whitespaceSystemBody.system).toBe(' \n ')
  })

  it('is idempotent after sanitization', () => {
    const body = {
      messages: [
        { role: 'assistant', content: [{ type: 'text', text: '' }] },
        { role: 'user', content: [{ type: 'text', text: 'hello' }] }
      ]
    }

    expect(sanitizeClaudeMessagesRequest(body).changed).toBe(true)
    const sanitizedSnapshot = JSON.parse(JSON.stringify(body))

    expect(sanitizeClaudeMessagesRequest(body)).toEqual(unchangedSummary)
    expect(body).toEqual(sanitizedSnapshot)
  })

  it('handles invalid body shapes without throwing', () => {
    expect(sanitizeClaudeMessagesRequest(null)).toEqual(unchangedSummary)
    expect(
      sanitizeClaudeMessagesRequest({
        tools: 'not-an-array'
      })
    ).toEqual(unchangedSummary)
  })
})

describe('buildAnthropicErrorResponse', () => {
  it('builds a standard invalid request error with request id', () => {
    expect(
      buildAnthropicErrorResponse('Messages array cannot be empty', {
        type: 'invalid_request_error',
        requestId: '  req_local_123  '
      })
    ).toEqual({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'Messages array cannot be empty'
      },
      request_id: 'req_local_123'
    })
  })

  it('omits an empty request id and keeps the default API error type', () => {
    expect(buildAnthropicErrorResponse('', { requestId: '   ' })).toEqual({
      type: 'error',
      error: {
        type: 'api_error',
        message: 'Upstream error'
      }
    })
  })
})

describe('resolveClientRequestId', () => {
  it('prefers the NewAPI upstream header', () => {
    expect(
      resolveClientRequestId({
        'x-newapi-request-id': 'newapi-123',
        'x-oneapi-request-id': 'legacy-456',
        'x-request-id': 'generic-789'
      })
    ).toBe('newapi-123')
  })

  it('normalizes array values and strips control characters', () => {
    expect(resolveClientRequestId({ 'x-request-id': ['  req\n-123\t  ', 'ignored'] })).toBe(
      'req-123'
    )
    expect(resolveClientRequestId({})).toBeNull()
  })
})

describe('validateAnthropicMessagesRequest', () => {
  it('accepts a non-empty messages array', () => {
    expect(
      validateAnthropicMessagesRequest({ messages: [{ role: 'user', content: 'hello' }] })
    ).toBeNull()
  })

  it('rejects invalid request body and message shapes', () => {
    expect(validateAnthropicMessagesRequest(null)).toBe('Request body must be a valid JSON object')
    expect(validateAnthropicMessagesRequest([])).toBe('Request body must be a valid JSON object')
    expect(validateAnthropicMessagesRequest({ messages: 'hello' })).toBe(
      'Missing or invalid field: messages (must be an array)'
    )
    expect(validateAnthropicMessagesRequest({ messages: [] })).toBe(
      'Messages array cannot be empty'
    )
  })
})
