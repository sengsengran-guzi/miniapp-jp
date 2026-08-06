/**
 * GZ-JP-202 —— 后端契约适配层单测（倒计时 + 金额）。
 *
 * <p>时间解析 / 封面兜底三件（parseBackendTime / formatClock / hasRealCover）已有
 * GZ-JP-201 的 41 条单测在 pages/index/index.logic.test.ts 覆盖（本卡只是把实现上提到这里，
 * 那 41 条原样跑绿即回归），所以本文件只补 202 新增的两组：倒计时 + 金额。</p>
 *
 * <p>全部纯函数，不碰 uni / 网络 / 组件 —— 不受微信开发者工具环境影响，任何机器都能跑。</p>
 */
import { describe, expect, it } from 'vitest'
import { countdownParts, formatHms, formatYuan, parseBackendTime } from './format'

/** 造一个「now」和「target」的毫秒对（用真实时间串，跟页面拿到的一样）。 */
function at(s: string): number {
  return parseBackendTime(s)
}

describe('countdownParts —— 剩余时间拆分（场详情页头倒计时）', () => {
  it('拆出天/时/分/秒（各位已借位，不是累计值）', () => {
    const now = at('2026-08-07 10:00:00')
    const end = at('2026-08-10 15:12:33')
    expect(countdownParts(end, now)).toEqual({ days: 3, hours: 5, minutes: 12, seconds: 33 })
  })

  it('不足一天时 days=0', () => {
    const now = at('2026-08-07 10:00:00')
    expect(countdownParts(at('2026-08-07 10:00:59'), now))
      .toEqual({ days: 0, hours: 0, minutes: 0, seconds: 59 })
  })

  it('刚好一分钟 → 00:01:00（借位正确，不是 0 分 60 秒）', () => {
    const now = at('2026-08-07 10:00:00')
    expect(countdownParts(at('2026-08-07 10:01:00'), now))
      .toEqual({ days: 0, hours: 0, minutes: 1, seconds: 0 })
  })

  it('★ 已到点（target === now）→ null，不是全 0', () => {
    const now = at('2026-08-07 10:00:00')
    expect(countdownParts(now, now)).toBeNull()
  })

  it('★ 已过点 → null（绝不返回负数倒计时，这是最常见的一类展示 bug）', () => {
    const now = at('2026-08-07 10:00:00')
    expect(countdownParts(at('2026-08-07 09:59:59'), now)).toBeNull()
    expect(countdownParts(at('2020-01-01 00:00:00'), now)).toBeNull()
  })

  it('时间不可用（NaN）→ null，不抛', () => {
    const now = at('2026-08-07 10:00:00')
    expect(countdownParts(Number.NaN, now)).toBeNull()
    expect(countdownParts(now, Number.NaN)).toBeNull()
    expect(countdownParts(at('乱七八糟'), now)).toBeNull()
  })

  it('跨月 / 跨年也对（不靠日历运算，纯毫秒差）', () => {
    expect(countdownParts(at('2027-01-01 00:00:00'), at('2026-12-31 23:00:00')))
      .toEqual({ days: 0, hours: 1, minutes: 0, seconds: 0 })
  })
})

describe('formatHms —— 倒计时的时:分:秒段', () => {
  it('两位补零', () => {
    expect(formatHms({ days: 3, hours: 5, minutes: 2, seconds: 7 })).toBe('05:02:07')
  })

  it('全 0 → 00:00:00（days 不进这个串，由页面单独拼「N 天」）', () => {
    expect(formatHms({ days: 0, hours: 0, minutes: 0, seconds: 0 })).toBe('00:00:00')
  })

  it('null / undefined → 空串（不渲染 "Invalid"）', () => {
    expect(formatHms(null)).toBe('')
    expect(formatHms(undefined)).toBe('')
  })
})

describe('formatYuan —— 分 → 元（★ 已包邮，此价即最终支付价）', () => {
  it('整元省小数', () => {
    expect(formatYuan(12800)).toBe('128')
    expect(formatYuan(100)).toBe('1')
  })

  it('有角分保留两位', () => {
    expect(formatYuan(12850)).toBe('128.50')
    expect(formatYuan(12805)).toBe('128.05')
    expect(formatYuan(1)).toBe('0.01')
  })

  it('0 分 → "0"（免费也是一个合法价，不能当无价）', () => {
    expect(formatYuan(0)).toBe('0')
  })

  it('★ null / undefined / NaN → 空串（调用方据此显示「价格待定」，而不是渲染 "NaN"）', () => {
    expect(formatYuan(null)).toBe('')
    expect(formatYuan(undefined)).toBe('')
    expect(formatYuan(Number.NaN)).toBe('')
    expect(formatYuan(Number.POSITIVE_INFINITY)).toBe('')
  })

  it('★ 后端万一发字符串也不塌（非 number 一律空串，绝不 "12800" 当 128 元算）', () => {
    // @ts-expect-error 故意传错类型，模拟后端契约漂移
    expect(formatYuan('12800')).toBe('')
  })

  it('大额不丢精度（分级金额远低于 JS 安全整数）', () => {
    expect(formatYuan(99_999_900)).toBe('999999')
  })
})
