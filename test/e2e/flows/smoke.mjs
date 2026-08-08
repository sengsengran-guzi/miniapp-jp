/**
 * smoke flow —— 渲染 + 导航可达性（取代 CLAUDE.md §8.3 过去靠人肉点的可达性人验）。
 *
 * 对每个页：reLaunch 过去 → 等渲染 → 断言「真渲染出内容(view 数≥阈值) 且落在预期页(含已知重定向)」
 * →（可选）断言页面标志元素存在 → 截图。置信最高、最不脆的一层，不需登录态。
 *
 * 已知重定向也显式声明进 accept，这样既验渲染又把 app 的重定向行为锁进回归。
 *
 * 覆盖 GZ-JP-001 交付的全部 6 页（app.json pages 全集）。新页由后续卡（GZ-JP-101/102/103/
 * 201/202/205…）往 PAGES 里加一行即可 —— 这是 mp ticket「AC X(a) AI 模拟器可达」的落点。
 */
import { mkdirSync } from 'node:fs'
import { deep, deepAll, gotoPage, screenshot, SHOT_DIR } from '../mp-e2e.mjs'

/**
 * accept   = 可接受的最终落地页（首项即目标；列多项表示允许已知重定向）。
 * must     = 该页必须渲染出的标志选择器（不给则只验 view 数）。
 * mustDeep = 该标志选择器写在**自定义组件内部**（`src/components/biz/**`），
 *            必须用跨组件查询 —— `page.$` 对组件内部恒为 null，会把好页面判成没渲染。
 *            判断规则：选择器定义在 `src/pages/**` → 不填；在 `src/components/**` → 填 true。
 */
const PAGES = [
  // 首页 tab（启动落地页）。.jp-home__events = 场次区块容器，loading/error/empty/有数据
  // 四态都渲染这个节点（GZ-JP-201 起；此前是脚手架的 .jp-hero__cta，首页重写后已不存在）。
  // 首页三区块的深度断言在独立的 home flow 里，smoke 只管「可达 + 没渲染成空壳」。
  { path: '/pages/index/index', accept: ['pages/index/index'], must: '.jp-home__events' },
  // 我的 tab。.me-header__top = 头像+昵称头部，未登录/已登录都渲染。
  // ★ 它在 components/biz/MeHeader.vue 里 → mustDeep（页面模板里只有 .block 这类壳子）。
  { path: '/pages/me/index', accept: ['pages/me/index'], must: '.me-header__top', mustDeep: true },
  { path: '/pages/me/about', accept: ['pages/me/about'] },
  { path: '/pages/me/profile', accept: ['pages/me/profile'] },
  // 协议正文页带 query（onLoad 按 type 取文档）——顺带验 query 传参没把页面打空。
  { path: '/pages/agreement/index?type=service', accept: ['pages/agreement/index'] },
  { path: '/pages/agreement/index?type=privacy', accept: ['pages/agreement/index'] },
  // 整页登录（兜底路径）：已登录态下 onLoad 会 switchTab 回首页 —— 也是合法结果，一并锁进回归。
  { path: '/pages/login/index', accept: ['pages/login/index', 'pages/index/index'] },
  // GZ-JP-202 场详情：标志元素取商品网格容器 .jp-event-detail__grid ——
  // loading/error/empty/有数据四态都渲染这个节点，比任何一态内的元素都稳（同首页 .jp-home__events 的取法）。
  // 深度断言（页头场名 / 网格文案 / 两跳可达 / 加购态）在独立的 product flow 里，smoke 只管「可达 + 没渲染成空壳」。
  { path: '/pages/event/index?id=1', accept: ['pages/event/index'], must: '.jp-event-detail__grid' },
  // GZ-JP-202 商品详情：标志元素取页面根容器（loading/error/正文三态都在它里面）。
  // 不用 .jp-product-notice —— 那个只在正文态渲染，取数失败时会把「页面可达」误判成 fail。
  { path: '/pages/product/detail?id=1', accept: ['pages/product/detail'], must: '.jp-product-detail' },
  // GZ-JP-203 购物车：标志元素取页面根容器 .jp-cart —— loading / 游客 / 取数失败 / 空车 / 有数据
  // 五态都渲染这个节点。不用 .jp-cart-bar（底部条只在有数据时才有，smoke 不保证登录态更不保证车里有东西）。
  // 深度断言（加购真落库 / 三跳可达 / 合计 / 去结算闸门）在独立的 cart flow 里。
  { path: '/pages/cart/index', accept: ['pages/cart/index'], must: '.jp-cart' },
  // GZ-JP-204 下单确认：标志元素取页面根容器 .jp-confirm —— loading / 游客 / 取数失败 /
  // 「勾选项已不在」/ 正常五态都渲染它。smoke 不带 ids（reLaunch 直达，无 query）⇒ 命中
  // 「没有可结算的商品」空态，这正是要锁的行为：直接 reLaunch 到确认页不该白屏也不该崩。
  // 深度断言（地址 / 只读清单 / 两行金额 / 已阅读闸门 / 提交到支付）在独立的 checkout flow 里。
  { path: '/pages/order/confirm', accept: ['pages/order/confirm'], must: '.jp-confirm' },
  // GZ-JP-204 支付结果：不带 orderId ⇒ 不轮询，停在「正在确认支付结果」转圈态（BizState）。
  // 标志元素取根容器 .jp-payres（四个阶段都渲染它）。
  { path: '/pages/order/result', accept: ['pages/order/result'], must: '.jp-payres' },
  // GZ-JP-205 订单列表：游客态命中「登录后查看订单」空态，登录态命中列表；两态都渲染根容器
  // .jp-odl（含 tab 条），所以标志元素取它。深度断言（分组 / 单号去重 / 退款文案）在 orders flow。
  { path: '/pages/order/list', accept: ['pages/order/list'], must: '.jp-odl' },
  // GZ-JP-205 订单详情：smoke 不带 id ⇒ 命中「订单不存在」空态，锁的是「直达不白屏不崩」。
  { path: '/pages/order/detail', accept: ['pages/order/detail'], must: '.jp-odt' },
]
const MIN_VIEWS = 3

/**
 * 「页面真渲染出内容、不是空壳」的度量 —— <b>页面作用域与跨组件两个口径取大</b>。
 *
 * <p><b>为什么不能只数 {@code page.$$('view')}</b>：那只看得见<b>页面自己模板里</b>的 view，
 * 组件内部渲染的一概不算（SelectorQuery 不跨自定义组件边界）。本工程的空态 / 游客态页
 * 内容全在 BizPanel + BizState 里，页面作用域只剩两层壳 —— 实测
 * {@code pages/cart/index}（游客/加载态）、{@code pages/order/confirm}（空态）、
 * {@code pages/order/result}（无 orderId）都<b>只有 2 个</b>页面级 view，
 * 阈值 3 会把这三页判成「渲染成空壳」= <b>假红</b>。</p>
 *
 * <p>取大而不是直接换成跨组件口径：跨组件查询万一失效会返回 0，取大能退回旧口径，
 * 不至于把一个真渲染了的页面判死；两个口径都为 0 才是真空壳。</p>
 *
 * <p>跨组件口径<b>取到阈值就停</b>（{@code deepAll} 是按下标逐个取、每个一次 RPC）——
 * 这里只需要回答「够不够 {@link MIN_VIEWS} 个」，没必要把整页几十个 view 都点一遍。</p>
 */
async function countViews(page) {
  const own = (await page.$$('view').catch(() => [])).length
  const deepViews = (await deepAll(page, 'view', MIN_VIEWS)).length
  return { own, deep: deepViews, capped: deepViews >= MIN_VIEWS, max: Math.max(own, deepViews) }
}

export async function run(mp) {
  mkdirSync(SHOT_DIR, { recursive: true })

  const fails = []
  for (const { path: p, accept, must, mustDeep } of PAGES) {
    const page = await gotoPage(mp, p)
    const cur = await mp.currentPage()
    const views = await countViews(page)
    const curPath = cur && cur.path
    const landed = accept.includes(curPath)
    const rendered = views.max >= MIN_VIEWS
    const marker = must
      ? (mustDeep ? await deep(page, must) : await page.$(must).catch(() => null))
      : true
    const ok = landed && rendered && !!marker

    const shotName = p.replace(/^\//, '').replace(/[/?=]/g, '_')
    await screenshot(mp, `${SHOT_DIR}/${shotName}.png`)

    const redir = curPath !== p.replace(/^\//, '').split('?')[0] ? ` →redirect→ ${curPath}` : ''
    const viewsDesc = `views=${views.max}(页面${views.own}/跨组件${views.deep}${views.capped ? '+' : ''})`
    console.log(`  ${ok ? '✓' : '✗'} ${p}${redir}  (${viewsDesc}${must ? `, ${must}=${marker ? 'yes' : 'NO'}` : ''})`)
    if (!ok) {
      fails.push(
        `${p}: landed=${curPath}(accept=${accept.join('|')}), ${viewsDesc}`
        + (must ? `, ${must}=${marker ? 'found' : 'MISSING'}` : ''),
      )
    }
  }

  console.log(`  截图 → ${SHOT_DIR}`)
  if (fails.length) throw new Error(`smoke 未通过:\n   - ${fails.join('\n   - ')}`)
  console.log(`  ✓ ${PAGES.length} 页全部渲染 + 可达（含已知重定向）`)
}
