/// <reference types="vite/client" />

import type { RendererIpcApi } from './src/shared/ipc.ts'

declare global {
  interface Window {
    /** preload 注入的 IPC 桥，见 electron/preload.ts */
    api: RendererIpcApi
  }
}
