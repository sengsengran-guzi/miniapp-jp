/**
 * 支付结果页（FLOW:F-JP-02.step5/step6）纯逻辑层 —— GZ-JP-204。
 *
 * <p><b>这一页存在的唯一理由</b>：{@code uni.requestPayment} 的 success 回调<b>不是最终态</b>
 * （跨层契约 #6：支付结果以后端微信回调为准）。客人手机上弹出「支付成功」时，微信的异步回调
 * 可能还没打到我们后端 —— 此刻立刻跳订单详情会看到一个「待支付」的已付款订单。
 * 所以中间隔一页，<b>回读后端订单状态</b>直到它真的转 paid。</p>
 *
 * <p><b>轮询的是订单而不是支付流水</b>：流水 paid 与订单 paid 在同一个回调事务里，
 * 但订单才是业务真相（SPI handler 跑完才算数）。轮询流水可能出现「流水已 paid、
 * 订单还没激活商品行」的中间态。</p>
 *
 * <p><b>纪律</b>：纯函数，不 import uni / vue / 组件，不读全局时钟（次数由调用方传）。</p>
 */

/* ============================================================
 * 1. 轮询节奏
 * ============================================================ */

/**
 * 轮询间隔（毫秒）。
 *
 * <p>1.5 秒：微信回调通常 1-3 秒内到，dev 的 mock 回调是同步的（提交后立刻就是 paid）。
 * 再短会在慢网下堆请求，再长客人会觉得卡住了。</p>
 */
export const POLL_INTERVAL_MS = 1500

/**
 * 最多轮询几次（{@link POLL_INTERVAL_MS} × 本值 ≈ 15 秒）。
 *
 * <p>到顶不代表支付失败 —— 只代表<b>此刻还没确认到</b>。所以到顶后的文案是
 * 「还没收到支付结果」+ 一个「刷新」按钮，而不是「支付失败」（后者会让已经付过钱的客人再付一次）。</p>
 */
export const POLL_MAX_ATTEMPTS = 10

/* ============================================================
 * 2. 状态判定
 * ============================================================ */

/**
 * 页面阶段。
 *
 * <ul>
 *   <li>{@code polling} — 还在等后端确认（转圈）</li>
 *   <li>{@code paid}    — ★ 钱已到（跳订单详情）</li>
 *   <li>{@code unpaid}  — 还是待支付（可能取消了 / 回调还没到）→ 给「重新支付」与「去我的订单」</li>
 *   <li>{@code closed}  — 订单已取消 / 已关闭（超时关单）→ 只能回订单列表</li>
 * </ul>
 */
export type PayResultPhase = 'polling' | 'paid' | 'unpaid' | 'closed'

/**
 * 订单状态里哪些算「钱已经到了」。
 *
 * <p>★ 含 {@code partial_refunded} / {@code refunded}：这两个态的前提是<b>先付过钱</b>
 * （FLOW:F-JP-04 行级退款）。轮询期间理论上碰不到，但客人从别处返回本页时可能碰到 ——
 * 那时告诉他「还没支付」是错的。</p>
 */
const PAID_LIKE = new Set(['paid', 'partial_refunded', 'refunded'])

/** 订单状态里哪些算「这单没了」（不可能再支付）。 */
const CLOSED_LIKE = new Set(['cancelled'])

/**
 * 由订单状态 + 已轮询次数算出页面阶段。
 *
 * @param businessStatus 后端订单状态（拉取失败时传 null / 空串 → 视为未知，继续轮询）
 * @param attempts       已经轮询了几次
 * @param maxAttempts    上限（默认 {@link POLL_MAX_ATTEMPTS}）
 */
export function resolvePhase(
  businessStatus: string | null | undefined,
  attempts: number,
  maxAttempts: number = POLL_MAX_ATTEMPTS,
): PayResultPhase {
  const status = String(businessStatus ?? '').trim()
  if (PAID_LIKE.has(status)) {
    return 'paid'
  }
  if (CLOSED_LIKE.has(status)) {
    return 'closed'
  }
  // created / 未知（拉取失败）→ 还有机会就继续等，到顶了如实说「还没确认到」
  return attempts < maxAttempts ? 'polling' : 'unpaid'
}

/** 这个阶段还要不要继续轮询（只有 polling 要）。 */
export function shouldKeepPolling(phase: PayResultPhase): boolean {
  return phase === 'polling'
}

/* ============================================================
 * 3. 路由参数
 * ============================================================ */

/** 支付结果页的 query 参数。 */
export interface PayResultQuery {
  /** 订单主键（轮询详情 / 跳订单详情用） */
  orderId: string
  /** 订单号（展示用，JPO-yyyyMMdd-6位） */
  orderNo: string
  /** ★ 支付单号（重新支付 / dev mock 回调用；<b>不等于 orderNo</b>） */
  outTradeNo: string
  /**
   * 客人在 {@code uni.requestPayment} 那一步的结果。
   *
   * <p>{@code '1'} = 微信侧报了成功（我们仍要回读后端确认）；
   * {@code '0'} = 取消 / 失败（订单保持 created，钱没扣，可以再付）。
   * <b>它只影响首屏文案，不影响判定</b> —— 判定永远看后端。</p>
   */
  paid: boolean
}

/**
 * 拼支付结果页路由。
 *
 * <p>带上 orderNo 是为了首屏<b>立刻</b>能显示订单号（不用等第一次轮询回来），
 * 客人截图给客服时不会截到一个空白的订单号。</p>
 */
export function buildPayResultRoute(q: {
  orderId: string
  orderNo?: string
  outTradeNo?: string
  paid: boolean
}): string {
  const parts = [
    `orderId=${encodeURIComponent(String(q.orderId ?? ''))}`,
    `orderNo=${encodeURIComponent(String(q.orderNo ?? ''))}`,
    `outTradeNo=${encodeURIComponent(String(q.outTradeNo ?? ''))}`,
    `paid=${q.paid ? '1' : '0'}`,
  ]
  return `/pages/order/result?${parts.join('&')}`
}

/** 解析支付结果页 query（缺字段 → 空串 / false，页面据此兜底）。 */
export function parsePayResultQuery(
  options: Record<string, string | undefined> | null | undefined,
): PayResultQuery {
  const get = (k: string) => String(options?.[k] ?? '').trim()
  return {
    orderId: get('orderId'),
    orderNo: get('orderNo'),
    outTradeNo: get('outTradeNo'),
    paid: get('paid') === '1',
  }
}
