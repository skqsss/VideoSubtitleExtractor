/**
 * @file 请求参数校验规则
 * @author sqksss
 * @description 用 zod 强校验入参，避免把脏 URL 或脏档位 ID 传给子进程
 * @date 2026-09-26
 */

import { z } from 'zod'

/** 可读取 Cookie 的浏览器白名单，与 shared/types.ts 保持一致 */
const COOKIE_BROWSER_VALUES = [
  'none',
  'edge',
  'chrome',
  'chromium',
  'firefox',
  'brave',
  'opera',
  'vivaldi',
  'whale',
] as const

/** 链接最大长度，防止超长字符串进入命令行 */
const URL_MAX_LENGTH = 2048

/** 代理地址最大长度 */
const PROXY_MAX_LENGTH = 200

/** Cookie 浏览器字段 */
const cookieBrowserSchema = z.enum(COOKIE_BROWSER_VALUES)

/** 解析请求 */
export const probeSchema = z.object({
  url: z
    .string({ error: '缺少视频链接。' })
    .trim()
    .min(1, '链接不能为空。')
    .max(URL_MAX_LENGTH, `链接最长 ${URL_MAX_LENGTH} 个字符。`),
  cookieBrowser: cookieBrowserSchema.optional(),
  cookiesFile: z.string().trim().max(512).optional(),
  proxy: z.string().trim().max(PROXY_MAX_LENGTH).optional(),
})

/** 创建下载任务请求 */
export const startTaskSchema = z.object({
  url: z
    .string({ error: '缺少视频链接。' })
    .trim()
    .min(1, '链接不能为空。')
    .max(URL_MAX_LENGTH, `链接最长 ${URL_MAX_LENGTH} 个字符。`),
  mode: z.enum(['format', 'best-1080', 'best', 'audio-mp3'], { error: '下载模式不合法。' }),
  /** 档位 ID 由 yt-dlp 生成，限制字符集避免特殊字符进入 -f 参数 */
  formatId: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9_.+-]+$/, '档位 ID 不合法')
    .optional(),
  cookieBrowser: cookieBrowserSchema.optional(),
  proxy: z.string().trim().max(PROXY_MAX_LENGTH).optional(),
})

/** 更新配置请求 */
export const configSchema = z.object({
  ytdlpPath: z.string().trim().min(1).max(512).optional(),
  ffmpegDir: z.string().trim().min(1).max(512).optional(),
  downloadDir: z.string().trim().min(1).max(512).optional(),
  cookieBrowser: cookieBrowserSchema.optional(),
  cookiesFile: z.string().trim().max(512).optional(),
  proxy: z.string().trim().max(PROXY_MAX_LENGTH).optional(),
  concurrency: z.number().int().min(1).max(4).optional(),
})

/** 任务 ID：由主进程生成的 UUID，这里只挡掉空值与非字符串 */
export const taskIdSchema = z.string({ error: '缺少任务 ID。' }).trim().min(1, '任务 ID 不合法。')
