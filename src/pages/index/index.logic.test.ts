/**
 * GZ-JP-201 首页纯逻辑单测 —— 任务卡 accept #2。
 *
 * <p>锁两件事：</p>
 * <ol>
 *   <li><b>banner 无配置时降级默认图、不塌陷</b>（buildBannerSlides 永不返回空数组）</li>
 *   <li><b>三组分组正确</b>，含边界：{@code startTime === now}、status 异常值兜底、
 *       时间串解析失败、组内保序</li>
 * </ol>
 *
 * <p>全部纯函数，不碰 uni / 网络 / 组件 —— 不受微信开发者工具环境影响，任何机器都能跑。</p>
 */
import type { HomeBannerItem } from '@/api/gz-common'
import type { GzJpEventMpVO } from '@/api/gz-jp/event'
import { describe, expect, it } from 'vitest'
import { BACKEND_PLACEHOLDER_COVER } from '@/api/gz-jp/event'
import {
  buildBannerSlides,
  buildEventRoute,
  buildEventTiming,
  classifyEvent,
  DEFAULT_BANNER_SLIDE,
  EVENT_GROUP_ORDER,
  formatBadgeCount,
  formatClock,
  groupEvents,
  hasRealCover,
  parseBackendTime,
} from './index.logic'

/** 造一个场 VO（只覆盖测试关心的字段，其余给合法默认值）。 */
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

/** 用「本地时区」构造时间戳，与 parseBackendTime 的语义一致（测试与机器时区无关）。 */
function localMs(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return new Date(y, mo - 1, d, h, mi, s).getTime()
}

/* ============================================================
 * parseBackendTime —— 后端发 'yyyy-MM-dd HH:mm:ss'，不是 ISO
 * ============================================================ */

describe('parseBackendTime', () => {
  it('解析后端的空格分隔格式（iOS 上 new Date() 会返回 Invalid Date 的那种）', () => {
    expect(parseBackendTime('2026-08-07 10:00:00')).toBe(localMs(2026, 8, 7, 10, 0, 0))
  })

  it('同时兼容 ISO 的 T 分隔（后端将来改格式也不炸）', () => {
    expect(parseBackendTime('2026-08-07T10:00:00')).toBe(localMs(2026, 8, 7, 10, 0, 0))
  })

  it('秒可省略', () => {
    expect(parseBackendTime('2026-08-07 10:00')).toBe(localMs(2026, 8, 7, 10, 0, 0))
  })

  it('空 / null / undefined / 乱串 → NaN', () => {
    for (const bad of ['', '   ', null, undefined, 'not-a-time', '2026/08/07 10:00:00']) {
      expect(parseBackendTime(bad as string)).toBeNaN()
    }
  })

  it('字段越界 → NaN（不能让 new Date 静默滚月）', () => {
    expect(parseBackendTime('2026-13-01 10:00:00')).toBeNaN() // 13 月
    expect(parseBackendTime('2026-02-31 10:00:00')).toBeNaN() // 2 月 31 日（Date 会滚到 3 月）
    expect(parseBackendTime('2026-08-07 25:00:00')).toBeNaN() // 25 时
  })

  it('解析→格式化 往返恒等（与运行环境时区无关）', () => {
    expect(formatClock(parseBackendTime('2026-08-07 10:05:00'))).toBe('08/07 10:05')
    expect(formatClock(parseBackendTime('2026-09-30 22:00:00'))).toBe('09/30 22:00')
  })

  it('formatClock 对 NaN 返空串（调用方据此隐藏时间行）', () => {
    expect(formatClock(Number.NaN)).toBe('')
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe('')
  })
})

/* ============================================================
 * classifyEvent —— 三组判定 + 边界 + 兜底
 * ============================================================ */

describe('classifyEvent（三组判定）', () => {
  const NOW = localMs(2026, 8, 7, 12, 0, 0) // 2026-08-07 12:00 本地

  it('open + 已开场 → 进行中', () => {
    expect(classifyEvent(evt({ status: 'open', startTime: '2026-08-07 10:00:00' }), NOW)).toBe('live')
  })

  it('open + 未开场 → 即将开始', () => {
    expect(classifyEvent(evt({ status: 'open', startTime: '2026-08-07 18:00:00' }), NOW)).toBe('upcoming')
  })

  it('closed → 已结束（哪怕 startTime 还没到）', () => {
    expect(classifyEvent(evt({ status: 'closed', startTime: '2026-08-07 18:00:00' }), NOW)).toBe('ended')
  })

  // ★ 边界：契约写的是 startTime <= now 算进行中
  it('★边界 startTime === now → 进行中（不是即将开始）', () => {
    expect(classifyEvent(evt({ status: 'open', startTime: '2026-08-07 12:00:00' }), NOW)).toBe('live')
  })

  it('★边界 startTime 比 now 晚 1 秒 → 即将开始', () => {
    expect(classifyEvent(evt({ status: 'open', startTime: '2026-08-07 12:00:01' }), NOW)).toBe('upcoming')
  })

  it('★边界 startTime 比 now 早 1 秒 → 进行中', () => {
    expect(classifyEvent(evt({ status: 'open', startTime: '2026-08-07 11:59:59' }), NOW)).toBe('live')
  })

  // ★ status 异常值兜底：一律「已结束」（只可浏览 = 最保守），且不静默丢弃
  it('★兜底 status 异常值一律归已结束（draft 泄漏 / 大写 / 未知 / 空）', () => {
    const weird = ['draft', 'OPEN', 'Open', 'archived', '', null, undefined]
    for (const s of weird) {
      expect(classifyEvent(evt({ status: s as GzJpEventMpVO['status'] }), NOW)).toBe('ended')
    }
  })

  it('★兜底 event 本身为 null/undefined → 已结束（不抛异常）', () => {
    expect(classifyEvent(null, NOW)).toBe('ended')
    expect(classifyEvent(undefined, NOW)).toBe('ended')
  })

  // ★ startTime 解析不出来时：status 才是权威 → 归进行中，不藏进「即将开始」
  it('★兜底 open 但 startTime 解析失败 → 进行中（status 是可下单与否的唯一权威）', () => {
    for (const bad of ['', 'garbage', null as unknown as string]) {
      expect(classifyEvent(evt({ status: 'open', startTime: bad }), NOW)).toBe('live')
    }
  })
})

/* ============================================================
 * groupEvents —— 定长 3 组 / 顺序 / 稳定分区
 * ============================================================ */

describe('groupEvents（分组结果）', () => {
  const NOW = localMs(2026, 8, 7, 12, 0, 0)

  it('恒返回 3 组，顺序恒为 进行中 → 即将开始 → 已结束（进行中置顶）', () => {
    const groups = groupEvents([], NOW)
    expect(groups.map(g => g.key)).toEqual(['live', 'upcoming', 'ended'])
    expect(groups.map(g => g.key)).toEqual([...EVENT_GROUP_ORDER])
    expect(groups.every(g => g.events.length === 0)).toBe(true)
  })

  it('三类混排也各归各组，且进行中排在最前', () => {
    const live = evt({ id: '1', status: 'open', startTime: '2026-08-01 10:00:00' })
    const upcoming = evt({ id: '2', status: 'open', startTime: '2026-08-20 10:00:00' })
    const ended = evt({ id: '3', status: 'closed' })
    // 故意把已结束的放最前，验证分组不受入参顺序影响
    const groups = groupEvents([ended, upcoming, live], NOW)
    expect(groups[0]).toEqual({ key: 'live', events: [live] })
    expect(groups[1]).toEqual({ key: 'upcoming', events: [upcoming] })
    expect(groups[2]).toEqual({ key: 'ended', events: [ended] })
  })

  it('组内保持后端给的相对顺序（稳定分区，前端不二次排序）', () => {
    const a = evt({ id: '10', status: 'open', startTime: '2026-08-01 10:00:00' })
    const b = evt({ id: '11', status: 'open', startTime: '2026-08-02 10:00:00' })
    const c = evt({ id: '12', status: 'open', startTime: '2026-08-03 10:00:00' })
    const groups = groupEvents([c, a, b], NOW)
    expect(groups[0].events.map(e => e.id)).toEqual(['12', '10', '11'])
  })

  it('null / undefined 入参当空列表；数组里的空洞被跳过而不是抛错', () => {
    expect(groupEvents(null, NOW).every(g => g.events.length === 0)).toBe(true)
    expect(groupEvents(undefined, NOW).every(g => g.events.length === 0)).toBe(true)
    const groups = groupEvents([null as unknown as GzJpEventMpVO, evt({ status: 'closed' })], NOW)
    expect(groups[2].events).toHaveLength(1)
  })

  it('未知 status 的场不被丢弃（进已结束组，总数守恒）', () => {
    const list = [
      evt({ id: '1', status: 'open', startTime: '2026-08-01 10:00:00' }),
      evt({ id: '2', status: 'draft' as GzJpEventMpVO['status'] }),
      evt({ id: '3', status: 'closed' }),
    ]
    const groups = groupEvents(list, NOW)
    expect(groups.reduce((n, g) => n + g.events.length, 0)).toBe(3)
    expect(groups[2].events.map(e => e.id)).toEqual(['2', '3'])
  })
})

/* ============================================================
 * buildBannerSlides —— ★ accept #2 的正题：无配置不塌陷
 * ============================================================ */

describe('buildBannerSlides（banner 降级）', () => {
  const real: HomeBannerItem = { imageUrl: 'https://cdn/a.png', link: '/pages/me/index', enabled: true }

  it('★无配置（空数组）→ 降级为单张默认图，不返回空数组', () => {
    const slides = buildBannerSlides([])
    expect(slides).toHaveLength(1)
    expect(slides[0]).toEqual(DEFAULT_BANNER_SLIDE)
  })

  it('★拉取失败 / 字段缺失（null、undefined）→ 同样降级为单张默认图', () => {
    expect(buildBannerSlides(null)).toEqual([DEFAULT_BANNER_SLIDE])
    expect(buildBannerSlides(undefined)).toEqual([DEFAULT_BANNER_SLIDE])
  })

  it('★所有项都被过滤掉（禁用 / 空图 / 空洞）→ 仍然降级，不塌陷', () => {
    const junk = [
      { imageUrl: 'https://cdn/x.png', link: '', enabled: false },
      { imageUrl: '', link: '/x', enabled: true },
      { imageUrl: '   ', link: '/x', enabled: true },
      null as unknown as HomeBannerItem,
    ]
    expect(buildBannerSlides(junk)).toEqual([DEFAULT_BANNER_SLIDE])
  })

  it('★默认图不可点（link 为空）—— 免得点出一个空路由', () => {
    expect(DEFAULT_BANNER_SLIDE.link).toBe('')
    expect(DEFAULT_BANNER_SLIDE.imageUrl).toBe('')
    expect(DEFAULT_BANNER_SLIDE.enabled).toBe(true)
  })

  it('有可用配置时原样使用，不注入默认图', () => {
    expect(buildBannerSlides([real])).toEqual([real])
  })

  it('混合时只留可用项，顺序不变', () => {
    const b2: HomeBannerItem = { imageUrl: 'https://cdn/b.png', link: '', enabled: true }
    const slides = buildBannerSlides([
      { imageUrl: '', link: '/none', enabled: true },
      real,
      { imageUrl: 'https://cdn/off.png', link: '', enabled: false },
      b2,
    ])
    expect(slides).toEqual([real, b2])
  })

  it('★任何输入下结果都非空（不塌陷不变量）', () => {
    const inputs: (HomeBannerItem[] | null | undefined)[] = [
      null,
      undefined,
      [],
      [{ imageUrl: '', link: '', enabled: true }],
      [{ imageUrl: 'https://cdn/a.png', link: '', enabled: false }],
      [real],
    ]
    for (const input of inputs) {
      expect(buildBannerSlides(input).length).toBeGreaterThanOrEqual(1)
    }
  })
})

/* ============================================================
 * hasRealCover / buildEventTiming / 路由 / 角标
 * ============================================================ */

describe('hasRealCover（封面兜底）', () => {
  it('后端的占位路径当作「无封面」（该静态资源在 mp 侧根本不存在，渲染会 404）', () => {
    expect(hasRealCover(BACKEND_PLACEHOLDER_COVER)).toBe(false)
  })

  it('空 / null / 空白 → 无封面', () => {
    expect(hasRealCover('')).toBe(false)
    expect(hasRealCover(null)).toBe(false)
    expect(hasRealCover(undefined)).toBe(false)
    expect(hasRealCover('   ')).toBe(false)
  })

  it('真实预签名 URL → 有封面', () => {
    expect(hasRealCover('https://oss.example.com/a.png?sign=x')).toBe(true)
  })
})

describe('buildEventTiming（卡片时间行）', () => {
  it('进行中看截止时间', () => {
    expect(buildEventTiming(evt({ endTime: '2026-09-30 22:00:00' }), 'live'))
      .toEqual({ kind: 'deadline', at: '09/30 22:00' })
  })

  it('即将开始看开场时间', () => {
    expect(buildEventTiming(evt({ startTime: '2026-08-20 10:00:00' }), 'upcoming'))
      .toEqual({ kind: 'start', at: '08/20 10:00' })
  })

  it('已结束看结束时间', () => {
    expect(buildEventTiming(evt({ endTime: '2026-07-01 09:30:00' }), 'ended'))
      .toEqual({ kind: 'endedAt', at: '07/01 09:30' })
  })

  it('时间解析不出来 → kind=none（页面隐藏该行，不显示 "Invalid Date"）', () => {
    expect(buildEventTiming(evt({ endTime: 'garbage' }), 'live')).toEqual({ kind: 'none', at: '' })
    expect(buildEventTiming(evt({ startTime: '' }), 'upcoming')).toEqual({ kind: 'none', at: '' })
    expect(buildEventTiming(null, 'live')).toEqual({ kind: 'none', at: '' })
  })
})

describe('buildEventRoute（场卡片跳转）', () => {
  it('id 与 eventNo 都带上（详情接口按 id 查，eventNo 用于展示 / 分享）', () => {
    expect(buildEventRoute({ id: '1', eventNo: 'EVT-20260807-000001' }))
      .toBe('/pages/event/index?id=1&eventNo=EVT-20260807-000001')
  })

  it('eventNo 缺失时只带 id（仍可打开详情）', () => {
    expect(buildEventRoute({ id: '9', eventNo: '' })).toBe('/pages/event/index?id=9')
  })

  it('参数做 URL 编码（业务码将来带特殊字符也不破 query）', () => {
    expect(buildEventRoute({ id: '1', eventNo: 'A B&C' })).toBe('/pages/event/index?id=1&eventNo=A%20B%26C')
  })
})

describe('formatBadgeCount（订单入口角标）', () => {
  it('0 / 负数 / 非数 → 空串（隐藏角标，不显示一个 0）', () => {
    expect(formatBadgeCount(0)).toBe('')
    expect(formatBadgeCount(-3)).toBe('')
    expect(formatBadgeCount(null)).toBe('')
    expect(formatBadgeCount(undefined)).toBe('')
    expect(formatBadgeCount(Number.NaN)).toBe('')
  })

  it('正常数字原样显示，超过 99 收敛成 99+', () => {
    expect(formatBadgeCount(1)).toBe('1')
    expect(formatBadgeCount(99)).toBe('99')
    expect(formatBadgeCount(100)).toBe('99+')
    expect(formatBadgeCount(1234)).toBe('99+')
  })

  it('小数向下取整', () => {
    expect(formatBadgeCount(3.7)).toBe('3')
  })
})
