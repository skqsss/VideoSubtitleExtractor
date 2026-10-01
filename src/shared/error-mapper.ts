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
  | 'PLATFORM_BLOCKED'
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
    // 抖音的网页接口现在要求请求带 a_bogus 签名，风控拦截时返回 403，
    // yt-dlp 会把它兜底成 "Fresh cookies … are needed"，那句提示在这里是误导
    // 探针带了 --no-warnings，403 那条 WARNING 会被吞掉，所以必须同时认抖音自己那句兜底文案
    match:
      /ArgusSecurityPlugin|Failed to download web detail JSON: HTTP Error 403|Signature Not Found|Uifid Not Found|\[Douyin\][^\r\n]*Fresh cookies/i,
    code: 'PLATFORM_BLOCKED',
    message:
      '抖音的网页接口返回了 403 风控拦截，和 Cookie 是否新鲜无关：抖音现在要求请求带签名参数，yt-dlp 拿不到这个签名，' +
      '所以重新导出 Cookie、换浏览器、清缓存都不会生效。B 站等其他来源不受影响。',
  },
  {
    match: /Fresh cookies .* are needed|needs fresh cookies/i,
    code: 'NEED_FRESH_COOKIES',
    message:
      '该平台要求一份"新鲜"的浏览器 Cookie（未登录也需要）：还没配置 cookies.txt 就在设置里指定扩展导出的文件；' +
      '已配置则说明那份已失效，重新打开该视频页、用扩展重新导出并覆盖旧文件即可（本工具每次请求都会重新读取，不用重启服务）。',
  },
  {
    match:
      /Failed to decrypt|could not decrypt|Could not copy .*cookie database|could not find .* cookies database|unable to open the cookie jar|decrypt.*cookie/i,
    code: 'COOKIE_DECRYPT',
    message:
      '无法读取浏览器 Cookie：浏览器可能正在运行（数据库被占用），或使用了新版加密、甚至从未使用过没有 Cookie 数据库。请完全退出浏览器后重试，或在设置里指定导出的 cookies.txt。',
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

/**
 * 判断一次失败是否属于"浏览器 Cookie 读不出来"，值得丢掉 Cookie 再试一次
 * @param code - 已映射的错误码
 * @param output - yt-dlp 的原始输出
 * @returns 可以不带 Cookie 重试时返回 true
 * @remarks 除了错误码，再看一次原始输出：yt-dlp 的 Cookie 报错文案随版本与场景变化
 * （DPAPI 解密失败、数据库被占用复制失败、缺少 Cookie 库等），只认错误码迟早漏掉新文案
 */
export function shouldRetryWithoutCookies(code: string, output: string): boolean {
  // 平台明确要求"更新鲜的 Cookie"、或接口被风控拦截时，丢掉 Cookie 只会更糟
  if (code === 'NEED_FRESH_COOKIES' || code === 'PLATFORM_BLOCKED') {
    return false
  }

  if (code === 'COOKIE_DECRYPT') {
    return true
  }

  // 未归类的失败再按关键词兜底
  return /cookie/i.test(output)
}
