/**
 * @file cookies.txt 解析与合并
 * @author Codex
 * @description 处理 Netscape 格式 Cookie 文件：解析、按域名+路径+名称去重、汇总域名
 * @date 2026-09-26
 */

/** Netscape 格式的 Cookie 头，合并后统一写这一行 */
export const NETSCAPE_HEADER = '# Netscape HTTP Cookie File'

/** 一行 Cookie 的字段含义 */
export interface NetscapeCookieLine {
  /** 域，可能带 HttpOnly 前缀 */
  domain: string
  path: string
  name: string
  /** 原始整行，合并时原样写出 */
  raw: string
}

/** Cookie 汇总信息，用于界面上做配置自检 */
export interface CookieSummary {
  /** 参与合并的文件数 */
  fileCount: number
  /** 去重后的 Cookie 条数 */
  cookieCount: number
  /** 出现过的域名（已去掉前导点与 HttpOnly 前缀） */
  domains: string[]
  /** 每个域名下的 Cookie 名，用于确认登录态（如 SESSDATA）是否导出成功 */
  namesByDomain: Record<string, string[]>
  /** 内容里没有有效 Cookie、被跳过的文件数 */
  skippedFiles: number
}

/** HttpOnly Cookie 在文件里以 #HttpOnly_ 开头，属于有效数据而不是注释 */
const HTTP_ONLY_PREFIX = '#HttpOnly_'

/** 一条 Cookie 应有 7 个字段 */
const COOKIE_FIELD_COUNT = 7

/**
 * 解析单个 cookie 文件的内容
 * @param content - 文件文本
 * @returns 解析出的 Cookie 行，解析失败的行会被跳过
 * @remarks 只保留有效 Cookie 行，注释一并丢弃（合并时统一写标准头）
 */
export function parseCookieContent(content: string): NetscapeCookieLine[] {
  const lines: NetscapeCookieLine[] = []

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (!line) {
      continue
    }

    const isHttpOnly = line.startsWith(HTTP_ONLY_PREFIX)
    if (line.startsWith('#') && !isHttpOnly) {
      continue
    }

    const fields = line.split('\t')
    if (fields.length < COOKIE_FIELD_COUNT) {
      continue
    }

    // Cookie 值理论上不含制表符，但真出现时把多出来的部分并回值里，保证行有意义
    const domain = fields[0] ?? ''
    const path = fields[2] ?? ''
    const name = fields[5] ?? ''
    if (!domain || !name) {
      continue
    }

    lines.push({ domain, path, name, raw: line })
  }

  return lines
}

/**
 * 合并多个 cookie 文件的内容
 * @param contents - 各文件文本
 * @returns 合并后的文件内容（含标准头）
 * @remarks 以「域 + 路径 + 名称」为键去重，后出现的覆盖先出现的，
 * 这样用户可以按 B 站、抖音分别导出，多份文件一起用
 */
export function mergeCookieContents(contents: string[]): {
  content: string
  summary: CookieSummary
} {
  const merged = new Map<string, NetscapeCookieLine>()
  let skippedFiles = 0

  for (const text of contents) {
    const lines = parseCookieContent(text)
    if (lines.length === 0) {
      skippedFiles += 1
      continue
    }

    for (const line of lines) {
      merged.set(`${line.domain}\t${line.path}\t${line.name}`, line)
    }
  }

  const lines = [...merged.values()]
  const content = [NETSCAPE_HEADER, ...lines.map((line) => line.raw), ''].join('\n')

  return {
    content,
    summary: {
      fileCount: contents.length,
      cookieCount: lines.length,
      domains: summarizeDomains(lines),
      namesByDomain: groupNamesByDomain(lines),
      skippedFiles,
    },
  }
}

/**
 * 汇总 Cookie 覆盖的域名
 * @param lines - Cookie 行
 * @returns 去重并排序后的域名列表
 */
export function summarizeDomains(lines: NetscapeCookieLine[]): string[] {
  const domains = new Set<string>()

  for (const line of lines) {
    const normalized = line.domain
      .replace(HTTP_ONLY_PREFIX, '')
      .replace(/^\./, '')
      .toLowerCase()
    if (normalized) {
      domains.add(normalized)
    }
  }

  return [...domains].sort()
}

/**
 * 按域名归集 Cookie 名
 * @param lines - Cookie 行
 * @returns 域名到 Cookie 名列表的映射（名称去重并按字母序）
 */
export function groupNamesByDomain(
  lines: NetscapeCookieLine[],
): Record<string, string[]> {
  const grouped = new Map<string, Set<string>>()

  for (const line of lines) {
    const normalized = line.domain
      .replace(HTTP_ONLY_PREFIX, '')
      .replace(/^\./, '')
      .toLowerCase()
    if (!normalized) {
      continue
    }

    const names = grouped.get(normalized) ?? new Set<string>()
    names.add(line.name)
    grouped.set(normalized, names)
  }

  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([domain, names]) => [domain, [...names].sort()]),
  )
}
