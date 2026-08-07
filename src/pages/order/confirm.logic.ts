/**
 * 下单确认（UI:mp.order_confirm / FLOW:F-JP-02.step3）纯逻辑层 —— GZ-JP-204。
 *
 * <p><b>纪律</b>（同 pages/cart/index.logic.ts）：本文件<b>不 import uni / vue / 任何组件</b>，
 * 只 import 类型与 api 层纯函数。所有函数是纯函数（同输入同输出、无副作用、不改入参）。
 * 可见字符串不在这里拼（i18n 归 locale）。</p>
 *
 * <p><b>为什么把提交闸门抽成纯函数</b>：AC 有两条互相独立的拦截条件
 * （地址必选 / 已阅读不支持退款必勾），再叠上「有失效商品」「正在提交」「一件都没有」，
 * 一共 5 个 disabled 来源。写在 .vue 里的 {@code computed(() => a && b && !c && !d)}
 * 只能证明「点不动」，证明不了「为什么点不动」—— 而客人看到一个灰按钮时最需要知道的
 * 恰恰是原因。这里返回 {@code reason}，页面据此 toast 具体缺什么。</p>
 */
import type { GzJpCartItemVO, GzJpCartVO } from '@/api/gz-jp/cart'
import type { GzUserAddressVO } from '@/api/gz-user-address'
import { flattenItems } from '../cart/index.logic'

/* ============================================================
 * 1. 路由参数
 * ============================================================ */

/**
 * 解析 {@code /pages/order/confirm?ids=39,40} 的 ids。
 *
 * <p>购物车「去结算」用 {@code buildCheckoutRoute} 生成，两边的编解码要对称
 * （{@code encodeURIComponent} → uni 的 onLoad 已自动 decode 一次，这里只做拆分与清洗）。</p>
 *
 * <p><b>去重 + 保序</b>：重复 id 会让后端把同一行结算两次（虽然它自己也去重了，
 * 但页面上会出现两条一模一样的商品，客人会以为自己买了两份）。</p>
 *
 * @param raw onLoad 拿到的 {@code options.ids}
 * @returns 购物车项 id 数组；空 / 非法 → `[]`
 */
export function parseCheckoutIds(raw: string | null | undefined): string[] {
  const s = String(raw ?? '').trim()
  if (!s) {
    return []
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of s.split(',')) {
    const id = part.trim()
    if (id && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

/* ============================================================
 * 2. 商品清单（从整车里挑出被结算的那几行）
 * ============================================================ */

/** {@link pickCheckoutItems} 的结果。 */
export interface CheckoutItems {
  /** 被结算的行（<b>保持购物车渲染顺序</b>，不按 ids 的顺序） */
  items: GzJpCartItemVO[]
  /** 传进来但车里已经找不到的 id（别的端删了 / 已被结算过） */
  missingIds: string[]
  /** 被结算的行里此刻已失效的（场刚关 / 商品刚下架）—— 有值就不能提交 */
  invalidItems: GzJpCartItemVO[]
}

/**
 * 从整车里挑出要结算的行。
 *
 * <p><b>★ 必须重新检查 {@code invalid}</b>（GZ-JP-203 报告点名）：客人在购物车勾完到点进确认页
 * 之间，店员可能刚把场关了。购物车那一刻的判定不能带过来 —— 这里用的是<b>本次新拉的整车</b>，
 * {@code invalid} 是后端实时算的。</p>
 *
 * <p><b>顺序跟车走不跟 ids 走</b>：客人刚在购物车看过一遍排列，确认页换个顺序会让人重新找一遍。</p>
 */
export function pickCheckoutItems(
  cart: GzJpCartVO | null | undefined,
  ids: readonly string[],
): CheckoutItems {
  const want = new Set((ids ?? []).map(String))
  const items = flattenItems(cart).filter(it => want.has(String(it.id)))
  const found = new Set(items.map(it => String(it.id)))
  return {
    items,
    // Array.from 而不是展开 Set：tsconfig target 低于 es2015 时展开迭代器编不过（同购物车页的 Map 坑）
    missingIds: Array.from(want).filter(id => !found.has(id)),
    invalidItems: items.filter(it => it.invalid === true),
  }
}

/**
 * 应付金额（<b>分</b>）= Σ 行金额。
 *
 * <p><b>★ 这就是全部</b> —— 商品合计 == 实付，中间<b>没有第三行</b>（REQ-ORDER-004 全包邮）。
 * 逐行用后端算好的 {@code amountCent} 累加，不在前端做 {@code priceCent × qty}（同购物车）。
 * 非有限数按 0 计，不让一个 NaN 把整个金额变成「¥NaN」。</p>
 *
 * <p>页面显示的是这个值，提交时把它作为 {@code expectedAmountCent} 送回后端做比对闸 ——
 * 于是「客人看到的价」与「实际扣款」不一致时后端会 4104 拒单，而不是默默按新价扣。</p>
 */
export function checkoutAmountCent(items: readonly GzJpCartItemVO[] | null | undefined): number {
  let sum = 0
  for (const it of items ?? []) {
    const amount = it?.amountCent
    if (typeof amount === 'number' && Number.isFinite(amount)) {
      sum += amount
    }
  }
  return sum
}

/** 总件数（Σ qty）—— 金额区的「共 N 件」。 */
export function checkoutQty(items: readonly GzJpCartItemVO[] | null | undefined): number {
  let sum = 0
  for (const it of items ?? []) {
    const qty = it?.qty
    if (typeof qty === 'number' && Number.isFinite(qty) && qty > 0) {
      sum += Math.floor(qty)
    }
  }
  return sum
}

/* ============================================================
 * 3. 收货地址
 * ============================================================ */

/**
 * 进页面时默认选中哪个地址。
 *
 * <p>优先级：<b>后端标的默认地址 → 列表第一个</b>（后端已把默认置顶，所以两者通常同一个；
 * 分开写是因为「后端排序」不该被前端当成隐式契约）。空地址簿 → null（页面显示「添加收货地址」）。</p>
 */
export function pickDefaultAddress(
  list: readonly GzUserAddressVO[] | null | undefined,
): GzUserAddressVO | null {
  const arr = (list ?? []).filter(Boolean)
  if (!arr.length) {
    return null
  }
  return arr.find(a => Number(a.isDefault) === 1) ?? arr[0]
}

/**
 * 上一次选中的地址在新列表里还在不在（新增 / 删除地址后重拉时对账）。
 *
 * @returns 仍在 → 返回新列表里的<b>那一份</b>（字段可能刚被编辑过）；不在 → 回落默认地址
 */
export function syncSelectedAddress(
  list: readonly GzUserAddressVO[] | null | undefined,
  selectedId: string | null | undefined,
): GzUserAddressVO | null {
  const arr = (list ?? []).filter(Boolean)
  const id = String(selectedId ?? '')
  if (id) {
    const hit = arr.find(a => String(a.id) === id)
    if (hit) {
      return hit
    }
  }
  return pickDefaultAddress(arr)
}

/** 地址的「省市区 + 详细」单行展示（省市同名时不重复，如「北京市 北京市」→「北京市」）。 */
export function formatAddressLine(addr: GzUserAddressVO | null | undefined): string {
  if (!addr) {
    return ''
  }
  const parts = [addr.province, addr.city, addr.district]
    .map(v => String(v ?? '').trim())
    .filter(Boolean)
  const region: string[] = []
  for (const p of parts) {
    if (region[region.length - 1] !== p) {
      region.push(p)
    }
  }
  const detail = String(addr.detail ?? '').trim()
  return [...region, detail].filter(Boolean).join(' ')
}

/** 新增 / 编辑地址表单的校验结果。 */
export type AddressFormError = 'name' | 'mobile' | 'region' | 'detail' | null

/** 手机号 11 位（与后端 {@code @Pattern(^1[3-9]\d{9}$)} 同口径，前端先拦一道省一次往返）。 */
const MOBILE_RE = /^1[3-9]\d{9}$/

/**
 * 校验新增地址表单。
 *
 * <p>返回<b>第一个</b>不合格的字段（不是全部）：地址表单只有 4 个格子，一次指一个更好改；
 * 一口气报 4 条错的 toast 客人也读不完。</p>
 */
export function validateAddressForm(form: {
  recipientName?: string
  mobile?: string
  province?: string
  city?: string
  district?: string
  detail?: string
}): AddressFormError {
  const name = String(form?.recipientName ?? '').trim()
  if (!name) {
    return 'name'
  }
  const mobile = String(form?.mobile ?? '').trim()
  if (!MOBILE_RE.test(mobile)) {
    return 'mobile'
  }
  const region = [form?.province, form?.city, form?.district].map(v => String(v ?? '').trim())
  if (region.some(v => !v)) {
    return 'region'
  }
  if (!String(form?.detail ?? '').trim()) {
    return 'detail'
  }
  return null
}

/* ============================================================
 * 4. 提交闸门（AC：地址必选 / 已阅读不支持退款必勾）
 * ============================================================ */

/** 提交按钮不可用的原因（null = 可提交）。 */
export type SubmitBlockReason
  = /** 一件商品都没有（ids 全失效 / 车已空） */ 'empty'
    | /** 有商品刚失效 —— 必须退回购物车处理 */ 'invalid'
    | /** ★ AC：地址必选 */ 'no_address'
    | /** ★ 已阅读不支持退款没勾（design-options/mp-product-detail.md 方案 A 的配套举证） */ 'not_agreed'
    | /** 正在提交（防双击打出两张单） */ 'submitting'
    | null

/** {@link buildSubmitGate} 的结果。 */
export interface SubmitGate {
  /** 按钮是否置灰 */
  disabled: boolean
  /** 为什么置灰（页面据此 toast 具体缺什么，而不是让客人对着灰按钮猜） */
  reason: SubmitBlockReason
}

/**
 * 「提交订单」能不能点。
 *
 * <p><b>优先级刻意如此</b>：先报<b>客人自己没法立刻解决的</b>（没商品 / 有失效项 —— 要回购物车），
 * 再报<b>就地能补的</b>（选地址 / 勾协议）。反过来的话，一个购物车已经空了的客人
 * 会被引导去「先勾一下已阅读」，勾完还是不能提交。</p>
 */
export function buildSubmitGate(input: {
  itemCount: number
  invalidCount: number
  addressId: string | null | undefined
  agreedNoRefund: boolean
  submitting: boolean
}): SubmitGate {
  const block = (reason: SubmitBlockReason): SubmitGate => ({ disabled: true, reason })
  if (input.submitting) {
    return block('submitting')
  }
  if (!input.itemCount) {
    return block('empty')
  }
  if (input.invalidCount > 0) {
    return block('invalid')
  }
  if (!String(input.addressId ?? '').trim()) {
    return block('no_address')
  }
  if (!input.agreedNoRefund) {
    return block('not_agreed')
  }
  return { disabled: false, reason: null }
}

/* ============================================================
 * 5. 提交失败后往哪走（后端业务码 → 前端动作）
 * ============================================================ */

/**
 * 提交失败后的动作。
 *
 * <ul>
 *   <li>{@code back_to_cart} — 回购物车（勾选项没了 / 有商品失效）。<b>不要原地重试</b>，
 *       原地重试只会再撞一次同一个错。</li>
 *   <li>{@code reload} — 留在本页重拉（价格变了：拉到新价重新给客人确认一次）。</li>
 *   <li>{@code pick_address} — 留在本页打开地址选择（地址无效：可能刚在别的端删了）。</li>
 *   <li>{@code go_orders} — 去「我的订单」（重复提交：单已经建出来了，再提一次只会多一张）。</li>
 *   <li>{@code stay} — 留在本页什么也不做（未知错误 / 网络失败；msg 已 toast）。</li>
 * </ul>
 */
export type SubmitFailAction = 'back_to_cart' | 'reload' | 'pick_address' | 'go_orders' | 'stay'

/**
 * 后端业务码 → 前端动作。
 *
 * <p>码表在 {@code api/gz-jp/order.ts} 的 {@code JP_ORDER_ERROR}；这里<b>只映射动作</b>，
 * 提示文案一律用后端 msg（4102 会点名是哪件商品、4104 会带正确金额，比前端能编的强）。</p>
 */
export function resolveSubmitFailAction(code: number | null | undefined): SubmitFailAction {
  switch (Number(code)) {
    case 4101: // 勾选项都不属本人 / 车已空
    case 4102: // 有商品失效（msg 点名）
      return 'back_to_cart'
    case 4104: // 价格变动
      return 'reload'
    case 4103: // 地址无效
      return 'pick_address'
    case 4107: // 重复提交 —— ★ 绝不重试
      return 'go_orders'
    default:
      return 'stay'
  }
}
