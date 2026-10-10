/**
 * @file 服务端业务异常
 * @author sqksss
 * @description 单独成文件，避免 ytdlp-service 与 cookie-service 互相 import 造成循环依赖
 * @date 2026-09-26
 */

import type { YtdlpErrorCode } from '../shared/error-mapper.ts'

/** 带错误码的业务异常，HTTP 层据此返回 { error: { code, message } } */
export class YtdlpError extends Error {
  readonly code: YtdlpErrorCode

  /**
   * @param code - 错误码，供前端分支判断
   * @param message - 中文提示
   */
  constructor(code: YtdlpErrorCode, message: string) {
    super(message)
    this.name = 'YtdlpError'
    this.code = code
  }
}
