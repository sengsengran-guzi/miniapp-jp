/**
 * home flow —— 首页聚合三区块（GZ-JP-201 / UI:mp.home）。
 *
 * <p>验的三件事，对应任务卡 AC：</p>
 * <ol>
 *   <li><b>三区块齐</b>：轮播 banner / 场次列表 / 我的订单入口，缺一即 fail</li>
 *   <li><b>banner 不塌陷</b>：无 sys_config 配置时必须渲染出内置默认图（占位 slide），
 *       不能是一条空白 swiper</li>
 *   <li>★ <b>场卡片文案来自后端真数据</b>：flow 自己直连后端拉一遍
 *       {@code GET /app/gz/jp/event/list}，把返回的场名逐条与页面渲染出的卡片标题比对 ——
 *       前端写死的 mock 通不过这条（名字对不上），后端换 fixture 时断言自动跟着变</li>
 * </ol>
 *
 * <p><b>为什么要在 flow 里再拉一次后端</b>：光断言「页面上有卡片」证明不了数据是真的（前端塞
 * 一个假数组同样有卡片）。拉后端当<b>独立数据源</b>比对，才是「不是前端 mock」的直接证据。
 * 分组预期也在这里<b>独立重算一遍</b>（不 import 页面的 index.logic）—— 测试的 oracle 要独立于
 * 被测实现，否则实现和断言一起写错就一起绿。</p>
 *
 * <p>不需要登录态：场列表后端 &#64;SaIgnore 匿名可读，首页整页游客可浏览。</p>
 */
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { gotoPage, screenshot, SHOT_DIR } from '../mp-e2e.mjs'

/** 后端地址（与 preflight / dist 的 VITE_SERVER_BASEURL 一致）。 */
const BACKEND = process.env.MP_BACKEND || 'http://localhost:8080'
/** 本小程序 clientid（.env 的 VITE_APP_CLIENT_ID；后端按它路由 appid 配置）。 */
const CLIENT_ID = 'mp-applet-gz-jp'

/** 三组分组标题（须与 src/locale/home.zh-CN.ts 的 groupLive/groupUpcoming/groupEnded 一致）。 */
const GROUP_LABEL = { live: '进行中', upcoming: '即将开始', ended: '已结束' }
/** 展示顺序：进行中置顶（Kevin 拍板）。 */
const GROUP_ORDER = ['live', 'upcoming', 'ended']

/**
 * 直连后端拉场列表（curl 而非 node fetch：本机 clash 代理会吞 localhost，
 * 与 preflight.mjs 用同一套 `--noproxy '*'` 写法）。
 */
function fetchEventsFromBackend() {
  const body = execSync(
    `curl -s --noproxy '*' -m 8 '${BACKEND}/app/gz/jp/event/list?pageNum=1&pageSize=20' `
    + `-H 'clientid: ${CLIENT_ID}'`,
    { encoding: 'utf8' },
  )
  let json
  try {
    json = JSON.parse(body)
  }
  catch {
    throw new Error(`后端 event/list 返回的不是 JSON：${body.slice(0, 200)}`)
  }
  if (!Array.isArray(json.rows)) {
    throw new Error(`后端 event/list 没有 rows 数组（契约变了？）：${body.slice(0, 200)}`)
  }
  return json.rows
}

/**
 * 独立重算「这场属于哪一组」—— 刻意不 import src/pages/index/index.logic.ts。
 * 口径见 doc/jp/tickets/_visibility-extension-pre-201.md「前端契约要点」。
 */
function classify(event, nowMs) {
  if (!event || event.status !== 'open') return 'ended'
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(event.startTime || '').trim())
  if (!m) return 'live' // 时间解析不出来时 status 才是权威 → 当进行中
  const start = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime()
  return start > nowMs ? 'upcoming' : 'live'
}

/** 取一组元素的文本（automator Element.text()），trim 后返回数组。 */
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
 * flow 入口：拉后端真数据 → 交给 {@link runWith} 做断言。
 *
 * <p>「取数」与「断言」分成两个函数，是为了让 self-test.mjs 能<b>零环境依赖</b>地把断言逻辑跑一遍
 * （直接喂假的 backendEvents），不需要真起后端 —— 而不是在 flow 里埋一个「测试用环境变量后门」。</p>
 */
export async function run(mp) {
  const backendEvents = fetchEventsFromBackend()
  console.log(`  后端 event/list → ${backendEvents.length} 条：${backendEvents.map(e => e.name).join(' / ') || '(空)'}`)
  return runWith(mp, backendEvents)
}

/**
 * 断言主体。
 *
 * @param mp            automator 句柄
 * @param backendEvents 后端 event/list 的 rows（**独立数据源**，用来证明页面不是前端 mock）
 */
export async function runWith(mp, backendEvents) {
  mkdirSync(SHOT_DIR, { recursive: true })

  if (!backendEvents.length) {
    throw new Error(
      '后端 event/list 返回 0 条场 —— 本 flow 的核心断言（卡片文案来自后端真数据）无从验证。'
      + '请先在 dev 库造一个 open 场（GZ-JP-101 admin 建场并开场），或确认 gz_jp_event 的 fixture 还在。',
    )
  }

  const page = await gotoPage(mp, '/pages/index/index', 2500)
  const nowMs = Date.now()
  await screenshot(mp, `${SHOT_DIR}/home_1_full.png`)

  const fails = []
  const q = async sel => page.$(sel).catch(() => null)

  /* ── 区块 ①：轮播 banner ───────────────────────────────── */
  const bannerWrap = await q('.jp-home__banner')
  if (!bannerWrap) {
    fails.push('缺区块① 轮播 banner（.jp-home__banner 未渲染）')
  }
  else {
    // 不塌陷 = swiper 里真有 slide 内容：要么真图 .hb__img，要么内置默认占位 .hb__ph
    const img = await q('.hb__img')
    const ph = await q('.hb__ph')
    if (!img && !ph) {
      fails.push('banner 塌陷：swiper 里既没有图(.hb__img)也没有默认占位(.hb__ph) —— 空轮播')
    }
    else {
      console.log(`  ✓ 区块① banner 渲染（${img ? '运营配置图' : '无配置 → 默认图降级'}）`)
    }
  }

  /* ── 区块 ②：场次列表（含分组）───────────────────────── */
  const eventsWrap = await q('.jp-home__events')
  if (!eventsWrap) {
    fails.push('缺区块② 场次列表（.jp-home__events 未渲染）')
  }

  const cardNames = await textsOf(page, '.jp-event-card__name')
  if (cardNames.length !== backendEvents.length) {
    fails.push(
      `场卡片数对不上：页面 ${cardNames.length} 张，后端 ${backendEvents.length} 条`
      + `（页面=${JSON.stringify(cardNames)}）`,
    )
  }
  // ★ 核心断言：每条后端场名都要在页面上出现（前端写死的 mock 过不了这关）
  const missing = backendEvents.map(e => e.name).filter(n => !cardNames.includes(n))
  if (missing.length) {
    fails.push(
      `这些后端场名没渲染出来：${JSON.stringify(missing)}；页面实际渲染=${JSON.stringify(cardNames)}`
      + '（若页面显示的是别的文案 = 用了前端 mock 数据，不是后端真数据）',
    )
  }
  else {
    console.log(`  ✓ 区块② 场卡片文案来自后端真数据：${JSON.stringify(cardNames)}`)
  }

  // 分组标题：独立重算预期，断言「该出现的组都出现了、顺序是 进行中→即将开始→已结束」
  const expectedKeys = GROUP_ORDER.filter(k => backendEvents.some(e => classify(e, nowMs) === k))
  const expectedTitles = expectedKeys.map(k => GROUP_LABEL[k])
  const renderedTitles = await textsOf(page, '.jp-home__group-title')
  if (JSON.stringify(renderedTitles) !== JSON.stringify(expectedTitles)) {
    fails.push(
      `分组标题不符：页面=${JSON.stringify(renderedTitles)}，`
      + `按后端数据独立算出的预期=${JSON.stringify(expectedTitles)}`
      + '（顺序也必须一致：进行中置顶）',
    )
  }
  else {
    console.log(`  ✓ 分组正确（进行中置顶）：${JSON.stringify(renderedTitles)}`)
  }

  /* ── 区块 ③：我的订单快捷入口 ─────────────────────────── */
  const orderEntry = await q('.jp-entry-card')
  if (!orderEntry) {
    fails.push('缺区块③ 我的订单快捷入口（.jp-entry-card 未渲染）')
  }
  else {
    const title = await orderEntry.text().catch(() => '')
    if (!String(title || '').includes('我的订单')) {
      fails.push(`订单入口文案异常：${JSON.stringify(title)}（期望包含「我的订单」）`)
    }
    else {
      console.log('  ✓ 区块③ 我的订单入口渲染')
    }
  }

  console.log(`  截图 → ${SHOT_DIR}`)
  if (fails.length) throw new Error(`home 未通过:\n   - ${fails.join('\n   - ')}`)
  console.log('  ✓ 首页三区块齐 + banner 不塌陷 + 场卡片来自后端真数据')
}
