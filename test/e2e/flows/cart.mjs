/**
 * cart flow —— 加购到结算全流程（GZ-JP-203 / UI:mp.cart + UI:mp.cart.group + UI:mp.cart.summary）。
 *
 * <p>验六件事，对应任务卡 AC + accept #1「加购到结算全流程可走通」：</p>
 * <ol>
 *   <li>★ <b>加购是真的</b> —— 点商品详情的「加入购物车」后，<b>后端购物车里真多了一行</b>
 *       （flow 用同一个用户的 token 直连后端比对）。光看 toast 证明不了任何事。</li>
 *   <li>★ <b>三跳可达购物车</b> —— 首页场卡 →(1)→ 场详情 → 商品卡 →(2)→ 商品详情
 *       → CTA 条购物车入口 →(3)→ 购物车。跳的是<b>业务主线真入口</b>，不是 reLaunch 直达。</li>
 *   <li><b>按场分组 + 文案来自后端</b> —— 组名 / 商品名与后端逐字一致（不是前端 mock）。</li>
 *   <li>★ <b>合计</b> —— 首次进页面默认全选，页面合计必须等于后端 {@code validAmountCent}；
 *       <b>改数量后合计实时刷新</b>且与后端 qty 对得上。</li>
 *   <li>★ <b>未勾选任何项时「去结算」置灰</b> —— 取消全选 → 置灰 + 合计归零；
 *       重新全选 → 恢复可点。<b>两个方向都测</b>（只测一个方向的话，写成「永远置灰」也能骗过）。</li>
 *   <li>★ <b>底部只有商品合计一行</b> —— 渲染产物里不出现另收费用的字样（全包邮，REQ-ORDER-004）。
 *       accept #2 grep 的是源码，这里守的是<b>真实渲染结果</b>。</li>
 * </ol>
 *
 * <p><b>需要登录态</b>：购物车四个端点都无 &#64;SaIgnore。flow 走真实登录路径
 * （{@code loginIfNeeded} → 协议 sheet → 勾选 → wxMOCK 登录），不后门注 storage。</p>
 *
 * <p><b>取数 / 治具与断言分离</b>（同 product flow）：{@link run} 负责拉后端、拿 token、清空购物车，
 * {@link runWith} 只做断言并通过注入的 {@code readCart} 读车 —— 于是 self-test.mjs 能<b>零环境依赖</b>
 * 把断言逻辑跑一遍（喂假的 backend 数据），而不是在 flow 里埋测试用环境变量后门。</p>
 */
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { deep, deepWait, deepTexts, gotoPage, loginIfNeeded, readAppToken, screenshot, sleep, SHOT_DIR } from '../mp-e2e.mjs'

/** 后端地址（与 preflight / dist 的 VITE_SERVER_BASEURL 一致）。 */
const BACKEND = process.env.MP_BACKEND || 'http://localhost:8080'
/** 本小程序 clientid（.env 的 VITE_APP_CLIENT_ID；后端按它路由 appid 配置）。 */
const CLIENT_ID = 'mp-applet-gz-jp'
/** 与页面 EVENT_PRODUCT_PAGE_SIZE 一致。 */
const PRODUCT_PAGE_SIZE = 20
/** 页面改数量的防抖窗口（src/pages/cart/index.vue 的 flushQty = 350ms）+ 网络往返 + 整车重拉。 */
const QTY_SETTLE_MS = 3000

/**
 * 直连后端（curl 而非 node fetch：本机 clash 代理会吞 localhost，
 * 与 preflight.mjs / home.mjs / product.mjs 用同一套 `--noproxy '*'` 写法）。
 *
 * @param method HTTP 方法
 * @param pathAndQuery 路径
 * @param token  sa-token（购物车端点需登录；不传则匿名）
 */
function api(method, pathAndQuery, token = '') {
  const auth = token ? ` -H 'Authorization: Bearer ${token}'` : ''
  const body = execSync(
    `curl -s --noproxy '*' -m 10 -X ${method} '${BACKEND}${pathAndQuery}' -H 'clientid: ${CLIENT_ID}'${auth}`,
    { encoding: 'utf8' },
  )
  try {
    return JSON.parse(body)
  }
  catch {
    throw new Error(`后端 ${method} ${pathAndQuery} 返回的不是 JSON：${body.slice(0, 200)}`)
  }
}

/**
 * 独立重算「这场属于哪一组」+「首页第一张卡是谁」—— 刻意不 import src 里的实现
 * （oracle 要独立于被测代码，否则实现和断言一起写错就一起绿）。同 product flow。
 */
function classify(event, nowMs) {
  if (!event || event.status !== 'open') return 'ended'
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(event.startTime || '').trim())
  if (!m) return 'live'
  const start = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime()
  return start > nowMs ? 'upcoming' : 'live'
}

function firstCardEvent(events, nowMs) {
  for (const key of ['live', 'upcoming', 'ended']) {
    const hit = events.find(e => classify(e, nowMs) === key)
    if (hit) return hit
  }
  return null
}

/** 分 → 元的纯数字串（与 formatYuan 同口径独立重算，不 import 被测实现）。 */
function yuanOf(cent) {
  const y = Number(cent) / 100
  return Number.isInteger(y) ? String(y) : y.toFixed(2)
}

/**
 * 取一组元素的文本，trim 后返回数组。
 *
 * <p>⚠️ 只对<b>页面模板里</b>的选择器有效（本 flow 里只有 `.jp-cart__group-name` 是）。
 * 组件内部的（`.biz-cart-item__*` 等）必须用 mp-e2e 的 {@code deepTexts} ——
 * {@code page.$$} 不跨组件边界，查不到时返回空数组，会把断言悄悄变成恒真。</p>
 */
async function textsOf(page, selector) {
  const els = await page.$$(selector).catch(() => [])
  const out = []
  for (const el of els) {
    const s = await el.text().catch(() => '')
    out.push(String(s ?? '').trim())
  }
  return out
}

/**
 * flow 入口：登录 → 拉后端场/商品 → 清空购物车（确定性起点）→ 交给 {@link runWith} 断言。
 */
export async function run(mp) {
  // ── 0. 登录（购物车需登录态；走真实路径，顺带守协议合规闸门）
  if (!await loginIfNeeded(mp)) {
    throw new Error('登录失败 —— 购物车四个端点都需登录，本 flow 无从走起（查后端 wxMOCK 通道 / clientid 配置）')
  }
  const token = await readAppToken(mp)
  if (!token) {
    throw new Error('取不到 app 持有的 sa-token（storage key="token"）—— 无法用同一用户身份直连后端比对')
  }
  console.log(`  ✓ 已登录，取到 app 的 token（${token.length} 字符）`)

  // ── 1. 后端场 / 商品 fixture（匿名可读）
  const listJson = api('GET', '/app/gz/jp/event/list?pageNum=1&pageSize=20')
  const events = Array.isArray(listJson.rows) ? listJson.rows : []
  const event = firstCardEvent(events, Date.now())
  if (!event) {
    throw new Error(
      '后端 event/list 返回 0 条场 —— 本 flow 的入口（点首页第一张场卡）无从走起。'
      + '请先在 dev 库造一个 open 场（GZ-JP-101 admin 建场并开场）。',
    )
  }
  const prodJson = api('GET', `/app/gz/jp/product/list?eventId=${encodeURIComponent(event.id)}&pageNum=1&pageSize=${PRODUCT_PAGE_SIZE}`)
  const products = Array.isArray(prodJson.rows) ? prodJson.rows : []
  if (!products.length) {
    throw new Error(
      `后端场「${event.name}」(id=${event.id}) 里 0 件在架商品 —— 加购无从走起。`
      + '请先给该场造一个 on_shelf 商品（GZ-JP-102 admin 建商品并上架）。',
    )
  }
  const detailJson = api('GET', `/app/gz/jp/product/${encodeURIComponent(products[0].id)}`)
  if (detailJson.code !== 200 || !detailJson.data) {
    throw new Error(`后端 product/${products[0].id} 详情取不到（code=${detailJson.code} msg=${detailJson.msg}）`)
  }
  const product = detailJson.data
  console.log(`  后端 fixture：场=${JSON.stringify(event.name)} 商品=${JSON.stringify(product.name)} 单价=${product.priceCent}分`)

  // ── 2. 读车 / 清车治具（用 app 自己那个会话的 token —— 换个会话看到的就不是页面上这辆车了）
  const readCart = () => {
    const res = api('GET', '/app/gz/jp/cart/list', token)
    if (res.code !== 200 || !res.data) {
      throw new Error(`后端 cart/list 取不到（code=${res.code} msg=${res.msg}）—— token 失效？`)
    }
    return res.data
  }
  const clearCart = () => {
    const cart = readCart()
    const ids = cart.groups.flatMap(g => g.items.map(it => it.id))
    if (ids.length) {
      api('DELETE', `/app/gz/jp/cart/${ids.join(',')}`, token)
    }
    return ids.length
  }

  return runWith(mp, { event, product, readCart, clearCart })
}

/**
 * 断言主体。
 *
 * @param mp   automator 句柄
 * @param data {{event, product, readCart, clearCart}} —— readCart/clearCart 是<b>后端真读真写</b>
 *             （self-test 里换成假实现，断言逻辑一字不改地跑一遍）
 */
export async function runWith(mp, { event, product, readCart, clearCart }) {
  mkdirSync(SHOT_DIR, { recursive: true })
  const fails = []

  // ── 确定性起点：清空购物车（上一轮残留会让「加购后应有 1 款」的断言飘）
  const cleared = clearCart()
  const before = readCart()
  if (before.itemCount !== 0) {
    throw new Error(`清空购物车后仍有 ${before.itemCount} 款 —— 治具没生效，后续断言不可信`)
  }
  console.log(`  ✓ 起点已清空购物车（清掉 ${cleared} 款残留）`)

  /* ═══ 第 1、2 跳：首页 → 场详情 → 商品详情（202 已验的两跳，这里当前置）═══ */

  const home = await gotoPage(mp, '/pages/index/index', 2500)
  // ★ 场卡 / 商品卡是自定义组件（BizEventCard / BizProductCard）→ deep()，page.$ 恒为 null
  const eventCard = await deepWait(home, '.jp-event-card')
  if (!eventCard) throw new Error('首页没有场卡 .jp-event-card —— 第 1 跳的入口不存在（先看 home flow）')
  await eventCard.tap()
  await sleep(2500)

  const eventPage = await mp.currentPage()
  if (eventPage?.path !== 'pages/event/index') {
    throw new Error(`第 1 跳失败：点首页场卡后落在 ${JSON.stringify(eventPage?.path)}，期望 "pages/event/index"`)
  }
  const productCard = await deepWait(eventPage, '.jp-product-card')
  if (!productCard) throw new Error('场详情没有商品卡 .jp-product-card —— 第 2 跳的入口不存在')
  await productCard.tap()
  await sleep(2500)

  const detailPage = await mp.currentPage()
  if (detailPage?.path !== 'pages/product/detail') {
    throw new Error(`第 2 跳失败：点商品卡后落在 ${JSON.stringify(detailPage?.path)}，期望 "pages/product/detail"`)
  }
  console.log('  ✓ 前置两跳：首页 → 场详情 → 商品详情')

  /* ═══ ★ 真加购（本卡的核心）═══════════════════════════ */

  const ctaBtn = await detailPage.$('.jp-product-cta__btn').catch(() => null)
  if (!ctaBtn) throw new Error('商品详情没有加购 CTA .jp-product-cta__btn')
  const ctaCls = String(await ctaBtn.attribute('class').catch(() => '') || '')
  if (/\bis-disabled\b/.test(ctaCls)) {
    throw new Error(
      `加购按钮是置灰态（class=${JSON.stringify(ctaCls)}）—— 后端 eventBookable=${product.eventBookable}。`
      + '本 flow 需要一个可下单的场，请确认 fixture 里的场是 open 的。',
    )
  }
  await ctaBtn.tap()
  await sleep(3000)
  await screenshot(mp, `${SHOT_DIR}/cart_1_added.png`)

  // ★★ 加购的直接证据：后端购物车真多了一行（不是前端 toast 装出来的）
  const afterAdd = readCart()
  if (afterAdd.itemCount !== 1) {
    fails.push(
      `★ 点了「加入购物车」但后端购物车款数=${afterAdd.itemCount}（期望 1）`
      + ' —— 加购没有真正落库（还是占位 toast？或登录态没带上）',
    )
  }
  else {
    const row = afterAdd.groups[0]?.items?.[0]
    if (String(row?.productId) !== String(product.id)) {
      fails.push(`★ 加购落库的商品对不上：后端车里 productId=${row?.productId}，期望 ${product.id}`)
    }
    else {
      console.log(`  ✓ ★ 加购真落库：后端车里 1 款「${row.name}」× ${row.qty}（productId=${row.productId}）`)
    }
  }

  // CTA 条上的购物车角标应该跟着出现（客人看得见「东西进去了」）
  const badgeEl = await detailPage.$('.jp-product-cta__cart-badge').catch(() => null)
  const badgeText = badgeEl ? String(await badgeEl.text().catch(() => '')).trim() : ''
  if (badgeText !== String(afterAdd.itemCount)) {
    fails.push(`加购后 CTA 条购物车角标=${JSON.stringify(badgeText)}，期望 ${JSON.stringify(String(afterAdd.itemCount))}`)
  }
  else {
    console.log(`  ✓ CTA 条购物车角标 = ${badgeText}`)
  }

  /* ═══ 第 3 跳：商品详情 → 购物车（真入口）═══════════════ */

  const cartEntry = await detailPage.$('.jp-product-cta__cart').catch(() => null)
  if (!cartEntry) throw new Error('商品详情 CTA 条没有购物车入口 .jp-product-cta__cart —— 购物车页没有真入口')
  await cartEntry.tap()
  await sleep(2500)

  const cartPage = await mp.currentPage()
  if (cartPage?.path !== 'pages/cart/index') {
    throw new Error(
      `第 3 跳失败：点购物车入口后落在 ${JSON.stringify(cartPage?.path)}，期望 "pages/cart/index"`,
    )
  }
  console.log('  ✓ ★ 第 3 跳：商品详情 → 购物车（pages/cart/index）—— 从首页三跳可达')
  await screenshot(mp, `${SHOT_DIR}/cart_2_cart.png`)

  /* ═══ 购物车页断言 ═════════════════════════════════════ */

  const cart = readCart()

  // a) 按场分组：组数 + 组名与后端逐字一致
  const groupNames = await textsOf(cartPage, '.jp-cart__group-name')
  const expectGroupNames = cart.groups.map(g => g.eventName)
  if (groupNames.length !== expectGroupNames.length) {
    fails.push(`分组数对不上：页面 ${groupNames.length} 组，后端 ${expectGroupNames.length} 组（页面=${JSON.stringify(groupNames)}）`)
  }
  const missingGroups = expectGroupNames.filter(n => !groupNames.includes(n))
  if (missingGroups.length) {
    fails.push(`这些后端场名没渲染成分组头：${JSON.stringify(missingGroups)}；页面实际=${JSON.stringify(groupNames)}`)
  }
  else {
    console.log(`  ✓ 按场分组，组名来自后端真数据：${JSON.stringify(groupNames)}`)
  }

  // b) 行文案来自后端真数据（商品名在 BizCartItem 内部 → 跨组件查）
  const itemNames = await deepTexts(cartPage, '.biz-cart-item__name')
  const expectItemNames = cart.groups.flatMap(g => g.items.map(it => it.name))
  const missingItems = expectItemNames.filter(n => !itemNames.includes(n))
  if (missingItems.length) {
    fails.push(
      `这些后端购物车商品名没渲染出来：${JSON.stringify(missingItems)}；页面实际=${JSON.stringify(itemNames)}`
      + '（若页面显示的是别的文案 = 用了前端 mock 数据）',
    )
  }
  else {
    console.log(`  ✓ 购物车行文案来自后端真数据：${JSON.stringify(itemNames)}`)
  }

  // c) ★ 合计：首次进页面默认全选 ⇒ 页面合计必须 == 后端 validAmountCent
  const readTotal = async () => {
    const el = await cartPage.$('.jp-cart-bar__total').catch(() => null)
    return el ? String(await el.text().catch(() => '')).trim() : null
  }
  const total0 = await readTotal()
  const expectTotal0 = yuanOf(cart.validAmountCent)
  if (total0 !== expectTotal0) {
    fails.push(
      `★ 首次进页面（默认全选）合计对不上：页面=${JSON.stringify(total0)}，`
      + `后端 validAmountCent=${cart.validAmountCent} 应显示=${JSON.stringify(expectTotal0)}`,
    )
  }
  else {
    console.log(`  ✓ ★ 合计与后端 validAmountCent 一致：¥${total0}（${cart.validAmountCent} 分）`)
  }

  // d) ★ 底部条只有商品合计一行 —— 渲染结果里不出现另收费用的字样（全包邮 REQ-ORDER-004）
  const barEl = await cartPage.$('.jp-cart-bar').catch(() => null)
  const barText = barEl ? String(await barEl.text().catch(() => '')) : ''
  const barMarkup = barEl ? String(await barEl.wxml().catch(() => '')) : ''
  if (!barEl) {
    fails.push('购物车没有底部固定条 .jp-cart-bar')
  }
  else {
    const forbidden = ['运费', '邮费', '配送费', 'freight']
    const hit = forbidden.filter(w => barText.includes(w) || barMarkup.includes(w))
    if (hit.length) {
      fails.push(
        `★ 底部合计区出现了另收费用的字样 ${JSON.stringify(hit)} —— 拼团全包邮（REQ-ORDER-004），`
        + `只能有「商品合计」一行。底部文案=${JSON.stringify(barText)}`,
      )
    }
    else if (!barText.includes('已包邮')) {
      fails.push(`★ 底部合计旁没有「已包邮」标注（UI:mp.cart 明确要求）：底部文案=${JSON.stringify(barText)}`)
    }
    else {
      console.log('  ✓ ★ 底部只有商品合计一行 + 「已包邮」标注（无第二笔费用）')
    }
  }

  /* ═══ ★ 改数量实时刷新合计 ═════════════════════════════ */

  // 步进器在 BizStepper 内部（再套一层 BizCartItem）→ 跨组件查
  const plus = await deep(cartPage, '.biz-stepper__plus')
  if (!plus) {
    fails.push('购物车行内没有数量步进器 .biz-stepper__plus')
  }
  else {
    await plus.tap()
    await sleep(QTY_SETTLE_MS)
    await screenshot(mp, `${SHOT_DIR}/cart_3_qty.png`)

    // ★ 先确认人还在购物车：mp 的原生 tap 会穿过自定义组件边界冒泡，「＋」一旦不 catchtap
    // 就会连带触发整行的「跳商品详情」。那时数量其实改对了、库也落了，页面断言却全查空，
    // 报出来是「合计没刷新」——症状离病因很远。这条先钉住，后面的失败才读得懂。
    const pathAfterQty = (await mp.currentPage()).path
    if (!pathAfterQty.includes('pages/cart/index')) {
      fails.push(
        `★ 点「＋」改数量把人带离了购物车：当前页=${pathAfterQty}（期望停在 pages/cart/index）`
        + ` —— BizStepper 的加减按钮必须 @tap.stop，否则 tap 冒泡到 BizCartItem 的行点击`,
      )
    }

    const afterQty = readCart()
    const row = afterQty.groups[0]?.items?.[0]
    if (row?.qty !== 2) {
      fails.push(`★ 点 + 号后后端数量=${row?.qty}（期望 2）—— 改数量没落库`)
    }
    const total1 = await readTotal()
    const expectTotal1 = yuanOf(afterQty.validAmountCent)
    if (total1 !== expectTotal1) {
      fails.push(
        `★ 改数量后合计没刷新：页面=${JSON.stringify(total1)}，`
        + `后端 validAmountCent=${afterQty.validAmountCent} 应显示=${JSON.stringify(expectTotal1)}`,
      )
    }
    else if (total1 === total0) {
      fails.push(`★ 改数量后合计与改之前相同（${total1}）—— 合计没跟着数量变`)
    }
    else {
      console.log(`  ✓ ★ 改数量实时刷新合计：¥${total0} → ¥${total1}（后端 qty=${row?.qty}）`)
    }
  }

  /* ═══ ★ 未勾选任何项时「去结算」置灰（两个方向都测）═══ */

  const readCheckoutDisabled = async () => {
    const el = await cartPage.$('.jp-cart-bar__checkout').catch(() => null)
    if (!el) return null
    const cls = String(await el.attribute('class').catch(() => '') || '')
    return /\bis-disabled\b/.test(cls)
  }

  const disabledWhenSelected = await readCheckoutDisabled()
  if (disabledWhenSelected === null) {
    fails.push('底部条没有「去结算」按钮 .jp-cart-bar__checkout')
  }
  else if (disabledWhenSelected) {
    fails.push('★ 有勾选项时「去结算」却是置灰的 —— 白白拦掉成交')
  }

  const allBox = await cartPage.$('.jp-cart-bar__all').catch(() => null)
  if (!allBox) {
    fails.push('底部条没有「全选」框 .jp-cart-bar__all')
  }
  else {
    // 取消全选 → 置灰 + 合计归零
    await allBox.tap()
    await sleep(800)
    const disabledWhenNone = await readCheckoutDisabled()
    if (disabledWhenNone !== true) {
      fails.push('★ 取消全选后「去结算」仍可点 —— AC「未勾选任何项时置灰」不成立')
    }
    const totalNone = await readTotal()
    if (totalNone !== '0') {
      fails.push(`★ 取消全选后合计=${JSON.stringify(totalNone)}（期望 "0"）—— 未勾选的项被算进了合计`)
    }
    await screenshot(mp, `${SHOT_DIR}/cart_4_none_selected.png`)

    // 重新全选 → 恢复可点（反方向：证明置灰不是「永远置灰」）
    await allBox.tap()
    await sleep(800)
    const disabledAgain = await readCheckoutDisabled()
    if (disabledAgain !== false) {
      fails.push('★ 重新全选后「去结算」没恢复可点 —— 置灰逻辑写死了')
    }
    const totalBack = await readTotal()
    if (totalBack === '0') {
      fails.push('★ 重新全选后合计仍是 0 —— 全选没把金额加回来')
    }
    if (disabledWhenNone === true && disabledAgain === false) {
      console.log(`  ✓ ★ 「去结算」闸门双向正确：全不选→置灰(合计 ¥${totalNone})，全选→可点(合计 ¥${totalBack})`)
    }
  }

  /* ═══ 失效项（后端本轮有失效项时才断言）═══════════════ */

  const nowCart = readCart()
  if (nowCart.invalidCount > 0) {
    // 「已失效」蒙层文案在 BizCartItem 内部 → 跨组件查
    const badgeTexts = await deepTexts(cartPage, '.biz-cart-item__mask-text')
    if (!badgeTexts.some(x => x.includes('已失效'))) {
      fails.push(`★ 后端有 ${nowCart.invalidCount} 件失效商品，但页面没渲染「已失效」标 .biz-cart-item__mask-text`)
    }
    const totalWithInvalid = await readTotal()
    const expectValid = yuanOf(nowCart.validAmountCent)
    if (totalWithInvalid !== expectValid) {
      fails.push(
        `★ 有失效项时合计=${JSON.stringify(totalWithInvalid)}，`
        + `期望只算有效项 ${JSON.stringify(expectValid)} —— 失效项被算进了合计`,
      )
    }
    else {
      console.log(`  ✓ ★ ${nowCart.invalidCount} 件失效商品标「已失效」且不计入合计（合计 ¥${totalWithInvalid}）`)
    }
  }
  else {
    console.log('  · 本轮后端购物车无失效项 → 失效项断言未触发（该分支由 self-test 的 negative 用例覆盖）')
  }

  console.log(`  截图 → ${SHOT_DIR}`)
  if (fails.length) throw new Error(`cart 未通过:\n   - ${fails.join('\n   - ')}`)
  console.log('  ✓ 三跳可达购物车 + 加购真落库 + 按场分组 + 合计与后端一致 + 改数量刷新合计 + 去结算闸门双向 + 只有商品合计一行')
}
