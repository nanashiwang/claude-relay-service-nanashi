<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="fixed inset-0 z-[1050] flex items-center justify-center bg-gray-900/40 backdrop-blur-sm"
    >
      <div class="absolute inset-0" @click="handleClose" />
      <div
        class="relative z-10 mx-3 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white/95 shadow-2xl ring-1 ring-black/5 transition-all dark:border-gray-700/60 dark:bg-gray-900/95 dark:ring-white/10 sm:mx-4"
      >
        <!-- 顶部栏 -->
        <div
          class="flex items-center justify-between border-b border-gray-100 bg-white/80 px-5 py-4 backdrop-blur dark:border-gray-800 dark:bg-gray-900/80"
        >
          <div class="flex items-center gap-3">
            <div
              :class="[
                'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-white shadow-lg',
                testStatus === 'success'
                  ? 'bg-gradient-to-br from-green-500 to-emerald-500'
                  : testStatus === 'error'
                    ? 'bg-gradient-to-br from-red-500 to-pink-500'
                    : 'bg-gradient-to-br from-blue-500 to-indigo-500'
              ]"
            >
              <i
                :class="[
                  'fas',
                  testStatus === 'idle'
                    ? 'fa-vial'
                    : testStatus === 'testing'
                      ? 'fa-spinner fa-spin'
                      : testStatus === 'success'
                        ? 'fa-check'
                        : 'fa-times'
                ]"
              />
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
                API Key 端点测试
              </h3>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ displayName }}
              </p>
            </div>
          </div>
          <button
            class="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200 hover:text-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            :disabled="testStatus === 'testing'"
            @click="handleClose"
          >
            <i class="fas fa-times text-sm" />
          </button>
        </div>

        <!-- 内容区域 -->
        <div class="max-h-[70vh] overflow-y-auto px-5 py-4">
          <!-- API Key 显示区域（只读） -->
          <div class="mb-4">
            <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              API Key
            </label>
            <div class="relative">
              <input
                class="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 pr-10 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                readonly
                type="text"
                :value="maskedApiKey"
              />
              <div class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
                <i class="fas fa-lock text-xs" />
              </div>
            </div>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              测试将使用此 API Key 调用当前服务的 /api 端点
            </p>
          </div>

          <!-- 测试参数 -->
          <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                测试平台
              </label>
              <select
                v-model="testProvider"
                class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                :disabled="testStatus === 'testing'"
              >
                <option v-for="option in providerOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
              <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                Default: {{ inferredProviderLabel }} (inferred from bound accounts)
              </p>
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                测试模型
              </label>
              <select
                v-model="testModel"
                class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                :disabled="testStatus === 'testing'"
              >
                <option v-for="option in currentModelOptions" :key="option" :value="option">
                  {{ option }}
                </option>
              </select>
            </div>
          </div>

          <!-- 测试信息 -->
          <div class="mb-4 space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-gray-500 dark:text-gray-400">测试端点</span>
              <span
                class="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"
              >
                <i class="fas fa-link" />
                {{ testEndpoint }}
              </span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-gray-500 dark:text-gray-400">测试模型</span>
              <span class="font-medium text-gray-700 dark:text-gray-300">{{ testModel }}</span>
            </div>
            <div class="flex items-center justify-between text-sm">
              <span class="text-gray-500 dark:text-gray-400">模拟客户端</span>
              <span class="font-medium text-gray-700 dark:text-gray-300">{{ simulatedClient }}</span>
            </div>
          </div>

          <!-- Sticky Diagnostics -->
          <div class="mb-4 rounded-xl border border-indigo-200/70 bg-indigo-50/70 p-3 dark:border-indigo-500/30 dark:bg-indigo-900/20">
            <div class="mb-2 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <i class="fas fa-heartbeat text-sm text-indigo-500 dark:text-indigo-300" />
                <span class="text-xs font-semibold text-indigo-700 dark:text-indigo-200">Sticky Diagnostics</span>
              </div>
              <button
                class="rounded-md border border-indigo-200 bg-white px-2 py-1 text-xs text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-500/40 dark:bg-indigo-900/40 dark:text-indigo-200 dark:hover:bg-indigo-900/60"
                :disabled="stickyDiagnosticsLoading"
                @click="fetchStickyDiagnostics"
              >
                <i :class="['fas', stickyDiagnosticsLoading ? 'fa-spinner fa-spin' : 'fa-rotate-right']" />
                <span class="ml-1">Refresh</span>
              </button>
            </div>

            <div
              v-if="stickyDiagnosticsLoading"
              class="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-200"
            >
              <i class="fas fa-circle-notch fa-spin" />
              <span>Loading diagnostics...</span>
            </div>

            <div
              v-else-if="stickyDiagnosticsError"
              class="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-300"
            >
              {{ stickyDiagnosticsError }}
            </div>

            <div v-else-if="stickyDiagnostics" class="space-y-2">
              <div class="grid grid-cols-1 gap-1.5 text-xs text-gray-600 dark:text-gray-300 sm:grid-cols-2">
                <div class="flex items-center justify-between rounded-md bg-white/70 px-2 py-1 dark:bg-gray-900/40">
                  <span>Auto Renewal</span>
                  <span class="font-medium text-gray-800 dark:text-gray-100">{{ stickyAutoRenewText }}</span>
                </div>
                <div class="flex items-center justify-between rounded-md bg-white/70 px-2 py-1 dark:bg-gray-900/40">
                  <span>Full TTL</span>
                  <span class="font-medium text-gray-800 dark:text-gray-100">{{ stickyTtlText }}</span>
                </div>
                <div class="flex items-center justify-between rounded-md bg-white/70 px-2 py-1 dark:bg-gray-900/40">
                  <span>Renew Threshold</span>
                  <span class="font-medium text-gray-800 dark:text-gray-100">
                    {{ stickyThresholdText }} ({{ stickyRenewalModeText }})
                  </span>
                </div>
                <div class="flex items-center justify-between rounded-md bg-white/70 px-2 py-1 dark:bg-gray-900/40">
                  <span>Active Sessions</span>
                  <span class="font-medium text-gray-800 dark:text-gray-100">
                    {{ stickyDiagnostics.activeSessionCount }}
                  </span>
                </div>
              </div>

              <p v-if="stickyDiagnostics.note" class="text-[11px] text-gray-500 dark:text-gray-400">
                {{ stickyDiagnostics.note }}
              </p>

              <div
                v-if="stickySessionRows.length > 0"
                class="max-h-32 space-y-1 overflow-y-auto rounded-md border border-indigo-100 bg-white/70 p-2 dark:border-indigo-500/20 dark:bg-gray-900/40"
              >
                <div
                  v-for="session in stickySessionRows"
                  :key="`${session.provider}:${session.sessionHash}:${session.accountId}`"
                  class="grid grid-cols-[1fr_auto] gap-2 text-[11px] text-gray-600 dark:text-gray-300"
                >
                  <div class="truncate" :title="getSessionIdentity(session)">
                    <span class="font-medium text-gray-800 dark:text-gray-100">
                      {{ session.accountType }} / {{ session.accountId }}
                    </span>
                    <span class="ml-1 text-gray-500 dark:text-gray-400">
                      {{ getSessionIdentity(session) }}
                    </span>
                  </div>
                  <span class="font-medium text-indigo-600 dark:text-indigo-300">
                    {{ formatDuration(session.ttlSeconds) }}
                  </span>
                </div>
              </div>
            </div>

            <div v-else class="text-xs text-gray-500 dark:text-gray-400">No diagnostics data</div>
          </div>

          <!-- 状态指示 -->
          <div :class="['mb-4 rounded-xl border p-4 transition-all duration-300', statusCardClass]">
            <div class="flex items-center gap-3">
              <div
                :class="['flex h-8 w-8 items-center justify-center rounded-lg', statusIconBgClass]"
              >
                <i :class="['fas text-sm', statusIcon, statusIconClass]" />
              </div>
              <div>
                <p :class="['font-medium', statusTextClass]">{{ statusTitle }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ statusDescription }}</p>
              </div>
            </div>
          </div>

          <!-- 响应内容区域 -->
          <div
            v-if="testStatus !== 'idle'"
            class="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50"
          >
            <div
              class="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
            >
              <span class="text-xs font-medium text-gray-600 dark:text-gray-400">AI 响应</span>
              <span v-if="responseText" class="text-xs text-gray-500 dark:text-gray-500">
                {{ responseText.length }} 字符
              </span>
            </div>
            <div class="max-h-40 overflow-y-auto p-3">
              <p
                v-if="responseText"
                class="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300"
              >
                {{ responseText }}
                <span
                  v-if="testStatus === 'testing'"
                  class="inline-block h-4 w-1 animate-pulse bg-blue-500"
                />
              </p>
              <p
                v-else-if="testStatus === 'testing'"
                class="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400"
              >
                <i class="fas fa-circle-notch fa-spin" />
                等待响应中...
              </p>
              <p
                v-else-if="testStatus === 'error' && errorMessage"
                class="text-sm text-red-600 dark:text-red-400"
              >
                {{ errorMessage }}
              </p>
            </div>
          </div>

          <!-- 测试时间 -->
          <div
            v-if="testDuration > 0"
            class="mb-4 flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400"
          >
            <i class="fas fa-clock" />
            <span>耗时 {{ (testDuration / 1000).toFixed(2) }} 秒</span>
          </div>
        </div>

        <!-- 底部操作栏 -->
        <div
          class="flex items-center justify-end gap-3 border-t border-gray-100 bg-gray-50/80 px-5 py-3 dark:border-gray-800 dark:bg-gray-900/50"
        >
          <button
            class="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 hover:shadow dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            :disabled="testStatus === 'testing'"
            @click="handleClose"
          >
            关闭
          </button>
          <button
            :class="[
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition',
              testStatus === 'testing' || !apiKeyValue
                ? 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                : 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white hover:from-blue-600 hover:to-indigo-600 hover:shadow-md'
            ]"
            :disabled="testStatus === 'testing' || !apiKeyValue"
            @click="startTest"
          >
            <i :class="['fas', testStatus === 'testing' ? 'fa-spinner fa-spin' : 'fa-play']" />
            {{
              testStatus === 'testing'
                ? '测试中...'
                : testStatus === 'idle'
                  ? '开始测试'
                  : '重新测试'
            }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { API_PREFIX } from '@/config/api'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  apiKeyValue: {
    type: String,
    default: ''
  },
  apiKeyName: {
    type: String,
    default: ''
  },
  apiKeyProfile: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close'])

const PROVIDER_CONFIG = {
  claude: {
    label: 'Claude',
    endpoint: '/api/v1/messages',
    client: 'Claude Code',
    defaultModel: 'claude-sonnet-4-5-20250929',
    models: ['claude-sonnet-4-5-20250929', 'claude-opus-4-1-20250805']
  },
  gemini: {
    label: 'Gemini',
    endpoint: '/gemini/v1beta/models/{model}:generateContent',
    client: 'Gemini CLI',
    defaultModel: 'gemini-2.5-pro',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash']
  },
  codex: {
    label: 'Codex',
    endpoint: '/openai/v1/responses',
    client: 'Codex CLI',
    defaultModel: 'gpt-5.2-codex',
    models: ['gpt-5.2-codex', 'gpt-5', 'gpt-5-mini']
  }
}

function hasBoundAccount(accountId) {
  return typeof accountId === 'string' && accountId.trim().length > 0
}

function inferProviderFromApiKeyProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return 'claude'
  }

  const accounts = profile.accounts || {}
  if (hasBoundAccount(accounts.openaiAccountId)) {
    return 'codex'
  }
  if (hasBoundAccount(accounts.geminiAccountId)) {
    return 'gemini'
  }
  if (hasBoundAccount(accounts.claudeAccountId)) {
    return 'claude'
  }

  const restrictedModels = profile.restrictions?.restrictedModels
  if (Array.isArray(restrictedModels)) {
    const normalizedModels = restrictedModels.map((item) => String(item).toLowerCase())
    if (normalizedModels.some((item) => item.includes('gpt') || item.includes('codex'))) {
      return 'codex'
    }
    if (normalizedModels.some((item) => item.includes('gemini'))) {
      return 'gemini'
    }
    if (normalizedModels.some((item) => item.includes('claude'))) {
      return 'claude'
    }
  }

  return 'claude'
}

const RENEWAL_MODE_LABELS = {
  auto: 'Auto',
  manual: 'Manual',
  disabled: 'Disabled'
}

const testStatus = ref('idle')
const responseText = ref('')
const errorMessage = ref('')
const testDuration = ref(0)
const testStartTime = ref(null)
const abortController = ref(null)

const stickyDiagnostics = ref(null)
const stickyDiagnosticsLoading = ref(false)
const stickyDiagnosticsError = ref('')
const stickyDiagnosticsAbortController = ref(null)

const testProvider = ref('claude')
const testModel = ref(PROVIDER_CONFIG.claude.defaultModel)

const displayName = computed(() => {
  return props.apiKeyName || 'Current API Key'
})

const maskedApiKey = computed(() => {
  const key = props.apiKeyValue
  if (!key) return ''
  if (key.length <= 10) return '****'
  return key.substring(0, 6) + '****' + key.substring(key.length - 4)
})

const currentProviderConfig = computed(() => {
  return PROVIDER_CONFIG[testProvider.value] || PROVIDER_CONFIG.claude
})

const providerOptions = computed(() => {
  return Object.entries(PROVIDER_CONFIG).map(([value, config]) => ({
    value,
    label: config.label
  }))
})

const currentModelOptions = computed(() => {
  return currentProviderConfig.value.models
})

const testEndpoint = computed(() => {
  return currentProviderConfig.value.endpoint
})

const simulatedClient = computed(() => {
  return currentProviderConfig.value.client
})

const stickyPolicy = computed(() => stickyDiagnostics.value?.policy || null)

const stickySessionRows = computed(() => {
  const sessions = stickyDiagnostics.value?.sessions || []
  return sessions.slice(0, 8)
})

const stickyAutoRenewText = computed(() => {
  if (!stickyPolicy.value) return '--'
  return stickyPolicy.value.autoRenewEnabled ? 'Enabled' : 'Disabled'
})

const stickyRenewalModeText = computed(() => {
  const mode = stickyPolicy.value?.renewalMode
  return RENEWAL_MODE_LABELS[mode] || '--'
})

const stickyTtlText = computed(() => formatDuration(stickyPolicy.value?.fullTTLSeconds))

const stickyThresholdText = computed(() => {
  const seconds = stickyPolicy.value?.renewalThresholdSeconds
  if (seconds === null || seconds === undefined) {
    return '--'
  }
  if (seconds <= 0) {
    return '0 min'
  }
  return `${Math.ceil(seconds / 60)} min`
})

const statusTitle = computed(() => {
  switch (testStatus.value) {
    case 'idle':
      return 'Ready'
    case 'testing':
      return 'Testing...'
    case 'success':
      return 'Success'
    case 'error':
      return 'Failed'
    default:
      return 'Unknown'
  }
})

const statusDescription = computed(() => {
  switch (testStatus.value) {
    case 'idle':
      return 'Click the button below to start endpoint testing'
    case 'testing':
      return `Sending request to ${testEndpoint.value}`
    case 'success':
      return 'The API key can access this service'
    case 'error':
      return errorMessage.value || 'The API key failed to access this service'
    default:
      return ''
  }
})

const statusCardClass = computed(() => {
  switch (testStatus.value) {
    case 'idle':
      return 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'
    case 'testing':
      return 'border-blue-200 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-900/20'
    case 'success':
      return 'border-green-200 bg-green-50 dark:border-green-500/30 dark:bg-green-900/20'
    case 'error':
      return 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-900/20'
    default:
      return 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'
  }
})

const statusIconBgClass = computed(() => {
  switch (testStatus.value) {
    case 'idle':
      return 'bg-gray-200 dark:bg-gray-700'
    case 'testing':
      return 'bg-blue-100 dark:bg-blue-500/30'
    case 'success':
      return 'bg-green-100 dark:bg-green-500/30'
    case 'error':
      return 'bg-red-100 dark:bg-red-500/30'
    default:
      return 'bg-gray-200 dark:bg-gray-700'
  }
})

const statusIcon = computed(() => {
  switch (testStatus.value) {
    case 'idle':
      return 'fa-hourglass-start'
    case 'testing':
      return 'fa-spinner fa-spin'
    case 'success':
      return 'fa-check-circle'
    case 'error':
      return 'fa-exclamation-circle'
    default:
      return 'fa-question-circle'
  }
})

const statusIconClass = computed(() => {
  switch (testStatus.value) {
    case 'idle':
      return 'text-gray-500 dark:text-gray-400'
    case 'testing':
      return 'text-blue-500 dark:text-blue-400'
    case 'success':
      return 'text-green-500 dark:text-green-400'
    case 'error':
      return 'text-red-500 dark:text-red-400'
    default:
      return 'text-gray-500 dark:text-gray-400'
  }
})

const statusTextClass = computed(() => {
  switch (testStatus.value) {
    case 'idle':
      return 'text-gray-700 dark:text-gray-300'
    case 'testing':
      return 'text-blue-700 dark:text-blue-300'
    case 'success':
      return 'text-green-700 dark:text-green-300'
    case 'error':
      return 'text-red-700 dark:text-red-300'
    default:
      return 'text-gray-700 dark:text-gray-300'
  }
})

const inferredProvider = computed(() => inferProviderFromApiKeyProfile(props.apiKeyProfile))
const inferredProviderLabel = computed(() => PROVIDER_CONFIG[inferredProvider.value]?.label || 'Claude')

function applyInferredProvider() {
  const provider = inferredProvider.value
  const providerConfig = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.claude
  testProvider.value = provider
  testModel.value = providerConfig.defaultModel
}

function formatDuration(seconds) {
  const duration = Number(seconds)
  if (!Number.isFinite(duration) || duration < 0) {
    return '--'
  }

  if (duration < 60) {
    return `${Math.floor(duration)}s`
  }

  const minutes = Math.floor(duration / 60)
  if (minutes < 60) {
    return `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (!remainingMinutes) {
    return `${hours}h`
  }

  return `${hours}h ${remainingMinutes}m`
}

function getSessionIdentity(session) {
  if (!session) {
    return '--'
  }
  if (session.oauthProvider) {
    return `${session.sessionPreview} (${session.oauthProvider})`
  }
  return session.sessionPreview || '--'
}

function resetStickyDiagnosticsState() {
  stickyDiagnostics.value = null
  stickyDiagnosticsError.value = ''
  stickyDiagnosticsLoading.value = false
}

function abortStickyDiagnosticsRequest() {
  if (stickyDiagnosticsAbortController.value) {
    stickyDiagnosticsAbortController.value.abort()
    stickyDiagnosticsAbortController.value = null
  }
}

async function fetchStickyDiagnostics() {
  if (!props.apiKeyValue) {
    resetStickyDiagnosticsState()
    return
  }

  abortStickyDiagnosticsRequest()
  const controller = new AbortController()
  stickyDiagnosticsAbortController.value = controller

  stickyDiagnosticsLoading.value = true
  stickyDiagnosticsError.value = ''

  try {
    const response = await fetch(`${API_PREFIX}/apiStats/api-key/sticky-diagnostics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        apiKey: props.apiKeyValue,
        provider: testProvider.value
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`)
    }

    const result = await response.json()
    if (!result?.success) {
      throw new Error(result?.message || 'Failed to fetch sticky diagnostics')
    }

    stickyDiagnostics.value = result.data || null
  } catch (err) {
    if (err.name === 'AbortError') {
      return
    }
    stickyDiagnostics.value = null
    stickyDiagnosticsError.value = err.message || 'Failed to fetch sticky diagnostics'
  } finally {
    if (stickyDiagnosticsAbortController.value === controller) {
      stickyDiagnosticsAbortController.value = null
    }
    stickyDiagnosticsLoading.value = false
  }
}

async function startTest() {
  if (!props.apiKeyValue) return

  testStatus.value = 'testing'
  responseText.value = ''
  errorMessage.value = ''
  testDuration.value = 0
  testStartTime.value = Date.now()

  if (abortController.value) {
    abortController.value.abort()
  }
  abortController.value = new AbortController()

  const endpoint = `${API_PREFIX}/apiStats/api-key/test`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        apiKey: props.apiKeyValue,
        provider: testProvider.value,
        model: testModel.value
      }),
      signal: abortController.value.signal
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || errorData.error || `HTTP ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let streamDone = false

    while (!streamDone) {
      const { done, value } = await reader.read()
      if (done) {
        streamDone = true
        continue
      }

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6))
            handleSSEEvent(data)
          } catch {
            // ignore parse errors
          }
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      return
    }
    testStatus.value = 'error'
    errorMessage.value = err.message || 'Connection failed'
    testDuration.value = Date.now() - testStartTime.value
  }
}

watch(
  testProvider,
  (newProvider) => {
    const providerConfig = PROVIDER_CONFIG[newProvider] || PROVIDER_CONFIG.claude
    if (!providerConfig.models.includes(testModel.value)) {
      testModel.value = providerConfig.defaultModel
    }

    if (props.show && props.apiKeyValue) {
      fetchStickyDiagnostics()
    }
  },
  { immediate: true }
)

function handleSSEEvent(data) {
  switch (data.type) {
    case 'test_start':
      break
    case 'content':
      responseText.value += data.text
      break
    case 'message_stop':
      break
    case 'test_complete':
      testDuration.value = Date.now() - testStartTime.value
      if (data.success) {
        testStatus.value = 'success'
      } else {
        testStatus.value = 'error'
        errorMessage.value = data.error || 'Test failed'
      }
      fetchStickyDiagnostics()
      break
    case 'error':
      testStatus.value = 'error'
      errorMessage.value = data.error || 'Unknown error'
      testDuration.value = Date.now() - testStartTime.value
      break
  }
}

function handleClose() {
  if (testStatus.value === 'testing') return

  if (abortController.value) {
    abortController.value.abort()
    abortController.value = null
  }

  abortStickyDiagnosticsRequest()

  testStatus.value = 'idle'
  responseText.value = ''
  errorMessage.value = ''
  testDuration.value = 0
  resetStickyDiagnosticsState()

  emit('close')
}

watch(
  () => props.show,
  (newVal) => {
    if (newVal) {
      testStatus.value = 'idle'
      responseText.value = ''
      errorMessage.value = ''
      testDuration.value = 0
      applyInferredProvider()
      fetchStickyDiagnostics()
      return
    }

    abortStickyDiagnosticsRequest()
  }
)

watch(
  () => props.apiKeyProfile,
  () => {
    if (!props.show || testStatus.value === 'testing') {
      return
    }

    applyInferredProvider()
    fetchStickyDiagnostics()
  }
)

onUnmounted(() => {
  if (abortController.value) {
    abortController.value.abort()
  }
  abortStickyDiagnosticsRequest()
})
</script>
