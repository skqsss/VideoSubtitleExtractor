/**
 * @file 冒烟自检运行器
 * @author sqksss
 * @description 直接拉起 Electron 跑真实运行形态（app:// 页面 + preload + IPC），
 * 退出码即结果：0 通过，1 检查项未过，2 超时
 * @date 2026-10-10
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import electronPath from 'electron'

/** 冒烟自检入口产物 */
const SMOKE_ENTRY = path.resolve('dist-electron', 'smoke.mjs')

if (!fs.existsSync(SMOKE_ENTRY)) {
  process.stderr.write('缺少 dist-electron/smoke.mjs，请先执行 npm run build:main\n')
  process.exit(1)
}

const child = spawn(electronPath, [SMOKE_ENTRY], { stdio: 'inherit' })

child.on('exit', (code) => {
  process.exit(code ?? 1)
})
