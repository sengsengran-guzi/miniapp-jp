/**
 * self-test —— flow 自身的逻辑体检，**不需要微信开发者工具**。
 *
 * <p>为什么要有：mp E2E 的两类失败长得一模一样（都是「flow 挂了」），但处置完全相反 ——</p>
 * <ul>
 *   <li>A. flow 代码写错（选择器打错 / 断言写反 / await 漏了）→ 该改代码；</li>
 *   <li>B. 本机 devtools 环境不行（没登录 / 服务端口关 / IDE 卡死）→ 该修环境，代码是好的。</li>
 * </ul>
 * <p>本文件用一个假的 miniProgram 句柄（实现 automator 那几个 API）把 flow 跑一遍，
 * 于是「A 类」在**零环境依赖**下就能被判定。GZ-JP-002 交付时 devtools 恰好登录过期，
 * 正是靠它证明「harness 与 flow 代码是好的，只卡在人工扫码」。</p>
 *
 * <p>跑：`node test/e2e/self-test.mjs`（退出码 0 = 全过 / 1 = 有用例不符预期）。
 * 加新 flow 时**顺手加一个 happy 场景 + 至少一个 negative 场景**，成本很低、回报是
 * 「断言真的会 fail」这件事有人守着（只写 happy 的断言常年恒真，等于没写）。</p>
 */
import { run as runSmoke } from './flows/smoke.mjs'
import { run as runLogin } from './flows/login.mjs'

/* ───────────────────────── 假 miniProgram 句柄 ───────────────────────── */

/**
 * 假 Element：tap 触发注册的副作用；attribute/property **每次现取**。
 *
 * ⚠️ 必须 lazy：真 automator 的 Element.attribute() 每次都发一次 RPC 拿实时值，
 * flow 里「先拿到 el → tap → 再读同一个 el 的 class」是合法且常用的写法。
 * 假件若快照 spec，就会把这种写法误判成 flow 的 bug。
 */
function makeEl(getSpec, onTap) {
  return {
    tap: async () => { onTap && onTap() },
    attribute: async name => getSpec()?.attrs?.[name],
    property: async name => getSpec()?.props?.[name],
    wxml: async () => getSpec()?.wxml || '<view/>',
  }
}

/**
 * 造一个假 mp。
 * @param {object} cfg
 * @param {(path:string)=>object} cfg.pageFor  按当前路径返回 { path, views, els:{sel:spec} }
 * @param {object} cfg.storage                 uni storage 的模拟
 * @param {(sel:string)=>void} cfg.onTap       点击副作用
 */
function makeMp(cfg) {
  let cur = '/pages/index/index'
  // ⚠️ 真 automator 的 page.$() 每次都查**当前**渲染树，所以这里也必须每次重新算，
  //    不能在 reLaunch 时快照一份 —— 否则「点一下 → 页面变了」这类交互全测不出来。
  const mkPage = () => ({
    get path() { return cfg.pageFor(cur.split('?')[0]).path },
    $: async (sel) => {
      const getSpec = () => cfg.pageFor(cur.split('?')[0]).els?.[sel]
      return getSpec() ? makeEl(getSpec, () => cfg.onTap?.(sel)) : null
    },
    $$: async () => Array.from({ length: cfg.pageFor(cur.split('?')[0]).views ?? 10 }),
  })
  return {
    reLaunch: async (url) => { cur = url; return mkPage() },
    currentPage: async () => ({ path: cfg.pageFor(cur.split('?')[0]).path }),
    screenshot: async () => {},
    callWxMethod: async (m, k) => {
      if (m === 'getStorageSync') return cfg.storage[k]
      if (m === 'clearStorageSync') { for (const k2 of Object.keys(cfg.storage)) delete cfg.storage[k2] }
      return undefined
    },
    mockWxMethod: async () => {},
    restoreWxMethod: async () => {},
    disconnect: () => {},
  }
}

/* ───────────────────────────── 场景 ───────────────────────────── */

const ALL_PAGES = {
  'pages/index/index': { views: 12, els: { '.jp-hero__cta': {} } },
  'pages/me/index': { views: 12, els: { '.me-header__top': {} } },
  'pages/me/about': { views: 8 },
  'pages/me/profile': { views: 14 },
  'pages/agreement/index': { views: 9 },
  'pages/login/index': { views: 10 },
}

/** smoke 用：按路径查表，路径原样落地（无重定向）。 */
function smokeMp(overrides = {}) {
  const table = { ...ALL_PAGES, ...overrides }
  return makeMp({
    pageFor: (p) => {
      const key = p.replace(/^\//, '')
      return { path: key, ...(table[key] || { views: 0 }) }
    },
    storage: {},
  })
}

/**
 * login 用：带状态机的假 app —— 复刻真 app 的关键行为
 * （游客点 CTA 弹 sheet → 勾选 → 点登录 → 落 token/openid/consent → me 页出现登出按钮）。
 */
function loginMp({ loggedInAtStart = true, defaultChecked = false, openid = 'mock-jp-tester' } = {}) {
  const storage = {} // 引用保持不变（只增删 key），跟 uni storage 的语义一致
  const st = { loggedIn: loggedInAtStart, sheetOpen: false, checked: defaultChecked }
  const setLoggedIn = () => {
    storage.user = JSON.stringify({ userInfo: { userId: 14, username: `wx:${openid}` } })
  }
  if (loggedInAtStart) setLoggedIn()

  return makeMp({
    storage,
    onTap: (sel) => {
      if (sel === '.logout-btn') {
        st.loggedIn = false
        for (const k of Object.keys(storage)) delete storage[k]
      }
      if (sel === '.jp-hero__cta' && !st.loggedIn) st.sheetOpen = true
      if (sel === '.login-agree__box') st.checked = !st.checked
      if (sel === '.login-sheet__cta' && st.checked) {
        st.loggedIn = true
        st.sheetOpen = false
        setLoggedIn()
        storage.gz_privacy_agreed = true
      }
    },
    pageFor: (p) => {
      const key = p.replace(/^\//, '')
      const els = {}
      if (key === 'pages/index/index') {
        els['.jp-hero__cta'] = {}
        if (st.sheetOpen) {
          els['.login-sheet'] = {}
          els['.login-agree__box'] = { attrs: { class: `login-agree__box${st.checked ? ' is-on' : ''}` } }
          els['.login-sheet__cta'] = { props: { disabled: !st.checked } }
        }
      }
      if (key === 'pages/me/index') {
        els['.me-header__top'] = {}
        if (st.loggedIn) els['.logout-btn'] = {}
      }
      return { path: key, views: 12, els }
    },
  })
}

/* ───────────────────────────── 用例 ───────────────────────────── */

const CASES = [
  {
    name: 'smoke / 全部页面正常 → 通过',
    expect: 'pass',
    run: () => runSmoke(smokeMp()),
  },
  {
    name: 'smoke / 首页缺 .jp-hero__cta 标志元素 → 必须 fail',
    expect: /jp-hero__cta=MISSING/,
    run: () => runSmoke(smokeMp({ 'pages/index/index': { views: 12, els: {} } })),
  },
  {
    name: 'smoke / 某页渲染空壳(view 数不足) → 必须 fail',
    expect: /views=1/,
    run: () => runSmoke(smokeMp({ 'pages/me/about': { views: 1 } })),
  },
  {
    name: 'login / 已登录起步（先登出再重登）→ 通过',
    expect: 'pass',
    run: () => runLogin(loginMp({ loggedInAtStart: true })),
  },
  {
    name: 'login / 游客起步 → 通过',
    expect: 'pass',
    run: () => runLogin(loginMp({ loggedInAtStart: false })),
  },
  {
    name: 'login / 协议框默认已勾选（合规回归）→ 必须 fail',
    expect: /默认已勾选|不得默认强制同意/,
    run: () => runLogin(loginMp({ defaultChecked: true })),
  },
  {
    name: 'login / 登成了另一个小程序的用户（串号）→ 必须 fail',
    expect: /clientid|mock-jp-tester/,
    run: () => runLogin(loginMp({ openid: 'mock-dev-tester' })),
  },
]

const origLog = console.log
let failures = 0
for (const c of CASES) {
  console.log = () => {} // flow 内部日志静音，只看结论
  let err = null
  try { await c.run() }
  catch (e) { err = e }
  console.log = origLog

  if (c.expect === 'pass') {
    if (err) { failures++; console.error(`  ✗ ${c.name}\n      期望通过，实际抛：${err.message}`) }
    else console.log(`  ✓ ${c.name}`)
  }
  else if (!err) { failures++; console.error(`  ✗ ${c.name}\n      期望 fail，实际通过了（断言恒真 = 等于没写）`) }
  else if (!c.expect.test(err.message)) { failures++; console.error(`  ✗ ${c.name}\n      fail 了但原因不对：${err.message}`) }
  else console.log(`  ✓ ${c.name}`)
}

console.log(`\n[self-test] ${CASES.length - failures}/${CASES.length} 通过`)
process.exit(failures ? 1 : 0)
