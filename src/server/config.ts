/**
 * @file 配置读写
 * @author Codex
 * @description 网页版配置存项目根 config.json，相对路径统一按项目根解析
 * @date 2026-09-26
 */

import fs from 'node:fs'
import path from 'node:path'

import type { AppConfig, CookieBrowser } from '../shared/types.ts'
import { logger } from './logger.ts'

/** 项目根目录（src/server 的上两级） */
export const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..')

/** 配置文件路径 */
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config.json')

/** 允许的 Cookie 浏览器取值 */
const COOKIE_BROWSERS: CookieBrowser[] = [
  'none',
  'edge',
  'chrome',
  'chromium',
  'firefox',
  'brave',
  'opera',
  'vivaldi',
  'whale',
]

/** 端口合法区间 */
const PORT_MIN = 1024
const PORT_MAX = 65535

/** 并发数合法区间 */
const CONCURRENCY_MIN = 1
const CONCURRENCY_MAX = 4

/** 默认配置 */
export const DEFAULT_CONFIG: AppConfig = {
  port: 8787,
  ytdlpPath: 'bin/yt-dlp.exe',
  ffmpegDir: 'bin/ffmpeg',
  downloadDir: 'D:\\video-workspace\\downloads',
  cookieBrowser: 'edge',
  cookiesFile: '',
  proxy: '',
  concurrency: 1,
}

/**
 * 读取配置文件，不存在时写入默认值
 * @returns 合并默认值后的配置
 * @remarks 文件损坏或字段非法时回退默认值，保证服务能启动
 */
export function loadConfig(): AppConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    writeConfigFile(DEFAULT_CONFIG)
    logger.info('config', '未找到配置文件，已生成默认配置', { path: CONFIG_PATH })

    return { ...DEFAULT_CONFIG }
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>

    return sanitizeConfig({ ...DEFAULT_CONFIG, ...parsed })
  } catch (error) {
    logger.warn('config', '配置文件解析失败，回退默认配置', {
      path: CONFIG_PATH,
      reason: (error as Error).message,
    })

    return { ...DEFAULT_CONFIG }
  }
}

/**
 * 保存配置（部分更新）
 * @param patch - 需要修改的字段
 * @returns 保存后的完整配置
 * @throws Error 字段取值非法时抛出，错误信息为中文
 */
export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const merged = sanitizeConfig({ ...loadConfig(), ...patch })
  writeConfigFile(merged)
  logger.info('config', '配置已更新', {
    downloadDir: merged.downloadDir,
    cookieBrowser: merged.cookieBrowser,
    hasProxy: merged.proxy.length > 0,
  })

  return merged
}

/**
 * 写入配置文件
 * @param config - 完整配置
 */
function writeConfigFile(config: AppConfig): void {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

/**
 * 校验配置字段
 * @param config - 待校验配置
 * @returns 合法配置
 * @throws Error 端口、并发数、Cookie 浏览器或代理不合法时抛出
 */
function sanitizeConfig(config: AppConfig): AppConfig {
  if (!Number.isInteger(config.port) || config.port < PORT_MIN || config.port > PORT_MAX) {
    throw new Error(`端口需为 ${PORT_MIN}~${PORT_MAX} 之间的整数`)
  }

  if (
    !Number.isInteger(config.concurrency) ||
    config.concurrency < CONCURRENCY_MIN ||
    config.concurrency > CONCURRENCY_MAX
  ) {
    throw new Error(`并发数需为 ${CONCURRENCY_MIN}~${CONCURRENCY_MAX} 之间的整数`)
  }

  if (!COOKIE_BROWSERS.includes(config.cookieBrowser)) {
    throw new Error('Cookie 浏览器取值不合法')
  }

  if (config.proxy && !/^https?:\/\/.+/.test(config.proxy)) {
    throw new Error('代理地址需以 http:// 或 https:// 开头')
  }

  return config
}

/**
 * 把配置中的路径解析为绝对路径
 * @param target - 配置里的路径
 * @returns 绝对路径
 */
export function resolveProjectPath(target: string): string {
  return path.isAbsolute(target) ? path.normalize(target) : path.join(PROJECT_ROOT, target)
}

/**
 * 解析 yt-dlp 可执行文件路径
 * @param config - 配置
 * @returns 绝对路径
 */
export function resolveYtdlpPath(config: AppConfig): string {
  return resolveProjectPath(config.ytdlpPath)
}

/**
 * 解析 ffmpeg 目录路径
 * @param config - 配置
 * @returns 绝对路径
 */
export function resolveFfmpegDir(config: AppConfig): string {
  return resolveProjectPath(config.ffmpegDir)
}

/**
 * 解析 cookies.txt 路径
 * @param config - 配置
 * @returns 绝对路径，未配置时返回空字符串
 */
export function resolveCookiesFile(config: AppConfig): string {
  return config.cookiesFile ? resolveProjectPath(config.cookiesFile) : ''
}

/**
 * 解析下载目录并确保目录存在
 * @param config - 配置
 * @returns 绝对路径
 */
export function ensureDownloadDir(config: AppConfig): string {
  const downloadDir = resolveProjectPath(config.downloadDir)
  fs.mkdirSync(downloadDir, { recursive: true })

  return downloadDir
}
