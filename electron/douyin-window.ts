/**
 * @file 抖音详情抓取窗口
 * @author sqksss
 * @description 用隐藏窗口打开抖音视频页，借页面自己的签名请求拿到详情 JSON，
 * 再把 aweme_detail 交给服务层。窗口与调试域只在首次解析时建立，之后复用同一个会话，
 * 既省掉冷启动时间，也让抖音那边的设备指纹保持稳定
 * @date 2026-10-02
 */

import { BrowserWindow } from 'electron'

import type {
  DouyinPageResult,
  DouyinPageResolver,
  RawDouyinAwemeDetail,
} from '../src/server/douyin-service.ts'
import { extractAwemeId, isDetailForAweme } from '../src/server/douyin-service.ts'
import { logger } from '../src/server/logger.ts'

/** 抖音视频页地址模板 */
const VIDEO_PAGE_TEMPLATE = 'https://www.douyin.com/video/'

/** 单次解析的最长等待时间：页面加载 + 详情请求 */
const RESOLVE_TIMEOUT_MS = 30_000

/** 会话分区：独立于主窗口，复用后可省去重复的风控校验 */
const RESOLVER_PARTITION = 'persist:douyin-resolver'

/** 窗口尺寸，给页面一个正常的桌面视口，避免被判定成异常环境 */
const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 900

/** 详情接口的响应里必须带的片段 */
const DETAIL_URL_PATTERN = /\/aweme\/v1\/web\/aweme\/detail\//

/** 拦截详情响应用的 URL 匹配式 */
const DETAIL_URL_PATTERN_CDP = '*aweme/v1/web/aweme/detail/*'

/** 抖音视频 CDN：解析只需要详情接口，媒体流一律拦掉 */
const MEDIA_URL_FILTERS = ['*://*.douyinvod.com/*']

/**
 * 允许页面导航到的协议
 * @remarks 抖音会往 `bytedance://disable_swipe` 这类自定义协议跳，Electron 会把它转交系统处理，
 * 于是 Windows 每次解析都弹一个"获取打开此链接的应用 / 浏览 Microsoft Store"的对话框。
 * 这里只放行常规网页协议，其余一律拦下
 */
const ALLOWED_PROTOCOLS = new Set([
  'http:',
  'https:',
  'about:',
  'blob:',
  'data:',
  'chrome:',
  'chrome-error:',
  'devtools:',
])

/** 已创建的抓取窗口 */
let resolverWindow: BrowserWindow | null = null

/** 建立窗口的进行中任务，避免并发解析重复开窗 */
let windowTask: Promise<BrowserWindow> | null = null

/** 串行执行解析，同一时刻只让一个页面在跑 */
let queueTail: Promise<unknown> = Promise.resolve()

/** 主窗口已关闭或应用正在退出：此后建起来的抓取窗口要立刻销毁，不能留在窗口列表里 */
let disposed = false

/** 当前等待中的解析请求 */
let pending: {
  /** 本次要解析的视频 ID，用于过滤不属于本次请求的详情响应 */
  awemeId: string
  /** 结束等待，抓到详情传详情，失败传 null */
  settle: (detail: RawDouyinAwemeDetail | null) => void
} | null = null

/**
 * 创建内置浏览器解析通道
 * @returns 可直接登记到服务层的解析函数
 */
export function createDouyinPageResolver(): DouyinPageResolver {
  // 主窗口（重新）打开时重新武装：上一次关闭主窗口留下的状态在这里复位
  disposed = false

  return (url: string): Promise<DouyinPageResult | null> => {
    const task = queueTail.then(
      () => runResolve(url),
      () => runResolve(url),
    )
    queueTail = task.catch(() => undefined)

    return task
  }
}

/**
 * 关闭抓取窗口（主窗口关闭或应用退出时调用）
 * @remarks 隐藏窗口同样计入 BrowserWindow 列表，不关掉的话主窗口关闭后应用不会退出
 */
export function disposeDouyinWindow(): void {
  disposed = true
  pending?.settle(null)
  pending = null

  destroyWindow(resolverWindow)
  resolverWindow = null
  windowTask = null
}

/**
 * 销毁窗口
 * @param win - 目标窗口，允许为 null
 */
function destroyWindow(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) {
    win.destroy()
  }
}

/**
 * 执行一次解析
 * @param url - 抖音链接，允许短链
 * @returns 抓到的详情，失败返回 null
 */
async function runResolve(url: string): Promise<DouyinPageResult | null> {
  const targetUrl = await resolveTargetUrl(url)
  if (!targetUrl) {
    logger.warn('douyin-window', '没能从链接里识别出抖音视频', { url })

    return null
  }

  const win = await ensureWindow()
  const detail = await loadAndCapture(win, targetUrl, extractAwemeId(targetUrl))
  if (!detail) {
    return null
  }

  return { detail, pageUrl: targetUrl }
}

/**
 * 把用户粘贴的链接换成视频页地址
 * @param url - 原始链接
 * @returns 视频页地址，识别失败返回空字符串
 * @remarks 短链（v.douyin.com）要先跟一次跳转才知道真正的视频 ID
 */
async function resolveTargetUrl(url: string): Promise<string> {
  const directId = extractAwemeId(url)
  if (directId) {
    return `${VIDEO_PAGE_TEMPLATE}${directId}`
  }

  try {
    const response = await fetch(url, { redirect: 'follow' })
    const finalUrl = response.url || url
    const followedId = extractAwemeId(finalUrl)

    return followedId ? `${VIDEO_PAGE_TEMPLATE}${followedId}` : ''
  } catch (error) {
    logger.warn('douyin-window', '短链跳转失败', { reason: (error as Error).message })

    return ''
  }
}

/**
 * 取得可用的抓取窗口，必要时创建并挂好调试域
 * @returns 窗口实例
 */
function ensureWindow(): Promise<BrowserWindow> {
  if (resolverWindow && !resolverWindow.isDestroyed()) {
    return Promise.resolve(resolverWindow)
  }

  if (!windowTask) {
    windowTask = createWindow().catch((error) => {
      windowTask = null
      throw error
    })
  }

  return windowTask
}

/**
 * 创建隐藏窗口并启用网络监听
 * @returns 准备就绪的窗口
 * @remarks 调试域必须在页面发出详情请求之前挂上，所以先加载空白页拿到 dom-ready，
 * 再开启拦截，最后才导航到视频页。
 * 这里用 Fetch 域把**响应暂停住**再读，而不是等 Network 的响应事件回来再回头去取：
 * 抖音页面每次会连发好几条详情请求，等事件到达时响应体往往已被渲染进程丢弃，
 * Network.getResponseBody 只会报 "No data found for resource with given identifier"，
 * 结果把所有响应都错过、白等到超时。响应被暂停时响应体一定还在，实测 100% 成功
 */
async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    title: '抖音解析窗口',
    webPreferences: {
      partition: RESOLVER_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  })
  // 页面一加载就会自动播放视频，Electron 默认允许出声，用户能直接听到；
  // 解析只关心详情接口，干脆把整个 webContents 静音
  win.webContents.setAudioMuted(true)
  // 静音之外再拦一层媒体流：整段视频白白拉一遍既费流量又占 CPU，
  // 详情接口在 douyin.com 域下，与媒体 CDN 互不影响
  win.webContents.session.webRequest.onBeforeRequest(
    { urls: MEDIA_URL_FILTERS },
    (_details, callback) => {
      callback({ cancel: true })
    },
  )
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // 主框架与子框架的导航都要拦：自定义协议的跳转既会弹系统对话框，也不是我们需要的流程
  win.webContents.on('will-frame-navigate', (details) => {
    blockExternalProtocol(details)
  })
  win.webContents.on('will-redirect', (details) => {
    blockExternalProtocol(details)
  })
  win.webContents.debugger.on('message', (_event, method, params) => {
    void handleDebuggerMessage(method, params)
  })
  win.on('closed', () => {
    resolverWindow = null
    windowTask = null
  })

  const ready = new Promise<void>((resolve, reject) => {
    win.webContents.once('dom-ready', () => {
      try {
        win.webContents.debugger.attach('1.3')
        win.webContents.debugger
          .sendCommand('Fetch.enable', {
            patterns: [{ urlPattern: DETAIL_URL_PATTERN_CDP, requestStage: 'Response' }],
          })
          .then(() => resolve())
          .catch(reject)
      } catch (error) {
        reject(error)
      }
    })
  })

  try {
    await win.loadURL('about:blank')
    await ready
  } catch (error) {
    // 建不起来就当场销毁：隐藏窗口留在窗口列表里会让 window-all-closed 永不触发，应用关不掉
    destroyWindow(win)
    throw error
  }

  if (disposed) {
    // 建窗口期间主窗口被关掉了（disposeDouyinWindow 已经跑过），这里不能再把它挂上去
    destroyWindow(win)
    throw new Error('主窗口已关闭，放弃本次抓取窗口')
  }

  resolverWindow = win
  logger.info('douyin-window', '抓取窗口已就绪', {
    audioMuted: win.webContents.isAudioMuted(),
    visible: win.isVisible(),
  })

  return win
}

/**
 * 拦下自定义协议导航
 * @param details - Electron 导航事件参数
 * @remarks 放行 http(s) 等常规协议，其余（bytedance、snssdk、douyin 等）直接阻止，
 * 否则 Windows 会弹出"选择打开方式"的系统对话框
 */
function blockExternalProtocol(details: {
  url: string
  preventDefault: () => void
}): void {
  let protocol = ''
  try {
    protocol = new URL(details.url).protocol
  } catch {
    // 解析不出协议的地址交给 Electron 自己处理，避免误拦
    return
  }

  if (ALLOWED_PROTOCOLS.has(protocol)) {
    return
  }

  details.preventDefault()
  logger.debug('douyin-window', '已拦截自定义协议跳转', { protocol })
}

/**
 * 处理调试域消息，命中详情响应时取回响应体并放行
 * @param method - 调试域方法名
 * @param params - 方法参数
 * @remarks 无论处理结果如何都必须放行响应，否则页面会一直卡在暂停状态
 */
async function handleDebuggerMessage(
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  if (method !== 'Fetch.requestPaused') {
    return
  }

  const requestId = params.requestId as string
  const request = params.request as { url?: string } | undefined
  const responseUrl = request?.url ?? ''
  if (!pending || !DETAIL_URL_PATTERN.test(responseUrl)) {
    await continuePausedResponse(requestId)

    return
  }

  const expectedId = pending.awemeId

  try {
    const body = (await resolverWindow?.webContents.debugger.sendCommand(
      'Fetch.getResponseBody',
      { requestId },
    )) as { body?: string; base64Encoded?: boolean } | undefined
    const text = body?.body
      ? body.base64Encoded
        ? Buffer.from(body.body, 'base64').toString('utf8')
        : body.body
      : ''
    const parsed = JSON.parse(text) as { aweme_detail?: RawDouyinAwemeDetail | null }
    if (!parsed.aweme_detail) {
      logger.debug('douyin-window', '这条详情响应里没有视频数据，继续等', { url: responseUrl })

      return
    }

    if (!isDetailForAweme(responseUrl, parsed.aweme_detail.aweme_id, expectedId)) {
      logger.warn('douyin-window', '详情响应与请求的视频不一致，已忽略', {
        expectedId,
        actualId: parsed.aweme_detail.aweme_id,
      })

      return
    }

    logger.info('douyin-window', '已抓到抖音详情', {
      formatCount: parsed.aweme_detail.video?.bit_rate?.length ?? 0,
    })
    finishResolve(parsed.aweme_detail)
  } catch (error) {
    logger.debug('douyin-window', '读取详情响应失败', {
      reason: (error as Error).message,
    })
  } finally {
    await continuePausedResponse(requestId)
  }
}

/**
 * 放行被 Fetch 域暂停的响应
 * @param requestId - 被暂停请求的 ID
 * @remarks 响应阶段暂停要用 continueResponse；旧内核不认这个命令时退回 continueRequest，
 * 两者都失败只记日志——留着页面卡住比丢一次解析更糟
 */
async function continuePausedResponse(requestId: string): Promise<void> {
  const debuggerApi = resolverWindow?.webContents.debugger
  if (!debuggerApi) {
    return
  }

  try {
    await debuggerApi.sendCommand('Fetch.continueResponse', { requestId })

    return
  } catch (error) {
    logger.debug('douyin-window', 'continueResponse 失败，改用 continueRequest', {
      reason: (error as Error).message,
    })
  }

  await debuggerApi.sendCommand('Fetch.continueRequest', { requestId }).catch((error: Error) => {
    logger.warn('douyin-window', '放行暂停的响应失败', { reason: error.message })
  })
}

/**
 * 导航到视频页并等待详情响应
 * @param win - 抓取窗口
 * @param targetUrl - 视频页地址
 * @param awemeId - 本次要解析的视频 ID
 * @returns 详情对象，超时或未抓到返回 null
 */
function loadAndCapture(
  win: BrowserWindow,
  targetUrl: string,
  awemeId: string,
): Promise<RawDouyinAwemeDetail | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      logger.warn('douyin-window', '等待抖音详情超时', { targetUrl })
      finishResolve(null)
    }, RESOLVE_TIMEOUT_MS)

    pending = {
      awemeId,
      settle: (detail) => {
        clearTimeout(timer)
        resolve(detail)
      },
    }
    win.loadURL(targetUrl).catch((error) => {
      logger.warn('douyin-window', '打开抖音视频页失败', {
        reason: (error as Error).message,
      })
      finishResolve(null)
    })
  })
}

/**
 * 结束当前等待中的解析
 * @param detail - 详情对象，失败传 null
 */
function finishResolve(detail: RawDouyinAwemeDetail | null): void {
  const current = pending
  pending = null
  current?.settle(detail)
}
