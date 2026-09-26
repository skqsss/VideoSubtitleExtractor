/**
 * @file cookies.txt 解析与合并单元测试
 * @author Codex
 * @description 覆盖多站点导出合并、去重与域名汇总，保证 B 站与抖音可以各一份一起用
 * @date 2026-09-26
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mergeCookieContents, parseCookieContent } from '../src/shared/cookie-utils.ts'

/** Netscape 文件的制表符 */
const TAB = '\t'

/**
 * 拼一行 Cookie
 * @param domain - 域
 * @param name - 名称
 * @param value - 值
 * @returns 文件行
 */
function cookieLine(domain: string, name: string, value: string): string {
  return [domain, 'TRUE', '/', 'FALSE', '1900000000', name, value].join(TAB)
}

test('解析时忽略注释、保留 HttpOnly Cookie', () => {
  const content = [
    '# Netscape HTTP Cookie File',
    '# 这是注释',
    `#HttpOnly_${cookieLine('.douyin.com', 'ttwid', 'abc')}`,
    cookieLine('.bilibili.com', 'SESSDATA', 'def'),
    '这一行不是 Cookie',
  ].join('\n')

  const lines = parseCookieContent(content)

  assert.equal(lines.length, 2)
  assert.deepEqual(
    lines.map((line) => line.name),
    ['ttwid', 'SESSDATA'],
  )
})

test('合并两个站点的导出，域名分别保留', () => {
  const bilibili = ['# Netscape HTTP Cookie File', cookieLine('.bilibili.com', 'SESSDATA', 'b1')].join(
    '\n',
  )
  const douyin = [
    '# Netscape HTTP Cookie File',
    cookieLine('.douyin.com', 'ttwid', 'd1'),
    cookieLine('.douyin.com', 'odin_tt', 'd2'),
  ].join('\n')

  const merged = mergeCookieContents([bilibili, douyin])

  assert.equal(merged.summary.fileCount, 2)
  assert.equal(merged.summary.cookieCount, 3)
  assert.deepEqual(merged.summary.domains, ['bilibili.com', 'douyin.com'])
  assert.deepEqual(merged.summary.namesByDomain['douyin.com'], ['odin_tt', 'ttwid'])
  assert.deepEqual(merged.summary.namesByDomain['bilibili.com'], ['SESSDATA'])
  assert.ok(merged.content.startsWith('# Netscape HTTP Cookie File'))
  assert.ok(merged.content.includes('SESSDATA'))
  assert.ok(merged.content.includes('odin_tt'))
})

test('同一域名+路径+名称的 Cookie 以后出现的为准', () => {
  const older = cookieLine('.bilibili.com', 'SESSDATA', 'old')
  const newer = cookieLine('.bilibili.com', 'SESSDATA', 'new')

  const merged = mergeCookieContents([older, newer])

  assert.equal(merged.summary.cookieCount, 1)
  assert.ok(merged.content.includes('new'))
  assert.ok(!merged.content.includes('old'))
})

test('HttpOnly 前缀不影响域名汇总', () => {
  const content = `#HttpOnly_${cookieLine('.bilibili.com', 'SESSDATA', 'x')}`

  const merged = mergeCookieContents([content])

  assert.deepEqual(merged.summary.domains, ['bilibili.com'])
  assert.deepEqual(merged.summary.namesByDomain, { 'bilibili.com': ['SESSDATA'] })
})

test('空文件或无效内容得到 0 条 Cookie', () => {
  const merged = mergeCookieContents(['', '随便一段文本'])

  assert.equal(merged.summary.cookieCount, 0)
  assert.deepEqual(merged.summary.domains, [])
  assert.equal(merged.summary.skippedFiles, 2)
})

test('目录里混入非 Cookie 的 txt 时被跳过，其余文件照常生效', () => {
  const note = '把导出的 cookies.txt 放进这个文件夹。'
  const real = cookieLine('.douyin.com', 'ttwid', 'd1')

  const merged = mergeCookieContents([note, real])

  assert.equal(merged.summary.cookieCount, 1)
  assert.equal(merged.summary.skippedFiles, 1)
  assert.deepEqual(merged.summary.domains, ['douyin.com'])
})
