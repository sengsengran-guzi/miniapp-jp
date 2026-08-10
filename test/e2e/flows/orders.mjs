/**
 * orders flow —— 订单列表 + 详情按履约状态分组（GZ-JP-205 / UI:mp.order_list + UI:mp.order_detail）。
 *
 * <p>验的四件事，对应任务卡 AC：</p>
 * <ol>
 *   <li><b>列表可达且卡片来自后端真数据</b>：flow 自己直连 {@code GET /app/gz/jp/order/list}
 *       拿订单号，与页面渲染的单号比对 —— 前端塞假数组过不了这条</li>
 *   <li><b>列表 → 详情两跳可达</b></li>
 *   <li>★ <b>同一运单号在详情页只出现一次</b>（分组相对平铺的核心收益）：
 *       把页面上所有运单号文本抓下来，<b>去重前后数量必须相同</b></li>
 *   <li>★ <b>购买失败组排最后 + 退款文案正确</b>：refunded 显示金额、refunding/refund_failed
 *       只说「处理中」不显示数字</li>
 * </ol>
 *
 * <p><b>为什么 flow 里要再拉一次后端</b>：光断言「页面上有订单卡」证明不了数据是真的。
 * 拉后端当<b>独立数据源</b>比对才是「不是前端 mock」的直接证据。分组预期也在这里
 * <b>独立重算一遍</b>（不 import 页面的 detail.logic）—— oracle 必须独立于被测实现，
 * 否则实现和断言一起写错就一起绿。</p>
 *
 * <p>需要登录态：订单是用户私有数据（{@code /app/gz/jp/order/*} 全部要 token）。</p>
 */
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import {
  deep,
  deepTexts,
  gotoPage,
  loginIfNeeded,
  readAppToken,
  screenshot,
  SHOT_DIR,
} from '../mp-e2e.mjs'

const BACKEND = process.env.MP_BACKEND || 'http://localhost:8080'
const CLIENT_ID = 'mp-applet-gz-jp'

/** 履约状态展示序（与后端状态链倒序一致；purchase_failed 恒最后）。 */
const GROUP_ORDER = [
  'delivered',
  'cn_sorting',
  'customs',
  'jp_shipped',
  'await_seller_ship',
  'purchasing',
  'purchase_failed',
]

/** curl 直连（本机 clash 会吞 localhost，与 preflight 同一套 --noproxy 写法）。 */
function curlJson(url, token) {
  const auth = token ? `-H 'Authorization: Bearer ${token}' ` : ''
  const body = execSync(
    `curl -s --noproxy '*' -m 8 '${url}' -H 'clientid: ${CLIENT_ID}' ${auth}`,
    { encoding: 'utf8' },
  )
  try {
    return JSON.parse(body)
  } catch {
    throw new Error(`后端返回不是 JSON：${String(body).slice(0, 200)}`)
  }
}

/** 拉订单列表（独立数据源）。 */
function fetchOrdersFromBackend(token) {
  const res = curlJson(`${BACKEND}/app/gz/jp/order/list?pageNum=1&pageSize=20`, token)
  // ★ 分页端点收 rows 不是 data（D16 逮到过 6 处这类 bug）
  const rows = Array.isArray(res?.rows) ? res.rows : []
  return rows
}

/** 拉订单详情（独立数据源）。 */
function fetchOrderDetailFromBackend(orderId, token) {
  const res = curlJson(`${BACKEND}/app/gz/jp/order/${orderId}`, token)
  return res?.data ?? null
}

/**
 * 独立重算「详情页应该有几个组、每组什么单号」—— 刻意不 import detail.logic。
 *
 * @returns {{groupCount:number, trackings:string[], lastStatus:string|null}}
 */
function expectedGrouping(items) {
  const list = Array.isArray(items) ? items : []
  const seen = new Map()
  list.forEach((it) => {
    const status = String(it?.fulfillStatus ?? '').trim()
    const tracking = String(it?.trackingNo ?? '').trim()
    const key = `${status}${tracking}`
    if (!seen.has(key)) {
      seen.set(key, { status, tracking, order: GROUP_ORDER.indexOf(status) })
    }
  })
  const groups = [...seen.values()].sort((a, b) => {
    const ra = a.order < 0 ? GROUP_ORDER.length - 1.5 : a.order
    const rb = b.order < 0 ? GROUP_ORDER.length - 1.5 : b.order
    return ra - rb
  })
  return {
    groupCount: groups.length,
    trackings: groups.map((g) => g.tracking).filter(Boolean),
    lastStatus: groups.length ? groups[groups.length - 1].status : null,
  }
}

/** 从页面抓到的运单号文本里提取纯单号（组头形如「顺丰速运 SF7654321000」）。 */
function extractTrackingNos(texts) {
  const out = []
  for (const t of texts) {
    const m = String(t).match(/[A-Za-z0-9][A-Za-z0-9\-_]{3,63}/g)
    if (m) out.push(...m)
  }
  return out
}

/**
 * 断言主体 —— 与真模拟器解耦，好让 self-test 零环境跑。
 *
 * @param mp automator 句柄
 * @param backend {{orders:Array, detail:object|null}} 后端独立数据源
 */
export async function runWith(mp, backend) {
  mkdirSync(SHOT_DIR, { recursive: true })
  const orders = backend?.orders ?? []
  if (!orders.length) {
    throw new Error(
      '后端没有任何订单，orders flow 无法验证 —— 请先造 fixture（下单 + 支付），不是假绿。',
    )
  }

  /* ── 1. 订单列表页 ───────────────────────────────────────── */
  const listPage = await gotoPage(mp, '/pages/order/list')
  const listPath = String(listPage.path || '').replace(/^\//, '')
  if (!listPath.includes('pages/order/list')) {
    throw new Error(`第 1 跳没落在订单列表页，实际 path=${listPath}`)
  }
  if (!(await deep(listPage, '.jp-odl'))) {
    throw new Error('订单列表页缺标志元素 .jp-odl（页面没渲染出来）')
  }
  await screenshot(mp, `${SHOT_DIR}/orders-list.png`)

  // ★ 卡片单号来自后端真数据
  const cardNos = await deepTexts(listPage, '.jp-odl__no')
  const shownNos = cardNos.map((t) => String(t).trim()).filter(Boolean)
  if (!shownNos.length) {
    throw new Error('订单列表没渲染出任何订单号（.jp-odl__no 为空）')
  }
  const backendNos = new Set(orders.map((o) => String(o.orderNo)))
  const bogus = shownNos.filter((no) => ![...backendNos].some((b) => no.includes(b)))
  if (bogus.length) {
    throw new Error(
      `页面订单号与后端对不上（疑似前端 mock）：页面=${JSON.stringify(shownNos)} 后端=${JSON.stringify([...backendNos])}`,
    )
  }
  console.log(`  ✓ 订单列表卡片来自后端真数据：${shownNos.slice(0, 3).join(', ')}`)

  // tab 存在（全部 / 待支付 / 进行中 / 已完成）
  const tabs = await deepTexts(listPage, '.jp-odl__tab-text')
  if (tabs.filter((t) => String(t).trim()).length < 4) {
    throw new Error(`订单列表缺状态 tab，实际=${JSON.stringify(tabs)}`)
  }
  console.log(`  ✓ 状态 tab 齐：${tabs.map((t) => String(t).trim()).join(' / ')}`)

  /* ── 2. 详情页（两跳可达）────────────────────────────────── */
  const detail = backend?.detail
  if (!detail) {
    throw new Error('后端订单详情为空，无法验证分组')
  }
  const detailPage = await gotoPage(mp, `/pages/order/detail?id=${detail.id}`)
  const detailPath = String(detailPage.path || '').replace(/^\//, '')
  if (!detailPath.includes('pages/order/detail')) {
    throw new Error(`第 2 跳没落在订单详情页，实际 path=${detailPath}`)
  }
  if (!(await deep(detailPage, '.jp-odt'))) {
    throw new Error('订单详情页缺标志元素 .jp-odt')
  }
  await screenshot(mp, `${SHOT_DIR}/orders-detail.png`)
  console.log(`  ✓ 两跳可达订单详情（订单 ${detail.orderNo}）`)

  /* ── 3. ★ 同一运单号只出现一次 ──────────────────────────── */
  const exp = expectedGrouping(detail.items)
  const trackTexts = await deepTexts(detailPage, '.jp-odt__tracking')
  const shownTrackings = extractTrackingNos(trackTexts)

  const uniq = new Set(shownTrackings)
  if (shownTrackings.length !== uniq.size) {
    const dup = shownTrackings.filter((t, i) => shownTrackings.indexOf(t) !== i)
    throw new Error(
      `★ 同一运单号出现了多次（分组失效，退化成平铺）：重复=${JSON.stringify([...new Set(dup)])} 全部=${JSON.stringify(shownTrackings)}`,
    )
  }
  // 后端有几个不同单号，页面就该显示几个
  const expectedUniq = new Set(exp.trackings)
  for (const t of expectedUniq) {
    if (!uniq.has(t)) {
      throw new Error(`后端有运单号 ${t}，详情页却没显示（页面=${JSON.stringify([...uniq])}）`)
    }
  }
  if (!expectedUniq.size) {
    // ★ 反空转：这张单一个运单号都没有 ⇒ 上面那两条断言（去重 / 缺显）根本没执行到，
    //   打成「✓ 页面 0 个 / 后端 0 个」会读起来像通过。必须显式说明它没验到东西。
    console.log(
      '  ⚠ 本轮挑中的订单没有任何已发货行 → 运单号去重与承运商名断言【未触发】（不是通过）。' +
        '造一笔已发货的单再跑才能覆盖这段。',
    )
  } else {
    console.log(
      `  ✓ ★ 同一运单号只出现一次：页面 ${uniq.size} 个单号 / 后端 ${expectedUniq.size} 个（去重前 ${shownTrackings.length}）`,
    )

    /* ── 3b. ★ 承运商中文名 = 后端下发的 carrierLabel ─────────
     * 这条守的是跨层契约：前端**不再**维护 code→中文名映射表，整串中文名由后端
     * 读字典下发（GzJpOrderItemVO.carrierLabel）。字段名写错 / 序列化没带上 /
     * 前端读错 key，任何一处断了都是「承运商名悄悄消失」—— 页面照常渲染、
     * 单号照常在，两边的单测各自用夹具也都照样绿。只有拿真接口比对才照得出来。
     */
    const backendLabels = new Set(
      (detail.items || [])
        .filter((it) => String(it?.trackingNo ?? '').trim())
        .map((it) => String(it?.carrierLabel ?? '').trim())
        .filter(Boolean),
    )
    const shownCarriers = (await deepTexts(detailPage, '.jp-odt__tracking-carrier'))
      .map((t) => String(t).trim())
      .filter(Boolean)
    for (const label of backendLabels) {
      if (!shownCarriers.includes(label)) {
        throw new Error(
          `★ 后端 carrierLabel="${label}"，详情页组头却没显示它（页面=${JSON.stringify(shownCarriers)}）` +
            ' —— 跨层契约断了（字段名/序列化/前端取值），或前端又退回了硬编码映射表',
        )
      }
    }
    // 后端给不出 label 时前端不许自造：页面上不能冒出原始编码（如 "sf"）
    const rawCodes = new Set(
      (detail.items || [])
        .map((it) => String(it?.carrierCode ?? '').trim())
        .filter(Boolean),
    )
    for (const code of rawCodes) {
      if (shownCarriers.includes(code)) {
        throw new Error(
          `★ 详情页把承运商原始编码 "${code}" 当中文名显示了 —— 应显示后端 carrierLabel，取不到就留空只显单号`,
        )
      }
    }
    console.log(
      `  ✓ ★ 承运商名来自后端 carrierLabel：${JSON.stringify([...backendLabels])}（页面=${JSON.stringify(shownCarriers)}，无原始编码泄漏）`,
    )
  }

  /* ── 4. 分组结构：组数 + 购买失败排最后 ─────────────────── */
  const groupTitles = (await deepTexts(detailPage, '.jp-odt__group-title'))
    .map((t) => String(t).trim())
    .filter(Boolean)
  if (!groupTitles.length) {
    throw new Error('详情页没渲染出任何分组组头（.jp-odt__group-title）')
  }
  if (groupTitles.length !== exp.groupCount) {
    throw new Error(
      `分组数与后端数据对不上：页面 ${groupTitles.length} 组 / 应为 ${exp.groupCount} 组（${JSON.stringify(groupTitles)}）`,
    )
  }
  // AC：30 款分组后不超过 7 组（同状态多单号时可多，但至少不该退化成每行一组）
  if (groupTitles.length > detail.items.length) {
    throw new Error(`分组退化成平铺：${groupTitles.length} 组 / ${detail.items.length} 行`)
  }
  console.log(`  ✓ 分组结构正确：${groupTitles.length} 组 —— ${groupTitles.join(' | ')}`)

  if (exp.lastStatus === 'purchase_failed') {
    const lastTitle = groupTitles[groupTitles.length - 1]
    if (!lastTitle.includes('购买失败')) {
      throw new Error(`★ 购买失败组没排最后，末组是「${lastTitle}」`)
    }
    console.log('  ✓ ★ 购买失败组排最后')
  }

  /* ── 5. ★ 退款文案：refunded 显金额 / 处理中不显数字 ────── */
  const failedItems = (detail.items || []).filter((i) => i.fulfillStatus === 'purchase_failed')
  if (failedItems.length) {
    const refundTexts = (await deepTexts(detailPage, '.jp-odt__refund'))
      .map((t) => String(t).trim())
      .filter(Boolean)
    if (!refundTexts.length) {
      throw new Error('有购买失败的行，详情页却没渲染退款文案（.jp-odt__refund）')
    }
    const joined = refundTexts.join(' ')
    for (const it of failedItems) {
      if (it.refundStatus === 'refunded') {
        const yuan = (Number(it.refundAmountCent) / 100).toFixed(2).replace(/\.00$/, '')
        if (!joined.includes(yuan) && !joined.includes(String(it.refundAmountCent / 100))) {
          throw new Error(
            `已退款行应显示金额 ¥${yuan}，实际退款文案=${JSON.stringify(refundTexts)}`,
          )
        }
      } else if (it.refundStatus === 'refunding' || it.refundStatus === 'refund_failed') {
        // ★ 处理中绝不能漏具体金额（钱还在路上，数字可能变）
        const cent = Number(it.refundAmountCent)
        if (Number.isFinite(cent) && cent > 0) {
          const yuan = (cent / 100).toFixed(2).replace(/\.00$/, '')
          if (joined.includes(yuan)) {
            throw new Error(
              `★ 退款处理中却显示了具体金额 ¥${yuan}（数字还可能变，不能给客人看）：${JSON.stringify(refundTexts)}`,
            )
          }
        }
      }
    }
    console.log(`  ✓ ★ 退款文案正确：${refundTexts.join(' / ')}`)
  }

  /* ── 6. ★ 全页不出现「包裹」二字 ────────────────────────── */
  const wxml = String((await detailPage.wxml?.()) ?? '')
  if (wxml.includes('包裹')) {
    throw new Error('★ 详情页渲染出了「包裹」二字（客人不该感知打包方式，REQ-FULFILL-006）')
  }
  console.log('  ✓ ★ 全页无「包裹」字样')

  console.log('  ✓ orders flow 全部断言通过')
}

/** 真跑入口：登录 → 拉后端独立数据源 → 跑断言。 */
export async function run(mp) {
  await loginIfNeeded(mp)
  const token = await readAppToken(mp)
  if (!token) {
    throw new Error('登录后仍拿不到 token，订单接口需要登录态')
  }
  const orders = fetchOrdersFromBackend(token)
  if (!orders.length) {
    throw new Error(
      '当前用户没有订单 —— 请先跑 checkout flow 或手工造一笔已支付订单再跑 orders。',
    )
  }
  // 挑哪张单来验，直接决定「运单号去重 + 承运商名」那几条断言是真跑还是空转。
  // 排序口径：① 有已发货行（带运单号）的优先 —— 没有的话那几条断言一条都执行不到；
  //          ② 其次行最多（更可能多状态多单号，分组逻辑压力更大）。
  // 只看最新 5 张不够（新单往往还没发货），放宽到 12 张。
  const shipped = (d) => (d?.items || []).filter((it) => String(it?.trackingNo ?? '').trim()).length
  let best = null
  for (const o of orders.slice(0, 12)) {
    const d = fetchOrderDetailFromBackend(o.id, token)
    if (!d) continue
    if (
      !best ||
      shipped(d) > shipped(best) ||
      (shipped(d) === shipped(best) && (d.items?.length ?? 0) > (best.items?.length ?? 0))
    ) {
      best = d
    }
  }
  if (best && !shipped(best)) {
    console.log('  ⚠ 最近 12 张单里没有一张有已发货行 —— 运单号/承运商断言这轮会空转（见下方提示）')
  }
  await runWith(mp, { orders, detail: best })
}
