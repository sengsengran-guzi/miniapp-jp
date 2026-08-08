import type { GzJpOrderItemVO } from '@/api/gz-jp/order'
/**
 * GZ-JP-205 accept #2 —— 「同一运单号在详情页只出现一次（分组的核心收益）」。
 *
 * <p>这一页存在的理由就是「30 款平铺时同一个运单号会重复十几次」。所以本文件的重心
 * 不是把每个导出函数点一遍，而是<b>把那条收益钉死</b>：无论行怎么排、状态怎么混、
 * 单号带不带空格，一个运单号在整页里只能出现一次。</p>
 *
 * <p>纯逻辑层不 import uni / vue，vitest 零环境依赖直接跑。</p>
 */
import { describe, expect, it } from 'vitest'
import {
  carrierNameOf,
  FULFILL_GROUP_ORDER,
  FULFILL_PURCHASE_FAILED,
  groupHeaderText,
  groupItemsByFulfillStatus,
  parseOrderDetailQuery,
  resolveRefundDisplay,
} from './detail.logic'

/** 造一行商品，只写关心的字段，其余给合法默认值。 */
function item(over: Partial<GzJpOrderItemVO> & { id: string }): GzJpOrderItemVO {
  return {
    productId: '900',
    productNo: 'JPP-20260807-000900',
    name: '测试商品',
    mainImageUrl: null,
    deliveryDateText: null,
    noticeText: null,
    eventName: '8月上旬快闪场',
    qty: 1,
    unitPriceCent: 12800,
    amountCent: 12800,
    source: 'batch',
    fulfillStatus: 'purchasing',
    fulfillStatusLabel: '购买中',
    carrierCode: null,
    trackingNo: null,
    shippedAt: null,
    refundStatus: null,
    refundStatusLabel: null,
    refundAmountCent: null,
    ...over,
  }
}

/** 已发货行（带单号）。 */
function shipped(id: string, trackingNo: string, carrierCode = 'sf'): GzJpOrderItemVO {
  return item({
    id,
    fulfillStatus: 'delivered',
    fulfillStatusLabel: '发货完毕',
    carrierCode,
    trackingNo,
    shippedAt: '2026-08-07 10:05:23',
  })
}

/* ════════════════════════════════════════════════════════════
 * ★★ accept #2 的本体：同一运单号只出现一次
 * ════════════════════════════════════════════════════════════ */

describe('★ 同一运单号在详情页只出现一次', () => {
  it('12 款共用一个单号 → 只有 1 个组、单号只出现 1 次', () => {
    const items = Array.from({ length: 12 }, (_, i) => shipped(String(i + 1), 'SF7654321000'))
    const groups = groupItemsByFulfillStatus(items)

    expect(groups).toHaveLength(1)
    expect(groups[0].trackingNo).toBe('SF7654321000')
    expect(groups[0].itemCount).toBe(12)
    // 12 行全在这一个组里，一行没丢
    expect(groups[0].items.map(i => i.id)).toEqual(items.map(i => i.id))

    // ★ 整页扫一遍：该单号在所有组头里只出现 1 次
    const occurrences = groups.filter(g => g.trackingNo === 'SF7654321000').length
    expect(occurrences).toBe(1)
  })

  it('★ 30 款的真实订单：单号总数 == 去重后的单号数（没有任何一个重复出现）', () => {
    // 12 款走 SF 一个包裹、8 款走 JD 另一个、5 款清关中、3 款购买中、2 款购买失败
    const items: GzJpOrderItemVO[] = [
      ...Array.from({ length: 12 }, (_, i) => shipped(`s${i}`, 'SF7654321000', 'sf')),
      ...Array.from({ length: 8 }, (_, i) => shipped(`j${i}`, 'JD9999900001', 'jd')),
      ...Array.from({ length: 5 }, (_, i) =>
        item({ id: `c${i}`, fulfillStatus: 'customs', fulfillStatusLabel: '清关中' })),
      ...Array.from({ length: 3 }, (_, i) => item({ id: `p${i}` })),
      ...Array.from({ length: 2 }, (_, i) =>
        item({
          id: `f${i}`,
          fulfillStatus: FULFILL_PURCHASE_FAILED,
          fulfillStatusLabel: '购买失败',
          refundStatus: 'refunded',
          refundStatusLabel: '已退款',
          refundAmountCent: 12800,
        })),
    ]
    expect(items).toHaveLength(30)

    const groups = groupItemsByFulfillStatus(items)

    const trackings = groups.map(g => g.trackingNo).filter((t): t is string => !!t)
    // ★ 核心断言：出现过的单号，去重前后数量相同 = 没有任何一个重复
    expect(trackings.length).toBe(new Set(trackings).size)
    expect(new Set(trackings)).toEqual(new Set(['SF7654321000', 'JD9999900001']))

    // 30 款一行不丢
    expect(groups.reduce((n, g) => n + g.itemCount, 0)).toBe(30)
  })

  it('同状态但两个不同单号 → 分成两个子组，各自带各自的单号', () => {
    const groups = groupItemsByFulfillStatus([
      shipped('1', 'SF001'),
      shipped('2', 'JD002', 'jd'),
      shipped('3', 'SF001'),
    ])

    expect(groups).toHaveLength(2)
    expect(groups.map(g => g.trackingNo)).toEqual(['SF001', 'JD002'])
    expect(groups[0].itemCount).toBe(2) // SF001 的两行合并
    expect(groups[1].itemCount).toBe(1)
  })

  it('单号两侧带空格 → 视作同一个单号合并（不因空格裂成两组）', () => {
    const groups = groupItemsByFulfillStatus([
      shipped('1', 'SF001'),
      shipped('2', '  SF001  '),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].trackingNo).toBe('SF001')
    expect(groups[0].itemCount).toBe(2)
  })

  it('行顺序打散（同单号的行不相邻）时仍合并成一组', () => {
    const groups = groupItemsByFulfillStatus([
      shipped('1', 'SF001'),
      item({ id: '2', fulfillStatus: 'customs', fulfillStatusLabel: '清关中' }),
      shipped('3', 'SF001'),
      item({ id: '4' }),
      shipped('5', 'SF001'),
    ])
    const delivered = groups.filter(g => g.status === 'delivered')
    expect(delivered).toHaveLength(1)
    expect(delivered[0].itemCount).toBe(3)
  })
})

/* ════════════════════════════════════════════════════════════
 * 分组顺序与 AC「不超过 7 个组」
 * ════════════════════════════════════════════════════════════ */

describe('分组顺序', () => {
  it('组序 = 发货完毕 → 国内分拣 → 清关 → 日本已发 → 等待官方发货 → 购买中 → 购买失败', () => {
    // 刻意用「最不利」的输入顺序：完全倒过来喂
    const reversed = [...FULFILL_GROUP_ORDER].reverse()
    const groups = groupItemsByFulfillStatus(
      reversed.map((status, i) => item({ id: String(i), fulfillStatus: status, fulfillStatusLabel: status })),
    )
    expect(groups.map(g => g.status)).toEqual([...FULFILL_GROUP_ORDER])
  })

  it('★ 购买失败组永远排最后（坏消息不打断上面的进度阅读）', () => {
    const groups = groupItemsByFulfillStatus([
      item({ id: '1', fulfillStatus: FULFILL_PURCHASE_FAILED, fulfillStatusLabel: '购买失败' }),
      item({ id: '2', fulfillStatus: 'purchasing', fulfillStatusLabel: '购买中' }),
      shipped('3', 'SF001'),
    ])
    expect(groups[groups.length - 1].status).toBe(FULFILL_PURCHASE_FAILED)
    expect(groups[groups.length - 1].isFailed).toBe(true)
    // 非失败组的 isFailed 必须是 false（页面据此选退款文案）
    expect(groups.slice(0, -1).every(g => !g.isFailed)).toBe(true)
  })

  it('★ AC：30 款订单分组后不超过 7 个组（状态链只有 7 种）', () => {
    // 每种状态各若干款，且都不带单号 → 组数上限就是状态种类数
    const items = FULFILL_GROUP_ORDER.flatMap((status, si) =>
      Array.from({ length: 5 }, (_, i) =>
        item({ id: `${si}-${i}`, fulfillStatus: status, fulfillStatusLabel: status })),
    )
    expect(items.length).toBeGreaterThanOrEqual(30)
    expect(groupItemsByFulfillStatus(items).length).toBeLessThanOrEqual(7)
  })

  it('组内保持后端给的行顺序（前端不二次排序）', () => {
    const groups = groupItemsByFulfillStatus([
      item({ id: 'c', fulfillStatus: 'customs', fulfillStatusLabel: '清关中' }),
      item({ id: 'a', fulfillStatus: 'customs', fulfillStatusLabel: '清关中' }),
      item({ id: 'b', fulfillStatus: 'customs', fulfillStatusLabel: '清关中' }),
    ])
    expect(groups[0].items.map(i => i.id)).toEqual(['c', 'a', 'b'])
  })

  it('同状态多单号时，子组按首次出现顺序排（不按单号字典序抖动）', () => {
    const groups = groupItemsByFulfillStatus([
      shipped('1', 'ZZZ999'),
      shipped('2', 'AAA111'),
    ])
    expect(groups.map(g => g.trackingNo)).toEqual(['ZZZ999', 'AAA111'])
  })
})

/* ════════════════════════════════════════════════════════════
 * 退款展示（GZ-JP-107 口径）
 * ════════════════════════════════════════════════════════════ */

describe('退款展示', () => {
  it('★ 只有 refunded 才给客人看具体金额', () => {
    const d = resolveRefundDisplay('refunded', 12800)
    expect(d.kind).toBe('refunded')
    expect(d.amountCent).toBe(12800)
    expect(d.needsSupport).toBe(false)
  })

  it('★ refunding 期间不显示金额（钱还在路上，数字可能变）', () => {
    const d = resolveRefundDisplay('refunding', 12800)
    expect(d.kind).toBe('processing')
    expect(d.amountCent).toBeNull()
  })

  it('★ refund_failed 对客人也说「处理中」，不暴露「失败」，但给客服出口', () => {
    const d = resolveRefundDisplay('refund_failed', 12800)
    expect(d.kind).toBe('processing')
    expect(d.amountCent).toBeNull() // 不能顺手把金额漏出去
    expect(d.needsSupport).toBe(true)
  })

  it('没有退款（null / 空串）→ 不显示任何退款信息', () => {
    expect(resolveRefundDisplay(null, null).kind).toBe('none')
    expect(resolveRefundDisplay(undefined, undefined).kind).toBe('none')
    expect(resolveRefundDisplay('   ', 100).kind).toBe('none')
  })

  it('未知退款状态 → 保守当处理中，绝不假装已退款', () => {
    const d = resolveRefundDisplay('some_new_status', 12800)
    expect(d.kind).toBe('processing')
    expect(d.amountCent).toBeNull()
  })

  it('refunded 但金额是脏值 → 金额给 null，不渲染 NaN', () => {
    expect(resolveRefundDisplay('refunded', null).amountCent).toBeNull()
    expect(resolveRefundDisplay('refunded', undefined).amountCent).toBeNull()
    expect(resolveRefundDisplay('refunded', Number.NaN).amountCent).toBeNull()
  })
})

/* ════════════════════════════════════════════════════════════
 * 快递名 / 组头 / 路由 / 边界
 * ════════════════════════════════════════════════════════════ */

describe('快递中文名', () => {
  it('已知编码 → 中文名', () => {
    expect(carrierNameOf('sf')).toBe('顺丰速运')
    expect(carrierNameOf('jd')).toBe('京东快递')
    expect(carrierNameOf('ems')).toBe('EMS')
  })

  it('大小写与空格容错', () => {
    expect(carrierNameOf(' SF ')).toBe('顺丰速运')
  })

  it('★ 未知 / 空编码 → 空串（不回落成原始编码，「zzz SF123」比「SF123」更让人困惑）', () => {
    expect(carrierNameOf('zzz')).toBe('')
    expect(carrierNameOf(null)).toBe('')
    expect(carrierNameOf('')).toBe('')
  })

  it('组内先出现的行没带编码、后面的带了 → 组头仍能显示快递名', () => {
    const groups = groupItemsByFulfillStatus([
      item({ id: '1', fulfillStatus: 'delivered', fulfillStatusLabel: '发货完毕', trackingNo: 'SF001', carrierCode: null }),
      shipped('2', 'SF001', 'sf'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].carrierName).toBe('顺丰速运')
  })
})

describe('组头文案', () => {
  it('「<状态> N 款」，中文取后端 label', () => {
    const [g] = groupItemsByFulfillStatus([shipped('1', 'SF001'), shipped('2', 'SF001')])
    expect(groupHeaderText(g, '款')).toBe('发货完毕 2款')
  })

  it('后端漏给 label 时退回状态原值（能一眼看出是后端漏了字段，不是空白）', () => {
    const [g] = groupItemsByFulfillStatus([
      item({ id: '1', fulfillStatus: 'customs', fulfillStatusLabel: '' }),
    ])
    expect(g.statusLabel).toBe('customs')
  })
})

describe('边界与路由', () => {
  it('空订单 / null / undefined → 空数组，不抛', () => {
    expect(groupItemsByFulfillStatus([])).toEqual([])
    expect(groupItemsByFulfillStatus(null)).toEqual([])
    expect(groupItemsByFulfillStatus(undefined)).toEqual([])
  })

  it('delivered 但没单号（数据异常）→ 仍成组、trackingNo 为 null，页面不渲染单号行', () => {
    const groups = groupItemsByFulfillStatus([
      item({ id: '1', fulfillStatus: 'delivered', fulfillStatusLabel: '发货完毕', trackingNo: null }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].trackingNo).toBeNull()
  })

  it('脏状态值不被丢弃（总数守恒），排在已知状态之后、失败组之前', () => {
    const groups = groupItemsByFulfillStatus([
      item({ id: '1', fulfillStatus: 'weird_status', fulfillStatusLabel: '未知' }),
      item({ id: '2', fulfillStatus: FULFILL_PURCHASE_FAILED, fulfillStatusLabel: '购买失败' }),
      shipped('3', 'SF001'),
    ])
    expect(groups.reduce((n, g) => n + g.itemCount, 0)).toBe(3)
    expect(groups[0].status).toBe('delivered')
    expect(groups[groups.length - 1].status).toBe(FULFILL_PURCHASE_FAILED)
  })

  it('parseOrderDetailQuery 收 id（不是 orderNo —— 后端按主键查）', () => {
    expect(parseOrderDetailQuery({ id: '24' })).toEqual({ orderId: '24' })
    expect(parseOrderDetailQuery({ id: ' 24 ' })).toEqual({ orderId: '24' })
    expect(parseOrderDetailQuery({})).toEqual({ orderId: '' })
    expect(parseOrderDetailQuery(null)).toEqual({ orderId: '' })
  })
})
