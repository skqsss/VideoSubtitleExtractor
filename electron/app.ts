/**
 * @file Electron 运行时装配
 * @author sqksss
 * @description 桌面版把业务逻辑跑在主进程里，窗口通过自定义 app:// 协议加载前端产物，
 * 前后端之间只走 IPC（见 electron/ipc.ts），不再监听任何本地端口
 * @date 2026-10-10
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { BrowserWindow, app, net, protocol, shell } from 'electron'

import {
  loadConfig,
  saveConfig,
  setConfigPath,
  setDataDir,
  setDefaultConfigPatch,
  setProjectRoot,
} from '../src/server/config.ts'
import { setDouyinPageResolver } from '../src/server/douyin-service.ts'
import { logger } from '../src/server/logger.ts'
import { createOperations } from '../src/server/operations.ts'
import { TaskManager } from '../src/server/task-manager.ts'
import { IPC_TASK_EVENT } from '../src/shared/ipc.ts'
import type { AppConfig, DownloadTask } from '../src/shared/types.ts'
import { createDouyinPageResolver, disposeDouyinWindow } from './douyin-window.ts'
import { registerIpcHandlers } from './ipc.ts'

/** 窗口默认尺寸与最小尺寸 */
const WINDOW_WIDTH = 1180
const WINDOW_HEIGHT = 820
const WINDOW_MIN_WIDTH = 940
const WINDOW_MIN_HEIGHT = 620

/** 打包后二进制所在的资源目录名 */
const RESOURCES_BIN_DIR = 'bin'

/**
 * 应用根目录
 * @remarks 产物固定放在 <根目录>/dist-electron/ 下，按入口文件位置反推；
 * 不用 app.getAppPath()：直接以脚本文件为入口启动时（如冒烟自检）它会变成 dist-electron，路径会整体错位
 */
const APP_ROOT = path.resolve(import.meta.dirname, '..')

/** 页面协议：给渲染进程一个稳定 origin，页面里的绝对资源路径（/assets/…）才能正常解析 */
const APP_SCHEME = 'app'
const APP_HOST = 'local'

/** 生产态入口页地址 */
const APP_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`

/** 前端产物入口文件名 */
const APP_INDEX_FILE = 'index.html'

/** 预加载脚本产物路径（沙箱下必须是 CommonJS） */
const PRELOAD_FILE = path.join('dist-electron', 'preload.cjs')

/** 当前窗口、任务队列与配置 */
let mainWindow: BrowserWindow | null = null
let taskManager: TaskManager | null = null
let currentConfig: AppConfig | null = null
let currentPageUrl = ''
let unsubscribeTask: (() => void) | null = null

/** 承载界面的窗口：任务进度只推给它们，抓取窗口不参与 */
const appWindows = new Set<BrowserWindow>()

/**
 * 解析外部二进制的真实目录
 * @returns 可执行的 yt-dlp 与 ffmpeg 所在目录
 * @remarks 开发态直接用项目里的 bin/；打包后 asar 只读，首次运行把 resources/bin 复制到 userData/bin，
 * 这样应用内"更新 yt-dlp"才能写进去
 */
function resolveBinaryDir(): string {
  if (!app.isPackaged) {
    return path.join(APP_ROOT, RESOURCES_BIN_DIR)
  }

  const target = path.join(app.getPath('userData'), RESOURCES_BIN_DIR)
  const source = path.join(process.resourcesPath, RESOURCES_BIN_DIR)
  const marker = path.join(target, 'yt-dlp.exe')

  if (!fs.existsSync(source)) {
    return target
  }

  if (!fs.existsSync(marker)) {
    fs.mkdirSync(target, { recursive: true })
    logger.info('electron', '首次启动，复制外部二进制到用户目录', { target })
    fs.cpSync(source, target, { recursive: true })

    return target
  }

  // 升级安装后，随包版本可能比用户目录里的新：按时间戳择优同步
  // 反过来（用户点过"更新 yt-dlp"，用户目录里更新）则保留用户那份，不覆盖
  refreshBinaryIfNewer(path.join(source, 'yt-dlp.exe'), path.join(target, 'yt-dlp.exe'))
  refreshBinaryIfNewer(
    path.join(source, 'ffmpeg', 'ffmpeg.exe'),
    path.join(target, 'ffmpeg', 'ffmpeg.exe'),
  )

  return target
}

/**
 * 随包二进制比用户目录里的新时，覆盖同步（含同目录的 dll）
 * @param sourceFile - 资源目录里的文件
 * @param targetFile - userData 里的同名文件
 */
function refreshBinaryIfNewer(sourceFile: string, targetFile: string): void {
  if (!fs.existsSync(sourceFile)) {
    return
  }

  const sourceTime = fs.statSync(sourceFile).mtimeMs
  const targetTime = fs.existsSync(targetFile) ? fs.statSync(targetFile).mtimeMs : 0
  if (sourceTime <= targetTime) {
    return
  }

  const sourceDir = path.dirname(sourceFile)
  const targetDir = path.dirname(targetFile)
  fs.mkdirSync(targetDir, { recursive: true })
  fs.cpSync(sourceDir, targetDir, { recursive: true, force: true })
  logger.info('electron', '随包二进制较新，已同步到用户目录', {
    file: path.basename(sourceFile),
  })
}

/**
 * 准备运行环境：根目录、配置位置、可写目录与二进制默认值
 * @returns 二进制目录
 * @remarks 主进程在装配业务层之前调用，服务端各模块只认这些被覆盖后的路径
 */
function prepareRuntimePaths(): string {
  setProjectRoot(APP_ROOT)
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
 * 领取自定义协议特权
 * @remarks 必须在 app ready 之前调用，否则协议不生效
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ])
}

/**
 * 读取预加载脚本产物路径
 * @returns 绝对路径
 */
export function getPreloadPath(): string {
  return path.join(APP_ROOT, PRELOAD_FILE)
}

/**
 * 把 app:// 请求映射到前端构建产物
 * @remarks 页面资源是绝对路径，走自定义协议比 file:// 更稳；
 * 解析结果越出 dist 目录时会被拦回入口页，避免穿越读到别的文件
 */
function registerAppProtocol(): void {
  const distDir = path.join(APP_ROOT, 'dist')

  protocol.handle(APP_SCHEME, async (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname)
    const relative = pathname.replace(/^\/+/, '')
    const candidate = path.normalize(path.join(distDir, relative))
    const isInsideDist = candidate === distDir || candidate.startsWith(distDir + path.sep)

    if (isInsideDist && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return net.fetch(pathToFileURL(candidate).toString())
    }

    // 无扩展名的路径按前端入口处理；带扩展名却找不到的按 404 返回，避免把 HTML 当成图片发回去
    if (path.extname(relative) === '') {
      const indexFile = path.join(distDir, APP_INDEX_FILE)
      if (fs.existsSync(indexFile)) {
        return net.fetch(pathToFileURL(indexFile).toString())
      }

      return buildTextResponse('text/html; charset=utf-8', NOT_BUILT_PAGE)
    }

    return buildTextResponse('text/plain; charset=utf-8', '未找到该资源。', 404)
  })
}

/**
 * 组装一个响应对象
 * @param contentType - 响应类型
 * @param body - 响应正文
 * @param status - 状态码
 * @returns 响应对象
 */
function buildTextResponse(contentType: string, body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } })
}

/**
 * 判断页面地址是否允许窗口停留
 * @param url - 目标地址
 * @returns 属于应用协议或开发服务器时为 true
 */
function isAllowedPageUrl(url: string): boolean {
  if (url.startsWith(`${APP_SCHEME}://`)) {
    return true
  }

  const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? ''

  return devServerUrl.length > 0 && url.startsWith(devServerUrl)
}

/**
 * 创建主窗口
 * @param pageUrl - 前端页面地址
 * @param isVisible - 是否显示窗口，冒烟自检传 false
 */
function createWindow(pageUrl: string, isVisible: boolean): void {
  // 每次打开主窗口都重新登记一次：主窗口关闭时抓取窗口会被销毁，
  // 重新打开（Dock / 任务栏激活）后要能恢复解析能力
  setDouyinPageResolver(createDouyinPageResolver())

  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#EFF1EF',
    title: '视频分辨率解析下载器',
    icon: path.join(APP_ROOT, 'build', 'icon.ico'),
    webPreferences: {
      // 页面只通过 preload 暴露的 IPC 与主进程通信，不需要 Node 能力
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  })

  mainWindow = window
  appWindows.add(window)

  window.once('ready-to-show', () => {
    if (isVisible) {
      window.show()
    }
  })
  window.on('closed', () => {
    appWindows.delete(window)
    if (mainWindow === window) {
      mainWindow = null
    }

    // 抓取窗口也计入窗口列表，留着会让"关掉主窗口即退出"失效
    disposeDouyinWindow()
  })

  // 外部链接交给系统浏览器打开，窗口本身只允许停在本地页面
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedPageUrl(url)) {
      event.preventDefault()
      if (/^https?:/i.test(url)) {
        void shell.openExternal(url)
      }
    }
  })

  void window.loadURL(pageUrl)
}

/**
 * 把任务快照推给所有界面窗口
 * @param task - 任务快照
 */
function broadcastTask(task: DownloadTask): void {
  for (const window of appWindows) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_TASK_EVENT, task)
    }
  }
}

/**
 * 装配运行时并打开窗口
 * @param options - isVisible 控制窗口是否显示，冒烟自检传 false
 * @returns 无返回值
 */
export async function bootstrap(options: { isVisible?: boolean } = {}): Promise<void> {
  prepareRuntimePaths()
  registerAppProtocol()

  currentConfig = loadConfig()
  taskManager = new TaskManager(() => currentConfig as AppConfig)

  registerIpcHandlers(
    createOperations({
      getConfig: () => currentConfig as AppConfig,
      setConfig: (patch) => {
        currentConfig = saveConfig(patch)

        return currentConfig
      },
      taskManager,
    }),
  )

  // 开发态窗口直接加载 Vite 页面（带热更新），生产态加载打包后的 app:// 页面
  const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? ''
  currentPageUrl = devServerUrl || APP_ENTRY_URL
  unsubscribeTask = taskManager.onTask(broadcastTask)

  createWindow(currentPageUrl, options.isVisible ?? true)
  logger.info('electron', '窗口已就绪', {
    pageUrl: currentPageUrl,
    packaged: app.isPackaged,
  })
}

/**
 * 释放运行时资源：任务队列子进程、抓取窗口与进度订阅
 * @returns 无返回值
 */
export async function dispose(): Promise<void> {
  unsubscribeTask?.()
  unsubscribeTask = null
  disposeDouyinWindow()
  await taskManager?.dispose()
  taskManager = null
}

/**
 * 读取当前主窗口
 * @returns 主窗口，未创建或已关闭时返回 null
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/**
 * 重新打开窗口（窗口被关闭但应用仍在运行）
 */
export function reopenWindow(): void {
  if (currentPageUrl) {
    createWindow(currentPageUrl, true)
  }
}

/** 未构建前端产物时的占位页，便于区分"没构建"和"页面加载失败" */
const NOT_BUILT_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>前端产物缺失</title>
    <style>
      body { font-family: system-ui, "Microsoft YaHei", sans-serif; margin: 40px; color: #14181A; }
      code { font-family: ui-monospace, Consolas, monospace; background: #EFF1EF; padding: 2px 6px; }
    </style>
  </head>
  <body>
    <h1>前端产物缺失</h1>
    <p>没有找到 <code>dist/index.html</code>，请先执行 <code>npm run build</code>，或用 <code>npm run electron:dev</code> 加载 Vite 开发页面。</p>
  </body>
</html>
`
