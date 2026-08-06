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

// 假句柄的「渲染」是瞬时的，flow 里为真模拟器准备的 sleep 纯属空等 —— 归零后整轮秒级。
// ★ 只缩放等待时长，不改任何断言、不跳过任何步骤（见 mp-e2e.mjs 的 SLEEP_SCALE 注释）。
// 必须在 import flow 之前设置：mp-e2e.mjs 在模块加载时读一次该值。
process.env.MP_E2E_SLEEP_SCALE = '0'

const { run: runSmoke } = await import('./flows/smoke.mjs')
const { run: runLogin } = await import('./flows/login.mjs')
const { runWith: runHomeWith } = await import('./flows/home.mjs')
const { runWith: runProductWith } = await import('./flows/product.mjs')

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
    text: async () => getSpec()?.text ?? '',
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
    // 真 automator 的 $$ 按选择器查全部匹配节点。smoke 只用它数 view，
    // home 要用它取一组文本（场卡片名 / 分组标题），所以 lists 里登记过的选择器返回带 text 的假元素。
    $$: async (sel) => {
      const spec = cfg.pageFor(cur.split('?')[0])
      const list = spec.lists?.[sel]
      if (list) return list.map(text => makeEl(() => ({ text }), () => cfg.onTap?.(sel)))
      if (sel === 'view') return Array.from({ length: spec.views ?? 10 })
      return []
    },
  })
  return {
    reLaunch: async (url) => { cur = url; return mkPage() },
    // ⚠️ 必须返回**完整** page（含 $ / $$），不能只给 { path }：flow 点完一个卡片跳页后
    //    只能靠 currentPage() 拿新页的句柄再查元素（product flow 的两跳就是这么写的）。
    //    mkPage() 的 path 是 getter，所以对只读 .path 的老 flow（smoke）完全向后兼容。
    currentPage: async () => mkPage(),
    /** 供假件内部改当前路径（模拟 navigateTo 后的落地页）。 */
    __goto: (p) => { cur = p },
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
  // GZ-JP-201 起首页标志元素是 .jp-home__events（场次区块，四态都渲染）
  'pages/index/index': { views: 12, els: { '.jp-home__events': {} } },
  'pages/me/index': { views: 12, els: { '.me-header__top': {} } },
  'pages/me/about': { views: 8 },
  'pages/me/profile': { views: 14 },
  'pages/agreement/index': { views: 9 },
  'pages/login/index': { views: 10 },
  // GZ-JP-202 新增两页
  'pages/event/index': { views: 16, els: { '.jp-event-detail__grid': {} } },
  'pages/product/detail': { views: 16, els: { '.jp-product-detail': {} } },
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
      // 首页登录触发点 = 「我的订单」入口（GZ-JP-201 后首页无独立登录按钮，游客优先/按需登录）
      if (sel === '.jp-entry-card' && !st.loggedIn) st.sheetOpen = true
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
        els['.jp-entry-card'] = { text: '我的订单 查看拼团进度与物流' }
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

/**
 * home 用：按「后端会返回什么」造一个渲染结果一致（或故意不一致）的假首页。
 *
 * @param {object} cfg
 * @param {string[]} cfg.cardNames     页面渲染出的场卡片标题
 * @param {string[]} cfg.groupTitles   页面渲染出的分组标题（按渲染顺序）
 * @param {boolean}  cfg.banner        banner 是否渲染出内容（false = 空轮播/塌陷）
 * @param {boolean}  cfg.orderEntry    订单入口是否渲染
 * @param {boolean}  cfg.eventsWrap    场次区块容器是否渲染
 */
function homeMp({
  cardNames = [],
  groupTitles = [],
  banner = 'placeholder',
  orderEntry = '我的订单 查看拼团进度与物流',
  eventsWrap = true,
} = {}) {
  return makeMp({
    storage: {},
    pageFor: (p) => {
      const key = p.replace(/^\//, '')
      const els = {}
      if (key === 'pages/index/index') {
        els['.jp-home__banner'] = {}
        if (banner === 'placeholder') els['.hb__ph'] = {}
        if (banner === 'image') els['.hb__img'] = {}
        if (eventsWrap) els['.jp-home__events'] = {}
        if (orderEntry) els['.jp-entry-card'] = { text: orderEntry }
      }
      return {
        path: key,
        views: 12,
        els,
        lists: {
          '.jp-event-card__name': cardNames,
          '.jp-home__group-title': groupTitles,
        },
      }
    },
  })
}

/** 后端 fixture：1 个已开场的 open 场（进行中）。 */
const BE_LIVE = [{
  id: '1',
  eventNo: 'EVT-20260807-000001',
  name: '8月上旬快闪场',
  status: 'open',
  startTime: '2020-01-01 10:00:00',
  endTime: '2099-12-31 22:00:00',
}]

/**
 * product 用（GZ-JP-202）：带**跳转状态机**的假 app —— 复刻真实两跳
 * （首页点场卡 → 场详情；场详情点商品卡 → 商品详情）。
 *
 * 每个可配项都对应一条 negative 用例能打到的点：跳错页 / 页面文案是前端 mock /
 * 已结束条与后端状态不符 / 注意事项正文被截断 / 注意事项排到 CTA 之后 / 加购态与 eventBookable 不符。
 */
function productMp({
  // 跳转落点（负例：跳错页 / 没跳）
  hop1 = '/pages/event/index',
  hop2 = '/pages/product/detail',
  // 场详情
  headName = '8月上旬快闪场',
  endedBar = false,
  gridNames = ['柯南 吧唧 一番赏 A赏'],
  // 商品详情
  productName = '柯南 吧唧 一番赏 A赏',
  price = '128',
  priceRowText = '¥ 128 包邮',
  delivery = '8月下旬',
  noticeBody = '日本线下采购，包装可能有轻微磨损，介意慎拍',
  // 渲染顺序（notice 必须在 cta 之前）
  markup = '<view class="jp-product-detail">…<view class="jp-product-notice">…</view>…<view class="jp-product-cta">…</view></view>',
  ctaClass = 'jp-product-cta__btn',
} = {}) {
  const mp = makeMp({
    storage: {},
    onTap: (sel) => {
      if (sel === '.jp-event-card') mp.__goto(hop1)
      if (sel === '.jp-product-card') mp.__goto(hop2)
    },
    pageFor: (p) => {
      const key = p.replace(/^\//, '')
      const els = {}
      const lists = {}
      if (key === 'pages/index/index') {
        els['.jp-event-card'] = { text: headName }
      }
      if (key === 'pages/event/index') {
        els['.jp-event-detail__grid'] = {}
        els['.jp-event-detail__name'] = { text: headName }
        if (endedBar) els['.jp-event-detail__ended-text'] = { text: '本场已结束，商品仅可浏览，不能加入购物车' }
        if (gridNames.length) els['.jp-product-card'] = { text: gridNames[0] }
        lists['.jp-product-card__name'] = gridNames
      }
      if (key === 'pages/product/detail') {
        els['.jp-product-detail'] = { wxml: markup }
        els['.jp-product-detail__name'] = { text: productName }
        els['.jp-product-detail__price'] = { text: price }
        els['.jp-product-detail__price-row'] = { text: priceRowText }
        els['.jp-product-detail__row-value'] = { text: delivery }
        if (noticeBody !== null) els['.jp-product-notice__body'] = { text: noticeBody }
        els['.jp-product-cta__btn'] = { attrs: { class: ctaClass } }
      }
      return { path: key, views: 16, els, lists }
    },
  })
  return mp
}

/** product flow 的后端 fixture：1 个进行中的场 + 1 件在架商品（可加购）。 */
const BE_PRODUCT = {
  event: BE_LIVE[0],
  products: [{ id: '1', name: '柯南 吧唧 一番赏 A赏' }],
  detail: {
    id: '1',
    name: '柯南 吧唧 一番赏 A赏',
    priceCent: 12800,
    deliveryDateText: '8月下旬',
    noticeText: '日本线下采购，包装可能有轻微磨损，介意慎拍',
    eventBookable: true,
  },
}

/** 深拷贝改一处（避免用例之间互相污染 fixture）。 */
function beProduct(patch = {}) {
  return {
    event: { ...BE_PRODUCT.event, ...(patch.event || {}) },
    products: patch.products || BE_PRODUCT.products.map(p => ({ ...p })),
    detail: patch.detail === null ? null : { ...BE_PRODUCT.detail, ...(patch.detail || {}) },
  }
}

/* ───────────────────────────── 用例 ───────────────────────────── */

const CASES = [
  {
    name: 'smoke / 全部页面正常 → 通过',
    expect: 'pass',
    run: () => runSmoke(smokeMp()),
  },
  {
    name: 'smoke / 首页缺 .jp-home__events 标志元素 → 必须 fail',
    expect: /jp-home__events=MISSING/,
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

  /* ── home（GZ-JP-201）──────────────────────────────────── */
  {
    name: 'home / 三区块齐 + 卡片名与后端一致 → 通过',
    expect: 'pass',
    run: () => runHomeWith(
      homeMp({ cardNames: ['8月上旬快闪场'], groupTitles: ['进行中'] }),
      BE_LIVE,
    ),
  },
  {
    name: 'home / 三组混排（进行中置顶）→ 通过',
    expect: 'pass',
    run: () => runHomeWith(
      homeMp({
        cardNames: ['进行中的场', '还没开的场', '已经结束的场'],
        groupTitles: ['进行中', '即将开始', '已结束'],
      }),
      [
        { id: '1', name: '进行中的场', status: 'open', startTime: '2020-01-01 10:00:00', endTime: '2099-12-31 22:00:00' },
        { id: '2', name: '还没开的场', status: 'open', startTime: '2099-01-01 10:00:00', endTime: '2099-12-31 22:00:00' },
        { id: '3', name: '已经结束的场', status: 'closed', startTime: '2020-01-01 10:00:00', endTime: '2020-02-01 22:00:00' },
      ],
    ),
  },
  {
    name: 'home / ★页面显示前端 mock 文案（与后端对不上）→ 必须 fail',
    expect: /没渲染出来|前端 mock/,
    run: () => runHomeWith(
      homeMp({ cardNames: ['示例场次（假数据）'], groupTitles: ['进行中'] }),
      BE_LIVE,
    ),
  },
  {
    name: 'home / ★banner 塌陷（swiper 里既无图也无默认占位）→ 必须 fail',
    expect: /banner 塌陷/,
    run: () => runHomeWith(
      homeMp({ banner: 'none', cardNames: ['8月上旬快闪场'], groupTitles: ['进行中'] }),
      BE_LIVE,
    ),
  },
  {
    name: 'home / ★缺订单入口区块 → 必须 fail',
    expect: /区块③|jp-entry-card/,
    run: () => runHomeWith(
      homeMp({ orderEntry: '', cardNames: ['8月上旬快闪场'], groupTitles: ['进行中'] }),
      BE_LIVE,
    ),
  },
  {
    name: 'home / ★分组顺序错（已结束排到了进行中前面）→ 必须 fail',
    expect: /分组标题不符/,
    run: () => runHomeWith(
      homeMp({
        cardNames: ['进行中的场', '已经结束的场'],
        groupTitles: ['已结束', '进行中'],
      }),
      [
        { id: '1', name: '进行中的场', status: 'open', startTime: '2020-01-01 10:00:00', endTime: '2099-12-31 22:00:00' },
        { id: '3', name: '已经结束的场', status: 'closed', startTime: '2020-01-01 10:00:00', endTime: '2020-02-01 22:00:00' },
      ],
    ),
  },
  {
    name: 'home / ★后端 0 条场（fixture 没了）→ 必须 fail 而不是假绿',
    expect: /0 条场/,
    run: () => runHomeWith(homeMp(), []),
  },

  /* ── product（GZ-JP-202）─────────────────────────────── */
  {
    name: 'product / 两跳可达 + 场·商品文案与后端一致 + 包邮 + notice 在 CTA 之上 → 通过',
    expect: 'pass',
    run: () => runProductWith(productMp(), beProduct()),
  },
  {
    name: 'product / 已结束场（closed + eventBookable=false，CTA 置灰 + 提示条）→ 通过',
    expect: 'pass',
    run: () => runProductWith(
      productMp({ endedBar: true, ctaClass: 'jp-product-cta__btn is-disabled' }),
      beProduct({ event: { status: 'closed' }, detail: { eventBookable: false } }),
    ),
  },
  {
    name: 'product / ★第 1 跳跳错页（首页场卡路由与场详情文件名对不上）→ 必须 fail',
    expect: /第 1 跳失败/,
    run: () => runProductWith(productMp({ hop1: '/pages/index/index' }), beProduct()),
  },
  {
    name: 'product / ★第 2 跳跳错页（商品卡路由不对）→ 必须 fail',
    expect: /第 2 跳失败/,
    run: () => runProductWith(productMp({ hop2: '/pages/event/index' }), beProduct()),
  },
  {
    name: 'product / ★场详情显示前端 mock 场名（与后端对不上）→ 必须 fail',
    expect: /场详情页头场名对不上/,
    run: () => runProductWith(productMp({ headName: '示例场次（假数据）' }), beProduct()),
  },
  {
    name: 'product / ★商品网格显示前端 mock 商品名 → 必须 fail',
    expect: /没渲染出来|商品卡数对不上/,
    run: () => runProductWith(productMp({ gridNames: ['示例商品（假数据）'] }), beProduct()),
  },
  {
    name: 'product / ★后端 closed 但页面没渲染「已结束」提示条 → 必须 fail',
    expect: /没渲染「本场已结束」提示条/,
    run: () => runProductWith(
      productMp({ endedBar: false, ctaClass: 'jp-product-cta__btn is-disabled' }),
      beProduct({ event: { status: 'closed' }, detail: { eventBookable: false } }),
    ),
  },
  {
    name: 'product / ★场没结束却显示「已结束」提示条（吓跑客人）→ 必须 fail',
    expect: /未结束）却渲染了/,
    run: () => runProductWith(productMp({ endedBar: true }), beProduct()),
  },
  {
    name: 'product / ★价格与后端 priceCent 对不上（分→元换算错）→ 必须 fail',
    expect: /商品价格对不上/,
    run: () => runProductWith(productMp({ price: '12800' }), beProduct()),
  },
  {
    name: 'product / ★价格旁没有「包邮」标识（AC）→ 必须 fail',
    expect: /没有「包邮」标识/,
    run: () => runProductWith(productMp({ priceRowText: '¥ 128' }), beProduct()),
  },
  {
    name: 'product / ★注意事项区块整个不见了 → 必须 fail',
    expect: /没有注意事项区块/,
    run: () => runProductWith(productMp({ noticeBody: null }), beProduct()),
  },
  {
    name: 'product / ★注意事项正文被截断（"…介意慎拍" 只显示前半段）→ 必须 fail',
    expect: /注意事项正文与后端不一致/,
    run: () => runProductWith(productMp({ noticeBody: '日本线下采购，包装可能有轻微…' }), beProduct()),
  },
  {
    name: 'product / ★注意事项被排到 CTA 之后（违反甲方硬要求）→ 必须 fail',
    expect: /排在了 CTA 之后/,
    run: () => runProductWith(
      productMp({
        markup: '<view class="jp-product-detail">…<view class="jp-product-cta">…</view>…<view class="jp-product-notice">…</view></view>',
      }),
      beProduct(),
    ),
  },
  {
    name: 'product / ★★ 场已结束（eventBookable=false）但加购按钮仍可点 → 必须 fail',
    expect: /置灰状态与后端 eventBookable 不符/,
    run: () => runProductWith(
      productMp({ endedBar: true, ctaClass: 'jp-product-cta__btn' }),
      beProduct({ event: { status: 'closed' }, detail: { eventBookable: false } }),
    ),
  },
  {
    name: 'product / ★场进行中却把加购按钮置灰（白白拦掉成交）→ 必须 fail',
    expect: /置灰状态与后端 eventBookable 不符/,
    run: () => runProductWith(productMp({ ctaClass: 'jp-product-cta__btn is-disabled' }), beProduct()),
  },
  {
    name: 'product / ★后端该场 0 件在架商品（fixture 没了）→ 必须 fail 而不是假绿',
    expect: /0 件在架商品/,
    run: () => runProductWith(productMp(), beProduct({ products: [], detail: null })),
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
