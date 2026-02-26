const express = require('express')
const { authenticateApiKey } = require('../middleware/auth')
const logger = require('../utils/logger')
const { handleChatCompletion } = require('./openaiClaudeRoutes')
// 从 handlers/geminiHandlers.js 导入处理函数
const {
  handleGenerateContent: geminiHandleGenerateContent,
  handleStreamGenerateContent: geminiHandleStreamGenerateContent
} = require('../handlers/geminiHandlers')
const openaiRoutes = require('./openaiRoutes')
const apiKeyService = require('../services/apiKeyService')

const router = express.Router()

// 🔍 根据模型名称检测后端类型
function detectBackendFromModel(modelName) {
  if (!modelName) {
    return 'claude' // 默认 Claude
  }

  const model = modelName.toLowerCase()

  // Claude 模型
  if (model.startsWith('claude-')) {
    return 'claude'
  }

  // Gemini 模型
  if (model.startsWith('gemini-')) {
    return 'gemini'
  }

  // OpenAI 模型
  if (model.startsWith('gpt-')) {
    return 'openai'
  }

  // 默认使用 Claude
  return 'claude'
}

// 🚀 智能后端路由处理器
async function routeToBackend(req, res, requestedModel) {
  const backend = detectBackendFromModel(requestedModel)

  logger.info(`🔀 Routing request - Model: ${requestedModel}, Backend: ${backend}`)

  // 检查权限
  const { permissions } = req.apiKey

  if (backend === 'claude') {
    // Claude 后端：通过 OpenAI 兼容层
    if (!apiKeyService.hasPermission(permissions, 'claude')) {
      return res.status(403).json({
        error: {
          message: 'This API key does not have permission to access Claude',
          type: 'permission_denied',
          code: 'permission_denied'
        }
      })
    }
    await handleChatCompletion(req, res, req.apiKey)
  } else if (backend === 'openai') {
    // OpenAI 后端
    if (!apiKeyService.hasPermission(permissions, 'openai')) {
      return res.status(403).json({
        error: {
          message: 'This API key does not have permission to access OpenAI',
          type: 'permission_denied',
          code: 'permission_denied'
        }
      })
    }
    req._openaiCompatMode = 'chat_completions'
    return await openaiRoutes.handleResponses(req, res)
  } else if (backend === 'gemini') {
    // Gemini 后端
    if (!apiKeyService.hasPermission(permissions, 'gemini')) {
      return res.status(403).json({
        error: {
          message: 'This API key does not have permission to access Gemini',
          type: 'permission_denied',
          code: 'permission_denied'
        }
      })
    }

    // 转换为 Gemini 格式
    const geminiRequest = {
      model: requestedModel,
      messages: req.body.messages,
      temperature: req.body.temperature || 0.7,
      max_tokens: req.body.max_tokens || 4096,
      stream: req.body.stream || false
    }

    req.body = geminiRequest

    if (geminiRequest.stream) {
      return await geminiHandleStreamGenerateContent(req, res)
    } else {
      return await geminiHandleGenerateContent(req, res)
    }
  } else {
    return res.status(500).json({
      error: {
        message: `Unsupported backend: ${backend}`,
        type: 'server_error',
        code: 'unsupported_backend'
      }
    })
  }
}

// 🔄 OpenAI 兼容的 chat/completions 端点（智能后端路由）
router.post(['/v1/chat/completions', '/chat/completions'], authenticateApiKey, async (req, res) => {
  try {
    // 验证必需参数
    if (!req.body.messages || !Array.isArray(req.body.messages) || req.body.messages.length === 0) {
      return res.status(400).json({
        error: {
          message: 'Messages array is required and cannot be empty',
          type: 'invalid_request_error',
          code: 'invalid_request'
        }
      })
    }

    const requestedModel = req.body.model || 'claude-3-5-sonnet-20241022'
    req.body.model = requestedModel // 确保模型已设置

    // 使用统一的后端路由处理器
    await routeToBackend(req, res, requestedModel)
  } catch (error) {
    logger.error('❌ OpenAI chat/completions error:', error)
    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: 'Internal server error',
          type: 'server_error',
          code: 'internal_error'
        }
      })
    }
  }
})

// 🔄 OpenAI 兼容的 completions 端点（传统格式，智能后端路由）
router.post(['/v1/completions', '/completions'], authenticateApiKey, async (req, res) => {
  try {
    // 验证必需参数
    if (!req.body.prompt) {
      return res.status(400).json({
        error: {
          message: 'Prompt is required',
          type: 'invalid_request_error',
          code: 'invalid_request'
        }
      })
    }

    // 将传统 completions 格式转换为 chat 格式
    const originalBody = req.body
    const requestedModel = originalBody.model || 'claude-3-5-sonnet-20241022'

    req.body = {
      model: requestedModel,
      messages: [
        {
          role: 'user',
          content: originalBody.prompt
        }
      ],
      max_tokens: originalBody.max_tokens,
      temperature: originalBody.temperature,
      top_p: originalBody.top_p,
      stream: originalBody.stream,
      stop: originalBody.stop,
      n: originalBody.n || 1,
      presence_penalty: originalBody.presence_penalty,
      frequency_penalty: originalBody.frequency_penalty,
      logit_bias: originalBody.logit_bias,
      user: originalBody.user
    }

    // 使用统一的后端路由处理器
    await routeToBackend(req, res, requestedModel)
  } catch (error) {
    logger.error('❌ OpenAI completions error:', error)
    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: 'Failed to process completion request',
          type: 'server_error',
          code: 'internal_error'
        }
      })
    }
  }
})

module.exports = router
module.exports.detectBackendFromModel = detectBackendFromModel
module.exports.routeToBackend = routeToBackend
