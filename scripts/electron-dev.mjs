/**
 * @file 开发态启动 Electron 外壳
 * @author sqksss
 * @description 让窗口直接加载 Vite 开发服务器（带热更新），不必每次改功能都重新打包 exe
 * @date 2026-09-26
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'

import electronPath from 'electron'

/** Vite 开发服务器地址，可用环境变量覆盖 */
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173'

if (!fs.existsSync('dist-electron/main.mjs')) {
  process.stderr.write('缺少 dist-electron/main.mjs，请先执行 npm run build:main\n')
  process.exit(1)
}

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl },
})

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
