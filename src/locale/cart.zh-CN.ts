/**
 * 购物车页文案（zh-CN）—— GZ-JP-203 / UI:mp.cart。
 *
 * <p>简化 t() 签名（与 home / event / product.zh-CN.ts 同款），key 形如 `cart.xxx`。</p>
 *
 * <p><b>★ 全包邮（REQ-ORDER-004）</b>：系统里彻底没有「另收一笔钱送货」这个概念 ——
 * 商品价即最终支付价。底部只有「商品合计」一行，<b>不存在第二行费用</b>。
 * 本文件也刻意不提供任何表达「另收费用」的文案 key，让页面想写也写不出来。</p>
 */

const cartZhCN = {
  /** 导航栏标题 */
  pageTitle: '购物车',

  /* ── 取数态 ──────────────────────────────── */
  loading: '正在加载购物车…',
  loadError: '购物车加载失败',
  loadErrorSub: '检查网络后重试',
  retry: '重试',
  empty: '购物车还是空的',
  emptySub: '去逛逛进行中的场次吧',
  emptyCta: '去逛逛',

  /* ── 分组（UI:mp.cart.group，方案 A 按场分组）── */
  /** 组头款数后缀，如「3 款」 */
  groupCountSuffix: '款',
  /** 组头「本场已结束」标 */
  groupEnded: '本场已结束',
  /** 孤儿组（商品已被删）默认组名，后端一般会给，这里只是兜底 */
  groupOrphan: '已失效商品',

  /* ── 行 ──────────────────────────────────── */
  /** 单价前缀 */
  currency: '¥',
  /** 失效角标 */
  invalidBadge: '已失效',
  /** 后端没给失效文案时的兜底（正常不会出现） */
  invalidFallback: '该商品暂时无法购买',
  /** 删除按钮 */
  delete: '删除',
  deleteTitle: '删除这件商品？',
  deleteContent: '删除后可以重新加入购物车',
  deleteConfirm: '删除',
  deleteCancel: '再想想',
  deleteDone: '已删除',

  /* ── 失效项批量清理（复用批量删除端点，无新接口）── */
  /** 提示条：N 件商品已失效 */
  invalidTipPrefix: '有',
  invalidTipSuffix: '件商品已失效',
  /** 提示条上的清理按钮 */
  invalidClear: '清空失效',
  invalidClearTitle: '清空失效商品？',
  invalidClearContent: '这些商品已下架或所属场次已结束',
  invalidClearDone: '已清空失效商品',

  /* ── 底部固定条（UI:mp.cart.summary）────── */
  /** 全选 */
  selectAll: '全选',
  /** 合计标签 */
  totalLabel: '合计',
  /**
   * ★ 合计旁的「已包邮」标注（UI:mp.cart 明确要求）。
   * 这是<b>唯一</b>与配送费用有关的文案：告诉客人这个数字就是全部，不会再冒出第二笔。
   */
  totalIncluded: '已包邮',
  /** 去结算（未选时置灰） */
  checkout: '去结算',
  /** 去结算按钮上的已选件数，如「去结算(3)」 */
  checkoutCountPrefix: '(',
  checkoutCountSuffix: ')',
  /** 未勾选任何项时点击置灰按钮的提示 */
  checkoutEmptyToast: '请先勾选要结算的商品',
  /**
   * 结算页跳转失败兜底 —— ★ 不许写「即将上线」。
   * 下单确认页 GZ-JP-204 早已交付，跳不过去只可能是路由 bug；
   * 写成「即将上线」会把 bug 伪装成未完工（首页订单入口就这么被藏了一期）。
   */
  checkoutOpenFailed: '结算页打不开了，请退出重进试试',

  /* ── 登录 ────────────────────────────────── */
  /** 未登录时的占位（购物车是用户私有数据，游客看不到） */
  needLogin: '登录后查看购物车',
  needLoginSub: '购物车里的商品跟着你的微信号走',
  needLoginCta: '微信登录',
} as const

export type CartMessageKey = keyof typeof cartZhCN

/**
 * 简化版 t()：从字符串常量表里取值。
 *
 * @param key 文案 key，形如 `cart.pageTitle`
 * @returns 中文文案，找不到时返回 key 本身（便于调试）
 */
export function t(key: string): string {
  if (key.startsWith('cart.')) {
    const subKey = key.slice('cart.'.length) as CartMessageKey
    return cartZhCN[subKey] ?? key
  }
  return key
}
