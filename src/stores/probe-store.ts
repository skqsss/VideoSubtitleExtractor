/**
 * @file 解析状态
 * @author sqksss
 * @description 保存输入框内容、Cookie 选择与最近一次解析结果，供输入条与格式表共用
 * @date 2026-09-26
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { ApiError, api } from '../api/client.ts'
import { extractVideoUrl } from '../shared/url-utils.ts'
import type { CookieBrowser, ProbeResult } from '../types.ts'

export const useProbeStore = defineStore('probe', () => {
  /** 输入框中的链接 */
  const inputUrl = ref('')
  /** 本次解析使用的 Cookie 来源 */
  const cookieBrowser = ref<CookieBrowser | 'default'>('default')
  /** 是否让本次解析与下载走代理 */
  const useProxy = ref(false)
  /** 最近一次解析结果 */
  const result = ref<ProbeResult | null>(null)
  /** 是否解析中 */
  const isLoading = ref(false)
  /** 中文错误提示，空字符串表示无错误 */
  const error = ref('')
  /** 错误码，供界面分支判断 */
  const errorCode = ref('')

  /**
   * 解析当前输入框中的链接
   * @param options - 覆盖用的 Cookie 浏览器与代理
   * @returns 解析成功返回 true
   */
  async function probe(options?: {
    cookieBrowser?: CookieBrowser
    proxy?: string
  }): Promise<boolean> {
    if (isLoading.value) {
      return false
    }

    const rawInput = inputUrl.value.trim()
    if (!rawInput) {
      error.value = '请先粘贴视频链接。'
      errorCode.value = 'EMPTY_URL'

      return false
    }

    // 允许整段分享文案：先抠出链接再发起解析，失败时把原文交给服务端给出更准确的提示
    const url = extractVideoUrl(rawInput) ?? rawInput

    isLoading.value = true
    error.value = ''
    errorCode.value = ''

    try {
      result.value = await api.probe({
        url,
        cookieBrowser: options?.cookieBrowser ?? resolveCookieBrowser(),
        proxy: options?.proxy ?? resolveProxy(),
      })
      inputUrl.value = result.value.url

      return true
    } catch (cause) {
      result.value = null
      error.value = cause instanceof ApiError ? cause.message : '解析失败，请稍后重试。'
      errorCode.value = cause instanceof ApiError ? cause.code : 'UNKNOWN'

      return false
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 清空解析结果与输入
   */
  function clear(): void {
    result.value = null
    error.value = ''
    errorCode.value = ''
  }

  /**
   * 解析本次请求应使用的 Cookie 浏览器
   * @returns 浏览器标识，none 表示不读取
   */
  function resolveCookieBrowser(): CookieBrowser | undefined {
    return cookieBrowser.value === 'default' ? undefined : cookieBrowser.value
  }

  /**
   * 解析本次请求应使用的代理
   * @returns undefined 表示沿用配置中的代理；空字符串表示本次强制直连
   */
  function resolveProxy(): string | undefined {
    return useProxy.value ? undefined : ''
  }

  return {
    inputUrl,
    cookieBrowser,
    useProxy,
    result,
    isLoading,
    error,
    errorCode,
    probe,
    clear,
    resolveCookieBrowser,
    resolveProxy,
  }
})
