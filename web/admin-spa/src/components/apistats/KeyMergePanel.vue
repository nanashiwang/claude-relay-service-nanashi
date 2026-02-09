<template>
  <div class="merge-card mb-8 rounded-3xl p-6 shadow-xl">
    <div class="mb-6">
      <h2 class="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-200">
        <i class="fas fa-link mr-3" />
        密钥融合
      </h2>
      <p class="text-base text-gray-600 dark:text-gray-400">
        将新密钥额度合并到旧密钥中；若旧密钥已过期或已禁用，则直接用新密钥配置替换旧密钥。完成后新密钥会被禁用。
      </p>
    </div>

    <div class="mx-auto max-w-4xl">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            <i class="fas fa-key mr-2" />
            旧密钥（保留使用）
          </label>
          <input
            v-model="targetApiKey"
            class="merge-input w-full"
            :disabled="loading"
            placeholder="请输入旧密钥 (cr_...)"
            type="password"
            autocomplete="off"
          />
        </div>
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            <i class="fas fa-key mr-2" />
            新密钥（将被禁用）
          </label>
          <input
            v-model="sourceApiKey"
            class="merge-input w-full"
            :disabled="loading"
            placeholder="请输入新密钥 (cr_...)"
            type="password"
            autocomplete="off"
          />
        </div>
      </div>

      <div class="mt-4 flex flex-wrap gap-3">
        <button
          class="merge-button flex items-center justify-center gap-2"
          :disabled="loading || !canSubmit"
          @click="mergeKeys"
        >
          <i v-if="loading" class="fas fa-spinner loading-spinner" />
          <i v-else class="fas fa-link" />
          {{ loading ? '融合中...' : '开始融合' }}
        </button>
        <button class="merge-clear" :disabled="loading" @click="clearAll">
          清空输入
        </button>
      </div>

      <div class="merge-notice mt-4">
        <i class="fas fa-shield-alt mr-2" />
        密钥融合仅在两把密钥设置一致且新密钥未使用时可执行（天卡有效期天数、按量总量额度允许不一致）；旧密钥已过期或已禁用时将直接替换配置并保留旧密钥。
      </div>

      <div v-if="error" class="mt-4">
        <div
          class="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200"
        >
          <i class="fas fa-exclamation-triangle mr-2" />
          {{ error }}
        </div>
      </div>

      <div v-if="mismatchFields.length" class="mt-4">
        <div
          class="rounded-xl border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-400/30 dark:bg-amber-900/20 dark:text-amber-200"
        >
          <div class="mb-2 font-semibold">以下设置不一致：</div>
          <ul class="space-y-1">
            <li v-for="item in mismatchFields" :key="item.field">
              {{ getFieldLabel(item.field) }}：旧= {{ formatFieldValue(item) }}，新=
              {{ formatFieldValue(item, true) }}
            </li>
          </ul>
        </div>
      </div>

      <div v-if="result" class="mt-4">
        <div
          class="rounded-xl border border-emerald-400/40 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-900/20 dark:text-emerald-200"
        >
          <div class="mb-2 font-semibold">{{ successTitle }}</div>
          <div class="space-y-1">
            <div>{{ successSummary }}</div>
            <div v-for="item in mergedItems" :key="item.field">
              {{ item.label }}：{{ item.value }}
            </div>
          </div>
        </div>
      </div>

      <div class="merge-notice mt-3 text-xs text-gray-500 dark:text-gray-400">
        <i class="fas fa-lock mr-2" />
        密钥仅用于本次融合操作，不会被存储。
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { apiStatsClient } from '@/config/apiStats'

const targetApiKey = ref('')
const sourceApiKey = ref('')
const loading = ref(false)
const error = ref('')
const result = ref(null)
const mismatchFields = ref([])

const isValidKey = (value) => value.length >= 10 && value.length <= 512

const canSubmit = computed(() => {
  const target = targetApiKey.value.trim()
  const source = sourceApiKey.value.trim()
  if (!isValidKey(target) || !isValidKey(source)) {
    return false
  }
  return target !== source
})

const fieldLabels = {
  concurrencyLimit: '并发限制',
  rateLimitWindow: '速率窗口',
  rateLimitRequests: '窗口请求次数',
  rateLimitCost: '窗口费用限制',
  tokenLimit: '窗口 Token 限制',
  claudeAccountId: 'Claude 账号绑定',
  claudeConsoleAccountId: 'Claude Console 账号绑定',
  geminiAccountId: 'Gemini 账号绑定',
  openaiAccountId: 'OpenAI 账号绑定',
  azureOpenaiAccountId: 'Azure OpenAI 账号绑定',
  bedrockAccountId: 'Bedrock 账号绑定',
  droidAccountId: 'Droid 账号绑定',
  permissions: '权限范围',
  enableModelRestriction: '模型限制开关',
  restrictedModels: '模型白名单',
  enableClientRestriction: '客户端限制开关',
  allowedClients: '允许客户端',
  tags: '标签',
  expirationMode: '过期模式',
  activationUnit: '激活单位',
  activationDays: '激活有效期',
  dailyCostLimit: '每日费用额度',
  totalCostLimit: '总费用额度',
  weeklyOpusCostLimit: 'Opus 周费用额度',
  expiresAt: '到期时间'
}

const getFieldLabel = (field) => fieldLabels[field] || field

const formatRawValue = (value, field) => {
  if (field === 'permissions') {
    if (Array.isArray(value) && value.length === 0) {
      return '全部'
    }
  }
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : '无'
  }
  if (value === '' || value === null || value === undefined) {
    return '无'
  }
  return String(value)
}

const formatFieldValue = (item, useSource = false) => {
  const value = useSource ? item.source : item.target
  return formatRawValue(value, item.field)
}

const mergedItems = computed(() => {
  if (!result.value?.merged) {
    return []
  }
  const merged = result.value.merged
  const activationUnitLabel = merged.activationUnit === 'hours' ? '小时' : '天'
  const items = [
    { field: 'totalCostLimit', label: '总费用额度', value: merged.totalCostLimit },
    { field: 'dailyCostLimit', label: '每日费用额度', value: merged.dailyCostLimit },
    { field: 'weeklyOpusCostLimit', label: 'Opus 周费用额度', value: merged.weeklyOpusCostLimit },
    { field: 'rateLimitCost', label: '窗口费用限制', value: merged.rateLimitCost },
    { field: 'rateLimitRequests', label: '窗口请求次数', value: merged.rateLimitRequests },
    { field: 'tokenLimit', label: '窗口 Token 限制', value: merged.tokenLimit },
    {
      field: 'activationDays',
      label: '激活有效期',
      value:
        merged.activationDays && merged.activationDays > 0
          ? `${merged.activationDays} ${activationUnitLabel}`
          : merged.activationDays,
      rawValue: merged.activationDays
    },
    { field: 'expiresAt', label: '到期时间', value: merged.expiresAt }
  ]
  return items
    .filter((item) => {
      if (item.field === 'expiresAt') {
        return item.value !== undefined && item.value !== null && item.value !== ''
      }
      const numericValue = Number(item.rawValue ?? item.value)
      return Number.isFinite(numericValue) && numericValue > 0
    })
    .map((item) => ({
      ...item,
      value: formatRawValue(item.value, item.field)
    }))
})

const successTitle = computed(() =>
  result.value?.action === 'replace' ? '替换成功' : '融合成功'
)

const successSummary = computed(() =>
  result.value?.action === 'replace'
    ? '旧密钥已替换为新密钥配置，新密钥已禁用。'
    : '旧密钥额度已合并，新密钥已禁用。'
)

const mergeKeys = async () => {
  if (!canSubmit.value) {
    error.value = '请填写有效的旧密钥和新密钥'
    return
  }

  loading.value = true
  error.value = ''
  result.value = null
  mismatchFields.value = []

  try {
    const response = await apiStatsClient.mergeKeys({
      targetApiKey: targetApiKey.value.trim(),
      sourceApiKey: sourceApiKey.value.trim()
    })

    if (response?.success) {
      result.value = response.data
    } else {
      throw new Error(response?.message || '密钥融合失败')
    }
  } catch (err) {
    error.value = err?.data?.message || err?.message || '密钥融合失败'
    mismatchFields.value = err?.data?.details?.mismatchFields || []
  } finally {
    loading.value = false
  }
}

const clearAll = () => {
  targetApiKey.value = ''
  sourceApiKey.value = ''
  error.value = ''
  result.value = null
  mismatchFields.value = []
}

watch([targetApiKey, sourceApiKey], () => {
  if (error.value) {
    error.value = ''
  }
  mismatchFields.value = []
  result.value = null
})
</script>

<style scoped>
.merge-card {
  background: var(--surface-color);
  backdrop-filter: blur(25px);
  border: 1px solid var(--border-color);
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.25),
    0 0 0 1px rgba(255, 255, 255, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

:global(.dark) .merge-card {
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(75, 85, 99, 0.2),
    inset 0 1px 0 rgba(107, 114, 128, 0.15);
}

.merge-input {
  background: var(--input-bg);
  border: 2px solid var(--input-border);
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 15px;
  transition: all 0.3s ease;
  color: var(--text-primary);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

:global(.dark) .merge-input {
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.4);
  color: #e5e7eb;
}

.merge-input:focus {
  outline: none;
  border-color: #60a5fa;
  box-shadow:
    0 0 0 3px rgba(96, 165, 250, 0.2),
    0 10px 15px -3px rgba(0, 0, 0, 0.1);
  background: #ffffff;
}

:global(.dark) .merge-input:focus {
  border-color: #60a5fa;
  box-shadow:
    0 0 0 3px rgba(96, 165, 250, 0.15),
    0 10px 15px -3px rgba(0, 0, 0, 0.4);
  background: rgba(31, 41, 55, 0.95);
}

.merge-button {
  padding: 10px 20px;
  border-radius: 12px;
  border: none;
  cursor: pointer;
  font-weight: 600;
  color: #ffffff;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow:
    0 10px 15px -3px rgba(102, 126, 234, 0.3),
    0 4px 6px -2px rgba(102, 126, 234, 0.05);
  transition: all 0.3s ease;
}

.merge-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 20px 25px -5px rgba(102, 126, 234, 0.3),
    0 10px 10px -5px rgba(102, 126, 234, 0.1);
}

.merge-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.merge-clear {
  padding: 10px 18px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.6);
  background: rgba(248, 250, 252, 0.7);
  color: #475569;
  font-weight: 500;
  transition: all 0.2s ease;
}

:global(.dark) .merge-clear {
  background: rgba(30, 41, 59, 0.6);
  color: #cbd5f5;
  border-color: rgba(71, 85, 105, 0.6);
}

.merge-clear:hover:not(:disabled) {
  background: rgba(226, 232, 240, 0.8);
}

:global(.dark) .merge-clear:hover:not(:disabled) {
  background: rgba(51, 65, 85, 0.8);
}

.merge-clear:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.merge-notice {
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  padding: 10px 14px;
  color: #374151;
  font-size: 0.875rem;
}

:global(.dark) .merge-notice {
  background: rgba(31, 41, 55, 0.8);
  border: 1px solid rgba(75, 85, 99, 0.5);
  color: #d1d5db;
}

.loading-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
