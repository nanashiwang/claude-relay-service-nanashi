const { sanitizeClaudeMessagesRequest } = require('../src/utils/anthropicRequestCompat')

describe('anthropicRequestCompat', () => {
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
      removedContextManagement: true,
      removedToolInputExamples: 0
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
      removedContextManagement: false,
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

    expect(result).toEqual({
      removedContextManagement: false,
      removedToolInputExamples: 0
    })
    expect(body).toEqual(snapshot)
  })

  it('handles invalid body shapes without throwing', () => {
    expect(sanitizeClaudeMessagesRequest(null)).toEqual({
      removedContextManagement: false,
      removedToolInputExamples: 0
    })
    expect(
      sanitizeClaudeMessagesRequest({
        tools: 'not-an-array'
      })
    ).toEqual({
      removedContextManagement: false,
      removedToolInputExamples: 0
    })
  })
})
