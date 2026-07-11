<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-center gap-1.5">
      <span
        :class="[
          'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold',
          availabilityClass
        ]"
      >
        <i :class="['fas', availabilityIcon]" />
        {{ availabilityLabel }}
      </span>
      <span
        :class="[
          'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium',
          tokenClass
        ]"
        :title="tokenTitle"
      >
        <i class="fas fa-key" />
        {{ tokenLabel }}
      </span>
    </div>

    <div class="grid grid-cols-2 gap-1.5">
      <button
        v-for="family in families"
        :key="family.key"
        :class="[
          'min-h-[48px] rounded-md border px-2 py-1.5 text-left transition-colors',
          familyStatus(family.key).isRateLimited
            ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/30'
            : hasOperationalStatus
              ? 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-700 dark:hover:bg-blue-900/20 dark:hover:text-blue-300'
              : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400 dark:hover:border-blue-700 dark:hover:bg-blue-900/20 dark:hover:text-blue-300'
        ]"
        :title="familyTitle(family)"
        type="button"
        @click="$emit('test-model', family.model)"
      >
        <span class="flex items-center justify-between gap-2 text-[11px] font-semibold">
          <span>{{ family.label }}</span>
          <i class="fas fa-vial text-[9px] opacity-60" />
        </span>
        <span
          v-if="familyStatus(family.key).isRateLimited"
          class="mt-0.5 block text-[10px] leading-tight"
        >
          {{ formatResetTime(familyStatus(family.key).resetAt) }} ·
          {{ formatRemaining(familyStatus(family.key)) }}
        </span>
        <span
          v-else-if="hasOperationalStatus"
          class="mt-0.5 block text-[10px] text-emerald-600 dark:text-emerald-400"
        >
          可用 · 点击测试
        </span>
        <span v-else class="mt-0.5 block text-[10px] text-gray-400"> 状态未知 · 点击测试 </span>
      </button>
    </div>

    <div
      v-if="tempUnavailable.active"
      class="flex items-center justify-between gap-2 border-t border-amber-200 pt-2 text-[11px] text-amber-700 dark:border-amber-800 dark:text-amber-300"
    >
      <span class="min-w-0" :title="tempUnavailableTitle">
        <i class="fas fa-hourglass-half mr-1" />
        临时冷却 {{ formatTempRemaining() }}
      </span>
      <button
        class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/30"
        :disabled="account.isClearingTempUnavailable"
        title="解除临时冷却（不会清除真实模型限额）"
        type="button"
        @click="$emit('clear-temp')"
      >
        <i
          :class="[
            'fas',
            account.isClearingTempUnavailable ? 'fa-spinner fa-spin' : 'fa-hourglass-end'
          ]"
        />
      </button>
    </div>

    <p
      v-if="availability.reasons?.length"
      class="truncate text-[10px] text-red-600 dark:text-red-400"
      :title="availability.reasons.map((reason) => reason.label).join('；')"
    >
      {{ availability.reasons.map((reason) => reason.label).join('；') }}
    </p>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  account: {
    type: Object,
    required: true
  },
  nowMs: {
    type: Number,
    default: () => Date.now()
  }
})

defineEmits(['test-model', 'clear-temp'])

const families = [
  { key: 'opus', label: 'Opus', model: 'claude-opus-4-8' },
  { key: 'sonnet', label: 'Sonnet', model: 'claude-sonnet-4-6' },
  { key: 'haiku', label: 'Haiku', model: 'claude-haiku-4-5-20251001' },
  { key: 'fable', label: 'Fable', model: 'claude-fable-5' }
]

const operationalStatus = computed(() => props.account?.operationalStatus || {})
const hasOperationalStatus = computed(() => !!props.account?.operationalStatus)
const availability = computed(
  () =>
    operationalStatus.value.availability || {
      scope: 'unknown',
      reasons: []
    }
)
const token = computed(() => operationalStatus.value.token || { status: 'unknown' })
const tempUnavailable = computed(() => operationalStatus.value.tempUnavailable || { active: false })

const availabilityLabel = computed(() => {
  if (availability.value.scope === 'account') return '整体不可用'
  if (availability.value.scope === 'model') return '部分模型受限'
  if (availability.value.scope === 'available') return '模型均可用'
  return '状态未知'
})

const availabilityIcon = computed(() => {
  if (availability.value.scope === 'account') return 'fa-circle-xmark'
  if (availability.value.scope === 'model') return 'fa-triangle-exclamation'
  return availability.value.scope === 'available' ? 'fa-circle-check' : 'fa-circle-question'
})

const availabilityClass = computed(() => {
  if (availability.value.scope === 'account') {
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  }
  if (availability.value.scope === 'model') {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  }
  if (availability.value.scope === 'available') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  }
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
})

const tokenLabel = computed(() => {
  switch (token.value.status) {
    case 'healthy':
      return 'Token 正常'
    case 'expiring':
      return `Token ${formatRemaining(token.value)}`
    case 'expired':
      return 'Token 已过期'
    case 'refresh_failed':
      return 'Token 刷新失败'
    case 'missing':
      return 'Token 缺失'
    default:
      return 'Token 未知'
  }
})

const tokenClass = computed(() => {
  if (['expired', 'missing'].includes(token.value.status)) {
    return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
  }
  if (['expiring', 'refresh_failed'].includes(token.value.status)) {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  }
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
})

const tokenTitle = computed(() => {
  const details = []
  if (token.value.expiresAt) details.push(`过期时间：${formatFullTime(token.value.expiresAt)}`)
  if (token.value.lastRefreshErrorAt) {
    details.push(`刷新失败：${formatFullTime(token.value.lastRefreshErrorAt)}`)
  }
  if (token.value.refreshError) details.push(token.value.refreshError)
  return details.join('\n') || 'Token 状态正常'
})

const tempUnavailableTitle = computed(() => {
  if (!tempUnavailable.value.expiresAt) return '临时冷却中'
  return `预计恢复：${formatFullTime(tempUnavailable.value.expiresAt)}`
})

function familyStatus(family) {
  return (
    operationalStatus.value.modelRateLimits?.[family] || {
      isRateLimited: false,
      resetAt: null,
      secondsRemaining: 0
    }
  )
}

function remainingSeconds(status) {
  if (status?.expiresAt || status?.resetAt || status?.expiresAt === '') {
    const target = status.expiresAt || status.resetAt
    const targetMs = Date.parse(target)
    if (Number.isFinite(targetMs)) {
      return Math.max(0, Math.ceil((targetMs - props.nowMs) / 1000))
    }
  }
  if (token.value === status && Number.isFinite(status?.expiresInSeconds)) {
    return Math.max(0, status.expiresInSeconds)
  }
  return Math.max(0, Number(status?.ttlSeconds ?? status?.secondsRemaining ?? 0))
}

function formatRemaining(status) {
  const seconds = remainingSeconds(status)
  if (seconds < 60) return `${seconds}秒`
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}分`
  if (seconds < 86400) {
    const totalMinutes = Math.ceil(seconds / 60)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return minutes > 0 ? `${hours}时${minutes}分` : `${hours}时`
  }
  const totalHours = Math.ceil(seconds / 3600)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  return hours > 0 ? `${days}天${hours}时` : `${days}天`
}

function formatTempRemaining() {
  if (!tempUnavailable.value.expiresAt && !Number.isFinite(tempUnavailable.value.ttlSeconds)) {
    return '无 TTL'
  }
  return formatRemaining(tempUnavailable.value)
}

function formatResetTime(value) {
  if (!value) return '待恢复'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '待恢复'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function formatFullTime(value) {
  if (!value) return '未知'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN', { hour12: false })
}

function familyTitle(family) {
  const status = familyStatus(family.key)
  if (!hasOperationalStatus.value) return `状态数据尚未加载；点击使用 ${family.model} 测试此账号`
  if (!status.isRateLimited) return `点击使用 ${family.model} 测试此账号`
  return `${family.label} 限流；恢复时间：${formatFullTime(status.resetAt)}；剩余：${formatRemaining(status)}；点击仍可发起测试`
}
</script>
