/**
 * @file 预加载脚本
 * @author sqksss
 * @description 把 IPC 通道以最小面暴露给渲染进程：只放行白名单通道，
 * 页面依旧跑在 contextIsolation + sandbox 下，拿不到 Node 能力
 * @date 2026-10-10
 *
 * 沙箱模式下预加载脚本只能是 CommonJS，构建产物固定为 dist-electron/preload.cjs
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import {
  IPC_CHANNELS,
  IPC_TASK_EVENT,
  type IpcChannel,
  type IpcResponse,
  type RendererIpcApi,
} from '../src/shared/ipc.ts'
import type { DownloadTask } from '../src/shared/types.ts'

/** 允许渲染进程调用的通道白名单，页面拿到别的字符串也发不出去 */
const KNOWN_CHANNELS: ReadonlySet<string> = new Set(Object.values(IPC_CHANNELS))

/** 注入到 window.api 的桥接口 */
const bridge: RendererIpcApi = {
  invoke<T>(channel: IpcChannel, payload?: unknown): Promise<IpcResponse<T>> {
    if (!KNOWN_CHANNELS.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'UNKNOWN_CHANNEL', message: '未知的接口通道。' },
      })
    }

    // 返回值类型由主进程的 operations 保证，这里只做透传
    return ipcRenderer.invoke(channel, payload) as Promise<IpcResponse<T>>
  },

  onTask(listener: (task: DownloadTask) => void): () => void {
    const handler = (_event: IpcRendererEvent, task: unknown): void => {
      listener(task as DownloadTask)
    }

    ipcRenderer.on(IPC_TASK_EVENT, handler)

    return () => {
      ipcRenderer.off(IPC_TASK_EVENT, handler)
    }
  },
}

contextBridge.exposeInMainWorld('api', bridge)
