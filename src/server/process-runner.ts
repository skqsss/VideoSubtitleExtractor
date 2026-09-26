/**
 * @file 子进程封装
 * @author Codex
 * @description 所有外部命令统一经此执行：数组传参、禁用 shell、带超时，杜绝命令注入
 * @date 2026-09-26
 */

import { spawn } from 'node:child_process'

import { logger } from './logger.ts'

/** 单次命令执行结果 */
export interface CommandResult {
  /** 退出码，被强制终止时为 null */
  code: number | null
  stdout: string
  stderr: string
  /** 是否因超时被强制终止 */
  timedOut: boolean
}

/** 命令执行选项 */
export interface RunCommandOptions {
  /** 超时毫秒数 */
  timeoutMs?: number
  /** 工作目录 */
  cwd?: string
  /** 额外环境变量 */
  env?: NodeJS.ProcessEnv
}

/** 默认超时：解析与版本探测都属于短任务，超过 90 秒视为异常 */
const DEFAULT_TIMEOUT_MS = 90_000

/**
 * 执行外部命令并收集输出
 * @param bin - 可执行文件绝对路径
 * @param args - 参数数组，逐项传递，不拼接字符串
 * @param options - 超时、工作目录等
 * @returns 退出码与标准输出、标准错误
 * @remarks 始终以 shell:false 启动，URL 等外部输入不会被 shell 解释
 */
export function runCommand(
  bin: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    logger.debug('process-runner', '启动子进程', { bin, argCount: args.length })

    const child = spawn(bin, args, {
      shell: false,
      windowsHide: true,
      cwd: options.cwd,
      env: options.env ?? process.env,
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`无法启动 ${bin}：${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}
