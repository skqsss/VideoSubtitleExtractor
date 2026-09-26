/**
 * @file 外部二进制（yt-dlp / ffmpeg）探测与更新
 * @author Codex
 * @description 负责自检版本与更新 yt-dlp；打包态下这些操作作用于 userData 中的可写副本
 * @date 2026-09-26
 */

import { createWriteStream } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { AppConfig, HealthResult } from '../shared/types.ts'
import { ensureDownloadDir, resolveFfmpegDir, resolveYtdlpPath } from './config.ts'
import { logger } from './logger.ts'
import { runCommand } from './process-runner.ts'

/** 版本探测超时：正常在 1 秒内返回 */
const VERSION_TIMEOUT_MS = 15_000

/** yt-dlp 官方最新版下载地址 */
const YTDLP_LATEST_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'

/** ffmpeg shared 构建必须整目录携带，合并音视频时缺 dll 会直接失败 */
const REQUIRED_FFMPEG_FILES = ['ffmpeg.exe', 'ffprobe.exe']

/**
 * 读取 yt-dlp 版本号
 * @param ytdlpPath - 可执行文件路径
 * @returns 版本号，失败时返回空字符串
 */
async function readYtdlpVersion(ytdlpPath: string): Promise<string> {
  try {
    const result = await runCommand(ytdlpPath, ['--version'], {
      timeoutMs: VERSION_TIMEOUT_MS,
    })

    return result.code === 0 ? result.stdout.trim() : ''
  } catch (error) {
    logger.warn('binary-service', '读取 yt-dlp 版本失败', {
      reason: (error as Error).message,
    })

    return ''
  }
}

/**
 * 读取 ffmpeg 版本号
 * @param ffmpegDir - ffmpeg 目录
 * @returns 版本首行，失败时返回空字符串
 */
async function readFfmpegVersion(ffmpegDir: string): Promise<string> {
  try {
    const result = await runCommand(path.join(ffmpegDir, 'ffmpeg.exe'), ['-version'], {
      timeoutMs: VERSION_TIMEOUT_MS,
    })

    if (result.code !== 0) {
      return ''
    }

    return result.stdout.split('\n')[0]?.trim() ?? ''
  } catch (error) {
    logger.warn('binary-service', '读取 ffmpeg 版本失败', {
      reason: (error as Error).message,
    })

    return ''
  }
}

/**
 * 自检外部依赖与下载目录
 * @param config - 应用配置
 * @returns 自检结果，ok 为 false 时 message 给出中文修复指引
 */
export async function checkHealth(config: AppConfig): Promise<HealthResult> {
  const ytdlpPath = resolveYtdlpPath(config)
  const ffmpegDir = resolveFfmpegDir(config)
  const downloadDir = ensureDownloadDir(config)
  const hasYtdlp = fs.existsSync(ytdlpPath)
  /** ffmpeg 的 dll 与 exe 必须同目录，缺任何一个都视为不可用 */
  const hasFfmpeg = REQUIRED_FFMPEG_FILES.every((file) =>
    fs.existsSync(path.join(ffmpegDir, file)),
  )

  const ytdlpVersion = hasYtdlp ? await readYtdlpVersion(ytdlpPath) : ''
  const ffmpegVersion = hasFfmpeg ? await readFfmpegVersion(ffmpegDir) : ''
  const problems: string[] = []

  if (!hasYtdlp) {
    problems.push(
      `未找到 yt-dlp：${ytdlpPath}。请把 yt-dlp.exe 放到 bin 目录，或点击"更新 yt-dlp"。`,
    )
  } else if (!ytdlpVersion) {
    problems.push(`yt-dlp 无法执行：${ytdlpPath}，请确认文件完整。`)
  }

  if (!hasFfmpeg) {
    problems.push(
      `未找到 ffmpeg：${ffmpegDir}，请把整个 bin 目录复制过来（shared 版含 dll）。`,
    )
  } else if (!ffmpegVersion) {
    problems.push(`ffmpeg 无法执行：${ffmpegDir}，请确认 dll 与 exe 在同一目录。`)
  }

  return {
    ok: problems.length === 0,
    ytdlp: { path: ytdlpPath, version: ytdlpVersion, exists: hasYtdlp },
    ffmpeg: { dir: ffmpegDir, version: ffmpegVersion, exists: hasFfmpeg },
    downloadDir,
    message: problems.join(' '),
  }
}

/**
 * 下载最新版 yt-dlp 并覆盖本地副本
 * @param config - 应用配置
 * @returns 更新后的版本号
 * @throws Error 下载或替换失败时抛出，错误信息为中文
 * @remarks 先写临时文件再重命名，避免下载中断毁掉当前可用副本
 */
export async function updateYtdlp(config: AppConfig): Promise<string> {
  const ytdlpPath = resolveYtdlpPath(config)
  const tempPath = `${ytdlpPath}.download`
  fs.mkdirSync(path.dirname(ytdlpPath), { recursive: true })

  logger.info('binary-service', '开始下载最新版 yt-dlp')

  let response: Response
  try {
    response = await fetch(YTDLP_LATEST_URL, { redirect: 'follow' })
  } catch (error) {
    throw new Error(`下载 yt-dlp 失败，请检查网络或代理：${(error as Error).message}`)
  }

  if (!response.ok || !response.body) {
    throw new Error(`下载 yt-dlp 失败，HTTP 状态码 ${response.status}`)
  }

  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath))
    fs.renameSync(tempPath, ytdlpPath)
  } catch (error) {
    fs.rmSync(tempPath, { force: true })
    throw new Error(`写入 yt-dlp 失败：${(error as Error).message}`)
  }

  const version = await readYtdlpVersion(ytdlpPath)
  if (!version) {
    throw new Error('更新后无法执行 yt-dlp，请手动重新下载 yt-dlp.exe')
  }

  logger.info('binary-service', 'yt-dlp 更新完成', { version })

  return version
}
