/**
 * @file 格式表的筛选与排序
 * @author sqksss
 * @description 把"全部 / 仅视频 / 仅音频"与按列排序抽成纯逻辑，便于单测与复用
 * @date 2026-09-26
 */

import { computed, ref, type Ref } from 'vue'

import type { VideoFormat } from '../types.ts'

/** 档位筛选类型 */
export type FormatFilter = 'video' | 'audio' | 'all'

/** 排序字段 */
export type FormatSortKey = 'resolution' | 'bitrate' | 'filesize' | 'fps'

/** 排序方向 */
export type SortDirection = 'desc' | 'asc'

/**
 * 依据排序字段比较两个档位
 * @param left - 左侧档位
 * @param right - 右侧档位
 * @param key - 排序字段
 * @returns 升序比较结果
 */
function compareBy(left: VideoFormat, right: VideoFormat, key: FormatSortKey): number {
  switch (key) {
    case 'bitrate':
      return (left.tbr ?? 0) - (right.tbr ?? 0)
    case 'filesize':
      return (left.filesize ?? 0) - (right.filesize ?? 0)
    case 'fps':
      return (left.fps ?? 0) - (right.fps ?? 0)
    case 'resolution':
    default:
      return (left.height ?? 0) - (right.height ?? 0)
  }
}

/**
 * 组合式函数：格式表筛选与排序
 * @param formats - 视频档位
 * @param audioFormats - 音频档位
 * @returns 可见档位与筛选状态
 */
export function useFormatFilter(
  formats: Ref<VideoFormat[]>,
  audioFormats: Ref<VideoFormat[]>,
) {
  const filter = ref<FormatFilter>('video')
  const sortKey = ref<FormatSortKey>('resolution')
  const direction = ref<SortDirection>('desc')

  /** 当前筛选后的档位 */
  const visibleFormats = computed(() => {
    const source =
      filter.value === 'audio'
        ? audioFormats.value
        : filter.value === 'all'
          ? [...formats.value, ...audioFormats.value]
          : formats.value
    const factor = direction.value === 'desc' ? -1 : 1

    return [...source].sort((left, right) => compareBy(left, right, sortKey.value) * factor)
  })

  /**
   * 切换排序：同一列切换方向，换列时回到降序
   * @param key - 排序字段
   */
  function toggleSort(key: FormatSortKey): void {
    if (sortKey.value === key) {
      direction.value = direction.value === 'desc' ? 'asc' : 'desc'

      return
    }

    sortKey.value = key
    direction.value = 'desc'
  }

  return { filter, sortKey, direction, visibleFormats, toggleSort }
}
