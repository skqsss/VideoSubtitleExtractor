<script setup lang="ts">
/**
 * @file 档位表格：筛选、排序与逐档下载
 * @author Codex
 * @date 2026-09-26
 */
import { computed } from 'vue'

import {
  formatBitrate,
  formatBytes,
  formatCodec,
  formatResolution,
} from '../shared/format-utils.ts'
import { useFormatFilter, type FormatFilter, type FormatSortKey } from '../composables/use-format-filter.ts'
import { useProbe } from '../composables/use-probe.ts'
import ResolutionRuler from './ResolutionRuler.vue'

const { probeStore, startDownload } = useProbe()

/** 可筛选的档位类型 */
const filterOptions: Array<{ value: FormatFilter; label: string }> = [
  { value: 'video', label: '视频档位' },
  { value: 'audio', label: '仅音频' },
  { value: 'all', label: '全部' },
]

const formats = computed(() => probeStore.result?.formats ?? [])
const audioFormats = computed(() => probeStore.result?.audioFormats ?? [])
const { filter, sortKey, direction, visibleFormats, toggleSort } = useFormatFilter(
  formats,
  audioFormats,
)

/** 表头排序提示，供 aria-sort 使用 */
function ariaSort(key: FormatSortKey): 'ascending' | 'descending' | 'none' {
  if (sortKey.value !== key) {
    return 'none'
  }

  return direction.value === 'desc' ? 'descending' : 'ascending'
}

/**
 * 点击表头切换排序
 * @param key - 排序字段
 * @returns 无返回值
 */
function onSort(key: FormatSortKey): void {
  toggleSort(key)
}
</script>

<template>
  <section v-if="probeStore.result" class="formats panel" aria-labelledby="formats-title">
    <header class="formats__head">
      <h2 id="formats-title" class="section-title">可选档位</h2>
      <div class="formats__filters" role="group" aria-label="档位筛选">
        <button
          v-for="option in filterOptions"
          :key="option.value"
          type="button"
          class="formats__filter detail"
          :class="{ 'formats__filter--active': filter === option.value }"
          :aria-pressed="filter === option.value"
          @click="filter = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </header>

    <table class="format-table">
      <thead>
        <tr>
          <th scope="col">档位</th>
          <th scope="col">刻度</th>
          <th scope="col" :aria-sort="ariaSort('resolution')">
            <button type="button" class="format-table__sort" @click="onSort('resolution')">分辨率</button>
          </th>
          <th scope="col" :aria-sort="ariaSort('fps')">
            <button type="button" class="format-table__sort" @click="onSort('fps')">帧率</button>
          </th>
          <th scope="col">编码</th>
          <th scope="col" :aria-sort="ariaSort('bitrate')">
            <button type="button" class="format-table__sort" @click="onSort('bitrate')">码率</button>
          </th>
          <th scope="col" :aria-sort="ariaSort('filesize')">
            <button type="button" class="format-table__sort" @click="onSort('filesize')">体积</button>
          </th>
          <th scope="col" class="format-table__action-head">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="format in visibleFormats" :key="format.formatId">
          <td data-label="档位" class="format-table__id">
            <span class="mono">{{ format.formatId }}</span>
            <span class="format-table__ext mono">.{{ format.ext }}</span>
          </td>
          <td data-label="刻度">
            <ResolutionRuler
              :percent="format.rulerPercent"
              :tone="format.isAudioOnly ? 'audio' : 'video'"
            />
          </td>
          <td data-label="分辨率" class="mono">
            {{ formatResolution(format) }}
            <span v-if="format.note" class="format-table__note">{{ format.note }}</span>
          </td>
          <td data-label="帧率" class="mono">{{ format.fps ? format.fps.toFixed(0) : '—' }}</td>
          <td data-label="编码" class="mono">
            {{ formatCodec(format.isAudioOnly ? format.acodec : format.vcodec) }}
            <span v-if="format.isVideoOnly" class="format-table__tag detail">+音轨</span>
          </td>
          <td data-label="码率" class="mono">{{ formatBitrate(format.tbr) }}</td>
          <td data-label="体积" class="mono">{{ formatBytes(format.filesize) }}</td>
          <td data-label="操作" class="format-table__action">
            <button
              type="button"
              class="button detail"
              @click="startDownload('format', format.formatId)"
            >
              下载
            </button>
          </td>
        </tr>
        <tr v-if="visibleFormats.length === 0">
          <td colspan="8" class="format-table__empty detail muted">这个筛选下没有可用档位。</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.formats {
  padding: 16px;
}

.formats__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.formats__filters {
  display: inline-flex;
  gap: 2px;
  border: var(--border-hairline);
}

.formats__filter {
  padding: 4px 10px;
  border: 0;
  background: var(--color-panel);
  color: var(--color-ink-soft);
  cursor: pointer;
}

.formats__filter--active {
  background: var(--color-accent-soft);
  color: var(--color-ink);
  font-weight: 600;
}

.format-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-detail);
}

.format-table th,
.format-table td {
  padding: 8px 10px;
  border-bottom: var(--border-hairline);
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
}

.format-table thead th {
  font-weight: 500;
  color: var(--color-ink-soft);
  border-bottom-color: var(--color-ink-soft);
}

.format-table__sort {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.format-table__sort::after {
  content: '↕';
  margin-left: 4px;
  opacity: 0.5;
}

.format-table tbody tr:hover {
  background: #fafbfa;
}

.format-table__id {
  font-weight: 600;
}

.format-table__ext {
  margin-left: 6px;
  color: var(--color-ink-soft);
  font-weight: 400;
}

.format-table__note,
.format-table__tag {
  margin-left: 6px;
  padding: 1px 5px;
  border: var(--border-hairline);
  color: var(--color-warn);
}

.format-table__action-head,
.format-table__action {
  text-align: right;
}

.format-table__empty {
  padding: 16px 10px;
}

/* 窄屏：表格退化为卡片，仍保持同一份 DOM */
@media (max-width: 767px) {
  .formats__head {
    flex-direction: column;
    align-items: flex-start;
  }

  .format-table thead {
    display: none;
  }

  .format-table,
  .format-table tbody,
  .format-table tr,
  .format-table td {
    display: block;
    width: 100%;
  }

  .format-table tr {
    padding: 10px 0;
    border-bottom: var(--border-hairline);
  }

  .format-table td {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 0;
    border: 0;
    white-space: normal;
  }

  .format-table td::before {
    content: attr(data-label);
    color: var(--color-ink-soft);
    flex: 0 0 64px;
  }

  .format-table__action {
    justify-content: flex-end;
  }

  .format-table__action::before {
    display: none;
  }
}
</style>
