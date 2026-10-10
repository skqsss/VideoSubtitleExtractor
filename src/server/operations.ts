/**
 * @file 业务操作层
 * @author sqksss
 * @description 参数校验、业务调用与错误翻译都收在这里，传输层（IPC）只负责转发与包装；
 * 不依赖 Electron，单元测试可以直接调用
 * @date 2026-10-10
 */

import { ZodError } from 'zod'

import type {
  AppConfig,
  CookieInspectResult,
  DownloadTask,
  HealthResult,
  ProbeResult,
} from '../shared/types.ts'
import { checkHealth, updateYtdlp } from './binary-service.ts'
import { inspectCookies } from './cookie-service.ts'
import { YtdlpError } from './errors.ts'
import { logger } from './logger.ts'
import { configSchema, probeSchema, startTaskSchema, taskIdSchema } from './schemas.ts'
import type { TaskManager } from './task-manager.ts'
import { probeVideo } from './ytdlp-service.ts'

/** 操作层依赖的运行上下文 */
export interface OperationsContext {
  /** 读取当前配置 */
  getConfig: () => AppConfig
  /** 更新配置并返回更新后的完整配置 */
  setConfig: (patch: Partial<AppConfig>) => AppConfig
  /** 任务管理器 */
  taskManager: TaskManager
}

/** 界面可调用的业务操作：入参统一为 unknown，校验在实现内部完成 */
export interface Operations {
  health(payload: unknown): Promise<HealthResult>
  getConfig(payload: unknown): Promise<AppConfig>
  setConfig(payload: unknown): Promise<AppConfig>
  updateYtdlp(payload: unknown): Promise<{ version: string }>
  inspectCookies(payload: unknown): Promise<CookieInspectResult>
  probe(payload: unknown): Promise<ProbeResult>
  startTask(payload: unknown): Promise<{ taskId: string }>
  listTasks(payload: unknown): Promise<{ tasks: DownloadTask[] }>
  cancelTask(payload: unknown): Promise<{ ok: boolean }>
  revealTask(payload: unknown): Promise<{ ok: boolean }>
}

/**
 * 创建业务操作集合
 * @param context - 运行上下文
 * @returns 供传输层调用的操作集合
 */
export function createOperations(context: OperationsContext): Operations {
  return {
    health: (_payload) => checkHealth(context.getConfig()),
    getConfig: async (_payload) => context.getConfig(),
    setConfig: async (payload) => context.setConfig(configSchema.parse(payload ?? {})),
    updateYtdlp: async (_payload) => ({ version: await updateYtdlp(context.getConfig()) }),
    inspectCookies: async (_payload) => inspectCookies(context.getConfig().cookiesFile),
    probe: async (payload) => probeVideo(probeSchema.parse(payload ?? {}), context.getConfig()),
    startTask: async (payload) => ({
      taskId: context.taskManager.createTask(startTaskSchema.parse(payload ?? {})).id,
    }),
    listTasks: async (_payload) => ({ tasks: context.taskManager.listTasks() }),
    cancelTask: async (payload) => ({
      ok: await context.taskManager.cancelTask(taskIdSchema.parse(payload)),
    }),
    revealTask: async (payload) => {
      context.taskManager.revealTask(taskIdSchema.parse(payload))

      return { ok: true }
    },
  }
}

/**
 * 把异常翻译成界面可判断的错误体
 * @param error - 捕获到的异常
 * @returns 错误码与中文提示
 * @remarks 业务异常与参数校验错误原样透出；其余记完整堆栈后只给一句通用提示，不把内部细节暴露到界面
 */
export function toErrorBody(error: unknown): { code: string; message: string } {
  if (error instanceof YtdlpError) {
    return { code: error.code, message: error.message }
  }

  if (error instanceof ZodError) {
    const firstIssue = error.issues[0]

    return { code: 'INVALID_PARAMS', message: firstIssue?.message ?? '请求参数不合法。' }
  }

  const reason = error instanceof Error ? error.message : String(error)
  logger.error('operations', '未预期的内部错误', {
    reason,
    stack: error instanceof Error ? (error.stack ?? '') : '',
  })

  return { code: 'UNKNOWN', message: '主进程内部出现异常，请查看日志文件。' }
}
