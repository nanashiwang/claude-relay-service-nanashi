const crypto = require('crypto')

/**
 * 生成随机十六进制字符串
 * @param {number} bytes - 字节数
 * @returns {string} 十六进制字符串
 */
function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex')
}

/**
 * 生成 Claude Code 风格的会话字符串
 * @returns {string} 会话字符串，格式: user_{64位hex}_account__session_{uuid}
 */
function generateSessionString() {
  const hex64 = randomHex(32) // 32 bytes => 64 hex characters
  const uuid = crypto.randomUUID()
  return `user_${hex64}_account__session_${uuid}`
}

/**
 * 生成 Claude 测试请求体
 * @param {string} model - 模型名称
 * @param {object} options - 可选配置
 * @param {boolean} options.stream - 是否流式（默认false）
 * @returns {object} 测试请求体
 */
function createClaudeTestPayload(model = 'claude-sonnet-4-5-20250929', options = {}) {
  const payload = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'hi',
            cache_control: {
              type: 'ephemeral'
            }
          }
        ]
      }
    ],
    system: [
      {
        type: 'text',
        text: "You are Claude Code, Anthropic's official CLI for Claude.",
        cache_control: {
          type: 'ephemeral'
        }
      }
    ],
    metadata: {
      user_id: generateSessionString()
    },
    max_tokens: 21333,
    temperature: 1
  }

  if (options.stream) {
    payload.stream = true
  }

  return payload
}

function createGeminiTestPayload() {
  return {
    contents: [
      {
        role: 'user',
        parts: [{ text: 'hi' }]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 128
    }
  }
}

function createCodexTestPayload(model = 'gpt-5.2-codex', options = {}) {
  const payload = {
    model,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: options.prompt || '\u4f60\u597d'
          }
        ]
      }
    ],
    parallel_tool_calls: false,
    reasoning: {
      effort: 'xhigh',
      summary: 'auto'
    },
    stream: options.stream === true
  }

  if (typeof options.instructions === 'string' && options.instructions.trim()) {
    payload.instructions = options.instructions.trim()
  }

  return payload
}

function extractErrorMessage(errorData, status) {
  const fallback = `API Error: ${status}`

  if (!errorData) {
    return fallback
  }

  if (typeof errorData === 'string') {
    const text = errorData.trim()
    return text || fallback
  }

  if (typeof errorData === 'object') {
    if (typeof errorData.message === 'string' && errorData.message.trim()) {
      return errorData.message.trim()
    }

    if (typeof errorData.error === 'string' && errorData.error.trim()) {
      return errorData.error.trim()
    }

    if (
      errorData.error &&
      typeof errorData.error.message === 'string' &&
      errorData.error.message.trim()
    ) {
      return errorData.error.message.trim()
    }
  }

  return fallback
}

function extractGeminiText(responseData) {
  const parts = responseData?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) {
    return ''
  }

  const text = parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()

  return text
}

function extractCodexText(responseData) {
  if (typeof responseData?.output_text === 'string' && responseData.output_text.trim()) {
    return responseData.output_text.trim()
  }

  if (Array.isArray(responseData?.output)) {
    const chunks = []

    for (const item of responseData.output) {
      if (typeof item?.text === 'string' && item.text.trim()) {
        chunks.push(item.text.trim())
      }

      if (Array.isArray(item?.content)) {
        for (const block of item.content) {
          if (typeof block?.text === 'string' && block.text.trim()) {
            chunks.push(block.text.trim())
          }
        }
      }
    }

    if (chunks.length > 0) {
      return chunks.join('\n')
    }
  }

  const choiceContent = responseData?.choices?.[0]?.message?.content
  if (typeof choiceContent === 'string' && choiceContent.trim()) {
    return choiceContent.trim()
  }

  if (Array.isArray(choiceContent)) {
    const text = choiceContent
      .map((block) => (typeof block?.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim()

    if (text) {
      return text
    }
  }

  return ''
}

function extractFallbackText(responseData) {
  if (typeof responseData?.text === 'string' && responseData.text.trim()) {
    return responseData.text.trim()
  }

  if (typeof responseData?.message === 'string' && responseData.message.trim()) {
    return responseData.message.trim()
  }

  if (typeof responseData?.error === 'string' && responseData.error.trim()) {
    return responseData.error.trim()
  }

  return ''
}

function extractProviderText(responseData, provider) {
  if (provider === 'gemini') {
    return extractGeminiText(responseData)
  }

  if (provider === 'codex') {
    return extractCodexText(responseData)
  }

  return extractFallbackText(responseData)
}

/**
 * 发送流式测试请求并处理SSE响应
 * @param {object} options - 配置选项
 * @param {string} options.apiUrl - API URL
 * @param {string} options.authorization - Authorization header值
 * @param {object} options.responseStream - Express响应流
 * @param {object} [options.payload] - 请求体（默认使用createClaudeTestPayload）
 * @param {object} [options.proxyAgent] - 代理agent
 * @param {number} [options.timeout] - 超时时间（默认30000）
 * @param {object} [options.extraHeaders] - 额外的请求头
 * @returns {Promise<void>}
 */
async function sendStreamTestRequest(options) {
  const axios = require('axios')
  const logger = require('./logger')

  const {
    apiUrl,
    authorization,
    responseStream,
    payload = createClaudeTestPayload('claude-sonnet-4-5-20250929', { stream: true }),
    proxyAgent = null,
    timeout = 30000,
    extraHeaders = {}
  } = options

  const sendSSE = (type, data = {}) => {
    if (!responseStream.destroyed && !responseStream.writableEnded) {
      try {
        responseStream.write(`data: ${JSON.stringify({ type, ...data })}\n\n`)
      } catch {
        // ignore
      }
    }
  }

  const endTest = (success, error = null) => {
    if (!responseStream.destroyed && !responseStream.writableEnded) {
      try {
        responseStream.write(
          `data: ${JSON.stringify({ type: 'test_complete', success, error: error || undefined })}\n\n`
        )
        responseStream.end()
      } catch {
        // ignore
      }
    }
  }

  // 设置响应头
  if (!responseStream.headersSent) {
    responseStream.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
  }

  sendSSE('test_start', { message: 'Test started' })

  const requestConfig = {
    method: 'POST',
    url: apiUrl,
    data: payload,
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'User-Agent': 'claude-cli/2.0.52 (external, cli)',
      authorization,
      ...extraHeaders
    },
    timeout,
    responseType: 'stream',
    validateStatus: () => true
  }

  if (proxyAgent) {
    requestConfig.httpAgent = proxyAgent
    requestConfig.httpsAgent = proxyAgent
    requestConfig.proxy = false
  }

  try {
    const response = await axios(requestConfig)
    logger.debug(`🌊 Test response status: ${response.status}`)

    // 处理非200响应
    if (response.status !== 200) {
      return new Promise((resolve) => {
        const chunks = []
        response.data.on('data', (chunk) => chunks.push(chunk))
        response.data.on('end', () => {
          const errorData = Buffer.concat(chunks).toString()
          let errorMsg = `API Error: ${response.status}`
          try {
            const json = JSON.parse(errorData)
            errorMsg = json.message || json.error?.message || json.error || errorMsg
          } catch {
            if (errorData.length < 200) {
              errorMsg = errorData || errorMsg
            }
          }
          endTest(false, errorMsg)
          resolve()
        })
        response.data.on('error', (err) => {
          endTest(false, err.message)
          resolve()
        })
      })
    }

    // 处理成功的流式响应
    return new Promise((resolve) => {
      let buffer = ''

      response.data.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data:')) {
            continue
          }
          const jsonStr = line.substring(5).trim()
          if (!jsonStr || jsonStr === '[DONE]') {
            continue
          }

          try {
            const data = JSON.parse(jsonStr)

            if (data.type === 'content_block_delta' && data.delta?.text) {
              sendSSE('content', { text: data.delta.text })
            }
            if (data.type === 'message_stop') {
              sendSSE('message_stop')
            }
            if (data.type === 'error' || data.error) {
              const errMsg = data.error?.message || data.message || data.error || 'Unknown error'
              sendSSE('error', { error: errMsg })
            }
          } catch {
            // ignore parse errors
          }
        }
      })

      response.data.on('end', () => {
        if (!responseStream.destroyed && !responseStream.writableEnded) {
          endTest(true)
        }
        resolve()
      })

      response.data.on('error', (err) => {
        endTest(false, err.message)
        resolve()
      })
    })
  } catch (error) {
    logger.error('❌ Stream test request failed:', error.message)
    endTest(false, error.message)
  }
}


function extractCodexStreamDelta(data) {
  if (!data || typeof data !== 'object') {
    return ''
  }

  if (data.type === 'response.output_text.delta' && typeof data.delta === 'string') {
    return data.delta
  }

  if (data.type === 'content_block_delta' && typeof data.delta?.text === 'string') {
    return data.delta.text
  }

  if (typeof data.text === 'string') {
    return data.text
  }

  return ''
}

async function sendCodexStreamTestRequest(options) {
  const axios = require('axios')
  const logger = require('./logger')

  const {
    apiUrl,
    authorization,
    responseStream,
    payload = createCodexTestPayload('gpt-5.2-codex', { stream: true }),
    proxyAgent = null,
    timeout = 30000,
    extraHeaders = {}
  } = options

  const sendSSE = (type, data = {}) => {
    if (!responseStream.destroyed && !responseStream.writableEnded) {
      try {
        responseStream.write(`data: ${JSON.stringify({ type, ...data })}\n\n`)
      } catch {
        // ignore
      }
    }
  }

  const endTest = (success, error = null) => {
    if (!responseStream.destroyed && !responseStream.writableEnded) {
      try {
        responseStream.write(
          `data: ${JSON.stringify({ type: 'test_complete', success, error: error || undefined })}\n\n`
        )
        responseStream.end()
      } catch {
        // ignore
      }
    }
  }

  if (!responseStream.headersSent) {
    responseStream.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
  }

  sendSSE('test_start', { message: 'Test started' })

  const requestConfig = {
    method: 'POST',
    url: apiUrl,
    data: payload,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'User-Agent': 'codex_cli_rs/0.50.0 (crs-api-key-test)',
      authorization,
      ...extraHeaders
    },
    timeout,
    responseType: 'stream',
    validateStatus: () => true
  }

  if (proxyAgent) {
    requestConfig.httpAgent = proxyAgent
    requestConfig.httpsAgent = proxyAgent
    requestConfig.proxy = false
  }

  try {
    const response = await axios(requestConfig)
    logger.debug(`Codex stream test response status: ${response.status}`)

    if (response.status < 200 || response.status >= 300) {
      return await new Promise((resolve) => {
        const chunks = []
        response.data.on('data', (chunk) => chunks.push(chunk))
        response.data.on('end', () => {
          const raw = Buffer.concat(chunks).toString()
          let parsed = raw
          try {
            parsed = JSON.parse(raw)
          } catch {
            // keep raw text
          }
          endTest(false, extractErrorMessage(parsed, response.status))
          resolve()
        })
        response.data.on('error', (err) => {
          endTest(false, err.message)
          resolve()
        })
      })
    }

    return await new Promise((resolve) => {
      let buffer = ''
      let hasError = false
      let hasMessageStop = false
      let firstError = ''

      response.data.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data:')) {
            continue
          }

          const jsonStr = line.substring(5).trim()
          if (!jsonStr) {
            continue
          }

          if (jsonStr === '[DONE]') {
            hasMessageStop = true
            sendSSE('message_stop')
            continue
          }

          try {
            const data = JSON.parse(jsonStr)

            if (data.type === 'error' || data.error) {
              const errMsg = extractErrorMessage(data, response.status)
              hasError = true
              if (!firstError) {
                firstError = errMsg
              }
              sendSSE('error', { error: errMsg })
              continue
            }

            const delta = extractCodexStreamDelta(data)
            if (delta) {
              sendSSE('content', { text: delta })
            }

            if (data.type === 'response.completed' || data.type === 'message_stop') {
              hasMessageStop = true
              sendSSE('message_stop')
            }
          } catch {
            // ignore parse errors
          }
        }
      })

      response.data.on('end', () => {
        if (hasError) {
          endTest(false, firstError || 'Codex stream test failed')
          resolve()
          return
        }

        if (!hasMessageStop) {
          sendSSE('message_stop')
        }
        endTest(true)
        resolve()
      })

      response.data.on('error', (err) => {
        endTest(false, err.message)
        resolve()
      })
    })
  } catch (error) {
    logger.error('Codex stream test request failed:', error.message)
    endTest(false, error.message)
  }
}

async function sendJsonTestRequest(options) {
  const axios = require('axios')
  const logger = require('./logger')

  const {
    apiUrl,
    authorization,
    responseStream,
    payload = {},
    proxyAgent = null,
    timeout = 30000,
    extraHeaders = {},
    provider = 'generic'
  } = options

  const sendSSE = (type, data = {}) => {
    if (!responseStream.destroyed && !responseStream.writableEnded) {
      try {
        responseStream.write(`data: ${JSON.stringify({ type, ...data })}\n\n`)
      } catch {
        // ignore
      }
    }
  }

  const endTest = (success, error = null) => {
    if (!responseStream.destroyed && !responseStream.writableEnded) {
      try {
        responseStream.write(
          `data: ${JSON.stringify({ type: 'test_complete', success, error: error || undefined })}\n\n`
        )
        responseStream.end()
      } catch {
        // ignore
      }
    }
  }

  if (!responseStream.headersSent) {
    responseStream.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
  }

  sendSSE('test_start', { message: 'Test started' })

  const requestConfig = {
    method: 'POST',
    url: apiUrl,
    data: payload,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'crs-api-key-test/1.0',
      authorization,
      ...extraHeaders
    },
    timeout,
    responseType: 'json',
    validateStatus: () => true
  }

  if (proxyAgent) {
    requestConfig.httpAgent = proxyAgent
    requestConfig.httpsAgent = proxyAgent
    requestConfig.proxy = false
  }

  try {
    const response = await axios(requestConfig)
    logger.debug(`Test response status: ${response.status}`)

    if (response.status < 200 || response.status >= 300) {
      const errorMsg = extractErrorMessage(response.data, response.status)
      endTest(false, errorMsg)
      return
    }

    const text = extractProviderText(response.data, provider)
    if (text) {
      sendSSE('content', { text })
    }

    sendSSE('message_stop')
    endTest(true)
  } catch (error) {
    logger.error('JSON test request failed:', error.message)
    endTest(false, error.message)
  }
}

module.exports = {
  randomHex,
  generateSessionString,
  createClaudeTestPayload,
  createGeminiTestPayload,
  createCodexTestPayload,
  sendStreamTestRequest,
  sendCodexStreamTestRequest,
  sendJsonTestRequest
}
