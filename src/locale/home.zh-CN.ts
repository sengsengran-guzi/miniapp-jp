/**
 * 首页文案（zh-CN）—— miniapp-jp / 谷子宇宙拼团。
 *
 * <p>简化 t() 签名（与 auth.zh-CN.ts / user.zh-CN.ts 同款）：本文件不引 vue-i18n 全套，
 * 每个域一个自包含 t()，key 形如 `home.xxx`。后续统一接 i18n 时把本文件转 messages JSON，
 * key 命名沿用 `<scope>.<key>`。</p>
 *
 * <p>关联蓝图：UI:mp.home（首页聚合：banner + 场 + 订单入口，GZ-JP-201 实装）</p>
 */

const homeZhCN = {
  /** 页面标题（导航栏 + 报头） */
  pageTitle: '谷子宇宙拼团',
  /** 未登录时的欢迎语 */
  welcomeGuest: '日本现场直邮 · 一单多款',
  /** 已登录时的欢迎语前缀（后接昵称） */
  welcomePrefix: '欢迎回来，',
  /** 登录入口按钮 */
  loginCta: '微信登录',
  /** 已登录态的资料入口 */
  profileCta: '个人资料',
  /** 场次区块标题 */
  eventSectionTitle: '拼团场次',
  /** 场次占位（GZ-JP-201 接真实场列表前的占位态） */
  eventEmpty: '拼团场次即将上线',
  eventEmptySub: '开场后可在这里浏览商品并下单',
} as const

export type HomeMessageKey = keyof typeof homeZhCN

/**
 * 简化版 t()：从字符串常量表里取值。
 *
 * @param key 文案 key，形如 `home.pageTitle`
 * @returns 中文文案，找不到时返回 key 本身（便于调试）
 */
export function t(key: string): string {
  if (key.startsWith('home.')) {
    const subKey = key.slice('home.'.length) as HomeMessageKey
    return homeZhCN[subKey] ?? key
  }
  return key
}
