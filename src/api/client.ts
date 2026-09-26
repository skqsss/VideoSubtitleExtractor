/**
 * @file 传输层适配
 * @author Codex
 * @description 网页版走 fetch + SSE；将来切桌面版时只替换本文件为 IPC 实现，组件无需改动
 * @date 2026-09-26
 */

import type {
  ApiErrorBody,
  AppConfig,
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
   * @param code - 服务端错误码
   * @param message - 中文提示
   */
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/** 本地服务地址：开发态由 Vite 代理，生产态由本服务自带前端产物 */
const API_BASE = '/api'

/**
 * 发起一次接口请求
 * @param path - 相对于 /api 的路径
 * @param init - fetch 配置
 * @returns 解析后的响应体
 * @throws ApiError 服务端返回错误结构或网络不可达时抛出
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    throw new ApiError('NETWORK', '无法连接本地服务，请确认服务进程仍在运行。')
  }

  if (!response.ok) {
    const body = (await safeParseError(response)) ?? null
    throw new ApiError(
      body?.error.code ?? 'UNKNOWN',
      body?.error.message ?? `请求失败（HTTP ${response.status}）`,
    )
  }

  return (await response.json()) as T
}

/**
 * 尝试解析错误响应体
 * @param response - 失败的响应
 * @returns 错误结构，解析失败返回 null
 */
async function safeParseError(response: Response): Promise<ApiErrorBody | null> {
  try {
    return (await response.json()) as ApiErrorBody
  } catch {
    return null
  }
}

/** 本地服务接口集合 */
export const api = {
  /**
   * 自检 yt-dlp、ffmpeg 是否可用
   * @returns 自检结果
   */
  health(): Promise<HealthResult> {
    return request<HealthResult>('/health')
  },

  /**
   * 读取配置
   * @returns 当前配置
   */
  getConfig(): Promise<AppConfig> {
    return request<AppConfig>('/config')
  },

  /**
   * 更新配置
   * @param patch - 需要修改的字段
   * @returns 更新后的配置
   */
  setConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
    return request<AppConfig>('/config', { method: 'PUT', body: JSON.stringify(patch) })
  },

  /**
   * 更新 yt-dlp 到最新版
   * @returns 更新后的版本号
   */
  updateYtdlp(): Promise<{ version: string }> {
    return request<{ version: string }>('/ytdlp/update', { method: 'POST', body: '{}' })
  },

  /**
   * 解析视频链接
   * @param params - 解析参数
   * @returns 解析结果
   */
  probe(params: ProbeParams): Promise<ProbeResult> {
    return request<ProbeResult>('/probe', { method: 'POST', body: JSON.stringify(params) })
  },

  /**
   * 创建下载任务
   * @param params - 任务参数
   * @returns 任务 ID
   */
  startTask(params: StartTaskParams): Promise<{ taskId: string }> {
    return request<{ taskId: string }>('/tasks', {
      method: 'POST',
      body: JSON.stringify(params),
    })
  },

  /**
   * 读取任务列表
   * @returns 任务数组
   */
  listTasks(): Promise<{ tasks: DownloadTask[] }> {
    return request<{ tasks: DownloadTask[] }>('/tasks')
  },

  /**
   * 取消任务
   * @param taskId - 任务 ID
   * @returns 是否处理成功
   */
  cancelTask(taskId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/tasks/${taskId}/cancel`, {
      method: 'POST',
      body: '{}',
    })
  },

  /**
   * 在资源管理器中定位产物
   * @param taskId - 任务 ID
   * @returns 是否处理成功
   */
  revealTask(taskId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/tasks/${taskId}/reveal`, {
      method: 'POST',
      body: '{}',
    })
  },

  /**
   * 订阅任务进度事件
   * @returns EventSource 实例，调用方负责关闭
   */
  subscribeTasks(): EventSource {
    return new EventSource(`${API_BASE}/events`)
  },
}
