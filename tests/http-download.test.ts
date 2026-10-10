/**
 * @file 文件下载（超时 / 断流 / 重试）单元测试
 * @author sqksss
 * @description 覆盖"下载卡住要能自己结束"这条链路：空闲超时、总时长上限、断流重试与 4xx 不重试
 * @date 2026-10-01
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

import { downloadFile } from '../src/server/http-download.ts'

/** 测试期间启动的服务与临时文件，收尾统一清理 */
const servers: http.Server[] = []
const tempDirs: string[] = []

after(() => {
  for (const server of servers) {
    server.closeAllConnections?.()
    server.close()
  }

  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * 生成一个临时落盘路径
 * @returns 文件绝对路径
 */
function createTargetPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfp-download-'))
  tempDirs.push(dir)

  return path.join(dir, 'out.bin')
}

/**
 * 启动一个本地 HTTP 服务
 * @param handler - 请求处理函数
 * @returns 可供下载的地址
 */
async function startServer(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/file.bin`
}

test('正常下载写全内容', async () => {
  const payload = Buffer.from('hello-yt-dlp')
  const url = await startServer((_request, response) => {
    response.writeHead(200, { 'content-length': String(payload.length) })
    response.end(payload)
  })
  const targetPath = createTargetPath()
  const result = await downloadFile({ url, targetPath })

  assert.equal(result.bytes, payload.length)
  assert.equal(result.attempts, 1)
  assert.equal(fs.readFileSync(targetPath).toString('utf8'), 'hello-yt-dlp')
})

test('服务端不再吐数据时按空闲超时结束', async () => {
  const url = await startServer((_request, response) => {
    response.writeHead(200, { 'content-length': '1000' })
    response.write('partial')
    // 之后既不发数据也不结束，模拟断流
  })
  const targetPath = createTargetPath()

  await assert.rejects(
    downloadFile({ url, targetPath, idleTimeoutMs: 300, attempts: 1 }),
    /下载中断（1 秒没有收到数据）/,
  )
  assert.equal(fs.existsSync(targetPath), false)
})

test('第一次下到一半断掉，重试后拿到完整文件', async () => {
  const payload = Buffer.from('0123456789abcdef')
  let calls = 0
  const url = await startServer((request, response) => {
    calls += 1
    if (calls === 1) {
      response.writeHead(200, { 'content-length': String(payload.length) })
      response.write(payload.subarray(0, 8))
      request.socket.destroy()

      return
    }

    response.writeHead(200, { 'content-length': String(payload.length) })
    response.end(payload)
  })
  const targetPath = createTargetPath()
  const result = await downloadFile({ url, targetPath, attempts: 3 })

  assert.equal(result.attempts, 2)
  assert.equal(result.bytes, payload.length)
  // 半截文件必须被丢掉，不能出现"半截 + 完整"的拼接
  assert.equal(fs.readFileSync(targetPath).toString('utf8'), '0123456789abcdef')
})

test('404 属于确定性失败，不重试', async () => {
  let calls = 0
  const url = await startServer((_request, response) => {
    calls += 1
    response.writeHead(404)
    response.end('not found')
  })
  const targetPath = createTargetPath()

  await assert.rejects(downloadFile({ url, targetPath, attempts: 3 }), /HTTP 404/)
  assert.equal(calls, 1)
})

test('服务端一直不响应时按总时长上限结束', async () => {
  const url = await startServer(() => {
    // 既不写响应头也不结束，模拟连不上/被挂住
  })
  const targetPath = createTargetPath()

  await assert.rejects(
    downloadFile({ url, targetPath, totalTimeoutMs: 300, idleTimeoutMs: 10_000, attempts: 1 }),
    /下载超时（单次超过 1 秒）/,
  )
})
