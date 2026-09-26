/**
 * @file 本地服务入口（开发与网页版运行入口）
 * @author Codex
 * @description 读取配置、启动服务并托管任务管理器；用完即停，不常驻后台
 * @date 2026-09-26
 */

import type { AppConfig } from '../shared/types.ts'
import { checkHealth } from './binary-service.ts'
import { loadConfig, saveConfig } from './config.ts'
import { startHttpServer } from './http-server.ts'
import { logger } from './logger.ts'
import { TaskManager } from './task-manager.ts'

/** 当前生效配置，PUT /api/config 会就地更新 */
let currentConfig: AppConfig = loadConfig()

const taskManager = new TaskManager(() => currentConfig)

/**
 * 启动本地服务
 */
async function bootstrap(): Promise<void> {
  const health = await checkHealth(currentConfig)
  if (!health.ok) {
    logger.warn('index', '外部依赖自检未通过', { message: health.message })
  } else {
    logger.info('index', '外部依赖自检通过', {
      ytdlp: health.ytdlp.version,
      downloadDir: health.downloadDir,
    })
  }

  const app = await startHttpServer({
    getConfig: () => currentConfig,
    setConfig: (patch) => {
      currentConfig = saveConfig(patch)

      return currentConfig
    },
    taskManager,
  })

  const address = `http://127.0.0.1:${currentConfig.port}`
  process.stdout.write(`\n本地服务已启动：${address}\n`)
  process.stdout.write(`下载目录：${health.downloadDir}\n`)
  process.stdout.write(`开发页面：另开终端执行 npm run dev（Vite 会代理 /api 到本服务）\n\n`)

  const shutdown = async (signal: string): Promise<void> => {
    logger.info('index', '收到退出信号，正在关闭', { signal })
    await taskManager.dispose()
    await app.close()
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
}

bootstrap().catch((error: unknown) => {
  logger.error('index', '服务启动失败', { reason: (error as Error).message })
  process.exit(1)
})
