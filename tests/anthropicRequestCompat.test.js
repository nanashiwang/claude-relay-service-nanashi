const { sanitizeClaudeMessagesRequest } = require('../src/utils/anthropicRequestCompat')

describe('anthropicRequestCompat', () => {
  const unchangedSummary = {
    changed: false,
    removedContextManagement: false,
    removedToolInputExamples: 0,
    removedEmptyTextBlocks: 0,
    removedEmptyMessages: 0,
    removedEmptyToolResultContents: 0,
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
