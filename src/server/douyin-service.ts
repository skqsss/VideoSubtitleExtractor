/**
 * @file 抖音解析兜底通道
 * @author Codex
 * @description yt-dlp 拿不到抖音网页接口要求的 a_bogus 签名，只能由主进程内置浏览器窗口
 * 打开视频页、抓取页面自己发出的详情响应。服务层只依赖这里登记的回调，纯 Node 运行时
 * （网页版 / 开发服务）通道为空，调用方回退到原行为
 * @date 2026-10-02
 */

import type { RawYtdlpFormat } from '../shared/format-utils.ts'
import { logger } from './logger.ts'

/** 抖音播放地址（play_addr）里本项目用到的字段 */
export interface RawDouyinPlayAddress {
  /** 同一路播放源的多个 CDN 地址，取第一个即可 */
  url_list?: string[]
  width?: number
  height?: number
  /** 文件字节数 */
  data_size?: number
}

/** 抖音清晰度档位（video.bit_rate 数组元素） */
export interface RawDouyinBitRate {
  /** 档位名，如 normal_1080_0，可直接当档位 ID 展示 */
  gear_name?: string
  /** 码率（bps） */
  bit_rate?: number
  quality_type?: number
  /** 容器格式，实测为 mp4 */
  format?: string
  /** 帧率，字段名就是大写 FPS */
  FPS?: number
  is_h265?: number
  is_bytevc1?: number
  play_addr?: RawDouyinPlayAddress
}

/** 抖音视频详情（aweme_detail）里本项目用到的字段 */
export interface RawDouyinAwemeDetail {
  aweme_id?: string
  /** 视频文案，作为标题 */
  desc?: string
  author?: { nickname?: string }
  video?: {
    /** 时长（毫秒） */
    duration?: number
    cover?: { url_list?: string[] }
    play_addr?: RawDouyinPlayAddress
    bit_rate?: RawDouyinBitRate[]
  }
}

/** 内置浏览器抓到的详情 */
export interface DouyinPageResult {
  detail: RawDouyinAwemeDetail
  /** 实际打开的页面地址，便于日志排查 */
  pageUrl: string
}

/**
 * 内置浏览器解析通道
 * @param url - 用户粘贴的链接，可能是 v.douyin.com 短链
 * @returns 抓到详情时返回详情，失败或超时返回 null
 */
export type DouyinPageResolver = (url: string) => Promise<DouyinPageResult | null>

/** 抖音桌面站点域名，短链与分享页都在其下 */
const DOUYIN_HOST_PATTERN = /(^|\.)(douyin\.com|iesdouyin\.com)$/i

/** 直播站不是短视频页，内置浏览器打开也抓不到详情，直接不认 */
const DOUYIN_LIVE_HOST_PATTERN = /(^|\.)live\.douyin\.com$/i

/** 已登记的解析通道；纯 Node 运行时始终为 null */
let pageResolver: DouyinPageResolver | null = null

/**
 * 判断链接是否属于抖音短视频站点
 * @param url - 待判断的链接
 * @returns 属于抖音且不是直播站时返回 true
 */
export function isDouyinVideoUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname

    return DOUYIN_HOST_PATTERN.test(host) && !DOUYIN_LIVE_HOST_PATTERN.test(host)
  } catch {
    return false
  }
}

/**
 * 从抖音链接里取出视频 ID
 * @param url - 视频页地址、分享页地址或详情接口地址
 * @returns 视频 ID，取不到返回空字符串
 * @remarks 先认路径里的 `/video/<id>`（分享页是 `/share/video/<id>`，同样命中），
 * 再退回 `modal_id` / `aweme_id` 查询参数。短链（v.douyin.com）本身不带 ID，要先跟一次跳转
 */
export function extractAwemeId(url: string): string {
  try {
    const parsed = new URL(url)
    const fromPath = /\/video\/(\d+)/.exec(parsed.pathname)
    if (fromPath?.[1]) {
      return fromPath[1]
    }

    return parsed.searchParams.get('modal_id') ?? parsed.searchParams.get('aweme_id') ?? ''
  } catch {
    return ''
  }
}

/**
 * 判断一条详情响应是否属于本次要解析的视频
 * @param responseUrl - 详情接口的请求地址
 * @param detailAwemeId - 响应体里的 aweme_id，未知时传 undefined
 * @param expectedId - 本次要解析的视频 ID，空字符串表示不做校验
 * @returns 属于本次请求返回 true
 * @remarks 抓取窗口跨解析复用，页面上可能还留着别的视频的在途请求；
 * 不校验就可能把别的视频的详情当成目标视频返回，用户会看到并下载错的那一支。
 * 两处 ID 都拿不到时按"无法判断"放行，避免把正常响应误拦成超时
 */
export function isDetailForAweme(
  responseUrl: string,
  detailAwemeId: string | undefined,
  expectedId: string,
): boolean {
  if (!expectedId) {
    return true
  }

  if (detailAwemeId && detailAwemeId !== expectedId) {
    return false
  }

  const requestedId = extractAwemeId(responseUrl)

  return !requestedId || requestedId === expectedId
}

/**
 * 登记内置浏览器解析通道
 * @param resolver - 解析实现，传 null 表示注销
 */
export function setDouyinPageResolver(resolver: DouyinPageResolver | null): void {
  pageResolver = resolver
}

/**
 * 是否已有可用的内置浏览器解析通道
 * @returns 可用时返回 true
 */
export function hasDouyinPageResolver(): boolean {
  return pageResolver !== null
}

/**
 * 走内置浏览器解析抖音链接
 * @param url - 抖音链接
 * @returns 抓到详情时返回详情，通道不可用或失败返回 null
 * @remarks 兜底通道本身不该让解析整体失败：任何异常都降级成 null，由调用方给出原本的提示
 */
export async function resolveDouyinPage(url: string): Promise<DouyinPageResult | null> {
  if (!pageResolver) {
    return null
  }

  try {
    return await pageResolver(url)
  } catch (error) {
    logger.warn('douyin-service', '内置浏览器解析失败', {
      reason: (error as Error).message,
    })

    return null
  }
}

/** 详情 JSON 转换结果 */
export interface DouyinFormatSource {
  title: string
  uploader: string
  /** 时长（秒），未知为 null */
  duration: number | null
  thumbnail: string
  /** 交给 format-utils 归一化的原始档位 */
  rawFormats: RawYtdlpFormat[]
  /** 档位 ID → 播放直链 */
  directUrls: Map<string, string>
}

/**
 * 把抖音详情转成与 yt-dlp 同构的档位列表
 * @param detail - aweme_detail 对象
 * @returns 归一化输入；没有任何可用直链时返回 null
 * @remarks 抖音会把同一个分辨率拆成多条码率（720_1_1、720_1_2…），
 * 这里按"宽×高"只保留码率最高的一条，避免表格里堆出十几行同清晰度的噪声；
 * 这些档位都是自带音轨的完整 mp4，因此不标记为纯视频轨
 */
export function douyinDetailToFormatSource(
  detail: RawDouyinAwemeDetail,
): DouyinFormatSource | null {
  const bitRates = detail.video?.bit_rate ?? []
  const directUrls = new Map<string, string>()
  const bestByResolution = new Map<string, RawDouyinBitRate>()

  for (const item of bitRates) {
    const url = item.play_addr?.url_list?.[0] ?? ''
    const gearName = item.gear_name ?? ''
    if (!url || !gearName) {
      continue
    }

    const key = `${item.play_addr?.width ?? 0}x${item.play_addr?.height ?? 0}`
    const current = bestByResolution.get(key)
    if (!current || (item.bit_rate ?? 0) > (current.bit_rate ?? 0)) {
      bestByResolution.set(key, item)
    }
  }

  for (const item of bestByResolution.values()) {
    const gearName = item.gear_name as string
    directUrls.set(gearName, item.play_addr?.url_list?.[0] as string)
  }

  if (directUrls.size === 0) {
    return null
  }

  const rawFormats: RawYtdlpFormat[] = [...bestByResolution.values()].map((item) => ({
    format_id: item.gear_name,
    ext: item.format ?? 'mp4',
    width: item.play_addr?.width ?? null,
    height: item.play_addr?.height ?? null,
    fps: item.FPS ?? null,
    vcodec: resolveVideoCodec(item),
    // 抖音直链是音视频一体的完整 mp4，音轨固定为 aac
    acodec: 'aac',
    tbr: item.bit_rate ? item.bit_rate / 1000 : null,
    filesize: item.play_addr?.data_size ?? null,
    format_note: '抖音直链',
    protocol: 'https',
  }))

  const durationMs = detail.video?.duration ?? 0

  return {
    title: detail.desc?.trim() || '未命名视频',
    uploader: detail.author?.nickname?.trim() || '抖音用户',
    duration: durationMs > 0 ? Math.round(durationMs / 1000) : null,
    thumbnail: detail.video?.cover?.url_list?.[0] ?? '',
    rawFormats,
    directUrls,
  }
}

/**
 * 推断档位的视频编码名
 * @param item - 抖音档位
 * @returns 编码名，如 h264 / h265 / bytevc1
 */
function resolveVideoCodec(item: RawDouyinBitRate): string {
  if (item.is_bytevc1) {
    return 'bytevc1'
  }

  return item.is_h265 ? 'h265' : 'h264'
}
