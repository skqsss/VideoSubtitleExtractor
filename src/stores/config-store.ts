/**
 * @file 配置与自检状态
 * @author Codex
 * @description 保存下载目录、Cookie 来源、代理等配置，并维护 yt-dlp / ffmpeg 自检结果
 * @date 2026-09-26
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError, api } from '../api/client.ts'
import type { AppConfig, CookieInspectResult, HealthResult } from '../types.ts'

export const useConfigStore = defineStore('config', () => {
  /** 当前配置 */
  const config = ref<AppConfig | null>(null)
  /** 自检结果 */
  const health = ref<HealthResult | null>(null)
  /** 是否正在加载配置 */
  const isLoading = ref(false)
  /** 是否正在保存配置 */
  const isSaving = ref(false)
  /** 是否正在更新 yt-dlp */
  const isUpdatingYtdlp = ref(false)
  /** 设置面板是否展开 */
  const isSettingsOpen = ref(false)
  /** 最近一次操作的中文提示 */
  const notice = ref('')
  /** Cookie 自检结果 */
  const cookieSummary = ref<CookieInspectResult | null>(null)
  /** 是否正在自检 Cookie */
  const isInspectingCookies = ref(false)

  /** 环境是否就绪 */
  const isReady = computed(() => health.value?.ok === true)

  /**
   * 读取配置与自检结果
   * @returns 无返回值
   */
  async function load(): Promise<void> {
    isLoading.value = true
    notice.value = ''

    try {
      config.value = await api.getConfig()
      health.value = await api.health()
      if (!isReady.value) {
        notice.value = health.value.message
      }
    } catch (error) {
      notice.value = error instanceof ApiError ? error.message : '读取配置失败。'
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 重新自检外部依赖
   * @returns 无返回值
   */
  async function refreshHealth(): Promise<void> {
    try {
      health.value = await api.health()
      notice.value = health.value.ok ? '自检通过。' : health.value.message
    } catch (error) {
      notice.value = error instanceof ApiError ? error.message : '自检失败。'
    }
  }

  /**
   * 保存配置
   * @param patch - 需要修改的字段
   * @returns 是否保存成功
   */
  async function save(patch: Partial<AppConfig>): Promise<boolean> {
    isSaving.value = true
    notice.value = ''

    try {
      config.value = await api.setConfig(patch)
      health.value = await api.health()
      notice.value = '设置已保存。'

      return true
    } catch (error) {
      notice.value = error instanceof ApiError ? error.message : '保存设置失败。'

      return false
    } finally {
      isSaving.value = false
    }
  }

  /**
   * 更新 yt-dlp 二进制
   * @returns 无返回值
   */
  async function updateYtdlp(): Promise<void> {
    isUpdatingYtdlp.value = true
    notice.value = ''

    try {
      const result = await api.updateYtdlp()
      notice.value = `yt-dlp 已更新到 ${result.version}。`
      health.value = await api.health()
    } catch (error) {
      notice.value = error instanceof ApiError ? error.message : '更新 yt-dlp 失败。'
    } finally {
      isUpdatingYtdlp.value = false
    }
  }

  /**
   * 自检 cookies.txt：确认导出文件能被解析、覆盖了哪些域名
   * @returns 无返回值
   * @remarks 结果只通过 cookieSummary 呈现，避免和设置面板的 notice 重复显示同一句话
   */
  async function inspectCookies(): Promise<void> {
    isInspectingCookies.value = true

    try {
      cookieSummary.value = await api.inspectCookies()
    } catch (error) {
      cookieSummary.value = {
        ok: false,
        fileCount: 0,
        cookieCount: 0,
        domains: [],
        namesByDomain: {},
        message: error instanceof ApiError ? error.message : 'Cookie 自检失败。',
      }
    } finally {
      isInspectingCookies.value = false
    }
  }

  return {
    config,
    health,
    isLoading,
    isSaving,
    isUpdatingYtdlp,
    isSettingsOpen,
    notice,
    cookieSummary,
    isInspectingCookies,
    isReady,
    load,
    refreshHealth,
    save,
    updateYtdlp,
    inspectCookies,
  }
})
