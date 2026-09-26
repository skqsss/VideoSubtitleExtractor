/**
 * @file Cookie 文件准备与自检
 * @author Codex
 * @description 把配置里的一个或多个 cookies.txt（或目录）合并成单个文件交给 yt-dlp，
 * 这样 B 站与抖音可以各导出一份、一起生效，且用户原始导出文件不会被 yt-dlp 回写污染
 * @date 2026-09-26
 */

import fs from 'node:fs'
import path from 'node:path'

import { mergeCookieContents, type CookieSummary } from '../shared/cookie-utils.ts'
import type { CookieInspectResult } from '../shared/types.ts'
import { PROJECT_ROOT, resolveProjectPath } from './config.ts'
import { logger } from './logger.ts'

/** 合并结果缓存目录（与配置、下载目录分开，避免混进用户文件） */
const CACHE_DIR = path.join(PROJECT_ROOT, 'cache')

/** 合并后的临时 Cookie 文件路径，只在本机使用 */
const MERGED_COOKIE_PATH = path.join(CACHE_DIR, 'yt-dlp-cookies.txt')

/** 目录形式的配置里认这几种扩展名：Netscape 文本与扩展导出的 JSON */
const COOKIE_FILE_EXTENSIONS = ['.txt', '.json']

/**
 * 把配置值展开成实际存在的 Cookie 文件列表
 * @param cookiesFile - 配置里的值，可以是文件、目录，或用分号/换行分隔的多个路径
 * @returns 绝对路径列表，未配置时返回空数组
 * @remarks 目录会展开成其中的 .txt 文件，便于「一个文件夹放 B 站和抖音两份导出」
 */
export function resolveCookiesFiles(cookiesFile: string): string[] {
  const entries = cookiesFile
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
  const files: string[] = []

  for (const entry of entries) {
    const target = resolveProjectPath(entry)
    if (!fs.existsSync(target)) {
      // 不存在的路径先原样保留，由断言环节给出明确中文提示
      files.push(target)
      continue
    }

    if (fs.statSync(target).isDirectory()) {
      const inside = fs
        .readdirSync(target)
        .filter((name) => COOKIE_FILE_EXTENSIONS.includes(path.extname(name).toLowerCase()))
        .sort()
        .map((name) => path.join(target, name))
      files.push(...inside)
      continue
    }

    files.push(target)
  }

  return [...new Set(files)]
}

/**
 * 校验 Cookie 文件是否都存在
 * @param files - 文件绝对路径列表
 * @throws Error 有路径不存在或目录里没有 .txt 时抛出，错误信息为中文
 */
export function assertCookiesFilesExist(files: string[]): void {
  for (const file of files) {
    if (!fs.existsSync(file)) {
      throw new Error(`Cookie 路径不存在：${file}，请在设置里重新指定或清空该项。`)
    }
  }
}

/**
 * 读取并合并 Cookie 文件
 * @param files - 文件绝对路径列表
 * @returns 合并后的内容与汇总信息
 * @throws Error 文件不可读，或所有文件都没有有效 Cookie 时抛出
 * @remarks 目录里混进非 Cookie 的 .txt（例如说明文件）会被跳过，不影响其余文件生效
 */
export function mergeCookiesFiles(files: string[]): {
  content: string
  summary: CookieSummary
} {
  const contents: string[] = []

  for (const file of files) {
    try {
      contents.push(fs.readFileSync(file, 'utf8'))
    } catch (error) {
      throw new Error(`读取 Cookie 文件失败：${file}（${(error as Error).message}）`)
    }
  }

  const merged = mergeCookieContents(contents)
  if (merged.summary.skippedFiles > 0) {
    logger.warn('cookie-service', '已跳过不含有效 Cookie 的文件', {
      skippedFiles: merged.summary.skippedFiles,
      totalFiles: files.length,
    })
  }

  if (merged.summary.cookieCount === 0) {
    throw new Error(
      `这些文件里没有解析到有效 Cookie（共 ${files.length} 个文件）。请确认导出的是 Netscape 格式（以 # Netscape HTTP Cookie File 开头）的 cookies.txt。`,
    )
  }

  return merged
}

/**
 * 准备交给 yt-dlp 的 Cookie 文件
 * @param cookiesFile - 配置里的 Cookie 路径
 * @returns 合并后文件的绝对路径；未配置时返回空字符串
 * @throws Error 配置了路径但不可用时抛出
 */
export function prepareCookiesFile(cookiesFile: string): string {
  const files = resolveCookiesFiles(cookiesFile)
  if (files.length === 0) {
    return ''
  }

  assertCookiesFilesExist(files)
  const merged = mergeCookiesFiles(files)

  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(MERGED_COOKIE_PATH, merged.content, 'utf8')
  logger.info('cookie-service', 'Cookie 已合并', {
    fileCount: merged.summary.fileCount,
    cookieCount: merged.summary.cookieCount,
    domains: merged.summary.domains,
  })

  return MERGED_COOKIE_PATH
}

/**
 * Cookie 配置自检：解析配置里的文件并汇总覆盖的域名
 * @param cookiesFile - 配置里的 Cookie 路径
 * @returns 自检结果，供界面上确认导出是否正确
 * @throws Error 路径不存在或文件不可解析时抛出
 */
export function inspectCookies(cookiesFile: string): CookieInspectResult {
  const configured = cookiesFile.trim()
  const emptyResult: CookieInspectResult = {
    ok: false,
    fileCount: 0,
    cookieCount: 0,
    domains: [],
    namesByDomain: {},
    message: configured ? `没有在 ${configured} 里找到 .txt 文件。` : '还没有配置 cookies.txt。',
  }

  try {
    const files = resolveCookiesFiles(cookiesFile)
    if (files.length === 0) {
      return emptyResult
    }

    assertCookiesFilesExist(files)
    const merged = mergeCookiesFiles(files)
    const skipped = merged.summary.skippedFiles

    return {
      ok: true,
      fileCount: files.length,
      cookieCount: merged.summary.cookieCount,
      domains: merged.summary.domains,
      namesByDomain: merged.summary.namesByDomain,
      message:
        `已合并 ${files.length} 个文件，共 ${merged.summary.cookieCount} 条 Cookie。` +
        (skipped > 0 ? `（跳过 ${skipped} 个不含 Cookie 的文件）` : ''),
    }
  } catch (error) {
    return { ...emptyResult, message: (error as Error).message }
  }
}
