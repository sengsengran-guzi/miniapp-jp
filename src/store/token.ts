import type {
  ILoginForm,
} from '@/api/login'
import type { IAuthLoginRes } from '@/api/types/login'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue' // 修复：导入 computed
import {
  login as _login,
  logout as _logout,
  refreshToken as _refreshToken,
  wxLogin as _wxLogin,
  getWxCode,
  wxLoginGz,
} from '@/api/login'
import { isDoubleTokenRes, isSingleTokenRes } from '@/api/types/login'
import { clearAgreedPrivacy, hasAgreedPrivacy } from '@/composables/useLoginConsent'
import { isDoubleTokenMode } from '@/utils'
import { useUserStore } from './user'

// 初始化状态
const tokenInfoState = isDoubleTokenMode
  ? {
      accessToken: '',
      accessExpiresIn: 0,
      refreshToken: '',
      refreshExpiresIn: 0,
    }
  : {
      token: '',
      expiresIn: 0,
    }

export const useTokenStore = defineStore(
  'token',
  () => {
    // 定义用户信息
    const tokenInfo = ref<IAuthLoginRes>({ ...tokenInfoState })

    // 添加一个时间戳 ref 作为响应式依赖
    const nowTime = ref(Date.now())
    /**
     * 更新响应式数据:now
     * 确保isTokenExpired/isRefreshTokenExpired重新计算,而不是用错误过期缓存值
     * 可useTokenStore内部适时调用;也可链式调用:tokenStore.updateNowTime().hasLogin
     * @returns 最新的tokenStore实例
     */
    const updateNowTime = () => {
      nowTime.value = Date.now()
      return useTokenStore()
    }

    // 设置用户信息
    const setTokenInfo = (val: IAuthLoginRes) => {
      updateNowTime()
      tokenInfo.value = val

      // 计算并存储过期时间
      const now = Date.now()
      if (isSingleTokenRes(val)) {
        // 单token模式
        const expireTime = now + val.expiresIn * 1000
        uni.setStorageSync('accessTokenExpireTime', expireTime)
      }
      else if (isDoubleTokenRes(val)) {
        // 双token模式
        const accessExpireTime = now + val.accessExpiresIn * 1000
        const refreshExpireTime = now + val.refreshExpiresIn * 1000
        uni.setStorageSync('accessTokenExpireTime', accessExpireTime)
        uni.setStorageSync('refreshTokenExpireTime', refreshExpireTime)
      }
    }

    /**
     * 判断token是否过期
     */
    const isTokenExpired = computed(() => {
      if (!tokenInfo.value) {
        return true
      }

      const now = nowTime.value
      const expireTime = uni.getStorageSync('accessTokenExpireTime')

      if (!expireTime)
        return true
      return now >= expireTime
    })

    /**
     * 判断refreshToken是否过期
     */
    const isRefreshTokenExpired = computed(() => {
      if (!isDoubleTokenMode)
        return true

      const now = nowTime.value
      const refreshExpireTime = uni.getStorageSync('refreshTokenExpireTime')

      if (!refreshExpireTime)
        return true
      return now >= refreshExpireTime
    })

    /**
     * 登录成功后处理逻辑
     * @param tokenInfo 登录返回的token信息
     */
    async function _postLogin(tokenInfo: IAuthLoginRes) {
      setTokenInfo(tokenInfo)
      const userStore = useUserStore()
      await userStore.fetchUserInfo()
    }

    /**
     * 用户登录
     * 有的时候后端会用一个接口返回token和用户信息，有的时候会分开2个接口，一个获取token，一个获取用户信息
     * （各有利弊，看业务场景和系统复杂度），这里使用2个接口返回的来模拟
     * @param loginForm 登录参数
     * @returns 登录结果
     */
    const login = async (loginForm: ILoginForm) => {
      try {
        const res = await _login(loginForm)
        console.log('普通登录-res: ', res)
        await _postLogin(res)
        uni.showToast({
          title: '登录成功',
          icon: 'success',
        })
        return res
      }
      catch (error) {
        console.error('登录失败:', error)
        uni.showToast({
          title: '登录失败，请重试',
          icon: 'error',
        })
        throw error
      }
      finally {
        updateNowTime()
      }
    }

    /**
     * 微信登录
     * 有的时候后端会用一个接口返回token和用户信息，有的时候会分开2个接口，一个获取token，一个获取用户信息
     * （各有利弊，看业务场景和系统复杂度），这里使用2个接口返回的来模拟
     * @returns 登录结果
     */
    const wxLogin = async () => {
      try {
        // mock 模式（占位 appId 'wxMOCKMOCKMOCKMOCK'）：
        // - uni.login 在测试号环境对占位 appId 直接 fail
        // - WechatLoginService 把 mock code 当 openid 查 sys_user 也查不到（dev 未 seed wx_openid）
        // → 短路到 /applet/auth/login 的 mock 路径（dev/dev123 → mock-token-9001）。
        //   真实 appId 到位后此分支不会触发，自动走 uni.login + jscode2session 真链路。
        const wxAppId = import.meta.env.VITE_WX_APPID || ''
        if (wxAppId.startsWith('wxMOCK')) {
          console.log('[gz] wxLogin mock 模式 → 走 /applet/auth/login dev 账号短路')
          const mockRes = await _login({ username: 'dev', password: 'dev123' })
          await _postLogin(mockRes)
          uni.showToast({ title: '登录成功（mock）', icon: 'success' })
          return mockRes
        }
        const loginRes = await getWxCode()
        console.log('[gz] wxLogin uni.login code:', loginRes.code)
        const res = await _wxLogin({ code: loginRes.code })
        console.log('[gz] wxLogin res:', res)
        await _postLogin(res)
        uni.showToast({
          title: '登录成功',
          icon: 'success',
        })
        return res
      }
      catch (error) {
        console.error('[gz] wxLogin failed:', error)
        uni.showToast({
          title: '微信登录失败，请重试',
          icon: 'error',
        })
        throw error
      }
      finally {
        updateNowTime()
      }
    }

    /**
     * 静默续期登录态（ADR-0009 / GZ-USER-006）。
     *
     * <p>单 token 模式下 token 失效时调用：静默 wx.login 拿新 code → 后端 code2session 重签 sa-token，
     * <b>不弹任何授权窗 / 不弹 toast / 不跳登录页</b>（openid 静默可得，对用户无感）。
     * 成功返回 true（原请求可 retry），失败返回 false（由调用方决定是否回登录页）。</p>
     *
     * <p>mock 模式（占位 appId wxMOCK*）：走 /applet/auth/login dev 账号短路（与 wxLogin mock 分支一致），
     * 保证 dev / Tier 1B 也能验证续期链路。</p>
     *
     * <p>与 wxLogin 的区别：wxLogin 是用户主动登录（带成功/失败 toast）；本方法后台静默续期（全程静默）。</p>
     */
    const silentWxRenew = async (): Promise<boolean> => {
      // 「同意一次」门控（与 useAuth.silentLogin 同源）：未同意过隐私协议的 guest 触发 401 时，
      // 不静默续期/自动建登录态 —— 否则 guest 访问受保护接口会被偷偷登录回去（绕过 consent sheet）。
      if (!hasAgreedPrivacy()) {
        return false
      }
      try {
        // 与 useAuth().silentLogin()/loginToBackend 同一条登录链路：打 C 端真实存在的
        // /app/gz/common/auth/wx-login（wxLoginGz）重签 sa-token。**绝不**走 _wxLogin
        // (/applet/auth/wxLogin) + _postLogin→fetchUserInfo (/applet/auth/getInfo) —— 这两个端点后端
        // 不存在=404，旧实现续期 100% 必败 → http.ts 失败分支 logout 清掉刚拿到的有效 token + 弹登录页（T1-002）。
        const wxAppId = import.meta.env.VITE_WX_APPID || ''
        let code: string
        if (wxAppId.startsWith('wxMOCK')) {
          // dev / H5：占位 appId 下 uni.login 拿不到真 code → mock code（后端 wxMOCK adapter 认 `mock-*` 前缀）
          code = `mock-${Date.now()}`
        }
        else {
          const loginRes = await getWxCode()
          code = loginRes.code
        }
        const res = await wxLoginGz({ code, nickName: '', avatarUrl: '' })
        // 单 token：用 wx-login 返回值直接构造 token + 用户信息，不二次调 /applet/auth/getInfo（404）。
        setTokenInfo({ token: res.token, expiresIn: res.expiresIn })
        const userStore = useUserStore()
        userStore.setUserInfo({
          userId: Number(res.userId),
          username: `wx:${res.openid}`,
          nickname: res.nickName,
          avatar: res.avatarUrl,
          roles: [],
        })
        console.log('[gz] silentWxRenew 续期成功')
        return true
      }
      catch (error) {
        console.warn('[gz] silentWxRenew 续期失败:', error)
        return false
      }
      finally {
        updateNowTime()
      }
    }

    /**
     * 退出登录 并 删除用户信息。
     *
     * @param skipBackend 是否跳过后端 `_logout` 调用。HTTP 401 拦截器在调本方法时必须传 true —
     *                    否则 logout 请求自身又收到 401 会再次触发 logout，形成死循环。
     *                    用户主动退出登录传 false（默认），正常通知后端清 sa-token session。
     */
    const logout = async (skipBackend = false) => {
      if (!skipBackend) {
        try {
          await _logout()
        }
        catch (error) {
          console.error('退出登录失败:', error)
        }
      }
      updateNowTime()

      // 清除本地 token 信息
      uni.removeStorageSync('accessTokenExpireTime')
      uni.removeStorageSync('refreshTokenExpireTime')
      console.log('退出登录-清除用户信息')
      tokenInfo.value = { ...tokenInfoState }
      uni.removeStorageSync('token')
      const userStore = useUserStore()
      userStore.clearUserInfo()
      // 清「已同意」态 → 回游客首启态，下次启动不自动登录、再登录重弹协议 sheet（否则 silentLogin 会自动登回）
      clearAgreedPrivacy()
    }

    /**
     * 刷新token
     * @returns 刷新结果
     */
    const refreshToken = async () => {
      if (!isDoubleTokenMode) {
        console.error('单token模式不支持刷新token')
        throw new Error('单token模式不支持刷新token')
      }

      try {
        // 安全检查，确保refreshToken存在
        if (!isDoubleTokenRes(tokenInfo.value) || !tokenInfo.value.refreshToken) {
          throw new Error('无效的refreshToken')
        }

        const refreshToken = tokenInfo.value.refreshToken
        const res = await _refreshToken(refreshToken)
        console.log('刷新token-res: ', res)
        setTokenInfo(res)
        return res
      }
      catch (error) {
        console.error('刷新token失败:', error)
        throw error
      }
      finally {
        updateNowTime()
      }
    }

    /**
     * 获取有效的token
     * 注意：在computed中不直接调用异步函数，只做状态判断
     * 实际的刷新操作应由调用方处理
     * 建议这样使用 tokenStore.updateNowTime().validToken
     */
    const getValidToken = computed(() => {
      // token已过期，返回空
      if (isTokenExpired.value) {
        return ''
      }

      if (!isDoubleTokenMode) {
        return isSingleTokenRes(tokenInfo.value) ? tokenInfo.value.token : ''
      }
      else {
        return isDoubleTokenRes(tokenInfo.value) ? tokenInfo.value.accessToken : ''
      }
    })

    /**
     * 检查是否有登录信息（不考虑token是否过期）
     */
    const hasLoginInfo = computed(() => {
      if (!tokenInfo.value) {
        return false
      }
      if (isDoubleTokenMode) {
        return isDoubleTokenRes(tokenInfo.value) && !!tokenInfo.value.accessToken
      }
      else {
        return isSingleTokenRes(tokenInfo.value) && !!tokenInfo.value.token
      }
    })

    /**
     * 检查是否已登录且token有效
     * 建议这样使用tokenStore.updateNowTime().hasLogin
     */
    const hasValidLogin = computed(() => {
      console.log('hasValidLogin', hasLoginInfo.value, !isTokenExpired.value)
      return hasLoginInfo.value && !isTokenExpired.value
    })

    /**
     * 尝试获取有效的token，如果过期且可刷新，则刷新token
     * @returns 有效的token或空字符串
     */
    const tryGetValidToken = async (): Promise<string> => {
      updateNowTime()
      if (!getValidToken.value && isDoubleTokenMode && !isRefreshTokenExpired.value) {
        try {
          await refreshToken()
          return getValidToken.value
        }
        catch (error) {
          console.error('尝试刷新token失败:', error)
          return ''
        }
      }
      return getValidToken.value
    }

    return {
      // 核心API方法
      login,
      wxLogin,
      silentWxRenew,
      logout,

      // 认证状态判断（最常用的）
      hasLogin: hasValidLogin,

      // 内部系统使用的方法
      refreshToken,
      tryGetValidToken,
      validToken: getValidToken,

      // 调试或特殊场景可能需要直接访问的信息
      tokenInfo,
      setTokenInfo,
      updateNowTime,
    }
  },
  {
    // 添加持久化配置，确保刷新页面后token信息不丢失
    persist: true,
  },
)
