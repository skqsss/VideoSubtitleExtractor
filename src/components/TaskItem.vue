<script setup lang="ts">
/**
 * @file 单条下载任务：进度、速度、剩余时间与操作
 * @author sqksss
 * @date 2026-09-26
 */
import { computed } from 'vue'

import { formatBytes } from '../shared/format-utils.ts'
import { useTaskStore } from '../stores/task-store.ts'
import type { DownloadTask, TaskStatus } from '../types.ts'
import ResolutionRuler from './ResolutionRuler.vue'

const props = defineProps<{ task: DownloadTask }>()

const taskStore = useTaskStore()

/** 任务状态对应的中文文案 */
const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '下载中',
  done: '已完成',
  error: '失败',
  canceled: '已取消',
}

/** 状态文案 */
const statusLabel = computed(() => STATUS_LABELS[props.task.status])

/** 是否可取消 */
const canCancel = computed(() => props.task.status === 'queued' || props.task.status === 'running')

/** 进度条的无障碍文本 */
const progressText = computed(() => `${props.task.percent}%（${statusLabel.value}）`)

/** 体积展示：已完成显示总量，下载中显示 已下载/总量 */
const sizeText = computed(() => {
  const { downloadedBytes, totalBytes } = props.task
  if (totalBytes) {
    return `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
  }

  return downloadedBytes > 0 ? formatBytes(downloadedBytes) : ''
})
</script>

<template>
  <li class="task" :class="`task--${task.status}`">
    <div class="task__head">
      <div class="task__title">
        <span class="task__name">{{ task.title }}</span>
        <span class="task__format detail mono">{{ task.formatLabel }}</span>
      </div>
      <span class="task__status detail" :class="`task__status--${task.status}`">{{ statusLabel }}</span>
    </div>

    <ResolutionRuler
      v-if="task.status === 'running' || task.status === 'queued'"
      :percent="task.percent"
    />

    <div
      v-if="task.status === 'running' || task.status === 'queued'"
      class="task__progress"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="task.percent"
      :aria-valuetext="progressText"
    >
      <span class="mono task__percent">{{ task.percent }}%</span>
      <span v-if="task.speed" class="mono detail muted">{{ task.speed }}</span>
      <span v-if="task.eta" class="mono detail muted">剩余 {{ task.eta }}</span>
      <span v-if="sizeText" class="mono detail muted">{{ sizeText }}</span>
    </div>

    <p v-if="task.status === 'error'" class="task__error detail">{{ task.error }}</p>

    <p v-if="task.warning" class="task__warning detail">{{ task.warning }}</p>

    <p v-if="task.status === 'done' && task.outputPath" class="task__path detail mono">
      {{ task.outputPath }}
    </p>

    <div class="task__actions">
      <button
        v-if="canCancel"
        type="button"
        class="button detail"
        @click="taskStore.cancel(task.id)"
      >
        取消
      </button>
      <button
        v-if="task.status === 'done'"
        type="button"
        class="button detail"
        @click="taskStore.reveal(task.id)"
      >
        打开目录
      </button>
      <details v-if="task.log" class="task__log detail">
        <summary>查看原始日志</summary>
        <pre class="mono">{{ task.log }}</pre>
      </details>
    </div>
  </li>
</template>

<style scoped>
.task {
  list-style: none;
  padding: 12px 0;
  border-bottom: var(--border-hairline);
}

.task:last-child {
  border-bottom: 0;
}

.task__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.task__title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.task__name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.task__format {
  color: var(--color-ink-soft);
}

.task__status {
  flex: 0 0 auto;
  color: var(--color-ink-soft);
}

.task__status--done {
  color: var(--color-accent);
}

.task__status--error {
  color: var(--color-danger);
}

.task__status--canceled {
  color: var(--color-warn);
}

.task__progress {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
}

.task__percent {
  font-weight: 600;
  min-width: 48px;
}

.task__error {
  margin-top: 8px;
  padding-left: 10px;
  border-left: 2px solid var(--color-danger);
  color: var(--color-danger);
}

.task__warning {
  margin-top: 8px;
  padding-left: 10px;
  border-left: 2px solid var(--color-warn);
  color: var(--color-warn);
}

.task__path {
  margin-top: 6px;
  color: var(--color-ink-soft);
  overflow-wrap: anywhere;
}

.task__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.task__log {
  color: var(--color-ink-soft);
}

.task__log pre {
  max-height: 220px;
  margin: 8px 0 0;
  padding: 10px;
  overflow: auto;
  background: var(--color-canvas);
  border: var(--border-hairline);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
