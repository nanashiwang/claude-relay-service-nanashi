const REMOVE_CONTENT_BLOCK = Symbol('removeContentBlock')
const MAX_CONTENT_NESTING = 8

function createSummary() {
  return {
    changed: false,
    removedContextManagement: false,
    removedToolInputExamples: 0,
    removedEmptyTextBlocks: 0,
    removedEmptyMessages: 0,
    removedEmptyToolResultContents: 0,
    removedEmptyContentContainers: 0,
    removedEmptySystem: false
  }
}

function isEmptyTextBlock(block) {
  return (
    block &&
    typeof block === 'object' &&
    !Array.isArray(block) &&
    block.type === 'text' &&
    typeof block.text === 'string' &&
    block.text.length === 0
  )
}

function sanitizeRequiredContent(container, field, summary, depth) {
  const originalContent = container[field]

  if (typeof originalContent === 'string') {
    if (originalContent.length > 0) {
      return true
    }
    summary.changed = true
    summary.removedEmptyContentContainers += 1
    return false
  }

  if (!Array.isArray(originalContent)) {
    return true
  }

  const cleanedContent = sanitizeContentBlocks(originalContent, summary, depth + 1)
  if (cleanedContent.length === 0) {
    summary.changed = true
    summary.removedEmptyContentContainers += 1
    return false
  }

  if (cleanedContent.length !== originalContent.length) {
    container[field] = cleanedContent
  }
  return true
}

function sanitizeContentBlock(block, summary, depth) {
  if (isEmptyTextBlock(block)) {
    summary.changed = true
    summary.removedEmptyTextBlocks += 1
    return REMOVE_CONTENT_BLOCK
  }

  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    return block
  }

  // Only follow content containers defined by Anthropic; tool_use.input remains arbitrary user JSON.
  if (block.type === 'tool_result' && Array.isArray(block.content)) {
    const originalContent = block.content
    const cleanedContent = sanitizeContentBlocks(originalContent, summary, depth + 1)

    if (cleanedContent.length === 0) {
      delete block.content
      summary.changed = true
      summary.removedEmptyToolResultContents += 1
    } else if (cleanedContent.length !== originalContent.length) {
      block.content = cleanedContent
    }
    return block
  }

  if (block.type === 'search_result' && Array.isArray(block.content)) {
    return sanitizeRequiredContent(block, 'content', summary, depth) ? block : REMOVE_CONTENT_BLOCK
  }

  if (
    block.type === 'document' &&
    block.source &&
    typeof block.source === 'object' &&
    !Array.isArray(block.source) &&
    block.source.type === 'content'
  ) {
    return sanitizeRequiredContent(block.source, 'content', summary, depth)
      ? block
      : REMOVE_CONTENT_BLOCK
  }

  return block
}

function sanitizeContentBlocks(blocks, summary, depth = 0) {
  if (depth > MAX_CONTENT_NESTING) {
    return blocks
  }

  const cleaned = []

  for (const block of blocks) {
    const sanitizedBlock = sanitizeContentBlock(block, summary, depth)
    if (sanitizedBlock !== REMOVE_CONTENT_BLOCK) {
      cleaned.push(sanitizedBlock)
    }
  }

  return cleaned
}

function sanitizeSystem(body, summary) {
  if (typeof body.system === 'string' && body.system.length === 0) {
    delete body.system
    summary.changed = true
    summary.removedEmptySystem = true
    return
  }

  if (!Array.isArray(body.system)) {
    return
  }

  const originalSystem = body.system
  const cleanedSystem = sanitizeContentBlocks(originalSystem, summary)

  if (cleanedSystem.length === 0) {
    delete body.system
    summary.changed = true
    summary.removedEmptySystem = true
  } else if (cleanedSystem.length !== originalSystem.length) {
    body.system = cleanedSystem
  }
}

function sanitizeMessages(body, summary) {
  if (!Array.isArray(body.messages)) {
    return
  }

  const cleanedMessages = []

  for (const message of body.messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      cleanedMessages.push(message)
      continue
    }

    if (typeof message.content === 'string' && message.content.length === 0) {
      summary.changed = true
      summary.removedEmptyMessages += 1
      continue
    }

    if (Array.isArray(message.content)) {
      const originalContent = message.content
      const cleanedContent = sanitizeContentBlocks(originalContent, summary)

      if (cleanedContent.length === 0) {
        summary.changed = true
        summary.removedEmptyMessages += 1
        continue
      }

      if (cleanedContent.length !== originalContent.length) {
        message.content = cleanedContent
      }
    }

    cleanedMessages.push(message)
  }

  if (cleanedMessages.length !== body.messages.length) {
    body.messages = cleanedMessages
  }
}

function sanitizeAnthropicMessagesRequest(body) {
  const summary = createSummary()

  if (!body || typeof body !== 'object') {
    return summary
  }

  sanitizeSystem(body, summary)
  sanitizeMessages(body, summary)

  return summary
}

function sanitizeClaudeCompatibilityFields(body, summary) {
  if (!body || typeof body !== 'object') {
    return
  }

  if (Object.prototype.hasOwnProperty.call(body, 'context_management')) {
    delete body.context_management
    summary.changed = true
    summary.removedContextManagement = true
  }

  if (Array.isArray(body.tools)) {
    body.tools.forEach((tool) => {
      if (!tool || typeof tool !== 'object') {
        return
      }

      if (Object.prototype.hasOwnProperty.call(tool, 'input_examples')) {
        delete tool.input_examples
        summary.changed = true
        summary.removedToolInputExamples += 1
      }
    })
  }
}

function sanitizeClaudeMessagesRequest(body) {
  const summary = sanitizeAnthropicMessagesRequest(body)

  sanitizeClaudeCompatibilityFields(body, summary)

  return summary
}

function sanitizeAnthropicRequestForService(body, requiredService) {
  if (requiredService === 'claude') {
    return sanitizeClaudeMessagesRequest(body)
  }

  return sanitizeAnthropicMessagesRequest(body)
}

function validateAnthropicMessagesRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a valid JSON object'
  }
  if (!Array.isArray(body.messages)) {
    return 'Missing or invalid field: messages (must be an array)'
  }
  if (body.messages.length === 0) {
    return 'Messages array cannot be empty'
  }
  return null
}

module.exports = {
  sanitizeAnthropicMessagesRequest,
  sanitizeAnthropicRequestForService,
  sanitizeClaudeMessagesRequest,
  validateAnthropicMessagesRequest
}
