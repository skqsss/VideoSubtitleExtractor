<script setup lang="ts">
/**
 * @file 页面骨架：顶部状态栏 + 粘性输入条 + 解析结果 + 任务队列
 * @author Codex
 * @date 2026-09-26
 */
import { computed, onMounted } from 'vue'

import FormatTable from './components/FormatTable.vue'
import MediaSummary from './components/MediaSummary.vue'
import SettingsPanel from './components/SettingsPanel.vue'
import TaskList from './components/TaskList.vue'
import UrlBar from './components/UrlBar.vue'
import { useProbe } from './composables/use-probe.ts'

const { probeStore, configStore, actionNotice } = useProbe()

/** 环境自检状态点样式 */
const healthTone = computed(() => {
  if (!configStore.health) {
    return 'status-dot'
  }

  return configStore.health.ok ? 'status-dot status-dot--ok' : 'status-dot status-dot--error'
})

/** yt-dlp 版本展示 */
const ytdlpText = computed(() => {
  const health = configStore.health
  if (!health) {
    return 'yt-dlp 检测中'
  }

  return health.ytdlp.exists ? `yt-dlp ${health.ytdlp.version || '未知版本'}` : 'yt-dlp 缺失'
})

/** ffmpeg 状态展示 */
const ffmpegText = computed(() => {
  const health = configStore.health
  if (!health) {
    return 'ffmpeg 检测中'
  }

  return health.ffmpeg.exists ? 'ffmpeg 就绪' : 'ffmpeg 缺失'
})

onMounted(() => {
  void configStore.load()
})
</script>

<template>
  <div class="app">
    <header class="app__header">
      <div class="layout-wrap app__header-inner">
        <h1 class="app__title">视频分辨率解析下载器</h1>
        <dl class="app__rail detail">
          <div class="app__rail-item">
            <span :class="healthTone" aria-hidden="true" />
            <dt class="visually-hidden">yt-dlp 状态</dt>
            <dd class="mono">{{ ytdlpText }}</dd>
          </div>
          <div class="app__rail-item">
            <span :class="healthTone" aria-hidden="true" />
            <dt class="visually-hidden">ffmpeg 状态</dt>
            <dd class="mono">{{ ffmpegText }}</dd>
          </div>
          <div class="app__rail-item app__rail-item--dir">
            <dt class="visually-hidden">下载目录</dt>
            <dd class="mono" :title="configStore.health?.downloadDir">
              {{ configStore.health?.downloadDir ?? '下载目录读取中' }}
            </dd>
          </div>
        </dl>
      </div>
    </header>

    <div class="app__sticky">
      <div class="layout-wrap app__sticky-inner">
        <UrlBar />
      </div>
    </div>

    <main class="app__main layout-wrap">
      <p class="visually-hidden" role="status" aria-live="polite">{{ actionNotice }}</p>

      <p v-if="configStore.health && !configStore.health.ok" class="app__alert">
        {{ configStore.health.message }}
      </p>

      <section v-if="probeStore.error" class="app__alert app__alert--error" role="alert">
        <p>{{ probeStore.error }}</p>
        <p v-if="probeStore.errorCode === 'NEED_LOGIN'" class="detail">
          下一步：在设置里选择你常用的浏览器（如 Edge）后重新解析，即可解锁更高清晰度。
        </p>
        <p v-else-if="probeStore.errorCode === 'NETWORK'" class="detail">
          下一步：确认网络可访问该站点，必要时在设置里填写代理地址。
        </p>
        <p v-else-if="probeStore.errorCode === 'NEED_FRESH_COOKIES'" class="detail">
          下一步：在设置里指定浏览器扩展导出的 cookies.txt（或选择一个能读取 Cookie 的浏览器）。抖音未登录也需要这份 Cookie。
        </p>
        <p v-else-if="probeStore.errorCode === 'COOKIE_DECRYPT'" class="detail">
          下一步：在设置里指定 cookies.txt，或完全退出浏览器后重试；Chrome / Edge 新版加密会让 yt-dlp 读不到 Cookie。
        </p>
        <p v-else-if="probeStore.errorCode === 'COOKIE_FILE_MISSING'" class="detail">
          下一步：在设置里更正 cookies.txt 路径，或清空该项改用浏览器 Cookie。
        </p>
      </section>

      <div v-if="probeStore.isLoading" class="app__skeleton panel" aria-busy="true">
        <p class="detail muted">正在解析链接，通常需要几秒钟…</p>
        <span v-for="row in 4" :key="row" class="app__skeleton-row" />
      </div>

      <MediaSummary v-if="!probeStore.isLoading" />
      <FormatTable v-if="!probeStore.isLoading" />

      <p v-if="!probeStore.isLoading && !probeStore.result" class="app__empty detail">
        把视频链接粘到上面的输入框，点"解析"，页面会列出该视频的全部可用分辨率与编码档位。
      </p>

      <TaskList />

      <footer class="app__footer detail">
        <p>
          下载内容仅限已获授权或个人研究使用，转载需取得授权并遵守目标平台规则；工具本身不提供任何规避手段。
        </p>
        <p class="muted">
          外部程序：yt-dlp（解析与下载）+ ffmpeg（音视频合并）。全部命令以数组参数调用，不经过 shell。
        </p>
      </footer>
    </main>

    <SettingsPanel />
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app__header {
  border-bottom: var(--border-hairline);
  background: var(--color-panel);
}

.app__header-inner {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-top: 20px;
  padding-bottom: 16px;
}

.app__title {
  font-size: var(--font-size-title);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.app__rail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0;
  margin: 0;
}

.app__rail-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border-left: var(--border-hairline);
  color: var(--color-ink-soft);
}

.app__rail-item:first-child {
  border-left: 0;
}

.app__rail-item--dir {
  max-width: 320px;
}

.app__rail-item dd {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app__sticky {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--color-canvas);
}

.app__sticky-inner {
  padding-top: 12px;
}

.app__main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  padding-top: 16px;
  padding-bottom: 32px;
}

.app__alert {
  padding: 10px 12px;
  border: var(--border-hairline);
  border-left: 2px solid var(--color-warn);
  background: var(--color-panel);
}

.app__alert--error {
  border-left-color: var(--color-danger);
  color: var(--color-danger);
}

.app__skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}

.app__skeleton-row {
  height: 12px;
  background: var(--color-canvas);
}

.app__empty {
  padding: 16px;
  border: 1px dashed var(--color-line);
  color: var(--color-ink-soft);
  max-width: 40em;
}

.app__footer {
  margin-top: 8px;
  padding-top: 12px;
  border-top: var(--border-hairline);
  color: var(--color-ink-soft);
  max-width: 52em;
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
  .app__title {
    font-size: 22px;
  }

  .app__rail-item {
    padding: 0 8px;
  }

  .app__rail-item--dir {
    max-width: 100%;
    flex-basis: 100%;
    border-left: 0;
    padding: 4px 0 0;
  }
}
</style>
