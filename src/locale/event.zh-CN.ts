/**
 * 场详情页文案（zh-CN）—— GZ-JP-202 / UI:mp.event_detail。
 *
 * <p>简化 t() 签名（与 home.zh-CN.ts / auth.zh-CN.ts 同款）：本文件不引 vue-i18n 全套，
 * 每个域一个自包含 t()，key 形如 `event.xxx`。</p>
 */

const eventZhCN = {
  /** 导航栏标题 */
  pageTitle: '场详情',

  /* ── 页头状态 / 时间 ─────────────────────── */
  /** 进行中标签 */
  statusLive: '进行中',
  /** 即将开始标签（status=open 但还没到开场时间） */
  statusUpcoming: '即将开始',
  /** 已结束标签 */
  statusEnded: '已结束',
  /** 倒计时前缀：距结束 3 天 05:12:33 */
  countdownPrefix: '距结束',
  /** 倒计时天数单位 */
  countdownDayUnit: '天',
  /** 即将开始：08/20 10:00 开场 */
  timingStart: '开场',
  /** 已结束：已于 07/01 09:30 结束 */
  timingEndedPrefix: '已于',
  timingEndedSuffix: '结束',
  /** ★ 场已结束时页头的醒目提示条（AC：加购入口置灰并提示） */
  endedBanner: '本场已结束，商品仅可浏览，不能加入购物车',

  /* ── 商品区 ──────────────────────────────── */
  /** 商品区块标题 */
  productSectionTitle: '本场商品',
  /** 商品总数后缀：共 12 件 */
  productCountPrefix: '共',
  productCountSuffix: '件',
  /** 商品加载中 */
  productLoading: '正在加载商品…',
  /** 商品加载失败 */
  productError: '商品加载失败',
  productErrorSub: '检查网络后重试',
  /** 重试按钮 */
  retry: '重新加载',
  /** 本场一件商品都没有 */
  productEmpty: '本场还没有上架商品',
  productEmptySub: '店员正在整理货单，晚点再来看看',
  /** 上拉加载中 */
  loadingMore: '正在加载更多…',
  /** 已经到底了 */
  noMore: '没有更多了',

  /* ── 场本身取数失败 ──────────────────────── */
  /** 场详情加载失败（不存在 / 未开场 / 网络） */
  eventError: '该场不存在或已下线',
  eventErrorSub: '回首页看看其它场次',
  /** 返回首页按钮 */
  backHome: '返回首页',
} as const

export type EventMessageKey = keyof typeof eventZhCN

/**
 * 简化版 t()：从字符串常量表里取值。
 *
 * @param key 文案 key，形如 `event.pageTitle`
 * @returns 中文文案，找不到时返回 key 本身（便于调试）
 */
export function t(key: string): string {
  if (key.startsWith('event.')) {
    const subKey = key.slice('event.'.length) as EventMessageKey
    return eventZhCN[subKey] ?? key
  }
  return key
}
