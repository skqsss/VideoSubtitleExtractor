/**
 * @file yt-dlp 解析服务
 * @author Codex
 * @description 调用 yt-dlp -J 解析链接并把结果归一化，同时缓存解析结果供下载时复用
 * @date 2026-09-26
 */

import path from 'node:path'
import fs from 'node:fs'

import {
  mapYtdlpError,
  shouldRetryWithoutCookies,
  type MappedYtdlpError,
  type YtdlpErrorCode,
} from '../shared/error-mapper.ts'
import { normalizeProbeInfo, type RawYtdlpInfo } from '../shared/format-utils.ts'
import { extractVideoUrl } from '../shared/url-utils.ts'
import type {
  AppConfig,
  DownloadMode,
  ProbeParams,
  ProbeResult,
  VideoFormat,
} from '../shared/types.ts'
import { resolveCookiesFile, resolveYtdlpPath } from './config.ts'
import { logger } from './logger.ts'
import { runCommand } from './process-runner.ts'

/** 解析超时：直播间等特殊页面可能较慢 */
const PROBE_TIMEOUT_MS = 120_000

/** 解析结果缓存上限，够覆盖"解析若干条再逐条下载"的用法 */
const PROBE_CACHE_LIMIT = 20

/**
 * 进度行前缀
 * @remarks yt-dlp 的 `--progress-template` 里 `download:` 只是类型选择器、不会出现在输出中，
 * 因此把标记写进模板正文，解析时才有稳定的行首标识
 */
export const PROGRESS_LINE_MARKER = 'VFPROGRESS:'

/** 带错误码的业务异常，HTTP 层据此返回 { error: { code, message } } */
export class YtdlpError extends Error {
  readonly code: YtdlpErrorCode

  /**
   * @param code - 错误码，供前端分支判断
   * @param message - 中文提示
   */
  constructor(code: YtdlpErrorCode, message: string) {
    super(message)
    this.name = 'YtdlpError'
    this.code = code
  }
}

/** 最近一次解析结果缓存：key 为链接，value 为归一化后的结果 */
const probeCache = new Map<string, ProbeResult>()

/**
 * 校验链接是否为 http/https
 * @param url - 用户输入的链接，允许是"标题 + 链接 + 说明"的整段分享文案
 * @returns 规范化后的链接
 * @throws YtdlpError 链接不合法时抛出
 * @remarks 先按分享文案抠出链接，再校验协议，前端是否预处理都不影响结果
 */
export function normalizeVideoUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) {
    throw new YtdlpError('UNSUPPORTED_URL', '请先粘贴视频链接。')
  }

  const extracted = extractVideoUrl(trimmed)
  if (!extracted) {
    throw new YtdlpError('UNSUPPORTED_URL', '这段内容里没找到链接，请粘贴视频详情页的完整网址。')
  }

  let parsed: URL
  try {
    parsed = new URL(extracted)
  } catch {
    throw new YtdlpError('UNSUPPORTED_URL', '这不是一个合法链接，请粘贴视频详情页的完整网址。')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new YtdlpError('UNSUPPORTED_URL', '只支持 http/https 链接。')
  }

  return parsed.toString()
}

/**
 * 组装解析与下载共用的参数
 * @param cookieBrowser - Cookie 浏览器，none 或空表示不读取
 * @param proxy - 代理地址，空字符串表示直连
 * @param cookiesFile - cookies.txt 绝对路径，空字符串表示不使用
 * @returns yt-dlp 公共参数数组
 * @remarks Cookie 与代理只以数组项传递，不做任何字符串拼接
 */
export function buildCommonArgs(
  cookieBrowser: string,
  proxy: string,
  cookiesFile = '',
): string[] {
  const args = ['--no-playlist']

  if (cookieBrowser && cookieBrowser !== 'none') {
    args.push('--cookies-from-browser', cookieBrowser)
  }

  if (cookiesFile) {
    args.push('--cookies', cookiesFile)
  }

  if (proxy) {
    args.push('--proxy', proxy)
  }

  // 中文环境下 yt-dlp 默认按 GBK 输出标题与路径，强制 UTF-8 才不会出现乱码路径
  args.push('--encoding', 'utf-8')

  return args
}

/**
 * 校验 cookies.txt 是否存在
 * @param cookiesFile - cookies.txt 绝对路径，空字符串表示未配置
 * @throws YtdlpError 配置了路径但文件不存在时抛出
 * @remarks 提前失败，避免把"文件不存在"混进一堆 yt-dlp 报错里
 */
export function assertCookiesFileExists(cookiesFile: string): void {
  if (cookiesFile && !fs.existsSync(cookiesFile)) {
    throw new YtdlpError(
      'COOKIE_FILE_MISSING',
      `设置的 cookies.txt 不存在：${cookiesFile}，请在设置里重新指定或清空该项。`,
    )
  }
}

/**
 * 构造 yt-dlp 的运行环境
 * @returns 打开 Python UTF-8 模式后的环境变量
 * @remarks Windows 中文环境下 yt-dlp 默认按 GBK 输出，中文标题会变成乱码，
 * 因此在进程级强制 UTF-8，保证标题、路径与进度文本都能被正确解析
 */
export function buildYtdlpEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
}

/**
 * 解析视频链接
 * @param params - 解析参数
 * @param config - 应用配置
 * @returns 归一化后的解析结果
 * @throws YtdlpError yt-dlp 执行失败时抛出，message 为中文提示
 */
export async function probeVideo(
  params: ProbeParams,
  config: AppConfig,
): Promise<ProbeResult> {
  const url = normalizeVideoUrl(params.url)
  const ytdlpPath = resolveYtdlpPath(config)
  const cookieBrowser = params.cookieBrowser ?? config.cookieBrowser
  const proxy = params.proxy ?? config.proxy
  const cookiesFile = params.cookiesFile ?? resolveCookiesFile(config)
  assertCookiesFileExists(cookiesFile)

  logger.info('ytdlp-service', '开始解析链接', {
    host: new URL(url).host,
    hasCookie: cookieBrowser !== 'none',
    hasProxy: Boolean(proxy),
  })

  const firstTry = await runProbe(ytdlpPath, url, { cookieBrowser, proxy, cookiesFile })

  // 浏览器 Cookie 解密失败是环境问题（Chrome/Edge 新版加密），不该让解析整体失败：
  // 退回未登录状态再试一次，清晰度可能受限，但在界面上给出明确提示
  if (
    firstTry.error &&
    cookieBrowser !== 'none' &&
    shouldRetryWithoutCookies(firstTry.error.code, firstTry.output)
  ) {
    logger.warn('ytdlp-service', '读取浏览器 Cookie 失败，改为未登录解析', {
      cookieBrowser,
      code: firstTry.error.code,
    })

    const retry = await runProbe(ytdlpPath, url, {
      cookieBrowser: 'none',
      proxy,
      cookiesFile,
    })
    if (retry.error) {
      throw new YtdlpError(retry.error.code, retry.error.message)
    }

    return buildProbeResult(retry.info as RawYtdlpInfo, url, firstTry.error.message)
  }

  if (firstTry.error) {
    throw new YtdlpError(firstTry.error.code, firstTry.error.message)
  }

  return buildProbeResult(firstTry.info as RawYtdlpInfo, url, '')
}

/**
 * 执行一次解析
 * @param ytdlpPath - yt-dlp 可执行文件路径
 * @param url - 视频链接
 * @param options - Cookie 浏览器、代理与 cookies.txt
 * @returns 解析出的原始 info 或错误
 */
async function runProbe(
  ytdlpPath: string,
  url: string,
  options: { cookieBrowser: string; proxy: string; cookiesFile: string },
): Promise<{ info?: RawYtdlpInfo; error?: MappedYtdlpError; output: string }> {
  const args = [
    '-J',
    '--no-warnings',
    ...buildCommonArgs(options.cookieBrowser, options.proxy, options.cookiesFile),
    url,
  ]
  const result = await runCommand(ytdlpPath, args, {
    timeoutMs: PROBE_TIMEOUT_MS,
    env: buildYtdlpEnv(),
  })

  if (result.timedOut) {
    return {
      output: result.stderr,
      error: { code: 'NETWORK', message: '解析超时（超过 120 秒）。请检查网络或代理后重试。' },
    }
  }

  const output = `${result.stderr}\n${result.stdout}`
  if (result.code !== 0) {
    const mapped = mapYtdlpError(output, result.code, 'probe')
    logger.warn('ytdlp-service', '解析未成功', { code: mapped.code })

    return { output, error: mapped }
  }

  try {
    return { output, info: JSON.parse(result.stdout) as RawYtdlpInfo }
  } catch {
    return {
      output,
      error: { code: 'UNKNOWN', message: 'yt-dlp 返回的内容无法识别，请更新 yt-dlp 后重试。' },
    }
  }
}

/**
 * 把原始 info 归一化为解析结果并写入缓存
 * @param rawInfo - yt-dlp 原始 JSON
 * @param url - 实际解析的链接
 * @param warning - 降级提示
 * @returns 解析结果
 * @throws YtdlpError 没有可用档位时抛出
 */
function buildProbeResult(
  rawInfo: RawYtdlpInfo,
  url: string,
  warning: string,
): ProbeResult {
  const normalized = normalizeProbeInfo(rawInfo)
  if (normalized.formats.length === 0) {
    throw new YtdlpError('FORMAT_UNAVAILABLE', '没有解析到可下载的档位，请确认链接可正常播放。')
  }

  const probeResult: ProbeResult = {
    url,
    title: normalized.title,
    uploader: normalized.uploader,
    duration: normalized.duration,
    thumbnail: normalized.thumbnail,
    formats: normalized.formats,
    audioFormats: normalized.audioFormats,
    hasVideoOnly: normalized.hasVideoOnly,
    warning,
    probedAt: Date.now(),
  }
  rememberProbe(probeResult)

  logger.info('ytdlp-service', '解析完成', {
    title: probeResult.title,
    formatCount: probeResult.formats.length,
    audioCount: probeResult.audioFormats.length,
  })

  return probeResult
}

/**
 * 缓存解析结果
 * @param result - 解析结果
 */
function rememberProbe(result: ProbeResult): void {
  if (probeCache.size >= PROBE_CACHE_LIMIT) {
    const oldestKey = probeCache.keys().next().value
    if (oldestKey) {
      probeCache.delete(oldestKey)
    }
  }

  probeCache.set(result.url, result)
}

/**
 * 读取缓存的解析结果
 * @param url - 链接（内部会做规范化）
 * @returns 命中时返回解析结果，否则返回 undefined
 */
export function getCachedProbe(url: string): ProbeResult | undefined {
  try {
    return probeCache.get(normalizeVideoUrl(url))
  } catch {
    return undefined
  }
}

/**
 * 从缓存中查找指定档位
 * @param url - 链接
 * @param formatId - 档位 ID
 * @returns 命中的档位，未命中返回 undefined
 */
export function findCachedFormat(url: string, formatId: string): VideoFormat | undefined {
  const cached = getCachedProbe(url)
  if (!cached) {
    return undefined
  }

  return [...cached.formats, ...cached.audioFormats].find(
    (item) => item.formatId === formatId,
  )
}

/**
 * 生成下载用的输出模板
 * @param downloadDir - 下载目录
 * @param mode - 下载模式
 * @returns -P 与 -o 两个参数片段
 * @remarks 视频档位在文件名里带上宽×高：同一个视频换档重下时，yt-dlp 默认会判定
 * 旧文件"已下载"而复用，导致选了 1080P 却拿到先前的 360P 文件。
 * 竖屏视频的高度大于宽度，因此用宽×高而不是只用高度，避免出现"[1920p]"这种反直觉命名
 */
export function buildOutputArgs(downloadDir: string, mode: DownloadMode): string[] {
  const template =
    mode === 'audio-mp3'
      ? '%(title)s.%(ext)s'
      : '%(title)s [%(width)sx%(height)s].%(ext)s'

  return ['-P', downloadDir, '-o', template, '--windows-filenames']
}

/**
 * 生成下载时的进度模板参数
 * @returns --newline 与 --progress-template 参数片段
 */
export function buildProgressArgs(): string[] {
  const template =
    `download:${PROGRESS_LINE_MARKER}` +
    '{"p":"%(progress._percent_str)s","sp":"%(progress._speed_str)s",' +
    '"eta":"%(progress._eta_str)s","dl":"%(progress.downloaded_bytes)s",' +
    '"total":"%(progress.total_bytes)s","totalEst":"%(progress.total_bytes_estimate)s"}'

  return ['--newline', '--progress-template', template]
}

/**
 * 生成 ffmpeg 定位参数
 * @param ffmpegDir - ffmpeg 目录
 * @returns --ffmpeg-location 参数片段
 * @remarks 打包后 PATH 中没有 ffmpeg，必须显式传入，否则合并音视频会失败
 */
export function buildFfmpegArgs(ffmpegDir: string): string[] {
  return ['--ffmpeg-location', ffmpegDir]
}

/**
 * 依据产物路径推断任务标题
 * @param outputPath - 产物绝对路径
 * @returns 不带扩展名的标题
 */
export function inferTitleFromPath(outputPath: string): string {
  if (!outputPath) {
    return ''
  }

  return path.basename(outputPath, path.extname(outputPath))
}
