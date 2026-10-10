/**
 * @file 冒烟自检入口
 * @author sqksss
 * @description 用真实运行形态（app:// 页面 + preload + IPC）拉起隐藏窗口，
 * 在渲染进程里读回界面与通道状态：全部通过退出码 0，任一失败退出码 1，供 npm run test:electron 使用
 * @date 2026-10-10
 */

import fs from 'node:fs'
import path from 'node:path'

import { app, type BrowserWindow } from 'electron'

import { logger } from '../src/server/logger.ts'
import { IPC_CHANNELS, type IpcResponse } from '../src/shared/ipc.ts'
import { bootstrap, dispose, getMainWindow, getPreloadPath, registerAppScheme } from './app.ts'

/** 窗口加载超时 */
const LOAD_TIMEOUT_MS = 30_000
/** 等待首轮接口回到界面的超时 */
const READY_TIMEOUT_MS = 20_000
/** 轮询间隔 */
const POLL_INTERVAL_MS = 300
/** 整体超时：卡住时不能一直挂着 */
const TOTAL_TIMEOUT_MS = 60_000
/** 正式应用的 userData 目录名，与 package.json 的 name 保持一致 */
const USER_DATA_DIR = 'videosubtitleextractor'

/** 从渲染进程读回的界面状态 */
interface PageState {
  mounted: boolean
  hasBridge: boolean
  rail: string
  tasksHead: string
}

/** 直接调用通道读回的状态 */
interface IpcState {
  health: IpcResponse<{ ytdlp: { version: string } }>
  config: IpcResponse<unknown>
  tasks: IpcResponse<unknown>
  badParams: IpcResponse<unknown>
  /** 桥没注入时为 true，此时上面几项无意义 */
  bridgeMissing?: boolean
}

/** 单项自检结果 */
interface SmokeCheck {
  name: string
  passed: boolean
  detail: string
}

/** 在页面里读取界面状态：这些文本只有接口数据回来后才不是占位文案 */
const INSPECT_PAGE_SCRIPT = `(() => {
  const readText = (selector) => document.querySelector(selector)?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
  return {
    mounted: (document.querySelector('#app')?.childElementCount ?? 0) > 0,
    hasBridge: typeof window.api?.invoke === 'function',
    rail: readText('.app__rail'),
    tasksHead: readText('.tasks__head'),
  }
})()`

/** 判断首轮接口是否已经回到界面：占位文案消失即为就绪 */
const READY_SCRIPT = `(() => {
  const rail = document.querySelector('.app__rail')?.textContent ?? ''
  return rail.includes('检测中') === false && rail.length > 0
})()`

/**
 * 组装直接调用通道的脚本
 * @returns 在渲染进程里执行的脚本
 * @remarks 通道名从共享定义里取，避免脚本和真实通道名脱节
 */
function buildIpcScript(): string {
  const channel = (name: keyof typeof IPC_CHANNELS): string => JSON.stringify(IPC_CHANNELS[name])

  return `(async () => {
    if (typeof window.api?.invoke !== 'function') {
      return { bridgeMissing: true }
    }

    const badParams = await window.api.invoke(${channel('probe')}, {})
    return {
      health: await window.api.invoke(${channel('health')}),
      config: await window.api.invoke(${channel('getConfig')}),
      tasks: await window.api.invoke(${channel('listTasks')}),
      badParams,
    }
  })()`
}

/**
 * 等待一段时间
 * @param ms - 毫秒数
 * @returns 无返回值的 Promise
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * 等待窗口完成加载
 * @param window - 主窗口
 * @returns 无返回值
 */
async function waitForLoad(window: BrowserWindow): Promise<void> {
  if (!window.webContents.isLoading()) {
    return
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, LOAD_TIMEOUT_MS)

    window.webContents.once('did-finish-load', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * 轮询等待页面进入预期状态
 * @param window - 主窗口
 * @param script - 返回布尔值的页面脚本
 * @param timeoutMs - 超时时间
 * @returns 超时前满足条件返回 true
 * @remarks 自检读的是真实界面：yt-dlp / ffmpeg 首次自检要启动子进程，固定等待时间不可靠，改成轮询
 */
async function waitForReady(window: BrowserWindow, script: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if ((await window.webContents.executeJavaScript(script)) === true) {
      return true
    }

    await delay(POLL_INTERVAL_MS)
  }

  return false
}

/**
 * 收集全部自检项
 * @param window - 主窗口
 * @returns 自检结果数组
 */
async function collectChecks(window: BrowserWindow): Promise<SmokeCheck[]> {
  const page = (await window.webContents.executeJavaScript(INSPECT_PAGE_SCRIPT)) as PageState
  const ipc = (await window.webContents.executeJavaScript(buildIpcScript())) as IpcState
  const ipcUsable = !ipc.bridgeMissing
  const ytdlpVersion = ipcUsable && ipc.health.ok ? ipc.health.data.ytdlp.version : ''

  return [
    {
      name: '界面已挂载',
      passed: page.mounted,
      detail: page.mounted ? 'Vue 已渲染到 #app' : '页面没有渲染出内容',
    },
    {
      name: 'preload 桥已注入',
      passed: page.hasBridge,
      detail: page.hasBridge ? 'window.api.invoke 可用' : 'window.api 缺失，preload 没生效',
    },
    {
      name: '自检信息已读回',
      passed: page.rail.includes('yt-dlp') && !page.rail.includes('检测中'),
      detail: page.rail || '（空）',
    },
    {
      name: '任务列表已读回',
      passed: page.tasksHead.includes('当前没有进行中的任务'),
      detail: page.tasksHead || '（空）',
    },
    {
      name: 'IPC 正常返回',
      passed: ipcUsable && ipc.health.ok && ipc.config.ok && ipc.tasks.ok,
      detail: ipcUsable
        ? `health=${ipc.health.ok} config=${ipc.config.ok} tasks=${ipc.tasks.ok}，yt-dlp 版本：${ytdlpVersion || '未读取到'}`
        : '窗口里没有 window.api，无法调用通道',
    },
    {
      name: '错误信封带错误码',
      passed: ipcUsable && !ipc.badParams.ok && ipc.badParams.error.code === 'INVALID_PARAMS',
      detail: !ipcUsable
        ? '窗口里没有 window.api，无法调用通道'
        : ipc.badParams.ok
          ? '空参数没有被拦下'
          : `code=${ipc.badParams.error.code} message=${ipc.badParams.error.message}`,
    },
  ]
}

/**
 * 执行自检
 * @returns 进程退出码
 */
async function main(): Promise<number> {
  await app.whenReady()
  await bootstrap({ isVisible: false })

  const preloadPath = getPreloadPath()
  logger.info('smoke', '运行环境', {
    appPath: app.getAppPath(),
    preload: preloadPath,
    preloadExists: fs.existsSync(preloadPath),
  })

  const window = getMainWindow()
  if (!window) {
    logger.error('smoke', '主窗口未创建')

    return 1
  }

  await waitForLoad(window)

  const isReady = await waitForReady(window, READY_SCRIPT, READY_TIMEOUT_MS)
  if (!isReady) {
    logger.warn('smoke', '等待首轮接口回填界面超时，按当前状态出报告')
  }

  const checks = await collectChecks(window)
  let isPassed = true

  for (const check of checks) {
    process.stdout.write(`[${check.passed ? 'OK' : 'FAIL'}] ${check.name}：${check.detail}\n`)
    if (!check.passed) {
      isPassed = false
    }
  }

  process.stdout.write(
    isPassed
      ? '\n冒烟自检通过：界面渲染与 IPC 通道均正常。\n'
      : '\n冒烟自检未通过，请查看上面的 FAIL 项。\n',
  )

  return isPassed ? 0 : 1
}

/**
 * 启动自检并退出进程
 */
async function run(): Promise<void> {
  const timeout = setTimeout(() => {
    process.stderr.write('冒烟自检超时，强制退出。\n')
    app.exit(2)
  }, TOTAL_TIMEOUT_MS)

  let code = 1
  try {
    code = await main()
  } catch (error) {
    logger.error('smoke', '冒烟自检异常', { reason: (error as Error).message })
  } finally {
    clearTimeout(timeout)
    await dispose()
  }

  app.exit(code)
}

// 自定义协议必须在 app ready 之前领取特权
registerAppScheme()

// 从脚本入口启动时 Electron 的默认身份是 "Electron"，
// 这里把 userData 固定成正式应用的目录，保证自检读的是同一份配置
app.setPath('userData', path.join(app.getPath('appData'), USER_DATA_DIR))

void run()
