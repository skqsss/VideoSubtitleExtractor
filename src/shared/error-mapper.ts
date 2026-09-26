/**
 * @file yt-dlp 输出到中文提示的映射
 * @author Codex
 * @description 把 stderr 与退出码翻译成"下一步该做什么"的中文提示，避免用户把权限问题当成工具故障
 * @date 2026-09-26
 */

/** 错误码，前端据此决定是否展示"去设置里选浏览器"等引导 */
export type YtdlpErrorCode =
  | 'NEED_LOGIN'
  | 'COOKIE_DECRYPT'
  | 'NEED_FRESH_COOKIES'
  | 'COOKIE_FILE_MISSING'
  | 'UNSUPPORTED_URL'
  | 'NETWORK'
  | 'PREMIUM_REQUIRED'
  | 'VIDEO_UNAVAILABLE'
  | 'GEO_RESTRICTED'
  | 'FORMAT_UNAVAILABLE'
  | 'CANCELED'
  | 'UNKNOWN'

/** 映射结果 */
export interface MappedYtdlpError {
  code: YtdlpErrorCode
  message: string
}

/** 关键词规则表：命中即返回对应中文提示，顺序敏感（先具体后笼统） */
const ERROR_RULES: Array<{ match: RegExp; code: YtdlpErrorCode; message: string }> = [
  {
    match: /Fresh cookies .* are needed|needs fresh cookies/i,
    code: 'NEED_FRESH_COOKIES',
    message:
      '该平台要求携带一份新的浏览器 Cookie（未登录也需要）。请在设置里指定浏览器扩展导出的 cookies.txt，或换一个能读取 Cookie 的浏览器后重新解析。',
  },
  {
    match: /Failed to decrypt with DPAPI|Failed to decrypt|could not decrypt|decrypt.*cookie|could not find .* cookies database|unable to open the cookie jar/i,
    code: 'COOKIE_DECRYPT',
    message:
      '无法读取浏览器 Cookie（Chrome / Edge 新版加密，或该浏览器从未使用、没有 Cookie 数据库）。请完全退出浏览器后重试、换一个浏览器，或在设置里指定导出的 cookies.txt。',
  },
  {
    match: /Sign in to confirm|login required|Please log in|需要登录/i,
    code: 'NEED_LOGIN',
    message: '该链接需要登录态。请在设置里选择你常用的浏览器以读取 Cookie，然后重新解析。',
  },
  {
    match: /This video is only available for (registered users|paying members|members)|会员专享|大会员/i,
    code: 'PREMIUM_REQUIRED',
    message: '该视频需要登录账号或更高等级会员，当前账号权限不足。',
  },
  {
    match: /Unsupported URL/i,
    code: 'UNSUPPORTED_URL',
    message: '暂不支持该链接，请确认粘贴的是视频详情页链接，而不是首页或分享短链。',
  },
  {
    match: /Video unavailable|This video is not available|has been removed|404|不存在|已删除/i,
    code: 'VIDEO_UNAVAILABLE',
    message: '视频不存在或已下架，请确认链接仍可正常播放。',
  },
  {
    match: /not available in your country|geo|地区/i,
    code: 'GEO_RESTRICTED',
    message: '该视频有地区限制，当前网络位置无法访问。',
  },
  {
    match: /Requested format is not available|format .* is not available/i,
    code: 'FORMAT_UNAVAILABLE',
    message: '所选清晰度当前不可用（可能需要登录或该档位已下架），请重新解析后再选一档。',
  },
  {
    match: /Unable to download webpage|timed out|Temporary failure in name resolution|Connection refused|Failed to resolve|Network is unreachable|EOF occurred/i,
    code: 'NETWORK',
    message: '网络不通或超时。YouTube 等外网请在设置里填写代理；B 站 / 抖音建议直连并关闭代理。',
  },
]

/**
 * 把 yt-dlp 的错误输出映射为中文提示
 * @param stderr - yt-dlp 的错误输出（可含标准输出尾部）
 * @param exitCode - 进程退出码
 * @param phase - 出错阶段，仅影响"无法归类"时的措辞
 * @returns 错误码与中文提示
 * @remarks 退出码非 0 且无关键词命中时，提示用户查看原始日志
 */
export function mapYtdlpError(
  stderr: string,
  exitCode: number | null,
  phase: 'probe' | 'download' = 'download',
): MappedYtdlpError {
  const text = stderr || ''

  for (const rule of ERROR_RULES) {
    if (rule.match.test(text)) {
      return { code: rule.code, message: rule.message }
    }
  }

  if (exitCode === null) {
    return { code: 'CANCELED', message: '任务已被取消。' }
  }

  if (phase === 'probe') {
    return {
      code: 'UNKNOWN',
      message: `解析失败（yt-dlp 退出码 ${exitCode}）。请确认链接能正常播放，必要时调整 Cookie 来源或代理后重试。`,
    }
  }

  return {
    code: 'UNKNOWN',
    message: `下载失败（yt-dlp 退出码 ${exitCode}），请点"查看原始日志"确认原因。`,
  }
}
