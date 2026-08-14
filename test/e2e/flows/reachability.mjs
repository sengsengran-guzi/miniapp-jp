/**
 * reachability flow —— **只验一件事：人用手指点得到吗**。
 *
 * <p><b>为什么单独一个 flow</b>：其它所有 flow 都用 {@code gotoPage('/pages/xxx')}
 * 程序化直达被测页，然后断言它渲染得对。那验的是「页面好不好」，
 * <b>不是「页面够不够得着」</b>。这两件事在 mp 里是分开会坏的：
 * {@code navigateTo} 传一个没注册的路径**不会编译报错**，运行时只走 fail 回调，
 * 而 fail 回调往往被写成一句友好提示 —— 于是「路由写错」在界面上长得和「功能还没做」一模一样。</p>
 *
 * <p><b>真实事故</b>：首页那张「我的订单」卡片的路由常量被写成没注册的
 * {@code /pages/order/index}（GZ-JP-201 落地时订单页还没交付，按约定猜的值，
 * 205 交付在 {@code /pages/order/list} 后没人回来改），fail 回调提示「订单功能即将上线」。
 * 结果客人付完款离开支付结果页后，<b>全小程序没有任何一条路径能回订单列表</b>，
 * 一期最重的履约展示（六段状态 / 运单号 / 行级部分退款）整块不可达。
 * 单测没断言过这个常量的值，orders flow 又是直达 {@code /pages/order/list} 的 ——
 * <b>两层测试同时对「可达性」失明</b>，整整一期没人发现。</p>
 *
 * <p><b>本 flow 的铁律：除了「回首页」这一步，不许出现任何 {@code gotoPage} / {@code navigateTo}。</b>
 * 到任何目的地都必须靠 {@code .tap()} 真点过去。一旦破例，这个 flow 就退化成又一个直达测试，
 * 也就再也守不住它要守的东西了。</p>
 *
 * <p>静态那一半（常量值 vs pages.json 注册表）由 {@code src/pages.routes.test.ts} 秒级守着；
 * 本 flow 守动态那一半：入口<b>存在、可见、点了真能到</b>。</p>
 */
import { mkdirSync } from 'node:fs'
import { deepWait, loginIfNeeded, screenshot, SHOT_DIR } from '../mp-e2e.mjs'

/** 首页路由 —— 唯一允许程序化跳的地方（它是入口，不是目的地）。 */
const HOME = '/pages/index/index'

/** 每个断言点：从哪出发、点什么、该到哪。 */
const HOPS = [
  {
    name: '首页「我的订单」卡片',
    from: 'home',
    selector: '.jp-entry-card',
    expect: 'pages/order/list',
    why: '客人付完款离开支付结果页后，这是首页上唯一一条回订单的路',
  },
  {
    name: '「我的」tab 九宫格首格',
    from: 'me',
    selector: '.me-grid__cell',
    expect: 'pages/order/list',
    why: '这是全小程序唯一「常驻」的回订单入口 —— 首页那张卡是营销位随时会改版，tab 里这格才是稳的',
  },
]

/**
 * 切到「我的」tab。
 *
 * <p>「我的」是 tabBar 页，{@code navigateTo} 对 tabBar 页无效，必须 {@code switchTab}。
 * 这里用 switchTab 不算破例：它模拟的正是客人点底部 tab 的动作，目的地本身还是靠点的。</p>
 */
async function goMeTab(mp) {
  await mp.switchTab('/pages/me/index')
  const page = await mp.currentPage()
  const path = String(page.path || '').replace(/^\//, '')
  if (!path.includes('pages/me/index')) {
    throw new Error(`切「我的」tab 失败，落在了 ${path}`)
  }
  return page
}

/** 回首页（tabBar 页同样只能 switchTab）。 */
async function goHome(mp) {
  await mp.switchTab(HOME)
  const page = await mp.currentPage()
  const path = String(page.path || '').replace(/^\//, '')
  if (!path.includes('pages/index/index')) {
    throw new Error(`回首页失败，落在了 ${path}`)
  }
  return page
}

export async function run(mp) {
  mkdirSync(SHOT_DIR, { recursive: true })

  // 订单入口需登录（游客点会弹协议同意 sheet）。走真实登录路径，不后门写 storage。
  await loginIfNeeded(mp)
  console.log('  ✓ 已登录（订单入口需登录态，游客点只会弹协议 sheet）')

  for (const hop of HOPS) {
    const page = hop.from === 'home' ? await goHome(mp) : await goMeTab(mp)

    const el = await deepWait(page, hop.selector, 10000)
    if (!el) {
      throw new Error(
        `${hop.name}：入口元素 ${hop.selector} 根本不存在 —— 客人在界面上找不到这个入口。`
        + `（${hop.why}）`,
      )
    }

    await el.tap()
    // 跳转 + 首屏渲染留足时间；tap 后 currentPage 不会立刻翻页
    await new Promise(r => setTimeout(r, 2500))

    const landed = await mp.currentPage()
    const path = String(landed.path || '').replace(/^\//, '')
    if (!path.includes(hop.expect)) {
      throw new Error(
        `★ ${hop.name}：点下去没到 ${hop.expect}，实际停在 ${path}。\n`
        + `  这正是那个藏了一期的 bug 的形态 —— navigateTo 到没注册的页面会静默失败，`
        + `fail 回调再把它说成「功能即将上线」，看起来像没做完，其实是路由写错。\n`
        + `  （${hop.why}）`,
      )
    }
    console.log(`  ✓ ${hop.name} → ${path}`)
  }

  // 第三跳：首页场卡 → 场详情（同一个陷阱的另一处，fail 回调曾也写着「场详情即将上线」）
  const home = await goHome(mp)
  const eventCard = await deepWait(home, '.jp-event-card', 10000)
  if (eventCard) {
    await eventCard.tap()
    await new Promise(r => setTimeout(r, 2500))
    const landed = await mp.currentPage()
    const path = String(landed.path || '').replace(/^\//, '')
    if (!path.includes('pages/event/index')) {
      throw new Error(`★ 首页场卡点下去没到场详情，实际停在 ${path}`)
    }
    console.log(`  ✓ 首页场卡 → ${path}`)
  }
  else {
    // 库里一个进行中的场都没有时卡片本就不该在 —— 说清楚是没验到，不伪装成通过
    console.log('  ⚠ 首页没有场卡（库里没有进行中的场）→ 场详情可达性【未触发】，不是通过')
  }

  await screenshot(mp, `${SHOT_DIR}/reachability-final.png`)
  console.log('  ✓ reachability flow 全部断言通过（全程靠 tap，无程序化直达目的地）')
}
