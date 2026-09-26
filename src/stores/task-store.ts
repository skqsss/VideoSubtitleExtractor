/**
 * @file 下载任务状态
 * @author Codex
 * @description 维护任务列表并订阅服务端进度事件（SSE）
 * @date 2026-09-26
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError, api } from '../api/client.ts'
import type { DownloadTask, StartTaskParams } from '../types.ts'

export const useTaskStore = defineStore('task', () => {
  /** 任务列表，新建在前 */
  const tasks = ref<DownloadTask[]>([])
  /** 任务操作的中文提示 */
  const notice = ref('')
  /** 是否已建立进度订阅 */
  const isSubscribed = ref(false)

  /** 正在进行的任务数量 */
  const activeCount = computed(
    () => tasks.value.filter((task) => task.status === 'running' || task.status === 'queued').length,
  )

  let stream: EventSource | null = null

  /**
   * 建立进度订阅并拉取一次任务列表
   * @returns 无返回值
   */
  function connect(): void {
    if (stream) {
      return
    }

    void refresh()
    stream = api.subscribeTasks()
    stream.addEventListener('task', (event) => {
      try {
        upsert(JSON.parse((event as MessageEvent<string>).data) as DownloadTask)
      } catch {
        notice.value = '进度数据解析失败，正在等待下一次推送。'
      }
    })
    stream.addEventListener('open', () => {
      isSubscribed.value = true
    })
    stream.addEventListener('error', () => {
      // EventSource 会自动重连，这里只更新状态提示，不打断用户操作
      isSubscribed.value = false
    })
  }

  /**
   * 关闭进度订阅
   */
  function disconnect(): void {
    stream?.close()
    stream = null
    isSubscribed.value = false
  }

  /**
   * 拉取一次任务列表
   * @returns 无返回值
   */
  async function refresh(): Promise<void> {
    try {
      const result = await api.listTasks()
      tasks.value = result.tasks
    } catch (error) {
      notice.value = error instanceof ApiError ? error.message : '读取任务列表失败。'
    }
  }

  /**
   * 创建下载任务
   * @param params - 任务参数
   * @returns 创建成功返回 true
   */
  async function create(params: StartTaskParams): Promise<boolean> {
    notice.value = ''

    try {
      await api.startTask(params)
      await refresh()

      return true
    } catch (error) {
      notice.value = error instanceof ApiError ? error.message : '创建下载任务失败。'

      return false
    }
  }

  /**
   * 取消任务
   * @param taskId - 任务 ID
   * @returns 无返回值
   */
  async function cancel(taskId: string): Promise<void> {
    try {
      await api.cancelTask(taskId)
      await refresh()
    } catch (error) {
      notice.value = error instanceof ApiError ? error.message : '取消任务失败。'
    }
  }

  /**
   * 在资源管理器中定位产物
   * @param taskId - 任务 ID
   * @returns 无返回值
   */
  async function reveal(taskId: string): Promise<void> {
    try {
      await api.revealTask(taskId)
    } catch (error) {
      notice.value = error instanceof ApiError ? error.message : '打开目录失败。'
    }
  }

  /**
   * 按 ID 合并任务快照
   * @param incoming - 服务端推送的任务快照
   */
  function upsert(incoming: DownloadTask): void {
    const index = tasks.value.findIndex((task) => task.id === incoming.id)
    if (index >= 0) {
      tasks.value[index] = incoming

      return
    }

    tasks.value = [incoming, ...tasks.value]
  }

  return {
    tasks,
    notice,
    isSubscribed,
    activeCount,
    connect,
    disconnect,
    refresh,
    create,
    cancel,
    reveal,
  }
})
