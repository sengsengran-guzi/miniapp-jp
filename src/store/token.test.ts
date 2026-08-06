/**
 * tokenStore 单测（SYS-INFRA-009 样例 2 / 3 + GZ-USER-006 静默续期）。
 *
 * 覆盖：
 * - logout(skipBackend=true) — 不联网，仅清本地 storage + tokenInfo + userStore
 * - validToken — token 过期时返空，未过期时返当前 token
 * - silentWxRenew（ADR-0009 / GZ-USER-006）— token 失效静默续期签新 token，不返 401 不踢用户
 *   （前置「同意一次」门控：未同意过隐私协议的 guest 不静默续期，用例需先写 gz_privacy_agreed）
 *
 * `@/api/login` 整个模块在用例里被 vi.mock 掉 — 避免 http.ts 拖一整套 alova 进来。
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getWxCode as _getWxCode,
  wxLoginGz as _wxLoginGz,
} from '@/api/login'

import { useTokenStore } from './token'

// 必须在 import store 之前 mock，避免实际触发 alova
vi.mock('@/api/login', () => ({
  login: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  refreshToken: vi.fn(),
  wxLogin: vi.fn(),
  wxLoginGz: vi.fn(),
  getWxCode: vi.fn(),
}))

// userStore 在 logout / silentWxRenew 链路里被调用 → 保留 clearUserInfo + setUserInfo
vi.mock('./user', () => ({
  useUserStore: () => ({
    clearUserInfo: vi.fn(),
    fetchUserInfo: vi.fn().mockResolvedValue({}),
    setUserInfo: vi.fn(),
  }),
}))

// @/utils/index.ts 顶层 import pages.json（带 // 注释，非纯 JSON，vite:json plugin
// 会解析失败）— 只挑 isDoubleTokenMode 这一个 export，避开 pages.json import
vi.mock('@/utils', () => ({
  isDoubleTokenMode: false,
}))

describe('tokenStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks() // 清调用历史（保留 mock 实现），避免跨用例 call count 污染
  })

  it('logout(skipBackend=true) 清掉 tokenInfo + accessTokenExpireTime', async () => {
    const store = useTokenStore()
    // 模拟有 token 的状态
    store.setTokenInfo({ token: 'mock-token-9001', expiresIn: 3600 })
    expect(uni.getStorageSync('accessTokenExpireTime')).toBeGreaterThan(0)

    await store.logout(true)

    // tokenInfo 已重置；storage 已清；hasLogin = false
    expect(store.tokenInfo).toEqual({ token: '', expiresIn: 0 })
    expect(uni.getStorageSync('accessTokenExpireTime')).toBe('')
    expect(store.hasLogin).toBe(false)
  })

  it('validToken — 未过期返当前 token', () => {
    const store = useTokenStore()
    store.setTokenInfo({ token: 'mock-token-9001', expiresIn: 3600 })
    expect(store.validToken).toBe('mock-token-9001')
  })

  it('validToken — 过期返空串', () => {
    const store = useTokenStore()
    // setTokenInfo 让 tokenInfo.value 非空（getValidToken 依赖 tokenInfo）
    store.setTokenInfo({ token: 'mock-token-9001', expiresIn: 3600 })
    // 覆写 storage 为 1 小时前；updateNowTime 触发 nowTime ref 变化让 computed 重算
    uni.setStorageSync('accessTokenExpireTime', Date.now() - 3600 * 1000)
    store.updateNowTime()
    expect(store.validToken).toBe('')
  })

  /* ============================================================
   * GZ-USER-006 登录态静默续期（ADR-0009 AC 5/8）
   * ============================================================ */

  it('silentWxRenew — 真实 appId：wx.login → wx-login(/app/gz/common/auth/wx-login) 重签 token，返 true 不踢用户', async () => {
    // 真实 appId（非 wxMOCK*）→ 走 getWxCode + wxLoginGz 真链路分支（T1-002：统一打 C 端真实端点）
    uni.setStorageSync('gz_privacy_agreed', true) // 「同意一次」门控前置
    vi.stubEnv('VITE_WX_APPID', 'wxJPREALAPPID0001')
    vi.mocked(_getWxCode).mockResolvedValueOnce({ code: 'fresh-code-123' } as any)
    vi.mocked(_wxLoginGz).mockResolvedValueOnce({
      token: 'renewed-token-7777',
      expiresIn: 2592000,
      userId: '11',
      openid: 'mock-mock-123',
      nickName: '微信用户',
      avatarUrl: '',
    } as any)

    const store = useTokenStore()
    const ok = await store.silentWxRenew()

    expect(ok).toBe(true)
    expect(_getWxCode).toHaveBeenCalledTimes(1)
    expect(_wxLoginGz).toHaveBeenCalledWith({ code: 'fresh-code-123', nickName: '', avatarUrl: '' })
    // 新 token 已落 store，validToken 非空（未过期）— 不返 401 不踢用户
    expect(store.validToken).toBe('renewed-token-7777')
    expect(store.hasLogin).toBe(true)
    vi.unstubAllEnvs()
  })

  it('silentWxRenew — mock appId：mock code 走 wx-login 续期，返 true（不再走 /applet 404 端点）', async () => {
    uni.setStorageSync('gz_privacy_agreed', true) // 「同意一次」门控前置
    vi.stubEnv('VITE_WX_APPID', 'wxMOCKMOCKMOCKMOCK')
    vi.mocked(_wxLoginGz).mockResolvedValueOnce({
      token: 'mock-renewed-9002',
      expiresIn: 2592000,
      userId: '11',
      openid: 'mock-mock-123',
      nickName: '微信用户',
      avatarUrl: '',
    } as any)

    const store = useTokenStore()
    const ok = await store.silentWxRenew()

    expect(ok).toBe(true)
    // 占位 appId 直接造 mock code（不调 getWxCode），但仍打真实 wx-login 端点（wxLoginGz）
    expect(_getWxCode).not.toHaveBeenCalled()
    expect(_wxLoginGz).toHaveBeenCalledTimes(1)
    expect(store.validToken).toBe('mock-renewed-9002')
    vi.unstubAllEnvs()
  })

  it('silentWxRenew — 续期失败（wx.login reject）返 false，不抛异常', async () => {
    uni.setStorageSync('gz_privacy_agreed', true) // 「同意一次」门控前置
    vi.stubEnv('VITE_WX_APPID', 'wxJPREALAPPID0001')
    vi.mocked(_getWxCode).mockRejectedValueOnce(new Error('user denied / no openid'))

    const store = useTokenStore()
    const ok = await store.silentWxRenew()

    expect(ok).toBe(false) // 调用方据此决定是否回登录页（仅 openid 都拿不到才回）
    vi.unstubAllEnvs()
  })

  it('silentWxRenew — 未同意过隐私协议（guest）直接返 false，不发起任何登录请求（微信合规）', async () => {
    // 不写 gz_privacy_agreed → 门控拦下：不能偷偷把游客登录回去（绕过 consent sheet）
    vi.stubEnv('VITE_WX_APPID', 'wxMOCKMOCKMOCKMOCK')

    const store = useTokenStore()
    const ok = await store.silentWxRenew()

    expect(ok).toBe(false)
    expect(_getWxCode).not.toHaveBeenCalled()
    expect(_wxLoginGz).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})
