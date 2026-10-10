<script setup lang="ts">
/**
 * @file 解析结果摘要：封面、标题、上传者、时长与预设按钮
 * @author sqksss
 * @date 2026-09-26
 */
import { computed, ref } from 'vue'

import { DOWNLOAD_PRESETS, formatDuration } from '../shared/format-utils.ts'
import { useProbe } from '../composables/use-probe.ts'

const { probeStore, startDownload, needsAudioMerge } = useProbe()

/** 标题复制后的短提示 */
const copyNotice = ref('')

/** 当前解析结果 */
const result = computed(() => probeStore.result)

/**
 * 复制标题到剪贴板
 * @returns 无返回值
 */
async function copyTitle(): Promise<void> {
  if (!result.value) {
    return
  }

  try {
    await navigator.clipboard.writeText(result.value.title)
    copyNotice.value = '标题已复制'
  } catch {
    copyNotice.value = '浏览器拒绝了剪贴板权限，请手动选择复制'
  }

  window.setTimeout(() => {
    copyNotice.value = ''
  }, 2000)
}
</script>

<template>
  <section v-if="result" class="summary panel" aria-labelledby="summary-title">
    <figure class="summary__cover">
      <img
        v-if="result.thumbnail"
        :src="result.thumbnail"
        alt=""
        referrerpolicy="no-referrer"
        loading="lazy"
      />
      <span v-else class="summary__cover-empty detail">无封面</span>
    </figure>

    <div class="summary__body">
      <h2 id="summary-title" class="summary__title">
        <button type="button" class="summary__title-button" @click="copyTitle">
          {{ result.title }}
        </button>
      </h2>

      <p class="summary__meta detail mono">
        <span>{{ result.uploader }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ formatDuration(result.duration) }}</span>
        <span aria-hidden="true">·</span>
        <span>共 {{ result.formats.length }} 档可选</span>
        <span v-if="copyNotice" class="summary__copy">{{ copyNotice }}</span>
      </p>

      <div class="summary__presets">
        <button
          v-for="preset in DOWNLOAD_PRESETS"
          :key="preset.mode"
          type="button"
          class="button summary__preset"
          :title="preset.hint"
          @click="startDownload(preset.mode)"
        >
          {{ preset.label }}
        </button>
      </div>

      <p v-if="needsAudioMerge" class="summary__hint detail">
        该平台把画面与声音分轨存放，选择纯视频档位时会自动带上最佳音轨并在下载后合并。
      </p>

      <p v-if="result.warning" class="summary__warning detail">{{ result.warning }}</p>
    </div>
  </section>
</template>

<style scoped>
.summary {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  gap: 16px;
  padding: 16px;
}

.summary__cover {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 160px;
  aspect-ratio: 16 / 9;
  background: var(--color-canvas);
  border: var(--border-hairline);
  overflow: hidden;
}

.summary__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.summary__title {
  font-size: var(--font-size-section);
  font-weight: 600;
  line-height: 1.35;
  max-width: 40em;
}

.summary__title-button {
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  cursor: copy;
  color: inherit;
  font: inherit;
}

.summary__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
  color: var(--color-ink-soft);
}

.summary__copy {
  color: var(--color-accent);
}

.summary__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.summary__preset {
  font-size: var(--font-size-detail);
}

.summary__hint {
  margin-top: 10px;
  padding-left: 10px;
  border-left: 2px solid var(--color-warn);
  color: var(--color-ink-soft);
}

.summary__warning {
  margin-top: 8px;
  padding-left: 10px;
  border-left: 2px solid var(--color-warn);
  color: var(--color-warn);
}

@media (max-width: 767px) {
  .summary {
    grid-template-columns: 1fr;
  }

  .summary__cover {
    width: 100%;
  }
}
</style>
