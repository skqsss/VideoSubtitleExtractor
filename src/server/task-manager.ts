/**
 * @file 下载任务队列
 * @author sqksss
 * @description 串行执行下载任务，解析进度、支持取消并清理残留文件
 * @date 2026-09-26
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'

import { mapYtdlpError, shouldRetryWithoutCookies } from '../shared/error-mapper.ts'
import {
  DOWNLOAD_PRESETS,
  buildFormatArgs,
  formatResolution,
} from '../shared/format-utils.ts'
import type {
  AppConfig,
  CookieBrowser,
  DownloadMode,
  DownloadTask,
  ProbeResult,
  StartTaskParams,
  VideoFormat,
} from '../shared/types.ts'
import {
  ensureDownloadDir,
  resolveFfmpegDir,
  resolveYtdlpPath,
} from './config.ts'
import { prepareCookiesFile } from './cookie-service.ts'
import { hasDouyinPageResolver, isDouyinVideoUrl } from './douyin-service.ts'
import { YtdlpError } from './errors.ts'
import { logger } from './logger.ts'
import {
  buildOutputBasePattern,
  resolveNextOutputIndex,
  resolveNextOutputIndexFromPath,
} from './output-name.ts'
import { runCommand } from './process-runner.ts'
import {
  PROGRESS_LINE_MARKER,
  buildCommonArgs,
  buildDirectOutputArgs,
  buildFfmpegArgs,
  buildOutputArgs,
  buildProgressArgs,
  buildYtdlpEnv,
  findCachedFormat,
  getCachedProbe,
  inferTitleFromPath,
  normalizeVideoUrl,
  resolveEffectiveCookieBrowser,
} from './ytdlp-service.ts'

/** 原始日志保留行数，够定位问题又不至于占内存 */
const LOG_LINE_LIMIT = 200

/** 单个任务的进度更新最短间隔，避免刷屏式推送 */
const PROGRESS_THROTTLE_MS = 200

/** 同名文件改名重试上限：只有目录里堆满同序号的文件才会用尽 */
const MAX_OUTPUT_NAME_RETRIES = 10

/** 改名重试仍复用了旧文件时的提示 */
const REUSED_OUTPUT_WARNING =
  '同名文件已存在，且自动改名后仍命中旧文件，本次直接复用了磁盘上的旧文件（可能与所选档位不同）。'

/** Cookie 降级说明，展示在任务条目上 */
const COOKIE_FALLBACK_WARNING =
  '浏览器 Cookie 读取失败（Chrome / Edge 新版加密），已改为未登录状态下载，清晰度可能受限。'

/** 正在运行的任务句柄 */
interface RunningTask {
  child: ChildProcessWithoutNullStreams
  /** 用户是否已请求取消 */
  cancelRequested: boolean
  /** yt-dlp 本次任务写出的目标文件（用于取消后精确清理残留） */
  destinationPaths: Set<string>
  /** yt-dlp 判定"已下载"而复用的旧文件 */
  reusedPaths: Set<string>
  /** 本次是否产出了后处理产物（合并 / 转码），用于区分"复用分片"与"复用最终文件" */
  hasPostProcessedOutput: boolean
  /** 最后一个进度推送时间 */
  lastEmittedAt: number
}

/** 一次下载尝试的执行结果 */
interface DownloadOutcome {
  /** 退出码，被强制终止或未启动时为 null */
  code: number | null
  /** 标准错误与标准输出拼接文本 */
  output: string
  /** 是否被用户取消 */
  canceled: boolean
  /** 本次写出的目标文件路径 */
  destinationPaths: Set<string>
  /** yt-dlp 复用的同名旧文件路径 */
  reusedPaths: string[]
  /** 本次是否产出了后处理产物（合并 / 转码） */
  hasPostProcessedOutput: boolean
  /** 启动或参数阶段的错误，优先于退出码判断 */
  error?: { code: string; message: string }
}

/**
 * 下载任务管理器
 * @remarks 配置通过回调实时读取，设置里改并发数或下载目录后立即生效
 */
export class TaskManager {
  private readonly tasks = new Map<string, DownloadTask>()

  private readonly pendingIds: string[] = []

  private readonly runningTasks = new Map<string, RunningTask>()

  private readonly logLines = new Map<string, string[]>()

  /** 每个任务创建时的请求参数与已解析档位，避免排队期间解析缓存被挤出 */
  private readonly taskRequests = new Map<
    string,
    {
      cookieBrowser?: CookieBrowser
      proxy?: string
      format?: VideoFormat
    }
  >()

  private readonly listeners = new Set<(task: DownloadTask) => void>()

  /** 读取当前配置的回调 */
  private readonly getConfig: () => AppConfig

  /**
   * @param getConfig - 读取当前配置
   */
  constructor(getConfig: () => AppConfig) {
    this.getConfig = getConfig
  }

  /**
   * 订阅任务变更
   * @param listener - 收到任务快照的回调
   * @returns 取消订阅的函数
   */
  onTask(listener: (task: DownloadTask) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 列出全部任务（新建在前）
   * @returns 任务快照数组
   */
  listTasks(): DownloadTask[] {
    return [...this.tasks.values()].sort((left, right) => right.createdAt - left.createdAt)
  }

  /**
   * 读取单个任务
   * @param taskId - 任务 ID
   * @returns 任务快照，不存在返回 undefined
   */
  getTask(taskId: string): DownloadTask | undefined {
    return this.tasks.get(taskId)
  }

  /**
   * 创建下载任务并入队
   * @param params - 创建参数
   * @returns 新建的任务快照
   * @throws YtdlpError 链接或档位不合法时抛出
   */
  createTask(params: StartTaskParams): DownloadTask {
    const config = this.getConfig()
    const url = normalizeVideoUrl(params.url)
    // 提前校验 Cookie 配置，避免任务排队后才失败
    resolveTaskCookiesFile(config)
    const cachedProbe = getCachedProbe(url)
    const format =
      params.mode === 'format'
        ? this.resolveFormat(url, params)
        : resolveDirectPresetFormat(params.mode, cachedProbe)

    // 抖音只能按直链下载：预设模式拿不到直链档位时（解析缓存被挤出、或结果来自别的通道），
    // 继续把页面地址交给 yt-dlp 只会白等几十秒，再报一个和成因无关的 403
    if (params.mode !== 'format' && !format && requiresDirectFormat(url, cachedProbe)) {
      throw new YtdlpError(
        'FORMAT_UNAVAILABLE',
        '抖音的档位信息已失效，请重新解析这个链接后再下载。',
      )
    }

    const preset = DOWNLOAD_PRESETS.find((item) => item.mode === params.mode)
    const taskId = crypto.randomUUID()
    const now = Date.now()

    const task: DownloadTask = {
      id: taskId,
      url,
      title: cachedProbe?.title ?? url,
      formatLabel: format ? describeFormat(format) : (preset?.label ?? params.mode),
      mode: params.mode,
      status: 'queued',
      percent: 0,
      speed: '',
      eta: '',
      downloadedBytes: 0,
      totalBytes: null,
      outputPath: '',
      error: '',
      errorCode: '',
      warning: '',
      log: '',
      createdAt: now,
      updatedAt: now,
    }

    this.tasks.set(taskId, task)
    this.logLines.set(taskId, [])
    this.taskRequests.set(taskId, {
      cookieBrowser: params.cookieBrowser,
      proxy: params.proxy,
      format,
    })
    this.pendingIds.push(taskId)
    this.emit(task)
    this.pump()

    logger.info('task-manager', '任务已入队', {
      taskId,
      mode: params.mode,
      downloadDir: ensureDownloadDir(config),
    })

    return { ...task }
  }

  /**
   * 取消任务：排队中的直接移除，运行中的终止进程并清理残留
   * @param taskId - 任务 ID
   * @returns 是否成功处理（任务不存在或已结束时返回 false）
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId)
    if (!task) {
      return false
    }

    const pendingIndex = this.pendingIds.indexOf(taskId)
    if (pendingIndex >= 0) {
      this.pendingIds.splice(pendingIndex, 1)
      this.updateTask(task, { status: 'canceled', error: '', errorCode: '' })

      return true
    }

    const running = this.runningTasks.get(taskId)
    if (!running) {
      return false
    }

    running.cancelRequested = true
    logger.info('task-manager', '正在取消任务', { taskId })
    await killProcessTree(running.child.pid)

    return true
  }

  /**
   * 在资源管理器中定位产物文件
   * @param taskId - 任务 ID
   * @throws YtdlpError 任务不存在或尚无产物时抛出
   */
  revealTask(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new YtdlpError('UNKNOWN', '任务不存在或已失效。')
    }

    const target = task.outputPath || ensureDownloadDir(this.getConfig())
    if (!fs.existsSync(target)) {
      throw new YtdlpError('UNKNOWN', '产物文件不存在，可能已被移动或删除。')
    }

    const args = fs.statSync(target).isDirectory() ? [target] : ['/select,', target]
    const child = spawn('explorer.exe', args, { detached: true, windowsHide: true, shell: false })
    child.on('error', (error) => {
      logger.warn('task-manager', '打开资源管理器失败', { reason: error.message })
    })
    child.unref()
  }

  /**
   * 关闭全部运行中的任务（进程退出时调用）
   */
  async dispose(): Promise<void> {
    for (const running of this.runningTasks.values()) {
      running.cancelRequested = true
      await killProcessTree(running.child.pid)
    }
  }

  /**
   * 从解析缓存中取出指定档位
   * @param url - 链接
   * @param params - 创建参数
   * @returns 命中的档位
   * @throws YtdlpError 缺少档位 ID 或缓存失效时抛出
   */
  private resolveFormat(url: string, params: StartTaskParams) {
    if (!params.formatId) {
      throw new YtdlpError('FORMAT_UNAVAILABLE', '请先选择要下载的档位。')
    }

    const format = findCachedFormat(url, params.formatId)
    if (!format) {
      throw new YtdlpError('FORMAT_UNAVAILABLE', '档位信息已失效，请重新解析后下载。')
    }

    return format
  }

  /**
   * 按并发上限启动排队中的任务
   */
  private pump(): void {
    const currentConfig = this.getConfig()

    while (
      this.pendingIds.length > 0 &&
      this.runningTasks.size < Math.max(1, currentConfig.concurrency)
    ) {
      const taskId = this.pendingIds.shift()
      if (!taskId) {
        return
      }

      const task = this.tasks.get(taskId)
      if (task && task.status === 'queued') {
        void this.runTask(task)
      }
    }
  }

  /**
   * 执行单个下载任务
   * @param task - 任务快照
   * @remarks 浏览器 Cookie 读不出来时（Chrome / Edge 新版加密）自动降级为不读取 Cookie 重试一次，
   * 否则用户会在下载这一步被环境问题直接挡住
   * 下载目录里已有同名文件时改用带序号的文件名重下，yt-dlp 的"已下载"判定只在退回旧文件时才生效
   */
  private async runTask(task: DownloadTask): Promise<void> {
    try {
      const config = this.getConfig()
      const downloadDir = ensureDownloadDir(config)
      const taskRequest = this.taskRequests.get(task.id)
      const cookiesFile = resolveTaskCookiesFile(config)
      let useBrowserCookies =
        resolveEffectiveCookieBrowser(
          taskRequest?.cookieBrowser,
          config.cookieBrowser,
          Boolean(cookiesFile),
        ) !== 'none'
      const basePattern = buildOutputBasePattern(task.title, task.mode, taskRequest?.format)
      // 先按解析到的标题探一次同名文件，命中就直接写到 `(序号)` 上，省掉一轮"复用旧文件"的空跑
      let outputIndex = resolveNextOutputIndex(downloadDir, (baseName) => basePattern.test(baseName))
      let nameRetryCount = 0
      let hasTriedCookieFallback = false

      for (;;) {
        const outcome = await this.spawnAttempt(task, useBrowserCookies, outputIndex)

        if (outcome.canceled) {
          this.finishCanceled(task, outcome)
          this.pump()

          return
        }

        if (outcome.error) {
          this.failTask(task, outcome.error.message, outcome.error.code, [])
          this.pump()

          return
        }

        if (outcome.code === 0) {
          if (shouldRetryWithNewName(outcome, nameRetryCount)) {
            nameRetryCount += 1
            outputIndex = Math.max(
              outputIndex + 1,
              resolveNextOutputIndexFromPath(downloadDir, outcome.reusedPaths[0]),
            )
            this.appendLog(
              task.id,
              `[本工具] 下载目录已有同名文件，改用第 ${outputIndex} 个副本的文件名重新下载`,
            )
            this.resetProgress(task)

            continue
          }

          if (outcome.reusedPaths.length > 0 && !outcome.hasPostProcessedOutput) {
            this.updateTask(task, { warning: REUSED_OUTPUT_WARNING })
          }

          this.finishDone(task, outcome)
          this.pump()

          return
        }

        const mapped = mapYtdlpError(outcome.output, outcome.code)
        if (
          useBrowserCookies &&
          !hasTriedCookieFallback &&
          shouldRetryWithoutCookies(mapped.code, outcome.output)
        ) {
          hasTriedCookieFallback = true
          useBrowserCookies = false
          this.appendLog(task.id, '[本工具] 浏览器 Cookie 读取失败，改为不读取 Cookie 重新下载')
          this.resetProgress(task)
          this.updateTask(task, { warning: COOKIE_FALLBACK_WARNING })

          continue
        }

        this.failTask(task, mapped.message, mapped.code, [])
        this.pump()

        return
      }
    } finally {
      this.taskRequests.delete(task.id)
    }
  }

  /**
   * 启动一次 yt-dlp 下载并等待进程结束
   * @param task - 任务快照
   * @param useBrowserCookies - 本次是否读取浏览器 Cookie
   * @param outputIndex - 同名文件序号，0 表示沿用原名
   * @returns 本次执行结果
   */
  private spawnAttempt(
    task: DownloadTask,
    useBrowserCookies: boolean,
    outputIndex: number,
  ): Promise<DownloadOutcome> {
    const config = this.getConfig()
    const ytdlpPath = resolveYtdlpPath(config)
    const downloadDir = ensureDownloadDir(config)
    const ffmpegDir = resolveFfmpegDir(config)
    const taskRequest = this.taskRequests.get(task.id)
    const cookiesFile = resolveTaskCookiesFile(config)
    const emptyOutcome = {
      code: null,
      output: '',
      canceled: false,
      destinationPaths: new Set<string>(),
      reusedPaths: [] as string[],
      hasPostProcessedOutput: false,
    }

    let args: string[]
    try {
      const directFormat = taskRequest?.format
      const directUrl = directFormat?.directUrl ?? ''
      args = directFormat && directUrl
        ? [
            // 直链是音视频一体的 mp4，不需要选轨，只有"仅音频"要额外抽一条音轨出来
            ...(task.mode === 'audio-mp3' ? ['-x', '--audio-format', 'mp3'] : []),
            ...buildDirectOutputArgs(downloadDir, task.title, task.mode, directFormat, outputIndex),
            ...buildFfmpegArgs(ffmpegDir),
            ...buildProgressArgs(),
            // 抖音 CDN 校验 Referer，缺了会直接返回 403
            '--add-header',
            'Referer:https://www.douyin.com/',
            ...buildCommonArgs('none', taskRequest?.proxy ?? config.proxy, cookiesFile),
            directUrl,
          ]
        : [
            ...buildFormatArgs(task.mode, taskRequest?.format),
            ...buildOutputArgs(downloadDir, task.mode, outputIndex),
            ...buildFfmpegArgs(ffmpegDir),
            ...buildProgressArgs(),
            ...(task.mode === 'audio-mp3' ? [] : ['--merge-output-format', 'mp4']),
            ...buildCommonArgs(
              useBrowserCookies ? (taskRequest?.cookieBrowser ?? config.cookieBrowser) : 'none',
              taskRequest?.proxy ?? config.proxy,
              cookiesFile,
            ),
            task.url,
          ]
    } catch (error) {
      return Promise.resolve({
        ...emptyOutcome,
        error: { code: 'FORMAT_UNAVAILABLE', message: (error as Error).message },
      })
    }

    this.updateTask(task, { status: 'running' })

    return new Promise((resolve) => {
      const child = spawn(ytdlpPath, args, {
        shell: false,
        windowsHide: true,
        cwd: downloadDir,
        env: buildYtdlpEnv(),
      })
      const running: RunningTask = {
        child,
        cancelRequested: false,
        destinationPaths: new Set<string>(),
        reusedPaths: new Set<string>(),
        hasPostProcessedOutput: false,
        lastEmittedAt: 0,
      }
      this.runningTasks.set(task.id, running)

      let stdoutBuffer = ''
      let stderrText = ''

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString('utf8')
        const lines = stdoutBuffer.split(/\r?\n/)
        stdoutBuffer = lines.pop() ?? ''
        for (const line of lines) {
          this.handleLine(task, running, line)
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        stderrText += text
        for (const line of text.split(/\r?\n/)) {
          this.handleLine(task, running, line)
        }
      })
      child.on('error', (error) => {
        this.runningTasks.delete(task.id)
        resolve({
          ...emptyOutcome,
          error: { code: 'UNKNOWN', message: `无法启动 yt-dlp：${error.message}` },
        })
      })
      child.on('close', (code) => {
        this.runningTasks.delete(task.id)
        if (stdoutBuffer.trim()) {
          this.handleLine(task, running, stdoutBuffer)
        }

        resolve({
          code,
          output: `${stderrText}\n${stdoutBuffer}`,
          canceled: running.cancelRequested,
          destinationPaths: running.destinationPaths,
          reusedPaths: [...running.reusedPaths],
          hasPostProcessedOutput: running.hasPostProcessedOutput,
        })
      })
    })
  }

  /**
   * 处理 yt-dlp 的一行输出：识别进度、目标文件与错误
   * @param task - 任务快照
   * @param running - 运行句柄
   * @param rawLine - 原始输出行
   */
  private handleLine(task: DownloadTask, running: RunningTask, rawLine: string): void {
    const line = rawLine.trim()
    if (!line) {
      return
    }

    this.appendLog(task.id, line)

    if (line.startsWith(PROGRESS_LINE_MARKER)) {
      this.handleProgressJson(task, running, line.slice(PROGRESS_LINE_MARKER.length))
      this.flushTask(task, running)

      return
    }

    const fallback = /^\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*\w+)\s+at\s+(.+?)\s+ETA\s+(.+)$/.exec(
      line,
    )
    if (fallback) {
      this.applyProgress(task, running, {
        percent: Number(fallback[1]),
        speed: normalizeProgressText(fallback[3]),
        eta: normalizeProgressText(fallback[4]),
        downloadedBytes: null,
        totalBytes: parseSizeToBytes(fallback[2]),
      })
      this.flushTask(task, running)

      return
    }

    const destination = /^\[(download|ExtractAudio)\] Destination: (.+)$/.exec(line)
    if (destination?.[2]) {
      const destinationPath = destination[2].trim()
      if (destination[1] === 'ExtractAudio') {
        // 抽取音轨会转出一个新的最终文件，这种情况不能算"什么都没下"
        running.hasPostProcessedOutput = true
      }

      if (!running.destinationPaths.has(destinationPath)) {
        running.destinationPaths.add(destinationPath)
        // 合并下载会依次拉视频轨与音轨，新轨道开始时重置进度，避免进度条卡在 100%
        task.percent = 0
        task.downloadedBytes = 0
        task.totalBytes = null
      }
    }

    const merged = /^\[Merger\] Merging formats into "(.+)"$/.exec(line)
    if (merged?.[1]) {
      running.hasPostProcessedOutput = true
      this.updateTask(task, { outputPath: merged[1].trim() })
    }

    const downloaded = /^\[download\] (.+) has already been downloaded$/.exec(line)
    if (downloaded?.[1]) {
      const reusedPath = downloaded[1].trim()
      running.reusedPaths.add(reusedPath)
      this.updateTask(task, { outputPath: reusedPath })
    }
  }

  /**
   * 重置进度相关字段
   * @param task - 任务快照
   * @remarks 换文件名或换 Cookie 重下时，沿用上一轮的进度会让进度条卡在旧位置
   */
  private resetProgress(task: DownloadTask): void {
    this.updateTask(task, {
      percent: 0,
      speed: '',
      eta: '',
      downloadedBytes: 0,
      totalBytes: null,
      outputPath: '',
      warning: '',
    })
  }

  /**
   * 解析 --progress-template 输出的 JSON 行
   * @param task - 任务快照
   * @param running - 运行句柄
   * @param payload - download: 之后的 JSON 文本
   */
  private handleProgressJson(task: DownloadTask, running: RunningTask, payload: string): void {
    try {
      const parsed = JSON.parse(payload) as {
        p?: string
        sp?: string
        eta?: string
        dl?: string
        total?: string
        totalEst?: string
      }
      const percent = Number.parseFloat(normalizeProgressText(parsed.p).replace('%', ''))

      if (Number.isNaN(percent)) {
        return
      }

      this.applyProgress(task, running, {
        percent,
        speed: normalizeProgressText(parsed.sp),
        eta: normalizeProgressText(parsed.eta),
        downloadedBytes: parseSizeToBytes(parsed.dl),
        totalBytes: parseSizeToBytes(parsed.total) ?? parseSizeToBytes(parsed.totalEst),
      })
    } catch {
      // 进度模板被未来版本改动时忽略该行，交给标准输出回退解析
      logger.debug('task-manager', '进度行解析失败，已忽略', { lineLength: payload.length })
    }
  }

  /**
   * 更新任务进度字段
   * @param task - 任务快照
   * @param running - 运行句柄
   * @param progress - 本次解析出的进度
   */
  private applyProgress(
    task: DownloadTask,
    _running: RunningTask,
    progress: {
      percent: number
      speed: string
      eta: string
      downloadedBytes: number | null
      totalBytes: number | null
    },
  ): void {
    task.percent = Math.min(100, Math.max(task.percent, Math.round(progress.percent)))
    task.speed = progress.speed || task.speed
    task.eta = progress.eta || task.eta

    if (progress.downloadedBytes !== null) {
      task.downloadedBytes = progress.downloadedBytes
    }

    if (progress.totalBytes !== null && progress.totalBytes > 0) {
      task.totalBytes = progress.totalBytes
    }
  }

  /**
   * 推送任务快照（受节流控制，避免每秒几十次无意义刷新）
   * @param task - 任务快照
   * @param running - 运行句柄，用于记录上次推送时间
   */
  private flushTask(task: DownloadTask, running: RunningTask): void {
    const now = Date.now()
    if (now - running.lastEmittedAt < PROGRESS_THROTTLE_MS && task.percent < 100) {
      task.updatedAt = now
      return
    }

    running.lastEmittedAt = now
    task.updatedAt = Date.now()
    this.emit(task)
  }

  /**
   * 收尾：任务被取消
   * @param task - 任务快照
   * @param outcome - 本次执行结果
   */
  private finishCanceled(task: DownloadTask, outcome: DownloadOutcome): void {
    const removed = cleanupPartialFiles(outcome.destinationPaths)
    logger.info('task-manager', '任务已取消', { taskId: task.id, removedFiles: removed })
    this.updateTask(task, {
      status: 'canceled',
      percent: 0,
      speed: '',
      eta: '',
      error: '',
      errorCode: '',
      outputPath: '',
    })
  }

  /**
   * 收尾：任务完成
   * @param task - 任务快照
   * @param outcome - 本次执行结果
   */
  private finishDone(task: DownloadTask, outcome: DownloadOutcome): void {
    const outputPath = task.outputPath || inferOutputPath(outcome.destinationPaths)
    this.updateTask(task, {
      status: 'done',
      percent: 100,
      speed: '',
      eta: '',
      outputPath,
      title: task.title === task.url ? inferTitleFromPath(outputPath) || task.title : task.title,
    })
    logger.info('task-manager', '任务完成', { taskId: task.id, outputPath })
  }

  /**
   * 把任务标记为失败
   * @param task - 任务快照
   * @param message - 中文提示
   * @param code - 错误码
   * @param _extra - 预留的附加日志
   */
  private failTask(
    task: DownloadTask,
    message: string,
    code: string,
    _extra: string[],
  ): void {
    logger.warn('task-manager', '任务失败', { taskId: task.id, code })
    this.updateTask(task, {
      status: 'error',
      speed: '',
      eta: '',
      error: message,
      errorCode: code,
    })
  }

  /**
   * 更新任务字段并推送
   * @param task - 任务快照
   * @param patch - 需要修改的字段
   */
  private updateTask(task: DownloadTask, patch: Partial<DownloadTask>): void {
    Object.assign(task, patch, { updatedAt: Date.now() })
    this.emit(task)
  }

  /**
   * 推送任务快照给订阅者
   * @param task - 任务快照
   */
  private emit(task: DownloadTask): void {
    task.log = this.buildLog(task.id)
    const snapshot: DownloadTask = { ...task }
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  /**
   * 追加原始日志
   * @param taskId - 任务 ID
   * @param line - 日志行
   */
  private appendLog(taskId: string, line: string): void {
    const lines = this.logLines.get(taskId) ?? []
    lines.push(line)
    if (lines.length > LOG_LINE_LIMIT) {
      lines.splice(0, lines.length - LOG_LINE_LIMIT)
    }
    this.logLines.set(taskId, lines)
  }

  /**
   * 组装任务日志文本
   * @param taskId - 任务 ID
   * @returns 日志文本
   */
  private buildLog(taskId: string): string {
    return (this.logLines.get(taskId) ?? []).join('\n')
  }
}

/**
 * 判断本次尝试是否需要换一个序号重下
 * @param outcome - 本次尝试的结果
 * @param retryCount - 已经重试过的次数
 * @returns 需要换名重下时返回 true
 * @remarks yt-dlp 报的"已下载"分两种：复用最终产物（本次其实什么都没下，必须换序号重下），
 * 以及复用合并前留下的分片（合并照样产出了新文件，再重下一遍只会白费带宽并多留一个文件）
 */
export function shouldRetryWithNewName(
  outcome: { reusedPaths: string[]; hasPostProcessedOutput: boolean },
  retryCount: number,
): boolean {
  return (
    outcome.reusedPaths.length > 0 &&
    !outcome.hasPostProcessedOutput &&
    retryCount < MAX_OUTPUT_NAME_RETRIES
  )
}

/**
 * 判断预设模式是否必须拿到直链档位
 * @param url - 链接
 * @param probe - 解析缓存里的结果
 * @returns 必须拿到直链档位时返回 true
 * @remarks 抖音链接在桌面版走内置浏览器通道，直链是唯一可行的下载方式：
 * 缓存缺失（上限 20 条，解析完一批再回头下载就可能被挤出）或结果来自该通道时，
 * 退回 yt-dlp 没有任何意义，不如直接提示重新解析；
 * 若结果是 yt-dlp 自己解析出来的（上游适配后会出现），则不拦，照原样走 yt-dlp
 */
export function requiresDirectFormat(url: string, probe: ProbeResult | undefined): boolean {
  if (!isDouyinVideoUrl(url) || !hasDouyinPageResolver()) {
    return false
  }

  return probe === undefined || probe.source === 'douyin-web'
}

/**
 * 预设模式在直链解析结果上挑一档
 * @param mode - 下载模式
 * @param probe - 解析缓存里的结果
 * @returns 命中的档位；不是直链来源或没有可用档位时返回 undefined
 * @remarks 抖音兜底解析出的每一档都是独立直链，无法交给 yt-dlp 按 `-S` / `-f` 自己挑，
 * 因此预设模式先在这里选定档位，下载时再走同一条直链流程
 */
export function resolveDirectPresetFormat(
  mode: DownloadMode,
  probe: ProbeResult | undefined,
): VideoFormat | undefined {
  if (!probe || probe.source !== 'douyin-web') {
    return undefined
  }

  const directFormats = probe.formats.filter((item) => Boolean(item.directUrl))
  if (directFormats.length === 0) {
    return undefined
  }

  if (mode === 'best-1080') {
    // 竖屏视频的"1080P"指短边，因此按宽高中的较小值筛；没有更小的档就退回最低一档
    return (
      directFormats.find((item) => Math.min(item.width ?? 0, item.height ?? 0) <= 1080) ??
      directFormats[directFormats.length - 1]
    )
  }

  // 最高画质与仅音频都取最高一档：码率越高，抽出的音轨质量越好
  return directFormats[0]
}

/**
 * 取出本次下载要用的 Cookie 文件（多个来源已合并成一个）
 * @param config - 应用配置
 * @returns 合并后文件的绝对路径，未配置时返回空字符串
 * @throws YtdlpError Cookie 路径不存在或内容不可解析时抛出
 */
function resolveTaskCookiesFile(config: AppConfig): string {
  try {
    return prepareCookiesFile(config.cookiesFile)
  } catch (error) {
    throw new YtdlpError('COOKIE_FILE_MISSING', (error as Error).message)
  }
}

/**
 * 把任务状态与档位信息拼成一句话描述
 * @param format - 档位
 * @returns 如 137 · 1920×1080 · avc1
 */
function describeFormat(format: {
  formatId: string
  vcodec: string
  acodec: string
  width: number | null
  height: number | null
  isAudioOnly: boolean
  isVideoOnly: boolean
}): string {
  const resolution = formatResolution(format)
  const trackHint = format.isVideoOnly ? '（含最佳音轨）' : format.isAudioOnly ? '（纯音频）' : ''

  return `${format.formatId} · ${resolution} · ${format.vcodec === 'none' ? format.acodec : format.vcodec}${trackHint}`
}

/**
 * 终止进程树
 * @param pid - 进程 ID
 * @remarks yt-dlp 会派生 ffmpeg 子进程，必须整树终止，否则合并阶段会留下孤儿进程
 */
async function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) {
    return
  }

  try {
    await runCommand('taskkill.exe', ['/pid', String(pid), '/T', '/F'], {
      timeoutMs: 15_000,
    })
  } catch (error) {
    logger.warn('task-manager', '终止进程树失败', { reason: (error as Error).message })
  }
}

/**
 * 清理取消任务留下的中间文件
 * @param destinationPaths - 本次任务写出的目标文件路径
 * @returns 实际删除的文件数量
 */
function cleanupPartialFiles(destinationPaths: Set<string>): number {
  let removed = 0

  for (const destination of destinationPaths) {
    for (const suffix of ['.part', '.ytdl', '']) {
      const target = `${destination}${suffix}`
      if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true })
        removed += 1
      }
    }
  }

  return removed
}

/**
 * 从本次任务写出的路径里推断最终产物
 * @param destinationPaths - 目标文件路径集合
 * @returns 产物路径，无法推断时返回空字符串
 */
function inferOutputPath(destinationPaths: Set<string>): string {
  const candidates = [...destinationPaths].filter((item) => !item.endsWith('.part'))
  const merged = candidates.find((item) => item.endsWith('.mp4') || item.endsWith('.mp3'))

  return merged ?? candidates[candidates.length - 1] ?? ''
}

/**
 * 把 yt-dlp 的进度文本规范为可展示内容
 * @param value - 原始文本，如 " 4.20MiB/s" 或 "N/A"
 * @returns 规范化文本，无意义内容返回空字符串
 */
function normalizeProgressText(value: string | undefined): string {
  const text = (value ?? '').trim()
  if (!text || text === 'NA' || text === 'N/A' || text === 'Unknown' || text === '--:--') {
    return ''
  }

  return text
}

/**
 * 把 yt-dlp 的尺寸文本解析为字节数
 * @param value - 如 "820.34MiB"、"12" 或 "NA"
 * @returns 字节数，无法解析时返回 null
 */
function parseSizeToBytes(value: string | undefined): number | null {
  const text = (value ?? '').trim()
  if (!text || text === 'NA' || text === 'None' || text === 'N/A') {
    return null
  }

  const match = /^([\d.]+)\s*([KMGTP]?i?B)?$/i.exec(text)
  if (!match?.[1]) {
    return null
  }

  const amount = Number.parseFloat(match[1])
  if (Number.isNaN(amount)) {
    return null
  }

  // KiB / MiB 与 KB / MB 在本项目里统一按 1024 进制换算，用于展示量级足够
  const unit = (match[2] ?? 'B').toUpperCase().replace('I', '')
  const scale = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'].indexOf(unit)

  return Math.round(amount * 1024 ** (scale >= 0 ? scale : 0))
}
