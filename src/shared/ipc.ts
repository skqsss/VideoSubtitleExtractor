/**
 * @file 渲染进程与主进程之间的通道约定
 * @author sqksss
 * @description 通道名与统一响应信封收在这里，preload、主进程注册与前端调用三方共用一份定义，
 * 以后加接口只需要在这一个文件里补通道
 * @date 2026-10-10
 */

import type { DownloadTask } from './types.ts'

/** 渲染进程可调用的业务通道 */
export const IPC_CHANNELS = {
  health: 'health',
  getConfig: 'config:get',
  setConfig: 'config:set',
  updateYtdlp: 'ytdlp:update',
  inspectCookies: 'cookies:inspect',
  probe: 'probe',
  startTask: 'task:start',
  listTasks: 'task:list',
  cancelTask: 'task:cancel',
  revealTask: 'task:reveal',
} as const

/** 主进程向渲染进程推送任务快照的通道（单向，不需要返回值） */
export const IPC_TASK_EVENT = 'task:update'

/** 业务通道名联合类型 */
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

/** 统一响应信封：IPC 抛异常会丢掉自定义字段，所以错误码改成放在返回值里传 */
export type IpcResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

/** preload 通过 contextBridge 暴露的接口，渲染进程与实际实现共用同一份类型 */
export interface RendererIpcApi {
  /**
   * 调用主进程接口
   * @param channel - 业务通道名
   * @param payload - 请求参数，主进程侧会用 zod 再校验一次
   * @returns 统一响应信封
   */
  invoke<T>(channel: IpcChannel, payload?: unknown): Promise<IpcResponse<T>>

  /**
   * 订阅任务进度
   * @param listener - 收到任务快照的回调
   * @returns 取消订阅的函数
   */
  onTask(listener: (task: DownloadTask) => void): () => void
}
