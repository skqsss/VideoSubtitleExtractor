/**
 * @file 配置读写
 * @author sqksss
 * @description 配置文件与下载目录都放在 userData 下；
 * 根目录、配置文件路径与默认值都由 Electron 主进程覆盖，其他层不感知运行形态
 * @date 2026-09-26
 */

import fs from 'node:fs'
import path from 'node:path'

import type { AppConfig, CookieBrowser } from '../shared/types.ts'
import { logger } from './logger.ts'

/** 项目根目录：开发态按源码位置推导，打包态由主进程覆盖成应用目录 */
let projectRoot = path.resolve(import.meta.dirname, '..', '..')

/** 配置文件路径：默认在项目根，桌面版启动时由主进程改到 userData */
let configPath = path.join(projectRoot, 'config.json')

/** 可写数据目录：存放合并后的 Cookie 等运行时产物（打包态不在只读的 asar 里） */
let dataDir = projectRoot

/** 打包态由主进程写入的默认值补丁（二进制路径、下载目录等） */
let defaultConfigPatch: Partial<AppConfig> = {}

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

/** 并发数合法区间 */
const CONCURRENCY_MIN = 1
const CONCURRENCY_MAX = 4

/** 默认配置 */
export const DEFAULT_CONFIG: AppConfig = {
  ytdlpPath: 'bin/yt-dlp.exe',
  ffmpegDir: 'bin/ffmpeg',
  downloadDir: 'D:\\video-workspace\\downloads',
  cookieBrowser: 'edge',
  cookiesFile: '',
  proxy: '',
  concurrency: 1,
}

/**
 * 覆盖项目根目录
 * @param dir - 新的根目录（打包态为 asar 所在的应用目录）
 */
export function setProjectRoot(dir: string): void {
  projectRoot = dir
  configPath = path.join(dir, 'config.json')
}

/**
 * 覆盖配置文件路径
 * @param file - 配置文件绝对路径（桌面版指向 userData）
 */
export function setConfigPath(file: string): void {
  configPath = file
}

/**
 * 覆盖可写数据目录
 * @param dir - 目录绝对路径（桌面版指向 userData）
 */
export function setDataDir(dir: string): void {
  dataDir = dir
}

/**
 * 读取可写数据目录
 * @returns 当前生效的数据目录
 */
export function getDataDir(): string {
  return dataDir
}

/**
 * 写入默认配置补丁
 * @param patch - 需要覆盖的默认字段，例如打包后二进制的绝对路径
 * @remarks 只在首次生成 config.json 时生效，已有配置不会被改写
 */
export function setDefaultConfigPatch(patch: Partial<AppConfig>): void {
  defaultConfigPatch = { ...defaultConfigPatch, ...patch }
}

/**
 * 读取项目根目录
 * @returns 当前生效的根目录
 */
export function getProjectRoot(): string {
  return projectRoot
}

/**
 * 读取生效的默认配置
 * @returns 合并了补丁的默认配置
 */
function getDefaultConfig(): AppConfig {
  return { ...DEFAULT_CONFIG, ...defaultConfigPatch }
}

/**
 * 读取配置文件，不存在时写入默认值
 * @returns 合并默认值后的配置
 * @remarks 文件损坏或字段非法时回退默认值，保证服务能启动
 */
export function loadConfig(): AppConfig {
  const fallback = getDefaultConfig()

  if (!fs.existsSync(configPath)) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    writeConfigFile(fallback)
    logger.info('config', '未找到配置文件，已生成默认配置', { path: configPath })

    return { ...fallback }
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>

    return sanitizeConfig({ ...fallback, ...parsed })
  } catch (error) {
    logger.warn('config', '配置文件解析失败，回退默认配置', {
      path: configPath,
      reason: (error as Error).message,
    })

    return { ...fallback }
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
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

/**
 * 校验配置字段
 * @param config - 待校验配置
 * @returns 合法配置
 * @throws Error 并发数、Cookie 浏览器或代理不合法时抛出
 */
function sanitizeConfig(config: AppConfig): AppConfig {
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
  return path.isAbsolute(target) ? path.normalize(target) : path.join(projectRoot, target)
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
 * 解析下载目录并确保目录存在
 * @param config - 配置
 * @returns 绝对路径
 */
export function ensureDownloadDir(config: AppConfig): string {
  const downloadDir = resolveProjectPath(config.downloadDir)
  fs.mkdirSync(downloadDir, { recursive: true })

  return downloadDir
}
