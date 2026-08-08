/**
 * 我的订单列表页纯逻辑层 —— GZ-JP-205 / UI:mp.order_list。
 *
 * <p>列表只回答<b>「钱怎么样了」</b>（订单级 businessStatus）。<b>货到哪了</b>是逐款独立的
 * （一单 30 款各自进度不同，ADR-0020 §1），要点进详情按履约状态分组看 —— 所以列表卡上
 * <b>刻意没有</b>「运输中 / 已签收」这类货态文案，那会骗人。</p>
 *
 * <p><b>纪律</b>：纯函数，不 import uni / vue / 组件。</p>
 */
import type { GzJpOrderListItemVO } from '@/api/gz-jp/order'
import { ORDER_LIST_TAB_UNPAID } from '@/api/gz-jp/order'

/* ============================================================
 * 1. Tab
 * ============================================================ */

/**
 * 列表 tab。
 *
 * <p><b>★ {@code status} 直接就是后端 {@code GET /order/list?businessStatus=} 的入参</b>
 * （取订单状态原值，不自造 `unpaid` 之类的前端别名）—— 中间少一层映射表，就少一处能写错的地方。
 * 「全部」的 status 是空串（不传该参数）。</p>
 *
 * <p><b>为什么「进行中」= paid</b>：钱付了、货在路上（逐款进度进详情看）。
 * <b>为什么「已完成」含 refunded / partial_refunded</b>：对客人来说「这单结束了」——
 * 要么货到了要么钱回来了，都不需要他再做什么。而 {@code cancelled}（未付自动关单）
 * 归在「已完成」里也合理：它同样是终态，且客人不必再操作。</p>
 */
export interface OrderTab {
  /** tab 唯一 key（也是路由 {@code ?tab=} 的值） */
  key: string
  /** ★ 后端 businessStatus 入参；空串 = 不过滤 */
  status: string
  /** 文案 key（页面用 t() 取中文） */
  labelKey: string
}

/**
 * 四个 tab（AC：全部 / 待支付 / 进行中 / 已完成）。
 *
 * <p>⚠️ 「已完成」在后端是<b>多个状态</b>，而 {@code GET /order/list} 的
 * {@code businessStatus} 只收单值 —— 所以它的 {@code status} 留空（拉全部），
 * 由 {@link filterOrdersByTab} 在前端收口。数据量在个人订单尺度上完全可控
 * （一个客人一年也就几十单），比为了一个 tab 去改后端契约划算。</p>
 */
export const ORDER_TABS: readonly OrderTab[] = [
  { key: 'all', status: '', labelKey: 'order.tabAll' },
  { key: ORDER_LIST_TAB_UNPAID, status: ORDER_LIST_TAB_UNPAID, labelKey: 'order.tabUnpaid' },
  { key: 'ongoing', status: 'paid', labelKey: 'order.tabOngoing' },
  { key: 'done', status: '', labelKey: 'order.tabDone' },
] as const

/** 默认 tab（进页面没带 {@code ?tab=} 时）。 */
export const DEFAULT_ORDER_TAB = 'all'

/** 「已完成」tab 覆盖的订单状态（前端收口，见 {@link ORDER_TABS} 注释）。 */
const DONE_STATUSES = new Set(['refunded', 'partial_refunded', 'cancelled'])

/**
 * 解析路由 {@code ?tab=}。
 *
 * <p>支付结果页失败 / 取消后跳回来带的就是 {@code ?tab=created}
 * （GZ-JP-204 的 {@code buildOrderListRoute}）—— 未知值一律回落「全部」，
 * <b>不留空白页</b>。</p>
 */
export function parseOrderListQuery(
  options: Record<string, string | undefined> | null | undefined,
): { tab: string } {
  const raw = String(options?.tab ?? '').trim()
  const hit = ORDER_TABS.find(t => t.key === raw)
  return { tab: hit ? hit.key : DEFAULT_ORDER_TAB }
}

/** 按 key 取 tab（未知 → 「全部」）。 */
export function tabOf(key: string): OrderTab {
  return ORDER_TABS.find(t => t.key === key) ?? ORDER_TABS[0]
}

/**
 * 该 tab 请求后端时要带的 {@code businessStatus}。
 *
 * @returns 状态原值；空串 = 不带该参数（全部）
 */
export function requestStatusOf(tabKey: string): string {
  return tabOf(tabKey).status
}

/**
 * 前端二次过滤（只有「已完成」用得上，其余 tab 原样返回）。
 *
 * <p>「已完成」在后端是多个状态、单值参数拉不动，所以拉全部再筛（见 {@link ORDER_TABS}）。
 * 其它 tab <b>不在前端重复筛一遍</b>：后端已经筛过，前端再筛只会在两边口径漂移时
 * 悄悄吞掉本该显示的订单。</p>
 */
export function filterOrdersByTab(
  rows: readonly GzJpOrderListItemVO[] | null | undefined,
  tabKey: string,
): GzJpOrderListItemVO[] {
  const list = Array.isArray(rows) ? [...rows] : []
  if (tabKey !== 'done') {
    return list
  }
  return list.filter(r => DONE_STATUSES.has(String(r?.businessStatus ?? '').trim()))
}

/* ============================================================
 * 2. 卡片展示派生
 * ============================================================ */

/** 列表卡最多显示几张缩略图（后端也只下发前 N 张，这里是渲染侧的二道闸）。 */
export const MAX_THUMBS = 4

/**
 * 卡片要显示的缩略图。
 *
 * <p>后端无图时回落的占位路径（{@code /static/images/mock-product.png}）
 * <b>在 miniapp-jp 里并不存在</b>（见 {@code BACKEND_PLACEHOLDER_COVER} 注释）——
 * 直接丢给 {@code <image>} 会 404 出空白框，所以这里滤掉，让页面走内置占位块。</p>
 */
export function visibleThumbs(thumbUrls: readonly string[] | null | undefined): string[] {
  const list = Array.isArray(thumbUrls) ? thumbUrls : []
  return list
    .map(u => String(u ?? '').trim())
    .filter(u => !!u && !u.startsWith('/static/'))
    .slice(0, MAX_THUMBS)
}

/**
 * 「还有 N 款」的 N（款数超过展示出来的缩略图数时的剩余量）。
 *
 * <p>基数是 {@code itemCount}（款数）而不是缩略图数组长度：后端只下发前 4 张图，
 * 一单 30 款时客人要看到的是「还有 26 款」，不是「还有 0 款」。</p>
 *
 * @returns 剩余款数；不需要提示时返回 0
 */
export function moreCountOf(
  itemCount: number | null | undefined,
  shownThumbs: number,
): number {
  const total = Number(itemCount)
  if (!Number.isFinite(total) || total <= shownThumbs) {
    return 0
  }
  return total - shownThumbs
}

/**
 * 下单时间的展示文案。
 *
 * <p>后端给的是 {@code 2026-08-07 10:05:23}（LocalDateTime 序列化）。列表上只留到分钟：
 * 秒对客人没有意义，还挤掉订单号的宽度。<b>不做时区换算</b> —— 后端已按 GMT+8 出，
 * 再换一次只会把时间弄错。</p>
 *
 * @returns 形如 {@code 2026-08-07 10:05}；解析不了时原样返回（不吞）
 */
export function formatOrderTime(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim()
  if (!s) {
    return ''
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : s
}

/* ============================================================
 * 3. 分页
 * ============================================================ */

/** 列表加载状态（页面据此选渲染分支，不自己拼 boolean 组合）。 */
export type ListPhase = 'loading' | 'empty' | 'ready' | 'error'

/**
 * 由「是否首屏加载中 / 有没有出错 / 拿到几条」算出列表阶段。
 *
 * <p><b>只有首屏才显示 loading / error 整页态</b>：翻第二页时出错不该把已经看到的
 * 订单擦掉换成一个错误页 —— 那比什么都不做更糟。</p>
 */
export function resolveListPhase(
  loading: boolean,
  failed: boolean,
  rowCount: number,
): ListPhase {
  if (rowCount > 0) {
    return 'ready'
  }
  if (loading) {
    return 'loading'
  }
  return failed ? 'error' : 'empty'
}

/**
 * 还能不能再翻一页。
 *
 * @param loadedCount 已加载条数
 * @param total 后端 total
 */
export function hasMore(loadedCount: number, total: number | null | undefined): boolean {
  const t = Number(total)
  if (!Number.isFinite(t)) {
    return false
  }
  return loadedCount < t
}
