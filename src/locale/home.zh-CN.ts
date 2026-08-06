/**
 * 首页文案（zh-CN）—— miniapp-jp / 谷子宇宙拼团。
 *
 * <p>简化 t() 签名（与 auth.zh-CN.ts / user.zh-CN.ts 同款）：本文件不引 vue-i18n 全套，
 * 每个域一个自包含 t()，key 形如 `home.xxx`。后续统一接 i18n 时把本文件转 messages JSON，
 * key 命名沿用 `<scope>.<key>`。</p>
 *
 * <p>关联蓝图：UI:mp.home（首页聚合：banner + 场三组 + 订单入口，GZ-JP-201 实装）</p>
 */

const homeZhCN = {
  /** 页面标题（导航栏 + 报头） */
  pageTitle: '谷子宇宙拼团',

  /* ── 场次区块 ───────────────────────────── */
  /** 场次区块标题 */
  eventSectionTitle: '拼团场次',
  /** 场列表加载中 */
  eventLoading: '正在加载场次…',
  /** 场列表加载失败 */
  eventError: '场次加载失败',
  eventErrorSub: '检查网络后重试',
  /** 重试按钮 */
  retry: '重新加载',
  /** 一个可浏览场都没有（后端只下发开过的场，全是 draft 时就是这个态） */
  eventEmpty: '拼团场次即将上线',
  eventEmptySub: '开场后可在这里浏览商品并下单',

  /* ── 三组分组标题（展示派生，不是后端状态） ── */
  /** status=open 且已到开场时间 */
  groupLive: '进行中',
  /** status=open 但还没到开场时间 */
  groupUpcoming: '即将开始',
  /** status=closed（手动关场 / 闭场时间已过） */
  groupEnded: '已结束',

  /* ── 卡片时间行（与 index.logic.ts 的 EventTimingKind 一一对应） ── */
  /** 进行中：截止 09/30 22:00 */
  timingDeadline: '截止',
  /** 即将开始：08/20 10:00 开场 */
  timingStart: '开场',
  /** 已结束：已于 07/01 09:30 结束 */
  timingEndedPrefix: '已于',
  timingEndedSuffix: '结束',

  /* ── 我的订单快捷入口 ───────────────────── */
  orderSectionTitle: '我的拼团',
  orderEntryTitle: '我的订单',
  orderEntrySub: '查看拼团进度与物流',
  /** GZ-JP-205 订单页上线前点入口的提示 */
  orderComingSoon: '订单功能即将上线',
  /** GZ-JP-202 场详情页上线前点场卡的提示 */
  eventDetailComingSoon: '场详情即将上线',
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
