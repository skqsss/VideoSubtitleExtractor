/**
 * @file 格式归一化与 -f 选择器生成
 * @author sqksss
 * @description 把 yt-dlp -J 的原始 format 列表转成前端可直接渲染的结构，并生成下载用选择器
 * @date 2026-09-26
 */

import type { DownloadMode, VideoFormat } from './types.ts'

/** yt-dlp -J 返回的原始 format 对象（仅声明本项目用到的字段） */
export interface RawYtdlpFormat {
  format_id?: string
  ext?: string
  width?: number | null
  height?: number | null
  fps?: number | null
  vcodec?: string | null
  acodec?: string | null
  tbr?: number | null
  vbr?: number | null
  abr?: number | null
  filesize?: number | null
  filesize_approx?: number | null
  format_note?: string | null
  dynamic_range?: string | null
  protocol?: string | null
}

/** yt-dlp -J 中本模块需要的字段 */
export interface RawYtdlpInfo {
  id?: string
  title?: string
  uploader?: string
  channel?: string
  duration?: number | null
  thumbnail?: string
  webpage_url?: string
  formats?: RawYtdlpFormat[]
}

/** 刻度过长时用于截断展示的常量 */
const RULER_MIN_PERCENT = 8
const RULER_MAX_PERCENT = 100
/** 刻度权重：分辨率七成、码率三成，缺项时权重自动让给另一项 */
const RULER_HEIGHT_WEIGHT = 0.7
const RULER_BITRATE_WEIGHT = 0.3

/** 下载预设：与界面上的预设按钮一一对应 */
export interface DownloadPreset {
  mode: DownloadMode
  label: string
  /** 展示在按钮旁的说明 */
  hint: string
  /** 追加到 yt-dlp 的固定参数 */
  args: string[]
}

/** 预设按钮配置，顺序即界面顺序 */
export const DOWNLOAD_PRESETS: DownloadPreset[] = [
  {
    mode: 'best-1080',
    label: '最佳 ≤1080P',
    hint: '优先 1920×1080 及以下，mp4 容器',
    args: ['-S', 'res:1080,ext:mp4:m4a'],
  },
  {
    mode: 'best',
    label: '最高画质',
    hint: '取最高码率的视频轨与最佳音轨合并',
    args: ['-f', 'bv*+ba/b'],
  },
  {
    mode: 'audio-mp3',
    label: '仅音频 MP3',
    hint: '抽取音轨并转码为 mp3（依赖 ffmpeg）',
    args: ['-x', '--audio-format', 'mp3'],
  },
]

/**
 * 生成指定档位的 -f 选择器
 * @param format - 归一化后的档位，或任意含编码信息的对象
 * @returns 可直接传给 yt-dlp -f 的选择器字符串
 * @remarks B 站 DASH 常态是纯视频档，必须显式拼接最佳音轨，否则下载后无声
 */
export function buildFormatSelector(format: {
  formatId: string
  vcodec: string
  acodec: string
}): string {
  const hasVideo = format.vcodec !== 'none'
  const hasAudio = format.acodec !== 'none'

  if (hasVideo && !hasAudio) {
    return `${format.formatId}+ba`
  }

  return format.formatId
}

/**
 * 生成下载参数中的格式相关部分
 * @param mode - 下载模式
 * @param format - mode 为 format 时必填的档位
 * @returns yt-dlp 参数数组片段
 * @throws Error 当 mode 为 format 但缺少档位信息时抛出
 */
export function buildFormatArgs(mode: DownloadMode, format?: VideoFormat): string[] {
  if (mode === 'format') {
    if (!format) {
      throw new Error('缺少档位信息，无法生成下载参数')
    }

    return ['-f', format.selector]
  }

  const preset = DOWNLOAD_PRESETS.find((item) => item.mode === mode)
  if (!preset) {
    throw new Error(`未知的下载模式：${mode}`)
  }

  return [...preset.args]
}

/**
 * 判断是否为占位性（缩略图/故事板）格式
 * @param raw - yt-dlp 原始 format
 * @returns 是占位格式时返回 true
 */
function isStoryboard(raw: RawYtdlpFormat): boolean {
  const formatId = raw.format_id ?? ''
  const note = raw.format_note ?? ''

  return formatId.startsWith('sb') || note.toLowerCase() === 'storyboard'
}

/**
 * 把原始 format 归一化为前端渲染结构
 * @param raw - yt-dlp 原始 format
 * @param rulerPercent - 该档位在刻度条上的占比（0~100）
 * @returns 归一化后的档位
 */
function normalizeFormat(raw: RawYtdlpFormat, rulerPercent: number): VideoFormat {
  const formatId = raw.format_id ?? ''
  const vcodec = raw.vcodec ?? 'none'
  const acodec = raw.acodec ?? 'none'
  const isVideoOnly = vcodec !== 'none' && acodec === 'none'
  const isAudioOnly = vcodec === 'none'
  const noteParts = [raw.format_note, raw.dynamic_range].filter(
    (item): item is string => Boolean(item) && item !== 'SDR',
  )

  return {
    formatId,
    ext: raw.ext ?? 'unknown',
    width: raw.width ?? null,
    height: raw.height ?? null,
    fps: raw.fps ?? null,
    vcodec,
    acodec,
    tbr: raw.tbr ?? raw.vbr ?? raw.abr ?? null,
    filesize: raw.filesize ?? raw.filesize_approx ?? null,
    note: noteParts.join(' · '),
    protocol: raw.protocol ?? '',
    isVideoOnly,
    isAudioOnly,
    selector: buildFormatSelector({ formatId, vcodec, acodec }),
    rulerPercent,
  }
}

/**
 * 计算单个档位的刻度占比
 * @param raw - 原始 format
 * @param maxHeight - 全部档位中的最大高度
 * @param maxBitrate - 全部档位中的最大码率
 * @returns 0~100 的占比，纯音频档按码率单一维度计算
 */
function computeRulerPercent(
  raw: RawYtdlpFormat,
  maxHeight: number,
  maxBitrate: number,
): number {
  const height = raw.height ?? 0
  const bitrate = raw.tbr ?? raw.vbr ?? raw.abr ?? 0

  if (height <= 0) {
    if (maxBitrate <= 0) {
      return RULER_MIN_PERCENT
    }

    return clampPercent((bitrate / maxBitrate) * 100)
  }

  const heightScore = maxHeight > 0 ? height / maxHeight : 1
  const bitrateScore = maxBitrate > 0 ? bitrate / maxBitrate : heightScore
  const score =
    heightScore * RULER_HEIGHT_WEIGHT + bitrateScore * RULER_BITRATE_WEIGHT

  return clampPercent(score * 100)
}

/**
 * 把占比限制在可读区间内，避免出现过短或超长的刻度
 * @param value - 原始占比
 * @returns 限制后的占比
 */
function clampPercent(value: number): number {
  if (Number.isNaN(value)) {
    return RULER_MIN_PERCENT
  }

  return Math.min(RULER_MAX_PERCENT, Math.max(RULER_MIN_PERCENT, Math.round(value)))
}

/**
 * 归一化 yt-dlp -J 返回的 info
 * @param info - yt-dlp 原始 JSON
 * @returns 前端可直接渲染的解析结果
 * @remarks 会过滤故事板格式、合并完全相同的档位，并把视频档、音频档分开排序
 */
export function normalizeProbeInfo(info: RawYtdlpInfo): {
  title: string
  uploader: string
  duration: number | null
  thumbnail: string
  formats: VideoFormat[]
  audioFormats: VideoFormat[]
  hasVideoOnly: boolean
} {
  const rawFormats = (info.formats ?? []).filter(
    (raw) => !isStoryboard(raw) && Boolean(raw.format_id),
  )
  const rawVideoFormats = rawFormats.filter(
    (raw) => (raw.vcodec ?? 'none') !== 'none',
  )
  const rawAudioFormats = rawFormats.filter(
    (raw) => (raw.vcodec ?? 'none') === 'none' && (raw.acodec ?? 'none') !== 'none',
  )

  const maxHeight = rawVideoFormats.reduce(
    (acc, raw) => Math.max(acc, raw.height ?? 0),
    0,
  )
  const maxBitrate = rawFormats.reduce(
    (acc, raw) => Math.max(acc, raw.tbr ?? raw.vbr ?? raw.abr ?? 0),
    0,
  )

  const formats = dedupeFormats(
    rawVideoFormats.map((raw) =>
      normalizeFormat(raw, computeRulerPercent(raw, maxHeight, maxBitrate)),
    ),
  ).sort(compareFormats)
  const audioFormats = dedupeFormats(
    rawAudioFormats.map((raw) =>
      normalizeFormat(raw, computeRulerPercent(raw, maxHeight, maxBitrate)),
    ),
  ).sort(compareFormats)

  return {
    title: info.title ?? '未命名视频',
    uploader: info.uploader ?? info.channel ?? '未知上传者',
    duration: typeof info.duration === 'number' ? info.duration : null,
    thumbnail: info.thumbnail ?? '',
    formats,
    audioFormats,
    hasVideoOnly: formats.some((item) => item.isVideoOnly),
  }
}

/**
 * 档位排序比较器：先比高度，再比码率，最后比格式 ID
 * @param left - 左侧档位
 * @param right - 右侧档位
 * @returns 排序结果
 */
function compareFormats(left: VideoFormat, right: VideoFormat): number {
  const heightDiff = (right.height ?? 0) - (left.height ?? 0)
  if (heightDiff !== 0) {
    return heightDiff
  }

  const bitrateDiff = (right.tbr ?? 0) - (left.tbr ?? 0)
  if (bitrateDiff !== 0) {
    return bitrateDiff
  }

  return left.formatId.localeCompare(right.formatId)
}

/**
 * 合并描述完全相同的档位
 * @param formats - 归一化后的档位列表
 * @returns 去重后的列表，保留每个组合中第一个出现的档位
 * @remarks 部分平台（如抖音）会把同一清晰度的多个 CDN 线路各列一条，
 * 表格里会出现 4 倍重复行。这些档位的容器、分辨率、帧率、编码、码率、
 * 体积完全一致，观看效果相同，因此只保留一条，避免表格被噪声淹没
 */
export function dedupeFormats(formats: VideoFormat[]): VideoFormat[] {
  const seen = new Set<string>()
  const result: VideoFormat[] = []

  for (const format of formats) {
    const signature = [
      format.ext,
      format.width ?? '',
      format.height ?? '',
      format.fps === null ? '' : Math.round(format.fps),
      format.vcodec,
      format.acodec,
      format.tbr === null ? '' : Math.round(format.tbr),
      format.filesize ?? '',
    ].join('|')

    if (seen.has(signature)) {
      continue
    }

    seen.add(signature)
    result.push(format)
  }

  return result
}

/**
 * 把字节数格式化为人类可读文本
 * @param bytes - 字节数，null/undefined 表示未知
 * @returns 如 820 MB，未知时返回"未知"
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes <= 0) {
    return '未知'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const digits = value >= 100 || unitIndex === 0 ? 0 : 1

  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

/**
 * 把秒数格式化为时间码
 * @param seconds - 秒数，null 表示未知
 * @returns 形如 1:02:34 的时间码，未知时返回 "--:--"
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds <= 0) {
    return '--:--'
  }

  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number): string => value.toString().padStart(2, '0')

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(secs)}`
  }

  return `${pad(minutes)}:${pad(secs)}`
}

/**
 * 把码率格式化为紧凑文本
 * @param tbr - 码率（kbps）
 * @returns 如 4.8M / 320K，未知时返回"—"
 */
export function formatBitrate(tbr: number | null | undefined): string {
  if (!tbr || tbr <= 0) {
    return '—'
  }

  if (tbr >= 1000) {
    return `${(tbr / 1000).toFixed(1)}M`
  }

  return `${Math.round(tbr)}K`
}

/**
 * 把解析出的档位信息拼成表格里展示的分辨率文本
 * @param format - 档位（只需分辨率相关字段）
 * @returns 如 1920×1080 / 仅音频
 */
export function formatResolution(
  format: Pick<VideoFormat, 'isAudioOnly' | 'width' | 'height'>,
): string {
  if (format.isAudioOnly || !format.height) {
    return format.isAudioOnly ? '仅音频' : '分辨率未知'
  }

  if (format.width) {
    return `${format.width}×${format.height}`
  }

  return `${format.height}P`
}

/**
 * 把完整编码串压缩成表格里可读的短名
 * @param codec - 完整编码串，如 avc1.640028 / av01.0.00M.08 / none
 * @returns 短名，如 avc1 / av01 / —
 * @remarks 只保留第一段，表格列宽有限，完整编码仍可在下载日志里查到
 */
export function formatCodec(codec: string): string {
  if (!codec || codec === 'none') {
    return '—'
  }

  return codec.split('.')[0] ?? codec
}

/**
 * 把 yt-dlp 的备注转成界面上好懂的中文
 * @param note - format_note 原文（一般是英文）
 * @returns 展示用文本，未识别的备注原样返回
 * @remarks 抖音会把同一视频列成"直连播放源"和"API 下载源"两套，
 * 后者带水印，提示必须让用户看得懂，否则容易下错
 */
export function formatNoteText(note: string): string {
  if (!note) {
    return ''
  }

  if (/watermark/i.test(note)) {
    return '含水印'
  }

  if (/direct video/i.test(note)) {
    return '直连源（无水印）'
  }

  return note
}
