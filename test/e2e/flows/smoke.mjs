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
import { gotoPage, screenshot, SHOT_DIR } from '../mp-e2e.mjs'

/**
 * accept = 可接受的最终落地页（首项即目标；列多项表示允许已知重定向）。
 * must   = 该页必须渲染出的标志选择器（不给则只验 view 数）。
 */
const PAGES = [
  // 首页 tab（启动落地页）。.jp-home__events = 场次区块容器，loading/error/empty/有数据
  // 四态都渲染这个节点（GZ-JP-201 起；此前是脚手架的 .jp-hero__cta，首页重写后已不存在）。
  // 首页三区块的深度断言在独立的 home flow 里，smoke 只管「可达 + 没渲染成空壳」。
  { path: '/pages/index/index', accept: ['pages/index/index'], must: '.jp-home__events' },
  // 我的 tab。.me-header__top = 头像+昵称头部，未登录/已登录都渲染。
  { path: '/pages/me/index', accept: ['pages/me/index'], must: '.me-header__top' },
  { path: '/pages/me/about', accept: ['pages/me/about'] },
  { path: '/pages/me/profile', accept: ['pages/me/profile'] },
  // 协议正文页带 query（onLoad 按 type 取文档）——顺带验 query 传参没把页面打空。
  { path: '/pages/agreement/index?type=service', accept: ['pages/agreement/index'] },
  { path: '/pages/agreement/index?type=privacy', accept: ['pages/agreement/index'] },
  // 整页登录（兜底路径）：已登录态下 onLoad 会 switchTab 回首页 —— 也是合法结果，一并锁进回归。
  { path: '/pages/login/index', accept: ['pages/login/index', 'pages/index/index'] },
]
const MIN_VIEWS = 3

export async function run(mp) {
  mkdirSync(SHOT_DIR, { recursive: true })

  const fails = []
  for (const { path: p, accept, must } of PAGES) {
    const page = await gotoPage(mp, p)
    const cur = await mp.currentPage()
    const views = await page.$$('view').catch(() => [])
    const curPath = cur && cur.path
    const landed = accept.includes(curPath)
    const rendered = views.length >= MIN_VIEWS
    const marker = must ? await page.$(must).catch(() => null) : true
    const ok = landed && rendered && !!marker

    const shotName = p.replace(/^\//, '').replace(/[/?=]/g, '_')
    await screenshot(mp, `${SHOT_DIR}/${shotName}.png`)

    const redir = curPath !== p.replace(/^\//, '').split('?')[0] ? ` →redirect→ ${curPath}` : ''
    console.log(`  ${ok ? '✓' : '✗'} ${p}${redir}  (views=${views.length}${must ? `, ${must}=${marker ? 'yes' : 'NO'}` : ''})`)
    if (!ok) {
      fails.push(
        `${p}: landed=${curPath}(accept=${accept.join('|')}), views=${views.length}`
        + (must ? `, ${must}=${marker ? 'found' : 'MISSING'}` : ''),
      )
    }
  }

  console.log(`  截图 → ${SHOT_DIR}`)
  if (fails.length) throw new Error(`smoke 未通过:\n   - ${fails.join('\n   - ')}`)
  console.log(`  ✓ ${PAGES.length} 页全部渲染 + 可达（含已知重定向）`)
}
