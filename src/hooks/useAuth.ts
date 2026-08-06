/**
 * useAuth — C 端微信登录 hook（GZ-SYS-002）。
 *
 * <p>封装 doc/10 §1 微信登录全流程的前端动作：</p>
 * <ol>
 *   <li>N2: `uni.login({provider:'weixin'})` 拿 code</li>
 *   <li>N4-N5: 调后端 {@code POST /app/gz/common/auth/wx-login}（纯 code 登录，后端 fallback 昵称「微信用户」）</li>
 *   <li>N6: token 写 token store + 写 userInfo store</li>
 * </ol>
 *
 * <p>头像 / 昵称：微信 2022 起已禁用 getUserProfile 自动获取（只返匿名「微信用户」+灰头像），登录链路
 * 不再尝试拉取；真实资料由用户在「个人资料」页用 chooseAvatar + 昵称填写能力补全。</p>
 *
 * <p>异常分支：</p>
 * <ul>
 *   <li>E2 后端 code2Session 失败 → toast "登录失败，请重试"，**不**改本地登录态</li>
 *   <li>E3 已禁用账号 → toast "账号已禁用"</li>
 * </ul>
 *
 * <p>关联文档：doc/10 §1 / GZ-SYS-002 任务卡 AC 1/2/4/5 / 跨层契约必背 #5（wx.login token 刷新）</p>
 */
import type { IUserInfoRes } from '@/api/types/login'
import { wxLoginGz } from '@/api/login'
import { hasAgreedPrivacy, useLoginConsent } from '@/composables/useLoginConsent'
import { t } from '@/locale/auth.zh-CN'
import { useTokenStore, useUserStore } from '@/store'

/** wx.login() 返回的简化结构。 */
interface WxLoginCodeResult {
  code: string
}

/**
 * 调 uni.login 拿 wx code。
 *
 * <p>用 Promise 包装；失败时 reject error。</p>
 *
 * <p><b>wxMOCK 短路</b>（dev profile 占位 AppID）：跳过 uni.login，直接构造 mock code
 * 给后端。原因：占位 AppID `wxMOCKMOCKMOCKMOCK` 没在微信开放平台注册，
 * 微信测试号对其 jscode2session 不应答 → uni.login 实际 60s timeout。后端 WxLoginService
 * 拿到 `mock-*` 前缀的 code 时走自己的 wxMOCK 短路返回固定 openid（GZ-SYS-002 AC 3）。
 * staging/prod 真实 AppID 到位后此分支不触发，自动走真链路。</p>
 */
function fetchWxCode(): Promise<WxLoginCodeResult> {
  const wxAppId = import.meta.env.VITE_WX_APPID || ''
  if (wxAppId.startsWith('wxMOCK')) {
    const mockCode = `mock-${Date.now()}`
    console.log('[useAuth] wxMOCK 短路 → 跳过 uni.login，mock code =', mockCode)
    return Promise.resolve({ code: mockCode })
  }
  return new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: (res) => {
        if (res.code) {
          resolve({ code: res.code })
        }
        else {
          reject(new Error('uni.login 未返回 code'))
        }
      },
      fail: (err) => {
        const msg = typeof err === 'string' ? err : JSON.stringify(err)
        reject(new Error(`uni.login 失败: ${msg}`))
      },
    })
  })
}

/**
 * 调后端 wx-login 端点 + 写 store。
 *
 * <p>不再传昵称 / 头像：微信 2022 起已禁用 getUserProfile 自动获取真实资料（只返匿名「微信用户」+灰头像）。
 * 后端按 fallback 建号（nickname="微信用户"），真实头像 / 昵称由用户在「个人资料」页用
 * chooseAvatar + 昵称填写能力补全（doc/10 §1.R1 调整）。</p>
 */
async function loginToBackend(code: string) {
  const res = await wxLoginGz({ code, nickName: '', avatarUrl: '' })

  // 写 token store（unibest 内置 setTokenInfo 已自动算 expireTime + 写 storage）
  const tokenStore = useTokenStore()
  tokenStore.setTokenInfo({
    token: res.token,
    expiresIn: res.expiresIn,
  })

  // 写 user store（直接构造 IUserInfoRes，不走 /applet/auth/getInfo —— 本项目 C 端
  // 用户无 ruoyi sys_user / sys_role 概念，由后端 wx-login 一次性返回；roles 留空数组）
  const userStore = useUserStore()
  const userInfo: IUserInfoRes = {
    userId: Number(res.userId), // 注意：跨层契约 ID 是 string，但 unibest 内置 store 要 number；
    //       这里做一次 Number() 转换 — V1.0 用户量 << 2^53 安全
    username: `wx:${res.openid}`,
    nickname: res.nickName,
    avatar: res.avatarUrl,
    roles: [],
  }
  userStore.setUserInfo(userInfo)
  return res
}

/**
 * useAuth hook — 暴露 mp 端可调用的认证动作。
 *
 * @returns 一组 async 动作 + 状态查询
 */
export function useAuth() {
  /**
   * 触发微信登录流程（wx.login 换 code → 后端换 token）。
   *
   * @returns 登录成功的响应（token / userId / nickName 等）
   * @throws Error 网络异常 / 后端失败时抛
   */
  async function loginWithWechat() {
    try {
      // 1. 拿 wx.login code（微信已禁用 getUserProfile 自动取资料 → 登录只换 token）
      const codeRes = await fetchWxCode()

      // 2. 调后端换 token + 写 store（昵称默认「微信用户」，头像空 → 引导用户去个人资料页补全）
      const loginRes = await loginToBackend(codeRes.code)

      // 3. 提示
      uni.showToast({ title: t('auth.toastSuccess'), icon: 'success' })
      return loginRes
    }
    catch (e: any) {
      console.error('[useAuth] loginWithWechat failed:', e)
      // 已禁用账号 — 后端返 500 + "账号已禁用"
      const errMsg = e?.msg || e?.message || String(e)
      if (errMsg.includes('禁用')) {
        uni.showToast({ title: t('auth.toastDisabled'), icon: 'none' })
      }
      else if (errMsg.includes('网络')) {
        uni.showToast({ title: t('auth.toastNetworkError'), icon: 'none' })
      }
      else {
        uni.showToast({ title: t('auth.toastFailed'), icon: 'none' })
      }
      throw e
    }
  }

  /**
   * 是否已登录（响应式）。
   * 用 tokenStore.hasLogin（unibest 内置 computed，含 token 过期判定）。
   */
  function isLoggedIn(): boolean {
    const tokenStore = useTokenStore()
    return tokenStore.updateNowTime().hasLogin
  }

  /**
   * 静默登录（App 启动调用，doc/10 §1.N2 标准 mp 模式）。
   *
   * <p><b>「同意一次」门控（微信合规）</b>：仅当用户**曾在协议 sheet 主动同意过**
   * （{@link hasAgreedPrivacy}）才允许启动静默自动登录 —— 否则启动留游客匿名态，
   * 不偷偷建登录态。首次同意发生在敏感动作触发的 {@link ensureLoggedIn} → 协议 sheet。
   * 这样审核员/新用户启动不会被静默登录，consent sheet 成为真实闸门；已同意过的老用户启动无感。</p>
   *
   * <p>无弹窗、无 toast —— wx.login 本身静默（不需用户手势），dev/H5 走 wxMOCK 短路用 mock code。
   * 落地页场次/商品走 @SaIgnore 匿名可读，游客态浏览正常；失败（真机拒绝/网络）静默吞。</p>
   *
   * @returns 登录成功/已登录 → true；未同意过 / 失败 → false（不抛、不弹）
   */
  async function silentLogin(): Promise<boolean> {
    if (isLoggedIn()) {
      return true
    }
    // 未同意过隐私协议 → 不静默登录，留游客匿名浏览（合规：不偷偷建登录态）
    if (!hasAgreedPrivacy()) {
      return false
    }
    try {
      const codeRes = await fetchWxCode()
      await loginToBackend(codeRes.code)
      return true
    }
    catch (e) {
      console.warn('[useAuth] silentLogin failed → 退化匿名浏览', e)
      return false
    }
  }

  /**
   * 触发预约 / 下单时的二次登录引导（doc/10 §1.E1）。
   *
   * <p>调用方式：在「提交预约」按钮点击事件里：</p>
   * <pre>
   * const { ensureLoggedIn } = useAuth()
   * if (!await ensureLoggedIn()) return   // 用户取消引导
   * // 继续业务流程
   * </pre>
   *
   * <p>微信合规：弹 {@link useLoginConsent} 协议同意 sheet（默认不勾选，用户主动勾选《用户服务协议》
   * 《隐私政策》后才放行登录），替代旧的 `uni.showModal`（modal 带不了勾选框与可点链接）。</p>
   *
   * @returns 用户已登录或刚登录成功 → true；用户取消引导 / 未勾选协议 → false
   */
  async function ensureLoggedIn(): Promise<boolean> {
    if (isLoggedIn()) {
      return true
    }
    // 协议同意闸门：用户主动勾选 + 点登录 → true；取消 / 关闭 → false（不登录、不跳转）
    const agreed = await useLoginConsent().open()
    if (!agreed) {
      return false
    }
    try {
      await loginWithWechat()
      return true
    }
    catch {
      return false
    }
  }

  /**
   * 登出：清后端会话 + 本地 token / 用户信息 + 「已同意」态（{@link clearAgreedPrivacy}）。
   * 登出后回游客首启态 —— 下次启动不自动登录、再次登录会重新弹协议 sheet。
   */
  async function logout(): Promise<void> {
    await useTokenStore().logout()
  }

  return {
    loginWithWechat,
    silentLogin,
    isLoggedIn,
    ensureLoggedIn,
    logout,
  }
}
