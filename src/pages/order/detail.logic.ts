/**
 * 订单详情页纯逻辑层 —— GZ-JP-205 / UI:mp.order_detail + UI:mp.order_detail.status_group。
 *
 * <p><b>这一页为什么按履约状态分组而不是平铺</b>（Kevin 拍板方案 A）：一单可能 30 款，
 * 每款的履约状态各自独立（ADR-0020 §1：订单只管钱、行才管货）。平铺 30 行时客人要自己
 * 逐行找「哪些已经发了」，而<b>同一个运单号会重复十几次</b> —— 分组之后运单号只在组头出现
 * 一次，客人一眼看到「发货完毕 12 款 / 顺丰速运 SF7654321000」。</p>
 *
 * <p><b>★ 全页不出现「包裹」二字</b>（REQ-FULFILL-006）：客人不感知我们内部怎么打包 ——
 * 分组的依据是<b>履约状态 + 运单号</b>，不是任何一种打包单位。本文件刻意不提供表达该概念的
 * 类型、字段或文案，页面想写也写不出来。</p>
 *
 * <p><b>纪律</b>：纯函数，不 import uni / vue / 组件，不读全局时钟 —— 于是 vitest 能零环境
 * 依赖直接跑（accept #2），LIVE 验证也能把真后端响应原样喂进来。</p>
 */
import type { GzJpOrderItemVO } from '@/api/gz-jp/order'

/* ============================================================
 * 1. 履约状态链（展示顺序）
 * ============================================================ */

/**
 * 分组展示顺序 —— <b>状态链倒序</b>：越接近客人手里的排越前。
 *
 * <p>后端 {@code GzJpFulfillStatus} 的链是 purchasing → await_seller_ship → jp_shipped →
 * customs → cn_sorting → delivered（step 1..6），{@code purchase_failed} 是 step 1 的<b>分支</b>。
 * 这里倒过来排：客人打开详情最想知道的是「哪些已经发了、单号多少」，而不是「哪些还没开始买」。</p>
 *
 * <p><b>{@code purchase_failed} 永远排最后</b>（任务卡明写）：它是坏消息，且带退款文案，
 * 压在最下面不打断上面正常推进的进度阅读。</p>
 *
 * <p>⚠️ <b>这里只排顺序，不定义中文</b> —— 中文一律用后端下发的
 * {@code fulfillStatusLabel}（跨层纪律：状态文案只有一份真源，在后端枚举里）。</p>
 */
export const FULFILL_GROUP_ORDER: readonly string[] = [
  'delivered',
  'cn_sorting',
  'customs',
  'jp_shipped',
  'await_seller_ship',
  'purchasing',
  'purchase_failed',
] as const

/** 购买失败（分支终态，带行级退款）。 */
export const FULFILL_PURCHASE_FAILED = 'purchase_failed'

/**
 * 状态在展示序里的位次（越小越靠前）。
 *
 * <p><b>未知状态</b>（后端加了新态而 mp 还没跟上）不丢也不塞到最前，排在已知态之后、
 * {@code purchase_failed} 之前 —— 客人仍看得见这些货，只是位置保守。</p>
 */
function rankOf(status: string): number {
  const i = FULFILL_GROUP_ORDER.indexOf(status)
  if (i >= 0) {
    return i
  }
  // purchase_failed 恒为数组末位 → 未知态取「末位 - 0.5」，稳定地卡在它前面
  return FULFILL_GROUP_ORDER.length - 1.5
}

/* ============================================================
 * 2. 快递公司中文名
 * ============================================================ */

/**
 * 快递编码 → 中文名（字典 {@code gz_express_carrier} 的 9 项）。
 *
 * <p><b>★ 这是本域唯一一处「前端映射表」，且是被迫的</b>：mp 的
 * {@code GzJpOrderItemVO} 只下发 {@code carrierCode}，<b>没有</b> carrierLabel
 * （对比 {@code fulfillStatusLabel} / {@code refundStatusLabel} 后端都给了）。
 * 与其让客人看到「sf SF7654321000」，不如先在前端映射；
 * <b>正解是后端 VO 补一个 carrierLabel 字段</b>，补上后删掉本表（见完工报告「对下游」）。</p>
 *
 * <p>未知编码<b>不猜也不显示原始编码</b> —— 见 {@link carrierNameOf}。</p>
 */
const CARRIER_NAMES: Readonly<Record<string, string>> = {
  yto: '圆通速递',
  sf: '顺丰速运',
  zto: '中通快递',
  yunda: '韵达速递',
  jd: '京东快递',
  ems: 'EMS',
  debang: '德邦',
  jitu: '极兔速递',
  other: '快递',
}

/**
 * 快递中文名。
 *
 * <p>未知 / 空编码 → 返回空串（页面此时只显示运单号）。<b>刻意不回落成原始编码</b>：
 * 「zzz SF123」比单独一个「SF123」更让客人困惑，而单号本身就够他去快递官网查了。</p>
 */
export function carrierNameOf(carrierCode: string | null | undefined): string {
  const code = String(carrierCode ?? '').trim().toLowerCase()
  return CARRIER_NAMES[code] ?? ''
}

/* ============================================================
 * 3. 退款展示（GZ-JP-107）
 * ============================================================ */

/**
 * 一行商品的退款展示态。
 *
 * <ul>
 *   <li>{@code none}       — 不显示退款信息</li>
 *   <li>{@code refunded}   — ★ 已退款，<b>显示金额</b></li>
 *   <li>{@code processing} — 退款处理中，<b>不显示金额</b></li>
 * </ul>
 */
export type RefundDisplayKind = 'none' | 'refunded' | 'processing'

/** 退款展示结果（页面据此选文案，不自己判 status）。 */
export interface RefundDisplay {
  kind: RefundDisplayKind
  /** 已退金额（分）；★ 只有 {@code refunded} 时非 null */
  amountCent: number | null
  /**
   * 是否加一句「如有疑问请联系客服」。
   *
   * <p>只在后端状态是 {@code refund_failed} 时为 true —— 见 {@link resolveRefundDisplay}。</p>
   */
  needsSupport: boolean
}

/**
 * 由行上的退款字段算出展示态（GZ-JP-107 的 mp 侧口径）。
 *
 * <p><b>★ 只有 {@code refunded} 才给客人看金额</b>：{@code refunding} 期间这笔钱还在路上，
 * 金额仍可能变（部分退 / 重试），过早显示一个具体数字，等它变了就是客诉。</p>
 *
 * <p><b>★ {@code refund_failed} 不把「失败」二字给客人看</b>（107 报告明确要求）：那是内部状态，
 * 客人看到会以为钱要不回来了，而它多半几分钟内就被店员重试好了。对客人一律说
 * 「退款处理中」，只额外加一句联系客服的出口。</p>
 *
 * @param refundStatus 后端 {@code refundStatus}（null = 没有退款）
 * @param refundAmountCent 后端 {@code refundAmountCent}
 */
export function resolveRefundDisplay(
  refundStatus: string | null | undefined,
  refundAmountCent: number | null | undefined,
): RefundDisplay {
  const status = String(refundStatus ?? '').trim()
  if (!status) {
    return { kind: 'none', amountCent: null, needsSupport: false }
  }
  if (status === 'refunded') {
    // ⚠️ 不能直接 Number(refundAmountCent)：JS 里 Number(null) === 0、Number('') === 0。
    // 后端漏字段时那会渲染成「已退款 ¥0.00」—— 给客人一个错的数字，比不显示金额糟得多。
    // 所以 null / undefined / 空串一律先判掉，只有真的是有限数才给金额。
    const cent
      = refundAmountCent === null || refundAmountCent === undefined
        ? Number.NaN
        : Number(refundAmountCent)
    return {
      kind: 'refunded',
      amountCent: Number.isFinite(cent) ? cent : null,
      needsSupport: false,
    }
  }
  if (status === 'refunding' || status === 'refund_failed') {
    return { kind: 'processing', amountCent: null, needsSupport: status === 'refund_failed' }
  }
  // 未知退款状态：当处理中（保守），绝不假装「已退款」
  return { kind: 'processing', amountCent: null, needsSupport: false }
}

/* ============================================================
 * 4. 分组
 * ============================================================ */

/**
 * 一个展示分组 = 同一履约状态 + 同一运单号的一批商品行。
 *
 * <p>「同一运单号」是<b>分子组的依据</b>而不是一种实体：同状态但两个单号 → 两个组，
 * 各自组头带各自的单号。于是「同一运单号只出现一次」是结构上保证的，
 * 不靠页面模板小心翼翼地去重。</p>
 */
export interface FulfillGroup {
  /** v-for 的 key（状态 + 单号，同一订单内唯一） */
  key: string
  /** 履约状态原值（{@code delivered} / {@code purchasing} / …） */
  status: string
  /** 履约状态中文 —— ★ 取后端 {@code fulfillStatusLabel}，前端不维护第二份映射 */
  statusLabel: string
  /** 组内商品行（保持后端给的相对顺序） */
  items: GzJpOrderItemVO[]
  /** 款数（行数）—— 组头「<状态> N 款」的 N */
  itemCount: number
  /** ★ 本组共用的运单号（组头显示一次；无则 null） */
  trackingNo: string | null
  /** 快递中文名（未知编码 → 空串） */
  carrierName: string
  /** 是否购买失败组（页面据此渲染退款文案，不自己比状态字符串） */
  isFailed: boolean
}

/** 运单号规整：null / 空白 / 纯空格一律当「没有单号」。 */
function normalizeTracking(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  return s || null
}

/**
 * 把商品行按「履约状态 → 运单号」分组，并按展示序排好。
 *
 * <p>规则：</p>
 * <ol>
 *   <li>先按 {@code fulfillStatus} 分组，组序 = {@link FULFILL_GROUP_ORDER}（倒序状态链，
 *       {@code purchase_failed} 最后）</li>
 *   <li>同状态内若存在<b>不同运单号</b>，再按运单号分子组；<b>同一运单号的行合成一组</b>
 *       —— 这正是 accept #2 断言的「同一单号只出现一次」</li>
 *   <li>组内与子组间<b>保持后端给的行顺序</b>（稳定分区），不二次排序</li>
 * </ol>
 *
 * <p>AC「30 款分组后不超过 7 个组」由链长天然保证：状态只有 7 种，只有当同一状态下真的存在
 * 多个不同运单号时才会超过 7 —— 而那种情况下多出来的每一组都<b>带着自己的单号</b>，
 * 是客人需要分别查件的真实信息，不是冗余。</p>
 *
 * @param items 订单详情的商品行（null / 空 → 空数组）
 * @returns 排好序的分组；入参为空时返回空数组
 */
export function groupItemsByFulfillStatus(
  items: readonly GzJpOrderItemVO[] | null | undefined,
): FulfillGroup[] {
  const list = Array.isArray(items) ? items : []
  if (!list.length) {
    return []
  }

  /** key = `${status} ${trackingNo ?? ''}` ——   不可能出现在单号里，不怕拼接歧义 */
  const buckets = new Map<string, FulfillGroup>()
  // 记录每个 bucket 首次出现的位置，保证「同状态多单号」时子组顺序 = 后端行顺序
  const firstSeen = new Map<string, number>()

  list.forEach((it, index) => {
    const status = String(it?.fulfillStatus ?? '').trim()
    const tracking = normalizeTracking(it?.trackingNo)
    const key = `${status} ${tracking ?? ''}`

    let g = buckets.get(key)
    if (!g) {
      g = {
        key,
        status,
        // 后端没给 label 时退回状态原值（总比空白强，且能立刻看出是后端漏了字段）
        statusLabel: String(it?.fulfillStatusLabel ?? '').trim() || status,
        items: [],
        itemCount: 0,
        trackingNo: tracking,
        carrierName: carrierNameOf(it?.carrierCode),
        isFailed: status === FULFILL_PURCHASE_FAILED,
      }
      buckets.set(key, g)
      firstSeen.set(key, index)
    }
    g.items.push(it)
    g.itemCount = g.items.length
    // 组内先出现的行没带快递编码、后面的带了 → 补上（同单号的编码必然一致）
    if (!g.carrierName) {
      g.carrierName = carrierNameOf(it?.carrierCode)
    }
  })

  // Array.from 而非 [...map.values()]：本工程 tsconfig 的 target 不开 downlevelIteration，
  // 展开 MapIterator 会 TS2802（真机产物同样走这条编译路径，不是纯类型洁癖）
  return Array.from(buckets.values()).sort((a, b) => {
    const d = rankOf(a.status) - rankOf(b.status)
    if (d !== 0) {
      return d
    }
    // 同状态的多个单号：按首次出现顺序（稳定，不因 Map 迭代顺序或单号字典序抖动）
    return (firstSeen.get(a.key) ?? 0) - (firstSeen.get(b.key) ?? 0)
  })
}

/**
 * 组头文案「<状态> N 款」。
 *
 * @param group 分组
 * @param unit 「款」（由页面从 locale 传入，本模块不绑死文案）
 */
export function groupHeaderText(group: FulfillGroup, unit: string): string {
  return `${group.statusLabel} ${group.itemCount}${unit}`
}

/* ============================================================
 * 5. 路由参数
 * ============================================================ */

/**
 * 解析详情页 query。
 *
 * <p>路由是 {@code /pages/order/detail?id=<订单主键>}（GZ-JP-204 的
 * {@code buildOrderDetailRoute} 拼的就是 {@code id}）—— <b>不是 orderNo</b>，
 * 后端 {@code GET /app/gz/jp/order/{id}} 收的是主键。</p>
 */
export function parseOrderDetailQuery(
  options: Record<string, string | undefined> | null | undefined,
): { orderId: string } {
  return { orderId: String(options?.id ?? '').trim() }
}
