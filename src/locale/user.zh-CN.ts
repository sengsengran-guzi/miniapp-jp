/**
 * 会员中心文案（zh-CN）—— miniapp-jp / 谷子宇宙拼团。
 *
 * <p>两个 scope：`user.home.*`（我的 tab + 关于页）/ `user.profile.*`（个人资料页）。
 * 订单相关文案随 GZ-JP-205 订单页一起补 `user.orders.*` scope。</p>
 *
 * <p>简化 t() 签名（与 auth.zh-CN.ts / home.zh-CN.ts 同款）：本文件不引 vue-i18n 全套。
 * 后续统一接 i18n 时把本文件转 messages JSON，key 命名沿用 `<scope>.<key>`。</p>
 */

const userHomeZhCN = {
  /** 页面标题（导航栏） */
  pageTitle: '我的',
  /** 头像区 — 未登录态 */
  loginPrompt: '点击登录',
  loginPromptSub: '登录后查看拼团订单与物流进度',
  /** 头像区 — 已登录态默认值 */
  defaultNickname: '微信用户',
  /** 头像区 — 已登录但未设头像/昵称时引导补全 */
  completeProfileHint: '点击完善头像昵称 ›',
  /** 头像区 — 已登录且已设头像时的常态副标题 */
  loggedInSub: '会员中心',
  /** 入口格 label */
  entryOrders: '我的订单',
  entryAbout: '关于',
  /** 功能区分组标题 */
  sectionTitle: '会员中心',
  /** 退出登录 */
  logoutBtn: '退出登录',
  logoutTitle: '退出登录',
  logoutContent: '确定退出当前登录？退出后需重新登录并同意协议。',
  logoutConfirm: '退出',
  logoutCancel: '取消',
  logoutDone: '已退出登录',
  /** 关于页 */
  aboutPageTitle: '关于',
  aboutVersionLabel: '当前版本',
  aboutCompany: '成都谷子宇宙贸易有限公司',
  aboutIcp: '蜀ICP备XXXXXXXX号',
  aboutAgreement: '服务协议',
  aboutPrivacy: '隐私政策',
  aboutCopyright: '© 2026 谷子宇宙',
} as const

const userProfileZhCN = {
  /** 页面标题 */
  pageTitle: '个人资料',
  /** 表单 label */
  avatarLabel: '头像',
  nicknameLabel: '昵称',
  genderLabel: '性别',
  mobileLabel: '手机号',
  /** 微信号 label */
  wechatIdLabel: '微信号',
  /** 表单 placeholder */
  nicknamePlaceholder: '请输入昵称',
  wechatIdPlaceholder: '请输入微信号，便于联系',
  mobileUnbound: '未绑定',
  /** 性别选项 */
  genderUnknown: '保密',
  genderMale: '男',
  genderFemale: '女',
  /** 头像上传 */
  avatarUploading: '上传中…',
  avatarUploadFailed: '头像上传失败，请重试',
  /** 手机号编辑 */
  mobileEditCta: '点击修改',
  mobileBindCta: '点击绑定',
  mobileBinding: '绑定中…',
  mobileBindRequired: '需获取手机号授权',
  mobileBindFailed: '手机号获取失败，请重试',
  /** 校验 */
  nicknameRequired: '昵称不能为空',
  nicknameTooLong: '昵称不能超过 32 个字符',
  wechatIdTooLong: '微信号不能超过 64 个字符',
  /** 提交 */
  ctaSave: '保存',
  ctaSaving: '保存中…',
  saveSuccess: '保存成功',
  saveFailed: '保存失败，请稍后再试',
  /** session 过期引导 */
  sessionExpired: '登录已过期，请重新授权',
} as const

export type UserHomeKey = keyof typeof userHomeZhCN
export type UserProfileKey = keyof typeof userProfileZhCN

/**
 * 简化 t()：key 形如 `user.<scope>.xxx`（scope ∈ home / profile）。
 *
 * @param key 文案 key
 * @returns 中文文案，找不到时返回 key 本身（便于调试）
 */
export function t(key: string): string {
  if (key.startsWith('user.home.')) {
    const k = key.slice('user.home.'.length) as UserHomeKey
    return userHomeZhCN[k] ?? key
  }
  if (key.startsWith('user.profile.')) {
    const k = key.slice('user.profile.'.length) as UserProfileKey
    return userProfileZhCN[k] ?? key
  }
  return key
}
