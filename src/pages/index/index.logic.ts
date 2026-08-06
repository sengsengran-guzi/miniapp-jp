/**
 * 首页（UI:mp.home）纯逻辑层 —— GZ-JP-201。
 *
 * <p><b>为什么单独一个文件</b>：首页的三个决策点（banner 降级 / 场分三组 / 角标）全是
 * 边界密集的纯计算，塞进 .vue 里就只能靠模拟器 E2E 覆盖（贵且慢）。抽成零依赖纯函数后
 * 用 vitest 秒级锁边界，.vue 只剩「取数 + 传参 + 跳转」。</p>
 *
 * <p><b>纪律</b>：本文件<b>不 import uni / vue / 任何组件</b>，只 import 类型。
 * 所有函数必须是纯函数（同输入同输出，无副作用，不读全局时钟 —— {@code now} 一律由调用方传入，
 * 这样测试才能造「刚好等于开场时刻」这种边界）。可见字符串一律不在这里拼（i18n 归 locale），
 * 本文件只返回结构化结果（如 {@code {kind,at}}），由页面套 t() 组文案。</p>
 */
import type { HomeBannerItem } from '@/api/gz-common'
import type { GzJpEventMpVO } from '@/api/gz-jp/event'
import { formatClock, hasRealCover, parseBackendTime } from '@/api/gz-jp/format'

/* ============================================================
 * 1. 时间解析 / 封面兜底 —— 已上提到 @/api/gz-jp/format（GZ-JP-202）
 * ============================================================ */

/**
 * 三个后端契约适配函数（时间串解析 / 时钟格式化 / 封面兜底）在 GZ-JP-202 起
 * 由场详情 + 商品详情共用，实现上提到 {@code @/api/gz-jp/format}。
 *
 * <p>这里<b>原样 re-export</b> 而不是让调用方改 import：首页页面与 201 的既有单测都从
 * {@code ./index.logic} 取这三个，路径保持稳定，改动面收敛在一行 import 上。</p>
 */
export { formatClock, hasRealCover, parseBackendTime }

/* ============================================================
 * 2. 场分组（进行中 / 即将开始 / 已结束）
 * ============================================================ */

/** 首页场分组 key（展示分组，<b>不是</b>后端状态；后端只有 open / closed）。 */
export type EventGroupKey = 'live' | 'upcoming' | 'ended'

/** 分组展示顺序：进行中置顶（Kevin 拍板），然后即将开始，最后已结束。 */
export const EVENT_GROUP_ORDER: readonly EventGroupKey[] = ['live', 'upcoming', 'ended'] as const

/** 一个分组及其成员。 */
export interface HomeEventGroup {
  key: EventGroupKey
  events: GzJpEventMpVO[]
}

/**
 * 判定单场属于哪一组。
 *
 * <p>口径（doc/jp/tickets/_visibility-extension-pre-201.md「前端契约要点」）：</p>
 * <ul>
 *   <li>进行中 live = {@code status === 'open' && startTime <= now}</li>
 *   <li>即将开始 upcoming = {@code status === 'open' && startTime > now}</li>
 *   <li>已结束 ended = 其余（正常只有 {@code status === 'closed'}）</li>
 * </ul>
 *
 * <p><b>兜底口径（保守）</b>：{@code status} 不是字面 {@code 'open'} 的一律归「已结束」——
 * 包括 null / undefined / 大写 {@code 'OPEN'} / 万一泄漏的 {@code 'draft'} / 后端将来新增的未知值。
 * 理由：已结束 = 只可浏览、不可下单，是<b>最保守</b>的展示（与后端 {@code GzJpEventStatus.of()}
 * 回落 DRAFT 同一思路）。<b>宁可把能下单的场展示成已结束，也不能把不能下单的场展示成进行中</b>。
 * 同时<b>不静默丢弃</b>未知状态的场（丢了用户只看到空列表，排障时无迹可寻）。</p>
 *
 * <p><b>startTime 解析失败</b>（脏数据 / 后端改格式）→ 归 live 而非 upcoming：
 * status 是可下单与否的唯一权威，时间只用来把 open 这一桶再切两半；解析不出来时
 * 把可下单的场藏进「即将开始」会误导用户（看着还没开场、其实能下单）。</p>
 *
 * @param event 场 VO
 * @param nowMs 当前时刻毫秒（由调用方传入，便于测试与统一时基）
 */
export function classifyEvent(event: GzJpEventMpVO | null | undefined, nowMs: number): EventGroupKey {
  if (!event || event.status !== 'open') {
    return 'ended'
  }
  const startMs = parseBackendTime(event.startTime)
  if (Number.isFinite(startMs) && startMs > nowMs) {
    return 'upcoming'
  }
  return 'live'
}

/**
 * 把场列表分成三组（固定返回 3 个分组，含空组，顺序恒为 {@link EVENT_GROUP_ORDER}）。
 *
 * <p>组内<b>保持入参的相对顺序</b>（稳定分区）—— 后端已按
 * {@code sort_no ASC, end_time DESC, id DESC} 排好，前端不再二次排序，避免两处排序打架。</p>
 *
 * <p>返回定长 3 组（而非只返回非空组）是为了让页面模板形态固定、测试断言稳定；
 * 页面用 {@code v-if="group.events.length"} 跳过空组。</p>
 *
 * @param events 后端返回的场列表（null / undefined 当空数组）
 * @param nowMs  当前时刻毫秒
 */
export function groupEvents(
  events: GzJpEventMpVO[] | null | undefined,
  nowMs: number,
): HomeEventGroup[] {
  const buckets: Record<EventGroupKey, GzJpEventMpVO[]> = { live: [], upcoming: [], ended: [] }
  for (const e of events ?? []) {
    if (!e) {
      continue
    }
    buckets[classifyEvent(e, nowMs)].push(e)
  }
  return EVENT_GROUP_ORDER.map(key => ({ key, events: buckets[key] }))
}

/* ============================================================
 * 3. 时间文案
 * ============================================================ */

/** 卡片时间行的语义类型（文案由页面套 locale 组装，本层不出中文）。 */
export type EventTimingKind = 'deadline' | 'start' | 'endedAt' | 'none'

/** 卡片时间行：kind 决定用哪句文案，at 是 'MM/DD HH:mm'。 */
export interface EventTiming {
  kind: EventTimingKind
  at: string
}

/** 时间不可用时的统一空结果。 */
const NO_TIMING: EventTiming = { kind: 'none', at: '' }

/**
 * 算卡片上那行时间提示：进行中看截止、即将开始看开场、已结束看结束于。
 *
 * @param event 场 VO
 * @param group 该场所属分组（{@link classifyEvent} 的结果）
 * @returns {@code {kind, at}}；对应时间字段解析不出来 → {@code {kind:'none', at:''}}（页面隐藏该行）
 */
export function buildEventTiming(
  event: GzJpEventMpVO | null | undefined,
  group: EventGroupKey,
): EventTiming {
  if (!event) {
    return NO_TIMING
  }
  const source = group === 'upcoming' ? event.startTime : event.endTime
  const at = formatClock(parseBackendTime(source))
  if (!at) {
    return NO_TIMING
  }
  if (group === 'upcoming') {
    return { kind: 'start', at }
  }
  return { kind: group === 'live' ? 'deadline' : 'endedAt', at }
}

/* ============================================================
 * 4. 轮播 banner 降级
 * ============================================================ */

/**
 * 无运营配置时的默认 slide。
 *
 * <p>{@code imageUrl} 为空 → BizHomeBanner 渲染内置品牌占位块（渐变底 + 名称 + slogan），
 * 这就是任务卡说的「降级为单张默认图」；{@code link} 为空 → 不可点（点了不跳空路由）。
 * 一期没有运营素材，这是<b>常态路径</b>而不是异常路径。</p>
 */
export const DEFAULT_BANNER_SLIDE: HomeBannerItem = { imageUrl: '', link: '', enabled: true }

/**
 * 算最终要渲染的 banner slides —— <b>保证永不为空</b>（这是「banner 不塌陷」的唯一实现点）。
 *
 * <p>为什么不能返回空数组：swiper 没有 slide 会渲染成一条 300rpx 高的空白横条（页面塌一块），
 * 比什么都不放更难看。所以「无配置 / 全被过滤掉 / 拉取失败」三条路径统一降级到
 * {@link DEFAULT_BANNER_SLIDE}。</p>
 *
 * <p>虽然 {@code fetchHomeBanners()} 已经过滤过一遍 enabled / 空 imageUrl，这里仍然再过滤一次：
 * 本函数是「渲染前最后一道」，不能依赖上游一定干净（上游改实现 / 直接把 sys_config 原始值传进来
 * 都不该让首页塌）。</p>
 *
 * @param banners 已拉取的 banner 列表（null / undefined / [] 都接受）
 * @returns 至少 1 项的 slides 数组
 */
export function buildBannerSlides(banners: HomeBannerItem[] | null | undefined): HomeBannerItem[] {
  const usable = (banners ?? []).filter(
    b => !!b && b.enabled !== false && !!(b.imageUrl ?? '').trim(),
  )
  return usable.length ? usable : [DEFAULT_BANNER_SLIDE]
}

/* ============================================================
 * 5. 跳转路由 / 角标
 * ============================================================ */

/** 场详情页路由（GZ-JP-202 交付；本卡先按此约定拼参，202 上线即自然打通）。 */
export const EVENT_DETAIL_ROUTE = '/pages/event/index'

/** 订单列表页路由（GZ-JP-205 交付）。 */
export const ORDER_LIST_ROUTE = '/pages/order/index'

/**
 * 拼场详情页路由。
 *
 * <p><b>id 与 eventNo 都带</b>，各有各的用处，GZ-JP-202 别只取一个：</p>
 * <ul>
 *   <li>{@code id} —— 详情接口是 {@code GET /app/gz/jp/event/{id}}（后端只提供按主键查），必须带</li>
 *   <li>{@code eventNo} —— 业务码，用于页面展示 / 分享 / 客服对单（跨层契约「业务码替代 ID 暴露」）</li>
 * </ul>
 *
 * @param event 场 VO
 * @returns 形如 {@code /pages/event/index?id=1&eventNo=EVT-20260807-000001}
 */
export function buildEventRoute(event: Pick<GzJpEventMpVO, 'id' | 'eventNo'>): string {
  const query = [`id=${encodeURIComponent(event.id ?? '')}`]
  if (event.eventNo) {
    query.push(`eventNo=${encodeURIComponent(event.eventNo)}`)
  }
  return `${EVENT_DETAIL_ROUTE}?${query.join('&')}`
}

/**
 * 角标数字文案。0 / 负数 / 非数 → 空串（页面据此隐藏角标，而不是显示一个「0」）。
 *
 * @param count 待处理单数
 * @returns '' | '1'..'99' | '99+'
 */
export function formatBadgeCount(count: number | null | undefined): string {
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return ''
  }
  const n = Math.floor(count)
  if (n <= 0) {
    return ''
  }
  return n > 99 ? '99+' : String(n)
}
