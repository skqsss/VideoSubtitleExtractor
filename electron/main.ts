/**
 * @file Electron 主进程
 * @author Codex
 * @description 桌面版入口：把已有的本地服务跑在主进程里，再用窗口加载它托管的前端页面。
 * 这样前端、服务端、任务队列全部复用同一套代码，只有运行形态不同（网页版是独立 node 进程）
 * @date 2026-09-26
 */

import fs from 'node:fs'
import path from 'node:path'

import { BrowserWindow, Menu, app, shell } from 'electron'

import {
  loadConfig,
  saveConfig,
  setConfigPath,
  setDataDir,
  setDefaultConfigPatch,
  setProjectRoot,
} from '../src/server/config.ts'
import { getListeningPort, startHttpServer } from '../src/server/http-server.ts'
import { logger } from '../src/server/logger.ts'
import { TaskManager } from '../src/server/task-manager.ts'
import type { AppConfig } from '../src/shared/types.ts'

/** 窗口默认尺寸与最小尺寸 */
const WINDOW_WIDTH = 1180
const WINDOW_HEIGHT = 820
const WINDOW_MIN_WIDTH = 940
const WINDOW_MIN_HEIGHT = 620

/** 打包后二进制所在的资源目录名 */
const RESOURCES_BIN_DIR = 'bin'

/** 当前窗口与任务队列 */
let mainWindow: BrowserWindow | null = null
let taskManager: TaskManager | null = null
let currentConfig: AppConfig | null = null
let currentPageUrl = ''

/**
 * 解析外部二进制的真实目录
 * @returns 可执行的 yt-dlp 与 ffmpeg 所在目录
 * @remarks 开发态直接用项目里的 bin/；打包后 asar 只读，首次运行把 resources/bin 复制到 userData/bin，
 * 这样应用内"更新 yt-dlp"才能写进去
 */
function resolveBinaryDir(): string {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), RESOURCES_BIN_DIR)
  }

  const target = path.join(app.getPath('userData'), RESOURCES_BIN_DIR)
  const source = path.join(process.resourcesPath, RESOURCES_BIN_DIR)
  const marker = path.join(target, 'yt-dlp.exe')

  if (!fs.existsSync(marker) && fs.existsSync(source)) {
    fs.mkdirSync(target, { recursive: true })
    logger.info('electron', '首次启动，复制外部二进制到用户目录', { target })
    fs.cpSync(source, target, { recursive: true })
  }

  return target
}

/**
 * 准备运行环境：根目录、配置位置、可写目录与二进制默认值
 * @returns 二进制目录
 * @remarks 主进程在启动服务之前调用，服务端各模块只认这些被覆盖后的路径
 */
function prepareRuntimePaths(): string {
  setProjectRoot(app.getAppPath())
  setConfigPath(path.join(app.getPath('userData'), 'config.json'))
  setDataDir(app.getPath('userData'))

  const binaryDir = resolveBinaryDir()
  setDefaultConfigPatch({
    ytdlpPath: path.join(binaryDir, 'yt-dlp.exe'),
    ffmpegDir: path.join(binaryDir, 'ffmpeg'),
    downloadDir: path.join(app.getPath('videos'), 'VideoSubtitleExtractor'),
  })

  return binaryDir
}

/**
 * 创建主窗口
 * @param pageUrl - 前端页面地址
 */
function createWindow(pageUrl: string): void {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#EFF1EF',
    title: '视频分辨率解析下载器',
    icon: path.join(app.getAppPath(), 'build', 'icon.ico'),
    webPreferences: {
      // 页面只通过本地 HTTP 接口与主进程通信，不需要 Node 能力
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 外部链接交给系统浏览器打开，窗口本身只允许停在本地页面
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://127.0.0.1')) {
      event.preventDefault()
      if (/^https?:/i.test(url)) {
        void shell.openExternal(url)
      }
    }
  })

  void mainWindow.loadURL(pageUrl)
}

/**
 * 启动本地服务并打开窗口
 */
async function bootstrap(): Promise<void> {
  prepareRuntimePaths()

  currentConfig = loadConfig()
  taskManager = new TaskManager(() => currentConfig as AppConfig)

  const serverContext = {
    getConfig: () => currentConfig as AppConfig,
    setConfig: (patch: Partial<AppConfig>) => {
      currentConfig = saveConfig(patch)

      return currentConfig
    },
    taskManager,
  }

  // 端口被占用时退回系统分配的空闲端口：桌面版不该因为端口冲突起不来
  let server = await startHttpServer(serverContext, { port: currentConfig.port }).catch(
    async (error: unknown) => {
      logger.warn('electron', '配置端口不可用，改用随机空闲端口', {
        port: currentConfig?.port,
        reason: (error as Error).message,
      })

      return startHttpServer(serverContext, { port: 0 })
    },
  )

  const port = getListeningPort(server)
  currentPageUrl = process.env.VITE_DEV_SERVER_URL ?? `http://127.0.0.1:${port}/`
  logger.info('electron', '窗口已就绪', { pageUrl: currentPageUrl, packaged: app.isPackaged })

  createWindow(currentPageUrl)

  app.on('before-quit', () => {
    void taskManager?.dispose()
    void server.close()
  })
}

/**
 * 重新打开窗口（窗口被关闭但应用仍在运行）
 */
function reopenWindow(): void {
  if (currentPageUrl) {
    createWindow(currentPageUrl)
  }
}

// 只允许开一个实例，重复双击时把已有窗口拉到前面
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
      reopenWindow()
    }
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    await bootstrap()
  }).catch((error: unknown) => {
    logger.error('electron', '启动失败', { reason: (error as Error).message })
    app.quit()
  })
}
