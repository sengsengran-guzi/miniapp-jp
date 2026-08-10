/**
 * 商品详情页文案（zh-CN）—— GZ-JP-202 / UI:mp.product_detail。
 *
 * <p>简化 t() 签名（与 home.zh-CN.ts / event.zh-CN.ts 同款），key 形如 `product.xxx`。</p>
 */

const productZhCN = {
  /** 导航栏标题 */
  pageTitle: '商品详情',

  /* ── 价格 ────────────────────────────────── */
  /** 货币符号（与数字分两个节点渲染，便于「小 ¥ + 大数字」排版） */
  currency: '¥',
  /** 无价时兜底 */
  priceTbd: '价格待定',
  /** ★ 包邮标识（REQ-ORDER-004：拼团全包邮，此价即最终支付价） */
  shippingFree: '包邮',
  /** 包邮补充说明 */
  shippingFreeHint: '国际邮费与国内运费已包含在价格内',

  /* ── 到货 ────────────────────────────────── */
  /** 预计到货标签 */
  deliveryLabel: '预计到货',
  /**
   * 商家没填到货时间时的兜底。
   *
   * ★★ 这不只是文案，是**合规承诺**，改它前先看这段：
   * 微信《交易类小程序运营规范》里「约定发货时效」以**商家设置、展示的最短时效**为准
   * （商品标题 / 商品详情页的展示信息）。普通商品是支付后 48h 内发货；**预售商品**按承诺周期，
   * 上限 330 天。拼团/代购属预售场景 —— 但前提是**页面上真的展示了一个周期**。
   * 原来的「待定（以店内通知为准）」不构成承诺时效 ⇒ 微信可能按普通商品的 48h 判，每单都超时
   * （处置是警告 → 连续 3 天未整改 → 支付风险提示 → 直至暂停小程序交易）。
   *
   * ⚠️ 当前值是 Kevin 2026-08-10 **暂定**的 7 天。真实发货周期一旦确定就改这里 ——
   * 承诺短于实际发货速度同样算超时。商家在 admin 给单品填了具体到货时间时，用商家填的，不走这条。
   */
  deliveryUnset: '下单后 7 天内发出',

  /* ── ★ 注意事项区块（REQ-PROD-005 / UI:mp.product_detail.notice）── */
  /** 区块标题 */
  noticeTitle: '购买须知',
  /** 商家没填时的兜底正文（区块本身照常出现，不因为没填就消失） */
  noticeFallback: '日本现场采购，到货时间可能有浮动；下单前请确认款式与数量，介意者慎拍。',

  /* ── 所属场 ──────────────────────────────── */
  /** 所属场标签（页头面包屑） */
  eventLabel: '所属场次',

  /* ── 底部 CTA ────────────────────────────── */
  /** 数量标签 */
  quantityLabel: '数量',
  /** 主 CTA */
  addToCart: '加入购物车',
  /** ★ 场已结束时 CTA 置灰后的文案（AC：场已结束时加购置灰） */
  addToCartEnded: '本场已结束',
  /** 场已结束时点击置灰 CTA 的 toast */
  endedToast: '本场已结束，无法加入购物车',
  /**
   * ★ 加购成功（GZ-JP-203 接真购物车后）。
   * 只提示不跳转 —— 客人通常还要接着挑下一件，CTA 条上的购物车角标已经变了。
   * 失败文案不在这里：后端会给具体原因（该商品已下架 / 数量已达上限…），
   * http.ts 直接 toast 后端原文，比一句「加入失败」有用得多。
   */
  addToCartSuccess: '已加入购物车',

  /* ── 取数态 ──────────────────────────────── */
  loading: '正在加载商品…',
  /** 商品不存在 / 已下架 / 所属场未开场 → 后端 fail */
  loadError: '该商品已下架',
  loadErrorSub: '回上一页看看其它商品',
  back: '返回',
  backHome: '返回首页',
} as const

export type ProductMessageKey = keyof typeof productZhCN

/**
 * 简化版 t()：从字符串常量表里取值。
 *
 * @param key 文案 key，形如 `product.pageTitle`
 * @returns 中文文案，找不到时返回 key 本身（便于调试）
 */
export function t(key: string): string {
  if (key.startsWith('product.')) {
    const subKey = key.slice('product.'.length) as ProductMessageKey
    return productZhCN[subKey] ?? key
  }
  return key
}
