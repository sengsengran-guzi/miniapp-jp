/**
 * GZ-JP-204 下单确认纯逻辑单测。
 *
 * <p>逐条锁 AC 与 blueprint 硬约束：</p>
 * <ol>
 *   <li><b>★ 地址必选，未选不可提交</b>（{@code buildSubmitGate} 的 no_address 分支）</li>
 *   <li><b>★ 已阅读不支持退款必勾</b>（design-options/mp-product-detail.md 方案 A 的配套举证）</li>
 *   <li><b>★ 金额只有商品合计与实付两行</b> —— 两行同源于 {@code checkoutAmountCent}，
 *       测「Σ 行金额恒等于应付」即证明中间没有第三笔（无处插入）</li>
 *   <li><b>提交前复校失效项</b>（{@code pickCheckoutItems} 重新读 invalid，不吃购物车那一刻的判定）</li>
 *   <li><b>后端业务码 → 前端动作</b>（4102 退回购物车 / 4104 刷新本页 / 4107 <b>绝不重试</b>）</li>
 * </ol>
 *
 * <p>全部纯函数，不碰 uni / 网络 / 组件。</p>
 */
import type { GzJpCartGroupVO, GzJpCartItemVO, GzJpCartVO } from '@/api/gz-jp/cart'
import type { GzUserAddressVO } from '@/api/gz-user-address'
import { describe, expect, it } from 'vitest'
import { JP_ORDER_ERROR } from '@/api/gz-jp/order'
import {
  buildSubmitGate,
  checkoutAmountCent,
  checkoutQty,
  formatAddressLine,
  parseCheckoutIds,
  pickCheckoutItems,
  pickDefaultAddress,
  resolveSubmitFailAction,
  syncSelectedAddress,
  validateAddressForm,
} from './confirm.logic'

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

function cart(groups: GzJpCartGroupVO[]): GzJpCartVO {
  const items = groups.flatMap(g => g.items)
  const valid = items.filter(i => !i.invalid)
  return {
    groups,
    itemCount: items.length,
    invalidCount: items.length - valid.length,
    validQty: valid.reduce((s, i) => s + i.qty, 0),
    validAmountCent: valid.reduce((s, i) => s + i.amountCent, 0),
  }
}

function address(over: Partial<GzUserAddressVO> = {}): GzUserAddressVO {
  return {
    id: '1',
    recipientName: '张三',
    mobile: '13800000000',
    province: '四川省',
    city: '成都市',
    district: '锦江区',
    detail: '春熙路 1 号',
    tag: null,
    isDefault: 0,
    createTime: '2026-08-06 22:56:22',
    ...over,
  }
}

/* ══════════════════════════════════════════════════════════
 * 1. 路由参数
 * ══════════════════════════════════════════════════════════ */

describe('parseCheckoutIds', () => {
  it('解析购物车传来的逗号分隔 id', () => {
    expect(parseCheckoutIds('39,40')).toEqual(['39', '40'])
  })

  it('空 / null / 空白 → 空数组（页面据此显示「没有可结算的商品」）', () => {
    expect(parseCheckoutIds('')).toEqual([])
    expect(parseCheckoutIds(null)).toEqual([])
    expect(parseCheckoutIds(undefined)).toEqual([])
    expect(parseCheckoutIds('   ')).toEqual([])
  })

  it('去掉空段与首尾空白（",39, ,40," 这类脏串不该产生空 id）', () => {
    expect(parseCheckoutIds(',39, ,40,')).toEqual(['39', '40'])
  })

  it('★ 去重且保序 —— 重复 id 会让同一件商品在清单里出现两次', () => {
    expect(parseCheckoutIds('40,39,40')).toEqual(['40', '39'])
  })
})

/* ══════════════════════════════════════════════════════════
 * 2. 商品清单
 * ══════════════════════════════════════════════════════════ */

describe('pickCheckoutItems', () => {
  it('按 id 取子集，顺序跟购物车走不跟 ids 走', () => {
    const c = cart([group({ items: [item({ id: '10' }), item({ id: '11' }), item({ id: '12' })] })])
    // ids 故意乱序传
    const r = pickCheckoutItems(c, ['12', '10'])
    expect(r.items.map(i => i.id)).toEqual(['10', '12'])
  })

  it('跨场结算：两个分组的行都能挑出来（一单可含多场）', () => {
    const c = cart([
      group({ eventId: '1', items: [item({ id: '10' })] }),
      group({ eventId: '2', eventName: '9月新番场', items: [item({ id: '20' })] }),
    ])
    const r = pickCheckoutItems(c, ['10', '20'])
    expect(r.items.map(i => i.id)).toEqual(['10', '20'])
    expect(r.missingIds).toEqual([])
  })

  it('车里已经没有的 id 进 missingIds（别的端删了 / 已结算过）', () => {
    const c = cart([group({ items: [item({ id: '10' })] })])
    const r = pickCheckoutItems(c, ['10', '99'])
    expect(r.items.map(i => i.id)).toEqual(['10'])
    expect(r.missingIds).toEqual(['99'])
  })

  it('★ 重新读 invalid —— 客人停留期间店员关了场，这里必须照出来', () => {
    const c = cart([group({
      eventBookable: false,
      items: [item({ id: '10', invalid: true, invalidReason: 'event_closed', invalidText: '本场已结束' })],
    })])
    const r = pickCheckoutItems(c, ['10'])
    expect(r.invalidItems.map(i => i.id)).toEqual(['10'])
  })

  it('空车 / null 车不炸（返回空结果 + 全部 id 记为 missing）', () => {
    expect(pickCheckoutItems(null, ['1']).items).toEqual([])
    expect(pickCheckoutItems(null, ['1']).missingIds).toEqual(['1'])
    expect(pickCheckoutItems(cart([]), []).items).toEqual([])
  })
})

describe('checkoutAmountCent / checkoutQty', () => {
  it('★ 应付 = Σ 行金额（无第三笔可插入 —— 商品合计与实付同源）', () => {
    const items = [item({ id: '1', priceCent: 12800, qty: 2 }), item({ id: '2', priceCent: 6800, qty: 3 })]
    expect(checkoutAmountCent(items)).toBe(12800 * 2 + 6800 * 3)
    expect(checkoutQty(items)).toBe(5)
  })

  it('逐行用后端 amountCent，不在前端做 priceCent × qty', () => {
    // 故意造一行「单价 × 数量 ≠ 行金额」的脏数据：以后端 amountCent 为准
    const dirty = { ...item({ id: '1', priceCent: 100, qty: 2 }), amountCent: 999 }
    expect(checkoutAmountCent([dirty])).toBe(999)
  })

  it('脏 amountCent 按 0 计，不让整个金额变成 NaN（客人会看到「¥NaN」）', () => {
    const dirty = { ...item({ id: '1' }), amountCent: Number.NaN as unknown as number }
    expect(checkoutAmountCent([dirty, item({ id: '2', priceCent: 100, qty: 1 })])).toBe(100)
  })

  it('空清单 → 0（不是 NaN、不是 undefined）', () => {
    expect(checkoutAmountCent([])).toBe(0)
    expect(checkoutAmountCent(null)).toBe(0)
    expect(checkoutQty(null)).toBe(0)
  })

  it('非法 qty 不计入件数', () => {
    const bad = { ...item({ id: '1' }), qty: -3 }
    expect(checkoutQty([bad, item({ id: '2', qty: 2 })])).toBe(2)
  })
})

/* ══════════════════════════════════════════════════════════
 * 3. 收货地址
 * ══════════════════════════════════════════════════════════ */

describe('pickDefaultAddress', () => {
  it('优先后端标的默认地址', () => {
    const list = [address({ id: '1' }), address({ id: '2', isDefault: 1 })]
    expect(pickDefaultAddress(list)?.id).toBe('2')
  })

  it('没有默认标记 → 取第一个（后端已把默认置顶，但不把排序当隐式契约）', () => {
    expect(pickDefaultAddress([address({ id: '7' }), address({ id: '8' })])?.id).toBe('7')
  })

  it('★ 空地址簿 → null（页面显示「添加收货地址」，提交被拦）', () => {
    expect(pickDefaultAddress([])).toBeNull()
    expect(pickDefaultAddress(null)).toBeNull()
  })
})

describe('syncSelectedAddress', () => {
  it('选中的地址还在 → 返回新列表里的那一份（拿到刚编辑过的字段）', () => {
    const list = [address({ id: '1', recipientName: '李四' })]
    expect(syncSelectedAddress(list, '1')?.recipientName).toBe('李四')
  })

  it('选中的地址被删了 → 回落默认地址（不留一个指向空气的 addressId）', () => {
    const list = [address({ id: '2', isDefault: 1 })]
    expect(syncSelectedAddress(list, '1')?.id).toBe('2')
  })

  it('地址被删光 → null（提交重新被拦住）', () => {
    expect(syncSelectedAddress([], '1')).toBeNull()
  })

  it('新增地址后传新 id → 选中新的那个', () => {
    const list = [address({ id: '1', isDefault: 1 }), address({ id: '9' })]
    expect(syncSelectedAddress(list, '9')?.id).toBe('9')
  })
})

describe('formatAddressLine', () => {
  it('省市区 + 详细地址拼一行', () => {
    expect(formatAddressLine(address())).toBe('四川省 成都市 锦江区 春熙路 1 号')
  })

  it('直辖市省市同名时不重复（「北京市 北京市 朝阳区」→「北京市 朝阳区」）', () => {
    const a = address({ province: '北京市', city: '北京市', district: '朝阳区', detail: '建国路 1 号' })
    expect(formatAddressLine(a)).toBe('北京市 朝阳区 建国路 1 号')
  })

  it('null → 空串（不出 "undefined undefined"）', () => {
    expect(formatAddressLine(null)).toBe('')
  })
})

describe('validateAddressForm', () => {
  const ok = {
    recipientName: '张三',
    mobile: '13800000000',
    province: '四川省',
    city: '成都市',
    district: '锦江区',
    detail: '春熙路 1 号',
  }

  it('合法表单 → null', () => {
    expect(validateAddressForm(ok)).toBeNull()
  })

  it('逐字段拦（返回第一个不合格的）', () => {
    expect(validateAddressForm({ ...ok, recipientName: '  ' })).toBe('name')
    expect(validateAddressForm({ ...ok, mobile: '1380000' })).toBe('mobile')
    expect(validateAddressForm({ ...ok, district: '' })).toBe('region')
    expect(validateAddressForm({ ...ok, detail: '   ' })).toBe('detail')
  })

  it('手机号口径与后端 @Pattern 一致：11 位、1 开头、第二位 3-9', () => {
    expect(validateAddressForm({ ...ok, mobile: '12800000000' })).toBe('mobile')
    expect(validateAddressForm({ ...ok, mobile: '138000000000' })).toBe('mobile')
    expect(validateAddressForm({ ...ok, mobile: '19912345678' })).toBeNull()
  })

  it('手机号当字符串处理（不做 Number 转换，前导 0 与精度都会出事）', () => {
    // 带空格的输入 trim 后仍合法
    expect(validateAddressForm({ ...ok, mobile: ' 13800000000 ' })).toBeNull()
  })
})

/* ══════════════════════════════════════════════════════════
 * 4. ★ 提交闸门（两条 AC 都在这里）
 * ══════════════════════════════════════════════════════════ */

describe('buildSubmitGate', () => {
  const base = { itemCount: 2, invalidCount: 0, addressId: '1', agreedNoRefund: true, submitting: false }

  it('全部就绪 → 可提交', () => {
    expect(buildSubmitGate(base)).toEqual({ disabled: false, reason: null })
  })

  it('★ AC：没选地址 → 置灰，原因 no_address', () => {
    expect(buildSubmitGate({ ...base, addressId: null })).toEqual({ disabled: true, reason: 'no_address' })
    expect(buildSubmitGate({ ...base, addressId: '' })).toEqual({ disabled: true, reason: 'no_address' })
    expect(buildSubmitGate({ ...base, addressId: '   ' })).toEqual({ disabled: true, reason: 'no_address' })
  })

  it('★ 没勾「已阅读不支持退款」→ 置灰，原因 not_agreed', () => {
    expect(buildSubmitGate({ ...base, agreedNoRefund: false }))
      .toEqual({ disabled: true, reason: 'not_agreed' })
  })

  it('★ 反方向：勾上之后立刻可提交（证明不是「永远置灰」）', () => {
    expect(buildSubmitGate({ ...base, agreedNoRefund: false }).disabled).toBe(true)
    expect(buildSubmitGate({ ...base, agreedNoRefund: true }).disabled).toBe(false)
  })

  it('一件商品都没有 → 置灰，原因 empty', () => {
    expect(buildSubmitGate({ ...base, itemCount: 0 })).toEqual({ disabled: true, reason: 'empty' })
  })

  it('有失效项 → 置灰，原因 invalid（必须回购物车处理，不是就地重试）', () => {
    expect(buildSubmitGate({ ...base, invalidCount: 1 })).toEqual({ disabled: true, reason: 'invalid' })
  })

  it('提交中 → 置灰（防双击打出两张单；后端 4107 是兜底不是依赖）', () => {
    expect(buildSubmitGate({ ...base, submitting: true })).toEqual({ disabled: true, reason: 'submitting' })
  })

  it('★ 原因优先级：先报客人自己解决不了的（无商品 / 有失效），再报就地能补的（地址 / 协议）', () => {
    // 车空 + 没地址 + 没勾 → 应该指向「没商品」，而不是让人先去勾一个勾了也没用的框
    const r = buildSubmitGate({ itemCount: 0, invalidCount: 0, addressId: null, agreedNoRefund: false, submitting: false })
    expect(r.reason).toBe('empty')
    // 有失效项 + 没地址 → 先报失效
    const r2 = buildSubmitGate({ itemCount: 2, invalidCount: 1, addressId: null, agreedNoRefund: false, submitting: false })
    expect(r2.reason).toBe('invalid')
    // submitting 压过一切（正在飞的请求不该被别的原因盖掉）
    const r3 = buildSubmitGate({ itemCount: 0, invalidCount: 3, addressId: null, agreedNoRefund: false, submitting: true })
    expect(r3.reason).toBe('submitting')
  })
})

/* ══════════════════════════════════════════════════════════
 * 5. 提交失败 → 往哪走
 * ══════════════════════════════════════════════════════════ */

describe('resolveSubmitFailAction', () => {
  it('4101 勾选项没了 / 4102 商品失效 → ★ 退回购物车（不原地重试）', () => {
    expect(resolveSubmitFailAction(JP_ORDER_ERROR.CART_EMPTY)).toBe('back_to_cart')
    expect(resolveSubmitFailAction(JP_ORDER_ERROR.ITEM_INVALID)).toBe('back_to_cart')
  })

  it('4103 地址无效 → 就地重选地址', () => {
    expect(resolveSubmitFailAction(JP_ORDER_ERROR.ADDRESS_INVALID)).toBe('pick_address')
  })

  it('4104 价格变动 → 刷新本页让客人按新价重新确认', () => {
    expect(resolveSubmitFailAction(JP_ORDER_ERROR.PRICE_CHANGED)).toBe('reload')
  })

  it('★ 4107 重复提交 → 去我的订单，绝不重试（重试只会多一张单）', () => {
    expect(resolveSubmitFailAction(JP_ORDER_ERROR.DUPLICATE_SUBMIT)).toBe('go_orders')
  })

  it('未知码 / null / 网络失败 → 留在本页（msg 已 toast，别乱跳）', () => {
    expect(resolveSubmitFailAction(500)).toBe('stay')
    expect(resolveSubmitFailAction(null)).toBe('stay')
    expect(resolveSubmitFailAction(undefined)).toBe('stay')
    // 后端 @NotEmpty 校验失败时是 500 不是 4101（实测），同样留在本页
    expect(resolveSubmitFailAction(Number.NaN)).toBe('stay')
  })
})
