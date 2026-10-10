/**
 * @file 任务进度订阅
 * @author sqksss
 * @description 组件挂载时建立 SSE 订阅，卸载时关闭，避免重复连接
 * @date 2026-09-26
 */

import { onBeforeUnmount, onMounted } from 'vue'

import { useTaskStore } from '../stores/task-store.ts'

/**
 * 在当前组件生命周期内订阅任务进度
 * @returns 任务 store
 */
export function useTaskStream() {
  const taskStore = useTaskStore()

  onMounted(() => {
    taskStore.connect()
  })
  onBeforeUnmount(() => {
    taskStore.disconnect()
  })

  return taskStore
}
