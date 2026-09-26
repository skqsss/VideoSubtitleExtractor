/**
 * @file 分享文本链接提取单元测试
 * @author Codex
 * @description 用真实平台的分享文案覆盖提取规则，避免把标题、说明一起送进 yt-dlp
 * @date 2026-09-26
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { extractVideoUrl } from '../src/shared/url-utils.ts'

test('抖音分享文案：提取链接并丢掉前后噪声', () => {
  const shareText =
    '7.15 :5pm JvS:/ 02/24 D@H.VL 猫猫为亚运会加油（访客🙋） # 千金淑猫 # cos # 求圈摇  ' +
    'https://v.douyin.com/_D7EJqUEvWQ/ 复制此链接，打开Dou音搜索，直接观看视频！'

  assert.equal(extractVideoUrl(shareText), 'https://v.douyin.com/_D7EJqUEvWQ/')
})

test('B 站分享文案：带标题前缀与查询参数', () => {
  const shareText =
    '【哟齁齁齁齁~♡】 https://www.bilibili.com/video/BV1usopB9ETZ/?share_source=copy_web&vd_source=e42e31cf4c0b80d31ae264b237b66d11'

  assert.equal(
    extractVideoUrl(shareText),
    'https://www.bilibili.com/video/BV1usopB9ETZ/?share_source=copy_web&vd_source=e42e31cf4c0b80d31ae264b237b66d11',
  )
})

test('中文紧贴链接末尾时不会被带进链接', () => {
  assert.equal(
    extractVideoUrl('分享自抖音 https://v.douyin.com/AbCdEf/复制此链接打开APP'),
    'https://v.douyin.com/AbCdEf/',
  )
})

test('链接被中英文标点包围时去掉尾部标点', () => {
  assert.equal(extractVideoUrl('看这个 https://b23.tv/abc123).'), 'https://b23.tv/abc123')
  assert.equal(extractVideoUrl('（https://b23.tv/abc123，）'), 'https://b23.tv/abc123')
})

test('纯链接输入保持原样', () => {
  assert.equal(
    extractVideoUrl('  https://www.bilibili.com/video/BV1usopB9ETZ/  '),
    'https://www.bilibili.com/video/BV1usopB9ETZ/',
  )
})

test('没有链接或只有非 http 协议时返回 null', () => {
  assert.equal(extractVideoUrl('这段文字里没有链接'), null)
  assert.equal(extractVideoUrl('file:///D:/video.mp4'), null)
  assert.equal(extractVideoUrl(''), null)
})

test('多个链接时取第一个', () => {
  assert.equal(
    extractVideoUrl('https://b23.tv/first 和 https://b23.tv/second'),
    'https://b23.tv/first',
  )
})
