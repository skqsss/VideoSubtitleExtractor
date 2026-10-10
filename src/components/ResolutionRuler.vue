<script setup lang="ts">
/**
 * @file 刻度条：按分辨率与码率缩放的档位强弱可视化
 * @author sqksss
 * @date 2026-09-26
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 占比 0~100 */
    percent: number
    /** 色调：视频或音频 */
    tone?: 'video' | 'audio'
  }>(),
  { tone: 'video' },
)

/** 填充宽度，最小保留一点可见度 */
const width = computed(() => `${Math.min(100, Math.max(4, props.percent))}%`)
</script>

<template>
  <div
    class="ruler"
    :class="`ruler--${tone}`"
    :style="{ '--ruler-width': width }"
    aria-hidden="true"
  >
    <span class="ruler__fill" />
  </div>
</template>

<style scoped>
.ruler {
  position: relative;
  display: block;
  height: 10px;
  min-width: 96px;
  border: var(--border-hairline);
  background-color: #f6f8f7;
  /* 背景刻度：每 10% 一条细线，让长度差一眼可比 */
  background-image: repeating-linear-gradient(
    to right,
    var(--color-line) 0,
    var(--color-line) 1px,
    transparent 1px,
    transparent 10%
  );
}

.ruler__fill {
  display: block;
  width: var(--ruler-width);
  height: 100%;
  background: var(--color-accent);
}

.ruler--audio .ruler__fill {
  background: var(--color-ink-soft);
}
</style>
