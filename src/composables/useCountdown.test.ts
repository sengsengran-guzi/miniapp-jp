/**
 * GZ-ORD-102 useCountdown 倒计时纯计算单测（Tier 1A / AC7 ①）。
 *
 * 覆盖 computeRemaining：正常剩余拆分天时分秒 + 归零分支（diff <= 0 → expired）+ parseIsoMs。
 * 不测 setInterval / onUnmounted（依赖 Vue 生命周期，纯逻辑抽到 computeRemaining 已可断言）。
 */
import { describe, expect, it } from 'vitest'
import { computeRemaining, parseIsoMs } from './useCountdown'

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('computeRemaining — 剩余拆分', () => {
  it('正常剩余：2天3时4分5秒', () => {
    const now = 0
    const deadline = 2 * DAY + 3 * HOUR + 4 * MIN + 5 * SEC
    const r = computeRemaining(now, deadline)
    expect(r.expired).toBe(false)
    expect(r.days).toBe(2)
    expect(r.hours).toBe(3)
    expect(r.minutes).toBe(4)
    expect(r.seconds).toBe(5)
    expect(r.totalMs).toBe(deadline)
  })

  it('不足一天：0天23时59分59秒（天段为 0）', () => {
    const r = computeRemaining(0, 23 * HOUR + 59 * MIN + 59 * SEC)
    expect(r.expired).toBe(false)
    expect(r.days).toBe(0)
    expect(r.hours).toBe(23)
    expect(r.minutes).toBe(59)
    expect(r.seconds).toBe(59)
  })

  it('归零分支：deadline == now → expired 全 0', () => {
    const r = computeRemaining(1000, 1000)
    expect(r.expired).toBe(true)
    expect(r.days).toBe(0)
    expect(r.hours).toBe(0)
    expect(r.minutes).toBe(0)
    expect(r.seconds).toBe(0)
    expect(r.totalMs).toBe(0)
  })

  it('归零分支：deadline < now（已过期）→ expired', () => {
    const r = computeRemaining(5000, 1000)
    expect(r.expired).toBe(true)
    expect(r.totalMs).toBe(0)
  })

  it('serverNow 校准语义：校准当前时间 > 本地，剩余按校准算', () => {
    // 模拟「本地时钟比服务器慢 1 小时」→ 校准后当前时间 = 本地 + 1h offset
    const localNow = 0
    const offset = HOUR
    const deadline = 3 * HOUR
    const r = computeRemaining(localNow + offset, deadline)
    // 校准后当前 = 1h，剩 2h（而非按本地的 3h）
    expect(r.hours).toBe(2)
    expect(r.days).toBe(0)
  })
})

describe('parseIsoMs', () => {
  it('合法 ISO8601 → 毫秒', () => {
    const ms = parseIsoMs('2026-08-20T23:59:59')
    expect(Number.isNaN(ms)).toBe(false)
    expect(ms).toBe(new Date('2026-08-20T23:59:59').getTime())
  })

  it('空 / null / undefined → NaN', () => {
    expect(Number.isNaN(parseIsoMs(''))).toBe(true)
    expect(Number.isNaN(parseIsoMs(null))).toBe(true)
    expect(Number.isNaN(parseIsoMs(undefined))).toBe(true)
  })
})
