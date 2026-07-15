function createSummary() {
  return {
    changed: false,
    removedContextManagement: false,
    removedToolInputExamples: 0,
    removedEmptyTextBlocks: 0,
    removedEmptyMessages: 0,
    removedEmptyToolResultContents: 0,
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

function sanitizeContentBlocks(blocks, summary, { sanitizeToolResults = false } = {}) {
  const cleaned = []

  for (const block of blocks) {
    if (isEmptyTextBlock(block)) {
      summary.changed = true
      summary.removedEmptyTextBlocks += 1
      continue
    }

    // tool_use.input is arbitrary user JSON, so only recurse into Anthropic-defined content fields.
    if (
      sanitizeToolResults &&
      block &&
      typeof block === 'object' &&
      !Array.isArray(block) &&
      block.type === 'tool_result' &&
      Array.isArray(block.content)
    ) {
      const originalContent = block.content
      const cleanedContent = sanitizeContentBlocks(originalContent, summary)

      if (cleanedContent.length === 0) {
        delete block.content
        summary.changed = true
        summary.removedEmptyToolResultContents += 1
      } else if (cleanedContent.length !== originalContent.length) {
        block.content = cleanedContent
      }
    }

    cleaned.push(block)
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
      const cleanedContent = sanitizeContentBlocks(originalContent, summary, {
        sanitizeToolResults: true
      })

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

function sanitizeClaudeMessagesRequest(body) {
  const summary = createSummary()

  if (!body || typeof body !== 'object') {
    return summary
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

  sanitizeSystem(body, summary)
  sanitizeMessages(body, summary)

  return summary
}

module.exports = {
  sanitizeClaudeMessagesRequest
}
