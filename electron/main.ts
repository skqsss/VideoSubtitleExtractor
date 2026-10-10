/**
 * @file Electron 主进程入口
 * @author sqksss
 * @description 只负责应用生命周期与单实例约束，运行时装配见 electron/app.ts
 * @date 2026-10-10
 */

import { BrowserWindow, Menu, app } from 'electron'

import { logger } from '../src/server/logger.ts'
import { bootstrap, dispose, getMainWindow, registerAppScheme, reopenWindow } from './app.ts'

// 自定义协议必须在 app ready 之前领取特权
registerAppScheme()

// 只允许开一个实例，重复双击时把已有窗口拉到前面
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = getMainWindow()
    if (window) {
      if (window.isMinimized()) {
        window.restore()
      }

      window.focus()
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && getMainWindow() === null) {
      reopenWindow()
    }
  })

  app.on('before-quit', () => {
    void dispose()
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    await bootstrap()
  }).catch((error: unknown) => {
    logger.error('electron', '启动失败', { reason: (error as Error).message })
    app.quit()
  })
}
