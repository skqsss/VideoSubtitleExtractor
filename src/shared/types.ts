/**
 * @file 共享类型定义：本地服务与前端共用的数据契约
 * @author Codex
 * @description 集中定义 IPC/HTTP 两个传输层都会用到的请求与响应结构，避免两端类型漂移
 * @date 2026-09-26
 */

/** 可读取 Cookie 的浏览器标识，none 表示不读取登录态 */
export type CookieBrowser =
  | 'none'
  | 'edge'
  | 'chrome'
  | 'chromium'
  | 'firefox'
  | 'brave'
  | 'opera'
  | 'vivaldi'
  | 'whale'

/** 应用配置（网页版存项目根 config.json，桌面版存 userData/config.json） */
export interface AppConfig {
  /** 本地服务监听端口，仅绑定 127.0.0.1 */
  port: number
  /** yt-dlp 可执行文件路径，相对路径按项目根解析 */
  ytdlpPath: string
  /** ffmpeg 所在目录，必须整目录携带（shared 构建带 dll） */
  ffmpegDir: string
  /** 下载目录 */
  downloadDir: string
  /** 默认读取哪个浏览器的 Cookie */
  cookieBrowser: CookieBrowser
  /** 浏览器扩展导出的 cookies.txt 路径，填写后与浏览器 Cookie 合并使用；空字符串表示不使用 */
  cookiesFile: string
  /** 代理地址，如 http://127.0.0.1:7897，空字符串表示直连 */
  proxy: string
  /** 同时执行的任务数，默认 1（串行更安全） */
  concurrency: number
}

/** 解析请求参数 */
export interface ProbeParams {
  url: string
  cookieBrowser?: CookieBrowser
  /** 覆盖配置中的 cookies.txt 路径，一般留空表示沿用配置 */
  cookiesFile?: string
  proxy?: string
}

/** 单个可下载档位（已归一化，字段名与前端表格列一一对应） */
export interface VideoFormat {
  /** yt-dlp 的 format_id，同时作为前端档位标识 */
  formatId: string
  /** 容器格式，如 mp4 / webm / m4a */
  ext: string
  /** 宽度，未知为 null */
  width: number | null
  /** 高度，未知为 null */
  height: number | null
  /** 帧率，未知为 null */
  fps: number | null
  /** 视频编码，none 表示纯音频 */
  vcodec: string
  /** 音频编码，none 表示纯视频 */
  acodec: string
  /** 总码率（kbps），未知为 null */
  tbr: number | null
  /** 预估体积（字节），未知为 null */
  filesize: number | null
  /** 备注：format_note 与 HDR 等附加信息 */
  note: string
  /** 传输协议，如 https / m3u8_native */
  protocol: string
  /** 是否为纯视频轨（需与最佳音轨合并） */
  isVideoOnly: boolean
  /** 是否为纯音频轨 */
  isAudioOnly: boolean
  /** 该档位对应的 -f 选择器 */
  selector: string
  /** 刻度条占比（0~100），由分辨率与码率推导 */
  rulerPercent: number
}

/** 解析结果 */
export interface ProbeResult {
  /** 实际解析的链接 */
  url: string
  /** 视频标题 */
  title: string
  /** 上传者 */
  uploader: string
  /** 时长（秒），未知为 null */
  duration: number | null
  /** 封面地址 */
  thumbnail: string
  /** 视频档位（含音视频合体档与纯视频档），按清晰度降序 */
  formats: VideoFormat[]
  /** 纯音频档位，按码率降序 */
  audioFormats: VideoFormat[]
  /** 是否存在纯视频档，用于提示"下载后自动合并音轨" */
  hasVideoOnly: boolean
  /** 解析过程中的降级提示，如 Cookie 读取失败，空字符串表示无异常 */
  warning: string
  /** 解析时间戳（毫秒） */
  probedAt: number
}

/** 下载模式：format 为指定档位，其余为预设 */
export type DownloadMode = 'format' | 'best-1080' | 'best' | 'audio-mp3'

/** 创建下载任务的参数 */
export interface StartTaskParams {
  url: string
  mode: DownloadMode
  /** mode 为 format 时必填，取值来自最近一次解析结果 */
  formatId?: string
  cookieBrowser?: CookieBrowser
  proxy?: string
}

/** 任务状态 */
export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled'

/** 下载任务（前端任务队列的渲染数据源） */
export interface DownloadTask {
  id: string
  url: string
  /** 任务标题，解析完成后回填为真实视频标题 */
  title: string
  /** 使用的档位或预设名 */
  formatLabel: string
  mode: DownloadMode
  status: TaskStatus
  /** 进度百分比 0~100 */
  percent: number
  /** 速度文本，如 4.2MiB/s */
  speed: string
  /** 剩余时间文本，如 00:41 */
  eta: string
  /** 已下载字节数 */
  downloadedBytes: number
  /** 总字节数，未知为 null */
  totalBytes: number | null
  /** 产物路径，完成或取消后可定位 */
  outputPath: string
  /** 中文失败原因，仅 status 为 error 时存在 */
  error: string
  /** 错误码，供前端分支判断 */
  errorCode: string
  /** 降级提示，如"浏览器 Cookie 读取失败，已改为未登录下载"，空字符串表示无提示 */
  warning: string
  /** 原始日志尾部（用于"查看原始日志"折叠区） */
  log: string
  /** 创建时间戳（毫秒） */
  createdAt: number
  /** 最近更新时间戳（毫秒） */
  updatedAt: number
}

/** 自检结果 */
export interface HealthResult {
  ok: boolean
  ytdlp: { path: string; version: string; exists: boolean }
  ffmpeg: { dir: string; version: string; exists: boolean }
  downloadDir: string
  /** 失败时的中文说明 */
  message: string
}

/** 统一错误结构 */
export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}
