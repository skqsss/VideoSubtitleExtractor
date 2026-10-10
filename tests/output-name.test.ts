/**
 * @file 产物文件名唯一化单元测试
 * @author sqksss
 * @description 覆盖"同名文件改用序号命名"的命名预测、序号挑选与输出模板，避免又退回"复用旧文件"
 * @date 2026-09-30
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import {
  buildOutputBasePattern,
  resolveNextOutputIndex,
  resolveNextOutputIndexFromPath,
  sanitizeWindowsFilename,
  splitOutputIndex,
  stripFileExtension,
} from '../src/server/output-name.ts'
import { buildOutputArgs } from '../src/server/ytdlp-service.ts'

/** 本次测试用到的临时目录，收尾时统一删除 */
const tempDirs: string[] = []

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * 建一个空的下载目录
 * @param fileNames - 预先放进去的文件名
 * @returns 目录绝对路径
 */
function createDownloadDir(fileNames: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfp-output-'))
  tempDirs.push(dir)

  for (const fileName of fileNames) {
    fs.writeFileSync(path.join(dir, fileName), '')
  }

  return dir
}

test('标题里的 Windows 非法字符按 yt-dlp 的替代字符转换', () => {
  assert.equal(sanitizeWindowsFilename('a:b*c?d"e<f>g|h'), 'a：b＊c？d＂e＜f＞g｜h')
})

test('斜杠与反斜杠转成数学符号，与 yt-dlp 写盘结果一致', () => {
  assert.equal(sanitizeWindowsFilename('a/b\\c'), 'a⧸b⧹c')
})

test('控制字符与换行按 yt-dlp 的结果处理', () => {
  assert.equal(sanitizeWindowsFilename('a\u0001b\nc'), 'ab c')
})

test('视频档位的同名判定忽略标题后的分辨率', () => {
  const pattern = buildOutputBasePattern('演示视频', 'format')

  assert.equal(pattern.test('演示视频 [1920x1080]'), true)
  assert.equal(pattern.test('演示视频 [NAxNA]'), true)
  assert.equal(pattern.test('演示视频 加长版 [1920x1080]'), false)
  assert.equal(pattern.test('演示视频'), false)
})

test('指定档位时按实际分辨率精确匹配', () => {
  const pattern = buildOutputBasePattern('演示视频', 'format', { width: 1920, height: 1080 })

  assert.equal(pattern.test('演示视频 [1920x1080]'), true)
  assert.equal(pattern.test('演示视频 [1280x720]'), false)
})

test('分辨率未知的档位按 NA 匹配', () => {
  const pattern = buildOutputBasePattern('演示视频', 'format', { width: null, height: null })

  assert.equal(pattern.test('演示视频 [NAxNA]'), true)
  assert.equal(pattern.test('演示视频 [1920x1080]'), false)
})

test('音频档位的同名判定只认标题本身', () => {
  const pattern = buildOutputBasePattern('演示视频', 'audio-mp3')

  assert.equal(pattern.test('演示视频'), true)
  assert.equal(pattern.test('演示视频 [1920x1080]'), false)
})

test('同名判定跟随 yt-dlp 的非法字符替换', () => {
  const pattern = buildOutputBasePattern('第1集:开始*了', 'format')

  assert.equal(pattern.test('第1集：开始＊了 [1280x720]'), true)
})

test('拆分文件名主体与序号', () => {
  assert.deepEqual(splitOutputIndex('演示视频 [1920x1080]'), {
    base: '演示视频 [1920x1080]',
    index: 0,
  })
  assert.deepEqual(splitOutputIndex('演示视频 [1920x1080] (2)'), {
    base: '演示视频 [1920x1080]',
    index: 2,
  })
})

test('去掉扩展名只去掉最后一段', () => {
  assert.equal(stripFileExtension('演示视频 [1920x1080].mp4'), '演示视频 [1920x1080]')
  assert.equal(stripFileExtension('第1.2集.mp4'), '第1.2集')
  assert.equal(stripFileExtension('无扩展名'), '无扩展名')
})

test('目录里没有同名文件时沿用原名', () => {
  const dir = createDownloadDir(['别的视频 [1920x1080].mp4'] )

  assert.equal(resolveNextOutputIndex(dir, (base) => base === '演示视频 [1920x1080]'), 0)
})

test('同名文件已存在时返回下一个序号', () => {
  const dir = createDownloadDir([
    '演示视频 [1920x1080].mp4',
    '演示视频 [1280x720].mp4',
  ])
  const pattern = buildOutputBasePattern('演示视频', 'format')

  assert.equal(resolveNextOutputIndex(dir, (base) => pattern.test(base)), 1)
})

test('跳过已被占用的序号', () => {
  const dir = createDownloadDir([
    '演示视频 [1920x1080].mp4',
    '演示视频 [1920x1080] (1).mp4',
    '演示视频 [1920x1080] (2).mp4',
  ])
  const pattern = buildOutputBasePattern('演示视频', 'format')

  assert.equal(resolveNextOutputIndex(dir, (base) => pattern.test(base)), 3)
})

test('序号中间有空位时优先补空位', () => {
  const dir = createDownloadDir([
    '演示视频.mp3',
    '演示视频 (2).mp3',
  ])
  const pattern = buildOutputBasePattern('演示视频', 'audio-mp3')

  assert.equal(resolveNextOutputIndex(dir, (base) => pattern.test(base)), 1)
})

test('忽略目录里的子目录', () => {
  const dir = createDownloadDir()
  fs.mkdirSync(path.join(dir, '演示视频 [1920x1080].mp4'))
  const pattern = buildOutputBasePattern('演示视频', 'format')

  assert.equal(resolveNextOutputIndex(dir, (base) => pattern.test(base)), 0)
})

test('按 yt-dlp 报告的复用路径反推序号', () => {
  const dir = createDownloadDir([
    '演示视频 [1920x1080].mp4',
    '演示视频 [1920x1080] (1).mp4',
  ])

  assert.equal(
    resolveNextOutputIndexFromPath(dir, path.join(dir, '演示视频 [1920x1080].mp4')),
    2,
  )
  assert.equal(
    resolveNextOutputIndexFromPath(dir, path.join(dir, '演示视频 [1920x1080] (1).mp4')),
    2,
  )
})

test('输出模板按序号插入后缀', () => {
  assert.deepEqual(buildOutputArgs('D:\\downloads', 'format'), [
    '-P',
    'D:\\downloads',
    '-o',
    '%(title)s [%(width)sx%(height)s].%(ext)s',
    '--windows-filenames',
  ])
  assert.equal(
    buildOutputArgs('D:\\downloads', 'format', 2)[3],
    '%(title)s [%(width)sx%(height)s] (2).%(ext)s',
  )
  assert.equal(
    buildOutputArgs('D:\\downloads', 'audio-mp3', 1)[3],
    '%(title)s (1).%(ext)s',
  )
})
