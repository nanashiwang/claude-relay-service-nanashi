<template>
  <Teleport to="body">
    <div class="modal fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div
        class="modal-content custom-scrollbar mx-auto max-h-[90vh] w-full max-w-3xl overflow-y-auto p-4 sm:p-6 md:p-8"
      >
        <div class="mb-4 flex items-center justify-between sm:mb-6">
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600"
            >
              <i class="fas fa-file-import text-base text-white" />
            </div>
            <div>
              <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl">
                批量导入 OpenAI JSON
              </h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                兼容 CLIProxyAPI / CPA 导出的 Codex 认证 JSON
              </p>
            </div>
          </div>
          <button
            class="p-1 text-gray-400 transition-colors hover:text-gray-600"
            @click="$emit('close')"
          >
            <i class="fas fa-times text-lg sm:text-xl" />
          </button>
        </div>

        <div
          class="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200"
        >
          <p class="font-semibold">支持字段</p>
          <p class="mt-1">
            顶层包含 `access_token`、`refresh_token`、`id_token`、`email`、`account_id`、
            `expired` 等字段的 JSON 文件都可以直接导入。
          </p>
        </div>

        <div class="space-y-6">
          <div class="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
            <div
              class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <h4 class="text-sm font-semibold text-gray-800 dark:text-gray-100">选择 JSON 文件</h4>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  可一次选择多个文件；如果单个文件内是 JSON 数组，也会自动拆分导入。
                </p>
              </div>
              <div class="flex gap-2">
                <input
                  ref="fileInputRef"
                  accept=".json,application/json"
                  class="hidden"
                  multiple
                  type="file"
                  @change="handleFileChange"
                />
                <button
                  class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700"
                  type="button"
                  @click="triggerFileSelect"
                >
                  选择文件
                </button>
                <button
                  class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                  :disabled="selectedFiles.length === 0"
                  type="button"
                  @click="clearFiles"
                >
                  清空
                </button>
              </div>
            </div>

            <div
              v-if="selectedFiles.length > 0"
              class="mt-4 rounded-lg border border-dashed border-gray-300 bg-white p-3 dark:border-gray-600 dark:bg-gray-900/40"
            >
              <p class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                已选择 {{ selectedFiles.length }} 个文件
              </p>
              <div class="max-h-40 space-y-2 overflow-y-auto pr-1">
                <div
                  v-for="file in selectedFiles"
                  :key="`${file.name}-${file.size}-${file.lastModified}`"
                  class="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
                >
                  <span class="truncate text-gray-700 dark:text-gray-200">{{ file.name }}</span>
                  <span class="ml-3 flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">
                    {{ formatFileSize(file.size) }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <label class="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                名称前缀
              </label>
              <input
                v-model="form.namePrefix"
                class="form-input w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                placeholder="例如：CPA - "
                type="text"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                可选，导入后会加在账号名称前面，方便批次识别。
              </p>
            </div>

            <div>
              <label class="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                账号类型
              </label>
              <select
                v-model="form.accountType"
                class="form-input w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              >
                <option value="shared">共享</option>
                <option value="dedicated">专属</option>
              </select>
            </div>

            <div>
              <label class="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                优先级
              </label>
              <input
                v-model.number="form.priority"
                class="form-input w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                max="100"
                min="1"
                type="number"
              />
            </div>

            <div>
              <label class="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                限流恢复时长（分钟）
              </label>
              <input
                v-model.number="form.rateLimitDuration"
                class="form-input w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                min="1"
                type="number"
              />
            </div>
          </div>

          <label class="flex items-center">
            <input
              v-model="form.allowDuplicates"
              class="h-4 w-4 rounded border-gray-300 bg-gray-100 text-emerald-600 focus:ring-emerald-500"
              type="checkbox"
            />
            <span class="ml-2 text-sm text-gray-700 dark:text-gray-300">
              允许重复导入相同邮箱/账号 ID
            </span>
          </label>

          <ProxyConfig v-model="form.proxy" />

          <div
            v-if="result"
            class="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50"
          >
            <div class="grid gap-3 sm:grid-cols-3">
              <div class="rounded-lg bg-white p-3 dark:bg-gray-900/40">
                <p class="text-xs text-gray-500 dark:text-gray-400">成功导入</p>
                <p class="mt-1 text-xl font-bold text-emerald-600">{{ result.importedCount }}</p>
              </div>
              <div class="rounded-lg bg-white p-3 dark:bg-gray-900/40">
                <p class="text-xs text-gray-500 dark:text-gray-400">已跳过</p>
                <p class="mt-1 text-xl font-bold text-amber-500">{{ result.skippedCount }}</p>
              </div>
              <div class="rounded-lg bg-white p-3 dark:bg-gray-900/40">
                <p class="text-xs text-gray-500 dark:text-gray-400">失败</p>
                <p class="mt-1 text-xl font-bold text-rose-500">{{ result.failedCount }}</p>
              </div>
            </div>

            <div v-if="result.failed?.length" class="mt-4">
              <h5 class="text-sm font-semibold text-rose-600 dark:text-rose-300">失败项</h5>
              <div class="mt-2 max-h-40 space-y-2 overflow-y-auto pr-1">
                <div
                  v-for="item in result.failed"
                  :key="`failed-${item.fileName}-${item.payloadIndex}`"
                  class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm dark:border-rose-800 dark:bg-rose-900/20"
                >
                  <p class="font-medium text-rose-700 dark:text-rose-200">
                    {{ item.fileName }}<span v-if="item.payloadIndex"> #{{ item.payloadIndex + 1 }}</span>
                  </p>
                  <p class="mt-1 text-xs text-rose-600 dark:text-rose-300">{{ item.error }}</p>
                </div>
              </div>
            </div>

            <div v-if="result.skipped?.length" class="mt-4">
              <h5 class="text-sm font-semibold text-amber-600 dark:text-amber-300">跳过项</h5>
              <div class="mt-2 max-h-40 space-y-2 overflow-y-auto pr-1">
                <div
                  v-for="item in result.skipped"
                  :key="`skipped-${item.fileName}-${item.payloadIndex}`"
                  class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-900/20"
                >
                  <p class="font-medium text-amber-700 dark:text-amber-200">
                    {{ item.fileName }}<span v-if="item.payloadIndex"> #{{ item.payloadIndex + 1 }}</span>
                  </p>
                  <p class="mt-1 text-xs text-amber-600 dark:text-amber-300">
                    {{ item.reason }}<span v-if="item.existingAccountName">：{{ item.existingAccountName }}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div class="flex gap-3 pt-2">
            <button
              class="flex-1 rounded-xl bg-gray-100 px-6 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              type="button"
              @click="$emit('close')"
            >
              关闭
            </button>
            <button
              class="btn btn-primary flex-1 px-6 py-3 font-semibold"
              :disabled="loading || selectedFiles.length === 0"
              type="button"
              @click="importFiles"
            >
              <div v-if="loading" class="loading-spinner mr-2" />
              {{ loading ? '导入中...' : '开始导入' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref } from 'vue'
import { showToast } from '@/utils/toast'
import { useAccountsStore } from '@/stores/accounts'
import ProxyConfig from './ProxyConfig.vue'

const emit = defineEmits(['close', 'success'])
const accountsStore = useAccountsStore()

const createDefaultProxyState = () => ({
  enabled: false,
  type: 'socks5',
  host: '',
  port: '',
  username: '',
  password: ''
})

const fileInputRef = ref(null)
const selectedFiles = ref([])
const loading = ref(false)
const result = ref(null)
const form = ref({
  namePrefix: '',
  accountType: 'shared',
  priority: 50,
  rateLimitDuration: 60,
  allowDuplicates: false,
  proxy: createDefaultProxyState()
})

const triggerFileSelect = () => {
  fileInputRef.value?.click()
}

const handleFileChange = (event) => {
  const files = Array.from(event.target?.files || [])
  selectedFiles.value = files
  result.value = null
}

const clearFiles = () => {
  selectedFiles.value = []
  result.value = null
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

const formatFileSize = (size) => {
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B'
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

const buildProxyPayload = (proxyState) => {
  if (!proxyState || !proxyState.enabled) {
    return null
  }

  const host = (proxyState.host || '').trim()
  const port = Number.parseInt(proxyState.port, 10)
  if (!host || Number.isNaN(port) || port <= 0) {
    return null
  }

  return {
    type: proxyState.type || 'socks5',
    host,
    port,
    username: proxyState.username ? proxyState.username.trim() : null,
    password: proxyState.password ? proxyState.password.trim() : null
  }
}

const importFiles = async () => {
  if (selectedFiles.value.length === 0) {
    showToast('请先选择要导入的 JSON 文件', 'warning')
    return
  }

  loading.value = true
  try {
    const imports = await Promise.all(
      selectedFiles.value.map(async (file) => ({
        fileName: file.name,
        content: await file.text()
      }))
    )

    const summary = await accountsStore.importOpenAIAccountsFromJson({
      imports,
      allowDuplicates: form.value.allowDuplicates,
      defaults: {
        namePrefix: form.value.namePrefix?.trim() || '',
        accountType: form.value.accountType,
        priority: Number(form.value.priority) || 50,
        rateLimitDuration: Number(form.value.rateLimitDuration) || 60,
        proxy: buildProxyPayload(form.value.proxy)
      }
    })

    result.value = summary

    if (summary.importedCount > 0) {
      emit('success')
    }

    const toastType = summary.failedCount > 0 ? 'warning' : 'success'
    showToast(
      `导入完成：成功 ${summary.importedCount}，跳过 ${summary.skippedCount}，失败 ${summary.failedCount}`,
      toastType
    )
  } catch (error) {
    showToast(error.response?.data?.message || error.message || '批量导入失败', 'error')
  } finally {
    loading.value = false
  }
}
</script>
