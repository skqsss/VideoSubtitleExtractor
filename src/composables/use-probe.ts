/**
 * @file 解析与发起下载
 * @author sqksss
 * @description 把解析状态、任务创建与错误处理串在一起，组件只调用这里的方法
 * @date 2026-09-26
 */

import { computed, ref } from 'vue'

import { useConfigStore } from '../stores/config-store.ts'
import { useProbeStore } from '../stores/probe-store.ts'
import { useTaskStore } from '../stores/task-store.ts'
import type { DownloadMode } from '../types.ts'

export function useProbe() {
  const probeStore = useProbeStore()
  const taskStore = useTaskStore()
  const configStore = useConfigStore()
  /** 最近一次操作的中文提示，如"已开始下载" */
  const actionNotice = ref('')

  /** 解析结果是否为纯视频分轨（下载后会自动合并音轨） */
  const needsAudioMerge = computed(() => probeStore.result?.hasVideoOnly === true)

  /**
   * 触发解析
   * @returns 无返回值
   */
  async function submitProbe(): Promise<void> {
    actionNotice.value = ''
    const succeeded = await probeStore.probe({
      cookieBrowser: probeStore.resolveCookieBrowser(),
      proxy: probeStore.resolveProxy(),
    })

    if (succeeded && probeStore.result) {
      actionNotice.value = `解析完成，共 ${probeStore.result.formats.length} 个视频档位。`
    }
  }

  /**
   * 按档位或预设创建下载任务
   * @param mode - 下载模式
   * @param formatId - 指定档位时的档位 ID
   * @returns 无返回值
   */
  async function startDownload(mode: DownloadMode, formatId?: string): Promise<void> {
    if (!probeStore.result) {
      actionNotice.value = '请先解析链接。'

      return
    }

    const created = await taskStore.create({
      url: probeStore.result.url,
      mode,
      formatId,
      cookieBrowser: probeStore.resolveCookieBrowser(),
      proxy: probeStore.resolveProxy(),
    })

    actionNotice.value = created ? '已加入下载队列。' : taskStore.notice
  }

  return {
    probeStore,
    taskStore,
    configStore,
    actionNotice,
    needsAudioMerge,
    submitProbe,
    startDownload,
  }
}
