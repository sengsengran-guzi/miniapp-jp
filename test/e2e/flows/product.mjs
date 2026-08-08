/**
 * product flow —— 场详情 + 商品详情（GZ-JP-202 / UI:mp.event_detail + UI:mp.product_detail）。
 *
 * <p>验四件事，对应任务卡 AC：</p>
 * <ol>
 *   <li>★ <b>从首页两跳可达商品详情</b> —— 真点：首页场卡 →(1)→ 场详情 → 商品卡 →(2)→ 商品详情。
 *       不是 reLaunch 直达，跳的是<b>业务主线真入口</b>（reLaunch 只能证明页面存在，证明不了有人能走到）</li>
 *   <li><b>场详情</b>：页头场名 + 商品网格文案都来自后端真数据（flow 自己直连后端比对）；
 *       页头「已结束」提示条的出现与否必须与后端 {@code status} 一致</li>
 *   <li><b>商品详情</b>：名称 / 价格 / <b>「包邮」标识</b> / 预计到货 / ★ 注意事项，
 *       且 <b>注意事项节点在 CTA 节点之前</b>（甲方硬要求「在 CTA 之上」）、
 *       正文与后端 {@code noticeText} <b>逐字一致</b>（= 没有被截断）</li>
 *   <li>★ <b>加购置灰状态 == 后端 eventBookable</b> —— 不是「按钮存在」这种恒真断言，
 *       而是把 UI 状态和后端字段<b>绑死</b>：场已结束却还能点 → fail；场进行中却置灰 → 同样 fail</li>
 * </ol>
 *
 * <p><b>为什么要在 flow 里再拉一次后端</b>（同 home flow）：光断言「页面上有卡片」证明不了数据是真的
 * （前端塞一个假数组同样有卡片）。拉后端当<b>独立数据源</b>比对，才是「不是前端 mock」的直接证据。
 * 首页哪张卡排第一也在这里<b>独立重算</b>（不 import 页面的 index.logic）—— 测试的 oracle 要独立于
 * 被测实现，否则实现和断言一起写错就一起绿。</p>
 *
 * <p>不需要登录态：场与商品后端都 &#64;SaIgnore 匿名可读（游客优先 / 按需登录）。</p>
 */
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { deep, deepWait, deepTexts, gotoPage, screenshot, sleep, SHOT_DIR } from '../mp-e2e.mjs'

/** 后端地址（与 preflight / dist 的 VITE_SERVER_BASEURL 一致）。 */
const BACKEND = process.env.MP_BACKEND || 'http://localhost:8080'
/** 本小程序 clientid（.env 的 VITE_APP_CLIENT_ID；后端按它路由 appid 配置）。 */
const CLIENT_ID = 'mp-applet-gz-jp'
/** 与页面 EVENT_PRODUCT_PAGE_SIZE 一致（对齐首屏渲染条数，否则卡片数天然对不上）。 */
const PRODUCT_PAGE_SIZE = 20

/** 展示顺序：进行中置顶（Kevin 拍板，与首页一致）。 */
const GROUP_ORDER = ['live', 'upcoming', 'ended']

/**
 * 直连后端（curl 而非 node fetch：本机 clash 代理会吞 localhost，
 * 与 preflight.mjs / home.mjs 用同一套 `--noproxy '*'` 写法）。
 */
function getJson(pathAndQuery) {
  const body = execSync(
    `curl -s --noproxy '*' -m 8 '${BACKEND}${pathAndQuery}' -H 'clientid: ${CLIENT_ID}'`,
    { encoding: 'utf8' },
  )
  try {
    return JSON.parse(body)
  }
  catch {
    throw new Error(`后端 ${pathAndQuery} 返回的不是 JSON：${body.slice(0, 200)}`)
  }
}

/**
 * 独立重算「这场属于哪一组」—— 刻意不 import src 里的实现（oracle 要独立于被测代码）。
 * 口径见 doc/jp/tickets/_visibility-extension-pre-201.md「前端契约要点」。
 */
function classify(event, nowMs) {
  if (!event || event.status !== 'open') return 'ended'
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(event.startTime || '').trim())
  if (!m) return 'live' // 时间解析不出来时 status 才是权威 → 当进行中
  const start = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime()
  return start > nowMs ? 'upcoming' : 'live'
}

/**
 * 首页上<b>排在第一张</b>的是哪个场 —— 独立重算（分组顺序 live → upcoming → ended，组内保持后端顺序）。
 * 点「第一张场卡」就是点它，所以场详情页头的场名必须等于它。
 */
function firstCardEvent(events, nowMs) {
  for (const key of GROUP_ORDER) {
    const hit = events.find(e => classify(e, nowMs) === key)
    if (hit) return hit
  }
  return null
}

/**
 * flow 入口：拉后端真数据 → 交给 {@link runWith} 做断言。
 *
 * <p>「取数」与「断言」分成两个函数，是为了让 self-test.mjs 能<b>零环境依赖</b>地把断言逻辑跑一遍
 * （直接喂假的 backend 数据），不需要真起后端 —— 而不是在 flow 里埋「测试用环境变量后门」。</p>
 */
export async function run(mp) {
  const listJson = getJson('/app/gz/jp/event/list?pageNum=1&pageSize=20')
  if (!Array.isArray(listJson.rows)) {
    throw new Error(`后端 event/list 没有 rows 数组（契约变了？）：${JSON.stringify(listJson).slice(0, 200)}`)
  }
  const events = listJson.rows
  const target = firstCardEvent(events, Date.now())
  if (!target) {
    throw new Error(
      '后端 event/list 返回 0 条场 —— 本 flow 的入口（点首页第一张场卡）无从走起。'
      + '请先在 dev 库造一个 open 场（GZ-JP-101 admin 建场并开场），或确认 gz_jp_event 的 fixture 还在。',
    )
  }

  const prodJson = getJson(`/app/gz/jp/product/list?eventId=${encodeURIComponent(target.id)}&pageNum=1&pageSize=${PRODUCT_PAGE_SIZE}`)
  const products = Array.isArray(prodJson.rows) ? prodJson.rows : []
  console.log(`  后端 event/list → 首张卡 = ${JSON.stringify(target.name)} (id=${target.id}, status=${target.status})`)
  console.log(`  后端 product/list?eventId=${target.id} → ${products.length}/${prodJson.total} 条：${products.map(p => p.name).join(' / ') || '(空)'}`)

  // 商品详情用详情接口的数据（★ 图集与 noticeText 只有详情接口下发，列表接口图集恒为空数组）
  let detail = null
  if (products.length) {
    const d = getJson(`/app/gz/jp/product/${encodeURIComponent(products[0].id)}`)
    if (d.code !== 200 || !d.data) {
      throw new Error(`后端 product/${products[0].id} 详情取不到（code=${d.code} msg=${d.msg}）—— 列表能查到详情却 fail，契约不一致`)
    }
    detail = d.data
  }

  return runWith(mp, { event: target, products, detail })
}

/**
 * 断言主体。
 *
 * @param mp   automator 句柄
 * @param data {{event, products, detail}} 后端真数据（**独立数据源**，证明页面不是前端 mock）
 */
export async function runWith(mp, { event, products, detail }) {
  mkdirSync(SHOT_DIR, { recursive: true })

  if (!products.length || !detail) {
    throw new Error(
      `后端场「${event.name}」(id=${event.id}) 里 0 件在架商品 —— 「两跳可达商品详情」无从验证。`
      + '请先在 dev 库给该场造一个 on_shelf 商品（GZ-JP-102 admin 建商品并上架）。',
    )
  }

  const fails = []

  /* ═══ 第 1 跳：首页 → 场详情 ═══════════════════════════ */

  const home = await gotoPage(mp, '/pages/index/index', 2500)
  // ★ 场卡 / 商品卡都是自定义组件（BizEventCard / BizProductCard）→ 一律 deep()：
  //   page.$('.jp-event-card') 恒为 null（SelectorQuery 不跨组件边界），
  //   下面「点第一张卡」的两跳会以「入口不存在」的面目挂掉，看着像页面没渲染。
  const eventCard = await deepWait(home, '.jp-event-card')
  if (!eventCard) {
    throw new Error('首页没有场卡 .jp-event-card —— 第 1 跳的入口不存在（先看 home flow）')
  }
  await eventCard.tap()
  await sleep(2500)

  const eventPage = await mp.currentPage()
  if (eventPage?.path !== 'pages/event/index') {
    throw new Error(
      `第 1 跳失败：点首页场卡后落在 ${JSON.stringify(eventPage?.path)}，期望 "pages/event/index"`
      + '（首页 buildEventRoute 的路径与场详情页文件名对不上？）',
    )
  }
  console.log('  ✓ 第 1 跳：首页场卡 → 场详情（pages/event/index）')
  await screenshot(mp, `${SHOT_DIR}/product_1_event_detail.png`)

  /* ═══ 场详情断言 ═══════════════════════════════════════ */

  const headName = await eventPage.$('.jp-event-detail__name').catch(() => null)
  const headNameText = headName ? String(await headName.text().catch(() => '')).trim() : ''
  if (headNameText !== event.name) {
    fails.push(
      `场详情页头场名对不上：页面=${JSON.stringify(headNameText)}，后端=${JSON.stringify(event.name)}`
      + '（页面显示别的文案 = 用了前端 mock 数据；或首页第一张卡不是这个场，看 home flow 的分组断言）',
    )
  }
  else {
    console.log(`  ✓ 场详情页头场名来自后端真数据：${JSON.stringify(headNameText)}`)
  }

  // ★ 「已结束」提示条的出现与否必须与后端 status 绑死（不是「有就行」）
  const endedBar = await eventPage.$('.jp-event-detail__ended-text').catch(() => null)
  const shouldShowEnded = event.status === 'closed'
  if (shouldShowEnded && !endedBar) {
    fails.push('后端 status=closed 但场详情没渲染「本场已结束」提示条 .jp-event-detail__ended-text')
  }
  if (!shouldShowEnded && endedBar) {
    fails.push(`后端 status=${event.status}（未结束）却渲染了「本场已结束」提示条 —— 会误导客人不敢下单`)
  }
  console.log(`  ✓ 已结束提示条与后端 status=${event.status} 一致（${endedBar ? '已渲染' : '未渲染'}）`)

  // 商品网格文案来自后端真数据（卡片标题在 BizProductCard 内部 → 跨组件查）
  const gridNames = await deepTexts(eventPage, '.jp-product-card__name')
  if (gridNames.length !== products.length) {
    fails.push(
      `商品卡数对不上：页面 ${gridNames.length} 张，后端首页 ${products.length} 条`
      + `（页面=${JSON.stringify(gridNames)}）`,
    )
  }
  const missing = products.map(p => p.name).filter(n => !gridNames.includes(n))
  if (missing.length) {
    fails.push(
      `这些后端商品名没渲染出来：${JSON.stringify(missing)}；页面实际=${JSON.stringify(gridNames)}`
      + '（若页面显示的是别的文案 = 用了前端 mock 数据）',
    )
  }
  else {
    console.log(`  ✓ 商品网格文案来自后端真数据：${JSON.stringify(gridNames)}`)
  }

  /* ═══ 第 2 跳：场详情 → 商品详情 ═══════════════════════ */

  const productCard = await deepWait(eventPage, '.jp-product-card')
  if (!productCard) {
    throw new Error('场详情没有商品卡 .jp-product-card —— 第 2 跳的入口不存在')
  }
  await productCard.tap()
  await sleep(2500)

  const detailPage = await mp.currentPage()
  if (detailPage?.path !== 'pages/product/detail') {
    throw new Error(
      `第 2 跳失败：点商品卡后落在 ${JSON.stringify(detailPage?.path)}，期望 "pages/product/detail"`
      + '（buildProductRoute 的路径与商品详情页文件名对不上？）',
    )
  }
  console.log('  ✓ 第 2 跳：场详情商品卡 → 商品详情（pages/product/detail）—— ★ 从首页两跳可达')
  await screenshot(mp, `${SHOT_DIR}/product_2_product_detail.png`)

  /* ═══ 商品详情断言 ═════════════════════════════════════ */

  const q = async sel => detailPage.$(sel).catch(() => null)
  const textOf = async (sel) => {
    const el = await q(sel)
    return el ? String(await el.text().catch(() => '')).trim() : null
  }

  // 名称
  const nameText = await textOf('.jp-product-detail__name')
  if (nameText !== detail.name) {
    fails.push(`商品详情名称对不上：页面=${JSON.stringify(nameText)}，后端=${JSON.stringify(detail.name)}`)
  }

  // 价格（元，整元省小数 —— 与 formatYuan 同口径独立重算）
  const yuan = detail.priceCent / 100
  const expectPrice = Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2)
  const priceText = await textOf('.jp-product-detail__price')
  if (priceText !== expectPrice) {
    fails.push(
      `商品价格对不上：页面=${JSON.stringify(priceText)}，`
      + `后端 priceCent=${detail.priceCent} 应显示=${JSON.stringify(expectPrice)}`,
    )
  }
  else {
    console.log(`  ✓ 价格来自后端真数据：¥${priceText}（priceCent=${detail.priceCent}）`)
  }

  // ★ 「包邮」标识（REQ-ORDER-004 全包邮，AC 明确要求价格旁有此标识）
  const priceRow = await q('.jp-product-detail__price-row')
  const priceRowText = priceRow ? String(await priceRow.text().catch(() => '')) : ''
  if (!priceRowText.includes('包邮')) {
    fails.push(`★ 价格旁没有「包邮」标识（AC）：价格行文案=${JSON.stringify(priceRowText)}`)
  }
  else {
    console.log('  ✓ ★ 价格旁有「包邮」标识（REQ-ORDER-004）')
  }

  // 预计到货
  const deliveryText = await textOf('.jp-product-detail__row-value')
  if (detail.deliveryDateText && deliveryText !== detail.deliveryDateText) {
    fails.push(
      `预计到货对不上：页面=${JSON.stringify(deliveryText)}，后端=${JSON.stringify(detail.deliveryDateText)}`,
    )
  }

  // ★ 注意事项：区块在、正文与后端逐字一致（= 没被截断）
  const noticeBody = await textOf('.jp-product-notice__body')
  if (noticeBody === null) {
    fails.push('★ 商品详情没有注意事项区块 .jp-product-notice__body（甲方硬要求的下单前风险告知位）')
  }
  else if (detail.noticeText && noticeBody !== String(detail.noticeText).trim()) {
    fails.push(
      `★ 注意事项正文与后端不一致（被截断 / 被改写？）：\n       页面=${JSON.stringify(noticeBody)}`
      + `\n       后端=${JSON.stringify(detail.noticeText)}`,
    )
  }
  else {
    console.log(`  ✓ ★ 注意事项区块正文与后端逐字一致（${noticeBody.length} 字，未截断）`)
  }

  // ★ 注意事项节点必须排在 CTA 节点之前（甲方硬要求「在 CTA 之上」）
  const root = await q('.jp-product-detail')
  const markup = root ? String(await root.wxml().catch(() => '')) : ''
  if (!markup) {
    fails.push('取不到 .jp-product-detail 的 wxml —— 无法验证「注意事项在 CTA 之上」')
  }
  else {
    const iNotice = markup.indexOf('jp-product-notice')
    const iCta = markup.indexOf('jp-product-cta')
    if (iNotice < 0) {
      fails.push('★ 渲染结果里找不到 jp-product-notice 节点')
    }
    else if (iCta < 0) {
      fails.push('渲染结果里找不到 jp-product-cta 节点（底部 CTA 没渲染？）')
    }
    else if (iNotice > iCta) {
      fails.push('★ 注意事项节点排在了 CTA 之后 —— 违反甲方硬要求「注意事项必须在 CTA 之上」')
    }
    else {
      console.log('  ✓ ★ 注意事项节点在 CTA 之上（渲染顺序断言）')
    }
  }

  // ★ 加购 CTA 置灰状态与后端 eventBookable 绑死（AC：场已结束时加购置灰）
  const ctaBtn = await q('.jp-product-cta__btn')
  if (!ctaBtn) {
    fails.push('商品详情没有底部加购 CTA .jp-product-cta__btn')
  }
  else {
    const cls = String(await ctaBtn.attribute('class').catch(() => '') || '')
    const uiDisabled = /\bis-disabled\b/.test(cls)
    const shouldDisable = detail.eventBookable !== true
    if (uiDisabled !== shouldDisable) {
      fails.push(
        `★ 加购按钮置灰状态与后端 eventBookable 不符：后端 eventBookable=${detail.eventBookable}`
        + ` → 应${shouldDisable ? '置灰' : '可点'}，页面 class=${JSON.stringify(cls)} 实际${uiDisabled ? '置灰' : '可点'}`
        + '（场已结束却能加购 = 会产生无效订单；场进行中却置灰 = 白白拦掉成交）',
      )
    }
    else {
      console.log(`  ✓ ★ 加购按钮状态与后端 eventBookable=${detail.eventBookable} 一致（${uiDisabled ? '置灰' : '可点'}）`)
    }
  }

  console.log(`  截图 → ${SHOT_DIR}`)
  if (fails.length) throw new Error(`product 未通过:\n   - ${fails.join('\n   - ')}`)
  console.log('  ✓ 首页两跳可达商品详情 + 场/商品文案来自后端真数据 + 包邮标识 + 注意事项在 CTA 之上 + 加购态与后端一致')
}
