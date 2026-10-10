/**
 * @file 业务操作层单元测试
 * @author sqksss
 * @description 覆盖入参校验与错误翻译：界面拿到的错误码要能区分"参数不合法"和"业务失败"
 * @date 2026-10-10
 */

import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { createOperations, toErrorBody, type Operations } from '../src/server/operations.ts'
import { TaskManager } from '../src/server/task-manager.ts'
import type { AppConfig } from '../src/shared/types.ts'

/**
 * 构造测试用配置
 * @returns 路径全部指向临时目录的配置，避免碰到项目里的 bin 与下载目录
 */
function createTestConfig(): AppConfig {
  const root = path.join(os.tmpdir(), 'vse-operations-test')

  return {
    ytdlpPath: path.join(root, 'yt-dlp.exe'),
    ffmpegDir: path.join(root, 'ffmpeg'),
    downloadDir: path.join(root, 'downloads'),
    cookieBrowser: 'none',
    cookiesFile: '',
    proxy: '',
    concurrency: 1,
  }
}

/**
 * 构造操作集合
 * @returns 操作集合，配置写入不做持久化
 */
function createTestOperations(): Operations {
  const config = createTestConfig()
  const taskManager = new TaskManager(() => config)

  return createOperations({
    getConfig: () => config,
    setConfig: () => config,
    taskManager,
  })
}

/**
 * 把 Promise 的拒绝原因取出来
 * @param promise - 预期失败的调用
 * @returns 拒绝原因，成功时返回 null
 */
async function catchReason(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (reason: unknown) => reason,
  )
}

test('解析参数为空：报参数不合法，而不是内部错误', async () => {
  const operations = createTestOperations()
  const reason = await catchReason(operations.probe({}))

  assert.notEqual(reason, null)
  assert.equal(toErrorBody(reason).code, 'INVALID_PARAMS')
})

test('文本里没有链接：报链接不可用', async () => {
  const operations = createTestOperations()
  const reason = await catchReason(operations.startTask({ url: '这段文字里没有链接', mode: 'best' }))

  assert.equal(toErrorBody(reason).code, 'UNSUPPORTED_URL')
})

test('取消不存在的任务：返回 ok:false，不抛异常', async () => {
  const operations = createTestOperations()

  assert.deepEqual(await operations.cancelTask('not-exist'), { ok: false })
})

test('任务 ID 为空：报参数不合法', async () => {
  const operations = createTestOperations()
  const reason = await catchReason(operations.revealTask('   '))

  assert.equal(toErrorBody(reason).code, 'INVALID_PARAMS')
})

test('并发数越界：报参数不合法', async () => {
  const operations = createTestOperations()
  const reason = await catchReason(operations.setConfig({ concurrency: 9 }))

  assert.equal(toErrorBody(reason).code, 'INVALID_PARAMS')
})

test('任务列表初始为空', async () => {
  const operations = createTestOperations()

  assert.deepEqual(await operations.listTasks(undefined), { tasks: [] })
})

test('读取配置：返回当前配置本身', async () => {
  const operations = createTestOperations()
  const config = await operations.getConfig(undefined)

  assert.equal(config.concurrency, 1)
  assert.equal(config.cookieBrowser, 'none')
})

test('非业务异常：只给通用提示，不把内部细节抛给界面', () => {
  const body = toErrorBody(new Error('boom'))

  assert.equal(body.code, 'UNKNOWN')
  assert.equal(body.message, '主进程内部出现异常，请查看日志文件。')
})
