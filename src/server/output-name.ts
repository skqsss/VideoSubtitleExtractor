/**
 * @file 产物文件名唯一化
 * @author Codex
 * @description 按 yt-dlp --windows-filenames 的规则预测产物名，并在同名文件已存在时挑出可用的序号
 * @date 2026-09-30
 */

import fs from 'node:fs'
import path from 'node:path'

import type { DownloadMode, VideoFormat } from '../shared/types.ts'
import { logger } from './logger.ts'

/**
 * Windows 非法字符 → yt-dlp 使用的替代字符
 * @remarks 取值来自 yt-dlp `--windows-filenames` 实测结果，不能随意改成下划线，
 * 否则预测出的名字与实际写盘的名字对不上，就无法判断"同名"
 */
const WINDOWS_ILLEGAL_CHAR_MAP: Record<string, string> = {
  '<': '＜',
  '>': '＞',
  ':': '：',
  '"': '＂',
  '/': '⧸',
  '\\': '⧹',
  '|': '｜',
  '?': '？',
  '*': '＊',
}

/** 换行会被 yt-dlp 换成空格，其余控制字符直接丢弃 */
const LINE_BREAK_PATTERN = /[\r\n]/g
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/g

/** 文件名末尾的序号后缀，如 `标题 [1920x1080] (2)` */
const INDEX_SUFFIX_PATTERN = /^(.*) \((\d+)\)$/

/**
 * 按 yt-dlp `--windows-filenames` 的规则清洗名称
 * @param name - 原始名称（标题，或标题加分辨率后缀）
 * @returns 与 yt-dlp 实际写盘一致的文件名主体
 */
export function sanitizeWindowsFilename(name: string): string {
  const replaced = [...name]
    .map((char) => WINDOWS_ILLEGAL_CHAR_MAP[char] ?? char)
    .join('')

  return replaced.replace(LINE_BREAK_PATTERN, ' ').replace(CONTROL_CHAR_PATTERN, '')
}

/**
 * 生成"同名文件"判定用的正则
 * @param title - 视频标题，即 yt-dlp 的 %(title)s
 * @param mode - 下载模式
 * @param format - 指定档位时选中的档位，预设模式传空
 * @returns 匹配不带序号的文件名主体的正则（忽略大小写，Windows 盘符不区分大小写）
 * @remarks 视频档位的文件名里带 `[宽x高]`：指定档位时分辨率已经知道，按实际值精确匹配，
 * 换了清晰度就不会被误判成同名；预设模式要等 yt-dlp 选完档位才知道分辨率，只能把方括号部分当通配
 */
export function buildOutputBasePattern(
  title: string,
  mode: DownloadMode,
  format?: Pick<VideoFormat, 'width' | 'height'> | null,
): RegExp {
  const escaped = escapeRegExp(sanitizeWindowsFilename(title))

  if (mode === 'audio-mp3') {
    return new RegExp(`^${escaped}$`, 'i')
  }

  const resolution = format ? `${format.width ?? 'NA'}x${format.height ?? 'NA'}` : ''

  return resolution
    ? new RegExp(`^${escaped} \\[${escapeRegExp(resolution)}\\]$`, 'i')
    : new RegExp(`^${escaped} \\[[^\\[\\]]*\\]$`, 'i')
}

/**
 * 拆分文件名主体与序号后缀
 * @param baseName - 不含扩展名的文件名主体
 * @returns 去掉序号后的主体与序号，无序号时序号为 0
 */
export function splitOutputIndex(baseName: string): { base: string; index: number } {
  const matched = INDEX_SUFFIX_PATTERN.exec(baseName)
  if (!matched) {
    return { base: baseName, index: 0 }
  }

  return { base: matched[1], index: Number.parseInt(matched[2], 10) }
}

/**
 * 去掉文件名的最后一个扩展名
 * @param fileName - 文件名，如 `标题 [1920x1080].mp4`
 * @returns 不含扩展名的主体
 */
export function stripFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')

  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
}

/**
 * 挑出下一个可用的序号
 * @param downloadDir - 下载目录
 * @param isSameBase - 判断文件名主体是否属于同一个视频
 * @returns 0 表示原名可用，正整数表示要追加的序号
 * @remarks 目录读不出来时按"没有同名文件"处理，让下载照常进行，
 * 后续 yt-dlp 报告复用了旧文件时会再走一次改名重试
 */
export function resolveNextOutputIndex(
  downloadDir: string,
  isSameBase: (baseName: string) => boolean,
): number {
  const taken = new Set<number>()

  for (const fileName of listFileNames(downloadDir)) {
    const { base, index } = splitOutputIndex(stripFileExtension(fileName))
    if (isSameBase(base)) {
      taken.add(index)
    }
  }

  if (!taken.has(0)) {
    return 0
  }

  let index = 1
  while (taken.has(index)) {
    index += 1
  }

  return index
}

/**
 * 从 yt-dlp 报告的路径反推"下一个序号"
 * @param downloadDir - 下载目录
 * @param reusedPath - yt-dlp 复用的旧文件绝对路径
 * @returns 与这份文件同名的下一个可用序号，0 表示原名可用
 * @remarks 调用方会取"当前序号 + 1"与本结果的较大值，保证换名后一定会前进
 */
export function resolveNextOutputIndexFromPath(downloadDir: string, reusedPath: string): number {
  const baseName = stripFileExtension(path.basename(reusedPath))
  const { base } = splitOutputIndex(baseName)
  const target = base.toLowerCase()

  return resolveNextOutputIndex(downloadDir, (candidate) => candidate.toLowerCase() === target)
}

/**
 * 读取目录下的文件名
 * @param downloadDir - 目录路径
 * @returns 文件名数组，读取失败时返回空数组
 */
function listFileNames(downloadDir: string): string[] {
  try {
    return fs
      .readdirSync(downloadDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
  } catch (error) {
    logger.debug('output-name', '读取下载目录失败，跳过同名检查', {
      reason: (error as Error).message,
    })

    return []
  }
}

/**
 * 转义正则元字符
 * @param value - 原始文本
 * @returns 可直接嵌入正则的文本
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
