/**
 * checkout flow —— 下单确认到支付调起全流程（GZ-JP-204 / UI:mp.order_confirm +
 * UI:mp.order_confirm.summary + FLOW:F-JP-02.step3·step4·step5）。
 *
 * <p>验八件事，对应任务卡 AC + accept #1：</p>
 * <ol>
 *   <li>★ <b>购物车「去结算」真能到确认页</b>（点真按钮，不 reLaunch 直达），且带对了
 *       <b>购物车项 id</b>（不是商品 id）。</li>
 *   <li>★ <b>收货地址</b>：进页面自动选中默认地址；<b>「新增地址」表单能真落库</b>
 *       （flow 直连后端比对地址簿真多了一条），且新地址成为选中项。</li>
 *   <li><b>商品清单只读</b> —— 清单里<b>没有</b> stepper（{@code .biz-stepper__plus}）
 *       与删除；商品名与后端购物车逐字一致（不是前端 mock）。</li>
 *   <li>★★ <b>金额区只有「商品合计」与「实付」两行，无运费</b> —— 渲染产物里既不出现
 *       另收费用的字样，也<b>不出现第三个金额行</b>；且金额 == 后端算出来的 Σ 行金额。</li>
 *   <li>★★ <b>未勾「已阅读不支持退款」不可提交</b>（默认不勾 → 置灰；勾上 → 可点）——
 *       <b>两个方向都测</b>（只测一个方向的话，写成「永远置灰」也能骗过）。</li>
 *   <li>★ <b>提交订单真落库</b> —— 后端订单列表真多了一张单，金额与页面一致。</li>
 *   <li>★ <b>支付走完（dev mock 通道）</b> —— 落到支付结果页，且后端订单
 *       {@code businessStatus} 真的转 {@code paid}、商品行进入履约起点。</li>
 *   <li>★ <b>下单后购物车被清空</b>（后端 105 的 deleteItems）—— 客人不会看到已经买过的东西还躺在车里。</li>
 * </ol>
 *
 * <p><b>需要登录态</b>：购物车 / 地址 / 下单三组端点都无 &#64;SaIgnore。flow 走真实登录路径
 * （{@code loginIfNeeded} → 协议 sheet → 勾选 → wxMOCK 登录），不后门注 storage。</p>
 *
 * <p><b>取数 / 治具与断言分离</b>（同 cart flow）：{@link run} 负责登录、拿 token、造起点，
 * {@link runWith} 只做断言并通过注入的后端读写函数取数 —— 于是 self-test.mjs 能<b>零环境依赖</b>
 * 把断言逻辑跑一遍（喂假后端），而不是在 flow 里埋测试用环境变量后门。</p>
 */
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { deepAll, deepTexts, gotoPage, loginIfNeeded, readAppToken, screenshot, sleep, SHOT_DIR } from '../mp-e2e.mjs'

/** 后端地址（与 preflight / dist 的 VITE_SERVER_BASEURL 一致）。 */
const BACKEND = process.env.MP_BACKEND || 'http://localhost:8080'
/** 本小程序 clientid（.env 的 VITE_APP_CLIENT_ID；后端按它路由 appid 配置）。 */
const CLIENT_ID = 'mp-applet-gz-jp'
/** 提交订单 + mock 支付回调 + redirectTo 结果页 + 首轮轮询的总耗时预算。 */
const SUBMIT_SETTLE_MS = 6000
/** 支付结果页轮询间隔（src/pages/order/result.logic.ts 的 POLL_INTERVAL_MS）× 余量。 */
const RESULT_SETTLE_MS = 4000

/**
 * 直连后端（curl 而非 node fetch：本机 clash 代理会吞 localhost，
 * 与 preflight.mjs / cart.mjs 用同一套 `--noproxy '*'` 写法）。
 */
function api(method, pathAndQuery, token = '', body = null) {
  const auth = token ? ` -H 'Authorization: Bearer ${token}'` : ''
  const data = body === null
    ? ''
    : ` -H 'Content-Type: application/json' -d ${JSON.stringify(JSON.stringify(body))}`
  const out = execSync(
    `curl -s --noproxy '*' -m 15 -X ${method} '${BACKEND}${pathAndQuery}' -H 'clientid: ${CLIENT_ID}'${auth}${data}`,
    { encoding: 'utf8' },
  )
  try {
    return JSON.parse(out)
  }
  catch {
    throw new Error(`后端 ${method} ${pathAndQuery} 返回的不是 JSON：${out.slice(0, 200)}`)
  }
}

/** 分 → 元的纯数字串（与 formatYuan 同口径独立重算，不 import 被测实现）。 */
function yuanOf(cent) {
  const y = Number(cent) / 100
  return Number.isInteger(y) ? String(y) : y.toFixed(2)
}

/**
 * 取一组元素的文本，trim 后返回数组。
 *
 * <p>⚠️ 只对<b>页面模板里</b>的选择器有效。组件内部的（`.biz-*` / `.jp-event-card` 等）
 * 必须用 mp-e2e 的 {@code deepTexts}/{@code deepAll} —— {@code page.$$} 不跨组件边界，
 * 查不到时返回空数组，会把「不该存在」的断言变成恒真。</p>
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

/** 元素 class 里有没有 is-disabled。 */
async function isDisabled(page, selector) {
  const el = await page.$(selector).catch(() => null)
  if (!el) return null
  const cls = String(await el.attribute('class').catch(() => '') || '')
  return /\bis-disabled\b/.test(cls)
}

/**
 * flow 入口：登录 → 拿 token → 造确定性起点（清空车 + 加购一件）→ 交给 {@link runWith} 断言。
 */
export async function run(mp) {
  // ── 0. 登录（下单三组端点都需登录态；走真实路径，顺带守协议合规闸门）
  if (!await loginIfNeeded(mp)) {
    throw new Error('登录失败 —— 购物车 / 地址 / 下单端点都需登录，本 flow 无从走起（查后端 wxMOCK 通道 / clientid 配置）')
  }
  const token = await readAppToken(mp)
  if (!token) {
    throw new Error('取不到 app 持有的 sa-token（storage key="token"）—— 无法用同一用户身份直连后端比对')
  }
  console.log(`  ✓ 已登录，取到 app 的 token（${token.length} 字符）`)

  // ── 1. 后端 fixture：一个可下单的场 + 一件在架商品
  const listJson = api('GET', '/app/gz/jp/event/list?pageNum=1&pageSize=20', token)
  const events = (Array.isArray(listJson.rows) ? listJson.rows : []).filter(e => e.status === 'open')
  if (!events.length) {
    throw new Error(
      '后端没有 open 的场 —— 加购无从走起（下单要求场仍 open）。'
      + '请先在 dev 库造一个 open 场（GZ-JP-101 admin 建场并开场）。',
    )
  }
  let product = null
  for (const ev of events) {
    const pj = api('GET', `/app/gz/jp/product/list?eventId=${encodeURIComponent(ev.id)}&pageNum=1&pageSize=20`, token)
    const rows = Array.isArray(pj.rows) ? pj.rows : []
    if (rows.length) {
      product = { ...rows[0], eventName: ev.name }
      break
    }
  }
  if (!product) {
    throw new Error('open 场里 0 件在架商品 —— 加购无从走起（GZ-JP-102 admin 建商品并上架）')
  }
  console.log(`  后端 fixture：场=${JSON.stringify(product.eventName)} 商品=${JSON.stringify(product.name)} 单价=${product.priceCent}分`)

  // ── 2. 后端读写治具（用 app 那个会话的 token —— 换个会话看到的就不是页面上这辆车/这批地址了）
  const readCart = () => {
    const res = api('GET', '/app/gz/jp/cart/list', token)
    if (res.code !== 200 || !res.data) {
      throw new Error(`后端 cart/list 取不到（code=${res.code} msg=${res.msg}）—— token 失效？`)
    }
    return res.data
  }
  const clearCart = () => {
    const ids = readCart().groups.flatMap(g => g.items.map(it => it.id))
    if (ids.length) api('DELETE', `/app/gz/jp/cart/${ids.join(',')}`, token)
    return ids.length
  }
  const addToCart = (productId, qty) => {
    const res = api('POST', '/app/gz/jp/cart', token, { productId: String(productId), qty })
    if (res.code !== 200) throw new Error(`加购治具失败（code=${res.code} msg=${res.msg}）`)
    return res.data
  }
  const readAddresses = () => {
    const res = api('GET', '/app/gz/user/address/list', token)
    if (res.code !== 200) throw new Error(`后端 address/list 取不到（code=${res.code} msg=${res.msg}）`)
    return res.data ?? []
  }
  const readOrders = () => {
    const res = api('GET', '/app/gz/jp/order/list?pageNum=1&pageSize=5', token)
    return { total: Number(res.total ?? 0), rows: Array.isArray(res.rows) ? res.rows : [] }
  }
  const readOrderDetail = (orderId) => {
    const res = api('GET', `/app/gz/jp/order/${orderId}`, token)
    return res.code === 200 ? res.data : null
  }

  // ── 3. 确定性起点：空车 → 加购 2 件（数量 > 1 才能验「清单显示 ×2」与「合计 = 单价 × 数量」）
  const cleared = clearCart()
  addToCart(product.id, 2)
  console.log(`  ✓ 起点：清掉 ${cleared} 款残留后加购「${product.name}」× 2`)

  return runWith(mp, {
    product,
    readCart,
    readAddresses,
    readOrders,
    readOrderDetail,
  })
}

/**
 * 断言主体。
 *
 * @param mp   automator 句柄
 * @param data {{product, readCart, readAddresses, readOrders, readOrderDetail}}
 *             —— 全部是<b>后端真读</b>（self-test 里换成假实现，断言逻辑一字不改地跑一遍）
 */
export async function runWith(mp, { product, readCart, readAddresses, readOrders, readOrderDetail }) {
  mkdirSync(SHOT_DIR, { recursive: true })
  const fails = []

  const cartBefore = readCart()
  if (!cartBefore.itemCount) {
    throw new Error('起点购物车是空的 —— 治具没生效，后续断言不可信')
  }
  const ordersBefore = readOrders()

  /* ═══ 第 1 跳：购物车 →「去结算」→ 下单确认页（真按钮，不 reLaunch 直达）═══ */

  const cartPage = await gotoPage(mp, '/pages/cart/index', 2500)
  const checkoutBtn = await cartPage.$('.jp-cart-bar__checkout').catch(() => null)
  if (!checkoutBtn) {
    throw new Error('购物车没有「去结算」按钮 .jp-cart-bar__checkout —— 确认页的入口不存在')
  }
  const checkoutCls = String(await checkoutBtn.attribute('class').catch(() => '') || '')
  if (/\bis-disabled\b/.test(checkoutCls)) {
    throw new Error(
      `购物车「去结算」是置灰态（class=${JSON.stringify(checkoutCls)}）—— 起点车里应有可勾选的有效商品。`
      + '（fixture 的场是不是刚被关了？）',
    )
  }
  await checkoutBtn.tap()
  await sleep(3000)

  const confirmPage = await mp.currentPage()
  if (confirmPage?.path !== 'pages/order/confirm') {
    throw new Error(
      `第 1 跳失败：点「去结算」后落在 ${JSON.stringify(confirmPage?.path)}，期望 "pages/order/confirm"`,
    )
  }
  // ★ 带过去的必须是【购物车项 id】不是商品 id（后端 selectByUserAndIds 收的就是这组）
  const expectCartItemIds = cartBefore.groups.flatMap(g => g.items.map(it => String(it.id)))
  // automator 的 Page 暴露的是 query（不是 options）—— onLoad 的入参在 automator 侧叫 query
  const gotIds = String(confirmPage?.query?.ids ?? '').split(',').filter(Boolean)
  if (!gotIds.length) {
    fails.push('★ 确认页没收到 ids 参数 —— 购物车「去结算」没把勾选项带过来')
  }
  else if (gotIds.some(id => !expectCartItemIds.includes(id))) {
    fails.push(
      `★ 确认页收到的 ids=${JSON.stringify(gotIds)} 不是购物车项 id（后端车里的是 ${JSON.stringify(expectCartItemIds)}）`
      + ' —— 传成商品 id 了？后端 selectByUserAndIds 收的是购物车项 id',
    )
  }
  else {
    console.log(`  ✓ ★ 第 1 跳：购物车 →「去结算」→ 下单确认页，带的是购物车项 id ${JSON.stringify(gotIds)}`)
  }
  await screenshot(mp, `${SHOT_DIR}/checkout_1_confirm.png`)

  /* ═══ 收货地址（AC：地址必选）═══════════════════════════ */

  const addrsBefore = readAddresses()
  const addrCard = await confirmPage.$('.jp-confirm-addr').catch(() => null)
  if (!addrCard) {
    fails.push('确认页没有收货地址区 .jp-confirm-addr')
  }
  else if (addrsBefore.length) {
    // 地址簿非空 → 进页面应自动选中默认地址（省得每次都点一遍）
    const nameEl = await confirmPage.$('.jp-confirm-addr__name').catch(() => null)
    const shownName = nameEl ? String(await nameEl.text().catch(() => '')).trim() : ''
    const expectDefault = addrsBefore.find(a => Number(a.isDefault) === 1) ?? addrsBefore[0]
    if (shownName !== String(expectDefault.recipientName)) {
      fails.push(
        `★ 进页面默认选中的地址对不上：页面=${JSON.stringify(shownName)}，`
        + `后端默认地址收件人=${JSON.stringify(expectDefault.recipientName)}`,
      )
    }
    else {
      console.log(`  ✓ 自动选中默认收货地址：${shownName}`)
    }
  }

  // ★ 新增地址：走真表单 → 真落库 → 成为选中项
  const stamp = String(Date.now()).slice(-6)
  const newName = `E2E收${stamp}`
  const newMobile = `139${String(Date.now()).slice(-8)}`
  const newDetail = `E2E 测试路 ${stamp} 号`
  await addrCard?.tap()
  await sleep(1200)

  // 地址簿非空时先落在「选择」层，要再点一次「新增收货地址」
  const addBtn = await confirmPage.$('.jp-addr-sheet__add').catch(() => null)
  if (addBtn) {
    await addBtn.tap()
    await sleep(800)
  }

  const nameInput = await confirmPage.$('.jp-addr-form__name').catch(() => null)
  const mobileInput = await confirmPage.$('.jp-addr-form__mobile').catch(() => null)
  const regionPicker = await confirmPage.$('.jp-addr-form__region').catch(() => null)
  const detailInput = await confirmPage.$('.jp-addr-form__detail').catch(() => null)
  const saveBtn = await confirmPage.$('.jp-addr-form__save').catch(() => null)

  if (!nameInput || !mobileInput || !regionPicker || !detailInput || !saveBtn) {
    fails.push(
      '★ 新增地址表单不完整（缺 '
      + [
        !nameInput && '.jp-addr-form__name',
        !mobileInput && '.jp-addr-form__mobile',
        !regionPicker && '.jp-addr-form__region',
        !detailInput && '.jp-addr-form__detail',
        !saveBtn && '.jp-addr-form__save',
      ].filter(Boolean).join(' / ')
      + '）—— AC 要求确认页能「选择/新增」收货地址',
    )
  }
  else {
    await nameInput.input(newName)
    await mobileInput.input(newMobile)
    // region 是原生 picker（点开是系统选择器，automator 点不动）→ 直接派发它的 change 事件，
    // 走的仍是页面自己的 onRegionChange，不是绕过页面逻辑往 store 里塞值
    await regionPicker.trigger('change', { value: ['四川省', '成都市', '锦江区'] })
    await sleep(300)
    await detailInput.input(newDetail)
    await sleep(300)
    await saveBtn.tap()
    await sleep(2500)

    // ★ 真落库：后端地址簿真多了一条
    const addrsAfter = readAddresses()
    const created = addrsAfter.find(a => String(a.recipientName) === newName)
    if (!created) {
      fails.push(
        `★ 点了「保存并使用」但后端地址簿里没有新地址「${newName}」`
        + `（保存前 ${addrsBefore.length} 条，保存后 ${addrsAfter.length} 条）—— 新增地址没真正落库`,
      )
    }
    else if (String(created.detail) !== newDetail || String(created.mobile) !== newMobile) {
      fails.push(
        `★ 新地址落库了但字段对不上：detail=${JSON.stringify(created.detail)}（期望 ${JSON.stringify(newDetail)}）`
        + ` mobile=${JSON.stringify(created.mobile)}（期望 ${JSON.stringify(newMobile)}）`,
      )
    }
    else {
      // 保存后应立刻成为选中项（客人刚填完就该看到它生效）
      const nameEl2 = await confirmPage.$('.jp-confirm-addr__name').catch(() => null)
      const shown2 = nameEl2 ? String(await nameEl2.text().catch(() => '')).trim() : ''
      if (shown2 !== newName) {
        fails.push(`★ 新增地址后确认页显示的仍是 ${JSON.stringify(shown2)}，期望立刻切成新地址 ${JSON.stringify(newName)}`)
      }
      else {
        console.log(`  ✓ ★ 新增收货地址真落库并立刻选中：${newName} / ${newMobile} / ${newDetail}`)
      }
    }
  }
  await screenshot(mp, `${SHOT_DIR}/checkout_2_address.png`)

  /* ═══ 商品清单（只读）═══════════════════════════════════ */

  const cart = readCart()
  const expectNames = cart.groups.flatMap(g => g.items.map(it => it.name))
  // 商品名在 BizCartItem 内部 → 必须跨组件查
  const itemNames = await deepTexts(confirmPage, '.biz-cart-item__name')
  const missing = expectNames.filter(n => !itemNames.includes(n))
  if (missing.length) {
    fails.push(
      `这些后端购物车商品名没渲染进清单：${JSON.stringify(missing)}；页面实际=${JSON.stringify(itemNames)}`
      + '（若显示的是别的文案 = 用了前端 mock 数据）',
    )
  }
  else {
    console.log(`  ✓ 商品清单文案来自后端真数据：${JSON.stringify(itemNames)}`)
  }

  // ★ 只读：清单里不该有数量步进器与删除（确认页没有再改数量的语义）。
  //   ⚠️ 必须跨组件查：直接 page.$$('.biz-stepper__plus') 恒为空数组 ⇒ 这条断言会永远「通过」，
  //      即便页面上真的有 stepper（selector 不跨组件边界的典型坑）。
  //   先验一条正向锚点（.biz-cart-item__ops = BizCartItem 里装 stepper+删除的容器，
  //   readonly 时 v-else 掉）—— 有它才说明 deep 查询确实能看见组件内部。
  const opsBoxes = await deepAll(confirmPage, '.biz-cart-item__ops')
  const steppers = await deepAll(confirmPage, '.biz-stepper__plus')
  const dels = await deepAll(confirmPage, '.biz-cart-item__del')
  const qtyTexts = await deepTexts(confirmPage, '.biz-cart-item__qty-text')
  if (!qtyTexts.length) {
    fails.push(
      '★ 清单里没有只读数量文案 .biz-cart-item__qty-text —— 要么 readonly 没生效，'
      + '要么跨组件查询失效（后者会让下面「无 stepper / 无删除」变成恒真的空断言）',
    )
  }
  if (opsBoxes.length || steppers.length || dels.length) {
    fails.push(
      `★ 确认页的商品清单不是只读的：操作区 ${opsBoxes.length} 个 / 步进器 ${steppers.length} 个`
      + ` / 删除 ${dels.length} 个（要改数量或删除请回购物车）`,
    )
  }
  else if (qtyTexts.length) {
    console.log(`  ✓ 商品清单是只读的（无操作区 / 无 stepper / 无删除，数量静态展示 ${JSON.stringify(qtyTexts)}）`)
  }

  /* ═══ ★★ 金额区：只有「商品合计」与「实付」两行，无运费 ═══ */

  const sumEl = await confirmPage.$('.jp-confirm-sum').catch(() => null)
  const expectAmount = cart.groups.flatMap(g => g.items).reduce((s, it) => s + Number(it.amountCent || 0), 0)
  if (!sumEl) {
    fails.push('确认页没有金额区 .jp-confirm-sum')
  }
  else {
    const sumText = String(await sumEl.text().catch(() => ''))
    const sumMarkup = String(await sumEl.wxml().catch(() => ''))
    const forbidden = ['运费', '邮费', '配送费', '快递费', 'freight', 'shipping']
    const hit = forbidden.filter(w => sumText.includes(w) || sumMarkup.includes(w))
    if (hit.length) {
      fails.push(
        `★★ 金额区出现了另收费用的字样 ${JSON.stringify(hit)} —— 拼团全包邮（REQ-ORDER-004），`
        + `只能有「商品合计」与「实付」两行。金额区文案=${JSON.stringify(sumText)}`,
      )
    }
    // ★ 结构上也只允许两行（光 grep 文案挡不住「其它费用 ¥0」这种起了别的名字的第三行）
    const rows = await confirmPage.$$('.jp-confirm-sum__row').catch(() => [])
    if (rows.length !== 2) {
      fails.push(
        `★★ 金额区有 ${rows.length} 行（期望恰好 2 行：商品合计 + 实付）`
        + ` —— 金额区文案=${JSON.stringify(sumText)}`,
      )
    }
    if (!sumText.includes('商品合计') || !sumText.includes('实付')) {
      fails.push(`★ 金额区缺「商品合计」或「实付」标签：${JSON.stringify(sumText)}`)
    }
    // 金额与后端 Σ 行金额一致
    const totalEl = await confirmPage.$('.jp-confirm-sum__total').catch(() => null)
    const totalText = totalEl ? String(await totalEl.text().catch(() => '')).trim() : null
    if (totalText !== yuanOf(expectAmount)) {
      fails.push(
        `★ 实付金额对不上：页面=${JSON.stringify(totalText)}，`
        + `后端 Σ 行金额=${expectAmount} 分应显示=${JSON.stringify(yuanOf(expectAmount))}`,
      )
    }
    else if (rows.length === 2 && !hit.length) {
      console.log(`  ✓ ★★ 金额区只有商品合计与实付两行、无运费，实付 ¥${totalText}（${expectAmount} 分）`)
    }
  }

  /* ═══ ★★「已阅读不支持退款」闸门（两个方向都测）═══════ */

  const agreeBox = await confirmPage.$('.jp-confirm-agree__box-wrap').catch(() => null)
  const agreeText = await confirmPage.$('.jp-confirm-agree__text').catch(() => null)
  if (!agreeBox || !agreeText) {
    fails.push(
      '★★ 确认页没有「已阅读不支持退款」勾选（.jp-confirm-agree__box-wrap / __text）——'
      + ' design-options/mp-product-detail.md 方案 A 的配套举证手段，Kevin 2026-08-06 明确要求',
    )
  }
  else {
    const agreeCopy = String(await agreeText.text().catch(() => '')).trim()
    if (!agreeCopy.includes('退款')) {
      fails.push(`★ 勾选文案里没提「退款」：${JSON.stringify(agreeCopy)} —— 举证的正是「知悉不支持退款」`)
    }

    // 方向 1：默认不勾 → 提交置灰
    const disabledBefore = await isDisabled(confirmPage, '.jp-confirm-bar__submit')
    if (disabledBefore !== true) {
      fails.push('★★ 没勾「已阅读不支持退款」时「提交订单」却是可点的 —— 举证闸门形同虚设')
    }
    await screenshot(mp, `${SHOT_DIR}/checkout_3_not_agreed.png`)

    // 方向 2：勾上 → 恢复可点（证明不是「永远置灰」）
    await agreeBox.tap()
    await sleep(800)
    const disabledAfter = await isDisabled(confirmPage, '.jp-confirm-bar__submit')
    if (disabledAfter !== false) {
      fails.push('★★ 勾上「已阅读不支持退款」后「提交订单」仍置灰 —— 闸门写死了，谁也下不了单')
    }
    if (disabledBefore === true && disabledAfter === false) {
      console.log('  ✓ ★★ 「已阅读不支持退款」闸门双向正确：未勾→置灰，勾上→可点')
    }
  }
  await screenshot(mp, `${SHOT_DIR}/checkout_4_agreed.png`)

  // 勾选没生效就别往下走了：后面全是基于「能提交」的断言，会连锁报一堆假问题
  if (fails.some(f => f.includes('闸门') || f.includes('已阅读'))) {
    throw new Error(`checkout 未通过:\n   - ${fails.join('\n   - ')}`)
  }

  /* ═══ ★ 提交订单 → 支付（dev mock 通道）═══════════════ */

  const submitBtn = await confirmPage.$('.jp-confirm-bar__submit').catch(() => null)
  if (!submitBtn) {
    throw new Error('确认页没有「提交订单」按钮 .jp-confirm-bar__submit')
  }
  await submitBtn.tap()
  await sleep(SUBMIT_SETTLE_MS)
  await screenshot(mp, `${SHOT_DIR}/checkout_5_submitted.png`)

  // ★ 订单真落库
  const ordersAfter = readOrders()
  if (ordersAfter.total !== ordersBefore.total + 1) {
    fails.push(
      `★ 点了「提交订单」但后端订单总数 ${ordersBefore.total} → ${ordersAfter.total}（期望 +1）`
      + ' —— 订单没真正落库（提交请求失败了？看页面 toast）',
    )
  }
  const newOrder = ordersAfter.rows[0]
  if (newOrder && Number(newOrder.totalAmountCent) !== expectAmount) {
    fails.push(
      `★ 落库订单金额=${newOrder.totalAmountCent} 分，与确认页显示的 ${expectAmount} 分不一致`
      + '（后端重算金额与前端展示对不上 = 客人看到的价 ≠ 实际扣款）',
    )
  }
  if (newOrder) {
    console.log(`  ✓ ★ 提交订单真落库：${newOrder.orderNo} 实付 ${newOrder.totalAmountCent} 分 款数=${newOrder.itemCount}`)
  }

  // ★ 落到支付结果页
  const resultPage = await mp.currentPage()
  if (resultPage?.path !== 'pages/order/result') {
    fails.push(
      `★ 提交后没落到支付结果页：当前=${JSON.stringify(resultPage?.path)}，期望 "pages/order/result"`,
    )
  }
  else {
    console.log('  ✓ ★ 提交后落到支付结果页 pages/order/result')
  }

  // ★ dev mock 通道走完结算：后端订单真的转 paid、商品行进入履约起点
  await sleep(RESULT_SETTLE_MS)
  const detail = newOrder ? readOrderDetail(newOrder.id) : null
  if (!detail) {
    fails.push('★ 拉不到刚下的订单详情 —— 无法确认支付是否走完')
  }
  else if (detail.businessStatus !== 'paid') {
    fails.push(
      `★★ 支付没走完：订单 ${detail.orderNo} businessStatus=${JSON.stringify(detail.businessStatus)}（期望 "paid"）。`
      + 'dev mock 通道应通过 /app/gz/test/pay/simulate-callback 驱动真实结算链路 —— '
      + '检查 VITE_MOCK_PAY / gz.test.enabled / gz.pay.client-mode=mock',
    )
  }
  else {
    const fulfills = (detail.items ?? []).map(i => i.fulfillStatus)
    if (fulfills.some(s => s !== 'purchasing')) {
      fails.push(`★ 支付回调后商品行履约状态=${JSON.stringify(fulfills)}，期望全部 "purchasing"（FLOW:F-JP-02.step6）`)
    }
    else {
      console.log(`  ✓ ★★ mock 支付走完结算：订单=${detail.businessStatusLabel}(paid) 付款时间=${detail.paidTime} 商品行=${JSON.stringify(fulfills)}`)
    }
  }

  // 结果页显示的应是「支付成功」而不是永远转圈
  if (resultPage?.path === 'pages/order/result') {
    // 结果页文案在 BizState 组件内部 → 跨组件查
    const resText = await deepTexts(resultPage, '.biz-state__text')
    if (!resText.some(x => x.includes('支付成功'))) {
      fails.push(
        `★ 支付结果页没显示「支付成功」：实际=${JSON.stringify(resText)}`
        + '（后端已 paid 却还在转圈 = 轮询没把状态读回来）',
      )
    }
    else {
      console.log(`  ✓ 支付结果页显示：${JSON.stringify(resText)}`)
    }
    // 出口按钮必须在（AC：支付成功跳订单详情）
    const detailCta = await resultPage.$('.jp-payres__btn').catch(() => null)
    if (!detailCta) {
      fails.push('★ 支付结果页没有出口按钮 .jp-payres__btn —— 客人卡在结果页出不去')
    }
  }
  await screenshot(mp, `${SHOT_DIR}/checkout_6_paid.png`)

  // ★ 下单后购物车被后端清空（105 的 deleteItems）
  const cartAfter = readCart()
  if (cartAfter.itemCount !== 0) {
    fails.push(
      `★ 下单后购物车还剩 ${cartAfter.itemCount} 款（期望 0）—— 后端下单事务里的清车没生效，`
      + '客人会看到已经买过的东西还躺在车里',
    )
  }
  else {
    console.log('  ✓ ★ 下单后购物车已清空')
  }

  console.log(`  截图 → ${SHOT_DIR}`)
  if (fails.length) throw new Error(`checkout 未通过:\n   - ${fails.join('\n   - ')}`)
  console.log(
    '  ✓ 去结算带对购物车项 id + 地址选择/新增真落库 + 清单只读 + 金额两行无运费'
    + ' + 已阅读闸门双向 + 提交真落库 + mock 支付走完结算 + 车已清空',
  )
}
