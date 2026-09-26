/**
 * @file 前端类型出口
 * @author Codex
 * @description 统一从共享类型再导出，组件只 import 本文件，后续切到 IPC 传输层时无需改组件
 * @date 2026-09-26
 */

export type {
  AppConfig,
  ApiErrorBody,
  CookieBrowser,
  DownloadMode,
  DownloadTask,
  HealthResult,
  ProbeParams,
  ProbeResult,
  StartTaskParams,
  TaskStatus,
  VideoFormat,
} from './shared/types.ts'
