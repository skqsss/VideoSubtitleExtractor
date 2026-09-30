/**
 * @file 下载重试判定单元测试
 * @author Codex
 * @description 覆盖"复用最终文件要换序号重下、复用合并前分片不能重下"的分支
 * @date 2026-09-30
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shouldRetryWithNewName } from '../src/server/task-manager.ts'

test('没有复用旧文件时不重试', () => {
  assert.equal(shouldRetryWithNewName({ reusedPaths: [], hasPostProcessedOutput: false }, 0), false)
})

test('复用了最终产物时换序号重下', () => {
  assert.equal(
    shouldRetryWithNewName(
      { reusedPaths: ['D:\\downloads\\演示视频 [1920x1080].mp4'], hasPostProcessedOutput: false },
      0,
    ),
    true,
  )
})

test('复用的只是合并前分片时不重试', () => {
  assert.equal(
    shouldRetryWithNewName(
      {
        reusedPaths: ['D:\\downloads\\演示视频 [1920x1080].f137.mp4'],
        hasPostProcessedOutput: true,
      },
      0,
    ),
    false,
  )
})

test('抽取音轨产出了新文件时不重试', () => {
  assert.equal(
    shouldRetryWithNewName(
      { reusedPaths: ['D:\\downloads\\演示视频.m4a'], hasPostProcessedOutput: true },
      0,
    ),
    false,
  )
})

test('改名次数用尽后不再重试', () => {
  assert.equal(
    shouldRetryWithNewName(
      { reusedPaths: ['D:\\downloads\\演示视频 [1920x1080].mp4'], hasPostProcessedOutput: false },
      10,
    ),
    false,
  )
})
