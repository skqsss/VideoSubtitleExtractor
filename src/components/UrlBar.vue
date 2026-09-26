<script setup lang="ts">
/**
 * @file 顶部输入条：链接输入（或整段分享文案）、剪贴板粘贴、Cookie 来源、解析按钮
 * @author Codex
 * @date 2026-09-26
 */
import { computed, ref } from 'vue'

import { useProbe } from '../composables/use-probe.ts'
import { extractVideoUrl } from '../shared/url-utils.ts'
import type { CookieBrowser } from '../types.ts'

/** 可选 Cookie 来源 */
const cookieOptions: Array<{ value: CookieBrowser | 'default'; label: string }> = [
  { value: 'default', label: 'Cookie：跟随设置' },
  { value: 'none', label: 'Cookie：不读取' },
  { value: 'edge', label: 'Cookie：Edge' },
  { value: 'chrome', label: 'Cookie：Chrome' },
  { value: 'firefox', label: 'Cookie：Firefox' },
]

const { probeStore, configStore, submitProbe } = useProbe()

/** 代理配置是否已填写，未填写时禁用"本次走代理" */
const hasProxyConfigured = computed(() => Boolean(configStore.config?.proxy))

/** 粘贴相关的短提示 */
const pasteNotice = ref('')

let noticeTimer = 0

/**
 * 展示一条会自动消失的提示
 * @param message - 中文提示
 */
function showNotice(message: string): void {
  pasteNotice.value = message
  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    pasteNotice.value = ''
  }, 4000)
}

/**
 * 从剪贴板读取最新内容并填入链接
 * @returns 无返回值
 * @remarks 读取剪贴板需要用户手势，因此只能在点击"粘贴"按钮时调用
 */
async function pasteFromClipboard(): Promise<void> {
  let text = ''
  try {
    text = await navigator.clipboard.readText()
  } catch {
    showNotice('浏览器没有授予剪贴板权限，请按 Ctrl+V 直接粘贴到输入框。')

    return
  }

  applySharedText(text)
}

/**
 * 处理 Ctrl+V：识别分享文案并只保留链接
 * @param event - 粘贴事件
 * @remarks 识别不到链接时不拦截，交给浏览器默认粘贴，避免影响手动编辑
 */
function onPaste(event: ClipboardEvent): void {
  const text = event.clipboardData?.getData('text') ?? ''
  const url = extractVideoUrl(text)
  if (!url) {
    return
  }

  event.preventDefault()
  probeStore.inputUrl = url
  showNotice('已从粘贴的分享文案中提取链接。')
}

/**
 * 把一段文本里的链接填入输入框
 * @param text - 剪贴板或粘贴事件里的文本
 */
function applySharedText(text: string): void {
  const url = extractVideoUrl(text)
  if (!url) {
    showNotice('这段内容里没找到链接，请确认复制的是视频分享文案。')

    return
  }

  probeStore.inputUrl = url
  showNotice('已填入链接，按"解析"或回车开始。')
}
</script>

<template>
  <form class="url-bar panel" @submit.prevent="submitProbe">
    <label class="url-bar__input">
      <span class="visually-hidden">视频链接</span>
      <input
        v-model="probeStore.inputUrl"
        class="input"
        type="text"
        inputmode="url"
        autocomplete="off"
        placeholder="粘贴 B 站 / 抖音 / YouTube 链接，或整段分享文案…"
        @paste="onPaste"
      />
    </label>

    <button
      type="button"
      class="button detail url-bar__paste"
      title="读取剪贴板里最新的内容，并只保留其中的链接"
      @click="pasteFromClipboard"
    >
      粘贴
    </button>

    <select v-model="probeStore.cookieBrowser" class="select url-bar__cookie" aria-label="Cookie 来源">
      <option v-for="option in cookieOptions" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>

    <button class="button button--primary url-bar__submit" type="submit" :disabled="probeStore.isLoading">
      {{ probeStore.isLoading ? '解析中…' : '解析' }}
    </button>

    <div class="url-bar__aux">
      <label class="url-bar__proxy">
        <input v-model="probeStore.useProxy" type="checkbox" :disabled="!hasProxyConfigured" />
        <span class="detail">本次走代理</span>
      </label>
      <button
        class="button button--quiet detail"
        type="button"
        :aria-expanded="configStore.isSettingsOpen"
        @click="configStore.isSettingsOpen = !configStore.isSettingsOpen"
      >
        设置
      </button>
    </div>

    <p v-if="pasteNotice" class="url-bar__notice detail" role="status" aria-live="polite">
      {{ pasteNotice }}
    </p>
  </form>
</template>

<style scoped>
.url-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  gap: 8px;
  align-items: center;
  padding: 12px var(--layout-gutter);
}

.url-bar__input {
  display: block;
  min-width: 0;
}

.url-bar__input .input {
  width: 100%;
  font-family: var(--font-mono);
  font-size: var(--font-size-detail);
}

.url-bar__cookie {
  max-width: 190px;
}

.url-bar__aux {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 2px;
  border-top: var(--border-hairline);
}

.url-bar__notice {
  grid-column: 1 / -1;
  color: var(--color-accent);
}

.url-bar__proxy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-ink-soft);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 767px) {
  .url-bar {
    grid-template-columns: minmax(0, 1fr) auto;
    padding: 12px var(--layout-gutter-narrow);
  }

  .url-bar__cookie {
    max-width: none;
  }
}
</style>
