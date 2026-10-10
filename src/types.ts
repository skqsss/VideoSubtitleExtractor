/**
 * @file 前端类型出口
 * @author sqksss
 * @description 统一从共享类型再导出，组件只 import 本文件，传输层换代时无需改组件
 * @date 2026-09-26
 */

export type {
  AppConfig,
  CookieBrowser,
  CookieInspectResult,
  DownloadMode,
  DownloadTask,
  HealthResult,
  ProbeParams,
  ProbeResult,
  StartTaskParams,
  TaskStatus,
  VideoFormat,
} from './shared/types.ts'
