/**
 * @file 服务端日志
 * @author sqksss
 * @description 统一日志出口，级别化输出，避免散落的 console 调试残留
 * @date 2026-09-26
 */

/** 日志级别 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 附加在日志后的结构化上下文 */
type LogContext = Record<string, unknown>

/** 是否开启 debug 级别（需要排查细节时设置 VIDEO_FETCH_DEBUG=1） */
const isDebugEnabled = process.env.VIDEO_FETCH_DEBUG === '1'

/**
 * 输出一条日志
 * @param level - 日志级别
 * @param scope - 模块名，便于检索
 * @param message - 中文描述
 * @param context - 结构化上下文，禁止放 Cookie 等敏感内容
 */
function writeLog(
  level: LogLevel,
  scope: string,
  message: string,
  context?: LogContext,
): void {
  if (level === 'debug' && !isDebugEnabled) {
    return
  }

  const payload = context ? ` ${JSON.stringify(context)}` : ''
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${scope}] ${message}${payload}`

  if (level === 'error') {
    process.stderr.write(`${line}\n`)
    return
  }

  process.stdout.write(`${line}\n`)
}

/** 统一日志接口 */
export const logger = {
  /**
   * 输出调试日志
   * @param scope - 模块名
   * @param message - 中文描述
   * @param context - 结构化上下文
   */
  debug(scope: string, message: string, context?: LogContext): void {
    writeLog('debug', scope, message, context)
  },
  /**
   * 输出关键节点日志
   * @param scope - 模块名
   * @param message - 中文描述
   * @param context - 结构化上下文
   */
  info(scope: string, message: string, context?: LogContext): void {
    writeLog('info', scope, message, context)
  },
  /**
   * 输出可恢复异常日志
   * @param scope - 模块名
   * @param message - 中文描述
   * @param context - 结构化上下文
   */
  warn(scope: string, message: string, context?: LogContext): void {
    writeLog('warn', scope, message, context)
  },
  /**
   * 输出需要关注的异常日志
   * @param scope - 模块名
   * @param message - 中文描述
   * @param context - 结构化上下文
   */
  error(scope: string, message: string, context?: LogContext): void {
    writeLog('error', scope, message, context)
  },
}
