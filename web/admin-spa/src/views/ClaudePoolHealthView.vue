<template>
  <div class="space-y-5">
    <header
      class="flex flex-col gap-3 border-b border-gray-200 pb-4 dark:border-gray-700 sm:flex-row sm:items-end sm:justify-between"
    >
      <div>
        <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">账号池健康</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">Claude 统一调度池实时状态</p>
      </div>
      <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span v-if="generatedAt">更新于 {{ formatTime(generatedAt) }}</span>
        <button
          class="flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          :disabled="loading"
          title="刷新账号池健康状态"
          type="button"
          @click="loadHealth"
        >
          <i :class="['fas fa-rotate', loading && 'fa-spin']" />
        </button>
      </div>
    </header>

    <section class="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <button
        v-for="family in overview"
        :key="family.family"
        :class="[
          'rounded-lg border p-3 text-left transition-colors',
          filters.model === family.model
            ? 'border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20'
            : family.summary.selectableAccountCount > 0
              ? 'border-gray-200 bg-white hover:border-blue-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-700'
              : 'border-red-200 bg-red-50 hover:border-red-300 dark:border-red-900/70 dark:bg-red-900/10'
        ]"
        type="button"
        @click="selectFamily(family.model)"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-semibold text-gray-800 dark:text-gray-100">{{
            family.label
          }}</span>
          <span
            :class="[
              'h-2.5 w-2.5 rounded-full',
              family.summary.selectableAccountCount > 0 ? 'bg-emerald-500' : 'bg-red-500'
            ]"
          />
        </div>
        <div class="mt-3 flex items-end justify-between gap-2">
          <div>
            <span class="text-2xl font-bold text-gray-900 dark:text-white">
              {{ family.summary.selectableAccountCount }}
            </span>
            <span class="ml-1 text-xs text-gray-500 dark:text-gray-400">可调度</span>
          </div>
          <div class="text-right text-[11px] text-gray-500 dark:text-gray-400">
            <div>{{ family.summary.excludedAccountCount }} 排除</div>
            <div v-if="family.summary.warningAccountCount">
              {{ family.summary.warningAccountCount }} 警告
            </div>
          </div>
        </div>
        <p class="mt-2 truncate text-[11px] text-gray-500 dark:text-gray-400">
          {{ family.selected?.name || '当前无候选账号' }}
        </p>
      </button>
    </section>

    <section class="border-y border-gray-200 py-4 dark:border-gray-700">
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label class="space-y-1.5">
          <span class="text-xs font-medium text-gray-600 dark:text-gray-300">测试模型</span>
          <select
            v-model="filters.model"
            class="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option v-for="family in modelOptions" :key="family.model" :value="family.model">
              {{ family.label }} · {{ family.model }}
            </option>
          </select>
        </label>

        <label class="space-y-1.5">
          <span class="text-xs font-medium text-gray-600 dark:text-gray-300">API Key</span>
          <select
            v-model="filters.apiKeyId"
            class="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            @change="handleApiKeyChange"
          >
            <option value="">不限定 API Key</option>
            <option v-for="key in apiKeyOptions" :key="key.id" :value="key.id">
              {{ key.name }}{{ key.isActive ? '' : '（停用）' }}
            </option>
          </select>
        </label>

        <label class="space-y-1.5">
          <span
            class="flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-300"
          >
            账号组
            <i
              v-if="hasApiKeyBinding"
              class="fas fa-lock text-[10px] text-amber-500"
              title="所选 API Key 已绑定专属账号或账号组"
            />
          </span>
          <select
            v-model="filters.groupId"
            class="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            :disabled="hasApiKeyBinding"
          >
            <option value="">全部共享账号</option>
            <option v-for="group in groupOptions" :key="group.id" :value="group.id">
              {{ group.name }}（{{ group.memberCount }}）
            </option>
          </select>
        </label>

        <label class="space-y-1.5">
          <span class="text-xs font-medium text-gray-600 dark:text-gray-300">会话哈希</span>
          <div class="flex gap-2">
            <input
              v-model.trim="filters.sessionHash"
              class="h-10 min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              maxlength="256"
              placeholder="可选"
              type="text"
              @keyup.enter="loadHealth"
            />
            <button
              class="h-10 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="loading"
              type="button"
              @click="loadHealth"
            >
              模拟
            </button>
          </div>
        </label>
      </div>
    </section>

    <div
      v-if="errorMessage"
      class="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-900/20 dark:text-red-300"
    >
      <span><i class="fas fa-circle-exclamation mr-2" />{{ errorMessage }}</span>
      <button class="font-semibold" type="button" @click="loadHealth">重试</button>
    </div>

    <template v-if="diagnostic">
      <section
        :class="[
          'flex flex-col gap-4 rounded-lg border p-4 lg:flex-row lg:items-center lg:justify-between',
          selectedAccount
            ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/70 dark:bg-emerald-900/10'
            : 'border-red-200 bg-red-50/70 dark:border-red-900/70 dark:bg-red-900/10'
        ]"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <i
              :class="[
                'fas',
                selectedAccount
                  ? 'fa-circle-check text-emerald-600'
                  : 'fa-circle-xmark text-red-600'
              ]"
            />
            <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100">
              {{ selectedAccount ? '模拟调度成功' : '当前无法调度' }}
            </h3>
          </div>
          <p
            v-if="selectedAccount"
            class="mt-2 truncate text-lg font-semibold text-gray-900 dark:text-white"
          >
            {{ selectedAccount.name }}
          </p>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {{ selectionModeLabel }}
            <template v-if="selectedAccount">
              · {{ accountTypeLabel(selectedAccount.accountType) }} · 优先级
              {{ selectedAccount.priority }}
            </template>
          </p>
        </div>
        <div class="grid grid-cols-3 gap-5 text-center lg:min-w-[340px]">
          <div>
            <div class="text-xl font-bold text-emerald-600">
              {{ diagnostic.summary.selectableAccountCount }}
            </div>
            <div class="text-[11px] text-gray-500 dark:text-gray-400">可调度</div>
          </div>
          <div>
            <div class="text-xl font-bold text-red-600">
              {{ diagnostic.summary.excludedAccountCount }}
            </div>
            <div class="text-[11px] text-gray-500 dark:text-gray-400">已排除</div>
          </div>
          <div>
            <div class="text-xl font-bold text-amber-600">
              {{ diagnostic.summary.warningAccountCount }}
            </div>
            <div class="text-[11px] text-gray-500 dark:text-gray-400">有警告</div>
          </div>
        </div>
      </section>

      <section
        v-if="diagnostic.context.blockers.length || diagnostic.context.groupMissing"
        class="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-900/20 dark:text-amber-300"
      >
        <div class="font-semibold"><i class="fas fa-shield-halved mr-2" />调度上下文阻断</div>
        <div class="mt-2 flex flex-wrap gap-2">
          <span
            v-for="blocker in diagnostic.context.blockers"
            :key="blocker.code"
            class="rounded-md bg-amber-100 px-2 py-1 text-xs dark:bg-amber-900/40"
          >
            {{ blocker.label }}
          </span>
          <span
            v-if="diagnostic.context.groupMissing"
            class="rounded-md bg-amber-100 px-2 py-1 text-xs dark:bg-amber-900/40"
          >
            账号组不存在
          </span>
        </div>
      </section>

      <section v-if="reasonEntries.length" class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-semibold text-gray-500 dark:text-gray-400">排除原因</span>
        <span
          v-for="reason in reasonEntries"
          :key="reason.code"
          class="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          {{ reasonLabel(reason.code) }} {{ reason.count }}
        </span>
      </section>

      <section>
        <div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 class="text-sm font-bold text-gray-900 dark:text-gray-100">候选账号</h3>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {{ diagnostic.effectiveModel }} · 共 {{ diagnostic.accounts.length }} 个账号
            </p>
          </div>
          <div
            class="inline-flex self-start rounded-md border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-800"
          >
            <button
              v-for="option in candidateFilterOptions"
              :key="option.value"
              :class="[
                'rounded px-3 py-1.5 text-xs font-medium',
                candidateFilter === option.value
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              ]"
              type="button"
              @click="candidateFilter = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div
          class="hidden overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 md:block"
        >
          <table class="w-full table-fixed text-left text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              <tr>
                <th class="w-[28%] px-4 py-3 font-semibold">账号</th>
                <th class="w-[14%] px-4 py-3 font-semibold">类型</th>
                <th class="w-[13%] px-4 py-3 font-semibold">状态</th>
                <th class="w-[10%] px-4 py-3 font-semibold">优先级</th>
                <th class="px-4 py-3 font-semibold">调度判断</th>
              </tr>
            </thead>
            <tbody
              class="divide-y divide-gray-100 bg-white dark:divide-gray-700 dark:bg-gray-900/30"
            >
              <tr
                v-for="account in filteredAccounts"
                :key="`${account.accountType}:${account.accountId}`"
              >
                <td class="px-4 py-3">
                  <div class="flex min-w-0 items-center gap-2">
                    <i
                      v-if="account.selected"
                      class="fas fa-bullseye text-emerald-500"
                      title="模拟选中"
                    />
                    <div class="min-w-0">
                      <div class="truncate font-semibold text-gray-800 dark:text-gray-100">
                        {{ account.name }}
                      </div>
                      <div class="truncate text-[10px] text-gray-400">{{ account.accountId }}</div>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                  {{ accountTypeLabel(account.accountType) }}
                </td>
                <td class="px-4 py-3">
                  <span
                    :class="[
                      'inline-flex whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold',
                      account.selected
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                        : account.selectable
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          : account.eligible
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    ]"
                  >
                    {{
                      account.selected
                        ? '已选中'
                        : account.selectable
                          ? '可调度'
                          : account.eligible
                            ? '账号可用'
                            : '已排除'
                    }}
                  </span>
                </td>
                <td class="px-4 py-3 text-gray-700 dark:text-gray-200">{{ account.priority }}</td>
                <td class="px-4 py-3">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span
                      v-for="reason in account.reasons"
                      :key="reason.code"
                      class="inline-flex rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-900/20 dark:text-red-300"
                      :title="reason.detail || reason.label"
                    >
                      {{ reason.label }}
                    </span>
                    <span
                      v-if="account.reasons.length === 0"
                      class="text-xs text-emerald-600 dark:text-emerald-400"
                    >
                      {{
                        account.selected
                          ? '调度器将选择此账号'
                          : account.selectable
                            ? '通过全部调度检查'
                            : '账号自身正常，受调度上下文阻断'
                      }}
                    </span>
                    <span
                      v-for="warning in account.warnings"
                      :key="warning.code"
                      class="inline-flex rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                    >
                      {{ warning.label }}
                    </span>
                    <span
                      v-if="account.concurrency?.limit > 0"
                      class="text-[11px] text-gray-500 dark:text-gray-400"
                    >
                      并发 {{ account.concurrency.current }}/{{ account.concurrency.limit }}
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="space-y-2 md:hidden">
          <article
            v-for="account in filteredAccounts"
            :key="`${account.accountType}:${account.accountId}`"
            class="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <i v-if="account.selected" class="fas fa-bullseye text-emerald-500" />
                  <h4 class="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
                    {{ account.name }}
                  </h4>
                </div>
                <p class="mt-1 text-[10px] text-gray-400">
                  {{ accountTypeLabel(account.accountType) }} · P{{ account.priority }}
                </p>
              </div>
              <span
                :class="[
                  'inline-flex whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold',
                  account.selected
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : account.selectable
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      : account.eligible
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                ]"
              >
                {{
                  account.selected
                    ? '已选中'
                    : account.selectable
                      ? '可调度'
                      : account.eligible
                        ? '账号可用'
                        : '已排除'
                }}
              </span>
            </div>
            <div class="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">
              <div class="flex flex-wrap items-center gap-1.5">
                <span
                  v-for="reason in account.reasons"
                  :key="reason.code"
                  class="inline-flex rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-900/20 dark:text-red-300"
                  :title="reason.detail || reason.label"
                >
                  {{ reason.label }}
                </span>
                <span
                  v-if="account.reasons.length === 0"
                  class="text-xs text-emerald-600 dark:text-emerald-400"
                >
                  {{
                    account.selected
                      ? '调度器将选择此账号'
                      : account.selectable
                        ? '通过全部调度检查'
                        : '账号自身正常，受调度上下文阻断'
                  }}
                </span>
                <span
                  v-for="warning in account.warnings"
                  :key="warning.code"
                  class="inline-flex rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                >
                  {{ warning.label }}
                </span>
                <span
                  v-if="account.concurrency?.limit > 0"
                  class="text-[11px] text-gray-500 dark:text-gray-400"
                >
                  并发 {{ account.concurrency.current }}/{{ account.concurrency.limit }}
                </span>
              </div>
            </div>
          </article>
        </div>

        <div v-if="filteredAccounts.length === 0" class="py-10 text-center text-sm text-gray-400">
          当前筛选下没有账号
        </div>
      </section>
    </template>

    <div v-else-if="loading" class="flex min-h-[320px] items-center justify-center text-gray-400">
      <i class="fas fa-spinner fa-spin mr-2" />加载账号池状态
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { apiClient } from '@/config/api'

const modelOptions = [
  { family: 'opus', label: 'Opus', model: 'claude-opus-4-8' },
  { family: 'sonnet', label: 'Sonnet', model: 'claude-sonnet-4-6' },
  { family: 'haiku', label: 'Haiku', model: 'claude-haiku-4-5-20251001' },
  { family: 'fable', label: 'Fable', model: 'claude-fable-5' }
]

const candidateFilterOptions = [
  { value: 'all', label: '全部' },
  { value: 'eligible', label: '可调度' },
  { value: 'excluded', label: '已排除' }
]

const reasonLabels = {
  inactive: '未启用',
  invalid_status: '状态异常',
  not_shared_pool: '非共享池',
  model_not_supported: '模型不支持',
  subscription_expired: '订阅过期',
  temporarily_unavailable: '临时冷却',
  rate_limited: '限流',
  quota_exceeded: '额度用尽',
  concurrency_full: '并发已满',
  not_schedulable: '停用调度',
  outside_group: '不在账号组',
  dedicated_binding_precedence: '专属绑定优先',
  dedicated_fallback_disabled: '禁止专属回退'
}

const selectionModeLabels = {
  priority_pool: '按共享池优先级与最后使用时间选择',
  group_priority: '按账号组优先级与最后使用时间选择',
  sticky_session: '命中已有粘性会话绑定',
  dedicated_claude: '命中 API Key 专属 Claude OAuth 账号',
  dedicated_console: '命中 API Key 专属 Claude Console 账号',
  dedicated_bedrock: '命中 API Key 专属 Bedrock 账号',
  blocked_by_api_key: 'API Key 配置阻止本次调度'
}

const filters = reactive({
  model: 'claude-sonnet-4-6',
  apiKeyId: '',
  groupId: '',
  sessionHash: ''
})
const healthData = ref(null)
const loading = ref(false)
const errorMessage = ref('')
const candidateFilter = ref('all')

const overview = computed(() => healthData.value?.overview || [])
const diagnostic = computed(() => healthData.value?.diagnostic || null)
const generatedAt = computed(() => healthData.value?.generatedAt || null)
const apiKeyOptions = computed(() => healthData.value?.options?.apiKeys || [])
const groupOptions = computed(() => healthData.value?.options?.groups || [])
const selectedAccount = computed(() => diagnostic.value?.selection?.selected || null)
const selectionModeLabel = computed(
  () => selectionModeLabels[diagnostic.value?.selection?.mode] || '未找到可用候选账号'
)
const selectedApiKey = computed(() =>
  apiKeyOptions.value.find((key) => key.id === filters.apiKeyId)
)
const hasApiKeyBinding = computed(() => {
  const key = selectedApiKey.value
  return !!(key?.claudeAccountId || key?.claudeConsoleAccountId || key?.bedrockAccountId)
})
const reasonEntries = computed(() =>
  Object.entries(diagnostic.value?.summary?.reasonCounts || {})
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => right.count - left.count)
)
const filteredAccounts = computed(() => {
  const accounts = diagnostic.value?.accounts || []
  if (candidateFilter.value === 'eligible') return accounts.filter((account) => account.selectable)
  if (candidateFilter.value === 'excluded') return accounts.filter((account) => !account.selectable)
  return accounts
})

const accountTypeLabel = (type) =>
  ({
    'claude-official': 'Claude OAuth',
    'claude-console': 'Claude Console',
    bedrock: 'AWS Bedrock',
    ccr: 'CCR'
  })[type] || type

const reasonLabel = (code) => reasonLabels[code] || code

function handleApiKeyChange() {
  if (hasApiKeyBinding.value) filters.groupId = ''
}

async function selectFamily(model) {
  filters.model = model
  await loadHealth()
}

async function loadHealth() {
  if (loading.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const params = { model: filters.model }
    if (filters.apiKeyId) params.apiKeyId = filters.apiKeyId
    if (filters.groupId) params.groupId = filters.groupId
    if (filters.sessionHash) params.sessionHash = filters.sessionHash
    const response = await apiClient.get('/admin/claude-pool-health', { params })
    if (!response.success) throw new Error(response.message || '加载账号池状态失败')
    healthData.value = response.data
  } catch (error) {
    errorMessage.value = error.message || '加载账号池状态失败'
  } finally {
    loading.value = false
  }
}

function formatTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '--'
    : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

onMounted(loadHealth)
</script>
