/**
 * 场详情（UI:mp.event_detail）纯逻辑层 —— GZ-JP-202。
 *
 * <p><b>纪律</b>（同 pages/index/index.logic.ts）：本文件<b>不 import uni / vue / 任何组件</b>，
 * 只 import 类型与 api 层的纯函数。所有函数是纯函数（同输入同输出、无副作用、不读全局时钟 ——
 * {@code now} 一律由调用方传入）。可见字符串不在这里拼（i18n 归 locale），本层只返回结构化结果。</p>
 *
 * <p>页头时间行 / 分页合并 / 路由拼装三处都是边界密集的纯计算，抽出来用 vitest 秒级锁边界，
 * .vue 只剩「取数 + 传参 + 跳转」。</p>
 */
import type { GzJpEventMpVO } from '@/api/gz-jp/event'
import type { CountdownParts } from '@/api/gz-jp/format'
import type { GzJpProductMpVO } from '@/api/gz-jp/product'
import { countdownParts, formatClock, parseBackendTime } from '@/api/gz-jp/format'

/* ============================================================
 * 1. 场状态（展示派生）
 * ============================================================ */

/** 页头展示态：进行中 / 即将开始 / 已结束（与首页三组同口径）。 */
export type EventPhase = 'live' | 'upcoming' | 'ended'

/**
 * 场处于哪个展示态。
 *
 * <p>口径与首页 {@code classifyEvent} 完全一致（doc/jp/tickets/_visibility-extension-pre-201.md）：
 * {@code status} 不是字面 {@code 'open'} 的一律归「已结束」（最保守）；
 * open 的再按 {@code startTime} 切「进行中 / 即将开始」，{@code startTime} 解析失败归「进行中」。</p>
 *
 * <p><b>⚠️ 这只是展示态，不是下单闸门</b>。能不能加购看商品 VO 的 {@code eventBookable}
 * （见 {@link buildAddToCartState}）—— 后端才判得出「店员手动关场」，客户端时钟也不可信。
 * 特别注意：场可能是「即将开始（startTime 未到）」但后端<b>照样允许下单</b>，两者不等价。</p>
 *
 * @param event 场 VO
 * @param nowMs 当前时刻毫秒（调用方传入）
 */
export function eventPhase(event: GzJpEventMpVO | null | undefined, nowMs: number): EventPhase {
  if (!event || event.status !== 'open') {
    return 'ended'
  }
  const startMs = parseBackendTime(event.startTime)
  if (Number.isFinite(startMs) && startMs > nowMs) {
    return 'upcoming'
  }
  return 'live'
}

/* ============================================================
 * 2. 页头时间行（倒计时 / 开场 / 已结束）
 * ============================================================ */

/** 页头时间行语义类型（文案由页面套 locale 组装，本层不出中文）。 */
export type EventHeaderTimingKind = 'countdown' | 'start' | 'endedAt' | 'none'

/** 页头时间行结果。 */
export interface EventHeaderTiming {
  kind: EventHeaderTimingKind
  /** kind='start' / 'endedAt' 时的 'MM/DD HH:mm'；countdown 时为空串 */
  at: string
  /** kind='countdown' 时的剩余拆分；其余为 null */
  parts: CountdownParts | null
}

/** 时间不可用时的统一空结果。 */
const NO_TIMING: EventHeaderTiming = { kind: 'none', at: '', parts: null }

/**
 * 算页头那行时间提示：
 * <ul>
 *   <li>进行中 → <b>倒计时</b>到闭场（{@code kind='countdown'}，页面每秒重算）</li>
 *   <li>即将开始 → 开场时刻（{@code kind='start'}）</li>
 *   <li>已结束 → 结束时刻（{@code kind='endedAt'}）</li>
 * </ul>
 *
 * <p><b>进行中但倒计时已归零</b>（本地时钟已过 endTime、后端还没翻状态）→ 退化成
 * {@code kind='endedAt'}，不显示 00:00:00 也不显示负数。此时 CTA 是否置灰<b>仍以后端
 * {@code eventBookable} 为准</b>，本函数不参与放行判定。</p>
 *
 * @param event 场 VO
 * @param phase {@link eventPhase} 的结果
 * @param nowMs 当前时刻毫秒
 */
export function buildHeaderTiming(
  event: GzJpEventMpVO | null | undefined,
  phase: EventPhase,
  nowMs: number,
): EventHeaderTiming {
  if (!event) {
    return NO_TIMING
  }
  if (phase === 'upcoming') {
    const at = formatClock(parseBackendTime(event.startTime))
    return at ? { kind: 'start', at, parts: null } : NO_TIMING
  }
  const endMs = parseBackendTime(event.endTime)
  if (phase === 'live') {
    const parts = countdownParts(endMs, nowMs)
    if (parts) {
      return { kind: 'countdown', at: '', parts }
    }
    // 本地时钟已过闭场时刻但后端还报 open —— 退化为「已于 … 结束」而不是 00:00:00 / 负数
  }
  const at = formatClock(endMs)
  return at ? { kind: 'endedAt', at, parts: null } : NO_TIMING
}

/* ============================================================
 * 3. 加购放行（★ 唯一依据 = 后端 eventBookable）
 * ============================================================ */

/** 加购按钮状态（文案 key 由页面套 locale，本层不出中文）。 */
export interface AddToCartState {
  /** 是否置灰不可点 */
  disabled: boolean
  /** 置灰原因；当前只有一种：场已结束 */
  reason: 'ended' | ''
}

/**
 * 算加购按钮状态 —— <b>唯一依据是后端下发的 {@code eventBookable}</b>。
 *
 * <p><b>为什么不看别的</b>（这是本卡最容易写错的一处）：</p>
 * <ul>
 *   <li>不看 {@code status}：商品的 {@code status} 说的是它自己在不在架上（mp 侧恒 on_shelf），
 *       跟所属场收不收单是两码事；</li>
 *   <li>不看场的 {@code endTime} 跟本地时钟比：店员<b>手动关场</b>这样判不出来，
 *       且客户端时钟不可信（用户改系统时间就能绕过）；</li>
 *   <li>不看首页的三组分组：那是纯展示派生，不是闸门。</li>
 * </ul>
 *
 * <p><b>缺字段一律按不可加购</b>（{@code undefined} / {@code null} / 非布尔 → disabled）：
 * 宁可拦下一笔本可以成交的单，也不能放进一笔场已结束的单（后端 GZ-JP-105 下单时还会用
 * {@code isBookable} 再拦一道，前端放行只是体验层，拦错方向的代价不对等）。</p>
 *
 * @param bookable 商品 VO 的 {@code eventBookable}
 */
export function buildAddToCartState(bookable: boolean | null | undefined): AddToCartState {
  return bookable === true ? { disabled: false, reason: '' } : { disabled: true, reason: 'ended' }
}

/* ============================================================
 * 4. 分页合并 / 还有没有下一页
 * ============================================================ */

/**
 * 把新一页商品并进已有列表，<b>按 id 去重</b>并保持先来后到顺序。
 *
 * <p>为什么要去重：上拉分页 + 后端按 {@code sort_no} 排序时，若店员在翻页途中改了排序，
 * 同一条商品可能在两页里都出现 —— 直接 concat 会出现「同一个商品在网格里出现两次」，
 * 而且 {@code :key="id"} 重复会让渲染层报警 / 复用错节点。</p>
 *
 * <p>重复时<b>保留先到的那条</b>（不覆盖）：网格是自上而下追加的，把已经渲染在屏上的卡片
 * 换成后到的副本会造成可见跳动。</p>
 *
 * @param existing 已有列表
 * @param incoming 新一页（null / undefined 当空数组）
 * @returns 合并后的新数组（不改原数组）
 */
export function mergeProductPage(
  existing: GzJpProductMpVO[],
  incoming: GzJpProductMpVO[] | null | undefined,
): GzJpProductMpVO[] {
  const seen = new Set<string>()
  const out: GzJpProductMpVO[] = []
  for (const p of [...(existing ?? []), ...(incoming ?? [])]) {
    if (!p) {
      continue
    }
    const key = String(p.id ?? '')
    // id 缺失的脏数据不去重（宁可重复显示也别把不同商品合并掉）
    if (key && seen.has(key)) {
      continue
    }
    if (key) {
      seen.add(key)
    }
    out.push(p)
  }
  return out
}

/**
 * 还有没有下一页。
 *
 * <p>用「已加载条数 &lt; 总数」判，而不是「上一页返回条数 == pageSize」——
 * 后者在「总数刚好是 pageSize 的整数倍」时会多打一次空请求，
 * 且商品被下架导致某页不满时会提前误判到底。</p>
 *
 * @param loadedCount 当前已渲染条数
 * @param total       后端 total（非有限值当 0）
 */
export function hasMoreProducts(loadedCount: number, total: number | null | undefined): boolean {
  const t = typeof total === 'number' && Number.isFinite(total) ? total : 0
  return loadedCount < t
}

/* ============================================================
 * 5. 路由
 * ============================================================ */

/** 商品详情页路由（accept 断言逐字要求该文件名，改名要同步 test/e2e/flows/product.mjs）。 */
export const PRODUCT_DETAIL_ROUTE = '/pages/product/detail'

/** 首页路由（取数失败时的兜底出口；首页是 tabbar 页，跳转要用 switchTab）。 */
export const HOME_ROUTE = '/pages/index/index'

/**
 * 拼商品详情页路由。
 *
 * <p><b>id 与 productNo 都带</b>：{@code id} 用来调详情接口
 * （{@code GET /app/gz/jp/product/{id}}，后端只提供按主键查）；
 * {@code productNo} 是业务码，用于展示 / 分享 / 客服对单（跨层契约「业务码替代 ID 暴露」）。</p>
 *
 * @param product 商品 VO（只用到 id / productNo）
 * @returns 形如 {@code /pages/product/detail?id=1&productNo=JPP-20260807-000001}
 */
export function buildProductRoute(product: Pick<GzJpProductMpVO, 'id' | 'productNo'>): string {
  const query = [`id=${encodeURIComponent(product.id ?? '')}`]
  if (product.productNo) {
    query.push(`productNo=${encodeURIComponent(product.productNo)}`)
  }
  return `${PRODUCT_DETAIL_ROUTE}?${query.join('&')}`
}
