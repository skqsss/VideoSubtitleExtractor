/**
 * @file 本地 HTTP 服务（网页版调试与开发入口）
 * @author Codex
 * @description 只监听 127.0.0.1，暴露解析/下载/配置接口，并用 SSE 推送任务进度
 * @date 2026-09-26
 */

import fs from 'node:fs'
import path from 'node:path'
import type { ServerResponse } from 'node:http'

import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { ZodError } from 'zod'

import type { ApiErrorBody, AppConfig } from '../shared/types.ts'
import { checkHealth, updateYtdlp } from './binary-service.ts'
import { PROJECT_ROOT } from './config.ts'
import { logger } from './logger.ts'
import { configSchema, probeSchema, startTaskSchema } from './schemas.ts'
import type { TaskManager } from './task-manager.ts'
import { YtdlpError, probeVideo } from './ytdlp-service.ts'

/** 仅监听回环地址，不对局域网开放 */
const LISTEN_HOST = '127.0.0.1'

/** SSE 心跳间隔，避免代理或浏览器提前断开 */
const SSE_HEARTBEAT_MS = 20_000

/** 前端构建产物目录 */
const RENDERER_DIST = path.join(PROJECT_ROOT, 'dist')

/** 服务运行上下文 */
export interface ServerContext {
  /** 读取当前配置 */
  getConfig: () => AppConfig
  /** 更新配置 */
  setConfig: (patch: Partial<AppConfig>) => AppConfig
  /** 任务管理器 */
  taskManager: TaskManager
}

/**
 * 启动 HTTP 服务
 * @param context - 服务运行上下文
 * @returns Fastify 实例
 */
export async function startHttpServer(context: ServerContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 })

  // 取消、定位文件这类接口没有请求体，浏览器/PowerShell 可能不带任何 content-type，
  // 默认解析器会直接返回 415，这里补一个兜底解析器，让"无体请求"也能正常进路由
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body)
  })

  registerErrorHandler(app)
  registerHealthRoutes(app, context)
  registerConfigRoutes(app, context)
  registerProbeRoutes(app, context)
  registerTaskRoutes(app, context)
  await registerStaticRoutes(app)

  const port = context.getConfig().port
  await app.listen({ host: LISTEN_HOST, port })
  logger.info('http-server', '服务已启动', { host: LISTEN_HOST, port })

  return app
}

/**
 * 注册统一错误处理：所有错误都返回 { error: { code, message } }
 * @param app - Fastify 实例
 */
function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof YtdlpError) {
      reply.status(400).send(buildErrorBody(error.code, error.message))

      return
    }

    if (error instanceof ZodError) {
      const firstIssue = error.issues[0]
      reply.status(400).send(
        buildErrorBody('INVALID_PARAMS', firstIssue?.message ?? '请求参数不合法'),
      )

      return
    }

    const reason = error instanceof Error ? error.message : String(error)
    logger.error('http-server', '未预期的服务端错误', { reason })
    reply.status(500).send(buildErrorBody('UNKNOWN', '服务端出现异常，请查看服务端日志。'))
  })
}

/**
 * 组装统一错误响应体
 * @param code - 错误码
 * @param message - 中文提示
 * @returns 响应体
 */
function buildErrorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } }
}

/**
 * 注册自检接口
 * @param app - Fastify 实例
 * @param context - 服务上下文
 */
function registerHealthRoutes(app: FastifyInstance, context: ServerContext): void {
  app.get('/api/health', async () => checkHealth(context.getConfig()))
}

/**
 * 注册配置接口
 * @param app - Fastify 实例
 * @param context - 服务上下文
 */
function registerConfigRoutes(app: FastifyInstance, context: ServerContext): void {
  app.get('/api/config', async () => context.getConfig())

  app.put('/api/config', async (request) => {
    const patch = configSchema.parse(request.body ?? {})

    return context.setConfig(patch)
  })

  app.post('/api/ytdlp/update', async () => {
    const version = await updateYtdlp(context.getConfig())

    return { version }
  })
}

/**
 * 注册解析接口
 * @param app - Fastify 实例
 * @param context - 服务上下文
 */
function registerProbeRoutes(app: FastifyInstance, context: ServerContext): void {
  app.post('/api/probe', async (request) => {
    const params = probeSchema.parse(request.body ?? {})

    return probeVideo(params, context.getConfig())
  })
}

/**
 * 注册任务接口
 * @param app - Fastify 实例
 * @param context - 服务上下文
 */
function registerTaskRoutes(app: FastifyInstance, context: ServerContext): void {
  app.post('/api/tasks', async (request) => {
    const params = startTaskSchema.parse(request.body ?? {})
    const task = context.taskManager.createTask(params)

    return { taskId: task.id }
  })

  app.get('/api/tasks', async () => ({ tasks: context.taskManager.listTasks() }))

  app.post('/api/tasks/:id/cancel', async (request) => {
    const taskId = readTaskId(request.params)

    return { ok: await context.taskManager.cancelTask(taskId) }
  })

  app.post('/api/tasks/:id/reveal', async (request) => {
    const taskId = readTaskId(request.params)
    context.taskManager.revealTask(taskId)

    return { ok: true }
  })

  app.get('/api/events', (request, reply) => {
    streamTaskEvents(reply, context.taskManager, request.raw, reply.raw)
  })

  app.get('/api/tasks/:id/events', (request, reply) => {
    const taskId = readTaskId(request.params)
    streamTaskEvents(reply, context.taskManager, request.raw, reply.raw, taskId)
  })
}

/**
 * 从路由参数中取任务 ID
 * @param params - 路由参数对象
 * @returns 任务 ID 字符串
 */
function readTaskId(params: unknown): string {
  const value = (params as { id?: string }).id ?? ''

  return value
}

/**
 * 建立 SSE 通道并推送任务变更
 * @param reply - Fastify 响应对象
 * @param taskManager - 任务管理器
 * @param request - 原始请求对象（用于监听断开）
 * @param response - 原始响应对象
 * @param filterTaskId - 仅推送该任务的事件
 */
function streamTaskEvents(
  reply: { hijack: () => void },
  taskManager: TaskManager,
  request: NodeJS.ReadableStream,
  response: ServerResponse,
  filterTaskId?: string,
): void {
  reply.hijack()
  // EventSource 要求 MIME 必须是 text/event-stream，否则浏览器会直接判定连接失败
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // 让中间层不要缓冲，保证进度是实时的
    'X-Accel-Buffering': 'no',
  })
  response.write('retry: 2000\n\n')

  const heartbeat = setInterval(() => {
    response.write(': keep-alive\n\n')
  }, SSE_HEARTBEAT_MS)

  const unsubscribe = taskManager.onTask((task) => {
    if (filterTaskId && task.id !== filterTaskId) {
      return
    }

    response.write(`event: task\ndata: ${JSON.stringify(task)}\n\n`)
  })

  const close = (): void => {
    clearInterval(heartbeat)
    unsubscribe()
    response.end()
  }

  request.on('close', close)
  request.on('error', close)
}

/**
 * 注入前端构建产物；未构建时返回提示页，便于区分"没构建"和"服务没起来"
 * @param app - Fastify 实例
 */
async function registerStaticRoutes(app: FastifyInstance): Promise<void> {
  if (fs.existsSync(RENDERER_DIST)) {
    await app.register(fastifyStatic, { root: RENDERER_DIST, prefix: '/' })
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        reply.status(404).send(buildErrorBody('NOT_FOUND', '接口不存在'))

        return
      }

      reply.sendFile('index.html')
    })

    return
  }

  app.get('/', async (_request, reply) => {
    reply.type('text/html; charset=utf-8')

    return FALLBACK_PAGE
  })
}

/** 未构建前端时的占位页 */
const FALLBACK_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>本地服务已启动</title>
    <style>
      body { font-family: system-ui, "Microsoft YaHei", sans-serif; margin: 40px; color: #14181A; }
      code { font-family: ui-monospace, Consolas, monospace; background: #EFF1EF; padding: 2px 6px; }
    </style>
  </head>
  <body>
    <h1>本地服务已启动</h1>
    <p>尚未构建前端页面。开发时请另开终端运行 <code>npm run dev</code> 打开 Vite 页面，或先执行 <code>npm run build</code> 后刷新本页。</p>
    <p>接口自检：<a href="/api/health">/api/health</a></p>
  </body>
</html>
`
