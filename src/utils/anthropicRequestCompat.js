function sanitizeClaudeMessagesRequest(body) {
  const summary = {
    removedContextManagement: false,
    removedToolInputExamples: 0
  }

  if (!body || typeof body !== 'object') {
    return summary
  }

  if (Object.prototype.hasOwnProperty.call(body, 'context_management')) {
    delete body.context_management
    summary.removedContextManagement = true
  }

  if (!Array.isArray(body.tools)) {
    return summary
  }

  body.tools.forEach((tool) => {
    if (!tool || typeof tool !== 'object') {
      return
    }

    if (Object.prototype.hasOwnProperty.call(tool, 'input_examples')) {
      delete tool.input_examples
      summary.removedToolInputExamples += 1
    }
  })

  return summary
}

module.exports = {
  sanitizeClaudeMessagesRequest
}
