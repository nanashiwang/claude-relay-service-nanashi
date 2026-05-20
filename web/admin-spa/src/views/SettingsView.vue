<template>
  <div class="settings-container">
    <div class="card p-4 sm:p-6">
      <!-- 页面标题 -->
      <div class="mb-4 sm:mb-6">
        <h3 class="mb-1 text-lg font-bold text-gray-900 dark:text-gray-100 sm:mb-2 sm:text-xl">
          系统设置
        </h3>
        <p class="text-sm text-gray-600 dark:text-gray-400 sm:text-base">网站定制和通知配置</p>
      </div>

      <!-- 设置分类导航 -->
      <div class="mb-6">
        <nav class="flex flex-wrap gap-4 sm:gap-8">
          <button
            :class="[
              'border-b-2 pb-2 text-sm font-medium transition-colors',
              activeSection === 'branding'
                ? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            ]"
            @click="activeSection = 'branding'"
          >
            <i class="fas fa-palette mr-2"></i>
            品牌设置
          </button>
          <button
            :class="[
              'border-b-2 pb-2 text-sm font-medium transition-colors',
              activeSection === 'webhook'
                ? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            ]"
            @click="activeSection = 'webhook'"
          >
            <i class="fas fa-bell mr-2"></i>
            通知设置
          </button>
          <button
            :class="[
              'border-b-2 pb-2 text-sm font-medium transition-colors',
              activeSection === 'claude'
                ? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            ]"
            @click="activeSection = 'claude'"
          >
            <i class="fas fa-robot mr-2"></i>
            Claude 转发
          </button>
          <button
            :class="[
              'border-b-2 pb-2 text-sm font-medium transition-colors',
              activeSection === 'pricing'
                ? 'border-blue-500 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
            ]"
            @click="activeSection = 'pricing'"
          >
            <i class="fas fa-tags mr-2"></i>
            模型价格
          </button>
        </nav>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="py-12 text-center">
        <div class="loading-spinner mx-auto mb-4"></div>
        <p class="text-gray-500 dark:text-gray-400">正在加载设置...</p>
      </div>

      <!-- 内容区域 -->
      <div v-else>
        <!-- 品牌设置部分 -->
        <div v-show="activeSection === 'branding'">
          <!-- 桌面端表格视图 -->
          <div class="table-container hidden sm:block">
            <table class="min-w-full">
              <tbody class="divide-y divide-gray-200/50 dark:divide-gray-600/50">
                <!-- 网站名称 -->
                <tr class="table-row">
                  <td class="w-48 whitespace-nowrap px-6 py-4">
                    <div class="flex items-center">
                      <div
                        class="mr-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-600"
                      >
                        <i class="fas fa-font text-xs text-white" />
                      </div>
                      <div>
                        <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          网站名称
                        </div>
                        <div class="text-xs text-gray-500 dark:text-gray-400">品牌标识</div>
                      </div>
                    </div>
                  </td>
                  <td class="px-6 py-4">
                    <input
                      v-model="oemSettings.siteName"
                      class="form-input w-full max-w-md dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                      maxlength="100"
                      placeholder="Claude Relay Service"
                      type="text"
                    />
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      将显示在浏览器标题和页面头部
                    </p>
                  </td>
                </tr>

                <!-- 网站图标 -->
                <tr class="table-row">
                  <td class="w-48 whitespace-nowrap px-6 py-4">
                    <div class="flex items-center">
                      <div
                        class="mr-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-purple-600"
                      >
                        <i class="fas fa-image text-xs text-white" />
                      </div>
                      <div>
                        <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          网站图标
                        </div>
                        <div class="text-xs text-gray-500 dark:text-gray-400">Favicon</div>
                      </div>
                    </div>
                  </td>
                  <td class="px-6 py-4">
                    <div class="space-y-3">
                      <!-- 图标预览 -->
                      <div
                        v-if="oemSettings.siteIconData || oemSettings.siteIcon"
                        class="inline-flex items-center gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-700"
                      >
                        <img
                          alt="图标预览"
                          class="h-8 w-8"
                          :src="oemSettings.siteIconData || oemSettings.siteIcon"
                          @error="handleIconError"
                        />
                        <span class="text-sm text-gray-600 dark:text-gray-400">当前图标</span>
                        <button
                          class="rounded-lg px-3 py-1 font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-900"
                          @click="removeIcon"
                        >
                          <i class="fas fa-trash mr-1" />删除
                        </button>
                      </div>

                      <!-- 文件上传 -->
                      <div>
                        <input
                          ref="iconFileInput"
                          accept=".ico,.png,.jpg,.jpeg,.svg"
                          class="hidden"
                          type="file"
                          @change="handleIconUpload"
                        />
                        <button
                          class="btn btn-success px-4 py-2"
                          @click="$refs.iconFileInput.click()"
                        >
                          <i class="fas fa-upload mr-2" />
                          上传图标
                        </button>
                        <span class="ml-3 text-xs text-gray-500 dark:text-gray-400"
                          >支持 .ico, .png, .jpg, .svg 格式，最大 350KB</span
                        >
                      </div>
                    </div>
                  </td>
                </tr>

                <!-- 管理后台按钮显示控制 -->
                <tr class="table-row">
                  <td class="w-48 whitespace-nowrap px-6 py-4">
                    <div class="flex items-center">
                      <div
                        class="mr-3 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600"
                      >
                        <i class="fas fa-eye-slash text-xs text-white" />
                      </div>
                      <div>
                        <div class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          管理入口
                        </div>
                        <div class="text-xs text-gray-500 dark:text-gray-400">登录按钮显示</div>
                      </div>
                    </div>
                  </td>
                  <td class="px-6 py-4">
                    <div class="flex items-center">
                      <label class="inline-flex cursor-pointer items-center">
                        <input v-model="hideAdminButton" class="peer sr-only" type="checkbox" />
                        <div
                          class="peer relative h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800"
                        ></div>
                        <span class="ml-3 text-sm font-medium text-gray-900 dark:text-gray-300">{{
                          hideAdminButton ? '隐藏登录按钮' : '显示登录按钮'
                        }}</span>
                      </label>
                    </div>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      隐藏后，用户需要直接访问 /admin/login 页面登录
                    </p>
                  </td>
                </tr>

                <!-- 操作按钮 -->
                <tr>
                  <td class="px-6 py-6" colspan="2">
                    <div class="flex items-center justify-between">
                      <div class="flex gap-3">
                        <button
                          class="btn btn-primary px-6 py-3"
                          :class="{ 'cursor-not-allowed opacity-50': saving }"
                          :disabled="saving"
                          @click="saveOemSettings"
                        >
                          <div v-if="saving" class="loading-spinner mr-2"></div>
                          <i v-else class="fas fa-save mr-2" />
                          {{ saving ? '保存中...' : '保存设置' }}
                        </button>

                        <button
                          class="btn bg-gray-100 px-6 py-3 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                          :disabled="saving"
                          @click="resetOemSettings"
                        >
                          <i class="fas fa-undo mr-2" />
                          重置为默认
                        </button>
                      </div>

                      <div
                        v-if="oemSettings.updatedAt"
                        class="text-sm text-gray-500 dark:text-gray-400"
                      >
                        <i class="fas fa-clock mr-1" />
                        最后更新：{{ formatDateTime(oemSettings.updatedAt) }}
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 移动端卡片视图 -->
          <div class="space-y-4 sm:hidden">
            <!-- 站点名称卡片 -->
            <div class="glass-card p-4">
              <div class="mb-3 flex items-center gap-3">
                <div
                  class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-md"
                >
                  <i class="fas fa-tag"></i>
                </div>
                <div>
                  <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100">站点名称</h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400">自定义您的站点品牌名称</p>
                </div>
              </div>
              <input
                v-model="oemSettings.siteName"
                class="form-input w-full dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                maxlength="100"
                placeholder="Claude Relay Service"
                type="text"
              />
            </div>

            <!-- 站点图标卡片 -->
            <div class="glass-card p-4">
              <div class="mb-3 flex items-center gap-3">
                <div
                  class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 text-white shadow-md"
                >
                  <i class="fas fa-image"></i>
                </div>
                <div>
                  <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100">站点图标</h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400">
                    上传自定义图标或输入图标URL
                  </p>
                </div>
              </div>
              <div class="space-y-3">
                <!-- 图标预览 -->
                <div
                  v-if="oemSettings.siteIconData || oemSettings.siteIcon"
                  class="inline-flex items-center gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-700"
                >
                  <img
                    alt="图标预览"
                    class="h-8 w-8"
                    :src="oemSettings.siteIconData || oemSettings.siteIcon"
                    @error="handleIconError"
                  />
                  <span class="text-sm text-gray-600 dark:text-gray-400">当前图标</span>
                  <button
                    class="rounded-lg px-3 py-1 font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-900"
                    @click="removeIcon"
                  >
                    删除
                  </button>
                </div>

                <!-- 上传按钮 -->
                <div>
                  <input
                    ref="iconFileInputMobile"
                    accept=".ico,.png,.jpg,.jpeg,.svg"
                    class="hidden"
                    type="file"
                    @change="handleIconUpload"
                  />
                  <button
                    class="btn btn-success px-4 py-2"
                    @click="$refs.iconFileInputMobile.click()"
                  >
                    <i class="fas fa-upload mr-2" />
                    上传图标
                  </button>
                  <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    支持 .ico, .png, .jpg, .svg 格式，最大 350KB
                  </p>
                </div>
              </div>
            </div>

            <!-- 管理后台按钮显示控制卡片 -->
            <div class="glass-card p-4">
              <div class="mb-3 flex items-center gap-3">
                <div
                  class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md"
                >
                  <i class="fas fa-eye-slash"></i>
                </div>
                <div>
                  <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100">管理入口</h3>
                  <p class="text-sm text-gray-500 dark:text-gray-400">控制登录按钮在首页的显示</p>
                </div>
              </div>
              <div class="space-y-2">
                <label class="inline-flex cursor-pointer items-center">
                  <input v-model="hideAdminButton" class="peer sr-only" type="checkbox" />
                  <div
                    class="peer relative h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800"
                  ></div>
                  <span class="ml-3 text-sm font-medium text-gray-900 dark:text-gray-300">{{
                    hideAdminButton ? '隐藏登录按钮' : '显示登录按钮'
                  }}</span>
                </label>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  隐藏后，用户需要直接访问 /admin/login 页面登录
                </p>
              </div>
            </div>

            <!-- 操作按钮卡片 -->
            <div class="glass-card p-4">
              <div class="flex flex-col gap-3">
                <button
                  class="btn btn-primary w-full px-6 py-3"
                  :class="{ 'cursor-not-allowed opacity-50': saving }"
                  :disabled="saving"
                  @click="saveOemSettings"
                >
                  <div v-if="saving" class="loading-spinner mr-2"></div>
                  <i v-else class="fas fa-save mr-2" />
                  {{ saving ? '保存中...' : '保存设置' }}
                </button>

                <button
                  class="btn w-full bg-gray-100 px-6 py-3 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                  :disabled="saving"
                  @click="resetOemSettings"
                >
                  <i class="fas fa-undo mr-2" />
                  重置为默认
                </button>

                <div
                  v-if="oemSettings.updatedAt"
                  class="text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  <i class="fas fa-clock mr-1" />
                  上次更新: {{ formatDateTime(oemSettings.updatedAt) }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Webhook 设置部分 -->
        <div v-show="activeSection === 'webhook'">
          <!-- 主开关 -->
          <div
            class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
          >
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">启用通知</h2>
                <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  开启后，系统将按配置发送通知到指定平台
                </p>
              </div>
              <label class="relative inline-flex cursor-pointer items-center">
                <input
                  v-model="webhookConfig.enabled"
                  class="peer sr-only"
                  type="checkbox"
                  @change="saveWebhookConfig"
                />
                <div
                  class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800"
                ></div>
              </label>
            </div>
          </div>

          <!-- 通知类型设置 -->
          <div
            class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
          >
            <h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-200">通知类型</h2>
            <div class="space-y-3">
              <div
                v-for="(enabled, type) in webhookConfig.notificationTypes"
                :key="type"
                class="flex items-center justify-between"
              >
                <div>
                  <span class="font-medium text-gray-700 dark:text-gray-300">
                    {{ getNotificationTypeName(type) }}
                  </span>
                  <span class="ml-2 text-sm text-gray-500 dark:text-gray-400">
                    {{ getNotificationTypeDescription(type) }}
                  </span>
                </div>
                <label class="relative inline-flex cursor-pointer items-center">
                  <input
                    v-model="webhookConfig.notificationTypes[type]"
                    class="peer sr-only"
                    type="checkbox"
                    @change="saveWebhookConfig"
                  />
                  <div
                    class="peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-green-600 peer-checked:after:translate-x-full peer-checked:after:border-white dark:border-gray-600 dark:bg-gray-700"
                  ></div>
                </label>
              </div>
            </div>
          </div>

          <!-- 平台列表 -->
          <div
            class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
          >
            <div class="mb-4 flex items-center justify-between">
              <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">通知平台</h2>
              <button
                class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                @click="showAddPlatformModal = true"
              >
                <i class="fas fa-plus mr-2"></i>
                添加平台
              </button>
            </div>

            <!-- 平台卡片列表 -->
            <div
              v-if="webhookConfig.platforms && webhookConfig.platforms.length > 0"
              class="space-y-4"
            >
              <div
                v-for="platform in webhookConfig.platforms"
                :key="platform.id"
                class="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
              >
                <div class="flex items-start justify-between">
                  <div class="flex-1">
                    <div class="flex items-center">
                      <i class="mr-3 text-xl" :class="getPlatformIcon(platform.type)"></i>
                      <div>
                        <h3 class="font-semibold text-gray-800 dark:text-gray-200">
                          {{ platform.name || getPlatformName(platform.type) }}
                        </h3>
                        <p class="text-sm text-gray-500 dark:text-gray-400">
                          {{ getPlatformName(platform.type) }}
                        </p>
                      </div>
                    </div>
                    <div class="mt-3 space-y-1 text-sm">
                      <div
                        v-if="platform.type !== 'smtp' && platform.type !== 'telegram'"
                        class="flex items-center text-gray-600 dark:text-gray-400"
                      >
                        <i class="fas fa-link mr-2"></i>
                        <span class="truncate">{{ platform.url }}</span>
                      </div>
                      <div
                        v-if="platform.type === 'telegram'"
                        class="flex items-center text-gray-600 dark:text-gray-400"
                      >
                        <i class="fas fa-comments mr-2"></i>
                        <span class="truncate">Chat ID: {{ platform.chatId || '未配置' }}</span>
                      </div>
                      <div
                        v-if="platform.type === 'telegram' && platform.botToken"
                        class="flex items-center text-gray-600 dark:text-gray-400"
                      >
                        <i class="fas fa-key mr-2"></i>
                        <span class="truncate"
                          >Token: {{ formatTelegramToken(platform.botToken) }}</span
                        >
                      </div>
                      <div
                        v-if="platform.type === 'telegram' && platform.apiBaseUrl"
                        class="flex items-center text-gray-600 dark:text-gray-400"
                      >
                        <i class="fas fa-globe mr-2"></i>
                        <span class="truncate">API: {{ platform.apiBaseUrl }}</span>
                      </div>
                      <div
                        v-if="platform.type === 'telegram' && platform.proxyUrl"
                        class="flex items-center text-gray-600 dark:text-gray-400"
                      >
                        <i class="fas fa-route mr-2"></i>
                        <span class="truncate">代理: {{ platform.proxyUrl }}</span>
                      </div>
                      <div
                        v-if="platform.type === 'smtp' && platform.to"
                        class="flex items-center text-gray-600 dark:text-gray-400"
                      >
                        <i class="fas fa-envelope mr-2"></i>
                        <span class="truncate">{{
                          Array.isArray(platform.to) ? platform.to.join(', ') : platform.to
                        }}</span>
                      </div>
                      <div
                        v-if="platform.enableSign"
                        class="flex items-center text-gray-600 dark:text-gray-400"
                      >
                        <i class="fas fa-shield-alt mr-2"></i>
                        <span>已启用签名验证</span>
                      </div>
                    </div>
                  </div>
                  <div class="ml-4 flex items-center space-x-2">
                    <!-- 启用/禁用开关 -->
                    <label class="relative inline-flex cursor-pointer items-center">
                      <input
                        :checked="platform.enabled"
                        class="peer sr-only"
                        type="checkbox"
                        @change="togglePlatform(platform.id)"
                      />
                      <div
                        class="peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-green-600 peer-checked:after:translate-x-full peer-checked:after:border-white dark:border-gray-600 dark:bg-gray-700"
                      ></div>
                    </label>
                    <!-- 测试按钮 -->
                    <button
                      class="rounded-lg bg-blue-100 p-2 text-blue-600 transition-colors hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-400 dark:hover:bg-blue-800"
                      title="测试连接"
                      @click="testPlatform(platform)"
                    >
                      <i class="fas fa-vial"></i>
                    </button>
                    <!-- 编辑按钮 -->
                    <button
                      class="rounded-lg bg-gray-100 p-2 text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600"
                      title="编辑"
                      @click="editPlatform(platform)"
                    >
                      <i class="fas fa-edit"></i>
                    </button>
                    <!-- 删除按钮 -->
                    <button
                      class="rounded-lg bg-red-100 p-2 text-red-600 transition-colors hover:bg-red-200 dark:bg-red-900 dark:text-red-400 dark:hover:bg-red-800"
                      title="删除"
                      @click="deletePlatform(platform.id)"
                    >
                      <i class="fas fa-trash"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="py-8 text-center text-gray-500 dark:text-gray-400">
              暂无配置的通知平台，请点击"添加平台"按钮添加
            </div>
          </div>

          <!-- 高级设置 -->
          <div class="rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80">
            <h2 class="mb-4 text-lg font-semibold text-gray-800 dark:text-gray-200">高级设置</h2>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  最大重试次数
                </label>
                <input
                  v-model.number="webhookConfig.retrySettings.maxRetries"
                  class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white sm:text-sm"
                  max="10"
                  min="0"
                  type="number"
                  @change="saveWebhookConfig"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  重试延迟 (毫秒)
                </label>
                <input
                  v-model.number="webhookConfig.retrySettings.retryDelay"
                  class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white sm:text-sm"
                  max="10000"
                  min="100"
                  step="100"
                  type="number"
                  @change="saveWebhookConfig"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  超时时间 (毫秒)
                </label>
                <input
                  v-model.number="webhookConfig.retrySettings.timeout"
                  class="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white sm:text-sm"
                  max="30000"
                  min="1000"
                  step="1000"
                  type="number"
                  @change="saveWebhookConfig"
                />
              </div>
            </div>
          </div>

          <!-- 测试通知按钮 -->
          <div class="mt-6 text-center">
            <button
              class="rounded-lg bg-green-600 px-6 py-3 text-white shadow-lg transition-all hover:bg-green-700 hover:shadow-xl"
              @click="sendTestNotification"
            >
              <i class="fas fa-paper-plane mr-2"></i>
              发送测试通知
            </button>
          </div>
        </div>

        <!-- Claude 转发配置部分 -->
        <div v-show="activeSection === 'claude'">
          <!-- 加载状态 -->
          <div v-if="claudeConfigLoading" class="py-12 text-center">
            <div class="loading-spinner mx-auto mb-4"></div>
            <p class="text-gray-500 dark:text-gray-400">正在加载配置...</p>
          </div>

          <div v-else>
            <!-- Claude Code 客户端限制 -->
            <div
              class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
            >
              <div class="flex items-center justify-between">
                <div>
                  <div class="flex items-center">
                    <div
                      class="mr-3 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-lg"
                    >
                      <i class="fas fa-terminal"></i>
                    </div>
                    <div>
                      <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">
                        仅允许 Claude Code 客户端
                      </h2>
                      <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        启用后，所有
                        <code class="rounded bg-gray-100 px-1 dark:bg-gray-700"
                          >/api/v1/messages</code
                        >
                        和
                        <code class="rounded bg-gray-100 px-1 dark:bg-gray-700"
                          >/claude/v1/messages</code
                        >
                        端点将强制验证 Claude Code CLI 客户端
                      </p>
                    </div>
                  </div>
                </div>
                <label class="relative inline-flex cursor-pointer items-center">
                  <input
                    v-model="claudeConfig.claudeCodeOnlyEnabled"
                    class="peer sr-only"
                    type="checkbox"
                    @change="saveClaudeConfig"
                  />
                  <div
                    class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-orange-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-orange-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-orange-800"
                  ></div>
                </label>
              </div>
              <div class="mt-4 rounded-lg bg-amber-50 p-4 dark:bg-amber-900/20">
                <div class="flex">
                  <i class="fas fa-info-circle mt-0.5 text-amber-500"></i>
                  <div class="ml-3">
                    <p class="text-sm text-amber-700 dark:text-amber-300">
                      此设置与 API Key 级别的客户端限制是 <strong>OR 逻辑</strong>：全局启用或 API
                      Key 设置中启用，都会执行 Claude Code 验证。
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <!-- 全局会话绑定 -->
            <div
              class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
            >
              <div class="flex items-center justify-between">
                <div>
                  <div class="flex items-center">
                    <div
                      class="mr-3 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-lg"
                    >
                      <i class="fas fa-link"></i>
                    </div>
                    <div>
                      <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">
                        强制会话绑定
                      </h2>
                      <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        启用后，系统会将原始会话 ID 绑定到首次使用的账户，确保上下文的一致性
                      </p>
                    </div>
                  </div>
                </div>
                <label class="relative inline-flex cursor-pointer items-center">
                  <input
                    v-model="claudeConfig.globalSessionBindingEnabled"
                    class="peer sr-only"
                    type="checkbox"
                    @change="saveClaudeConfig"
                  />
                  <div
                    class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-purple-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-purple-800"
                  ></div>
                </label>
              </div>

              <!-- 绑定配置详情（仅在启用时显示） -->
              <div v-if="claudeConfig.globalSessionBindingEnabled" class="mt-6 space-y-4">
                <!-- 绑定有效期 -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    <i class="fas fa-clock mr-2 text-gray-400"></i>
                    绑定有效期（天）
                  </label>
                  <input
                    v-model.number="claudeConfig.sessionBindingTtlDays"
                    class="mt-1 block w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-gray-500 dark:bg-gray-700 dark:text-white sm:text-sm"
                    max="365"
                    min="1"
                    placeholder="30"
                    type="number"
                    @change="saveClaudeConfig"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    会话绑定到账户后的有效时间，过期后会自动解除绑定
                  </p>
                </div>

                <!-- 错误提示消息 -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    <i class="fas fa-exclamation-triangle mr-2 text-gray-400"></i>
                    旧会话污染提示
                  </label>
                  <textarea
                    v-model="claudeConfig.sessionBindingErrorMessage"
                    class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-gray-500 dark:bg-gray-700 dark:text-white sm:text-sm"
                    placeholder="你的本地session已污染，请清理后使用。"
                    rows="2"
                    @change="saveClaudeConfig"
                  ></textarea>
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    当检测到为旧的sessionId且未在系统中有调度记录时提示，返回给客户端的错误消息
                  </p>
                </div>
              </div>

              <div class="mt-4 rounded-lg bg-purple-50 p-4 dark:bg-purple-900/20">
                <div class="flex">
                  <i class="fas fa-lightbulb mt-0.5 text-purple-500"></i>
                  <div class="ml-3">
                    <p class="text-sm text-purple-700 dark:text-purple-300">
                      <strong>工作原理：</strong>系统会提取请求中的原始 session ID （来自
                      <code class="rounded bg-purple-100 px-1 dark:bg-purple-800"
                        >metadata.user_id</code
                      >）， 并将其与首次调度的账户绑定。后续使用相同 session ID
                      的请求将自动路由到同一账户。
                    </p>
                    <p class="mt-2 text-sm text-purple-700 dark:text-purple-300">
                      <strong>新会话识别：</strong>如果绑定会话历史中没有该sessionId但请求中
                      <code class="rounded bg-purple-100 px-1 dark:bg-purple-800"
                        >messages.length > 1</code
                      >， 系统会认为这是一个污染的会话并拒绝请求。
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <!-- 用户消息串行队列 -->
            <div
              class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
            >
              <div class="flex items-center justify-between">
                <div>
                  <div class="flex items-center">
                    <div
                      class="mr-3 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-teal-600 text-white shadow-lg"
                    >
                      <i class="fas fa-list-ol"></i>
                    </div>
                    <div>
                      <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">
                        用户消息串行队列
                      </h2>
                      <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        启用后，同一账户的用户消息请求将串行执行，并在请求之间添加延迟，防止触发上游限流
                      </p>
                    </div>
                  </div>
                </div>
                <label class="relative inline-flex cursor-pointer items-center">
                  <input
                    v-model="claudeConfig.userMessageQueueEnabled"
                    class="peer sr-only"
                    type="checkbox"
                    @change="saveClaudeConfig"
                  />
                  <div
                    class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-teal-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-teal-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-teal-800"
                  ></div>
                </label>
              </div>

              <!-- 队列配置详情（仅在启用时显示） -->
              <div v-if="claudeConfig.userMessageQueueEnabled" class="mt-6 space-y-4">
                <!-- 请求间隔 -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    <i class="fas fa-hourglass-half mr-2 text-gray-400"></i>
                    请求间隔（毫秒）
                  </label>
                  <input
                    v-model.number="claudeConfig.userMessageQueueDelayMs"
                    class="mt-1 block w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-gray-500 dark:bg-gray-700 dark:text-white sm:text-sm"
                    max="10000"
                    min="0"
                    placeholder="200"
                    type="number"
                    @change="saveClaudeConfig"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    同一账户的用户消息请求之间的最小间隔时间（0-10000毫秒）
                  </p>
                </div>

                <!-- 队列超时 -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    <i class="fas fa-stopwatch mr-2 text-gray-400"></i>
                    队列超时（毫秒）
                  </label>
                  <input
                    v-model.number="claudeConfig.userMessageQueueTimeoutMs"
                    class="mt-1 block w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 dark:border-gray-500 dark:bg-gray-700 dark:text-white sm:text-sm"
                    max="300000"
                    min="1000"
                    placeholder="30000"
                    type="number"
                    @change="saveClaudeConfig"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    请求在队列中等待的最大时间，超时将返回 503 错误（1000-300000毫秒）
                  </p>
                </div>
              </div>

              <div class="mt-4 rounded-lg bg-teal-50 p-4 dark:bg-teal-900/20">
                <div class="flex">
                  <i class="fas fa-info-circle mt-0.5 text-teal-500"></i>
                  <div class="ml-3">
                    <p class="text-sm text-teal-700 dark:text-teal-300">
                      <strong>工作原理：</strong>系统检测请求中最后一条消息的
                      <code class="rounded bg-teal-100 px-1 dark:bg-teal-800">role</code>
                      是否为
                      <code class="rounded bg-teal-100 px-1 dark:bg-teal-800">user</code
                      >。用户消息请求需要排队串行执行，而工具调用结果、助手消息续传等不受此限制。
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Sticky Session Auto Renewal -->
            <div
              class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center">
                  <div
                    class="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-lg"
                  >
                    <i class="fas fa-hourglass-half text-xl"></i>
                  </div>
                  <div class="ml-4">
                    <h4 class="text-lg font-semibold text-gray-900 dark:text-white">
                      Sticky Session Auto Renewal
                    </h4>
                    <p class="text-sm text-gray-500 dark:text-gray-400">
                      When disabled, active sessions are not renewed and may switch accounts after
                      TTL expiry
                    </p>
                  </div>
                </div>
                <label class="relative inline-flex cursor-pointer items-center">
                  <input
                    v-model="claudeConfig.stickySessionAutoRenewalEnabled"
                    class="peer sr-only"
                    type="checkbox"
                    @change="saveClaudeConfig"
                  />
                  <div
                    class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-indigo-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-indigo-800"
                  ></div>
                </label>
              </div>

              <div class="mt-4 rounded-lg bg-indigo-50 p-4 dark:bg-indigo-900/20">
                <div class="flex">
                  <i class="fas fa-info-circle mt-0.5 text-indigo-500"></i>
                  <div class="ml-3">
                    <p class="text-sm text-indigo-700 dark:text-indigo-300">
                      <strong>Recommended:</strong> keep this enabled so active mappings renew
                      before TTL expiry
                    </p>
                  </div>
                </div>
              </div>

              <div class="mt-6">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  <i class="fas fa-heartbeat mr-2 text-gray-400"></i>
                  OpenAI Stream Heartbeat Interval (ms)
                </label>
                <input
                  v-model.number="claudeConfig.openaiStreamHeartbeatIntervalMs"
                  class="mt-1 block w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-500 dark:bg-gray-700 dark:text-white sm:text-sm"
                  max="60000"
                  min="5000"
                  placeholder="15000"
                  step="1000"
                  type="number"
                  @change="saveClaudeConfig"
                />
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Controls OpenAI / OpenAI-Responses SSE keep-alive ping interval. Range:
                  5000-60000, default 15000.
                </p>
              </div>
            </div>

            <!-- Concurrent Request Queue -->
            <div
              class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center">
                  <div
                    class="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg"
                  >
                    <i class="fas fa-layer-group text-xl"></i>
                  </div>
                  <div class="ml-4">
                    <h4 class="text-lg font-semibold text-gray-900 dark:text-white">
                      并发请求排队
                    </h4>
                    <p class="text-sm text-gray-500 dark:text-gray-400">
                      当 API Key 并发请求超限时进入队列等待，而非直接拒绝
                    </p>
                  </div>
                </div>
                <label class="relative inline-flex cursor-pointer items-center">
                  <input
                    v-model="claudeConfig.concurrentRequestQueueEnabled"
                    class="peer sr-only"
                    type="checkbox"
                    @change="saveClaudeConfig"
                  />
                  <div
                    class="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-500 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-blue-800"
                  ></div>
                </label>
              </div>

              <!-- 排队配置详情（仅在启用时显示） -->
              <div v-if="claudeConfig.concurrentRequestQueueEnabled" class="mt-6 space-y-4">
                <!-- 固定最小排队数 -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    <i class="fas fa-list-ol mr-2 text-gray-400"></i>
                    固定最小排队数
                  </label>
                  <input
                    v-model.number="claudeConfig.concurrentRequestQueueMaxSize"
                    class="mt-1 block w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-500 dark:bg-gray-700 dark:text-white sm:text-sm"
                    max="100"
                    min="1"
                    placeholder="3"
                    type="number"
                    @change="saveClaudeConfig"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    最大排队数的固定最小值（1-100）
                  </p>
                </div>

                <!-- 排队数倍数 -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    <i class="fas fa-times mr-2 text-gray-400"></i>
                    排队数倍数
                  </label>
                  <input
                    v-model.number="claudeConfig.concurrentRequestQueueMaxSizeMultiplier"
                    class="mt-1 block w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-500 dark:bg-gray-700 dark:text-white sm:text-sm"
                    max="10"
                    min="0"
                    placeholder="1"
                    step="0.5"
                    type="number"
                    @change="saveClaudeConfig"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    最大排队数 = MAX(倍数 × 并发限制, 固定值)，设为 0 则仅使用固定值
                  </p>
                </div>

                <!-- 排队超时时间 -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    <i class="fas fa-stopwatch mr-2 text-gray-400"></i>
                    排队超时时间（毫秒）
                  </label>
                  <input
                    v-model.number="claudeConfig.concurrentRequestQueueTimeoutMs"
                    class="mt-1 block w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-500 dark:bg-gray-700 dark:text-white sm:text-sm"
                    max="300000"
                    min="5000"
                    placeholder="10000"
                    type="number"
                    @change="saveClaudeConfig"
                  />
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    请求在排队中等待的最大时间，超时将返回 429 错误（5秒-5分钟，默认10秒）
                  </p>
                </div>
              </div>

              <div class="mt-4 rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
                <div class="flex">
                  <i class="fas fa-info-circle mt-0.5 text-blue-500"></i>
                  <div class="ml-3">
                    <p class="text-sm text-blue-700 dark:text-blue-300">
                      <strong>工作原理：</strong>当 API Key 的并发请求超过
                      <code class="rounded bg-blue-100 px-1 dark:bg-blue-800"
                        >concurrencyLimit</code
                      >
                      时，超限请求会进入队列等待而非直接返回 429。适合 Claude Code Agent
                      并行工具调用场景。
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <!-- 配置更新信息 -->
            <div
              v-if="claudeConfig.updatedAt"
              class="rounded-lg bg-gray-50 p-4 text-sm text-gray-500 dark:bg-gray-700/50 dark:text-gray-400"
            >
              <i class="fas fa-history mr-2"></i>
              最后更新：{{ formatDateTime(claudeConfig.updatedAt) }}
              <span v-if="claudeConfig.updatedBy" class="ml-2">
                由 <strong>{{ claudeConfig.updatedBy }}</strong> 修改
              </span>
            </div>
          </div>
        </div>

        <!-- 模型价格配置部分 -->
        <div v-show="activeSection === 'pricing'">
          <div
            class="mb-6 rounded-lg bg-white/80 p-6 shadow-lg backdrop-blur-sm dark:bg-gray-800/80"
          >
            <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div class="flex items-center">
                  <div
                    class="mr-3 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg"
                  >
                    <i class="fas fa-tags"></i>
                  </div>
                  <div>
                    <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200">
                      模型价格覆盖
                    </h2>
                    <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      单位为 $/百万 tokens，留空则使用官方价格；自定义值会在价格文件刷新后继续生效。
                    </p>
                  </div>
                </div>
              </div>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  v-model="pricingSearch"
                  class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  placeholder="搜索模型"
                  type="search"
                />
                <div class="flex gap-2">
                  <input
                    v-model="newPricingModelName"
                    class="min-w-0 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                    placeholder="新增模型名"
                    type="text"
                    @keyup.enter="addCustomPricingModel"
                  />
                  <button
                    class="whitespace-nowrap rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                    @click="addCustomPricingModel"
                  >
                    添加
                  </button>
                </div>
                <button
                  class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                  :disabled="pricingLoading"
                  @click="loadPricingData"
                >
                  <i class="fas fa-sync-alt mr-2" :class="{ 'fa-spin': pricingLoading }"></i>
                  重新加载
                </button>
                <button
                  class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                  :disabled="pricingRefreshing"
                  @click="refreshOfficialPricing"
                >
                  <i
                    class="fas fa-cloud-download-alt mr-2"
                    :class="{ 'fa-spin': pricingRefreshing }"
                  ></i>
                  刷新官方价格
                </button>
              </div>
            </div>

            <div class="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div
                class="rounded-lg bg-emerald-50 p-3 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
              >
                模型数：{{ pricingStatus.modelCount || pricingRows.length }}
              </div>
              <div
                class="rounded-lg bg-blue-50 p-3 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300"
              >
                自定义：{{ pricingStatus.customModelCount || Object.keys(customPricing).length }}
              </div>
              <div
                class="rounded-lg bg-gray-50 p-3 text-gray-600 dark:bg-gray-700/50 dark:text-gray-300"
              >
                更新时间：{{ formatDateTime(pricingStatus.lastUpdated) || '未知' }}
              </div>
            </div>
          </div>

          <div v-if="pricingLoading" class="py-12 text-center">
            <div class="loading-spinner mx-auto mb-4"></div>
            <p class="text-gray-500 dark:text-gray-400">正在加载模型价格...</p>
          </div>

          <div
            v-else
            class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700"
          >
            <table class="w-full min-w-[1100px] divide-y divide-gray-200 dark:divide-gray-700">
              <thead class="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th
                    class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    模型
                  </th>
                  <th
                    class="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    服务商
                  </th>
                  <th
                    class="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    官方输入
                  </th>
                  <th
                    class="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    官方输出
                  </th>
                  <th
                    class="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    官方缓存写
                  </th>
                  <th
                    class="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    官方缓存读
                  </th>
                  <th
                    class="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    自定义输入
                  </th>
                  <th
                    class="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    自定义输出
                  </th>
                  <th
                    class="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    自定义缓存写
                  </th>
                  <th
                    class="px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    自定义缓存读
                  </th>
                  <th
                    class="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    操作
                  </th>
                </tr>
              </thead>
              <tbody
                class="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900"
              >
                <tr
                  v-for="model in pricingRows"
                  :key="model.name"
                  class="hover:bg-gray-50 dark:hover:bg-gray-800/70"
                >
                  <td class="px-3 py-3">
                    <div
                      class="max-w-xs truncate font-mono text-xs font-semibold text-gray-900 dark:text-gray-100"
                      :title="model.name"
                    >
                      {{ model.name }}
                    </div>
                    <div
                      v-if="hasCustomPricing(model.name)"
                      class="mt-1 text-xs text-emerald-600 dark:text-emerald-400"
                    >
                      已覆盖
                    </div>
                  </td>
                  <td class="px-3 py-3 text-sm text-gray-600 dark:text-gray-300">
                    {{ model.provider }}
                  </td>
                  <td
                    class="px-3 py-3 text-right font-mono text-xs text-gray-700 dark:text-gray-300"
                  >
                    {{ formatPricingNumber(model.input) }}
                  </td>
                  <td
                    class="px-3 py-3 text-right font-mono text-xs text-gray-700 dark:text-gray-300"
                  >
                    {{ formatPricingNumber(model.output) }}
                  </td>
                  <td
                    class="px-3 py-3 text-right font-mono text-xs text-gray-700 dark:text-gray-300"
                  >
                    {{ formatPricingNumber(model.cacheCreation) }}
                  </td>
                  <td
                    class="px-3 py-3 text-right font-mono text-xs text-gray-700 dark:text-gray-300"
                  >
                    {{ formatPricingNumber(model.cacheRead) }}
                  </td>
                  <td class="px-3 py-3">
                    <input
                      v-model="pricingDrafts[model.name].input"
                      class="w-24 rounded-md border border-gray-200 bg-white px-2 py-1 text-right font-mono text-xs text-gray-700 placeholder-gray-300 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-600"
                      min="0"
                      :placeholder="formatPricingNumber(model.input)"
                      step="0.01"
                      type="number"
                    />
                  </td>
                  <td class="px-3 py-3">
                    <input
                      v-model="pricingDrafts[model.name].output"
                      class="w-24 rounded-md border border-gray-200 bg-white px-2 py-1 text-right font-mono text-xs text-gray-700 placeholder-gray-300 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-600"
                      min="0"
                      :placeholder="formatPricingNumber(model.output)"
                      step="0.01"
                      type="number"
                    />
                  </td>
                  <td class="px-3 py-3">
                    <input
                      v-model="pricingDrafts[model.name].cacheCreation"
                      class="w-24 rounded-md border border-gray-200 bg-white px-2 py-1 text-right font-mono text-xs text-gray-700 placeholder-gray-300 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-600"
                      min="0"
                      :placeholder="formatPricingNumber(model.cacheCreation)"
                      step="0.01"
                      type="number"
                    />
                  </td>
                  <td class="px-3 py-3">
                    <input
                      v-model="pricingDrafts[model.name].cacheRead"
                      class="w-24 rounded-md border border-gray-200 bg-white px-2 py-1 text-right font-mono text-xs text-gray-700 placeholder-gray-300 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-600"
                      min="0"
                      :placeholder="formatPricingNumber(model.cacheRead)"
                      step="0.01"
                      type="number"
                    />
                  </td>
                  <td class="px-3 py-3 text-right">
                    <div class="flex justify-end gap-2">
                      <button
                        class="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                        :class="
                          canSavePricing(model.name) && pricingSavingModel !== model.name
                            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                            : 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                        "
                        :disabled="!canSavePricing(model.name) || pricingSavingModel === model.name"
                        @click="saveCustomPricing(model.name)"
                      >
                        <i
                          v-if="pricingSavingModel === model.name"
                          class="fas fa-spinner fa-spin"
                        ></i>
                        <span v-else>保存</span>
                      </button>
                      <button
                        class="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                        :class="
                          hasCustomPricing(model.name) && pricingSavingModel !== model.name
                            ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                            : 'cursor-not-allowed bg-gray-50 text-gray-300 dark:bg-gray-800 dark:text-gray-600'
                        "
                        :disabled="
                          !hasCustomPricing(model.name) || pricingSavingModel === model.name
                        "
                        @click="resetCustomPricing(model.name)"
                      >
                        重置
                      </button>
                    </div>
                  </td>
                </tr>
                <tr v-if="pricingRows.length === 0">
                  <td class="px-3 py-8 text-center text-gray-500 dark:text-gray-400" colspan="11">
                    没有匹配的模型
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 添加/编辑平台模态框 -->
  <div
    v-if="showAddPlatformModal"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-all duration-300 ease-out"
    @click="closePlatformModal"
  >
    <div
      class="relative mx-4 w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl transition-all duration-300 ease-out dark:bg-gray-800"
      @click.stop
    >
      <!-- 头部 -->
      <div
        class="dark:to-gray-750 relative border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-5 dark:border-gray-700 dark:from-gray-800"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg"
            >
              <i class="fas fa-bell"></i>
            </div>
            <div>
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white">
                {{ editingPlatform ? '编辑' : '添加' }}通知平台
              </h3>
              <p class="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                配置{{ editingPlatform ? '并更新' : '新的' }}Webhook通知渠道
              </p>
            </div>
          </div>
          <button
            class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            @click="closePlatformModal"
          >
            <i class="fas fa-times text-lg"></i>
          </button>
        </div>
      </div>

      <!-- 内容区域 -->
      <div class="p-6">
        <div class="space-y-5">
          <!-- 平台类型选择 -->
          <div>
            <label
              class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              <i class="fas fa-layer-group mr-2 text-gray-400"></i>
              平台类型
            </label>
            <div class="relative">
              <select
                v-model="platformForm.type"
                class="w-full appearance-none rounded-xl border border-gray-300 bg-white px-4 py-3 pr-10 text-gray-900 shadow-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                :disabled="editingPlatform"
              >
                <option value="wechat_work">🟢 企业微信</option>
                <option value="dingtalk">🔵 钉钉</option>
                <option value="feishu">🟦 飞书</option>
                <option value="slack">🟣 Slack</option>
                <option value="discord">🟪 Discord</option>
                <option value="telegram">✈️ Telegram</option>
                <option value="bark">🔔 Bark</option>
                <option value="smtp">📧 邮件通知</option>
                <option value="custom">⚙️ 自定义</option>
              </select>
              <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                <i class="fas fa-chevron-down text-gray-400"></i>
              </div>
            </div>
            <p v-if="editingPlatform" class="mt-1 text-xs text-amber-600 dark:text-amber-400">
              <i class="fas fa-info-circle mr-1"></i>
              编辑模式下不能更改平台类型
            </p>
          </div>

          <!-- 平台名称 -->
          <div>
            <label
              class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              <i class="fas fa-tag mr-2 text-gray-400"></i>
              名称
              <span class="ml-2 text-xs text-gray-500">(可选)</span>
            </label>
            <input
              v-model="platformForm.name"
              class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
              placeholder="例如：运维群通知、开发测试群"
              type="text"
            />
          </div>

          <!-- Webhook URL (非Bark和SMTP平台) -->
          <div
            v-if="
              platformForm.type !== 'bark' &&
              platformForm.type !== 'smtp' &&
              platformForm.type !== 'telegram'
            "
          >
            <label
              class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              <i class="fas fa-link mr-2 text-gray-400"></i>
              Webhook URL
              <span class="ml-1 text-xs text-red-500">*</span>
            </label>
            <div class="relative">
              <input
                v-model="platformForm.url"
                class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 pr-10 font-mono text-sm text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
                :class="{
                  'border-red-500 focus:border-red-500 focus:ring-red-500/20': urlError,
                  'border-green-500 focus:border-green-500 focus:ring-green-500/20': urlValid
                }"
                placeholder="https://..."
                required
                type="url"
                @input="validateUrl"
              />
              <div v-if="urlValid" class="absolute inset-y-0 right-0 flex items-center pr-3">
                <i class="fas fa-check-circle text-green-500"></i>
              </div>
              <div v-if="urlError" class="absolute inset-y-0 right-0 flex items-center pr-3">
                <i class="fas fa-exclamation-circle text-red-500"></i>
              </div>
            </div>
            <div
              v-if="getWebhookHint(platformForm.type)"
              class="mt-2 flex items-start rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20"
            >
              <i class="fas fa-info-circle mr-2 mt-0.5 text-blue-600 dark:text-blue-400"></i>
              <p class="text-sm text-blue-700 dark:text-blue-300">
                {{ getWebhookHint(platformForm.type) }}
              </p>
            </div>
          </div>

          <!-- Telegram 平台特有字段 -->
          <div v-if="platformForm.type === 'telegram'" class="space-y-5">
            <div>
              <label
                class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <i class="fas fa-robot mr-2 text-gray-400"></i>
                Bot Token
                <span class="ml-1 text-xs text-red-500">*</span>
              </label>
              <input
                v-model="platformForm.botToken"
                class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
                placeholder="例如：123456789:ABCDEFghijk-xyz"
                required
                type="text"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                在 Telegram 的 @BotFather 中创建机器人后获得的 Token
              </p>
            </div>

            <div>
              <label
                class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <i class="fas fa-comments mr-2 text-gray-400"></i>
                Chat ID
                <span class="ml-1 text-xs text-red-500">*</span>
              </label>
              <input
                v-model="platformForm.chatId"
                class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
                placeholder="例如：123456789 或 -1001234567890"
                required
                type="text"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                可使用 @userinfobot、@RawDataBot 或 API 获取聊天/频道的 Chat ID
              </p>
            </div>

            <div>
              <label
                class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <i class="fas fa-globe mr-2 text-gray-400"></i>
                API 基础地址
                <span class="ml-2 text-xs text-gray-500">(可选)</span>
              </label>
              <input
                v-model="platformForm.apiBaseUrl"
                class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
                placeholder="默认: https://api.telegram.org"
                type="url"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                使用自建 Bot API 时可覆盖默认域名，需以 http 或 https 开头
              </p>
            </div>

            <div>
              <label
                class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <i class="fas fa-route mr-2 text-gray-400"></i>
                代理地址
                <span class="ml-2 text-xs text-gray-500">(可选)</span>
              </label>
              <input
                v-model="platformForm.proxyUrl"
                class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
                placeholder="例如：socks5://user:pass@127.0.0.1:1080"
                type="text"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                支持 http、https、socks4/4a/5 代理，留空则直接连接 Telegram 官方 API
              </p>
            </div>

            <div
              class="flex items-start rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-300"
            >
              <i class="fas fa-info-circle mr-2 mt-0.5"></i>
              <div>机器人需先加入对应群组或频道并授予发送消息权限，通知会以纯文本方式发送。</div>
            </div>
          </div>

          <!-- Bark 平台特有字段 -->
          <div v-if="platformForm.type === 'bark'" class="space-y-5">
            <!-- 设备密钥 -->
            <div>
              <label
                class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <i class="fas fa-key mr-2 text-gray-400"></i>
                设备密钥 (Device Key)
                <span class="ml-1 text-xs text-red-500">*</span>
              </label>
              <input
                v-model="platformForm.deviceKey"
                class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
                placeholder="例如：aBcDeFgHiJkLmNoPqRsTuVwX"
                required
                type="text"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                在Bark App中查看您的推送密钥
              </p>
            </div>

            <!-- 服务器URL（可选） -->
            <div>
              <label
                class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <i class="fas fa-server mr-2 text-gray-400"></i>
                服务器地址
                <span class="ml-2 text-xs text-gray-500">(可选)</span>
              </label>
              <input
                v-model="platformForm.serverUrl"
                class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
                placeholder="默认: https://api.day.app/push"
                type="url"
              />
            </div>

            <!-- 通知级别 -->
            <div>
              <label
                class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <i class="fas fa-flag mr-2 text-gray-400"></i>
                通知级别
              </label>
              <select
                v-model="platformForm.level"
                class="w-full appearance-none rounded-xl border border-gray-300 bg-white px-4 py-3 pr-10 text-gray-900 shadow-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="">自动（根据通知类型）</option>
                <option value="passive">被动</option>
                <option value="active">默认</option>
                <option value="timeSensitive">时效性</option>
                <option value="critical">紧急</option>
              </select>
            </div>

            <!-- 通知声音 -->
            <div>
              <label
                class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <i class="fas fa-volume-up mr-2 text-gray-400"></i>
                通知声音
              </label>
              <select
                v-model="platformForm.sound"
                class="w-full appearance-none rounded-xl border border-gray-300 bg-white px-4 py-3 pr-10 text-gray-900 shadow-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="">自动（根据通知类型）</option>
                <option value="default">默认</option>
                <option value="alarm">警报</option>
                <option value="bell">铃声</option>
                <option value="birdsong">鸟鸣</option>
                <option value="electronic">电子音</option>
                <option value="glass">玻璃</option>
                <option value="horn">喇叭</option>
                <option value="silence">静音</option>
              </select>
            </div>

            <!-- 分组 -->
            <div>
              <label
                class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <i class="fas fa-folder mr-2 text-gray-400"></i>
                通知分组
                <span class="ml-2 text-xs text-gray-500">(可选)</span>
              </label>
              <input
                v-model="platformForm.group"
                class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
                placeholder="默认: claude-relay"
                type="text"
              />
            </div>

            <!-- 提示信息 -->
            <div class="mt-2 flex items-start rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
              <i class="fas fa-info-circle mr-2 mt-0.5 text-blue-600 dark:text-blue-400"></i>
              <div class="text-sm text-blue-700 dark:text-blue-300">
                <p>1. 在iPhone上安装Bark App</p>
                <p>2. 打开App获取您的设备密钥</p>
                <p>3. 将密钥粘贴到上方输入框</p>
              </div>
            </div>
          </div>

          <!-- SMTP 平台特有字段 -->
          <div v-if="platformForm.type === 'smtp'" class="space-y-5">
            <!-- SMTP 主机 -->
            <div>
              <label
                class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <i class="fas fa-server mr-2 text-gray-400"></i>
                SMTP 服务器
                <span class="ml-1 text-xs text-red-500">*</span>
              </label>
              <input
                v-model="platformForm.host"
                class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
                placeholder="例如: smtp.gmail.com"
                required
                type="text"
              />
            </div>

            <!-- SMTP 端口和安全设置 -->
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  <i class="fas fa-plug mr-2 text-gray-400"></i>
                  端口
                </label>
                <input
                  v-model.number="platformForm.port"
                  class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  max="65535"
                  min="1"
                  placeholder="587"
                  type="number"
                />
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  默认: 587 (TLS) 或 465 (SSL)
                </p>
              </div>

              <div>
                <label
                  class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  <i class="fas fa-shield-alt mr-2 text-gray-400"></i>
                  加密方式
                </label>
                <select
                  v-model="platformForm.secure"
                  class="w-full appearance-none rounded-xl border border-gray-300 bg-white px-4 py-3 pr-10 text-gray-900 shadow-sm transition-all focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                >
                  <option :value="false">STARTTLS (端口587)</option>
                  <option :value="true">SSL/TLS (端口465)</option>
                </select>
              </div>
            </div>

            <!-- 用户名 -->
            <div>
              <label
                class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <i class="fas fa-user mr-2 text-gray-400"></i>
                用户名
                <span class="ml-1 text-xs text-red-500">*</span>
              </label>
              <input
                v-model="platformForm.user"
                class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
                placeholder="user@example.com"
                required
                type="email"
              />
            </div>

            <!-- 密码 -->
            <div>
              <label
                class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <i class="fas fa-lock mr-2 text-gray-400"></i>
                密码 / 应用密码
                <span class="ml-1 text-xs text-red-500">*</span>
              </label>
              <input
                v-model="platformForm.pass"
                class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
                placeholder="邮箱密码或应用专用密码"
                required
                type="password"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                建议使用应用专用密码，而非邮箱登录密码
              </p>
            </div>

            <!-- 发件人邮箱 -->
            <div>
              <label
                class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <i class="fas fa-paper-plane mr-2 text-gray-400"></i>
                发件人邮箱
                <span class="ml-2 text-xs text-gray-500">(可选)</span>
              </label>
              <input
                v-model="platformForm.from"
                class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
                placeholder="默认使用用户名邮箱"
                type="email"
              />
            </div>

            <!-- 收件人邮箱 -->
            <div>
              <label
                class="mb-2 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                <i class="fas fa-envelope mr-2 text-gray-400"></i>
                收件人邮箱
                <span class="ml-1 text-xs text-red-500">*</span>
              </label>
              <input
                v-model="platformForm.to"
                class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder:text-gray-500"
                placeholder="admin@example.com"
                required
                type="email"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">接收通知的邮箱地址</p>
            </div>
          </div>

          <!-- 签名设置（钉钉/飞书） -->
          <div
            v-if="platformForm.type === 'dingtalk' || platformForm.type === 'feishu'"
            class="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50"
          >
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <label class="flex cursor-pointer items-center" for="enableSign">
                  <input
                    id="enableSign"
                    v-model="platformForm.enableSign"
                    class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0"
                    type="checkbox"
                  />
                  <span
                    class="ml-3 flex items-center text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    <i class="fas fa-shield-alt mr-2 text-gray-400"></i>
                    启用签名验证
                  </span>
                </label>
                <span
                  v-if="platformForm.enableSign"
                  class="rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/50 dark:text-green-400"
                >
                  已启用
                </span>
              </div>
              <transition
                enter-active-class="transition-all duration-200 ease-out"
                enter-from-class="opacity-0 -translate-y-2"
                enter-to-class="opacity-100 translate-y-0"
                leave-active-class="transition-all duration-150 ease-in"
                leave-from-class="opacity-100 translate-y-0"
                leave-to-class="opacity-0 -translate-y-2"
              >
                <div v-if="platformForm.enableSign">
                  <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    签名密钥
                  </label>
                  <input
                    v-model="platformForm.secret"
                    class="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-900 shadow-sm transition-all placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500"
                    placeholder="SEC..."
                    type="text"
                  />
                </div>
              </transition>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div
        class="border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-900/50"
      >
        <div class="flex items-center justify-between">
          <div class="text-xs text-gray-500 dark:text-gray-400">
            <i class="fas fa-asterisk mr-1 text-red-500"></i>
            必填项
          </div>
          <div class="flex space-x-3">
            <button
              class="group flex items-center rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow-md dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              @click="closePlatformModal"
            >
              <i class="fas fa-times mr-2 transition-transform group-hover:scale-110"></i>
              取消
            </button>
            <button
              class="group flex items-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 shadow-sm transition-all hover:bg-blue-100 hover:shadow-md dark:border-blue-800 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/70"
              :disabled="testingConnection"
              @click="testPlatformForm"
            >
              <i
                class="mr-2 transition-transform"
                :class="
                  testingConnection ? 'fas fa-spinner fa-spin' : 'fas fa-vial group-hover:scale-110'
                "
              ></i>
              {{ testingConnection ? '测试中...' : '测试连接' }}
            </button>
            <button
              class="group flex items-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all hover:from-blue-700 hover:to-indigo-700 hover:shadow-lg disabled:cursor-not-allowed disabled:from-gray-400 disabled:to-gray-500"
              :disabled="!isPlatformFormValid || savingPlatform"
              @click="savePlatform"
            >
              <i
                class="mr-2 transition-transform"
                :class="
                  savingPlatform ? 'fas fa-spinner fa-spin' : 'fas fa-save group-hover:scale-110'
                "
              ></i>
              {{ savingPlatform ? '保存中...' : editingPlatform ? '保存修改' : '添加平台' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { showToast } from '@/utils/toast'
import { useSettingsStore } from '@/stores/settings'
import { apiClient } from '@/config/api'

// 定义组件名称，用于keep-alive排除
defineOptions({
  name: 'SettingsView'
})

// 使用settings store
const settingsStore = useSettingsStore()
const { loading, saving, oemSettings } = storeToRefs(settingsStore)

// 组件refs
const iconFileInput = ref()

// 当前激活的设置部分
const activeSection = ref('branding')

// 组件挂载状态
const isMounted = ref(true)

// API请求取消控制器
const abortController = ref(new AbortController())

// 计算属性：隐藏管理后台按钮（反转 showAdminButton 的值）
const hideAdminButton = computed({
  get() {
    return !oemSettings.value.showAdminButton
  },
  set(value) {
    oemSettings.value.showAdminButton = !value
  }
})

// URL 验证状态
const urlError = ref(false)
const urlValid = ref(false)
const testingConnection = ref(false)
const savingPlatform = ref(false)

// Webhook 配置
const DEFAULT_WEBHOOK_NOTIFICATION_TYPES = {
  accountAnomaly: true,
  quotaWarning: true,
  systemError: true,
  securityAlert: true,
  rateLimitRecovery: true
}

const webhookConfig = ref({
  enabled: false,
  platforms: [],
  notificationTypes: { ...DEFAULT_WEBHOOK_NOTIFICATION_TYPES },
  retrySettings: {
    maxRetries: 3,
    retryDelay: 1000,
    timeout: 10000
  }
})

// Claude 转发配置
const claudeConfigLoading = ref(false)
const claudeConfig = ref({
  claudeCodeOnlyEnabled: false,
  globalSessionBindingEnabled: false,
  sessionBindingErrorMessage: '你的本地session已污染，请清理后使用。',
  sessionBindingTtlDays: 30,
  userMessageQueueEnabled: false, // 与后端默认值保持一致
  userMessageQueueDelayMs: 200,
  userMessageQueueTimeoutMs: 5000, // 与后端默认值保持一致（优化后锁持有时间短无需长等待）
  stickySessionAutoRenewalEnabled: true,
  concurrentRequestQueueEnabled: false,
  concurrentRequestQueueMaxSize: 3,
  concurrentRequestQueueMaxSizeMultiplier: 0,
  concurrentRequestQueueTimeoutMs: 10000,
  openaiStreamHeartbeatIntervalMs: 15000,
  updatedAt: null,
  updatedBy: null
})

// 模型价格配置
const pricingLoading = ref(false)
const pricingRefreshing = ref(false)
const pricingSavingModel = ref('')
const pricingSearch = ref('')
const newPricingModelName = ref('')
const modelPricingData = ref({})
const customPricing = ref({})
const pricingStatus = ref({})
const pricingDrafts = ref({})

// 平台表单相关
const showAddPlatformModal = ref(false)
const editingPlatform = ref(null)
const platformForm = ref({
  type: 'wechat_work',
  name: '',
  url: '',
  enableSign: false,
  secret: '',
  // Telegram特有字段
  botToken: '',
  chatId: '',
  apiBaseUrl: '',
  proxyUrl: '',
  // Bark特有字段
  deviceKey: '',
  serverUrl: '',
  level: '',
  sound: '',
  group: '',
  // SMTP特有字段
  host: '',
  port: null,
  secure: false,
  user: '',
  pass: '',
  from: '',
  to: '',
  timeout: null,
  ignoreTLS: false
})

// 监听activeSection变化，加载对应配置
const sectionWatcher = watch(activeSection, async (newSection) => {
  if (!isMounted.value) return
  if (newSection === 'webhook') {
    await loadWebhookConfig()
  } else if (newSection === 'claude') {
    await loadClaudeConfig()
  } else if (newSection === 'pricing') {
    await loadPricingData()
  }
})

// 监听平台类型变化，重置验证状态
const platformTypeWatcher = watch(
  () => platformForm.value.type,
  (newType) => {
    // 切换平台类型时重置验证状态
    urlError.value = false
    urlValid.value = false

    // 如果不是编辑模式，清空相关字段
    if (!editingPlatform.value) {
      if (newType === 'bark') {
        // 切换到Bark时，清空URL和SMTP相关字段
        platformForm.value.url = ''
        platformForm.value.enableSign = false
        platformForm.value.secret = ''
        // 清空Telegram字段
        platformForm.value.botToken = ''
        platformForm.value.chatId = ''
        platformForm.value.apiBaseUrl = ''
        platformForm.value.proxyUrl = ''
        // 清空SMTP字段
        platformForm.value.host = ''
        platformForm.value.port = null
        platformForm.value.secure = false
        platformForm.value.user = ''
        platformForm.value.pass = ''
        platformForm.value.from = ''
        platformForm.value.to = ''
        platformForm.value.timeout = null
        platformForm.value.ignoreTLS = false
      } else if (newType === 'smtp') {
        // 切换到SMTP时，清空URL和Bark相关字段
        platformForm.value.url = ''
        platformForm.value.enableSign = false
        platformForm.value.secret = ''
        // 清空Bark字段
        platformForm.value.deviceKey = ''
        platformForm.value.serverUrl = ''
        platformForm.value.level = ''
        platformForm.value.sound = ''
        platformForm.value.group = ''
        // 清空Telegram字段
        platformForm.value.botToken = ''
        platformForm.value.chatId = ''
        platformForm.value.apiBaseUrl = ''
        platformForm.value.proxyUrl = ''
      } else if (newType === 'telegram') {
        platformForm.value.url = ''
        platformForm.value.enableSign = false
        platformForm.value.secret = ''
        platformForm.value.deviceKey = ''
        platformForm.value.serverUrl = ''
        platformForm.value.level = ''
        platformForm.value.sound = ''
        platformForm.value.group = ''
        platformForm.value.host = ''
        platformForm.value.port = null
        platformForm.value.secure = false
        platformForm.value.user = ''
        platformForm.value.pass = ''
        platformForm.value.from = ''
        platformForm.value.to = ''
        platformForm.value.timeout = null
        platformForm.value.ignoreTLS = false
        platformForm.value.botToken = ''
        platformForm.value.chatId = ''
        platformForm.value.apiBaseUrl = ''
        platformForm.value.proxyUrl = ''
      } else {
        // 切换到其他平台时，清空Bark和SMTP相关字段
        platformForm.value.deviceKey = ''
        platformForm.value.serverUrl = ''
        platformForm.value.level = ''
        platformForm.value.sound = ''
        platformForm.value.group = ''
        // SMTP 字段
        platformForm.value.host = ''
        platformForm.value.port = null
        platformForm.value.secure = false
        platformForm.value.user = ''
        platformForm.value.pass = ''
        platformForm.value.from = ''
        platformForm.value.to = ''
        platformForm.value.timeout = null
        platformForm.value.ignoreTLS = false
        // Telegram 字段
        platformForm.value.botToken = ''
        platformForm.value.chatId = ''
        platformForm.value.apiBaseUrl = ''
        platformForm.value.proxyUrl = ''
      }
    }
  }
)

// 计算属性：判断平台表单是否有效
const isPlatformFormValid = computed(() => {
  if (platformForm.value.type === 'bark') {
    // Bark平台需要deviceKey
    return !!platformForm.value.deviceKey
  } else if (platformForm.value.type === 'telegram') {
    // Telegram需要机器人Token和Chat ID
    return !!(platformForm.value.botToken && platformForm.value.chatId)
  } else if (platformForm.value.type === 'smtp') {
    // SMTP平台需要必要的配置
    return !!(
      platformForm.value.host &&
      platformForm.value.user &&
      platformForm.value.pass &&
      platformForm.value.to
    )
  } else {
    // 其他平台需要URL且URL格式正确
    return !!platformForm.value.url && !urlError.value
  }
})

// 统一提取接口错误信息，避免仅提示“保存失败”而丢失后端原因
const getApiErrorMessage = (error, fallbackMessage) => {
  const candidates = [error?.response?.data?.message, error?.response?.data?.error, error?.message]
  const detailMessage = candidates.find((item) => typeof item === 'string' && item.trim())

  if (!detailMessage || detailMessage === fallbackMessage) {
    return fallbackMessage
  }

  return `${fallbackMessage}：${detailMessage}`
}

// 模型价格相关函数
const perTokenToMTok = (value) => {
  if (value === null || value === undefined) return ''
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return ''
  return Number((numberValue * 1e6).toFixed(6)).toString()
}

const toMTokNumber = (value) => {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue * 1e6 : 0
}

const formatPricingNumber = (value) => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return '-'
  if (numberValue === 0) return '0'
  if (numberValue < 0.01) return numberValue.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  if (numberValue < 1) return numberValue.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return numberValue.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

const parseMTokInput = (value) => {
  if (value === '' || value === null || value === undefined) return null
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue < 0) return NaN
  return numberValue / 1e6
}

const samePriceValue = (left, right) => {
  if (left === null && right === null) return true
  if (left === null || right === null) return false
  return Math.abs(left - right) < 1e-15
}

const syncPricingDrafts = () => {
  const next = {}
  const names = new Set([
    ...Object.keys(modelPricingData.value),
    ...Object.keys(customPricing.value)
  ])

  for (const name of names) {
    const override = customPricing.value[name]
    next[name] = {
      input: override ? perTokenToMTok(override.input) : '',
      output: override ? perTokenToMTok(override.output) : '',
      cacheCreation: override ? perTokenToMTok(override.cacheCreation) : '',
      cacheRead: override ? perTokenToMTok(override.cacheRead) : ''
    }
  }

  pricingDrafts.value = next
}

const pricingRows = computed(() => {
  const query = pricingSearch.value.trim().toLowerCase()

  return Object.entries(modelPricingData.value)
    .map(([name, data]) => ({
      name,
      provider: data.litellm_provider || data.provider || 'custom',
      input: toMTokNumber(data.input_cost_per_token),
      output: toMTokNumber(data.output_cost_per_token),
      cacheCreation: toMTokNumber(data.cache_creation_input_token_cost),
      cacheRead: toMTokNumber(data.cache_read_input_token_cost)
    }))
    .filter((model) => {
      if (!query) return true
      return `${model.name} ${model.provider}`.toLowerCase().includes(query)
    })
    .sort((a, b) => {
      const customDiff = Number(hasCustomPricing(b.name)) - Number(hasCustomPricing(a.name))
      return customDiff || a.name.localeCompare(b.name)
    })
})

const loadPricingData = async () => {
  if (!isMounted.value) return
  pricingLoading.value = true
  try {
    const [pricingResult, statusResult, customResult] = await Promise.all([
      apiClient.get('/admin/models/pricing', { signal: abortController.value.signal }),
      apiClient.get('/admin/models/pricing/status', { signal: abortController.value.signal }),
      apiClient.get('/admin/models/pricing/custom', { signal: abortController.value.signal })
    ])

    if (!isMounted.value) return

    if (pricingResult.success) {
      modelPricingData.value = pricingResult.data || {}
      customPricing.value = pricingResult.customPricing || {}
    }
    if (statusResult.success) {
      pricingStatus.value = statusResult.data || {}
    }
    if (customResult.success) {
      customPricing.value = customResult.data || {}
    }

    syncPricingDrafts()
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast(getApiErrorMessage(error, '加载模型价格失败'), 'error')
    console.error(error)
  } finally {
    if (isMounted.value) {
      pricingLoading.value = false
    }
  }
}

const refreshOfficialPricing = async () => {
  if (!isMounted.value) return
  pricingRefreshing.value = true
  try {
    const result = await apiClient.post(
      '/admin/models/pricing/refresh',
      {},
      {
        signal: abortController.value.signal
      }
    )
    if (result.success) {
      showToast('官方价格已刷新', 'success')
    } else {
      showToast(result.message || '刷新失败，已保留可用价格', 'warning')
    }
    await loadPricingData()
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast(getApiErrorMessage(error, '刷新模型价格失败'), 'error')
    console.error(error)
  } finally {
    if (isMounted.value) {
      pricingRefreshing.value = false
    }
  }
}

const hasCustomPricing = (name) => Boolean(customPricing.value[name])

const addCustomPricingModel = () => {
  const name = newPricingModelName.value.trim()
  if (!name) {
    showToast('请输入模型名', 'error')
    return
  }

  if (!modelPricingData.value[name]) {
    modelPricingData.value = {
      ...modelPricingData.value,
      [name]: { litellm_provider: 'custom' }
    }
    syncPricingDrafts()
  }

  pricingSearch.value = name
  newPricingModelName.value = ''
}

const canSavePricing = (name) => {
  const draft = pricingDrafts.value[name]
  if (!draft) return false

  const parsed = {
    input: parseMTokInput(draft.input),
    output: parseMTokInput(draft.output),
    cacheCreation: parseMTokInput(draft.cacheCreation),
    cacheRead: parseMTokInput(draft.cacheRead)
  }

  if (Object.values(parsed).some((value) => Number.isNaN(value))) return false
  if (Object.values(parsed).every((value) => value === null)) return false

  const current = customPricing.value[name] || {}
  return ['input', 'output', 'cacheCreation', 'cacheRead'].some(
    (field) => !samePriceValue(parsed[field], current[field] ?? null)
  )
}

const saveCustomPricing = async (name) => {
  const draft = pricingDrafts.value[name]
  if (!draft) return

  const payload = {
    input: parseMTokInput(draft.input),
    output: parseMTokInput(draft.output),
    cacheCreation: parseMTokInput(draft.cacheCreation),
    cacheRead: parseMTokInput(draft.cacheRead)
  }

  if (Object.values(payload).some((value) => Number.isNaN(value))) {
    showToast('请输入有效的非负数字', 'error')
    return
  }
  if (Object.values(payload).every((value) => value === null)) {
    showToast('请至少填写一个自定义价格', 'error')
    return
  }

  pricingSavingModel.value = name
  try {
    const result = await apiClient.put(
      `/admin/models/pricing/custom/${encodeURIComponent(name)}`,
      payload,
      { signal: abortController.value.signal }
    )

    if (result.success) {
      customPricing.value = { ...customPricing.value, [name]: result.data }
      syncPricingDrafts()
      showToast('价格已保存', 'success')
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    showToast(getApiErrorMessage(error, '保存价格失败'), 'error')
    console.error(error)
  } finally {
    pricingSavingModel.value = ''
  }
}

const resetCustomPricing = async (name) => {
  pricingSavingModel.value = name
  try {
    const result = await apiClient.delete(
      `/admin/models/pricing/custom/${encodeURIComponent(name)}`,
      {
        signal: abortController.value.signal
      }
    )

    if (result.success) {
      const next = { ...customPricing.value }
      delete next[name]
      customPricing.value = next
      syncPricingDrafts()
      showToast('已重置为官方价格', 'success')
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    showToast(getApiErrorMessage(error, '重置价格失败'), 'error')
    console.error(error)
  } finally {
    pricingSavingModel.value = ''
  }
}

// 页面加载时获取设置
onMounted(async () => {
  try {
    await settingsStore.loadOemSettings()
    if (activeSection.value === 'webhook') {
      await loadWebhookConfig()
    } else if (activeSection.value === 'pricing') {
      await loadPricingData()
    }
  } catch (error) {
    showToast('加载设置失败', 'error')
  }
})

// 组件卸载前清理
onBeforeUnmount(() => {
  // 设置组件未挂载状态
  isMounted.value = false

  // 取消所有API请求
  if (abortController.value) {
    abortController.value.abort()
  }

  // 停止watch监听器
  if (sectionWatcher) {
    sectionWatcher()
  }
  if (platformTypeWatcher) {
    platformTypeWatcher()
  }

  // 安全关闭模态框
  if (showAddPlatformModal.value) {
    showAddPlatformModal.value = false
    editingPlatform.value = null
  }
})

// Webhook 相关函数

// 获取webhook配置
const loadWebhookConfig = async () => {
  if (!isMounted.value) return
  try {
    const response = await apiClient.get('/admin/webhook/config', {
      signal: abortController.value.signal
    })
    if (response.success && isMounted.value) {
      const config = response.config || {}
      webhookConfig.value = {
        ...config,
        notificationTypes: {
          ...DEFAULT_WEBHOOK_NOTIFICATION_TYPES,
          ...(config.notificationTypes || {})
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast('获取webhook配置失败', 'error')
    console.error(error)
  }
}

// 保存webhook配置
const saveWebhookConfig = async () => {
  if (!isMounted.value) return
  try {
    const payload = {
      ...webhookConfig.value,
      notificationTypes: {
        ...DEFAULT_WEBHOOK_NOTIFICATION_TYPES,
        ...(webhookConfig.value.notificationTypes || {})
      }
    }

    const response = await apiClient.post('/admin/webhook/config', payload, {
      signal: abortController.value.signal
    })
    if (response.success && isMounted.value) {
      webhookConfig.value = payload
      showToast('配置已保存', 'success')
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast('保存配置失败', 'error')
    console.error(error)
  }
}

// 加载 Claude 转发配置
const loadClaudeConfig = async () => {
  if (!isMounted.value) return
  claudeConfigLoading.value = true
  try {
    const response = await apiClient.get('/admin/claude-relay-config', {
      signal: abortController.value.signal
    })
    if (response.success && isMounted.value) {
      claudeConfig.value = {
        claudeCodeOnlyEnabled: response.config?.claudeCodeOnlyEnabled ?? false,
        globalSessionBindingEnabled: response.config?.globalSessionBindingEnabled ?? false,
        sessionBindingErrorMessage:
          response.config?.sessionBindingErrorMessage || '你的本地session已污染，请清理后使用。',
        sessionBindingTtlDays: response.config?.sessionBindingTtlDays ?? 30,
        userMessageQueueEnabled: response.config?.userMessageQueueEnabled ?? false, // 与后端默认值保持一致
        userMessageQueueDelayMs: response.config?.userMessageQueueDelayMs ?? 200,
        userMessageQueueTimeoutMs: response.config?.userMessageQueueTimeoutMs ?? 5000, // 与后端默认值保持一致
        stickySessionAutoRenewalEnabled: response.config?.stickySessionAutoRenewalEnabled ?? true,
        concurrentRequestQueueEnabled: response.config?.concurrentRequestQueueEnabled ?? false,
        concurrentRequestQueueMaxSize: response.config?.concurrentRequestQueueMaxSize ?? 3,
        concurrentRequestQueueMaxSizeMultiplier:
          response.config?.concurrentRequestQueueMaxSizeMultiplier ?? 0,
        concurrentRequestQueueTimeoutMs: response.config?.concurrentRequestQueueTimeoutMs ?? 10000,
        openaiStreamHeartbeatIntervalMs: response.config?.openaiStreamHeartbeatIntervalMs ?? 15000,
        updatedAt: response.config?.updatedAt || null,
        updatedBy: response.config?.updatedBy || null
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast(getApiErrorMessage(error, '获取 Claude 转发配置失败'), 'error')
    console.error(error)
  } finally {
    if (isMounted.value) {
      claudeConfigLoading.value = false
    }
  }
}

// 保存 Claude 转发配置
const saveClaudeConfig = async () => {
  if (!isMounted.value) return
  try {
    const payload = {
      claudeCodeOnlyEnabled: claudeConfig.value.claudeCodeOnlyEnabled,
      globalSessionBindingEnabled: claudeConfig.value.globalSessionBindingEnabled,
      sessionBindingErrorMessage: claudeConfig.value.sessionBindingErrorMessage,
      sessionBindingTtlDays: claudeConfig.value.sessionBindingTtlDays,
      userMessageQueueEnabled: claudeConfig.value.userMessageQueueEnabled,
      userMessageQueueDelayMs: claudeConfig.value.userMessageQueueDelayMs,
      userMessageQueueTimeoutMs: claudeConfig.value.userMessageQueueTimeoutMs,
      stickySessionAutoRenewalEnabled: claudeConfig.value.stickySessionAutoRenewalEnabled,
      concurrentRequestQueueEnabled: claudeConfig.value.concurrentRequestQueueEnabled,
      concurrentRequestQueueMaxSize: claudeConfig.value.concurrentRequestQueueMaxSize,
      concurrentRequestQueueMaxSizeMultiplier:
        claudeConfig.value.concurrentRequestQueueMaxSizeMultiplier,
      concurrentRequestQueueTimeoutMs: claudeConfig.value.concurrentRequestQueueTimeoutMs,
      openaiStreamHeartbeatIntervalMs: claudeConfig.value.openaiStreamHeartbeatIntervalMs
    }

    const response = await apiClient.put('/admin/claude-relay-config', payload, {
      signal: abortController.value.signal
    })
    if (response.success && isMounted.value) {
      claudeConfig.value = {
        ...claudeConfig.value,
        updatedAt: response.config?.updatedAt || new Date().toISOString(),
        updatedBy: response.config?.updatedBy || null
      }
      showToast('Claude 转发配置已保存', 'success')
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast(getApiErrorMessage(error, '保存 Claude 转发配置失败'), 'error')
    console.error(error)
  }
}

// 验证 URL
const validateUrl = () => {
  // Bark和SMTP平台不需要验证URL
  if (['bark', 'smtp', 'telegram'].includes(platformForm.value.type)) {
    urlError.value = false
    urlValid.value = false
    return
  }

  const url = platformForm.value.url
  if (!url) {
    urlError.value = false
    urlValid.value = false
    return
  }

  try {
    new URL(url)
    if (url.startsWith('http://') || url.startsWith('https://')) {
      urlError.value = false
      urlValid.value = true
    } else {
      urlError.value = true
      urlValid.value = false
    }
  } catch {
    urlError.value = true
    urlValid.value = false
  }
}

// 验证平台配置
const validatePlatformForm = () => {
  if (platformForm.value.type === 'bark') {
    if (!platformForm.value.deviceKey) {
      showToast('请输入Bark设备密钥', 'error')
      return false
    }
  } else if (platformForm.value.type === 'telegram') {
    if (!platformForm.value.botToken) {
      showToast('请输入 Telegram 机器人 Token', 'error')
      return false
    }
    if (!platformForm.value.chatId) {
      showToast('请输入 Telegram Chat ID', 'error')
      return false
    }
    if (platformForm.value.apiBaseUrl) {
      try {
        const parsed = new URL(platformForm.value.apiBaseUrl)
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          showToast('Telegram API 基础地址仅支持 http 或 https', 'error')
          return false
        }
      } catch (error) {
        showToast('请输入有效的 Telegram API 基础地址', 'error')
        return false
      }
    }
    if (platformForm.value.proxyUrl) {
      try {
        const parsed = new URL(platformForm.value.proxyUrl)
        const supportedProtocols = ['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:']
        if (!supportedProtocols.includes(parsed.protocol)) {
          showToast('Telegram 代理仅支持 http/https/socks 协议', 'error')
          return false
        }
      } catch (error) {
        showToast('请输入有效的 Telegram 代理地址', 'error')
        return false
      }
    }
  } else if (platformForm.value.type === 'smtp') {
    const requiredFields = [
      { field: 'host', message: 'SMTP服务器' },
      { field: 'user', message: '用户名' },
      { field: 'pass', message: '密码' },
      { field: 'to', message: '收件人邮箱' }
    ]

    for (const { field, message } of requiredFields) {
      if (!platformForm.value[field]) {
        showToast(`请输入${message}`, 'error')
        return false
      }
    }
  } else {
    if (!platformForm.value.url) {
      showToast('请输入Webhook URL', 'error')
      return false
    }
    if (urlError.value) {
      showToast('请输入有效的Webhook URL', 'error')
      return false
    }
  }
  return true
}

// 添加/更新平台
const savePlatform = async () => {
  if (!isMounted.value) return

  // 验证表单
  if (!validatePlatformForm()) return

  savingPlatform.value = true
  try {
    let response
    if (editingPlatform.value) {
      // 更新平台
      response = await apiClient.put(
        `/admin/webhook/platforms/${editingPlatform.value.id}`,
        platformForm.value,
        { signal: abortController.value.signal }
      )
    } else {
      // 添加平台
      response = await apiClient.post('/admin/webhook/platforms', platformForm.value, {
        signal: abortController.value.signal
      })
    }

    if (response.success && isMounted.value) {
      showToast(editingPlatform.value ? '平台已更新' : '平台已添加', 'success')
      await loadWebhookConfig()
      closePlatformModal()
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast(error.message || '操作失败', 'error')
    console.error(error)
  } finally {
    if (isMounted.value) {
      savingPlatform.value = false
    }
  }
}

// 编辑平台
const editPlatform = (platform) => {
  editingPlatform.value = platform
  platformForm.value = {
    type: platform.type || 'wechat_work',
    name: platform.name || '',
    url: platform.url || '',
    enableSign: platform.enableSign || false,
    secret: platform.secret || '',
    // Telegram特有字段
    botToken: platform.botToken || '',
    chatId: platform.chatId || '',
    apiBaseUrl: platform.apiBaseUrl || '',
    proxyUrl: platform.proxyUrl || '',
    // Bark特有字段
    deviceKey: platform.deviceKey || '',
    serverUrl: platform.serverUrl || '',
    level: platform.level || '',
    sound: platform.sound || '',
    group: platform.group || '',
    // SMTP特有字段
    host: platform.host || '',
    port: platform.port ?? null,
    secure: platform.secure || false,
    user: platform.user || '',
    pass: platform.pass || '',
    from: platform.from || '',
    to: Array.isArray(platform.to) ? platform.to.join(', ') : platform.to || '',
    timeout: platform.timeout ?? null,
    ignoreTLS: platform.ignoreTLS || false
  }
  showAddPlatformModal.value = true
}

// 删除平台
const deletePlatform = async (id) => {
  if (!isMounted.value) return

  if (!confirm('确定要删除这个平台吗？')) {
    return
  }

  try {
    const response = await apiClient.delete(`/admin/webhook/platforms/${id}`, {
      signal: abortController.value.signal
    })
    if (response.success && isMounted.value) {
      showToast('平台已删除', 'success')
      await loadWebhookConfig()
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast('删除失败', 'error')
    console.error(error)
  }
}

// 切换平台状态
const togglePlatform = async (id) => {
  if (!isMounted.value) return

  try {
    const response = await apiClient.post(
      `/admin/webhook/platforms/${id}/toggle`,
      {},
      {
        signal: abortController.value.signal
      }
    )
    if (response.success && isMounted.value) {
      showToast(response.message, 'success')
      await loadWebhookConfig()
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast('操作失败', 'error')
    console.error(error)
  }
}

// 测试平台
const testPlatform = async (platform) => {
  if (!isMounted.value) return

  try {
    const testData = {
      type: platform.type,
      secret: platform.secret,
      enableSign: platform.enableSign
    }

    // 根据平台类型添加不同字段
    if (platform.type === 'bark') {
      testData.deviceKey = platform.deviceKey
      testData.serverUrl = platform.serverUrl
      testData.level = platform.level
      testData.sound = platform.sound
      testData.group = platform.group
    } else if (platform.type === 'smtp') {
      testData.host = platform.host
      testData.port = platform.port
      testData.secure = platform.secure
      testData.user = platform.user
      testData.pass = platform.pass
      testData.from = platform.from
      testData.to = platform.to
      testData.ignoreTLS = platform.ignoreTLS
    } else if (platform.type === 'telegram') {
      testData.botToken = platform.botToken
      testData.chatId = platform.chatId
      testData.apiBaseUrl = platform.apiBaseUrl
      testData.proxyUrl = platform.proxyUrl
    } else {
      testData.url = platform.url
    }

    const response = await apiClient.post('/admin/webhook/test', testData, {
      signal: abortController.value.signal
    })
    if (response.success && isMounted.value) {
      showToast('测试成功', 'success')
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast(error.error || error.message || '测试失败', 'error')
    console.error(error)
  }
}

// 测试表单中的平台
const testPlatformForm = async () => {
  if (!isMounted.value) return

  // 验证表单
  if (!validatePlatformForm()) return

  testingConnection.value = true
  try {
    const response = await apiClient.post('/admin/webhook/test', platformForm.value, {
      signal: abortController.value.signal
    })
    if (response.success && isMounted.value) {
      showToast('测试成功', 'success')
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    showToast(error.error || error.message || '测试失败', 'error')
    console.error(error)
  } finally {
    if (isMounted.value) {
      testingConnection.value = false
    }
  }
}

// 发送测试通知
const sendTestNotification = async () => {
  if (!isMounted.value) return

  try {
    const response = await apiClient.post(
      '/admin/webhook/test-notification',
      {},
      {
        signal: abortController.value.signal
      }
    )
    if (response.success && isMounted.value) {
      showToast('测试通知已发送', 'success')
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    if (!isMounted.value) return
    const errorMessage =
      error?.response?.data?.message || error?.response?.data?.error || error?.message || '发送失败'
    showToast(errorMessage, 'error')
    console.error(error)
  }
}

// 关闭模态框
const closePlatformModal = () => {
  if (!isMounted.value) return

  showAddPlatformModal.value = false

  // 使用 setTimeout 确保 DOM 更新完成后再重置状态
  setTimeout(() => {
    if (!isMounted.value) return
    editingPlatform.value = null
    platformForm.value = {
      type: 'wechat_work',
      name: '',
      url: '',
      enableSign: false,
      secret: '',
      // Telegram特有字段
      botToken: '',
      chatId: '',
      apiBaseUrl: '',
      proxyUrl: '',
      // Bark特有字段
      deviceKey: '',
      serverUrl: '',
      level: '',
      sound: '',
      group: '',
      // SMTP特有字段
      host: '',
      port: null,
      secure: false,
      user: '',
      pass: '',
      from: '',
      to: '',
      timeout: null,
      ignoreTLS: false
    }
    urlError.value = false
    urlValid.value = false
    testingConnection.value = false
    savingPlatform.value = false
  }, 0)
}

// 辅助函数
const getPlatformName = (type) => {
  const names = {
    wechat_work: '企业微信',
    dingtalk: '钉钉',
    feishu: '飞书',
    slack: 'Slack',
    discord: 'Discord',
    telegram: 'Telegram',
    bark: 'Bark',
    smtp: '邮件通知',
    custom: '自定义'
  }
  return names[type] || type
}

const getPlatformIcon = (type) => {
  const icons = {
    wechat_work: 'fab fa-weixin text-green-600',
    dingtalk: 'fas fa-comment-dots text-blue-500',
    feishu: 'fas fa-dove text-blue-600',
    slack: 'fab fa-slack text-purple-600',
    discord: 'fab fa-discord text-indigo-600',
    telegram: 'fab fa-telegram-plane text-sky-500',
    bark: 'fas fa-bell text-orange-500',
    smtp: 'fas fa-envelope text-blue-600',
    custom: 'fas fa-webhook text-gray-600'
  }
  return icons[type] || 'fas fa-bell'
}

const getWebhookHint = (type) => {
  const hints = {
    wechat_work: '请在企业微信群机器人设置中获取Webhook地址',
    dingtalk: '请在钉钉群机器人设置中获取Webhook地址',
    feishu: '请在飞书群机器人设置中获取Webhook地址',
    slack: '请在Slack应用的Incoming Webhooks中获取地址',
    discord: '请在Discord服务器的集成设置中创建Webhook',
    telegram: '使用 @BotFather 创建机器人并复制 Token，Chat ID 可通过 @userinfobot 或相关工具获取',
    bark: '请在Bark App中查看您的设备密钥',
    smtp: '请配置SMTP服务器信息，支持Gmail、QQ邮箱等',
    custom: '请输入完整的Webhook接收地址'
  }
  return hints[type] || ''
}

const formatTelegramToken = (token) => {
  if (!token) return ''
  if (token.length <= 12) return token
  return `${token.slice(0, 6)}...${token.slice(-4)}`
}

const getNotificationTypeName = (type) => {
  const names = {
    accountAnomaly: '账号异常',
    quotaWarning: '配额警告',
    systemError: '系统错误',
    securityAlert: '安全警报',
    rateLimitRecovery: '限流恢复',
    test: '测试通知'
  }
  return names[type] || type
}

const getNotificationTypeDescription = (type) => {
  const descriptions = {
    accountAnomaly: '账号状态异常、认证失败等',
    quotaWarning: 'API调用配额不足警告',
    systemError: '系统运行错误和故障',
    securityAlert: '安全相关的警报通知',
    rateLimitRecovery: '限流状态恢复时发送提醒',
    test: '用于测试Webhook连接是否正常'
  }
  return descriptions[type] || ''
}

// 保存OEM设置
const saveOemSettings = async () => {
  try {
    const settings = {
      siteName: oemSettings.value.siteName,
      siteIcon: oemSettings.value.siteIcon,
      siteIconData: oemSettings.value.siteIconData,
      showAdminButton: oemSettings.value.showAdminButton
    }
    const result = await settingsStore.saveOemSettings(settings)
    if (result && result.success) {
      showToast('OEM设置保存成功', 'success')
    } else {
      showToast(result?.message || '保存失败', 'error')
    }
  } catch (error) {
    showToast('保存OEM设置失败', 'error')
  }
}

// 重置OEM设置
const resetOemSettings = async () => {
  if (!confirm('确定要重置为默认设置吗？\n\n这将清除所有自定义的网站名称和图标设置。')) return

  try {
    const result = await settingsStore.resetOemSettings()
    if (result && result.success) {
      showToast('已重置为默认设置', 'success')
    } else {
      showToast('重置失败', 'error')
    }
  } catch (error) {
    showToast('重置失败', 'error')
  }
}

// 处理图标上传
const handleIconUpload = async (event) => {
  const file = event.target.files[0]
  if (!file) return

  // 验证文件
  const validation = settingsStore.validateIconFile(file)
  if (!validation.isValid) {
    validation.errors.forEach((error) => showToast(error, 'error'))
    return
  }

  try {
    // 转换为Base64
    const base64Data = await settingsStore.fileToBase64(file)
    oemSettings.value.siteIconData = base64Data
  } catch (error) {
    showToast('文件读取失败', 'error')
  }

  // 清除input的值，允许重复选择同一文件
  event.target.value = ''
}

// 删除图标
const removeIcon = () => {
  oemSettings.value.siteIcon = ''
  oemSettings.value.siteIconData = ''
}

// 处理图标加载错误
const handleIconError = () => {
  console.warn('Icon failed to load')
}

// 格式化日期时间
const formatDateTime = settingsStore.formatDateTime
</script>

<style scoped>
.settings-container {
  min-height: calc(100vh - 300px);
}

.card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  border: 1px solid #e5e7eb;
}

:root.dark .card {
  background: #1f2937;
  border: 1px solid #374151;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}

.table-container {
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid #f3f4f6;
}

:root.dark .table-container {
  border: 1px solid #4b5563;
}

.table-row {
  transition: background-color 0.2s ease;
}

.table-row:hover {
  background-color: #f9fafb;
}

:root.dark .table-row:hover {
  background-color: #374151;
}

.form-input {
  @apply w-full rounded-lg border border-gray-300 px-4 py-2 transition-all duration-200 focus:border-transparent focus:ring-2 focus:ring-blue-500;
}

.btn {
  @apply inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2;
}

.btn-primary {
  @apply bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500;
}

.btn-success {
  @apply bg-green-600 text-white hover:bg-green-700 focus:ring-green-500;
}

.loading-spinner {
  @apply h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600;
}
</style>
