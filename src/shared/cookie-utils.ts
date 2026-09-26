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
 * @remarks 自动识别两种常见格式：
 * 1）Netscape 文本（yt-dlp 原生格式，扩展 Get cookies.txt LOCALLY 的导出）；
 * 2）Cookie-Editor 等扩展导出的 JSON 数组（含 domain/name/value 字段）。
 * 注释一并丢弃，合并时统一写标准头。
 */
export function parseCookieContent(content: string): NetscapeCookieLine[] {
  const jsonLines = parseCookieJson(content)
  if (jsonLines) {
    return jsonLines
  }

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
 * 尝试按 JSON 格式解析 Cookie
 * @param content - 文件文本
 * @returns 解析结果；不是 JSON 格式时返回 null
 * @remarks 兼容两种结构：直接是数组，或 { cookies: [...] }（Chrome 导出风格）
 */
export function parseCookieJson(content: string): NetscapeCookieLine[] | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
    return null
  }

  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    return null
  }

  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.cookies)
      ? data.cookies
      : null
  if (!list) {
    return null
  }

  const lines: NetscapeCookieLine[] = []
  for (const item of list) {
    if (!isRecord(item)) {
      continue
    }

    const line = convertJsonCookie(item)
    if (line) {
      lines.push(line)
    }
  }

  return lines
}

/**
 * 把一条 JSON Cookie 转成 Netscape 行
 * @param item - JSON 里的单个 Cookie 对象
 * @returns 转换结果，缺少必需字段时返回 null
 */
function convertJsonCookie(item: Record<string, unknown>): NetscapeCookieLine | null {
  const name = toText(item.name)
  const rawDomain = toText(item.domain)
  if (!name || !rawDomain) {
    return null
  }

  const isHttpOnly = item.httpOnly === true
  const domain =
    isHttpOnly && !rawDomain.startsWith(HTTP_ONLY_PREFIX)
      ? `${HTTP_ONLY_PREFIX}${rawDomain}`
      : rawDomain
  const includeSubdomains = rawDomain.startsWith('.') ? 'TRUE' : 'FALSE'
  const path = toText(item.path) || '/'
  const secure = item.secure === true ? 'TRUE' : 'FALSE'
  const expires = toExpirySeconds(item.expirationDate)
  // Cookie 值按规范不含控制字符，这里额外兜底，避免制表符把 Netscape 的字段切开
  const value = toText(item.value).replace(/[\t\r\n]/g, '')

  return {
    domain,
    path,
    name,
    raw: [domain, includeSubdomains, path, secure, expires, name, value].join('\t'),
  }
}

/**
 * 把 JSON 里的过期时间统一成秒
 * @param value - 原始值，可能是秒、毫秒或缺失
 * @returns 秒级时间戳字符串，缺失或非法时为 '0'
 */
function toExpirySeconds(value: unknown): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '0'
  }

  // 毫秒级时间戳（大于 10^12）需要先换算成秒
  return String(Math.floor(numeric > 1e12 ? numeric / 1000 : numeric))
}

/**
 * 判断是否为普通对象
 * @param value - 待判断的值
 * @returns 是对象时返回 true
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 把未知值转成字符串
 * @param value - 待转换的值
 * @returns 字符串，null/undefined 得到空串
 */
function toText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value)
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
