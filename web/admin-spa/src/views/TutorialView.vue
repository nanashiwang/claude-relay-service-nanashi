<template>
  <div class="card p-3 sm:p-6">
    <div class="mb-4 sm:mb-8">
      <h3
        class="mb-3 flex items-center text-xl font-bold text-gray-900 dark:text-gray-100 sm:mb-4 sm:text-2xl"
      >
        <i class="fas fa-graduation-cap mr-2 text-blue-600 sm:mr-3" />
        使用教程
      </h3>
      <p class="text-sm text-gray-600 dark:text-gray-400 sm:text-lg">
        选择客户端与系统，按章节完成快速配置与使用。
      </p>
    </div>

    <!-- 客户端选择标签 -->
    <div class="mb-3 sm:mb-6">
      <div class="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800 sm:gap-2 sm:p-2">
        <button
          v-for="client in tutorialClients"
          :key="client.key"
          :class="[
            'flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all duration-300 sm:gap-2 sm:px-6 sm:py-3 sm:text-sm',
            activeTutorialClient === client.key
              ? 'bg-white text-blue-600 shadow-sm dark:bg-blue-600 dark:text-white dark:shadow-blue-500/40'
              : 'text-gray-600 hover:bg-white/50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white'
          ]"
          @click="activeTutorialClient = client.key"
        >
          <i :class="client.icon" />
          {{ client.name }}
        </button>
      </div>
    </div>

    <!-- 系统选择标签 -->
    <div class="mb-4 sm:mb-8">
      <div class="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800 sm:gap-2 sm:p-2">
        <button
          v-for="system in tutorialSystems"
          :key="system.key"
          :class="[
            'flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all duration-300 sm:gap-2 sm:px-6 sm:py-3 sm:text-sm',
            activeTutorialSystem === system.key
              ? 'bg-white text-blue-600 shadow-sm dark:bg-blue-600 dark:text-white dark:shadow-blue-500/40'
              : 'text-gray-600 hover:bg-white/50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white'
          ]"
          @click="activeTutorialSystem = system.key"
        >
          <i :class="system.icon" />
          {{ system.name }}
        </button>
      </div>
    </div>

    <div class="tutorial-content">
      <!-- 入群二维码 -->
      <div class="mb-6 sm:mb-10">
        <h4
          class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
        >
          <i class="fas fa-qrcode mr-2 text-blue-600 sm:mr-3" />
          扫码入群 / 获取帮助
        </h4>

        <div
          class="rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 dark:border-blue-500/40 dark:from-blue-950/30 dark:to-indigo-950/30 sm:p-6"
        >
          <div class="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div class="w-full max-w-[220px] flex-shrink-0">
              <img
                v-if="!joinGroupQrLoadFailed"
                :src="joinGroupQrUrl"
                alt="入群二维码"
                class="w-full rounded-lg border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-700 dark:bg-gray-900"
                loading="lazy"
                @error="joinGroupQrLoadFailed = true"
              />
              <div
                v-else
                class="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800 dark:border-yellow-500/40 dark:bg-yellow-950/30 dark:text-yellow-200"
              >
                未找到二维码图片。请将二维码文件放到
                <code class="rounded bg-yellow-100 px-1 dark:bg-yellow-900/40"
                  >web/admin-spa/public/join-group-qr.png</code
                >
                并重新构建/部署，或直接上传覆盖服务器上的
                <code class="rounded bg-yellow-100 px-1 dark:bg-yellow-900/40">dist/join-group-qr.png</code
                >。
              </div>
            </div>

            <div class="w-full">
              <p class="mb-2 text-sm text-gray-700 dark:text-gray-300 sm:text-base">
                如需获取密钥、排障支持或功能反馈，建议扫码加入交流群。
              </p>
              <ul class="list-inside list-disc space-y-1 text-xs text-gray-600 dark:text-gray-400 sm:text-sm">
                <li>入群后建议备注：用户名/用途/系统环境</li>
                <li>遇到问题请提供：系统版本、Node.js 版本（node -v）、报错日志</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <!-- 章节 1：环境准备 -->
      <div class="mb-6 sm:mb-10">
        <h4
          class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
        >
          <span
            class="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
            >1</span
          >
          环境准备：安装 Node.js
        </h4>
        <p class="mb-4 text-sm text-gray-600 dark:text-gray-400 sm:mb-6 sm:text-base">
          要求：Node.js 18 或更高版本。建议先安装 Node.js 18+ 环境，后续 CLI/脚本会用到。
        </p>

        <div
          class="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800 sm:p-6"
        >
          <template v-if="activeTutorialSystem === 'windows'">
            <h5 class="mb-2 text-base font-semibold text-gray-800 dark:text-gray-200 sm:text-lg">
              Windows 安装
            </h5>
            <ol
              class="ml-2 list-inside list-decimal space-y-1 text-xs text-gray-600 dark:text-gray-400 sm:text-sm"
            >
              <li>
                访问
                <code class="rounded bg-gray-100 px-1 dark:bg-gray-900">https://nodejs.org/</code>
              </li>
              <li>下载 LTS 版本并安装（.msi）</li>
              <li>
                或使用包管理器：<code class="rounded bg-gray-100 px-1 dark:bg-gray-900"
                  >choco install nodejs</code
                >
                /
                <code class="rounded bg-gray-100 px-1 dark:bg-gray-900">scoop install nodejs</code>
              </li>
            </ol>
          </template>

          <template v-else-if="activeTutorialSystem === 'macos'">
            <h5 class="mb-2 text-base font-semibold text-gray-800 dark:text-gray-200 sm:text-lg">
              macOS 安装
            </h5>
            <div
              class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
            >
              <div class="whitespace-nowrap text-gray-300">brew update</div>
              <div class="whitespace-nowrap text-gray-300">brew install node</div>
            </div>
          </template>

          <template v-else>
            <h5 class="mb-2 text-base font-semibold text-gray-800 dark:text-gray-200 sm:text-lg">
              Linux / WSL2 安装
            </h5>
            <div
              class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
            >
              <div class="whitespace-nowrap text-gray-300">
                curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
              </div>
              <div class="whitespace-nowrap text-gray-300">sudo apt-get install -y nodejs</div>
            </div>
          </template>
        </div>

        <div
          class="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-500/40 dark:bg-green-950/30 sm:p-4"
        >
          <h6 class="mb-2 text-sm font-medium text-green-800 dark:text-green-300 sm:text-base">
            验证 Node.js 是否安装成功
          </h6>
          <div
            class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
          >
            <div class="whitespace-nowrap text-gray-300">node --version</div>
            <div class="whitespace-nowrap text-gray-300">npm --version</div>
          </div>
        </div>
      </div>

      <!-- 客户端教程（后续补全细节） -->
      <template v-if="activeTutorialClient === 'claude'">
        <div class="mb-6 sm:mb-10">
          <h4
            class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
          >
            <span
              class="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
              >2</span
            >
            Claude 一键配置（npx zcf）
          </h4>
          <div
            class="rounded-xl border border-green-100 bg-gradient-to-r from-green-50 to-emerald-50 p-4 dark:border-green-500/40 dark:from-green-950/30 dark:to-emerald-950/30 sm:p-6"
          >
            <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
              在终端输入以下命令，加载一键配置菜单：
            </p>
            <div
              class="mb-4 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
            >
              <div class="whitespace-nowrap text-gray-300">npx zcf</div>
            </div>

            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200 sm:text-base">
              菜单配置步骤
            </h6>
            <ol
              class="ml-2 list-inside list-decimal space-y-1 text-xs text-gray-700 dark:text-gray-300 sm:ml-4 sm:space-y-2 sm:text-sm"
            >
              <li>未安装过 Claude：菜单输入 1；已安装/更新密钥：输入 3</li>
              <li>选择 API 配置模式：选择“自定义 API 配置”</li>
              <li>选择供应商：选择“自定义配置”（通常为选项 4）</li>
              <li>
                供应商名称填写：
                <code class="rounded bg-gray-100 px-1 dark:bg-gray-800">nan</code>
              </li>
              <li>
                URL 填写：
                <code class="rounded bg-gray-100 px-1 dark:bg-gray-800">{{ currentBaseUrl }}</code>
              </li>
              <li>Key 填写：你的商品收货信息中的密钥</li>
              <li>后续弹出的 MCP 等建议直接回车跳过，不安装</li>
            </ol>
            <p class="mt-3 text-xs text-gray-600 dark:text-gray-400 sm:text-sm">
              macOS 与 Windows 配置方法一致；按菜单提示完成即可。
            </p>
          </div>
        </div>

        <div class="mb-6 sm:mb-10">
          <h4
            class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
          >
            <span
              class="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
              >3</span
            >
            测试使用
          </h4>
          <div
            class="rounded-xl border border-orange-100 bg-gradient-to-r from-orange-50 to-yellow-50 p-4 dark:border-orange-500/40 dark:from-orange-950/30 dark:to-yellow-950/30 sm:p-6"
          >
            <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
              打开新终端窗口，测试是否正常：
            </p>
            <div
              class="space-y-1 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
            >
              <div class="whitespace-nowrap text-gray-300">claude --version</div>
              <div class="whitespace-nowrap text-gray-300">claude</div>
            </div>
            <p class="mt-3 text-xs text-gray-600 dark:text-gray-400 sm:text-sm">
              如果能正常启动并对话，说明配置成功。
            </p>
          </div>
        </div>
      </template>
      <template v-else-if="activeTutorialClient === 'codex'">
        <div class="mb-6 sm:mb-10">
          <h4
            class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
          >
            <span
              class="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
              >2</span
            >
            ⚡ 快速安装配置
          </h4>
          <div
            class="rounded-xl border border-green-100 bg-gradient-to-r from-green-50 to-emerald-50 p-4 dark:border-green-500/40 dark:from-green-950/30 dark:to-emerald-950/30 sm:p-6"
          >
            <h5
              class="mb-2 flex items-center text-base font-semibold text-gray-800 dark:text-gray-200 sm:mb-3 sm:text-lg"
            >
              <i class="fas fa-bolt mr-2 text-green-600" />
              使用 npx zcf 一键安装
            </h5>
            <div
              class="mb-4 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
            >
              <div class="whitespace-nowrap text-gray-300">npx zcf</div>
            </div>
            <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:text-base">
              出现提示时输入 “y” 确认安装，等待安装完成后会自动弹出配置菜单。
            </p>

            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200 sm:text-base">
              菜单配置步骤
            </h6>
            <ol
              class="ml-2 list-inside list-decimal space-y-1 text-xs text-gray-700 dark:text-gray-300 sm:ml-4 sm:space-y-2 sm:text-sm"
            >
              <li>选择平台：输入 s 切换到 codex 平台</li>
              <li>安装选项：首次安装输入 1；已有配置/更新密钥输入 3</li>
              <li>供应商配置：选择“自定义”供应商</li>
              <li>
                供应商名称填写：
                <code class="rounded bg-gray-100 px-1 dark:bg-gray-800">nan</code>
              </li>
              <li>
                URL 填写：
                <code class="rounded bg-gray-100 px-1 dark:bg-gray-800">{{ openaiBaseUrl }}</code>
              </li>
              <li>Key 填写：你的商品收货信息中的密钥</li>
              <li>后续弹出的 MCP 建议直接回车跳过，不安装</li>
              <li>配置完成后设为默认供应商并退出</li>
            </ol>
          </div>
        </div>

        <div class="mb-6 sm:mb-10">
          <h4
            class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
          >
            <span
              class="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
              >3</span
            >
            ✅ 测试安装
          </h4>
          <div
            class="rounded-xl border border-orange-100 bg-gradient-to-r from-orange-50 to-yellow-50 p-4 dark:border-orange-500/40 dark:from-orange-950/30 dark:to-yellow-950/30 sm:p-6"
          >
            <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
              打开新终端窗口，测试是否正常：
            </p>
            <div
              class="space-y-1 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
            >
              <div class="whitespace-nowrap text-gray-300">codex --version</div>
              <div class="whitespace-nowrap text-gray-300">codex</div>
            </div>
            <p class="mt-3 text-xs text-gray-600 dark:text-gray-400 sm:text-sm">
              如能正常对话，说明安装成功。
            </p>
          </div>
        </div>

        <div class="mb-6 sm:mb-10">
          <h4
            class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
          >
            <span
              class="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
              >4</span
            >
            🖥️ VSCode 插件配置
          </h4>
          <div
            class="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-blue-50 p-4 dark:border-indigo-500/40 dark:from-indigo-950/30 dark:to-blue-950/30 sm:p-6"
          >
            <ol
              class="ml-2 list-inside list-decimal space-y-1 text-xs text-gray-700 dark:text-gray-300 sm:ml-4 sm:space-y-2 sm:text-sm"
            >
              <li>打开 VSCode → 扩展商店（Extensions）</li>
              <li>搜索 “codex”，安装收藏量最高的那个插件</li>
              <li>按照上方本地配置方法配置好 codex</li>
              <li>重启 VSCode（重要），插件会自动识别配置，即可正常使用</li>
            </ol>
          </div>
        </div>

        <div class="mb-6 sm:mb-10">
          <h4
            class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
          >
            <span
              class="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
              >5</span
            >
            🧭 Cursor 配置使用
          </h4>
          <div
            class="rounded-xl border border-sky-100 bg-gradient-to-r from-sky-50 to-cyan-50 p-4 dark:border-sky-500/40 dark:from-sky-950/30 dark:to-cyan-950/30 sm:p-6"
          >
            <ol
              class="ml-2 list-inside list-decimal space-y-1 text-xs text-gray-700 dark:text-gray-300 sm:ml-4 sm:space-y-2 sm:text-sm"
            >
              <li>打开 Cursor → 扩展商店（Extensions）</li>
              <li>搜索 “Codex”，安装插件</li>
              <li>在插件中选择 “Use API Key”</li>
              <li>填入 <code class="rounded bg-gray-100 px-1 dark:bg-gray-800">cr_</code> 开头的密钥并确认，即可调用</li>
            </ol>
          </div>
        </div>

        <div class="mb-6 sm:mb-10">
          <h4
            class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
          >
            <span
              class="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-purple-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
              >6</span
            >
            🔧 进阶配置（密钥更新）
          </h4>

          <div class="space-y-4">
            <details
              class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800 sm:p-4"
            >
              <summary class="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-200">
                方法一：通过配置文件修改（推荐）
              </summary>
              <div class="mt-3 space-y-3 text-sm text-gray-700 dark:text-gray-300">
                <p>
                  找到 CodeX 配置目录：
                  <code class="rounded bg-gray-100 px-1 dark:bg-gray-900">{{
                    codexConfigDir
                  }}</code>
                </p>
                <div>
                  <p class="mb-2">
                    编辑 <code class="rounded bg-gray-100 px-1 dark:bg-gray-900">auth</code> 文件：
                  </p>
                  <div
                    class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
                  >
                    <div
                      v-for="(line, index) in codexAuthFileLines"
                      :key="'codex-auth-' + index"
                      class="whitespace-pre text-gray-300"
                    >
                      {{ line }}
                    </div>
                  </div>
                </div>
                <div>
                  <p class="mb-2">
                    编辑
                    <code class="rounded bg-gray-100 px-1 dark:bg-gray-900">config</code> 文件：
                  </p>
                  <div
                    class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
                  >
                    <div
                      v-for="(line, index) in codexConfigFileLines"
                      :key="'codex-config-' + index"
                      class="whitespace-pre text-gray-300"
                    >
                      {{ line }}
                    </div>
                  </div>
                </div>
              </div>
            </details>

            <details
              class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800 sm:p-4"
            >
              <summary class="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-200">
                方法二：使用命令更新
              </summary>
              <div class="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                <p>重新运行配置向导：</p>
                <div
                  class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
                >
                  <div class="whitespace-nowrap text-gray-300">npx zcf</div>
                </div>
                <p>在菜单中选择选项 3（更新密钥），按向导更新配置。</p>
              </div>
            </details>
          </div>
        </div>

        <div class="mb-6 sm:mb-10">
          <h4
            class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
          >
            <i class="fas fa-lightbulb mr-2 text-gray-600 sm:mr-3" />
            📝 使用小贴士 / 常见问题
          </h4>
          <div class="space-y-4">
            <details
              class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800 sm:p-4"
            >
              <summary class="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-200">
                ✅ 验证安装成功
              </summary>
              <div class="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                <div
                  class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
                >
                  <div class="whitespace-nowrap text-gray-300">codex --version</div>
                  <div class="whitespace-nowrap text-gray-300">codex "你好，请介绍自己"</div>
                </div>
              </div>
            </details>

            <details
              class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800 sm:p-4"
            >
              <summary class="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-200">
                🔄 常见问题
              </summary>
              <div class="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                <ul class="list-inside list-disc space-y-1">
                  <li>安装失败：检查网络连接，确保能访问 npm 源</li>
                  <li>插件不识别：确保重启 VSCode，检查配置文件路径</li>
                  <li>密钥无效：确认密钥格式正确、无多余空格</li>
                </ul>
              </div>
            </details>

            <details
              class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800 sm:p-4"
            >
              <summary class="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-200">
                🧩 IDE 工具通用设置
              </summary>
              <div class="mt-3 space-y-3 text-sm text-gray-700 dark:text-gray-300">
                <div>
                  <p class="mb-1 font-medium text-gray-800 dark:text-gray-200">适用工具</p>
                  <p>任何支持 OpenAI 协议的工具，都可以使用。</p>
                </div>
                <div>
                  <p class="mb-1 font-medium text-gray-800 dark:text-gray-200">安装和配置方法</p>
                  <ol class="ml-2 list-inside list-decimal space-y-1">
                    <li>找到适配 OpenAI 协议的 Provider</li>
                    <li>
                      添加/替换 OpenAI Base URL 为
                      <code class="rounded bg-gray-100 px-1 dark:bg-gray-900">{{ openaiBaseUrl }}</code>
                    </li>
                    <li>
                      输入自己的 Key，如需模型参数则填写需要的模型（Cursor / Zcode 等工具适用）
                    </li>
                  </ol>
                </div>
                <div
                  class="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900 sm:p-4"
                >
                  <img
                    v-if="!ideToolSetupLoadFailed"
                    :src="ideToolSetupUrl"
                    alt="IDE 工具通用设置"
                    class="w-full rounded-md border border-gray-200 shadow-sm dark:border-gray-700"
                    loading="lazy"
                    @error="ideToolSetupLoadFailed = true"
                  />
                  <div v-else class="text-xs text-gray-600 dark:text-gray-400">
                    未找到图片，请确保文件位于
                    <code class="rounded bg-gray-100 px-1 dark:bg-gray-900">web/admin-spa/public/ide-tool-setup.png</code>
                  </div>
                </div>
              </div>
            </details>

            <details
              class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800 sm:p-4"
            >
              <summary class="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-200">
                ⚠️ 注意事项 / 获取帮助
              </summary>
              <div class="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                <ul class="list-inside list-disc space-y-1">
                  <li>密钥属于敏感信息，请妥善保管</li>
                  <li>定期检查更新：npx zcf 可获取最新版本</li>
                  <li>如遇问题，请提供：系统版本、Node.js 版本（node -v）、具体错误信息</li>
                </ul>
              </div>
            </details>
          </div>
        </div>
      </template>
      <template v-else-if="activeTutorialClient === 'gemini'">
        <div class="mb-6 sm:mb-10">
          <h4
            class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
          >
            <span
              class="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
              >2</span
            >
            设置环境变量
          </h4>

          <div
            class="rounded-xl border border-green-100 bg-gradient-to-r from-green-50 to-emerald-50 p-4 dark:border-green-500/40 dark:from-green-950/30 dark:to-emerald-950/30 sm:p-6"
          >
            <h5
              class="mb-2 flex items-center text-base font-semibold text-gray-800 dark:text-gray-200 sm:mb-3 sm:text-lg"
            >
              <i class="fas fa-robot mr-2 text-green-600" />
              配置 Gemini CLI 环境变量
            </h5>
            <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
              Gemini 已配置好，可按以下命令快速配置并使用（示例密钥仅用于演示，请替换为你自己的
              API 密钥）。
            </p>

            <div class="space-y-4">
              <div
                class="rounded-lg border border-green-200 bg-white p-3 dark:border-green-700 dark:bg-gray-800 sm:p-4"
              >
                <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200 sm:text-base">
                  {{ geminiEnvConfig.temporary.title }}
                </h6>
                <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
                  {{ geminiEnvConfig.temporary.description }}
                </p>
                <div
                  class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
                >
                  <div
                    v-for="(line, index) in geminiEnvConfig.temporary.lines"
                    :key="'gemini-temp-' + index"
                    class="whitespace-pre text-gray-300"
                  >
                    {{ line }}
                  </div>
                </div>
                <p class="mt-2 text-xs text-yellow-700 dark:text-yellow-400">
                  💡 示例中的密钥为作者个人密钥，仅用于演示，请替换为你自己的 API Key（cr_ 开头）。
                </p>
              </div>

              <div
                class="rounded-lg border border-green-200 bg-white p-3 dark:border-green-700 dark:bg-gray-800 sm:p-4"
              >
                <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200 sm:text-base">
                  {{ geminiEnvConfig.persistent.title }}
                </h6>
                <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
                  {{ geminiEnvConfig.persistent.description }}
                </p>
                <div
                  class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
                >
                  <div
                    v-for="(line, index) in geminiEnvConfig.persistent.lines"
                    :key="'gemini-persist-' + index"
                    class="whitespace-pre text-gray-300"
                  >
                    {{ line }}
                  </div>
                </div>
                <p class="mt-2 text-xs text-blue-700 dark:text-blue-300">
                  💡 设置后可能需要重新打开终端窗口才能生效。
                </p>
              </div>

              <div
                class="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-500/40 dark:bg-green-950/30 sm:p-4"
              >
                <h6 class="mb-2 font-medium text-green-800 dark:text-green-300">
                  {{ geminiEnvConfig.verify.title }}
                </h6>
                <p class="mb-3 text-sm text-green-700 dark:text-green-300">
                  {{ geminiEnvConfig.verify.description }}
                </p>
                <div
                  class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
                >
                  <div
                    v-for="(line, index) in geminiEnvConfig.verify.lines"
                    :key="'gemini-verify-' + index"
                    class="whitespace-pre text-gray-300"
                  >
                    {{ line }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template v-else-if="activeTutorialClient === 'openclaw'">
        <div class="mb-6 sm:mb-10">
          <h4
            class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
          >
            <span
              class="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
              >2</span
            >
            安装 OpenClaw
          </h4>
          <div
            class="rounded-xl border border-green-100 bg-gradient-to-r from-green-50 to-emerald-50 p-4 dark:border-green-500/40 dark:from-green-950/30 dark:to-emerald-950/30 sm:p-6"
          >
            <div
              class="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200 sm:text-sm"
            >
              OpenClaw 涉及第三方接入，请先确认你了解安全风险后再使用。
            </div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200 sm:text-base">
              先确认 Node.js 环境
            </h6>
            <div
              class="mb-4 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
            >
              <div class="whitespace-nowrap text-gray-300">node --version</div>
              <div class="whitespace-nowrap text-gray-300">npm --version</div>
            </div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200 sm:text-base">
              安装并初始化
            </h6>
            <div
              class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
            >
              <div class="whitespace-nowrap text-gray-300">npm i -g openclaw</div>
              <div class="whitespace-nowrap text-gray-300">openclaw onboard</div>
            </div>
          </div>
        </div>

        <div class="mb-6 sm:mb-10">
          <h4
            class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
          >
            <span
              class="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-sky-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
              >3</span
            >
            设置 OPI_AUTH_TOKEN
          </h4>
          <div
            class="rounded-xl border border-sky-100 bg-gradient-to-r from-sky-50 to-cyan-50 p-4 dark:border-sky-500/40 dark:from-sky-950/30 dark:to-cyan-950/30 sm:p-6"
          >
            <template v-if="activeTutorialSystem === 'windows'">
              <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:text-base">
                Windows（永久设置）：
              </p>
              <div
                class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
              >
                <div class="whitespace-nowrap text-gray-300">setx OPI_AUTH_TOKEN "你的key"</div>
              </div>
              <p class="mt-2 text-xs text-gray-600 dark:text-gray-400 sm:text-sm">
                设置后请重新打开终端窗口。
              </p>
            </template>
            <template v-else>
              <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:text-base">
                macOS / Linux（永久设置）：
              </p>
              <div
                class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
              >
                <div class="whitespace-nowrap text-gray-300">
                  echo 'export OPI_AUTH_TOKEN="你的key"' >> ~/.zshrc
                </div>
                <div class="whitespace-nowrap text-gray-300">source ~/.zshrc</div>
                <div class="mt-2 whitespace-nowrap text-gray-300">
                  echo 'export OPI_AUTH_TOKEN="你的key"' >> ~/.bashrc
                </div>
                <div class="whitespace-nowrap text-gray-300">source ~/.bashrc</div>
              </div>
            </template>
          </div>
        </div>

        <div class="mb-6 sm:mb-10">
          <h4
            class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
          >
            <span
              class="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
              >4</span
            >
            配置 OpenAI Responses Provider
          </h4>
          <div
            class="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-blue-50 p-4 dark:border-indigo-500/40 dark:from-indigo-950/30 dark:to-blue-950/30 sm:p-6"
          >
            <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:text-base">
              编辑配置文件：
              <code class="rounded bg-gray-100 px-1 dark:bg-gray-800">{{ openclawConfigPath }}</code>
            </p>
            <div
              class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
            >
              <div
                v-for="(line, index) in openclawProviderJsonLines"
                :key="'openclaw-provider-' + index"
                class="whitespace-pre text-gray-300"
              >
                {{ line }}
              </div>
            </div>
            <p class="mt-2 text-xs text-gray-600 dark:text-gray-400 sm:text-sm">
              建议按“合并新增字段”方式修改，不要整份覆盖你原有配置。
            </p>
          </div>
        </div>

        <div class="mb-6 sm:mb-10">
          <h4
            class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
          >
            <span
              class="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
              >5</span
            >
            启动与排障
          </h4>
          <div
            class="rounded-xl border border-orange-100 bg-gradient-to-r from-orange-50 to-yellow-50 p-4 dark:border-orange-500/40 dark:from-orange-950/30 dark:to-yellow-950/30 sm:p-6"
          >
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200 sm:text-base">
              服务模式
            </h6>
            <div
              class="mb-4 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
            >
              <div class="whitespace-nowrap text-gray-300">openclaw gateway stop</div>
              <div class="whitespace-nowrap text-gray-300">openclaw gateway start</div>
              <div class="whitespace-nowrap text-gray-300">openclaw gateway restart</div>
            </div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200 sm:text-base">
              若提示服务未安装（Scheduled Task not installed）
            </h6>
            <div
              class="mb-4 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
            >
              <div class="whitespace-nowrap text-gray-300">openclaw gateway install</div>
              <div class="whitespace-nowrap text-gray-300">openclaw gateway start</div>
            </div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200 sm:text-base">
              前台模式（不安装服务）
            </h6>
            <div
              class="mb-4 overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
            >
              <div class="whitespace-nowrap text-gray-300">openclaw gateway</div>
              <div class="whitespace-nowrap text-gray-300"># 或 openclaw gateway run</div>
            </div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-200 sm:text-base">
              常用检查命令
            </h6>
            <div
              class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
            >
              <div class="whitespace-nowrap text-gray-300">openclaw status</div>
              <div class="whitespace-nowrap text-gray-300">openclaw logs --follow</div>
              <div class="whitespace-nowrap text-gray-300">openclaw dashboard --no-open</div>
              <div class="whitespace-nowrap text-gray-300">openclaw tui</div>
            </div>
            <h6 class="mb-2 mt-4 text-sm font-medium text-gray-800 dark:text-gray-200 sm:text-base">
              可选：一键合并脚本
            </h6>
            <div
              class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
            >
              <div class="whitespace-nowrap text-gray-300">OpenClaw配置.ps1</div>
              <div class="whitespace-nowrap text-gray-300">OpenClaw配置.sh</div>
            </div>
            <p class="mt-3 text-xs text-gray-600 dark:text-gray-400 sm:text-sm">
              Windows 下若执行 gateway 命令报权限不足，请用管理员身份打开 PowerShell。
            </p>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="mb-6 sm:mb-10">
          <h4
            class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
          >
            <span
              class="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
              >2</span
            >
            配置 Droid CLI
          </h4>
          <div
            class="rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 dark:border-blue-500/40 dark:from-blue-950/30 dark:to-indigo-950/30 sm:p-6"
          >
            <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
              Droid CLI 使用
              <code class="rounded bg-gray-100 px-1 dark:bg-gray-800">{{ droidConfigPath }}</code>
              保存自定义模型。
            </p>
            <div
              class="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/40 dark:bg-blue-950/30 sm:p-4"
            >
              <h6 class="mb-2 text-sm font-medium text-blue-800 dark:text-blue-200 sm:text-base">
                配置文件示例
              </h6>
              <p class="mb-3 text-sm text-blue-700 dark:text-blue-200">
                将以下内容追加到配置文件中，并替换示例中的 API 密钥：
              </p>
              <div
                class="overflow-x-auto rounded bg-gray-900 p-2 font-mono text-xs text-green-400 sm:p-3 sm:text-sm"
              >
                <div
                  v-for="(line, index) in droidCliConfigLines"
                  :key="'droid-' + index"
                  class="whitespace-pre text-gray-300"
                >
                  {{ line }}
                </div>
              </div>
              <p class="mt-3 text-xs text-blue-700 dark:text-blue-200 sm:text-sm">
                💡 在 Droid CLI 中选择自定义模型即可使用新的 Droid
                账号池；确保服务地址可被本地访问。
              </p>
            </div>
          </div>
        </div>
      </template>

      <div
        class="mt-6 rounded-xl border border-blue-500/20 bg-gradient-to-r from-blue-600 to-indigo-700 p-4 text-white sm:p-6"
      >
        <p class="mb-2 text-sm sm:text-base">
          完成 {{ activeClientLabel }}（{{ activeSystemLabel }}）配置后，即可开始使用。
        </p>
        <p class="text-xs text-blue-100 sm:text-sm">
          如果你的服务域名/端口与本页面不同，请按实际部署地址替换上方 URL。
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const activeTutorialClient = ref('codex')
const activeTutorialSystem = ref('windows')

const joinGroupQrFileName = 'join-group-qr.png'
const joinGroupQrUrl = computed(() => `${import.meta.env.BASE_URL}${joinGroupQrFileName}`)
const joinGroupQrLoadFailed = ref(false)

const ideToolSetupFileName = 'ide-tool-setup.png'
const ideToolSetupUrl = computed(() => `${import.meta.env.BASE_URL}${ideToolSetupFileName}`)
const ideToolSetupLoadFailed = ref(false)

const tutorialClients = [
  { key: 'claude', name: 'Claude', icon: 'fas fa-robot' },
  { key: 'codex', name: 'Codex', icon: 'fas fa-code' },
  { key: 'gemini', name: 'Gemini', icon: 'fas fa-gem' },
  { key: 'openclaw', name: 'OpenClaw', icon: 'fas fa-paw' },
  { key: 'droid', name: 'Droid', icon: 'fas fa-terminal' }
]

const tutorialSystems = [
  { key: 'windows', name: 'Windows', icon: 'fab fa-windows' },
  { key: 'macos', name: 'macOS', icon: 'fab fa-apple' },
  { key: 'linux', name: 'Linux / WSL2', icon: 'fab fa-linux' }
]

const activeClientLabel = computed(() => {
  return (
    tutorialClients.find((client) => client.key === activeTutorialClient.value)?.name || '客户端'
  )
})

const activeSystemLabel = computed(() => {
  return tutorialSystems.find((system) => system.key === activeTutorialSystem.value)?.name || '系统'
})

// 获取基础URL前缀
const getBaseUrlPrefix = () => {
  const customPrefix = import.meta.env.VITE_API_BASE_PREFIX
  if (customPrefix) {
    return customPrefix.replace(/\/$/, '')
  }

  let origin = ''
  if (window.location.origin) {
    origin = window.location.origin
  } else {
    const protocol = window.location.protocol
    const hostname = window.location.hostname
    const port = window.location.port
    origin = protocol + '//' + hostname
    if (
      port &&
      ((protocol === 'http:' && port !== '80') || (protocol === 'https:' && port !== '443'))
    ) {
      origin += ':' + port
    }
  }

  if (!origin) {
    const currentUrl = window.location.href
    const pathStart = currentUrl.indexOf('/', 8)
    if (pathStart !== -1) {
      origin = currentUrl.substring(0, pathStart)
    } else {
      return ''
    }
  }

  return origin
}

const currentBaseUrl = computed(() => getBaseUrlPrefix() + '/api')
const geminiBaseUrl = computed(() => 'https://crss.nanashiwang.com/gemini')
const openaiBaseUrl = computed(() => getBaseUrlPrefix() + '/openai')
const droidClaudeBaseUrl = computed(() => getBaseUrlPrefix() + '/droid/claude')
const droidOpenaiBaseUrl = computed(() => getBaseUrlPrefix() + '/droid/openai')
const openclawOpenaiBaseUrl = computed(() => getBaseUrlPrefix() + '/openai/v1')

const codexConfigDir = computed(() => {
  return activeTutorialSystem.value === 'windows' ? 'C:\\Users\\你的用户名\\.codex\\' : '~/.codex/'
})

const codexAuthFileLines = computed(() => [
  '{',
  '  "NAN_API_KEY": "你的新密钥",',
  '  "OPENAI_API_KEY": "可选的OpenAI密钥"',
  '}'
])

const codexConfigFileLines = computed(() => [
  '# --- model provider added by ZCF ---',
  'model_provider = "nan"',
  'model = "gpt-5.1-codex-max"',
  'model_reasoning_effort = "xhigh"',
  '',
  '[model_providers.nan]',
  'name = "nan"',
  `base_url = "${openaiBaseUrl.value}"`,
  'wire_api = "responses"',
  'env_key = "NAN_API_KEY"',
  'requires_openai_auth = true'
])

const geminiEnvConfig = computed(() => {
  const model = 'gemini-2.5-pro'
  const baseUrl = geminiBaseUrl.value

  if (activeTutorialSystem.value === 'windows') {
    return {
      temporary: {
        title: 'PowerShell 一键配置（推荐）',
        description: '按顺序执行，包含安装、配置和启动：',
        lines: [
          'npm install -g @google/gemini-cli',
          'gemini --version',
          `[System.Environment]::SetEnvironmentVariable("GOOGLE_GEMINI_BASE_URL", "${baseUrl}", [System.EnvironmentVariableTarget]::User)`,
          '[System.Environment]::SetEnvironmentVariable("GEMINI_API_KEY", "cr_bc5e17d5a8ba33d09e7e8f209378d24c6ce420a5decba7cd7964922ea15154f8", [System.EnvironmentVariableTarget]::User)',
          `[System.Environment]::SetEnvironmentVariable("GEMINI_MODEL", "${model}", [System.EnvironmentVariableTarget]::User)`,
          `$env:GOOGLE_GEMINI_BASE_URL = "${baseUrl}"`,
          '$env:GEMINI_API_KEY = "cr_bc5e17d5a8ba33d09e7e8f209378d24c6ce420a5decba7cd7964922ea15154f8"',
          `$env:GEMINI_MODEL = "${model}"`,
          'gemini'
        ]
      },
      persistent: {
        title: 'PowerShell 永久设置（用户级）',
        description: '仅设置用户级环境变量（永久生效）：',
        lines: [
          '# 设置用户级环境变量（永久生效）',
          `[System.Environment]::SetEnvironmentVariable("GOOGLE_GEMINI_BASE_URL", "${baseUrl}", [System.EnvironmentVariableTarget]::User)`,
          '[System.Environment]::SetEnvironmentVariable("GEMINI_API_KEY", "cr_bc5e17d5a8ba33d09e7e8f209378d24c6ce420a5decba7cd7964922ea15154f8", [System.EnvironmentVariableTarget]::User)',
          `[System.Environment]::SetEnvironmentVariable("GEMINI_MODEL", "${model}", [System.EnvironmentVariableTarget]::User)`
        ]
      },
      verify: {
        title: '验证 Gemini CLI 环境变量',
        description: '在 PowerShell 中验证：',
        lines: [
          'echo $env:GOOGLE_GEMINI_BASE_URL',
          'echo $env:GEMINI_API_KEY',
          'echo $env:GEMINI_MODEL'
        ]
      }
    }
  }

  const rcFile = activeTutorialSystem.value === 'macos' ? '~/.zshrc' : '~/.bashrc'
  const sourceCmd = activeTutorialSystem.value === 'macos' ? 'source ~/.zshrc' : 'source ~/.bashrc'

  return {
    temporary: {
      title: '临时设置（当前会话）',
      description: '在终端中运行以下命令：',
      lines: [
        `export GOOGLE_GEMINI_BASE_URL="${baseUrl}"`,
        'export GEMINI_API_KEY="你的API密钥"',
        `export GEMINI_MODEL="${model}"`
      ]
    },
    persistent: {
      title: '持久化（写入 Shell 配置）',
      description: `将以下内容写入 ${rcFile} 后重新加载：`,
      lines: [
        `echo 'export GOOGLE_GEMINI_BASE_URL="${baseUrl}"' >> ${rcFile}`,
        `echo 'export GEMINI_API_KEY="你的API密钥"' >> ${rcFile}`,
        `echo 'export GEMINI_MODEL="${model}"' >> ${rcFile}`,
        sourceCmd
      ]
    },
    verify: {
      title: '验证 Gemini CLI 环境变量',
      description: '在终端中验证：',
      lines: ['echo $GOOGLE_GEMINI_BASE_URL', 'echo $GEMINI_API_KEY', 'echo $GEMINI_MODEL']
    }
  }
})

const droidConfigPath = computed(() => {
  return activeTutorialSystem.value === 'windows'
    ? 'C:\\Users\\你的用户名\\.factory\\config.json'
    : '~/.factory/config.json'
})

const droidCliConfigLines = computed(() => [
  '{',
  '  "custom_models": [',
  '    {',
  '      "model_display_name": "Sonnet 4.5 [crs]",',
  '      "model": "claude-sonnet-4-5-20250929",',
  `      "base_url": "${droidClaudeBaseUrl.value}",`,
  '      "api_key": "你的API密钥",',
  '      "provider": "anthropic",',
  '      "max_tokens": 8192',
  '    },',
  '    {',
  '      "model_display_name": "GPT5-Codex [crs]",',
  '      "model": "gpt-5-codex",',
  `      "base_url": "${droidOpenaiBaseUrl.value}",`,
  '      "api_key": "你的API密钥",',
  '      "provider": "openai",',
  '      "max_tokens": 16384',
  '    }',
  '  ]',
  '}'
])

const openclawConfigPath = computed(() => {
  return activeTutorialSystem.value === 'windows'
    ? 'C:\\Users\\你的用户名\\.openclaw\\openclaw.json'
    : '~/.openclaw/openclaw.json'
})

const openclawProviderJsonLines = computed(() => [
  '{',
  '  "models": {',
  '    "providers": {',
  '      "crs": {',
  `        "baseUrl": "${openclawOpenaiBaseUrl.value}",`,
  '        "api": "openai-responses",',
  '        "auth": "api-key",',
  '        "authHeader": true,',
  '        "headers": { "User-Agent": "openclaw-terminal-test" },',
  '        "apiKey": "${OPI_AUTH_TOKEN}",',
  '        "models": [',
  '          {',
  '            "id": "gpt-5.2-codex",',
  '            "name": "GPT-5.2-Codex",',
  '            "api": "openai-responses",',
  '            "reasoning": true,',
  '            "input": ["text", "image"],',
  '            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },',
  '            "contextWindow": 200000,',
  '            "maxTokens": 32000',
  '          }',
  '        ]',
  '      }',
  '    }',
  '  },',
  '  "agents": {',
  '    "defaults": {',
  '      "model": { "primary": "crs/gpt-5.2-codex" },',
  '      "thinkingDefault": "xhigh"',
  '    }',
  '  }',
  '}'
])
</script>

<style scoped>
.tutorial-content {
  animation: fadeIn 0.25s ease-in-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

code {
  font-family: 'Fira Code', 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}
</style>
