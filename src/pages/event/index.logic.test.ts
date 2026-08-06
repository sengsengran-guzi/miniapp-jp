/**
 * GZ-JP-202 场详情纯逻辑单测。
 *
 * <p>锁四件事：</p>
 * <ol>
 *   <li><b>★ 加购放行只看后端 eventBookable</b>（不看 status、不看时钟、缺字段一律拦）</li>
 *   <li><b>页头时间行</b>：进行中倒计时 / 即将开始看开场 / 已结束看结束时刻；
 *       <b>倒计时归零退化成「已于…结束」</b>，绝不出 00:00:00 或负数</li>
 *   <li><b>分页合并</b>：按 id 去重、保序、脏数据不塌</li>
 *   <li><b>路由</b>：id + productNo 都带且 URL 编码</li>
 * </ol>
 *
 * <p>全部纯函数，不碰 uni / 网络 / 组件 —— 任何机器都能跑，不受微信开发者工具环境影响。</p>
 */
import type { GzJpEventMpVO } from '@/api/gz-jp/event'
import type { GzJpProductMpVO } from '@/api/gz-jp/product'
import { describe, expect, it } from 'vitest'
import { parseBackendTime } from '@/api/gz-jp/format'
import {
  buildAddToCartState,
  buildHeaderTiming,
  buildProductRoute,
  eventPhase,
  hasMoreProducts,
  mergeProductPage,
  PRODUCT_DETAIL_ROUTE,
} from './index.logic'

/** 造一个场 VO（只覆盖测试关心的字段）。 */
function evt(over: Partial<GzJpEventMpVO> = {}): GzJpEventMpVO {
  return {
    id: '1',
    eventNo: 'EVT-20260807-000001',
    name: '8月上旬快闪场',
    coverImageUrl: null,
    description: null,
    status: 'open',
    startTime: '2026-08-07 10:00:00',
    endTime: '2026-09-30 22:00:00',
    ...over,
  }
}

/** 造一个商品 VO（只覆盖测试关心的字段）。 */
function prod(over: Partial<GzJpProductMpVO> = {}): GzJpProductMpVO {
  return {
    id: '1',
    productNo: 'JPP-20260807-000001',
    eventId: '1',
    eventNo: 'EVT-20260807-000001',
    eventName: '8月上旬快闪场',
    name: '柯南 吧唧 一番赏 A赏',
    mainImageUrl: null,
    galleryImageUrls: [],
    priceCent: 12800,
    deliveryDateText: '8月下旬',
    noticeText: null,
    status: 'on_shelf',
    eventBookable: true,
    ...over,
  }
}

const T = (s: string) => parseBackendTime(s)

/* ══════════════════════════════════════════════════════════
 * 1. ★ 加购放行（AC：场已结束时加购置灰）
 * ══════════════════════════════════════════════════════════ */

describe('buildAddToCartState —— ★ 加购放行唯一依据 = 后端 eventBookable', () => {
  it('eventBookable=true → 可点', () => {
    expect(buildAddToCartState(true)).toEqual({ disabled: false, reason: '' })
  })

  it('★ eventBookable=false → 置灰 + reason=ended（AC：场已结束时加购置灰）', () => {
    expect(buildAddToCartState(false)).toEqual({ disabled: true, reason: 'ended' })
  })

  it('★ 缺字段（undefined / null）→ 置灰（拦错方向的代价不对等：宁可拦一笔，不放一笔已结束的单）', () => {
    expect(buildAddToCartState(undefined).disabled).toBe(true)
    expect(buildAddToCartState(null).disabled).toBe(true)
  })

  it('★ 非布尔真值（后端契约漂移成字符串 "true"）也一律置灰，不做隐式转换', () => {
    // @ts-expect-error 故意传错类型，模拟后端把 boolean 发成字符串
    expect(buildAddToCartState('true').disabled).toBe(true)
    // @ts-expect-error 同上：数字 1 是 truthy，但不是 boolean true，不得放行
    expect(buildAddToCartState(1).disabled).toBe(true)
  })

  it('★ 已结束场里的在架商品：status=on_shelf 但 eventBookable=false → 仍置灰（两个字段不是一回事）', () => {
    const p = prod({ status: 'on_shelf', eventBookable: false })
    expect(buildAddToCartState(p.eventBookable).disabled).toBe(true)
  })
})

/* ══════════════════════════════════════════════════════════
 * 2. 展示态
 * ══════════════════════════════════════════════════════════ */

describe('eventPhase —— 页头展示态（与首页三组同口径）', () => {
  const now = T('2026-08-07 12:00:00')

  it('open 且已开场 → live', () => {
    expect(eventPhase(evt({ startTime: '2026-08-07 10:00:00' }), now)).toBe('live')
  })

  it('open 但没到开场 → upcoming', () => {
    expect(eventPhase(evt({ startTime: '2026-08-08 10:00:00' }), now)).toBe('upcoming')
  })

  it('★ startTime === now → live（边界含等号，开场那一秒就算开始了）', () => {
    expect(eventPhase(evt({ startTime: '2026-08-07 12:00:00' }), now)).toBe('live')
  })

  it('closed → ended', () => {
    expect(eventPhase(evt({ status: 'closed' }), now)).toBe('ended')
  })

  it('★ status 异常值一律 ended（最保守；含泄漏的 draft / 大小写不符 / 未知新值）', () => {
    for (const s of ['draft', 'OPEN', 'Open', 'archived', '', null, undefined]) {
      expect(eventPhase(evt({ status: s as never }), now)).toBe('ended')
    }
  })

  it('event 本身 null / undefined → ended，不抛', () => {
    expect(eventPhase(null, now)).toBe('ended')
    expect(eventPhase(undefined, now)).toBe('ended')
  })

  it('★ open 但 startTime 解析失败 → live（status 才是可下单与否的权威，不能藏进「即将开始」）', () => {
    expect(eventPhase(evt({ startTime: '坏数据' }), now)).toBe('live')
  })
})

/* ══════════════════════════════════════════════════════════
 * 3. 页头时间行
 * ══════════════════════════════════════════════════════════ */

describe('buildHeaderTiming —— 页头时间行（倒计时 / 开场 / 已结束）', () => {
  const now = T('2026-08-07 12:00:00')

  it('进行中 → 倒计时到闭场', () => {
    const r = buildHeaderTiming(evt({ endTime: '2026-08-10 17:12:33' }), 'live', now)
    expect(r.kind).toBe('countdown')
    expect(r.parts).toEqual({ days: 3, hours: 5, minutes: 12, seconds: 33 })
    expect(r.at).toBe('')
  })

  it('即将开始 → 开场时刻', () => {
    const r = buildHeaderTiming(evt({ startTime: '2026-08-20 10:00:00' }), 'upcoming', now)
    expect(r).toEqual({ kind: 'start', at: '08/20 10:00', parts: null })
  })

  it('已结束 → 结束时刻', () => {
    const r = buildHeaderTiming(evt({ status: 'closed', endTime: '2026-07-01 09:30:00' }), 'ended', now)
    expect(r).toEqual({ kind: 'endedAt', at: '07/01 09:30', parts: null })
  })

  it('★ 进行中但本地时钟已过闭场 → 退化成 endedAt，绝不显示 00:00:00 / 负数倒计时', () => {
    const r = buildHeaderTiming(evt({ endTime: '2026-08-07 11:00:00' }), 'live', now)
    expect(r.kind).toBe('endedAt')
    expect(r.parts).toBeNull()
    expect(r.at).toBe('08/07 11:00')
  })

  it('★ 倒计时恰好归零（endTime === now）→ endedAt，不是 countdown 全 0', () => {
    const r = buildHeaderTiming(evt({ endTime: '2026-08-07 12:00:00' }), 'live', now)
    expect(r.kind).toBe('endedAt')
  })

  it('时间串解析不出来 → kind=none（页面隐藏该行，不渲染 "Invalid Date"）', () => {
    expect(buildHeaderTiming(evt({ endTime: '坏数据' }), 'live', now).kind).toBe('none')
    expect(buildHeaderTiming(evt({ startTime: '' }), 'upcoming', now).kind).toBe('none')
  })

  it('event 为 null → kind=none，不抛', () => {
    expect(buildHeaderTiming(null, 'live', now)).toEqual({ kind: 'none', at: '', parts: null })
  })

  it('★ 倒计时随 now 推进而递减（每秒 tick 的正确性）', () => {
    const e = evt({ endTime: '2026-08-07 12:00:10' })
    const a = buildHeaderTiming(e, 'live', T('2026-08-07 12:00:00')).parts
    const b = buildHeaderTiming(e, 'live', T('2026-08-07 12:00:03')).parts
    expect(a?.seconds).toBe(10)
    expect(b?.seconds).toBe(7)
  })
})

/* ══════════════════════════════════════════════════════════
 * 4. 分页合并 / 还有没有下一页
 * ══════════════════════════════════════════════════════════ */

describe('mergeProductPage —— 上拉分页合并', () => {
  it('普通追加，保持先来后到顺序', () => {
    const r = mergeProductPage([prod({ id: '1' }), prod({ id: '2' })], [prod({ id: '3' })])
    expect(r.map(p => p.id)).toEqual(['1', '2', '3'])
  })

  it('★ 按 id 去重（翻页途中店员改排序会让同一条出现在两页）', () => {
    const r = mergeProductPage([prod({ id: '1' }), prod({ id: '2' })], [prod({ id: '2' }), prod({ id: '3' })])
    expect(r.map(p => p.id)).toEqual(['1', '2', '3'])
  })

  it('★ 重复时保留先到的那条（不覆盖 → 屏上已渲染的卡片不跳动）', () => {
    const r = mergeProductPage([prod({ id: '1', name: '先到' })], [prod({ id: '1', name: '后到' })])
    expect(r).toHaveLength(1)
    expect(r[0].name).toBe('先到')
  })

  it('首屏（existing 为空数组）也走同一条路径', () => {
    expect(mergeProductPage([], [prod({ id: '9' })]).map(p => p.id)).toEqual(['9'])
  })

  it('incoming 为 null / undefined / 空 → 原样返回已有内容', () => {
    const base = [prod({ id: '1' })]
    expect(mergeProductPage(base, null).map(p => p.id)).toEqual(['1'])
    expect(mergeProductPage(base, undefined).map(p => p.id)).toEqual(['1'])
    expect(mergeProductPage(base, []).map(p => p.id)).toEqual(['1'])
  })

  it('数组空洞 / null 元素被跳过，不抛', () => {
    const r = mergeProductPage([prod({ id: '1' })], [null as never, prod({ id: '2' })])
    expect(r.map(p => p.id)).toEqual(['1', '2'])
  })

  it('★ id 缺失的脏数据不参与去重（宁可重复显示，也不能把不同商品合并掉）', () => {
    const r = mergeProductPage(
      [prod({ id: '' as never, name: 'A' })],
      [prod({ id: '' as never, name: 'B' })],
    )
    expect(r.map(p => p.name)).toEqual(['A', 'B'])
  })

  it('不改原数组（纯函数）', () => {
    const base = [prod({ id: '1' })]
    mergeProductPage(base, [prod({ id: '2' })])
    expect(base).toHaveLength(1)
  })
})

describe('hasMoreProducts —— 还有没有下一页', () => {
  it('已加载 < 总数 → 还有', () => {
    expect(hasMoreProducts(20, 37)).toBe(true)
  })

  it('★ 已加载 == 总数 → 到底（总数是 pageSize 整数倍时不再多打一次空请求）', () => {
    expect(hasMoreProducts(20, 20)).toBe(false)
    expect(hasMoreProducts(40, 40)).toBe(false)
  })

  it('★ 某页因下架而不满，但总数还没到 → 仍判还有（不提前误判到底）', () => {
    expect(hasMoreProducts(18, 25)).toBe(true)
  })

  it('总数 0 / null / undefined / NaN → 没有下一页，不抛', () => {
    expect(hasMoreProducts(0, 0)).toBe(false)
    expect(hasMoreProducts(0, null)).toBe(false)
    expect(hasMoreProducts(0, undefined)).toBe(false)
    expect(hasMoreProducts(0, Number.NaN)).toBe(false)
  })

  it('已加载多于总数（后端下架导致 total 缩水）→ 到底，不出负页', () => {
    expect(hasMoreProducts(25, 20)).toBe(false)
  })
})

/* ══════════════════════════════════════════════════════════
 * 5. 路由
 * ══════════════════════════════════════════════════════════ */

describe('buildProductRoute —— 商品详情路由', () => {
  it('★ id 与 productNo 都带（id 调接口 / productNo 展示对单）', () => {
    expect(buildProductRoute(prod({ id: '7', productNo: 'JPP-20260807-000007' })))
      .toBe('/pages/product/detail?id=7&productNo=JPP-20260807-000007')
  })

  it('没有 productNo 时只带 id（不拼出 productNo= 空值）', () => {
    expect(buildProductRoute({ id: '7', productNo: '' })).toBe('/pages/product/detail?id=7')
  })

  it('特殊字符 URL 编码（不破坏 query 串）', () => {
    expect(buildProductRoute({ id: '7', productNo: 'A&B=C' }))
      .toBe('/pages/product/detail?id=7&productNo=A%26B%3DC')
  })

  it('★ 路由常量与 accept 断言要求的文件路径一致（改名会让 E2E 与文件名对不上）', () => {
    expect(PRODUCT_DETAIL_ROUTE).toBe('/pages/product/detail')
  })
})
