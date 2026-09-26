<script setup lang="ts">
/**
 * @file 设置抽屉：下载目录、Cookie 来源、代理、并发与二进制自检
 * @author Codex
 * @date 2026-09-26
 */
import { ref, watch } from 'vue'

import { useConfigStore } from '../stores/config-store.ts'
import type { CookieBrowser } from '../types.ts'

const configStore = useConfigStore()

/** 表单草稿，打开抽屉时从配置同步 */
const draft = ref({
  downloadDir: '',
  cookieBrowser: 'edge' as CookieBrowser,
  cookiesFile: '',
  proxy: '',
  concurrency: 1,
  port: 8787,
})

/** 可选 Cookie 浏览器 */
const cookieOptions: Array<{ value: CookieBrowser; label: string }> = [
  { value: 'none', label: '不读取' },
  { value: 'edge', label: 'Edge' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'chromium', label: 'Chromium' },
  { value: 'brave', label: 'Brave' },
]

watch(
  () => [configStore.isSettingsOpen, configStore.config] as const,
  ([isOpen, config]) => {
    if (!isOpen || !config) {
      return
    }

    draft.value = {
      downloadDir: config.downloadDir,
      cookieBrowser: config.cookieBrowser,
      cookiesFile: config.cookiesFile,
      proxy: config.proxy,
      concurrency: config.concurrency,
      port: config.port,
    }
  },
  { immediate: true },
)

/** 上次自动自检过的 Cookie 路径，避免重复请求 */
let lastInspectedCookies = ''

// 打开设置时自动自检一次 Cookie：导出文件是否正确，直接看到结果而不是靠猜
watch(
  () => [configStore.isSettingsOpen, configStore.config?.cookiesFile ?? ''] as const,
  ([isOpen, cookiesFile]) => {
    if (!isOpen || !cookiesFile || cookiesFile === lastInspectedCookies) {
      return
    }

    lastInspectedCookies = cookiesFile
    void configStore.inspectCookies()
  },
  { immediate: true },
)

/**
 * 保存设置
 * @returns 无返回值
 */
async function saveSettings(): Promise<void> {
  await configStore.save({ ...draft.value })
}
</script>

<template>
  <div v-if="configStore.isSettingsOpen" class="settings">
    <div
      class="settings__backdrop"
      role="button"
      tabindex="0"
      aria-label="关闭设置"
      @click="configStore.isSettingsOpen = false"
      @keydown.enter="configStore.isSettingsOpen = false"
    />
    <aside class="settings__panel" aria-label="设置">
      <header class="settings__head">
        <h2 class="section-title">设置</h2>
        <button
          type="button"
          class="button button--quiet detail"
          @click="configStore.isSettingsOpen = false"
        >
          关闭
        </button>
      </header>

      <div class="settings__body">
        <label class="field">
          <span class="field__label">下载目录</span>
          <input v-model="draft.downloadDir" class="input mono" type="text" />
        </label>

        <label class="field">
          <span class="field__label">默认 Cookie 来源（B 站 1080P+ 与抖音建议选浏览器）</span>
          <select v-model="draft.cookieBrowser" class="select">
            <option v-for="option in cookieOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="field">
          <span class="field__label">
            cookies.txt 路径（可选：可以是文件、整个文件夹，或用 ; 分隔的多个文件）
          </span>
          <input
            v-model="draft.cookiesFile"
            class="input mono"
            type="text"
            placeholder="D:\\video-workspace\\cookies"
          />
          <span class="field__hint">
            在浏览器装 Cookie 导出扩展（Edge / Chrome 可用 Cookie-Editor，或用 Get cookies.txt LOCALLY），
            分别在 B 站与抖音页面导出；两种格式都认——扩展导出的 <span class="mono">.txt</span>（Netscape）与
            <span class="mono">.json</span>（Cookie-Editor）。把文件放进同一个文件夹后填该文件夹即可。
            填了这里就默认不再读浏览器 Cookie（想两者一起用，请在输入条上显式选择浏览器）。
          </span>
        </label>

        <label class="field">
          <span class="field__label">代理地址（YouTube 需要，B 站 / 抖音建议留空直连）</span>
          <input
            v-model="draft.proxy"
            class="input mono"
            type="text"
            placeholder="http://127.0.0.1:7897"
          />
        </label>

        <div class="settings__row">
          <label class="field">
            <span class="field__label">同时下载数</span>
            <input v-model.number="draft.concurrency" class="input mono" type="number" min="1" max="4" />
          </label>
          <label class="field">
            <span class="field__label">服务端口（改动后需重启本地服务生效）</span>
            <input v-model.number="draft.port" class="input mono" type="number" min="1024" max="65535" />
          </label>
        </div>

        <div class="settings__actions">
          <button
            type="button"
            class="button button--primary"
            :disabled="configStore.isSaving"
            @click="saveSettings"
          >
            {{ configStore.isSaving ? '保存中…' : '保存设置' }}
          </button>
          <button type="button" class="button" @click="configStore.refreshHealth()">重新自检</button>
          <button
            type="button"
            class="button"
            :disabled="configStore.isUpdatingYtdlp"
            @click="configStore.updateYtdlp()"
          >
            {{ configStore.isUpdatingYtdlp ? '更新中…' : '更新 yt-dlp' }}
          </button>
          <button
            type="button"
            class="button"
            :disabled="configStore.isInspectingCookies"
            @click="configStore.inspectCookies()"
          >
            {{ configStore.isInspectingCookies ? '检查中…' : '检查 Cookie' }}
          </button>
        </div>

        <p v-if="configStore.cookieSummary" class="settings__cookies detail">
          <span>{{ configStore.cookieSummary.message }}</span>
          <span
            v-for="(names, domain) in configStore.cookieSummary.namesByDomain"
            :key="domain"
            class="settings__cookie-domain mono"
          >
            {{ domain }}：{{ names.join('、') }}
          </span>
          <span v-if="configStore.cookieSummary.ok" class="muted">
            提示：Cookie 过期或与账号不匹配时，B 站可能只给到 480P，反而比不读取更差。
          </span>
        </p>

        <p v-if="configStore.notice" class="settings__notice detail">{{ configStore.notice }}</p>

        <dl v-if="configStore.health" class="settings__health detail">
          <div>
            <dt>yt-dlp</dt>
            <dd class="mono">
              {{ configStore.health.ytdlp.version || '不可用' }}
              <span class="muted">{{ configStore.health.ytdlp.path }}</span>
            </dd>
          </div>
          <div>
            <dt>ffmpeg</dt>
            <dd class="mono">
              {{ configStore.health.ffmpeg.exists ? '可用' : '缺失' }}
              <span class="muted">{{ configStore.health.ffmpeg.dir }}</span>
            </dd>
          </div>
        </dl>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.settings {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  justify-content: flex-end;
}

.settings__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(20, 24, 26, 0.28);
  border: 0;
}

.settings__panel {
  position: relative;
  width: min(420px, 100%);
  height: 100%;
  overflow: auto;
  background: var(--color-panel);
  border-left: var(--border-hairline);
}

.settings__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: var(--border-hairline);
}

.settings__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}

.settings__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.settings__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.settings__notice {
  padding-left: 10px;
  border-left: 2px solid var(--color-warn);
  color: var(--color-ink);
}

.settings__cookies {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 10px;
  border-left: 2px solid var(--color-accent);
  color: var(--color-ink);
  overflow-wrap: anywhere;
}

.settings__cookie-domain {
  color: var(--color-ink-soft);
}

.field__hint {
  color: var(--color-ink-soft);
  font-size: var(--font-size-detail);
  line-height: 1.5;
}

.settings__health {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding-top: 12px;
  border-top: var(--border-hairline);
}

.settings__health dt {
  color: var(--color-ink-soft);
}

.settings__health dd {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-wrap: anywhere;
}
</style>
