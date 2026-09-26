/**
 * @file yt-dlp 错误映射单元测试
 * @author Codex
 * @description 覆盖文档 4.5 节的错误映射表，确保每种失败都有中文可执行提示
 * @date 2026-09-26
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mapYtdlpError, shouldRetryWithoutCookies } from '../src/shared/error-mapper.ts'
import { resolveEffectiveCookieBrowser } from '../src/server/ytdlp-service.ts'

test('需要登录时提示选择浏览器读取 Cookie', () => {
  const mapped = mapYtdlpError('ERROR: Sign in to confirm you are not a bot', 1)

  assert.equal(mapped.code, 'NEED_LOGIN')
  assert.match(mapped.message, /浏览器/)
})

test('不支持的链接给出链接形态提示', () => {
  const mapped = mapYtdlpError('ERROR: Unsupported URL: https://example.com', 1)

  assert.equal(mapped.code, 'UNSUPPORTED_URL')
  assert.match(mapped.message, /视频详情页/)
})

test('网络问题提示检查代理与直连策略', () => {
  const mapped = mapYtdlpError('ERROR: Unable to download webpage: timed out', 1)

  assert.equal(mapped.code, 'NETWORK')
  assert.match(mapped.message, /代理/)
})

test('会员专享提示权限不足', () => {
  const mapped = mapYtdlpError(
    'ERROR: This video is only available for registered users to view',
    1,
  )

  assert.equal(mapped.code, 'PREMIUM_REQUIRED')
  assert.match(mapped.message, /会员/)
})

test('浏览器 Cookie 解密失败给出可执行的解决办法', () => {
  const mapped = mapYtdlpError('ERROR: Failed to decrypt with DPAPI.', 1, 'probe')

  assert.equal(mapped.code, 'COOKIE_DECRYPT')
  assert.match(mapped.message, /完全退出浏览器/)
})

test('抖音要求新鲜 Cookie 时提示配置 cookies.txt', () => {
  const mapped = mapYtdlpError(
    'ERROR: [Douyin] 7689: Fresh cookies (not necessarily logged in) are needed',
    1,
    'probe',
  )

  assert.equal(mapped.code, 'NEED_FRESH_COOKIES')
  assert.match(mapped.message, /cookies\.txt/)
})

test('浏览器没有 Cookie 数据库时同样归入 Cookie 可读性问题', () => {
  const mapped = mapYtdlpError(
    "ERROR: could not find firefox cookies database in 'C:\\x'",
    1,
  )

  assert.equal(mapped.code, 'COOKIE_DECRYPT')
})

test('浏览器运行时数据库被占用也归入 Cookie 可读性问题', () => {
  const mapped = mapYtdlpError(
    'ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271',
    1,
    'probe',
  )

  assert.equal(mapped.code, 'COOKIE_DECRYPT')
})

test('Cookie 读不出来时允许丢掉 Cookie 重试，平台要求新鲜 Cookie 时不允许', () => {
  assert.equal(shouldRetryWithoutCookies('COOKIE_DECRYPT', ''), true)
  assert.equal(shouldRetryWithoutCookies('NEED_FRESH_COOKIES', 'fresh cookies'), false)
  // 未归类但输出里出现 cookie 时，仍给一次不带 Cookie 的机会
  assert.equal(shouldRetryWithoutCookies('UNKNOWN', 'Something about cookie went wrong'), true)
  assert.equal(shouldRetryWithoutCookies('UNKNOWN', 'plain network failure'), false)
})

test('配了 cookies.txt 就不再默认读浏览器 Cookie，显式选择时两者都用', () => {
  // 跟随设置 + 有 Cookie 文件 → 不读浏览器，省掉必然失败的 2 秒
  assert.equal(resolveEffectiveCookieBrowser(undefined, 'edge', true), 'none')
  // 跟随设置 + 没有 Cookie 文件 → 用配置里的浏览器
  assert.equal(resolveEffectiveCookieBrowser(undefined, 'edge', false), 'edge')
  // 界面上明确选了浏览器 → 尊重选择
  assert.equal(resolveEffectiveCookieBrowser('chrome', 'edge', true), 'chrome')
  // 界面上明确选了不读取
  assert.equal(resolveEffectiveCookieBrowser('none', 'edge', true), 'none')
})

test('解析阶段无法归类时措辞不写成下载失败', () => {
  const mapped = mapYtdlpError('ERROR: unexpected failure', 2, 'probe')

  assert.match(mapped.message, /解析失败/)
  assert.doesNotMatch(mapped.message, /下载失败/)
})

test('无关键词命中时提示查看原始日志', () => {
  const mapped = mapYtdlpError('ERROR: something unexpected happened', 3)

  assert.equal(mapped.code, 'UNKNOWN')
  assert.match(mapped.message, /退出码 3/)
  assert.match(mapped.message, /查看原始日志/)
})

test('退出码为 null 视为任务被取消', () => {
  const mapped = mapYtdlpError('', null)

  assert.equal(mapped.code, 'CANCELED')
  assert.match(mapped.message, /取消/)
})
