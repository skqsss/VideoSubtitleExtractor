/**
 * @file 格式归一化与选择器生成单元测试
 * @author sqksss
 * @description 覆盖文档中"最容易写错"的 -f 选择器规则与刻度计算
 * @date 2026-09-26
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DOWNLOAD_PRESETS,
  buildFormatArgs,
  buildFormatSelector,
  dedupeFormats,
  formatBitrate,
  formatBytes,
  formatDuration,
  formatNoteText,
  formatResolution,
  normalizeProbeInfo,
  type RawYtdlpInfo,
} from '../src/shared/format-utils.ts'
import type { VideoFormat } from '../src/shared/types.ts'

/**
 * 构造用于测试的档位对象
 * @param patch - 需要覆盖的字段
 * @returns 完整档位对象
 */
function createFormat(patch: Partial<VideoFormat> = {}): VideoFormat {
  return {
    formatId: '137',
    ext: 'mp4',
    width: 1920,
    height: 1080,
    fps: 30,
    vcodec: 'avc1.640028',
    acodec: 'none',
    tbr: 4800,
    filesize: null,
    note: '',
    protocol: 'https',
    isVideoOnly: true,
    isAudioOnly: false,
    selector: '137+ba',
    rulerPercent: 90,
    ...patch,
  }
}

test('音视频合体档位直接使用 format_id', () => {
  assert.equal(
    buildFormatSelector({ formatId: '18', vcodec: 'avc1', acodec: 'mp4a' }),
    '18',
  )
})

test('纯视频档位（B 站 DASH 常态）拼接最佳音轨', () => {
  assert.equal(
    buildFormatSelector({ formatId: '137', vcodec: 'avc1', acodec: 'none' }),
    '137+ba',
  )
})

test('纯音频档位不做任何拼接', () => {
  assert.equal(
    buildFormatSelector({ formatId: '30280', vcodec: 'none', acodec: 'mp4a' }),
    '30280',
  )
})

test('预设模式使用文档约定的固定参数', () => {
  assert.deepEqual(buildFormatArgs('best-1080'), ['-S', 'res:1080,ext:mp4:m4a'])
  assert.deepEqual(buildFormatArgs('best'), ['-f', 'bv*+ba/b'])
  assert.deepEqual(buildFormatArgs('audio-mp3'), ['-x', '--audio-format', 'mp3'])
})

test('指定档位模式使用档位自身的选择器', () => {
  assert.deepEqual(buildFormatArgs('format', createFormat()), ['-f', '137+ba'])
})

test('指定档位模式缺少档位信息时抛出中文错误', () => {
  assert.throws(() => buildFormatArgs('format'), /缺少档位信息/)
})

test('预设列表包含三个按钮且顺序稳定', () => {
  assert.deepEqual(
    DOWNLOAD_PRESETS.map((preset) => preset.mode),
    ['best-1080', 'best', 'audio-mp3'],
  )
})

test('归一化会过滤故事板格式并按清晰度降序排列', () => {
  const info: RawYtdlpInfo = {
    title: '测试视频',
    uploader: '测试 UP',
    duration: 754,
    formats: [
      { format_id: 'sb0', ext: 'mhtml', vcodec: 'none', acodec: 'none' },
      { format_id: '136', ext: 'mp4', width: 1280, height: 720, fps: 30, vcodec: 'avc1', acodec: 'none', tbr: 1900 },
      { format_id: '137', ext: 'mp4', width: 1920, height: 1080, fps: 60, vcodec: 'avc1', acodec: 'none', tbr: 4800 },
      { format_id: '30280', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', abr: 192 },
      { format_id: '18', ext: 'mp4', width: 640, height: 360, vcodec: 'avc1', acodec: 'mp4a', tbr: 600 },
    ],
  }

  const result = normalizeProbeInfo(info)

  assert.equal(result.title, '测试视频')
  assert.equal(result.duration, 754)
  assert.deepEqual(
    result.formats.map((item) => item.formatId),
    ['137', '136', '18'],
  )
  assert.deepEqual(
    result.audioFormats.map((item) => item.formatId),
    ['30280'],
  )
  assert.equal(result.hasVideoOnly, true)
})

test('纯视频档位带出 +ba 选择器，合体档位保持原样', () => {
  const result = normalizeProbeInfo({
    formats: [
      { format_id: '137', height: 1080, vcodec: 'avc1', acodec: 'none' },
      { format_id: '18', height: 360, vcodec: 'avc1', acodec: 'mp4a' },
    ],
  })

  assert.deepEqual(
    result.formats.map((item) => item.selector),
    ['137+ba', '18'],
  )
})

test('刻度占比落在 8~100 之间，最高档位为 100', () => {
  const result = normalizeProbeInfo({
    formats: [
      { format_id: '137', width: 1920, height: 1080, vcodec: 'avc1', acodec: 'none', tbr: 4800 },
      { format_id: '160', width: 256, height: 144, vcodec: 'avc1', acodec: 'none', tbr: 120 },
      { format_id: '30216', vcodec: 'none', acodec: 'mp4a', abr: 64 },
    ],
  })

  const [top, tiny] = result.formats
  assert.equal(top?.rulerPercent, 100)
  assert.ok((tiny?.rulerPercent ?? 0) >= 8)
  assert.ok(result.audioFormats[0] !== undefined)
  assert.ok((result.audioFormats[0]?.rulerPercent ?? 0) >= 8)
})

test('同清晰度的多线路档位会被合并成一条', () => {
  // 抖音会把同一档位按 CDN 线路列成 -0/-1/-2/-3，除了 format_id 完全一致
  const raw = {
    formats: [
      { format_id: 'bytevc1_720p_1111404-0', ext: 'mp4', width: 720, height: 1280, fps: 30, vcodec: 'h265', acodec: 'aac', tbr: 1111, filesize: 2380767 },
      { format_id: 'bytevc1_720p_1111404-1', ext: 'mp4', width: 720, height: 1280, fps: 30, vcodec: 'h265', acodec: 'aac', tbr: 1111, filesize: 2380767 },
      { format_id: 'bytevc1_720p_1111404-2', ext: 'mp4', width: 720, height: 1280, fps: 30, vcodec: 'h265', acodec: 'aac', tbr: 1111, filesize: 2380767 },
      { format_id: 'bytevc1_540p_846388-0', ext: 'mp4', width: 576, height: 1024, fps: 30, vcodec: 'h265', acodec: 'aac', tbr: 846, filesize: 1813071 },
    ],
  }

  const result = normalizeProbeInfo(raw)

  assert.deepEqual(
    result.formats.map((item) => item.formatId),
    ['bytevc1_720p_1111404-0', 'bytevc1_540p_846388-0'],
  )
})

test('分辨率或编码不同的档位不会被误合并', () => {
  const formats = [
    createFormat({ formatId: 'a', height: 1080, vcodec: 'avc1' }),
    createFormat({ formatId: 'b', height: 1080, vcodec: 'hev1' }),
    createFormat({ formatId: 'c', height: 720 }),
  ]

  assert.equal(dedupeFormats(formats).length, 3)
})

test('抖音的备注能翻译成看得懂的中文', () => {
  assert.equal(formatNoteText('Download video, watermarked (API)'), '含水印')
  assert.equal(formatNoteText('Direct video (API)'), '直连源（无水印）')
  assert.equal(formatNoteText('1080P 高清'), '1080P 高清')
  assert.equal(formatNoteText(''), '')
})

test('缺少分辨率时高度为 null 且展示为仅音频', () => {
  const result = normalizeProbeInfo({
    formats: [{ format_id: '30280', ext: 'm4a', vcodec: 'none', acodec: 'mp4a', abr: 192 }],
  })

  const audio = result.audioFormats[0]
  assert.equal(audio?.height, null)
  assert.equal(formatResolution(audio as VideoFormat), '仅音频')
  assert.equal(result.hasVideoOnly, false)
})

test('体积、时长与码率格式化符合预期', () => {
  assert.equal(formatBytes(860_000_000), '820 MB')
  assert.equal(formatBytes(1_500_000), '1.4 MB')
  assert.equal(formatBytes(null), '未知')
  assert.equal(formatDuration(754), '12:34')
  assert.equal(formatDuration(3725), '1:02:05')
  assert.equal(formatDuration(null), '--:--')
  assert.equal(formatBitrate(4800), '4.8M')
  assert.equal(formatBitrate(192), '192K')
  assert.equal(formatBitrate(null), '—')
  assert.equal(formatResolution(createFormat()), '1920×1080')
})
