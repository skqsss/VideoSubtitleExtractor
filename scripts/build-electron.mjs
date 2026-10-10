/**
 * @file 构建 Electron 端产物
 * @author sqksss
 * @description 主进程、冒烟自检与预加载三个入口一起打包；
 * 预加载在沙箱下只能是 CommonJS，所以单独出一次 .cjs，不能和主进程共用一次构建
 * @date 2026-10-10
 */

import { build } from 'esbuild'

/** 两次构建共用配置：electron 与 zod 不打进产物，运行时从 node_modules 解析 */
const COMMON_OPTIONS = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  external: ['electron', 'zod'],
  logLevel: 'info',
}

await build({
  ...COMMON_OPTIONS,
  format: 'esm',
  entryPoints: { main: 'electron/main.ts', smoke: 'electron/smoke.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.mjs' },
})

await build({
  ...COMMON_OPTIONS,
  format: 'cjs',
  entryPoints: { preload: 'electron/preload.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
})
