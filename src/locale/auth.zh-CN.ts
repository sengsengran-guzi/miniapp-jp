/**
 * 微信登录相关文案（zh-CN）。
 *
 * <p>遵循 CLAUDE.md §6 #9：UI i18n — 默认 zh-CN，**不混 emoji**。
 * 当前不引 vue-i18n 全套（轻量化）；后续统一接入时把本文件转 messages JSON 即可，
 * key 命名沿用 `auth.xxx`。</p>
 */

export const authZhCN = {
  /** 登录页标题 */
  title: '谷子宇宙拼团',
  /** 副标题 */
  subtitle: '微信一键登录，参与日本现场拼团',

  /** 主登录按钮 */
  btnWechatLogin: '微信一键登录',
  /** 仅浏览模式入口 */
  btnBrowseOnly: '暂不登录，仅浏览',

  /** 登录成功 toast */
  toastSuccess: '登录成功',
  /** 登录失败 toast */
  toastFailed: '登录失败，请重试',
  /** 拒绝授权后引导文案 */
  toastDeclined: '已切换为仅浏览模式',
  /** 已禁用账号 */
  toastDisabled: '账号已禁用，请联系客服',
  /** 网络异常 */
  toastNetworkError: '网络异常，请稍后重试',

  /**
   * 协议勾选（微信合规：默认不勾选，用户主动阅读后自行选择是否同意，不得默认强制同意）。
   * 正式协议正文待甲方提供（locale/agreement.zh-CN.ts 当前为占位文本）。
   */
  agreementCheckPrefix: '我已阅读并同意',
  agreementService: '《用户服务协议》',
  agreementAnd: '与',
  agreementPrivacy: '《隐私政策》',
  /** 未勾选协议时点登录的提示 */
  toastAgreeFirst: '请先阅读并勾选同意《用户服务协议》与《隐私政策》',

  /** 按需登录 sheet（BizLoginSheet —— 加购/下单/我的等敏感动作时弹） */
  sheetTitle: '登录谷子宇宙拼团',
  sheetHint: '登录后可参与拼团下单、查看订单与物流',
  sheetCta: '微信登录',
  sheetCancel: '暂不登录',

  /** 登录态失效（401 续期失败）的轻提示，不再强制跳登录页 */
  toastSessionExpired: '登录已过期，请在需要时重新登录',
} as const

export type AuthMessageKey = keyof typeof authZhCN

/**
 * 简化版 t()：从字符串常量表里取值。后续接 vue-i18n 时这个函数签名不变，内部换实现即可。
 *
 * @param key 文案 key，形如 `auth.btnWechatLogin`（兼容 vue-i18n 风格）
 * @returns 中文文案，找不到时返回 key 本身（便于调试）
 */
export function t(key: string): string {
  if (key.startsWith('auth.')) {
    const subKey = key.slice('auth.'.length) as AuthMessageKey
    return authZhCN[subKey] ?? key
  }
  return key
}
