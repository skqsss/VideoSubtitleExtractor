/**
 * @file 主进程 IPC 接口注册
 * @author sqksss
 * @description 把业务操作层挂到 IPC 通道上：成功返回 { ok: true, data }，
 * 失败返回 { ok: false, error }，异常不跨进程抛出（跨进程会丢掉自定义错误码）
 * @date 2026-10-10
 */

import { ipcMain } from 'electron'

import { logger } from '../src/server/logger.ts'
import { toErrorBody, type Operations } from '../src/server/operations.ts'
import { IPC_CHANNELS, type IpcChannel, type IpcResponse } from '../src/shared/ipc.ts'

/**
 * 业务方法到通道名的映射
 * @remarks 用 Record 约束：新增业务操作却忘了配通道时，这里直接编译失败
 */
const CHANNEL_BY_METHOD: Record<keyof Operations, IpcChannel> = {
  health: IPC_CHANNELS.health,
  getConfig: IPC_CHANNELS.getConfig,
  setConfig: IPC_CHANNELS.setConfig,
  updateYtdlp: IPC_CHANNELS.updateYtdlp,
  inspectCookies: IPC_CHANNELS.inspectCookies,
  probe: IPC_CHANNELS.probe,
  startTask: IPC_CHANNELS.startTask,
  listTasks: IPC_CHANNELS.listTasks,
  cancelTask: IPC_CHANNELS.cancelTask,
  revealTask: IPC_CHANNELS.revealTask,
}

/**
 * 注册全部业务通道
 * @param operations - 业务操作集合
 * @remarks 只在启动时调用一次；重复注册同名通道会抛错，所以不做幂等处理
 */
export function registerIpcHandlers(operations: Operations): void {
  for (const method of Object.keys(CHANNEL_BY_METHOD) as Array<keyof Operations>) {
    const channel = CHANNEL_BY_METHOD[method]

    ipcMain.handle(channel, async (_event, payload: unknown): Promise<IpcResponse<unknown>> => {
      try {
        return { ok: true, data: await operations[method](payload) }
      } catch (error) {
        return { ok: false, error: toErrorBody(error) }
      }
    })
  }

  logger.info('ipc', 'IPC 接口已注册', { count: Object.keys(CHANNEL_BY_METHOD).length })
}
