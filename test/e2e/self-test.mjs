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

// node 内置模块（静态 import 会被提升到文件最前面执行 —— 它们不读下面那个环境变量，无副作用）
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 假句柄的「渲染」是瞬时的，flow 里为真模拟器准备的 sleep 纯属空等 —— 归零后整轮秒级。
// ★ 只缩放等待时长，不改任何断言、不跳过任何步骤（见 mp-e2e.mjs 的 SLEEP_SCALE 注释）。
// 必须在 import flow 之前设置：mp-e2e.mjs 在模块加载时读一次该值。
process.env.MP_E2E_SLEEP_SCALE = '0'

// 真 deep()/deepAll()：meta 用例拿它跑一遍「mp-e2e 造 xpath → 假件反解析」的闭环
const { deep: deepQuery, deepAll: deepAllQuery } = await import('./mp-e2e.mjs')
const { run: runSmoke } = await import('./flows/smoke.mjs')
const { run: runLogin } = await import('./flows/login.mjs')
const { runWith: runHomeWith } = await import('./flows/home.mjs')
const { runWith: runProductWith } = await import('./flows/product.mjs')
const { runWith: runCartWith } = await import('./flows/cart.mjs')
const { runWith: runCheckoutWith } = await import('./flows/checkout.mjs')

/* ───────────────────────── 假 miniProgram 句柄 ───────────────────────── */

/**
 * 假 Element：tap 触发注册的副作用；attribute/property **每次现取**。
 *
 * ⚠️ 必须 lazy：真 automator 的 Element.attribute() 每次都发一次 RPC 拿实时值，
 * flow 里「先拿到 el → tap → 再读同一个 el 的 class」是合法且常用的写法。
 * 假件若快照 spec，就会把这种写法误判成 flow 的 bug。
 */
function makeEl(getSpec, onTap, hooks = {}) {
  return {
    // 真 automator 的 Element 有 tagName；mp-e2e 靠它区分「xpath 命中」与「未命中的空壳」
    // （未命中时 devtools 也会给一个对象，只是 tagName 缺失）——假件不给就等于全都算未命中。
    tagName: getSpec()?.tag ?? 'view',
    tap: async () => { onTap && onTap() },
    attribute: async name => getSpec()?.attrs?.[name],
    property: async name => getSpec()?.props?.[name],
    text: async () => getSpec()?.text ?? '',
    wxml: async () => getSpec()?.wxml || '<view/>',
    // 真 automator 的 Element 有这两个（表单场景要用）：input 往输入框打字、trigger 派发自定义事件
    // （原生 picker 点不动，只能 trigger('change', {value:[...]})）。
    input: async value => hooks.onInput && hooks.onInput(value),
    trigger: async (type, detail) => hooks.onTrigger && hooks.onTrigger(type, detail),
  }
}

/**
 * 造一个假 mp。
 * @param {object} cfg
 * @param {(path:string)=>object} cfg.pageFor  按当前路径返回 { path, views, els:{sel:spec} }
 * @param {object} cfg.storage                 uni storage 的模拟
 * @param {(sel:string)=>void} cfg.onTap       点击副作用
 */
/**
 * 拦住手写的 `祖先 >>> 后代`。
 *
 * <p>它在真 devtools 上是<b>静默失效</b>的：只按祖先匹配，`>>>` 后半截被整段忽略，
 * 于是「查到了」的其实是祖先自己（见 mp-e2e.mjs {@code deep} 的实测记录）。
 * 假件<b>不能</b>把它当成能用 —— 那会让 self-test 绿而真模拟器红。
 * 跨组件一律走 {@code deep/deepAll/deepTexts}（xpath 实现）。</p>
 */
function rejectLegacyDeepSelector(sel) {
  if (String(sel).includes('>>>')) {
    throw new Error(
      `选择器用了 '>>>'（${sel}）—— 它在真 devtools 上静默失效（只匹配祖先），`
      + '跨组件请改用 mp-e2e 的 deep/deepAll/deepTexts',
    )
  }
}

/**
 * 反解析 mp-e2e {@code toXpath} 造出来的 xpath，还原成「选择器 + 第几个」。
 *
 * <p>假件没有真 DOM，只能按约定回读：`(//*[contains(…" foo "…)])[2]` → `{ sel: '.foo', index: 2 }`、
 * `(//view)[3]` → `{ sel: 'view', index: 3 }`。解析不出来就<b>抛</b> ——
 * 说明 mp-e2e 换了 xpath 写法而这里没跟上，宁可红也不要静默返回 null（那会让 flow 假绿）。</p>
 */
function parseXpath(xp) {
  const s = String(xp)
  const idx = /\)\[(\d+)\]\s*$/.exec(s)
  const index = idx ? Number(idx[1]) : 1
  const classes = [...s.matchAll(/normalize-space\(@class\), " "\), " ([\w-]+) "\)/g)].map(m => m[1])
  if (classes.length) return { sel: `.${classes.join('.')}`, index }
  const tag = /\/\/([a-z][\w-]*)/i.exec(s)
  if (tag) return { sel: tag[1], index }
  throw new Error(`假件看不懂这个 xpath（mp-e2e 的 toXpath 改了写法？）：${xp}`)
}

/* ───────────── 组件边界（假件必须复刻的 automator 真语义）───────────── */

/**
 * 扫 src 的**模板区**，收集 `class="…"`（含 `:class="{ 'x': y }"` 里的字面量）出现过的类名。
 * 只扫 `<template>` 到 `</template>`，避开 `<style>` 里的选择器 ——
 * 页面样式常有 `:deep(.biz-xxx)` 这类跨组件覆写，混进来会把组件内部的类误判成页面作用域的。
 */
function collectTemplateClasses(dir, out = new Set()) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) { collectTemplateClasses(p, out); continue }
    if (!ent.name.endsWith('.vue')) continue
    const src = readFileSync(p, 'utf8')
    const start = src.indexOf('<template')
    const end = src.lastIndexOf('</template>')
    if (start < 0 || end <= start) continue
    const tpl = src.slice(start, end)
    for (const m of tpl.matchAll(/\bclass="([^"]*)"/g)) {
      for (const c of m[1].split(/\s+/)) if (c && !/[{}]/.test(c)) out.add(c)
    }
    for (const m of tpl.matchAll(/'([\w-]+)'\s*:/g)) out.add(m[1]) // :class="{ 'is-on': x }"
  }
  return out
}

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

/**
 * 「只存在于自定义组件内部」的类名集合 = 组件模板里出现过、页面模板里没出现过。
 *
 * <p><b>这是本假件最重要的一条真语义</b>（GZ-JP-204 踩出来的）：微信 {@code SelectorQuery}
 * 不跨自定义组件边界，页面作用域查组件内部的类<b>恒为 null / 空数组</b>。空数组最阴 ——
 * 「页面上不该有 X」这类断言会因此<b>恒真</b>，写了等于没写。</p>
 *
 * <p>假件如果对 `page.$('.biz-x')` 与 `deep(page,'.biz-x')` 一视同仁，就照不出「flow 忘了用
 * deep()」这类 bug，self-test 全绿而真模拟器必红 —— 那正是 D2/D3 那几个 flow 的处境。
 * 所以这里按 src 真实归属判定：<b>组件内部的类，只有带 `>>>` 的查询才看得见</b>。</p>
 *
 * <p>归属从 src 现算，不写死清单 —— 组件重构 / 类名改名后不会悄悄失真。</p>
 */
const COMPONENT_ONLY_CLASSES = (() => {
  const pageCls = collectTemplateClasses(path.join(SRC_DIR, 'pages'))
  // 页面之外的一切（components/ layouts/ tabbar/ …）都是「组件作用域」
  const otherCls = new Set()
  for (const ent of readdirSync(SRC_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name === 'pages') continue
    collectTemplateClasses(path.join(SRC_DIR, ent.name), otherCls)
  }
  if (!pageCls.size || !otherCls.size) {
    throw new Error(
      `扫不到 src 模板里的类名（pages=${pageCls.size} / others=${otherCls.size}）——`
      + ' 组件边界模拟会失效，self-test 会变成假绿。检查 SRC_DIR 是否还对：' + SRC_DIR,
    )
  }
  return new Set([...otherCls].filter(c => !pageCls.has(c)))
})()

/** 该选择器是不是「只在组件内部存在」（⇒ 页面作用域查询必须查不到）。 */
function isComponentOnly(sel) {
  const m = /^\.([\w-]+)$/.exec(String(sel).trim())
  return !!m && COMPONENT_ONLY_CLASSES.has(m[1])
}

function makeMp(cfg) {
  let cur = '/pages/index/index'
  // ⚠️ 真 automator 的 page.$() 每次都查**当前**渲染树，所以这里也必须每次重新算，
  //    不能在 reLaunch 时快照一份 —— 否则「点一下 → 页面变了」这类交互全测不出来。
  const mkPage = () => ({
    get path() { return cfg.pageFor(cur.split('?')[0]).path },
    // 真 automator 的 Page 暴露 query（= onLoad 的 options）。flow 用它验「跳转带对了参数」，
    // 假件必须一起提供，否则那类断言在 self-test 里恒为 undefined = 恒 fail。
    get query() {
      const qs = cur.split('?')[1] || ''
      const out = {}
      for (const kv of qs.split('&')) {
        if (!kv) continue
        const i = kv.indexOf('=')
        const k = i < 0 ? kv : kv.slice(0, i)
        out[decodeURIComponent(k)] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1))
      }
      return out
    },
    $: async (sel) => {
      rejectLegacyDeepSelector(sel)
      // ★ 真语义：页面作用域查组件内部 → null（不是「查得到」）。见 COMPONENT_ONLY_CLASSES。
      if (isComponentOnly(sel)) return null
      const getSpec = () => cfg.pageFor(cur.split('?')[0]).els?.[sel]
      return getSpec()
        ? makeEl(getSpec, () => cfg.onTap?.(sel), {
            onInput: v => cfg.onInput?.(sel, v),
            onTrigger: (type, detail) => cfg.onTrigger?.(sel, type, detail),
          })
        : null
    },
    // 真 automator 的 $$ 按选择器查全部匹配节点。smoke 用它数 view，
    // home/cart 要用它取一组文本（场卡片名 / 分组标题 / 车里的商品名），所以 lists 里登记过的
    // 选择器返回带 text 的假元素。
    $$: async (sel) => {
      rejectLegacyDeepSelector(sel)
      const spec = cfg.pageFor(cur.split('?')[0])
      // ★ 真语义：页面作用域查组件内部 → 空数组（最阴的一种失败：让「不该有 X」恒真）
      if (isComponentOnly(sel)) return []
      const list = spec.lists?.[sel]
      if (list) return list.map(text => makeEl(() => ({ text }), () => cfg.onTap?.(sel)))
      // 数 view：页面作用域只看得见页面自己模板里的那些（组件渲染出来的要走 xpath，见下）
      if (sel === 'view') return Array.from({ length: spec.views ?? 10 })
      return []
    },
    /**
     * 跨组件查询（mp-e2e 的 deep/deepAll/deepTexts 都落到这里）。
     *
     * <p>与 {@code $}/{@code $$} 的关键区别：xpath <b>看得见组件内部</b>（真 automator 实测如此），
     * 所以这里不做组件边界拦截；但「未命中 → null」必须照做 —— deepAll 的下标循环靠它收敛。</p>
     */
    xpath: async (xp) => {
      const { sel, index } = parseXpath(xp)
      const spec = cfg.pageFor(cur.split('?')[0])
      const list = spec.lists?.[sel]
      if (list) {
        const text = list[index - 1]
        return text === undefined ? null : makeEl(() => ({ text }), () => cfg.onTap?.(sel))
      }
      if (sel === 'view') {
        return index <= ((spec.viewsDeep ?? spec.views) ?? 10) ? makeEl(() => ({}), () => {}) : null
      }
      const getSpec = () => cfg.pageFor(cur.split('?')[0]).els?.[sel]
      if (index !== 1 || !getSpec()) return null
      return makeEl(getSpec, () => cfg.onTap?.(sel), {
        onInput: v => cfg.onInput?.(sel, v),
        onTrigger: (type, detail) => cfg.onTrigger?.(sel, type, detail),
      })
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

/**
 * smoke 的页表。
 *
 * <p><b>views vs viewsDeep</b>（照着真产物填，别拍脑袋）：{@code views} = <b>页面自己模板里</b>
 * 渲染出的 view 数（{@code page.$$('view')} 看得见的），{@code viewsDeep} = 连组件内部一起算
 * （{@code '.jp-screen >>> view'}）。本工程空态 / 游客态页的内容全在 BizPanel + BizState 里，
 * 页面作用域只剩两层壳 —— 下面 {@code views: 2} 的三页是<b>数真编译产物数出来的</b>
 * （dist 的 pages/cart/index.wxml 等），smoke 若退回「只数页面作用域 view」就会把它们
 * 判成空壳假红。这三行等于把那个约束钉在这里，不用再靠人记。</p>
 */
const ALL_PAGES = {
  // GZ-JP-201 起首页标志元素是 .jp-home__events（场次区块，四态都渲染）
  'pages/index/index': { views: 8, viewsDeep: 40, els: { '.jp-home__events': {} } },
  // 游客态页面级只有 .block / .section-title-wrap / .block--tail 三层壳，内容全在 MeHeader/MeGrid 里
  'pages/me/index': { views: 3, viewsDeep: 24, els: { '.me-header__top': {} } },
  'pages/me/about': { views: 6, viewsDeep: 14 },
  'pages/me/profile': { views: 10, viewsDeep: 20 },
  'pages/agreement/index': { views: 4, viewsDeep: 9 },
  'pages/login/index': { views: 7, viewsDeep: 16 },
  // GZ-JP-202 新增两页
  'pages/event/index': { views: 12, viewsDeep: 30, els: { '.jp-event-detail__grid': {} } },
  'pages/product/detail': { views: 14, viewsDeep: 30, els: { '.jp-product-detail': {} } },
  // GZ-JP-203 新增一页。★ 游客/加载态页面级只有 .jp-cart + .jp-pad(jp-cart__state) 两个 view
  'pages/cart/index': { views: 2, viewsDeep: 9, els: { '.jp-cart': {} } },
  // GZ-JP-204 新增两页。★ smoke 不带 ids ⇒ 空态；不带 orderId ⇒ 轮询态，都只有两层页面级壳
  'pages/order/confirm': { views: 2, viewsDeep: 9, els: { '.jp-confirm': {} } },
  'pages/order/result': { views: 2, viewsDeep: 9, els: { '.jp-payres': {} } },
  // GZ-JP-205 新增两页。★ 同样是两层页面级壳：list 游客态命中「登录后查看订单」空态、
  // detail 不带 id 命中「订单不存在」空态，内容都在 BizPanel/BizState 组件里
  'pages/order/list': { views: 2, viewsDeep: 9, els: { '.jp-odl': {} } },
  'pages/order/detail': { views: 2, viewsDeep: 9, els: { '.jp-odt': {} } },
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

/**
 * cart 用（GZ-JP-203）：**假 app + 假后端**联动的场景机。
 *
 * <p>与前几个 flow 的假件不同，购物车是**读写混合**的流程：点加购要真往「后端」写一行、
 * 点 + 号要真改数量、页面渲染要跟着「后端」变。所以这里造一个内存版后端 {@code be}，
 * 假 app 的 tap 去改它、假页面从它渲染，而 flow 拿到的 {@code readCart} 读的也是它 ——
 * 于是「页面与后端对得上」这条断言在假件里同样是**有内容的**，negative 用例只要让两者
 * 故意脱钩（页面写死文案 / 合计不跟随 / 加购不落库）就必然 fail。</p>
 *
 * 每个可配项都对应一条 negative 能打到的点。
 */
function cartScenario({
  priceCent = 12800,
  /**
   * 失效行（模拟「客人正要去结算时，另一个场刚被店员关掉」）。
   *
   * <p>刻意在**进购物车页那一刻**才注入后端，而不是一开始就有 —— flow 起手会
   * {@code clearCart()} 拿确定性起点，一开始就放会被清掉；而且「加购后后端恰好 1 款」
   * 这条断言（防加购写出两行）也必须留着。</p>
   */
  invalidRows = [],
  /** 点加购是否真落库（false = 还是 202 的占位 toast） */
  addToCartWorks = true,
  /** 加购按钮是否置灰（模拟场已结束的 fixture） */
  ctaDisabled = false,
  /** 购物车入口跳到哪（negative：跳错页） */
  hop3 = '/pages/cart/index',
  /** 页面渲染的组名 / 商品名（negative：前端 mock 文案） */
  renderGroupNames = null,
  renderItemNames = null,
  /** 页面合计写死不跟后端（negative） */
  freezeTotal = false,
  /** + 号是否真改后端数量（negative：改数量没落库） */
  qtyPlusWorks = true,
  /** 底部条额外文案（negative：多出一行费用） */
  barExtraText = '',
  /** 底部条不标「已包邮」（negative） */
  omitIncludedNote = false,
  /** 「去结算」恒置灰 / 恒可点（negative：闸门写死） */
  checkoutAlwaysDisabled = false,
  checkoutNeverDisabled = false,
  /** 角标文案覆盖（negative：与后端款数对不上） */
  badgeOverride = null,
  /** 失效行是否渲染「已失效」标（negative） */
  renderInvalidBadge = true,
  /** 失效行金额是否被算进页面合计（negative） */
  invalidCountedInTotal = false,
} = {}) {
  // ── 内存版后端
  const be = { items: [] }
  /** 把配置里的失效行注入后端（进购物车页那一刻触发，只注入一次）。 */
  let invalidSeeded = false
  const seedInvalid = () => {
    if (invalidSeeded) return
    invalidSeeded = true
    for (const [i, r] of invalidRows.entries()) {
      be.items.push({
        id: `9${i}`,
        productId: `9${i}`,
        name: r.name,
        eventName: r.eventName,
        qty: r.qty ?? 1,
        priceCent: r.priceCent ?? 9900,
        invalid: true,
        invalidText: r.invalidText ?? '本场已结束',
      })
    }
  }
  const EVENT_NAME = '8月上旬快闪场'
  const PRODUCT = { id: '1', name: '柯南 吧唧 一番赏 A赏', priceCent, eventBookable: !ctaDisabled }

  const readCart = () => {
    const byEvent = new Map()
    for (const it of be.items) {
      const key = it.eventName
      if (!byEvent.has(key)) byEvent.set(key, [])
      byEvent.get(key).push({
        id: it.id,
        productId: it.productId,
        name: it.name,
        priceCent: it.priceCent,
        qty: it.qty,
        amountCent: it.priceCent * it.qty,
        invalid: it.invalid,
        invalidText: it.invalid ? it.invalidText : null,
      })
    }
    const groups = [...byEvent.entries()].map(([eventName, items]) => ({
      eventId: eventName === EVENT_NAME ? '1' : '2',
      eventName,
      eventBookable: items.every(i => !i.invalid),
      items,
    }))
    const valid = be.items.filter(i => !i.invalid)
    return {
      groups,
      itemCount: be.items.length,
      invalidCount: be.items.length - valid.length,
      validQty: valid.reduce((s, i) => s + i.qty, 0),
      validAmountCent: valid.reduce((s, i) => s + i.priceCent * i.qty, 0),
    }
  }
  const clearCart = () => {
    const n = be.items.length
    be.items = []
    return n
  }

  // ── 页面状态
  const st = { allSelected: true, frozenTotal: null }

  const yuan = (cent) => {
    const y = cent / 100
    return Number.isInteger(y) ? String(y) : y.toFixed(2)
  }
  /** 页面渲染出来的合计（negative 可以让它与后端脱钩）。 */
  const pageTotal = () => {
    const c = readCart()
    if (!st.allSelected) return '0'
    if (freezeTotal && st.frozenTotal !== null) return st.frozenTotal
    const base = invalidCountedInTotal
      ? be.items.reduce((s, i) => s + i.priceCent * i.qty, 0)
      : c.validAmountCent
    const v = yuan(base)
    if (freezeTotal && st.frozenTotal === null) st.frozenTotal = v
    return v
  }

  const mp = makeMp({
    storage: { token: JSON.stringify({ tokenInfo: { token: 'fake-sa-token-for-self-test', expiresIn: 999 } }) },
    onTap: (sel) => {
      if (sel === '.jp-event-card') mp.__goto('/pages/event/index')
      if (sel === '.jp-product-card') mp.__goto('/pages/product/detail')
      if (sel === '.jp-product-cta__btn' && addToCartWorks && !ctaDisabled) {
        be.items.push({
          id: '11',
          productId: PRODUCT.id,
          name: PRODUCT.name,
          eventName: EVENT_NAME,
          qty: 1,
          priceCent,
          invalid: false,
        })
      }
      if (sel === '.jp-product-cta__cart') {
        seedInvalid() // 「刚要去结算，另一个场被关了」
        mp.__goto(hop3)
      }
      if (sel === '.biz-stepper__plus' && qtyPlusWorks) {
        const row = be.items.find(i => !i.invalid)
        if (row) row.qty += 1
      }
      if (sel === '.jp-cart-bar__all') st.allSelected = !st.allSelected
    },
    pageFor: (p) => {
      const key = p.replace(/^\//, '')
      const els = {}
      const lists = {}
      const cart = readCart()

      if (key === 'pages/me/index') {
        els['.me-header__top'] = {}
        els['.logout-btn'] = {} // 恒登录态（登录路径本身由 login flow 的用例覆盖）
      }
      if (key === 'pages/index/index') {
        els['.jp-event-card'] = { text: EVENT_NAME }
        els['.jp-entry-card'] = { text: '我的订单' }
      }
      if (key === 'pages/event/index') {
        els['.jp-event-detail__grid'] = {}
        els['.jp-product-card'] = { text: PRODUCT.name }
      }
      if (key === 'pages/product/detail') {
        els['.jp-product-detail'] = {}
        els['.jp-product-cta__btn'] = {
          attrs: { class: ctaDisabled ? 'jp-product-cta__btn is-disabled' : 'jp-product-cta__btn' },
        }
        els['.jp-product-cta__cart'] = {}
        const badge = badgeOverride === null ? String(cart.itemCount) : badgeOverride
        if (badge) els['.jp-product-cta__cart-badge'] = { text: badge }
      }
      if (key === 'pages/cart/index') {
        els['.jp-cart'] = {}
        const total = pageTotal()
        const note = omitIncludedNote ? '' : '已包邮'
        const barText = `全选 合计 ¥ ${total} ${note} ${barExtraText} 去结算`.replace(/\s+/g, ' ').trim()
        els['.jp-cart-bar'] = {
          text: barText,
          wxml: `<view class="jp-cart-bar">${barText}</view>`,
        }
        els['.jp-cart-bar__total'] = { text: total }
        els['.jp-cart-bar__all'] = {}
        const disabled = checkoutAlwaysDisabled
          ? true
          : checkoutNeverDisabled ? false : !st.allSelected
        els['.jp-cart-bar__checkout'] = {
          attrs: { class: `jp-cart-bar__checkout${disabled ? ' is-disabled' : ''}` },
        }
        if (cart.itemCount > 0) els['.biz-stepper__plus'] = {}
        lists['.jp-cart__group-name'] = renderGroupNames ?? cart.groups.map(g => g.eventName)
        lists['.biz-cart-item__name'] = renderItemNames
          ?? cart.groups.flatMap(g => g.items.map(i => i.name))
        lists['.biz-cart-item__mask-text'] = renderInvalidBadge
          ? cart.groups.flatMap(g => g.items.filter(i => i.invalid).map(() => '已失效'))
          : []
      }
      return { path: key, views: 16, els, lists }
    },
  })
  return { mp, data: { event: { id: '1', name: EVENT_NAME, status: 'open' }, product: PRODUCT, readCart, clearCart } }
}

/** 跑一个 cart 场景（把 scenario 拆好的 mp 与注入项喂给 flow 的断言主体）。 */
function runCart(opts) {
  const { mp, data } = cartScenario(opts)
  return runCartWith(mp, data)
}

/**
 * checkout 用（GZ-JP-204）：**假 app + 假后端**的下单到支付场景机（比 cart 又深一档）。
 *
 * <p>内存版后端同时管四张「表」：购物车 / 地址簿 / 订单 / 订单行。假 app 的 tap 与 input 去改它，
 * 假页面从它渲染，flow 拿到的 {@code readCart / readAddresses / readOrders / readOrderDetail}
 * 读的也是它 —— 于是「页面与后端对得上」「订单真落库」「支付真走完」这些断言在假件里同样是
 * <b>有内容的</b>，negative 只要让两者脱钩就必然 fail。</p>
 *
 * 每个可配项都对应一条 negative 能打到的点。
 */
function checkoutScenario({
  priceCent = 12800,
  qty = 2,
  /** 起手地址簿（空 = 只能走「新增」路径） */
  addresses = [{ id: '1', recipientName: '张三', mobile: '13800000000', province: '四川省', city: '成都市', district: '锦江区', detail: '春熙路 1 号', isDefault: 1 }],
  /** 「去结算」跳到哪（negative：跳错页） */
  hopConfirm = '/pages/order/confirm',
  /** 去结算带的参数（negative：传成 productId / 干脆不传） */
  idsOverride = null,
  /** 确认页显示的地址收件人（negative：与后端默认地址对不上） */
  addressNameOverride = null,
  /** 保存地址是否真落库（negative：只是关了弹层） */
  saveAddressWorks = true,
  /** 表单缺哪个字段（negative：新增能力没做全） */
  omitFormFields = [],
  /** 页面渲染的商品名（negative：前端 mock 文案） */
  renderItemNames = null,
  /** 清单里混进 stepper / 删除（negative：清单不是只读的） */
  renderStepper = false,
  renderDelete = false,
  /** 金额区多一行（negative：出现第三行 / 出现费用字样） */
  sumExtraRowText = null,
  /** 金额区显示的实付（negative：与后端 Σ 行金额脱钩） */
  totalOverride = null,
  /** 「已阅读不支持退款」勾选是否存在（negative：漏做了举证那一半） */
  hasAgreeBox = true,
  /** 勾选文案（negative：文案里没提退款） */
  agreeCopy = '我已阅读并同意《拼团购买须知》，知悉商品下单后不支持退款',
  /** 提交闸门写死（negative：恒可点 / 恒置灰） */
  submitNeverDisabled = false,
  submitAlwaysDisabled = false,
  /** 提交是否真建单（negative：点了没反应 / 只跳页不落库） */
  submitWorks = true,
  /** 提交后落到哪（negative：没跳支付结果页） */
  hopResult = '/pages/order/result',
  /** mock 支付是否真驱动结算（negative：订单停在 created） */
  payWorks = true,
  /** 支付后是否清车（negative：车里还留着已经买过的东西） */
  clearCartOnSubmit = true,
  /** 结果页文案（negative：后端已 paid 页面还在转圈） */
  resultTextOverride = null,
} = {}) {
  const EVENT_NAME = '8月上旬快闪场'
  const PRODUCT = { id: '1', name: '柯南 吧唧 一番赏 A赏', priceCent, eventName: EVENT_NAME }

  // ── 内存版后端（4 张表）
  const be = {
    cart: [{ id: '57', productId: PRODUCT.id, name: PRODUCT.name, eventName: EVENT_NAME, qty, priceCent, invalid: false }],
    addresses: addresses.map(a => ({ ...a })),
    orders: [],
    seq: 1,
  }

  const readCart = () => {
    const items = be.cart.map(it => ({
      id: it.id,
      productId: it.productId,
      name: it.name,
      priceCent: it.priceCent,
      qty: it.qty,
      amountCent: it.priceCent * it.qty,
      invalid: it.invalid,
      invalidText: it.invalid ? '本场已结束' : null,
    }))
    const valid = items.filter(i => !i.invalid)
    return {
      groups: items.length ? [{ eventId: '1', eventName: EVENT_NAME, eventBookable: true, items }] : [],
      itemCount: items.length,
      invalidCount: items.length - valid.length,
      validQty: valid.reduce((s, i) => s + i.qty, 0),
      validAmountCent: valid.reduce((s, i) => s + i.amountCent, 0),
    }
  }
  const readAddresses = () => be.addresses.map(a => ({ ...a }))
  const readOrders = () => ({
    total: be.orders.length,
    rows: [...be.orders].reverse().map(o => ({
      id: o.id,
      orderNo: o.orderNo,
      totalAmountCent: o.totalAmountCent,
      businessStatus: o.businessStatus,
      itemCount: o.items.length,
    })),
  })
  const readOrderDetail = id => be.orders.find(o => String(o.id) === String(id)) ?? null

  const amountOfCart = () => readCart().validAmountCent

  // ── 页面状态
  const st = { agreed: false, sheet: 'none', form: {}, addrName: null, submitted: false }
  const currentAddrName = () => {
    if (addressNameOverride !== null) return addressNameOverride
    if (st.addrName) return st.addrName
    const def = be.addresses.find(a => Number(a.isDefault) === 1) ?? be.addresses[0]
    return def ? def.recipientName : null
  }

  const yuan = (cent) => {
    const y = cent / 100
    return Number.isInteger(y) ? String(y) : y.toFixed(2)
  }

  const mp = makeMp({
    storage: { token: JSON.stringify({ tokenInfo: { token: 'fake-sa-token-for-self-test', expiresIn: 999 } }) },
    onInput: (sel, v) => {
      if (sel === '.jp-addr-form__name') st.form.recipientName = v
      if (sel === '.jp-addr-form__mobile') st.form.mobile = v
      if (sel === '.jp-addr-form__detail') st.form.detail = v
    },
    onTrigger: (sel, type, detail) => {
      if (sel === '.jp-addr-form__region' && type === 'change') {
        const v = detail?.value ?? []
        st.form.province = v[0]
        st.form.city = v[1]
        st.form.district = v[2]
      }
    },
    onTap: (sel) => {
      if (sel === '.jp-cart-bar__checkout') {
        const ids = idsOverride === null ? be.cart.map(i => i.id).join(',') : idsOverride
        mp.__goto(ids ? `${hopConfirm}?ids=${ids}` : hopConfirm)
      }
      if (sel === '.jp-confirm-addr') st.sheet = be.addresses.length ? 'pick' : 'form'
      if (sel === '.jp-addr-sheet__add') st.sheet = 'form'
      if (sel === '.jp-addr-form__save') {
        if (saveAddressWorks) {
          const id = String(1000 + be.addresses.length)
          be.addresses.push({
            id,
            recipientName: st.form.recipientName,
            mobile: st.form.mobile,
            province: st.form.province,
            city: st.form.city,
            district: st.form.district,
            detail: st.form.detail,
            isDefault: 0,
          })
          st.addrName = st.form.recipientName
        }
        st.sheet = 'none'
      }
      if (sel === '.jp-confirm-agree__box-wrap') st.agreed = !st.agreed
      if (sel === '.jp-confirm-bar__submit') {
        const canSubmit = submitAlwaysDisabled ? false : (submitNeverDisabled || st.agreed)
        if (!canSubmit || st.submitted) return
        st.submitted = true
        if (submitWorks) {
          const id = String(be.seq++)
          be.orders.push({
            id,
            orderNo: `JPO-20260807-00000${id}`,
            totalAmountCent: amountOfCart(),
            businessStatus: payWorks ? 'paid' : 'created',
            businessStatusLabel: payWorks ? '已支付' : '待支付',
            paidTime: payWorks ? '2026-08-07 07:20:21' : null,
            items: be.cart.map(it => ({ id: `i${it.id}`, name: it.name, qty: it.qty, fulfillStatus: 'purchasing' })),
          })
          if (clearCartOnSubmit) be.cart = []
        }
        mp.__goto(hopResult)
      }
    },
    pageFor: (p) => {
      const key = p.replace(/^\//, '')
      const els = {}
      const lists = {}

      if (key === 'pages/me/index') {
        els['.me-header__top'] = {}
        els['.logout-btn'] = {} // 恒登录态
      }
      if (key === 'pages/index/index') {
        els['.jp-home__events'] = {}
        els['.jp-entry-card'] = { text: '我的订单' }
      }
      if (key === 'pages/cart/index') {
        els['.jp-cart'] = {}
        els['.jp-cart-bar__checkout'] = { attrs: { class: 'jp-cart-bar__checkout' } }
      }
      if (key === 'pages/order/confirm') {
        els['.jp-confirm'] = {}
        // 地址区
        els['.jp-confirm-addr'] = {}
        const an = currentAddrName()
        if (an) els['.jp-confirm-addr__name'] = { text: an }
        // 地址弹层
        if (st.sheet === 'pick') els['.jp-addr-sheet__add'] = {}
        if (st.sheet === 'form') {
          const F = {
            '.jp-addr-form__name': {},
            '.jp-addr-form__mobile': {},
            '.jp-addr-form__region': {},
            '.jp-addr-form__detail': {},
            '.jp-addr-form__save': {},
          }
          for (const [k, v] of Object.entries(F)) {
            if (!omitFormFields.includes(k)) els[k] = v
          }
        }
        // 金额区（★ 只有两行）
        const total = totalOverride === null ? yuan(amountOfCart()) : totalOverride
        const rows = ['商品合计', '实付']
        if (sumExtraRowText) rows.push(sumExtraRowText)
        const sumText = `${rows.join(' ')} ¥ ${total} 已包邮`
        els['.jp-confirm-sum'] = { text: sumText, wxml: `<view class="jp-confirm-sum">${sumText}</view>` }
        els['.jp-confirm-sum__total'] = { text: total }
        lists['.jp-confirm-sum__row'] = rows
        // 已阅读不支持退款
        if (hasAgreeBox) {
          els['.jp-confirm-agree__box-wrap'] = {}
          els['.jp-confirm-agree__text'] = { text: agreeCopy }
        }
        // 提交
        const disabled = submitAlwaysDisabled ? true : submitNeverDisabled ? false : !st.agreed
        els['.jp-confirm-bar__submit'] = {
          attrs: { class: `jp-confirm-bar__submit${disabled ? ' is-disabled' : ''}` },
        }
        // 清单（只读：默认不出操作区 / stepper / 删除，数量静态展示）
        const cartRows = readCart().groups.flatMap(g => g.items)
        lists['.biz-cart-item__name'] = renderItemNames ?? cartRows.map(i => i.name)
        lists['.biz-cart-item__qty-text'] = renderStepper || renderDelete ? [] : cartRows.map(i => `×${i.qty}`)
        lists['.biz-cart-item__ops'] = renderStepper || renderDelete ? cartRows.map(() => '') : []
        lists['.biz-stepper__plus'] = renderStepper ? ['+'] : []
        lists['.biz-cart-item__del'] = renderDelete ? ['删除'] : []
      }
      if (key === 'pages/order/result') {
        els['.jp-payres'] = {}
        els['.jp-payres__btn'] = {}
        const last = be.orders[be.orders.length - 1]
        const text = resultTextOverride
          ?? (last && last.businessStatus === 'paid' ? '支付成功' : '正在确认支付结果…')
        lists['.biz-state__text'] = [text]
      }
      return { path: key, views: 16, els, lists }
    },
  })

  return { mp, data: { product: PRODUCT, readCart, readAddresses, readOrders, readOrderDetail } }
}

/** 跑一个 checkout 场景。 */
function runCheckout(opts) {
  const { mp, data } = checkoutScenario(opts)
  return runCheckoutWith(mp, data)
}

/* ───────────────────────────── 用例 ───────────────────────────── */

const CASES = [
  /* ── 假件自身的体检：组件边界模拟必须真的在起作用 ─────────────────────
     这是本文件最容易「悄悄失效」的一环 —— src 目录挪位置 / 模板重构 / 扫不到 class，
     组件边界模拟就退化成 no-op：组件内选择器在页面作用域也查得到，于是**所有 flow
     用不用 deep() 都能过**，self-test 全绿而真模拟器全红（GZ-JP-204 之前正是这个处境）。
     下面三条把它钉死：归属判定对 + 真语义对。 */
  {
    name: 'meta / 组件内部的类必须被判成组件作用域（否则 flow 用不用 deep 都过 = 全体假绿）',
    expect: 'pass',
    run: async () => {
      // 逐一核对过归属（`grep -rn class= src`）：这些只出现在 src/components/** 的模板里
      const componentOnly = [
        '.biz-cart-item__name', '.biz-cart-item__mask-text', '.biz-stepper__plus', '.biz-state__text',
        '.jp-event-card', '.jp-event-card__name', '.jp-product-card', '.jp-product-card__name',
        '.jp-entry-card', '.login-sheet', '.login-agree__box', '.login-sheet__cta',
        '.me-header__top', '.hb__ph', '.hb__img',
      ]
      const bad = componentOnly.filter(s => !isComponentOnly(s))
      if (bad.length) {
        throw new Error(
          `这些选择器写在 src/components/** 里，却没被判成组件作用域：${bad.join(' / ')}`
          + '（组件边界模拟失效 = 本文件所有断言都不再管 flow 有没有用 deep()）',
        )
      }
    },
  },
  {
    name: 'meta / 页面模板里的类必须仍是页面作用域（别把 deep 当万能药乱套）',
    expect: 'pass',
    run: async () => {
      const pageScope = [
        '.jp-home__events', '.jp-home__group-title', '.jp-cart', '.jp-cart-bar__checkout',
        '.jp-cart__group-name', '.jp-confirm', '.jp-confirm-sum', '.jp-payres', '.logout-btn',
        '.jp-product-detail', '.jp-product-cta__btn', '.jp-event-detail__grid',
      ]
      const bad = pageScope.filter(s => isComponentOnly(s))
      if (bad.length) {
        throw new Error(`这些选择器写在 src/pages/** 里，却被判成组件作用域：${bad.join(' / ')}（归属扫描算错了）`)
      }
    },
  },
  {
    name: 'meta / 页面作用域查组件内部→查不到，deep()→查得到，>>> →直接报错（automator 真语义）',
    expect: 'pass',
    run: async () => {
      const page = await smokeMp().reLaunch('/pages/me/index')
      if (await page.$('.me-header__top')) {
        throw new Error('page.$ 查到了组件内部的 .me-header__top —— 假件没复刻「不跨组件边界」')
      }
      if ((await page.$$('.me-header__top')).length) {
        throw new Error('page.$$ 查到了组件内部的 .me-header__top —— 「不该存在 X」的断言会因此恒真')
      }
      // ★ 用**真** deep()（走 mp-e2e 的 toXpath → 假件的 xpath 反解析），
      //   等于顺带守住「mp-e2e 改了 xpath 写法而假件没跟上」这条缝
      if (!await deepQuery(page, '.me-header__top')) {
        throw new Error('deep() 查不到 .me-header__top —— mp-e2e 的 xpath 与假件的反解析对不上了')
      }
      if (await deepQuery(page, '.zzz-nonexistent')) {
        throw new Error('deep() 对不存在的选择器也返回了元素 —— 「元素存在」类断言会恒真')
      }
      if ((await deepAllQuery(page, '.zzz-nonexistent')).length) {
        throw new Error('deepAll() 对不存在的选择器返回了非空 —— 下标循环没有正确收敛')
      }
      let rejected = false
      await page.$('.jp-screen >>> .me-header__top').catch(() => { rejected = true })
      if (!rejected) {
        throw new Error('`>>>` 写法没被拦下 —— 它在真 devtools 上静默失效，假件放行就会制造假绿')
      }
    },
  },
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

  /* ── cart（GZ-JP-203）─────────────────────────────────── */
  {
    name: 'cart / 三跳可达 + 加购真落库 + 分组 + 合计 + 改数量 + 去结算闸门双向 → 通过',
    expect: 'pass',
    run: () => runCart(),
  },
  {
    name: 'cart / 车里已有一件失效商品（标「已失效」+ 不计入合计）→ 通过',
    expect: 'pass',
    run: () => runCart({
      invalidRows: [{ name: 'B 场商品丙', eventName: '7月下旬场', qty: 3, priceCent: 9900 }],
    }),
  },
  {
    name: 'cart / ★★ 点加购但没真落库（还是占位 toast）→ 必须 fail',
    expect: /后端购物车款数=0/,
    run: () => runCart({ addToCartWorks: false }),
  },
  {
    name: 'cart / ★加购按钮是置灰态（fixture 的场已结束）→ 必须 fail 并说清是 fixture 问题',
    expect: /加购按钮是置灰态/,
    run: () => runCart({ ctaDisabled: true }),
  },
  {
    name: 'cart / ★第 3 跳跳错页（购物车入口路由与页面文件名对不上）→ 必须 fail',
    expect: /第 3 跳失败/,
    run: () => runCart({ hop3: '/pages/me/index' }),
  },
  {
    name: 'cart / ★购物车显示前端 mock 组名（与后端场名对不上）→ 必须 fail',
    expect: /没渲染成分组头|分组数对不上/,
    run: () => runCart({ renderGroupNames: ['示例场次（假数据）'] }),
  },
  {
    name: 'cart / ★购物车显示前端 mock 商品名 → 必须 fail',
    expect: /没渲染出来/,
    run: () => runCart({ renderItemNames: ['示例商品（假数据）'] }),
  },
  {
    name: 'cart / ★★ 底部合计区出现「运费」行（违反 REQ-ORDER-004 全包邮）→ 必须 fail',
    expect: /出现了另收费用的字样/,
    run: () => runCart({ barExtraText: '运费 ¥12' }),
  },
  {
    name: 'cart / ★底部合计旁没有「已包邮」标注 → 必须 fail',
    expect: /没有「已包邮」标注/,
    run: () => runCart({ omitIncludedNote: true }),
  },
  {
    name: 'cart / ★改数量没落库（+ 号只改了本地）→ 必须 fail',
    expect: /改数量没落库/,
    run: () => runCart({ qtyPlusWorks: false }),
  },
  {
    name: 'cart / ★后端数量变了但页面合计不跟（合计写死）→ 必须 fail',
    expect: /改数量后合计没刷新|合计与改之前相同/,
    run: () => runCart({ freezeTotal: true }),
  },
  {
    name: 'cart / ★★ 取消全选后「去结算」仍可点（AC 置灰不成立）→ 必须 fail',
    expect: /取消全选后「去结算」仍可点/,
    run: () => runCart({ checkoutNeverDisabled: true }),
  },
  {
    name: 'cart / ★「去结算」永远置灰（只测一个方向就会漏掉的那种写法）→ 必须 fail',
    expect: /有勾选项时「去结算」却是置灰的/,
    run: () => runCart({ checkoutAlwaysDisabled: true }),
  },
  {
    name: 'cart / ★失效商品没标「已失效」→ 必须 fail',
    expect: /没渲染「已失效」标/,
    run: () => runCart({
      invalidRows: [{ name: 'B 场商品丙', eventName: '7月下旬场' }],
      renderInvalidBadge: false,
    }),
  },
  {
    name: 'cart / ★★ 失效商品被算进了合计 → 必须 fail',
    expect: /失效项被算进了合计|合计与后端 validAmountCent|首次进页面（默认全选）合计对不上/,
    run: () => runCart({
      invalidRows: [{ name: 'B 场商品丙', eventName: '7月下旬场', qty: 3, priceCent: 9900 }],
      invalidCountedInTotal: true,
    }),
  },
  {
    name: 'cart / ★加购后购物车角标与后端款数对不上 → 必须 fail',
    expect: /购物车角标/,
    run: () => runCart({ badgeOverride: '7' }),
  },

  /* ───────── checkout（GZ-JP-204）───────── */
  {
    name: 'checkout / 下单确认到支付全流程（地址 + 只读清单 + 两行金额 + 已阅读闸门 + mock 支付）→ 通过',
    expect: 'pass',
    run: () => runCheckout(),
  },
  {
    name: 'checkout / 地址簿为空时直接走「新增」路径 → 通过',
    expect: 'pass',
    run: () => runCheckout({ addresses: [] }),
  },
  {
    name: 'checkout / ★「去结算」跳错页 → 必须 fail',
    expect: /第 1 跳失败/,
    run: () => runCheckout({ hopConfirm: '/pages/order/result' }),
  },
  {
    name: 'checkout / ★去结算没带 ids → 必须 fail',
    expect: /没收到 ids 参数/,
    run: () => runCheckout({ idsOverride: '' }),
  },
  {
    name: 'checkout / ★★ 去结算传成了商品 id（不是购物车项 id）→ 必须 fail',
    expect: /不是购物车项 id/,
    run: () => runCheckout({ idsOverride: '1' }),
  },
  {
    name: 'checkout / ★进页面没自动选中默认地址 → 必须 fail',
    expect: /默认选中的地址对不上/,
    run: () => runCheckout({ addressNameOverride: '李四' }),
  },
  {
    name: 'checkout / ★新增地址表单缺字段（新增能力没做全）→ 必须 fail',
    expect: /新增地址表单不完整/,
    run: () => runCheckout({ addresses: [], omitFormFields: ['.jp-addr-form__region'] }),
  },
  {
    name: 'checkout / ★★ 点了「保存并使用」但地址没真落库 → 必须 fail',
    expect: /没有新地址|新增地址后确认页显示的仍是/,
    run: () => runCheckout({ saveAddressWorks: false }),
  },
  {
    name: 'checkout / ★清单显示前端 mock 商品名 → 必须 fail',
    expect: /没渲染进清单/,
    run: () => runCheckout({ renderItemNames: ['某个占位商品'] }),
  },
  {
    name: 'checkout / ★清单里混进了数量步进器（不是只读）→ 必须 fail',
    expect: /清单不是只读的|只读数量文案/,
    run: () => runCheckout({ renderStepper: true }),
  },
  {
    name: 'checkout / ★清单里混进了删除按钮（不是只读）→ 必须 fail',
    expect: /清单不是只读的|只读数量文案/,
    run: () => runCheckout({ renderDelete: true }),
  },
  {
    name: 'checkout / ★★ 金额区出现第三行（哪怕不叫那个名字）→ 必须 fail',
    expect: /金额区有 3 行/,
    run: () => runCheckout({ sumExtraRowText: '其它费用' }),
  },
  {
    name: 'checkout / ★★ 金额区出现配送费用字样 → 必须 fail',
    expect: /另收费用的字样/,
    run: () => runCheckout({ sumExtraRowText: '运费' }),
  },
  {
    name: 'checkout / ★实付金额与后端 Σ 行金额脱钩 → 必须 fail',
    expect: /实付金额对不上/,
    run: () => runCheckout({ totalOverride: '9.9' }),
  },
  {
    name: 'checkout / ★★ 压根没做「已阅读不支持退款」勾选 → 必须 fail',
    expect: /没有「已阅读不支持退款」勾选/,
    run: () => runCheckout({ hasAgreeBox: false }),
  },
  {
    name: 'checkout / ★勾选文案里没提「退款」（举证举了个寂寞）→ 必须 fail',
    expect: /没提「退款」/,
    run: () => runCheckout({ agreeCopy: '我已阅读并同意相关条款' }),
  },
  {
    name: 'checkout / ★★ 没勾「已阅读」也能提交（闸门形同虚设）→ 必须 fail',
    expect: /却是可点的/,
    run: () => runCheckout({ submitNeverDisabled: true }),
  },
  {
    name: 'checkout / ★★ 勾了「已阅读」仍置灰（写死了谁也下不了单）→ 必须 fail',
    expect: /仍置灰/,
    run: () => runCheckout({ submitAlwaysDisabled: true }),
  },
  {
    name: 'checkout / ★★ 点了提交但订单没落库 → 必须 fail',
    expect: /订单总数|没真正落库/,
    run: () => runCheckout({ submitWorks: false }),
  },
  {
    name: 'checkout / ★提交后没落到支付结果页 → 必须 fail',
    expect: /没落到支付结果页/,
    run: () => runCheckout({ hopResult: '/pages/cart/index' }),
  },
  {
    name: 'checkout / ★★ mock 支付没驱动结算（订单停在 created）→ 必须 fail',
    expect: /支付没走完/,
    run: () => runCheckout({ payWorks: false }),
  },
  {
    name: 'checkout / ★后端已 paid 但结果页还在转圈（轮询没读回来）→ 必须 fail',
    expect: /没显示「支付成功」/,
    run: () => runCheckout({ resultTextOverride: '正在确认支付结果…' }),
  },
  {
    name: 'checkout / ★下单后购物车没被清空 → 必须 fail',
    expect: /下单后购物车还剩/,
    run: () => runCheckout({ clearCartOnSubmit: false }),
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
