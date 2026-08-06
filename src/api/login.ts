/**
 * 登录 / 用户信息 / 微信登录 API。
 *
 * 后端契约（ruoyi-admin + ruoyi-gz-common，本地 http://localhost:8080）：
 *   - POST /app/gz/common/auth/wx-login   C 端微信登录（主路径；请求头 clientid=mp-applet-gz-jp 决定用哪个 appid）
 *   - POST /applet/auth/login             账号密码登录（unibest 内置兼容签名，dev mock 用）
 *   - GET  /applet/auth/getInfo           获取当前登录用户信息
 *   - POST /applet/auth/logout            退出登录
 *
 * sa-token 单 token 模式，header `Authorization: Bearer <token>` 由
 * `src/http/interceptor.ts` 统一注入。
 *
 * <p>C 端公开注册，用 `/app/gz/common/auth/wx-login` 而非 `/applet/auth/wxLogin`：</p>
 * <ul>
 *   <li>`/app/` 前缀表示 C 端 mp 专用</li>
 *   <li>`/gz/common/` 业务域命名（CLAUDE.md §6 #4）</li>
 *   <li>登录仅换 token（不传昵称/头像）：微信 2022 已废弃 getUserProfile，资料改由
 *       「我的-资料」页 chooseAvatar + input type=nickname 一次性采集持久化（ADR-0009）</li>
 * </ul>
 */
import type {
  IAuthLoginRes,
  ICaptcha,
  IDoubleTokenRes,
  IUpdateInfo,
  IUpdatePassword,
  IUserInfoRes,
} from './types/login'
import { http } from '@/http/http'

/** 账号密码登录表单 */
export interface ILoginForm {
  username: string
  password: string
}

/** 验证码（V1 mock 模式不强制启用，保留签名兼容 unibest token store） */
export function getCode() {
  return http.get<ICaptcha>('/applet/auth/captcha')
}

/**
 * 后端 WechatLoginVo 用 OAuth2 命名（access_token / expire_in），前端 ISingleTokenRes 用驼峰
 * （token / expiresIn）。在 API 层做一次字段适配，避免改 ruoyi 标准 vo 字段。
 */
function adaptVoToSingleTokenRes(vo: any): IAuthLoginRes {
  return {
    token: vo?.access_token ?? vo?.accessToken ?? '',
    expiresIn: vo?.expire_in ?? vo?.expireIn ?? 0,
  } as IAuthLoginRes
}

/** 账号密码登录 */
export function login(loginForm: ILoginForm) {
  return http.post<any>('/applet/auth/login', {
    ...loginForm,
    clientId: import.meta.env.VITE_APP_CLIENT_ID,
    tenantId: import.meta.env.VITE_APP_TENANT_ID,
    grantType: 'password',
  }).then(adaptVoToSingleTokenRes)
}

/** 刷新 token（双 token 模式才用得到，V1 单 token 占位） */
export function refreshToken(refreshToken: string) {
  return http.post<IDoubleTokenRes>('/applet/auth/refreshToken', { refreshToken })
}

/** 当前登录用户信息（含 roleKeys，用于驱动板块列表） */
export function getUserInfo() {
  return http.get<IUserInfoRes>('/applet/auth/getInfo')
}

/** 退出登录 */
export function logout() {
  return http.post<void>('/applet/auth/logout')
}

/** 修改用户信息（V1 范围外，留签名给 unibest 内置页面） */
export function updateInfo(data: IUpdateInfo) {
  return http.post('/applet/user/updateInfo', data)
}

/** 修改密码（V1 范围外，留签名） */
export function updateUserPassword(data: IUpdatePassword) {
  return http.post('/applet/user/updatePassword', data)
}

/**
 * 获取微信登录 code。
 *
 * V1 mock 模式：真实 appId 未申请，`uni.login` 在测试号环境返回测试 code。
 * 真实 appId 替换到位后此函数无需调整。
 */
export function getWxCode(): Promise<UniApp.LoginRes> {
  return new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: res => resolve(res),
      fail: err => reject(new Error(typeof err === 'string' ? err : JSON.stringify(err))),
    })
  })
}

/**
 * 微信小程序登录（本项目主路径）。
 *
 * 走 `/app/gz/common/auth/wx-login` 端点（不走 unibest 默认的 `/applet/auth/wxLogin`）。
 * mock 模式：后端检测 wx.miniapp.appid='wxMOCK' 时跳过 jscode2session 直接造伪 openid。
 */
export interface IWxLoginGzRequest {
  /** wx.login() 返回的临时 code */
  code: string
  /** 微信授权拿到的昵称（用户拒绝授权时为空） */
  nickName?: string
  /** 微信授权拿到的头像 URL */
  avatarUrl?: string
}

export interface IWxLoginGzResponse {
  token: string
  expiresIn: number
  userId: string
  openid: string
  nickName: string
  avatarUrl: string
}

export function wxLoginGz(data: IWxLoginGzRequest) {
  return http.post<IWxLoginGzResponse>('/app/gz/common/auth/wx-login', data)
}

/**
 * 旧 wxLogin 保留作 dev mock 短路兼容签名（走 `/applet/auth/wxLogin`）。
 *
 * 注意：本项目主流程**不**调本方法，而是 wxLoginGz。本签名保留是因为 unibest 内置
 * token store 在某些场景（unibest demo 路径）可能引用，删除会引起内置 token
 * store 编译失败。
 */
export function wxLogin(data: { code: string }) {
  return http.post<any>('/applet/auth/wxLogin', {
    ...data,
    clientId: import.meta.env.VITE_APP_CLIENT_ID,
    tenantId: import.meta.env.VITE_APP_TENANT_ID,
    grantType: 'wechat',
  }).then(adaptVoToSingleTokenRes)
}
