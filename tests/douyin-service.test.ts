/**
 * @file 抖音兜底解析单元测试
 * @author sqksss
 * @description 覆盖详情 JSON 到档位列表的转换、预设档位挑选与直链输出模板，
 * 这些规则决定了表格里出现几档清晰度、下载时命中哪条直链
 * @date 2026-10-02
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { requiresDirectFormat, resolveDirectPresetFormat } from '../src/server/task-manager.ts'
import {
  douyinDetailToFormatSource,
  extractAwemeId,
  isDetailForAweme,
  isDouyinVideoUrl,
  setDouyinPageResolver,
  type RawDouyinAwemeDetail,
} from '../src/server/douyin-service.ts'
import { normalizeProbeInfo } from '../src/shared/format-utils.ts'
import type { ProbeResult, VideoFormat } from '../src/shared/types.ts'
import { buildDirectOutputArgs } from '../src/server/ytdlp-service.ts'

/**
 * 造一份结构最小的抖音详情
 * @returns 含两个分辨率、其中 720P 有多条码率的详情
 */
function createDetail(): RawDouyinAwemeDetail {
  return {
    aweme_id: '7691451841657439323',
    desc: '  演示标题\n#话题  ',
    author: { nickname: '演示作者' },
    video: {
      duration: 15_900,
      cover: { url_list: ['https://example.com/cover.jpeg'] },
      bit_rate: [
        {
          gear_name: 'normal_1080_0',
          bit_rate: 2_450_473,
          format: 'mp4',
          FPS: 30,
          is_h265: 0,
          play_addr: { width: 1080, height: 1920, data_size: 4_870_317, url_list: ['https://cdn/1080.mp4'] },
        },
        {
          gear_name: '720_1_1',
          bit_rate: 1_183_875,
          format: 'mp4',
          FPS: 30,
          is_h265: 0,
          play_addr: { width: 720, height: 1280, data_size: 2_000_000, url_list: ['https://cdn/720-1.mp4'] },
        },
        {
          gear_name: 'normal_720_0',
          bit_rate: 1_830_533,
          format: 'mp4',
          FPS: 30,
          is_h265: 0,
          play_addr: { width: 720, height: 1280, data_size: 3_000_000, url_list: ['https://cdn/720.mp4'] },
        },
        {
          gear_name: '无地址档位',
          bit_rate: 999_999,
          play_addr: { width: 480, height: 854, url_list: [] },
        },
      ],
    },
  }
}

test('抖音详情转成档位列表时按分辨率去重只留最高码率', () => {
  const source = douyinDetailToFormatSource(createDetail())
  assert.ok(source)
  assert.deepEqual(
    source.rawFormats.map((item) => item.format_id).sort(),
    ['normal_1080_0', 'normal_720_0'],
  )
  assert.equal(source.directUrls.get('normal_720_0'), 'https://cdn/720.mp4')
  assert.equal(source.directUrls.has('无地址档位'), false)
})

test('详情里的标题、作者、时长与封面转成展示字段', () => {
  const source = douyinDetailToFormatSource(createDetail())
  assert.ok(source)
  assert.equal(source.title, '演示标题\n#话题')
  assert.equal(source.uploader, '演示作者')
  assert.equal(source.duration, 16)
  assert.equal(source.thumbnail, 'https://example.com/cover.jpeg')
})

test('码率按千位换算成表格用的 kbps，编码按标志位推断', () => {
  const source = douyinDetailToFormatSource(createDetail())
  assert.ok(source)
  const format1080 = source.rawFormats.find((item) => item.format_id === 'normal_1080_0')

  assert.equal(format1080?.tbr, 2450.473)
  assert.equal(format1080?.vcodec, 'h264')
  assert.equal(format1080?.acodec, 'aac')
  assert.equal(format1080?.filesize, 4_870_317)
})

test('h265 档位按标志位标记编码', () => {
  const detail = createDetail()
  const first = detail.video?.bit_rate?.[0]
  if (first) {
    first.is_h265 = 1
  }

  const source = douyinDetailToFormatSource(detail)
  assert.equal(source?.rawFormats[0]?.vcodec, 'h265')
})

test('没有可用直链时返回 null', () => {
  assert.equal(
    douyinDetailToFormatSource({ video: { bit_rate: [{ gear_name: 'x', bit_rate: 1 }] } }),
    null,
  )
})

test('识别抖音相关域名但排除直播站', () => {
  assert.equal(isDouyinVideoUrl('https://v.douyin.com/jgkgtdC9SxY/'), true)
  assert.equal(isDouyinVideoUrl('https://www.douyin.com/video/7691451841657439323'), true)
  assert.equal(isDouyinVideoUrl('https://www.iesdouyin.com/share/video/1/'), true)
  assert.equal(isDouyinVideoUrl('https://live.douyin.com/123'), false)
  assert.equal(isDouyinVideoUrl('https://www.bilibili.com/video/BV1'), false)
})

test('从视频页、分享页与详情接口地址里取出视频 ID', () => {
  assert.equal(extractAwemeId('https://www.douyin.com/video/7691451841657439323'), '7691451841657439323')
  assert.equal(
    extractAwemeId('https://www.iesdouyin.com/share/video/7691451841657439323/?region=CN'),
    '7691451841657439323',
  )
  assert.equal(
    extractAwemeId('https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7691451841657439323'),
    '7691451841657439323',
  )
  // 短链本身不带 ID，需要先跟一次跳转
  assert.equal(extractAwemeId('https://v.douyin.com/jgkgtdC9SxY/'), '')
})

test('详情响应按视频 ID 过滤，避免拿到别的视频', () => {
  const detailUrl = 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=111'

  assert.equal(isDetailForAweme(detailUrl, '111', '111'), true)
  assert.equal(isDetailForAweme(detailUrl, '222', '111'), false)
  assert.equal(isDetailForAweme(detailUrl, undefined, '111'), true)
  // 请求地址与响应体都拿不到 ID 时不拦，交给调用方按超时处理
  assert.equal(isDetailForAweme('https://www.douyin.com/aweme/v1/web/aweme/detail/', undefined, '111'), true)
  // 没指定期望 ID 时一律放行
  assert.equal(isDetailForAweme(detailUrl, '222', ''), true)
})

/**
 * 造一份抖音兜底解析结果
 * @returns 含 1080P / 720P 两档直链的结果
 */
function createDouyinProbe(): ProbeResult {
  const source = douyinDetailToFormatSource(createDetail())
  assert.ok(source)
  const normalized = normalizeProbeInfo({
    title: source.title,
    uploader: source.uploader,
    duration: source.duration,
    thumbnail: source.thumbnail,
    formats: source.rawFormats,
  })
  const formats: VideoFormat[] = normalized.formats.map((item) => ({
    ...item,
    directUrl: source.directUrls.get(item.formatId) ?? '',
  }))

  return {
    url: 'https://www.douyin.com/video/7691451841657439323',
    title: normalized.title,
    uploader: normalized.uploader,
    duration: normalized.duration,
    thumbnail: normalized.thumbnail,
    formats,
    audioFormats: [],
    hasVideoOnly: false,
    warning: '',
    source: 'douyin-web',
    probedAt: Date.now(),
  }
}

test('预设档位在直链结果上挑档：最高画质取第一档', () => {
  const picked = resolveDirectPresetFormat('best', createDouyinProbe())

  assert.equal(picked?.height, 1920)
})

test('预设档位在直链结果上挑档：≤1080P 按短边筛掉 2K', () => {
  const probe = createDouyinProbe()
  const picked = resolveDirectPresetFormat('best-1080', probe)

  assert.equal(picked?.width, 1080)
  assert.equal(picked?.height, 1920)
})

test('仅音频预设同样挑最高一档', () => {
  const picked = resolveDirectPresetFormat('audio-mp3', createDouyinProbe())

  assert.equal(picked?.directUrl, 'https://cdn/1080.mp4')
})

test('非直链来源不做预设挑档', () => {
  const probe = createDouyinProbe()

  assert.equal(resolveDirectPresetFormat('best', { ...probe, source: 'yt-dlp' }), undefined)
  assert.equal(resolveDirectPresetFormat('best', undefined), undefined)
})

test('桌面通道可用时，抖音预设下载必须有直链档位', () => {
  const probe = createDouyinProbe()
  const douyinUrl = 'https://www.douyin.com/video/7691451841657439323'

  setDouyinPageResolver(async () => null)
  try {
    // 缓存被挤出、或结果来自内置浏览器通道时，不能退回 yt-dlp
    assert.equal(requiresDirectFormat(douyinUrl, undefined), true)
    assert.equal(requiresDirectFormat(douyinUrl, probe), true)
    // yt-dlp 自己解析成功的结果照旧走 yt-dlp
    assert.equal(requiresDirectFormat(douyinUrl, { ...probe, source: 'yt-dlp' }), false)
    // 非抖音链接不受影响
    assert.equal(requiresDirectFormat('https://www.bilibili.com/video/BV1', undefined), false)
  } finally {
    setDouyinPageResolver(null)
  }

  // 纯 Node 运行时（网页版）没有内置浏览器通道，行为与改动前一致
  assert.equal(requiresDirectFormat(douyinUrl, undefined), false)
})

test('直链输出模板写成字面量并把百分号转义', () => {
  const format = createDouyinProbe().formats[0] as VideoFormat
  const args = buildDirectOutputArgs('D:\\downloads', '进度 100% 的视频', 'format', format, 2)

  assert.deepEqual(args, [
    '-P',
    'D:\\downloads',
    '-o',
    '进度 100%% 的视频 [1080x1920] (2).%(ext)s',
    '--windows-filenames',
  ])
})

test('直链输出模板按 yt-dlp 规则清洗标题里的换行与非法字符', () => {
  const format = createDouyinProbe().formats[0] as VideoFormat

  assert.equal(
    buildDirectOutputArgs('D:\\downloads', '第一行\n第二行:标题', 'format', format)[3],
    '第一行 第二行：标题 [1080x1920].%(ext)s',
  )
})

test('仅音频的直链输出模板不带分辨率后缀', () => {
  const format = createDouyinProbe().formats[0] as VideoFormat

  assert.equal(
    buildDirectOutputArgs('D:\\downloads', '演示标题', 'audio-mp3', format)[3],
    '演示标题.%(ext)s',
  )
})

test('直链输出模板在分辨率未知时与同名判定用同一套 NA 兜底', () => {
  const format = { ...(createDouyinProbe().formats[0] as VideoFormat), width: null, height: null }

  assert.equal(
    buildDirectOutputArgs('D:\\downloads', '演示标题', 'format', format)[3],
    '演示标题 [NAxNA].%(ext)s',
  )
})
