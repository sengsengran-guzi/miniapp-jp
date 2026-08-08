/**
 * 拼团订单（gz_jp_order / gz_jp_order_item）mp 端 API —— GZ-JP-204 下单确认 + 支付。
 *
 * <p>后端契约（GZ-JP-105，路径 {@code /app/gz/jp/order}，<b>全部需登录态</b>）：</p>
 * <ul>
 *   <li>{@code POST /}       — 提交订单（建单 + 落快照 + 调 GZ-PAY 建单，<b>一个事务</b>），返回支付 5 参</li>
 *   <li>{@code GET  /{id}}   — 订单详情（读 {@code res.data}）</li>
 *   <li>{@code GET  /list}   — 我的订单分页（★ 读 {@code res.rows} 不是 {@code res.data}）</li>
 * </ul>
 *
 * <p><b>★ 金额只有商品合计与实付两行，无运费</b>（REQ-ORDER-004 全包邮）——
 * 后端 VO 里根本没有费用类字段，本文件也刻意不提供，让页面想写也写不出来。</p>
 *
 * <p><b>★ 成交价永远是后端重算的 {@code totalAmountCent}</b>：{@code expectedAmountCent}
 * 只是「确认页看到的价」的比对闸（不一致 → 4104），<b>永远不会</b>被当成成交价使用。</p>
 *
 * <p>ID 字段统一 string（跨层契约 #1）。金额单位统一<b>分</b>。</p>
 */
import type { GzJpPageResult } from '@/api/gz-jp/event'
import { http } from '@/http/http'

/* ============================================================
 * 1. 路由常量（页面与 E2E flow 共用，改文件名只改这里）
 * ============================================================ */

/** 下单确认页（本卡交付；购物车「去结算」的落点，见 pages/cart/index.logic.ts 的 CHECKOUT_ROUTE）。 */
export const ORDER_CONFIRM_ROUTE = '/pages/order/confirm'

/** 支付结果页（本卡交付）。 */
export const ORDER_RESULT_ROUTE = '/pages/order/result'

/** 订单详情页（GZ-JP-205 交付）。支付成功后跳这里。 */
export const ORDER_DETAIL_ROUTE = '/pages/order/detail'

/** 我的订单列表页（GZ-JP-205 交付）。支付失败 / 取消后回这里的「待支付」tab。 */
export const ORDER_LIST_ROUTE = '/pages/order/list'

/**
 * 「待支付」tab 的 query 值。
 *
 * <p>取后端订单状态原值 {@code created}（而不是自造一个 `unpaid`）：205 拿它直接当
 * {@code GET /order/list?businessStatus=} 的入参，中间少一层映射表，也就少一处能写错的地方。</p>
 */
export const ORDER_LIST_TAB_UNPAID = 'created'

/** 拼下单确认页路由（购物车项 id 逗号分隔）。 */
export function buildOrderConfirmRoute(cartItemIds: readonly string[]): string {
  const list = (cartItemIds ?? []).map(String).filter(Boolean)
  if (!list.length) {
    return ORDER_CONFIRM_ROUTE
  }
  return `${ORDER_CONFIRM_ROUTE}?ids=${encodeURIComponent(list.join(','))}`
}

/** 拼订单详情页路由。 */
export function buildOrderDetailRoute(orderId: string): string {
  return `${ORDER_DETAIL_ROUTE}?id=${encodeURIComponent(String(orderId))}`
}

/** 拼订单列表页路由（默认落「待支付」tab）。 */
export function buildOrderListRoute(tab: string = ORDER_LIST_TAB_UNPAID): string {
  return `${ORDER_LIST_ROUTE}?tab=${encodeURIComponent(tab)}`
}

/* ============================================================
 * 2. 业务错误码（后端 GzJpOrderErrorCode）
 * ============================================================ */

/**
 * 提交订单的业务错误码。
 *
 * <p><b>msg 一律用后端原文</b>（http.ts 已 toast）——「「柯南 吧唧 A赏」已下架」比
 * 前端能编出来的任何话都有用。前端只用 code 决定<b>跳到哪</b>。</p>
 */
export const JP_ORDER_ERROR = {
  /** 4101 勾选项一个都不属本人 / 车已空 → 回购物车重拉 */
  CART_EMPTY: 4101,
  /** 4102 有商品失效（msg 点名）→ ★ 退回购物车，别原地重试 */
  ITEM_INVALID: 4102,
  /** 4103 收货地址无效 → 重选地址 */
  ADDRESS_INVALID: 4103,
  /** 4104 价格与确认页不一致（msg 带正确金额）→ 刷新确认页重新确认 */
  PRICE_CHANGED: 4104,
  /** 4105 订单不存在 / 不是本人（不区分，不泄漏别人有没有这单） */
  ORDER_NOT_FOUND: 4105,
  /** 4107 重复提交（并发 / 双击）→ ★ 不要重试，去「我的订单」看那张单 */
  DUPLICATE_SUBMIT: 4107,
} as const

/**
 * 从 http 层 reject 出来的东西里取业务码。
 *
 * <p>{@code http()} 默认只 reject {@code responseData.data}（业务错误时恒为 null），
 * 拿不到 code。本域的提交请求带 {@code rawBizError: true} → reject 整个响应体，
 * 于是这里能读到 {@code code}。<b>其他域不受影响</b>（该选项默认关）。</p>
 *
 * @returns 业务码；不是业务错误（网络失败 / 未开启 rawBizError）→ null
 */
export function bizErrorCodeOf(e: unknown): number | null {
  if (!e || typeof e !== 'object') {
    return null
  }
  const code = Number((e as { code?: unknown }).code)
  return Number.isFinite(code) ? code : null
}

/** 从 http 层 reject 出来的东西里取后端 msg（取不到返回空串）。 */
export function bizErrorMsgOf(e: unknown): string {
  if (!e || typeof e !== 'object') {
    return ''
  }
  const box = e as { msg?: unknown, message?: unknown }
  return String(box.msg ?? box.message ?? '').trim()
}

/* ============================================================
 * 3. 提交订单
 * ============================================================ */

/** 提交订单请求体（后端 {@code GzJpOrderSubmitBo}）。 */
export interface GzJpOrderSubmitReq {
  /** ★ 【购物车项 id】不是商品 id；最多 50 */
  cartItemIds: string[]
  /** 收货地址主键（必填，后端校验归属） */
  addressId: string
  /** 客人备注（可空） */
  userNote?: string
  /**
   * 确认页上显示的应付金额（<b>分</b>，可选）。
   *
   * <p><b>只做比对闸</b>：与后端重算值不一致 → 4104 拒单。<b>永远不会</b>被当成成交价，
   * 所以传它不是安全风险，反而是「客人看到的价 ≠ 实际扣款」的唯一拦截手段 —— 必传。</p>
   */
  expectedAmountCent?: number
}

/** mp 端 {@code uni.requestPayment} 5 参 + out_trade_no（后端 {@code MpPayParamsVO}）。 */
export interface MpPayParamsVO {
  timeStamp: string
  nonceStr: string
  /** ★ 后端字段名 {@code packageVal}（package 是 JS 保留字）；调起时映射成 {@code package} */
  packageVal: string
  signType: string
  paySign: string
  /**
   * 支付单号。
   *
   * <p>⚠️ <b>与订单号 {@code orderNo} 不是同一个值</b>（同一序列的相邻两个号）——
   * mock 回调 / 查支付状态传的是<b>本字段</b>，传 orderNo 会「订单不存在」。</p>
   */
  outTradeNo: string
}

/** 提交订单响应（后端 {@code GzJpOrderSubmitVO}）。 */
export interface GzJpOrderSubmitVO {
  /** 订单主键（跳详情 / 轮询用） */
  orderId: string
  /** 订单号 JPO-yyyyMMdd-6位（展示 / 客服对单用） */
  orderNo: string
  /** ★ 后端重算的成交价（<b>分</b>），以它刷新确认页 */
  totalAmountCent: number
  /** 款数 */
  itemCount: number
  /** 微信支付 5 参 */
  payParams: MpPayParamsVO
}

/**
 * POST /app/gz/jp/order — 提交订单（<b>需登录</b>）。
 *
 * <p><b>点一次即置灰</b>：后端 4107 是兜底（靠清车行数比对把并发串行化），不是让前端依赖它。</p>
 *
 * <p>失败时 reject 的是<b>整个响应体</b>（{@code rawBizError}），用
 * {@link bizErrorCodeOf} 取 code 决定跳哪；msg 已由 http.ts toast 过，别再叠一层。</p>
 */
export function submitJpOrder(req: GzJpOrderSubmitReq): Promise<GzJpOrderSubmitVO> {
  return http<GzJpOrderSubmitVO>({
    url: '/app/gz/jp/order',
    method: 'POST',
    data: req,
    rawBizError: true,
  })
}

/* ============================================================
 * 4. 订单详情（支付结果页回读状态用；完整用法归 GZ-JP-205）
 * ============================================================ */

/** 订单上锁定的收货地址快照（下单那一刻的值，之后改地址簿不影响已有订单）。 */
export interface GzJpOrderAddressVO {
  recipient: string
  mobile: string
  province: string
  city: string
  district: string
  detail: string
}

/** 订单商品行（后端 {@code GzJpOrderItemVO}，字段来自下单时的商品快照）。 */
export interface GzJpOrderItemVO {
  id: string
  productId: string
  productNo: string
  name: string
  /** 主图可渲染 URL（后端保证非 null） */
  mainImageUrl: string | null
  deliveryDateText: string | null
  noticeText: string | null
  eventName: string | null
  qty: number
  unitPriceCent: number
  amountCent: number
  /** 来源维度（一期恒 batch，为二期代切 snap 预留） */
  source: string
  /** 履约状态 purchasing / await_seller_ship / … / delivered / purchase_failed */
  fulfillStatus: string
  /** ★ 履约状态中文（后端已给，别在前端再维护一份映射表） */
  fulfillStatusLabel: string
  carrierCode: string | null
  trackingNo: string | null
  shippedAt: string | null
  refundStatus: string | null
  refundStatusLabel: string | null
  refundAmountCent: number | null
}

/** 订单详情（后端 {@code GzJpOrderDetailVO}）。 */
export interface GzJpOrderDetailVO {
  id: string
  orderNo: string
  /** 实付（<b>分</b>）= Σ 行金额，★ 无运费 */
  totalAmountCent: number
  /** 订单状态 created / paid / cancelled / partial_refunded / refunded —— 只回答「钱怎么样了」 */
  businessStatus: string
  /** 订单状态中文（后端已给） */
  businessStatusLabel: string
  userNote: string | null
  address: GzJpOrderAddressVO | null
  items: GzJpOrderItemVO[]
  itemCount: number
  totalQty: number
  createTime: string | null
  paidTime: string | null
  cancelledTime: string | null
}

/**
 * GET /app/gz/jp/order/{id} — 订单详情（<b>需登录，仅本人</b>）。
 *
 * <p>支付结果页用它<b>回读真状态</b>：{@code uni.requestPayment} 的 success 回调
 * <b>不是最终态</b>（跨层契约 #6：以后端回调为准）。</p>
 */
export function fetchJpOrderDetail(orderId: string): Promise<GzJpOrderDetailVO> {
  return http<GzJpOrderDetailVO>({
    url: `/app/gz/jp/order/${encodeURIComponent(String(orderId))}`,
    method: 'GET',
    // 结果页轮询期间 404/4105 由页面自己兜（每 2 秒弹一次 toast 会刷屏）
    hideErrorToast: true,
    rawBizError: true,
  })
}

/* ============================================================
 * 5. 我的订单分页（GZ-JP-205）
 * ============================================================ */

/**
 * 订单列表卡（后端 {@code GzJpOrderListItemVO}）。
 *
 * <p><b>★ 列表不下发商品行</b>：一单可能 30 款，列表页既渲染不了也不需要。
 * 逐款履约进度要点进详情（{@link fetchJpOrderDetail}）。</p>
 */
export interface GzJpOrderListItemVO {
  id: string
  orderNo: string
  /** 实付（<b>分</b>），★ 无运费 */
  totalAmountCent: number
  businessStatus: string
  businessStatusLabel: string
  /** 款数（行数） */
  itemCount: number
  /** 总件数（Σ qty） */
  totalQty: number
  /** 前 N 张商品缩略图（后端保证非 null；无图时是一个 mp 侧并不存在的占位路径） */
  thumbUrls: string[]
  createTime: string | null
  paidTime: string | null
}

/** 列表每页条数（一屏能滚完、又不至于让「加载更多」点太多次）。 */
export const ORDER_LIST_PAGE_SIZE = 10

/**
 * GET /app/gz/jp/order/list — 我的订单分页（<b>需登录</b>，下单时间倒序）。
 *
 * <p><b>★ 读 {@code res.rows} 不是 {@code res.data}</b>：分页端点直返
 * {@code TableDataInfo}（无 {@code data} 字段）。{@code http.ts} 已识别这一形态并直返整对象，
 * 所以这里的返回类型是 {@link GzJpPageResult} 而不是数组 —— D16 逮到过 6 处「把 rows 写成
 * data 导致列表恒空」的前端契约 bug，本域从类型上就不给写错的机会。</p>
 *
 * @param params.businessStatus 订单状态过滤（不传 = 全部）。★ 取后端状态原值，中间不加映射表
 */
export function fetchJpOrderList(params: {
  pageNum?: number
  pageSize?: number
  businessStatus?: string
} = {}): Promise<GzJpPageResult<GzJpOrderListItemVO>> {
  const query: Record<string, string | number> = {
    pageNum: params.pageNum ?? 1,
    pageSize: params.pageSize ?? ORDER_LIST_PAGE_SIZE,
  }
  const status = String(params.businessStatus ?? '').trim()
  if (status) {
    query.businessStatus = status
  }
  return http<GzJpPageResult<GzJpOrderListItemVO>>({
    url: '/app/gz/jp/order/list',
    method: 'GET',
    query,
  })
}
