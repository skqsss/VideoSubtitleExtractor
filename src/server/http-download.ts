/**
 * @file 带超时与断流重试的文件下载
 * @author sqksss
 * @description 应用自身要下载的外部文件（目前只有 yt-dlp）统一走这里：
 * 打包态用 Electron 的网络栈，自动跟随系统代理；每次尝试都有空闲超时与总时长上限，
 * 失败时给出中文原因，避免出现"一直显示更新中、既不报错也不结束"的情况
 * @date 2026-10-01
 */

import fs from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** 单次尝试内多久没有新数据就判定断流 */
const DEFAULT_IDLE_TIMEOUT_MS = 30_000

/**
 * 单次尝试的总时长上限
 * @remarks 兜底用，防止"一直慢速吐数据但永远下不完"；判断断流主要靠空闲超时，
 * 所以这里给得宽一些，免得把慢速但正常的下载掐掉
 */
const DEFAULT_TOTAL_TIMEOUT_MS = 600_000

/** 默认尝试次数：GitHub 直连偶发断流，重试通常就能成 */
const DEFAULT_ATTEMPTS = 3

/** 下载选项 */
export interface DownloadOptions {
  /** 下载地址 */
  url: string
  /** 落盘路径（调用方负责用临时文件，成功后再改名） */
  targetPath: string
  /** 使用的 fetch 实现，缺省时由 resolveDownloadChannel 决定 */
  fetchImpl?: typeof globalThis.fetch
  /** 多久没有新数据判定断流 */
  idleTimeoutMs?: number
  /** 单次尝试总时长上限 */
  totalTimeoutMs?: number
  /** 最多尝试次数（含首次） */
  attempts?: number
}

/** 下载结果 */
export interface DownloadResult {
  /** 实际写入的字节数 */
  bytes: number
  /** 实际尝试次数 */
  attempts: number
}

/** 下载通道：fetch 实现与中文描述 */
export interface DownloadChannel {
  fetchImpl: typeof globalThis.fetch
  /** 用于日志与报错的通道说明 */
  via: string
}

/** 不可重试的下载错误（例如 404） */
class FatalDownloadError extends Error {}

/**
 * 选择本次下载使用的网络通道
 * @returns fetch 实现与通道说明
 * @remarks 打包态必须用 Electron 的 net.fetch：它走 Chromium 网络栈，会自动使用系统代理
 * （Clash 等"系统代理"模式就是这样生效的）；脱离 Electron 的纯 Node 环境只能直连，
 * 这一点会写进报错信息里，免得用户以为是自己没开代理
 */
export async function resolveDownloadChannel(): Promise<DownloadChannel> {
  if (process.versions.electron) {
    try {
      const electron = await import('electron')
      const electronNet = (electron as { net?: { fetch?: typeof globalThis.fetch } }).net
      if (typeof electronNet?.fetch === 'function') {
        return {
          fetchImpl: electronNet.fetch.bind(electronNet) as typeof globalThis.fetch,
          via: 'Electron 网络栈（自动跟随系统代理）',
        }
      }
    } catch {
      // 拿不到 electron 时按直连处理即可，下面会给出对应说明
    }
  }

  return { fetchImpl: globalThis.fetch, via: 'Node 直连（不经过系统代理）' }
}

/**
 * 下载文件到本地
 * @param options - 下载选项
 * @returns 实际字节数与尝试次数
 * @throws Error 全部尝试都失败时抛出，message 为可读的中文原因
 */
export async function downloadFile(options: DownloadOptions): Promise<DownloadResult> {
  const fetchImpl = options.fetchImpl ?? (await resolveDownloadChannel()).fetchImpl
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS)
  const idleText = formatDuration(idleTimeoutMs)
  const totalText = formatDuration(totalTimeoutMs)
  let lastReason = '未知错误'

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // 上一轮的半截文件必须清掉，否则续写会得到损坏的二进制
    fs.rmSync(options.targetPath, { force: true })

    const controller = new AbortController()
    let timeoutReason = ''
    let idleTimer: NodeJS.Timeout | undefined
    const armIdleTimer = (): void => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        timeoutReason = `下载中断（${idleText}没有收到数据）`
        controller.abort()
      }, idleTimeoutMs)
    }
    const totalTimer = setTimeout(() => {
      timeoutReason = `下载超时（单次超过 ${totalText}）`
      controller.abort()
    }, totalTimeoutMs)

    try {
      const response = await fetchImpl(options.url, {
        redirect: 'follow',
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const message = `下载地址返回 HTTP ${response.status}`
        // 4xx 是确定性失败（例如该版本没有发布对应文件），重试没有意义
        if (response.status >= 400 && response.status < 500) {
          throw new FatalDownloadError(message)
        }

        throw new Error(message)
      }

      let bytes = 0
      const watchdog = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length
          armIdleTimer()
          callback(null, chunk)
        },
      })

      armIdleTimer()
      await pipeline(
        Readable.fromWeb(response.body),
        watchdog,
        fs.createWriteStream(options.targetPath),
      )

      return { bytes, attempts: attempt }
    } catch (error) {
      fs.rmSync(options.targetPath, { force: true })

      if (error instanceof FatalDownloadError) {
        throw error
      }

      lastReason = timeoutReason || describeDownloadError(error)
    } finally {
      clearTimeout(idleTimer)
      clearTimeout(totalTimer)
    }
  }

  throw new Error(`已尝试 ${attempts} 次仍未成功：${lastReason}`)
}

/**
 * 把下载过程中的异常转成可读原因
 * @param error - 捕获到的异常
 * @returns 中文原因
 */
function describeDownloadError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }

  // Node 的 fetch 在网络不可达时只给一句 "fetch failed"，需要往下挖一层才有用
  const cause = (error as { cause?: unknown }).cause
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    return `${error.message}（${cause.message}）`
  }

  return error.message || '未知错误'
}

/**
 * 把毫秒时长写成中文
 * @param ms - 毫秒数
 * @returns 如 `30 秒`、`1 分 30 秒`、`10 分钟`
 */
function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) {
    return `${seconds} 秒`
  }

  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60

  return rest === 0 ? `${minutes} 分钟` : `${minutes} 分 ${rest} 秒`
}
