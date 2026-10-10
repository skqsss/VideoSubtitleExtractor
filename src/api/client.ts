/**
 * @file 传输层适配
 * @author sqksss
 * @description 界面唯一与主进程通信的出口：通道名与 electron/ipc.ts 一一对应，
 * 组件只认这里的方法，不感知 IPC 的存在
 * @date 2026-10-10
 */

import { IPC_CHANNELS, type IpcChannel, type RendererIpcApi } from '../shared/ipc.ts'
import type {
  AppConfig,
  CookieInspectResult,
  DownloadTask,
  HealthResult,
  ProbeParams,
  ProbeResult,
  StartTaskParams,
} from '../types.ts'

/** 带错误码的接口异常，供界面分支判断（如需登录、网络不通等） */
export class ApiError extends Error {
  readonly code: string

  /**
   * @param code - 主进程返回的错误码
   * @param message - 中文提示
   */
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/**
 * 读取 preload 注入的桥接口
 * @returns IPC 桥
 * @throws ApiError 页面不在应用窗口内打开（没有 preload）时抛出
 */
function getBridge(): RendererIpcApi {
  const bridge = window.api
  if (!bridge) {
    throw new ApiError('NO_BRIDGE', '当前页面没有连上应用主进程，请从应用窗口打开。')
  }

  return bridge
}

/**
 * 发起一次接口调用
 * @param channel - 业务通道名
 * @param payload - 请求参数
 * @returns 主进程返回的数据
 * @throws ApiError 主进程返回错误信封时抛出
 */
async function request<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  const response = await getBridge().invoke<T>(channel, payload)

  if (!response.ok) {
    throw new ApiError(response.error.code, response.error.message)
  }

  return response.data
}

/** 主进程提供的业务接口 */
export const api = {
  /**
   * 自检 yt-dlp、ffmpeg 是否可用
   * @returns 自检结果
   */
  health(): Promise<HealthResult> {
    return request<HealthResult>(IPC_CHANNELS.health)
  },

  /**
   * 读取配置
   * @returns 当前配置
   */
  getConfig(): Promise<AppConfig> {
    return request<AppConfig>(IPC_CHANNELS.getConfig)
  },

  /**
   * 更新配置
   * @param patch - 需要修改的字段
   * @returns 更新后的配置
   */
  setConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
    return request<AppConfig>(IPC_CHANNELS.setConfig, patch)
  },

  /**
   * 更新 yt-dlp 到最新版
   * @returns 更新后的版本号
   */
  updateYtdlp(): Promise<{ version: string }> {
    return request<{ version: string }>(IPC_CHANNELS.updateYtdlp)
  },

  /**
   * 自检 cookies.txt 配置
   * @returns Cookie 条数与覆盖的域名
   */
  inspectCookies(): Promise<CookieInspectResult> {
    return request<CookieInspectResult>(IPC_CHANNELS.inspectCookies)
  },

  /**
   * 解析视频链接
   * @param params - 解析参数
   * @returns 解析结果
   */
  probe(params: ProbeParams): Promise<ProbeResult> {
    return request<ProbeResult>(IPC_CHANNELS.probe, params)
  },

  /**
   * 创建下载任务
   * @param params - 任务参数
   * @returns 任务 ID
   */
  startTask(params: StartTaskParams): Promise<{ taskId: string }> {
    return request<{ taskId: string }>(IPC_CHANNELS.startTask, params)
  },

  /**
   * 读取任务列表
   * @returns 任务数组
   */
  listTasks(): Promise<{ tasks: DownloadTask[] }> {
    return request<{ tasks: DownloadTask[] }>(IPC_CHANNELS.listTasks)
  },

  /**
   * 取消任务
   * @param taskId - 任务 ID
   * @returns 是否处理成功
   */
  cancelTask(taskId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(IPC_CHANNELS.cancelTask, taskId)
  },

  /**
   * 在资源管理器中定位产物
   * @param taskId - 任务 ID
   * @returns 是否处理成功
   */
  revealTask(taskId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(IPC_CHANNELS.revealTask, taskId)
  },

  /**
   * 订阅任务进度
   * @param listener - 收到任务快照的回调
   * @returns 取消订阅的函数
   */
  subscribeTasks(listener: (task: DownloadTask) => void): () => void {
    return getBridge().onTask(listener)
  },
}
