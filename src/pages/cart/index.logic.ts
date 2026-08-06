/**
 * 购物车（UI:mp.cart）纯逻辑层 —— GZ-JP-203。
 *
 * <p><b>纪律</b>（同 pages/index/index.logic.ts、pages/event/index.logic.ts）：
 * 本文件<b>不 import uni / vue / 任何组件</b>，只 import 类型与 api 层的纯函数。
 * 所有函数是纯函数（同输入同输出、无副作用、不改入参）。可见字符串不在这里拼（i18n 归 locale）。</p>
 *
 * <p><b>为什么勾选态整套抽到这里</b>：购物车的全部 AC 都落在勾选算术上 ——
 * 「失效项不可勾选且不计入合计」「改数量实时刷新合计」「未勾选任何项时去结算置灰」
 * 「全选 / 组级全选的三态」。这些是边界密集的纯计算（空车 / 整组失效 / 部分选中 /
 * 刷新后 id 变化），抽出来用 vitest 秒级锁死，.vue 只剩「取数 + 传参 + 跳转」。</p>
 *
 * <p><b>★ 勾选态不落库</b>（后端 GZ-JP-104 刻意不维护）：落库只会产生
 * 「勾选态与商品状态不一致」的脏数据（客人勾了 A，店员关了 A 所在的场）。
 * 本层每次拿到新快照都<b>重新对账</b>一遍勾选集合。</p>
 */
import type { GzJpCartGroupVO, GzJpCartItemVO, GzJpCartVO } from '@/api/gz-jp/cart'

/* ============================================================
 * 1. 展开 / 取子集
 * ============================================================ */

/**
 * 把「按场分组」的整车拍平成一维行列表（<b>保持后端给的组顺序与组内顺序</b>）。
 *
 * <p>只用于「算钱 / 算勾选」这类与分组无关的计算。渲染仍按 groups 走 ——
 * 分组是甲方选定的组织方式（design-options/mp-cart.md 方案 A），不能拍平了显示。</p>
 *
 * @param cart 整车（null / groups 缺失 → 空数组）
 */
export function flattenItems(cart: GzJpCartVO | null | undefined): GzJpCartItemVO[] {
  const out: GzJpCartItemVO[] = []
  for (const g of cart?.groups ?? []) {
    for (const it of g?.items ?? []) {
      if (it) {
        out.push(it)
      }
    }
  }
  return out
}

/**
 * 这一行能不能勾选。
 *
 * <p><b>★ 唯一依据是后端 {@code item.invalid}</b>：不看 {@code group.eventBookable}、
 * 不拿场的结束时间跟本地时钟比 —— 判不出店员手动关场，客户端时钟也不可信。
 * 后端每次列表都实时重算该字段（读时惰性判定，不落库）。</p>
 *
 * <p>缺字段（{@code undefined} / 非布尔）一律<b>按可勾选</b>处理：这里拦错方向的代价与加购相反 ——
 * 加购放行会产生无效订单，而勾选只是本地选中；真正的下单闸门在 GZ-JP-105 的下单事务里
 * （它会在同一个事务内重新校验场与商品）。把一件其实还能买的商品变成勾不动的死行，
 * 客人只会以为系统坏了。</p>
 */
export function isSelectable(item: GzJpCartItemVO | null | undefined): boolean {
  return !!item && item.invalid !== true
}

/** 全部<b>可勾选</b>行的 id（顺序同 {@link flattenItems}）。 */
export function selectableIds(cart: GzJpCartVO | null | undefined): string[] {
  return flattenItems(cart).filter(isSelectable).map(it => String(it.id))
}

/**
 * 全部<b>失效</b>行的 id —— 「清空失效商品」直接把它喂给批量删除端点。
 *
 * <p>后端刻意没做独立的「清理失效」端点（GZ-JP-104 报告第 5 条），就是留给这里。</p>
 */
export function invalidIds(cart: GzJpCartVO | null | undefined): string[] {
  return flattenItems(cart).filter(it => it.invalid === true).map(it => String(it.id))
}

/* ============================================================
 * 2. 勾选集合对账（每次拉到新快照都跑一遍）
 * ============================================================ */

/** {@link syncSelection} 的结果。 */
export interface SelectionSync {
  /** 对账后的勾选集合（一定是当前快照里「存在且可勾选」的行的子集） */
  selected: string[]
  /** 本次快照里出现过的<b>全部</b>行 id（含失效项）—— 下次对账用来识别「新出现的行」 */
  known: string[]
}

/**
 * 把上一轮的勾选集合对到新快照上。
 *
 * <p>三条规则，合起来就一句话：<b>「用户的显式选择要留住，新来的默认选上，勾不了的一律去掉」</b>。</p>
 * <ol>
 *   <li><b>失效项永远不勾</b>（AC：失效项不可勾选且不计入合计）——
 *       哪怕它上一轮是选中的（客人勾完之后店员才关的场），也要摘掉；</li>
 *   <li><b>已消失的行摘掉</b>（自己删的 / 别的端删的）—— 否则合计会算进一个页面上根本没有的行；</li>
 *   <li><b>本次<u>新出现</u>的可勾选行默认勾上</b>。首次加载时 {@code known} 为空 ⇒
 *       所有行都是「新出现」⇒ 等价于「进页面默认全选」；此后再刷新，
 *       只有真正新加进来的商品（刚从商品详情加购的那件）会自动勾上，
 *       <b>客人手动取消过的行不会被刷新偷偷勾回来</b>。</li>
 * </ol>
 *
 * <p>把「首次全选」与「刷新保留」统一成同一条规则（而不是写两个分支 + 一个 isFirstLoad 布尔），
 * 是因为那个布尔在真实页面里极难维护正确：onShow 会反复触发，keep-alive 又让页面实例活得比想象久。</p>
 *
 * @param cart         新快照
 * @param prevSelected 上一轮的勾选集合
 * @param prevKnown    上一轮快照里出现过的全部行 id
 */
export function syncSelection(
  cart: GzJpCartVO | null | undefined,
  prevSelected: readonly string[] = [],
  prevKnown: readonly string[] = [],
): SelectionSync {
  const items = flattenItems(cart)
  const known = items.map(it => String(it.id))
  const prevSelectedSet = new Set(prevSelected.map(String))
  const prevKnownSet = new Set(prevKnown.map(String))

  const selected: string[] = []
  for (const it of items) {
    if (!isSelectable(it)) {
      continue
    }
    const id = String(it.id)
    const isNew = !prevKnownSet.has(id)
    if (isNew || prevSelectedSet.has(id)) {
      selected.push(id)
    }
  }
  return { selected, known }
}

/* ============================================================
 * 3. 勾选开关（全选 / 组级 / 单行）
 * ============================================================ */

/** 勾选三态：全选 / 部分选中 / 一个没选。 */
export type SelectionState = 'all' | 'some' | 'none'

/**
 * 一组 id 相对于勾选集合处于什么状态。
 *
 * <p><b>候选集为空时恒返回 'none'</b>（不是 'all'）：整组商品都失效时，
 * 「空集合的每个元素都被选中」这条数学上为真的判断会让组级全选框显示成勾中态，
 * 客人点它却什么也不会发生 —— 一个勾住了但不管用的框比不勾更让人困惑。</p>
 */
export function selectionStateOf(
  candidateIds: readonly string[],
  selected: readonly string[],
): SelectionState {
  if (!candidateIds.length) {
    return 'none'
  }
  const set = new Set(selected.map(String))
  let hit = 0
  for (const id of candidateIds) {
    if (set.has(String(id))) {
      hit++
    }
  }
  if (hit === 0) {
    return 'none'
  }
  return hit === candidateIds.length ? 'all' : 'some'
}

/** 整车勾选状态（底部「全选」框的显示态）。 */
export function cartSelectionState(
  cart: GzJpCartVO | null | undefined,
  selected: readonly string[],
): SelectionState {
  return selectionStateOf(selectableIds(cart), selected)
}

/** 单组勾选状态（组头「全选」框的显示态；组内只算<b>可勾选</b>的行）。 */
export function groupSelectionState(
  group: GzJpCartGroupVO | null | undefined,
  selected: readonly string[],
): SelectionState {
  return selectionStateOf(groupSelectableIds(group), selected)
}

/** 单组里可勾选行的 id。 */
export function groupSelectableIds(group: GzJpCartGroupVO | null | undefined): string[] {
  return (group?.items ?? []).filter(isSelectable).map(it => String(it.id))
}

/**
 * 把一批 id 批量勾上 / 取消（返回新数组，<b>不改入参</b>）。
 *
 * <p>勾上时保持「原有顺序在前、新增的按 ids 顺序追加」，便于测试断言与调试；
 * 集合语义上顺序无关紧要，但一个稳定顺序能让 diff 看得懂。</p>
 */
export function setSelected(
  selected: readonly string[],
  ids: readonly string[],
  checked: boolean,
): string[] {
  const target = new Set(ids.map(String))
  if (!checked) {
    return selected.map(String).filter(id => !target.has(id))
  }
  const out = selected.map(String)
  const has = new Set(out)
  for (const id of ids) {
    const key = String(id)
    if (!has.has(key)) {
      has.add(key)
      out.push(key)
    }
  }
  return out
}

/**
 * 切换单行勾选（失效行<b>点了也不动</b>）。
 *
 * <p>组件侧也会把失效行的点击禁掉，这里再拦一道 —— 两处都拦不是冗余：
 * 组件那层是体验（不给按下反馈），这层是不变量（勾选集合里永远不会混进失效行，
 * 于是合计与「去结算」的闸门都不用再各自判一次 invalid）。</p>
 */
export function toggleItem(
  selected: readonly string[],
  item: GzJpCartItemVO | null | undefined,
  checked: boolean,
): string[] {
  if (!item || !isSelectable(item)) {
    return selected.map(String)
  }
  return setSelected(selected, [String(item.id)], checked)
}

/**
 * 点「全选」框：当前是全选 → 全部取消；否则（部分 / 一个没选）→ 全部勾上。
 *
 * <p>用「当前状态」而不是「传一个 checked 布尔」来决定方向，是因为三态框的下一步动作
 * 只有这一种符合直觉的定义（部分选中时点它，客人期望的是「都选上」而不是「都清空」）。</p>
 */
export function toggleAll(
  cart: GzJpCartVO | null | undefined,
  selected: readonly string[],
): string[] {
  const ids = selectableIds(cart)
  const next = cartSelectionState(cart, selected) !== 'all'
  return setSelected(selected, ids, next)
}

/** 点组头「全选」框（口径同 {@link toggleAll}，作用域缩到本组）。 */
export function toggleGroup(
  group: GzJpCartGroupVO | null | undefined,
  selected: readonly string[],
): string[] {
  const ids = groupSelectableIds(group)
  const next = groupSelectionState(group, selected) !== 'all'
  return setSelected(selected, ids, next)
}

/* ============================================================
 * 4. 合计（★ 只有商品合计一行，REQ-ORDER-004 全包邮）
 * ============================================================ */

/**
 * 已勾选行的合计（<b>分</b>）。
 *
 * <p><b>★ 这就是客人要付的全部金额</b> —— 拼团价已含全部配送成本（REQ-ORDER-004），
 * 系统里不存在第二笔费用，底部也就只有这一行。</p>
 *
 * <p><b>逐行用后端算好的 {@code amountCent} 累加</b>，不在前端做 {@code priceCent × qty}：
 * 单价与数量都可能是脏值（后端未填价 → null），前端乘一遍只会多一个出错的地方。
 * 非有限数的行金额按 0 计（不让一个 NaN 把整个合计变成 NaN —— 那会让客人看到「¥NaN」）。</p>
 *
 * <p><b>失效项不计入</b>（AC）—— 它们根本进不了勾选集合，见 {@link syncSelection}。</p>
 */
export function selectedAmountCent(
  cart: GzJpCartVO | null | undefined,
  selected: readonly string[],
): number {
  const set = new Set(selected.map(String))
  let sum = 0
  for (const it of flattenItems(cart)) {
    if (!set.has(String(it.id))) {
      continue
    }
    const amount = it.amountCent
    if (typeof amount === 'number' && Number.isFinite(amount)) {
      sum += amount
    }
  }
  return sum
}

/** 已勾选行的总件数（Σ qty）—— 去结算按钮上的角标。 */
export function selectedQty(
  cart: GzJpCartVO | null | undefined,
  selected: readonly string[],
): number {
  const set = new Set(selected.map(String))
  let sum = 0
  for (const it of flattenItems(cart)) {
    if (!set.has(String(it.id))) {
      continue
    }
    const qty = it.qty
    if (typeof qty === 'number' && Number.isFinite(qty) && qty > 0) {
      sum += Math.floor(qty)
    }
  }
  return sum
}

/* ============================================================
 * 5. 去结算
 * ============================================================ */

/**
 * 「去结算」能不能点。
 *
 * <p><b>AC：未勾选任何项时置灰</b>。判的是「勾选集合里有没有<u>当前快照中仍然可勾选</u>的行」，
 * 不是简单的 {@code selected.length > 0} —— 勾选集合可能残留已消失 / 已失效的 id
 * （对账在 {@link syncSelection} 里做，但页面在两次拉取之间可能短暂不一致）。</p>
 */
export function canCheckout(
  cart: GzJpCartVO | null | undefined,
  selected: readonly string[],
): boolean {
  return checkoutIds(cart, selected).length > 0
}

/**
 * 实际带去结算的行 id（= 勾选集合 ∩ 当前可勾选行，<b>保持页面渲染顺序</b>）。
 *
 * <p>顺序跟着 {@link flattenItems} 走（可下单场 → 已结束场 → 孤儿组，组内最近加购在前），
 * 这样下单确认页的商品清单与购物车看到的顺序一致，客人不用重新找一遍。</p>
 */
export function checkoutIds(
  cart: GzJpCartVO | null | undefined,
  selected: readonly string[],
): string[] {
  const set = new Set(selected.map(String))
  return flattenItems(cart)
    .filter(it => isSelectable(it) && set.has(String(it.id)))
    .map(it => String(it.id))
}

/** 下单确认页路由（GZ-JP-204 交付；未上线时 navigateTo 会 fail，页面兜 toast）。 */
export const CHECKOUT_ROUTE = '/pages/order/confirm'

/** 首页路由（空车「去逛逛」的落点；首页是 tabbar 页，跳转要用 switchTab）。 */
export const HOME_ROUTE = '/pages/index/index'

/**
 * 拼下单确认页路由。
 *
 * <p><b>只传购物车项 id</b>（逗号分隔），不传商品 / 价格 / 数量：</p>
 * <ul>
 *   <li>后端 GZ-JP-105 收的就是这组 id（{@code selectByUserAndIds}），确认页照传即可；</li>
 *   <li>价格与数量一律由确认页重新拉、由后端重算 —— 从 URL 带过去的金额是最经典的一类
 *       篡改面，而且客人在两个页面之间停留时价格可能已经变了。</li>
 * </ul>
 *
 * @param ids 勾选的购物车项 id（建议先过 {@link checkoutIds}）
 * @returns 形如 {@code /pages/order/confirm?ids=39,40}；ids 为空 → 只返回路径（调用方本就不该跳）
 */
export function buildCheckoutRoute(ids: readonly string[]): string {
  const list = (ids ?? []).map(String).filter(Boolean)
  if (!list.length) {
    return CHECKOUT_ROUTE
  }
  return `${CHECKOUT_ROUTE}?ids=${encodeURIComponent(list.join(','))}`
}
