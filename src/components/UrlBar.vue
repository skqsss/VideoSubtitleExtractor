<script setup lang="ts">
/**
 * @file 顶部输入条：链接输入、Cookie 来源、解析按钮
 * @author Codex
 * @date 2026-09-26
 */
import { computed } from 'vue'

import { useProbe } from '../composables/use-probe.ts'
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
        placeholder="粘贴 B 站 / 抖音 / YouTube 链接…"
      />
    </label>

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
  </form>
</template>

<style scoped>
.url-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
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
