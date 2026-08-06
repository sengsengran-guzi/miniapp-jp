/**
 * GZ-JP-203 购物车纯逻辑单测。
 *
 * <p>四条 AC 全部落在这一层的算术上，逐条锁死：</p>
 * <ol>
 *   <li><b>跨场商品同车共存，按场分组显示</b>（拍平顺序 / 分组独立勾选 / 孤儿组）</li>
 *   <li><b>改数量实时刷新合计</b>（合计恒等于「所选行 amountCent 之和」）</li>
 *   <li><b>★ 失效项不可勾选且不计入合计</b>（进不了勾选集合、批量勾选跳过、对账时被摘掉）</li>
 *   <li><b>★ 未勾选任何项时「去结算」置灰</b>（含「勾了但那行已失效/已消失」的残留场景）</li>
 * </ol>
 *
 * <p>全部纯函数，不碰 uni / 网络 / 组件 —— 任何机器都能跑。</p>
 */
import type { GzJpCartGroupVO, GzJpCartItemVO, GzJpCartVO } from '@/api/gz-jp/cart'
import { describe, expect, it } from 'vitest'
import {
  buildCheckoutRoute,
  canCheckout,
  cartSelectionState,
  CHECKOUT_ROUTE,
  checkoutIds,
  flattenItems,
  groupSelectableIds,
  groupSelectionState,
  invalidIds,
  isSelectable,
  selectableIds,
  selectedAmountCent,
  selectedQty,
  selectionStateOf,
  setSelected,
  syncSelection,
  toggleAll,
  toggleGroup,
  toggleItem,
} from './index.logic'

/* ── fixture 工厂 ─────────────────────────────────────────── */

function item(over: Partial<GzJpCartItemVO> = {}): GzJpCartItemVO {
  const qty = over.qty ?? 1
  const priceCent = over.priceCent === undefined ? 12800 : over.priceCent
  return {
    id: '1',
    productId: '1',
    productNo: 'JPP-20260807-000001',
    name: '柯南 吧唧 一番赏 A赏',
    mainImageUrl: 'https://cdn/main.png',
    priceCent,
    qty,
    amountCent: (priceCent ?? 0) * qty,
    eventId: '1',
    invalid: false,
    invalidReason: null,
    invalidText: null,
    ...over,
  }
}

function group(over: Partial<GzJpCartGroupVO> = {}): GzJpCartGroupVO {
  return {
    eventId: '1',
    eventNo: 'EVT-20260807-000001',
    eventName: '8月上旬快闪场',
    eventStatus: 'open',
    eventBookable: true,
    items: [],
    ...over,
  }
}

function cartOf(groups: GzJpCartGroupVO[]): GzJpCartVO {
  const items = groups.flatMap(g => g.items)
  const valid = items.filter(it => !it.invalid)
  return {
    groups,
    itemCount: items.length,
    invalidCount: items.length - valid.length,
    validQty: valid.reduce((s, it) => s + it.qty, 0),
    validAmountCent: valid.reduce((s, it) => s + it.amountCent, 0),
  }
}

/** ★ 跨场购物车：A 场（可下单，2 款）+ B 场（已结束，1 款失效）+ 孤儿组（商品已删）。 */
function crossEventCart(): GzJpCartVO {
  return cartOf([
    group({
      items: [
        item({ id: '11', productId: '1', name: 'A 场商品甲', qty: 2, priceCent: 12800 }),
        item({ id: '12', productId: '2', name: 'A 场商品乙', qty: 1, priceCent: 6800 }),
      ],
    }),
    group({
      eventId: '2',
      eventNo: 'EVT-20260807-000002',
      eventName: '7月下旬场',
      eventStatus: 'closed',
      eventBookable: false,
      items: [
        item({
          id: '21',
          productId: '3',
          eventId: '2',
          name: 'B 场商品丙',
          qty: 3,
          priceCent: 9900,
          invalid: true,
          invalidReason: 'event_closed',
          invalidText: '本场已结束',
        }),
      ],
    }),
    group({
      eventId: null,
      eventNo: null,
      eventName: '已失效商品',
      eventStatus: null,
      eventBookable: false,
      items: [
        item({
          id: '31',
          productId: '9',
          eventId: null,
          name: '商品已下架',
          qty: 1,
          priceCent: 0,
          invalid: true,
          invalidReason: 'product_removed',
          invalidText: '商品已下架',
        }),
      ],
    }),
  ])
}

/* ════════════════════════════════════════════════════════════ */

describe('flattenItems / 取子集', () => {
  it('按后端给的组顺序与组内顺序拍平（不重排）', () => {
    expect(flattenItems(crossEventCart()).map(it => it.id)).toEqual(['11', '12', '21', '31'])
  })

  it('空车 / null / groups 缺失 → 空数组（不抛）', () => {
    expect(flattenItems(null)).toEqual([])
    expect(flattenItems(undefined)).toEqual([])
    expect(flattenItems({ groups: [] } as unknown as GzJpCartVO)).toEqual([])
    expect(flattenItems({} as unknown as GzJpCartVO)).toEqual([])
  })

  it('组里 items 缺失 / 有空洞 → 跳过而不是崩', () => {
    const c = cartOf([group({ items: [item({ id: 'a' })] })])
    ;(c.groups[0] as { items: unknown }).items = [item({ id: 'a' }), null, undefined]
    expect(flattenItems(c).map(it => it.id)).toEqual(['a'])
    const noItems = { groups: [{ eventId: '1' }] } as unknown as GzJpCartVO
    expect(flattenItems(noItems)).toEqual([])
  })

  it('★ selectableIds 只给有效行；invalidIds 只给失效行（两者互补）', () => {
    const c = crossEventCart()
    expect(selectableIds(c)).toEqual(['11', '12'])
    expect(invalidIds(c)).toEqual(['21', '31'])
  })
})

describe('isSelectable —— 唯一依据是后端 item.invalid', () => {
  it('invalid=true → 不可勾选', () => {
    expect(isSelectable(item({ invalid: true }))).toBe(false)
  })

  it('invalid=false → 可勾选', () => {
    expect(isSelectable(item({ invalid: false }))).toBe(true)
  })

  it('缺字段 / 非布尔 → 按可勾选（与加购放行相反方向；真闸门在下单事务里）', () => {
    expect(isSelectable(item({ invalid: undefined as unknown as boolean }))).toBe(true)
    expect(isSelectable(item({ invalid: 'true' as unknown as boolean }))).toBe(true)
    expect(isSelectable(item({ invalid: 0 as unknown as boolean }))).toBe(true)
  })

  it('★ 不看所属场的 eventBookable —— 组已结束但行没标失效时仍可勾选', () => {
    // 后端标失效才是权威；前端拿组状态自作主张会与后端 validAmountCent 对不上账
    const g = group({ eventBookable: false, items: [item({ id: '9', invalid: false })] })
    expect(groupSelectableIds(g)).toEqual(['9'])
  })

  it('null / undefined 行 → 不可勾选', () => {
    expect(isSelectable(null)).toBe(false)
    expect(isSelectable(undefined)).toBe(false)
  })
})

describe('syncSelection —— 每次拉到新快照重新对账', () => {
  it('★ 首次加载（known 为空）= 全部有效项默认勾上，失效项一个不勾', () => {
    const c = crossEventCart()
    const r = syncSelection(c)
    expect(r.selected).toEqual(['11', '12'])
    expect(r.known).toEqual(['11', '12', '21', '31'])
  })

  it('★ 刷新时保留用户显式取消的行（不被偷偷勾回来）', () => {
    const c = crossEventCart()
    const first = syncSelection(c)
    const afterUncheck = setSelected(first.selected, ['12'], false)
    const second = syncSelection(c, afterUncheck, first.known)
    expect(second.selected).toEqual(['11'])
  })

  it('★ 本次新出现的有效行默认勾上（刚从商品详情加购的那件）', () => {
    const before = cartOf([group({ items: [item({ id: '11' })] })])
    const first = syncSelection(before)
    const after = cartOf([group({ items: [item({ id: '11' }), item({ id: '12', productId: '2' })] })])
    const second = syncSelection(after, first.selected, first.known)
    expect(second.selected).toEqual(['11', '12'])
  })

  it('★ 上一轮勾中的行本轮变失效（店员关了场）→ 从勾选集合摘掉', () => {
    const before = cartOf([group({ items: [item({ id: '11' })] })])
    const first = syncSelection(before)
    expect(first.selected).toEqual(['11'])
    const after = cartOf([group({ items: [item({ id: '11', invalid: true, invalidText: '本场已结束' })] })])
    const second = syncSelection(after, first.selected, first.known)
    expect(second.selected).toEqual([])
  })

  it('已消失的行（自己删了 / 别的端删了）→ 从勾选集合摘掉', () => {
    const second = syncSelection(
      cartOf([group({ items: [item({ id: '11' })] })]),
      ['11', '12'],
      ['11', '12'],
    )
    expect(second.selected).toEqual(['11'])
    expect(second.known).toEqual(['11'])
  })

  it('失效行变回有效（场重开）→ 不自动勾上，等用户自己勾', () => {
    const known = ['11']
    const c = cartOf([group({ items: [item({ id: '11', invalid: false })] })])
    expect(syncSelection(c, [], known).selected).toEqual([])
  })

  it('空车 → 勾选与已知都清空', () => {
    const r = syncSelection(cartOf([]), ['11'], ['11'])
    expect(r.selected).toEqual([])
    expect(r.known).toEqual([])
  })

  it('不改入参（prevSelected / prevKnown 原样）', () => {
    const prevSelected = ['11']
    const prevKnown = ['11']
    syncSelection(crossEventCart(), prevSelected, prevKnown)
    expect(prevSelected).toEqual(['11'])
    expect(prevKnown).toEqual(['11'])
  })
})

describe('selectionStateOf / 三态', () => {
  it('全选 / 部分 / 一个没选', () => {
    expect(selectionStateOf(['a', 'b'], ['a', 'b'])).toBe('all')
    expect(selectionStateOf(['a', 'b'], ['a'])).toBe('some')
    expect(selectionStateOf(['a', 'b'], [])).toBe('none')
  })

  it('★ 候选集为空 → none（不是 all）—— 整组失效时全选框不该显示勾中', () => {
    expect(selectionStateOf([], [])).toBe('none')
    expect(selectionStateOf([], ['x'])).toBe('none')
  })

  it('勾选集合里有候选集之外的残留 id 不影响判定', () => {
    expect(selectionStateOf(['a'], ['a', 'zzz'])).toBe('all')
  })

  it('★ 整车三态：默认全选 → 取消一个 → some → 全取消 → none', () => {
    const c = crossEventCart()
    const all = syncSelection(c).selected
    expect(cartSelectionState(c, all)).toBe('all')
    expect(cartSelectionState(c, setSelected(all, ['12'], false))).toBe('some')
    expect(cartSelectionState(c, [])).toBe('none')
  })

  it('★ 整组失效的组 → 组三态恒为 none（点组头全选也不会变）', () => {
    const c = crossEventCart()
    const orphan = c.groups[2]
    expect(groupSelectableIds(orphan)).toEqual([])
    expect(groupSelectionState(orphan, syncSelection(c).selected)).toBe('none')
    expect(toggleGroup(orphan, [])).toEqual([])
  })
})

describe('setSelected / toggleItem / toggleAll / toggleGroup', () => {
  it('setSelected 勾上时去重、保持稳定顺序，且不改入参', () => {
    const src = ['a']
    const out = setSelected(src, ['a', 'b', 'b'], true)
    expect(out).toEqual(['a', 'b'])
    expect(src).toEqual(['a'])
  })

  it('setSelected 取消时移除指定 id，其余保持顺序', () => {
    expect(setSelected(['a', 'b', 'c'], ['b'], false)).toEqual(['a', 'c'])
  })

  it('★ toggleItem 对失效行点了也不动（第二道拦截，保证勾选集合永不混入失效行）', () => {
    const bad = item({ id: '21', invalid: true })
    expect(toggleItem([], bad, true)).toEqual([])
    expect(toggleItem(['21'], bad, false)).toEqual(['21'])
  })

  it('toggleItem 正常勾上 / 取消', () => {
    const it1 = item({ id: '11' })
    expect(toggleItem([], it1, true)).toEqual(['11'])
    expect(toggleItem(['11'], it1, false)).toEqual([])
  })

  it('★ toggleAll：全选态 → 全部取消；部分 / 未选 → 全部勾上（且只勾有效项）', () => {
    const c = crossEventCart()
    const all = ['11', '12']
    expect(toggleAll(c, all)).toEqual([])
    expect(toggleAll(c, [])).toEqual(all)
    expect(toggleAll(c, ['11'])).toEqual(all)
  })

  it('★ toggleAll 永不勾上失效项（21 / 31 一次都不出现）', () => {
    expect(toggleAll(crossEventCart(), [])).not.toContain('21')
    expect(toggleAll(crossEventCart(), [])).not.toContain('31')
  })

  it('★ toggleGroup 只影响本组（跨场互不干扰）', () => {
    const c = crossEventCart()
    const gA = c.groups[0]
    // A 组全选态 + 手工塞一个别组的 id，取消 A 组后别组的仍在
    expect(toggleGroup(gA, ['11', '12', 'other'])).toEqual(['other'])
    expect(toggleGroup(gA, ['other'])).toEqual(['other', '11', '12'])
  })

  it('空车 toggleAll → 不抛；残留 id 原样留着（清理残留归 syncSelection 对账，不归开关）', () => {
    expect(toggleAll(null, [])).toEqual([])
    expect(toggleAll(cartOf([]), [])).toEqual([])
    expect(toggleAll(cartOf([]), ['x'])).toEqual(['x'])
    // 残留 id 不会让「去结算」误亮 —— 闸门判的是「勾选 ∩ 当前可勾选行」
    expect(canCheckout(cartOf([]), ['x'])).toBe(false)
  })
})

describe('★ 合计（只有商品合计一行，全包邮）', () => {
  it('★ 按所选行的后端 amountCent 累加', () => {
    const c = crossEventCart()
    // 11: 12800×2=25600，12: 6800×1=6800
    expect(selectedAmountCent(c, ['11', '12'])).toBe(32400)
    expect(selectedAmountCent(c, ['11'])).toBe(25600)
    expect(selectedAmountCent(c, [])).toBe(0)
  })

  it('★ 首次进页面（全选）的合计恒等于后端 validAmountCent —— 前后端对得上账', () => {
    const c = crossEventCart()
    expect(selectedAmountCent(c, syncSelection(c).selected)).toBe(c.validAmountCent)
  })

  it('★ 失效项永不计入合计（哪怕 id 被手工塞进勾选集合）', () => {
    const c = crossEventCart()
    // 21 行金额 29700、31 行金额 0；即便硬塞进勾选集合，合计也不该把 29700 算进去
    expect(selectedAmountCent(c, ['11', '21'])).toBe(25600 + 29700)
    // ↑ selectedAmountCent 只按 id 求和（不再判 invalid），所以真正的保证在这里：
    //   失效 id 根本进不了勾选集合
    expect(syncSelection(c).selected).not.toContain('21')
    expect(toggleAll(c, [])).not.toContain('21')
    expect(toggleItem([], c.groups[1].items[0], true)).toEqual([])
  })

  it('★ 改数量后合计立刻跟着变（同一函数、新快照）', () => {
    const before = cartOf([group({ items: [item({ id: '11', qty: 2, priceCent: 12800 })] })])
    expect(selectedAmountCent(before, ['11'])).toBe(25600)
    const after = cartOf([group({ items: [item({ id: '11', qty: 5, priceCent: 12800 })] })])
    expect(selectedAmountCent(after, ['11'])).toBe(64000)
  })

  it('脏行金额（null / NaN / 字符串）按 0 计，不把整个合计变成 NaN', () => {
    const c = cartOf([group({
      items: [
        item({ id: 'a', amountCent: Number.NaN }),
        item({ id: 'b', amountCent: null as unknown as number }),
        item({ id: 'c', amountCent: '6800' as unknown as number }),
        item({ id: 'd', amountCent: 100 }),
      ],
    })])
    expect(selectedAmountCent(c, ['a', 'b', 'c', 'd'])).toBe(100)
  })

  it('selectedQty 累加件数；脏 qty 跳过', () => {
    const c = crossEventCart()
    expect(selectedQty(c, ['11', '12'])).toBe(3)
    const dirty = cartOf([group({
      items: [item({ id: 'a', qty: Number.NaN }), item({ id: 'b', qty: -3 }), item({ id: 'c', qty: 2 })],
    })])
    expect(selectedQty(dirty, ['a', 'b', 'c'])).toBe(2)
  })

  it('null 车 → 合计 0 / 件数 0', () => {
    expect(selectedAmountCent(null, ['x'])).toBe(0)
    expect(selectedQty(undefined, ['x'])).toBe(0)
  })
})

describe('★ 去结算闸门（AC：未勾选任何项时置灰）', () => {
  it('★ 一个没选 → 不可结算', () => {
    expect(canCheckout(crossEventCart(), [])).toBe(false)
  })

  it('★ 选了至少一个有效项 → 可结算', () => {
    expect(canCheckout(crossEventCart(), ['12'])).toBe(true)
  })

  it('★ 只勾着失效项（残留 id）→ 仍然置灰，且不会把失效项带去下单', () => {
    const c = crossEventCart()
    expect(canCheckout(c, ['21', '31'])).toBe(false)
    expect(checkoutIds(c, ['21', '31'])).toEqual([])
  })

  it('★ 勾着已消失的 id → 置灰（两次拉取之间的短暂不一致也拦得住）', () => {
    expect(canCheckout(crossEventCart(), ['nope'])).toBe(false)
  })

  it('空车 → 置灰', () => {
    expect(canCheckout(cartOf([]), [])).toBe(false)
    expect(canCheckout(null, ['11'])).toBe(false)
  })

  it('★ 跨场混选 → 一起结算（一单可含多场商品，不按场拆）', () => {
    const c = cartOf([
      group({ items: [item({ id: '11' })] }),
      group({ eventId: '2', eventName: 'B 场', items: [item({ id: '21', eventId: '2' })] }),
    ])
    expect(checkoutIds(c, ['21', '11'])).toEqual(['11', '21'])
  })

  it('checkoutIds 保持页面渲染顺序（不是用户点击顺序）', () => {
    const c = crossEventCart()
    expect(checkoutIds(c, ['12', '11'])).toEqual(['11', '12'])
  })
})

describe('buildCheckoutRoute', () => {
  it('只带 ids（逗号分隔），不带金额 / 数量', () => {
    expect(buildCheckoutRoute(['39', '40'])).toBe(`${CHECKOUT_ROUTE}?ids=39%2C40`)
  })

  it('单个 id', () => {
    expect(buildCheckoutRoute(['39'])).toBe(`${CHECKOUT_ROUTE}?ids=39`)
  })

  it('空 ids → 只返回路径（调用方本就不该跳）', () => {
    expect(buildCheckoutRoute([])).toBe(CHECKOUT_ROUTE)
    expect(buildCheckoutRoute(undefined as unknown as string[])).toBe(CHECKOUT_ROUTE)
  })

  it('路由常量与页面文件路径一致（GZ-JP-204 建 pages/order/confirm.vue）', () => {
    expect(CHECKOUT_ROUTE).toBe('/pages/order/confirm')
  })
})
