/**
 * GZ-JP-204 支付结果页纯逻辑单测。
 *
 * <p>锁两件事：</p>
 * <ol>
 *   <li><b>★ 最终态只看后端订单状态</b> —— {@code uni.requestPayment} 的 success 不作数
 *       （跨层契约 #6）。{@code resolvePhase} 的入参里根本<b>没有</b>「微信说成功了没」，
 *       从签名上就杜绝了「前端说付了就当付了」。</li>
 *   <li><b>轮询到顶 ≠ 支付失败</b> —— 到顶只说「还没确认到」，绝不告诉一个已经付过钱的客人
 *       「支付失败」（他会再付一次）。</li>
 * </ol>
 */
import { describe, expect, it } from 'vitest'
import {
  buildPayResultRoute,
  parsePayResultQuery,
  POLL_INTERVAL_MS,
  POLL_MAX_ATTEMPTS,
  resolvePhase,
  shouldKeepPolling,
} from './result.logic'

describe('resolvePhase', () => {
  it('★ paid → 钱已到', () => {
    expect(resolvePhase('paid', 0)).toBe('paid')
  })

  it('★ partial_refunded / refunded 也算「付过钱」（行级退款的前提是先付款）', () => {
    expect(resolvePhase('partial_refunded', 0)).toBe('paid')
    expect(resolvePhase('refunded', 0)).toBe('paid')
  })

  it('created + 还有轮询机会 → 继续等', () => {
    expect(resolvePhase('created', 0)).toBe('polling')
    expect(resolvePhase('created', POLL_MAX_ATTEMPTS - 1)).toBe('polling')
  })

  it('★ created + 次数到顶 → unpaid（「还没收到支付结果」，不是「支付失败」）', () => {
    expect(resolvePhase('created', POLL_MAX_ATTEMPTS)).toBe('unpaid')
    expect(resolvePhase('created', POLL_MAX_ATTEMPTS + 5)).toBe('unpaid')
  })

  it('cancelled → closed（超时关单 / 已取消，不给「重新支付」）', () => {
    expect(resolvePhase('cancelled', 0)).toBe('closed')
  })

  it('拉取失败（null / 空串）→ 当未知，继续轮询而不是判失败', () => {
    expect(resolvePhase(null, 0)).toBe('polling')
    expect(resolvePhase('', 1)).toBe('polling')
    expect(resolvePhase(undefined, 0)).toBe('polling')
  })

  it('未知状态串到顶后按 unpaid 处理（后端加了新状态也不会把页面卡在转圈）', () => {
    expect(resolvePhase('some_future_status', POLL_MAX_ATTEMPTS)).toBe('unpaid')
  })

  it('maxAttempts 可覆盖（测试与页面用同一套逻辑，不给测试开后门）', () => {
    expect(resolvePhase('created', 2, 3)).toBe('polling')
    expect(resolvePhase('created', 3, 3)).toBe('unpaid')
  })

  it('前后空白容错（后端 label 串偶尔带空格不该判成未知）', () => {
    expect(resolvePhase('  paid  ', 0)).toBe('paid')
  })
})

describe('shouldKeepPolling', () => {
  it('只有 polling 继续（其余三态都是终态，定时器必须停）', () => {
    expect(shouldKeepPolling('polling')).toBe(true)
    expect(shouldKeepPolling('paid')).toBe(false)
    expect(shouldKeepPolling('unpaid')).toBe(false)
    expect(shouldKeepPolling('closed')).toBe(false)
  })
})

describe('轮询节奏常量', () => {
  it('间隔 × 次数落在 10-30 秒（太短堆请求、太长客人以为卡住）', () => {
    const totalMs = POLL_INTERVAL_MS * POLL_MAX_ATTEMPTS
    expect(totalMs).toBeGreaterThanOrEqual(10_000)
    expect(totalMs).toBeLessThanOrEqual(30_000)
  })
})

describe('buildPayResultRoute / parsePayResultQuery', () => {
  it('往返一致（拼进去什么解出来什么）', () => {
    const url = buildPayResultRoute({
      orderId: '23',
      orderNo: 'JPO-20260807-000036',
      outTradeNo: 'JPO-20260807-000037',
      paid: true,
    })
    expect(url.startsWith('/pages/order/result?')).toBe(true)
    const q = Object.fromEntries(
      url.split('?')[1].split('&').map(kv => kv.split('=').map(decodeURIComponent) as [string, string]),
    )
    expect(parsePayResultQuery(q)).toEqual({
      orderId: '23',
      orderNo: 'JPO-20260807-000036',
      outTradeNo: 'JPO-20260807-000037',
      paid: true,
    })
  })

  it('★ orderNo 与 outTradeNo 是两个值，都要带（mock 回调 / 查支付用后者，展示用前者）', () => {
    const url = buildPayResultRoute({ orderId: '1', orderNo: 'A', outTradeNo: 'B', paid: false })
    expect(url).toContain('orderNo=A')
    expect(url).toContain('outTradeNo=B')
  })

  it('paid 用 1/0（query 里没有布尔类型）', () => {
    expect(buildPayResultRoute({ orderId: '1', paid: true })).toContain('paid=1')
    expect(buildPayResultRoute({ orderId: '1', paid: false })).toContain('paid=0')
    expect(parsePayResultQuery({ paid: '1' }).paid).toBe(true)
    expect(parsePayResultQuery({ paid: '0' }).paid).toBe(false)
    expect(parsePayResultQuery({}).paid).toBe(false)
  })

  it('缺参数不炸（返回空串，页面兜底）', () => {
    expect(parsePayResultQuery(null)).toEqual({ orderId: '', orderNo: '', outTradeNo: '', paid: false })
    expect(parsePayResultQuery({ orderId: '9' }).orderId).toBe('9')
  })
})
