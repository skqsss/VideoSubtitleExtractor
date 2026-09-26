/**
 * @file 链接提取与规范化
 * @author Codex
 * @description 从平台分享文本里抠出真正的视频链接，粘贴/接口两侧共用同一套规则
 * @date 2026-09-26
 */

/**
 * 匹配分享文本中的 http(s) 链接
 * @remarks 终止字符包含空白、CJK 汉字、全角标点与引号/尖括号，
 * 因为 bilibili、抖音的分享文案常常把中文或标点紧贴在链接后面（无空格分隔）
 */
const HTTP_URL_PATTERN =
  /https?:\/\/[^\s\u3000-\u303f\u4e00-\u9fff\uff00-\uffef"'`<>《》【】]+/g

/** 链接末尾常见的句读与闭合符号，属于文案而不是链接本身 */
const TRAILING_NOISE_PATTERN = /[.,;:!?'"`)\]}]+$/

/**
 * 去掉链接末尾的标点噪声
 * @param candidate - 初步匹配到的链接
 * @returns 去掉尾部标点后的链接
 */
function trimTrailingNoise(candidate: string): string {
  let result = candidate
  while (TRAILING_NOISE_PATTERN.test(result)) {
    result = result.slice(0, -1)
  }

  return result
}

/**
 * 从一段文本中提取第一个可用的 http(s) 链接
 * @param text - 用户粘贴或输入的内容，可以是"标题 + 链接 + 说明"的整段分享文案
 * @returns 提取到的链接，未找到时返回 null
 * @remarks 只放行 http/https，`file:`、`ftp:` 等协议直接判为无效
 */
export function extractVideoUrl(text: string): string | null {
  if (!text) {
    return null
  }

  const candidates = text.match(HTTP_URL_PATTERN) ?? []
  for (const candidate of candidates) {
    const cleaned = trimTrailingNoise(candidate)

    try {
      const parsed = new URL(cleaned)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString()
      }
    } catch {
      // 匹配片段不是合法 URL 时继续看下一个候选
      continue
    }
  }

  return null
}
