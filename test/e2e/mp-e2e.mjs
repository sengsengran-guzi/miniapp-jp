/**
 * mp-e2e 驱动库 —— AI 驱动微信开发者工具模拟器跑 mp 端 E2E（kevin-qa Tier 1B）。
 *
 * 从 code/main/miniapp/test/e2e/ 移植（GZ-JP-002），三道已解决的坑原样保留：
 *   1. 代理坑：shell no_proxy 为空 → clash 吞 127.0.0.1 → automator 的 HTTP 探测挂死。
 *      解法：清掉 http_proxy/https_proxy/all_proxy + no_proxy='*'（ws 命令通道本就直连，清代理保险）。
 *   2. checkVersion 崩：devtools 2.01 把 Tool.getInfo 响应的 .SDKVersion 改名成 .version，
 *      miniprogram-automator@0.12.1 读不到 → cmpVersion(undefined) → undefined.split 抛错、launch 崩。
 *      解法：monkeypatch MiniProgram.prototype.checkVersion 成 no-op（协议本身正常，只是这一处字段名）。
 *   3. App.* 命令挂死：automation 模式新工具要「信任并打开」，否则小程序不渲染、App.* 无人应答。
 *      解法：launch({ trustProject: true }) 自动信任工程。
 *
 * 本工程新增（相对源 harness）：登录态治具 —— logoutIfLoggedIn / readPersistedUser / hasAgreedPrivacy，
 * 因为拼团小程序是「游客优先 + 按需登录 + 协议同意一次」模型，flow 必须能确定性地把 app 拨回游客态。
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const automator = require('miniprogram-automator')

// 坎 2：旁路 checkVersion 的版本守卫（唯一坏的一处，协议其余部分正常）。
const MiniProgram = require('miniprogram-automator/out/MiniProgram').default
MiniProgram.prototype.checkVersion = async function () { /* devtools 2.01: .SDKVersion→.version, skip guard */ }

/** 微信开发者工具 cli 路径（可被 WX_DEVTOOLS_CLI 覆盖）。 */
export const CLI = process.env.WX_DEVTOOLS_CLI
  || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

/** 截图落盘目录（与现有小程序 /tmp/gz-e2e-shots 分开，避免两套 E2E 互相覆盖）。 */
export const SHOT_DIR = process.env.MP_SHOT_DIR || '/tmp/gz-jp-e2e-shots'

/** 协议同意持久化 key（src/composables/useLoginConsent.ts 的 CONSENT_STORAGE_KEY，必须一致）。 */
export const CONSENT_STORAGE_KEY = 'gz_privacy_agreed'

/** 坎 1：把本进程的代理环境清干净（automator 的 HTTP 探测走 node，受 no_proxy 影响）。 */
export function clearProxy() {
  for (const k of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']) {
    delete process.env[k]
  }
  process.env.no_proxy = '*'
  process.env.NO_PROXY = '*'
}

/**
 * 启动自动化会话（串行 —— devtools 自动化端口是共享单例，禁并发）。
 * 不强制 port：automator 默认 9420 起自动找空闲口，避免重复跑时撞「Port in use」。
 * @param {{ projectPath: string, port?: number, timeout?: number }} opts
 * @returns miniProgram 句柄
 */
export async function launch({ projectPath, port, timeout = 90000 }) {
  clearProxy()
  ensureLaunchableAppid(projectPath)
  const opts = { cliPath: CLI, projectPath, timeout, trustProject: true }
  if (port) opts.port = port
  return automator.launch(opts)
}

/**
 * E2E 期间给 devtools 工程用的 appid（可被 WX_DEVTOOLS_E2E_APPID 覆盖）。
 *
 * 默认值是 Kevin 名下**现有谷子宇宙小程序**的 appid —— 借来做本地工程关联，见下方长注释。
 * 拼团小程序自己的真 appid 到位后（doc/jp/phase-plan.md「appid 回补清单」#1），
 * 把 .env 的 VITE_WX_APPID 换成真值即可，本函数自动不再改写。
 */
const E2E_APPID = process.env.WX_DEVTOOLS_E2E_APPID || 'wx2f8b93e09703f07d'

/**
 * 占位 appid（wxMOCKMOCKMOCKMOCK）/ 空 appid 非法 → devtools 打不开工程、cli 退出。
 * 启动前把 dist 的 project.config.json 换成一个**真** appid。
 *
 * <p><b>⚠️ 为什么不能用 touristappid</b>（GZ-JP-204 实测踩到，之前一直卡在 devtools 登录所以没人走到这一步）：
 * 游客模式下 devtools <b>强制校验合法域名</b>，{@code setting.urlCheck:false} 与
 * {@code project.private.config.json} 都<b>压不住</b> —— 所有 {@code uni.request} 直接
 * {@code request:fail url not in domain list}。于是页面全停在 loading 态，
 * 任何「打真后端」的断言都跑不了（A/B 实测：touristappid → loadEvents failed；真 appid → 正常）。</p>
 *
 * <p><b>借用现有小程序 appid 安全吗</b>：安全，且<b>不改变任何运行时行为</b> ——</p>
 * <ul>
 *   <li>这个 appid 只用于<b>本地 devtools 把 dist 目录识别成一个工程</b>，不参与任何请求；</li>
 *   <li>后端按<b>请求头 clientid</b>（{@code VITE_APP_CLIENT_ID = mp-applet-gz-jp}）路由，不看 appid；</li>
 *   <li>登录短路看的是 bundle 里的 {@code VITE_WX_APPID}（仍是 {@code wxMOCK...}）→ 仍走 mock 通道；</li>
 *   <li>改的是 <b>dist 产物</b>，每次构建都会被重新生成 —— 源码与发布配置一行没动。</li>
 * </ul>
 *
 * <p><b>⚠️ 不要写 {@code project.private.config.json}</b>：实测一旦存在这个文件，devtools 就以它
 * 为准来解释工程设置，只写 {@code setting.urlCheck:false} 的精简版反而让域名校验<b>重新打开</b>
 * （现象与 touristappid 一模一样，很难看出是它干的）。所以这里主动<b>删掉</b>它，
 * 让 {@code project.config.json}（uni 按 manifest 生成，已含 urlCheck:false）单独生效。</p>
 */
function ensureLaunchableAppid(projectPath) {
  const pc = `${projectPath}/project.config.json`
  if (!existsSync(pc)) return
  const cfg = JSON.parse(readFileSync(pc, 'utf8'))
  if (!cfg.appid || /^wxMOCK/i.test(cfg.appid) || cfg.appid === 'touristappid') {
    cfg.appid = E2E_APPID
    cfg.setting = { ...(cfg.setting || {}), urlCheck: false }
    writeFileSync(pc, JSON.stringify(cfg, null, 2))
    console.log(`[mp-e2e] project.config.json appid → ${E2E_APPID}（占位 appid 非法；游客模式会强制域名校验，打不了本地后端）`)
  }
  const ppc = `${projectPath}/project.private.config.json`
  if (existsSync(ppc)) {
    rmSync(ppc)
    console.log('[mp-e2e] 删除 project.private.config.json（它会让 urlCheck 重新打开，本地后端被拦）')
  }
}

/**
 * reLaunch 到指定页并等渲染稳定，返回 page。
 * reLaunch 对 tabBar / 普通页都适用（navigateTo 不能跳 tabBar 页）。
 */
export async function gotoPage(mp, urlPath, settleMs = 1500) {
  const page = await mp.reLaunch(urlPath)
  await sleep(settleMs)
  return page
}

/**
 * 硬 gate：小程序<b>自己</b>能不能打到本地后端。
 *
 * <p><b>为什么 preflight 里那条「后端可达」不够</b>：那条是 <b>node 用 curl</b> 探的，
 * 证明的是「后端活着」。小程序的请求走的是 devtools 的网络栈，中间还隔着一道
 * <b>「不校验合法域名」开关</b> —— 它关着的时候 {@code wx.request} 一律
 * {@code request:fail url not in domain list}，后端再健康也没用。</p>
 *
 * <p>这道闸门存在的意义是<b>把这个失败翻译成人话</b>：不加它的话，现象是「登录失败」
 * 或者「页面全停在 loading」，看起来像代码 bug，能白查半天（GZ-JP-204 实测踩过）。</p>
 *
 * <p><b>只能人工在 GUI 里开一次</b>：{@code project.config.json} 的 {@code setting.urlCheck:false}、
 * {@code project.private.config.json}、{@code cli close} 重开、换 appid、换工程路径 ——
 * 全试过，都<b>压不住</b>已开着的域名校验。</p>
 *
 * @throws Error 打不通时抛（run.mjs 捕获后按 preflight 失败退 2，不降级）
 */
export async function assertBackendReachableFromMp(mp, backend = 'http://localhost:8080') {
  const url = `${backend}/app/gz/jp/event/list?pageNum=1&pageSize=1`
  const res = await mp.evaluate(function (u) {
    return new Promise((resolve) => {
      wx.request({
        url: u,
        header: { clientid: 'mp-applet-gz-jp' },
        success: r => resolve({ ok: true, status: r.statusCode }),
        fail: e => resolve({ ok: false, err: (e && e.errMsg) || 'unknown' }),
      })
    })
  }, url).catch(e => ({ ok: false, err: `evaluate 失败: ${e.message}` }))

  if (res.ok) {
    return
  }
  if (/not in domain list/i.test(String(res.err))) {
    throw new Error(
      `小程序侧 wx.request 被域名校验拦下（${res.err}）。\n`
      + '  ↑ 这是**本机 GUI 开关**没打开，不是代码问题：\n'
      + '    微信开发者工具 → 打开本工程 → 右上角「详情」→「本地设置」→\n'
      + '    勾上「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」，然后重跑。\n'
      + `    工程路径：${process.env.MP_DIST || 'dist/build/mp-weixin'}\n`
      + '    （已验证：project.config.json 的 setting.urlCheck / project.private.config.json /\n'
      + '      cli close 重开 / 换 appid / 换工程路径 都压不住它，只能在 GUI 里勾一次。\n'
      + '      也不要为了绕过它去改 preflight —— 那是把硬 gate 变成假绿。）',
    )
  }
  throw new Error(`小程序侧 wx.request 打不到后端：${res.err}（后端在 ${backend} 跑着吗？）`)
}

/* ────────────────────── 深选择器（跨自定义组件）────────────────────── */

/**
 * 每个页面根组件 `<BizScreen class="jp-screen">` 上的**页面级**锚点类。
 *
 * <p><b>为什么需要它</b>（GZ-JP-204 实测踩到，此前一直卡在 devtools 登录所以没人走到这一步）：
 * 微信的 {@code SelectorQuery}（automator 的 {@code page.$} 底层）<b>不跨自定义组件边界</b> ——
 * {@code page.$('.biz-cart-item__name')} / {@code page.$('.jp-event-card')} /
 * {@code page.$('.login-agree__box')} 一律返回 null，哪怕它们就在屏幕上。
 * 官方给的出路是后代选择器 {@code '祖先 >>> 后代'}，但那个「祖先」<b>必须是页面自己模板里写的节点</b>。</p>
 *
 * <p>本工程每页的模板根就是 {@code <BizScreen>}（组件），它<b>内部</b>还挂着 BizLoginSheet ——
 * 于是登录弹层在页面作用域里连一个可选的祖先都没有。给 BizScreen 的<b>使用处</b>加一个
 * {@code class="jp-screen"}（宿主节点写在页面模板里 ⇒ 页面作用域）之后，
 * {@code .jp-screen >>> 任意} 就能打到整棵组件树。</p>
 *
 * <p>这个类<b>没有任何样式</b>，纯锚点。新页照抄 {@code <BizScreen class="jp-screen">} 即可。</p>
 */
export const SCREEN_ROOT = '.jp-screen'

/**
 * 跨组件查单个元素。
 *
 * @param page 页面句柄
 * @param selector 组件内选择器（如 `.biz-cart-item__name`）；<b>不要</b>自己写 `>>>`
 * @param root 页面级祖先（默认 {@link SCREEN_ROOT}）
 * @returns Element 或 null
 */
export function deep(page, selector, root = SCREEN_ROOT) {
  return page.$(`${root} >>> ${selector}`).catch(() => null)
}

/** 跨组件查一组元素（查不到返回 `[]`，不抛）。 */
export function deepAll(page, selector, root = SCREEN_ROOT) {
  return page.$$(`${root} >>> ${selector}`).catch(() => [])
}

/** 跨组件取一组元素的文本（trim 后返回数组）。 */
export async function deepTexts(page, selector, root = SCREEN_ROOT) {
  const els = await deepAll(page, selector, root)
  const out = []
  for (const el of els) {
    const s = await el.text().catch(() => '')
    out.push(String(s ?? '').trim())
  }
  return out
}

/**
 * 断言：当前在目标页 + 页面真渲染出内容（非空壳）。
 * Page 没有 wxml()（那是 Element 的），用 $$('view') 元素数量判渲染：空壳页查不到 view。
 */
export async function assertRendered(mp, page, expectPath, minViews = 3) {
  const cur = await mp.currentPage()
  const views = await page.$$('view').catch(() => [])
  const curPath = cur && cur.path
  const want = expectPath.replace(/^\//, '').split('?')[0]
  const ok = curPath === want && views.length >= minViews
  return { ok, curPath, viewCount: views.length, want }
}

/** 截图到指定路径（失败不抛，截图是 advisory）。 */
export async function screenshot(mp, file) {
  return mp.screenshot({ path: file }).catch(() => {})
}

/** 安全断开（disconnect() 返回 undefined 而非 promise，不能直接 .catch）。 */
export async function safeDisconnect(mp) {
  try { const r = mp && mp.disconnect && mp.disconnect(); if (r && typeof r.then === 'function') await r } catch {}
}

/**
 * 等待时长缩放系数（默认 1 = 原速）。
 *
 * <p>唯一用途：`self-test.mjs` 用<b>假 miniProgram 句柄</b>跑 flow 时渲染是瞬时的，
 * 那些为真模拟器准备的 `sleep(2500)` 纯属空等 —— flow 一多就把 self-test 拖到几分钟，
 * 于是没人愿意跑它，等于白写。self-test 把本值设为 0 后整轮是秒级。</p>
 *
 * <p><b>★ 只缩放「等多久」，不改任何断言、不跳过任何步骤</b> —— 不是让断言变松的后门。
 * 真跑 `run.mjs` 时本变量不设置，恒为原速（preflight / flow 都不读它）。</p>
 */
const SLEEP_SCALE = process.env.MP_E2E_SLEEP_SCALE === undefined
  ? 1
  : Number(process.env.MP_E2E_SLEEP_SCALE) || 0

export function sleep(ms) {
  const wait = Math.round(ms * SLEEP_SCALE)
  if (wait <= 0) {
    return Promise.resolve()
  }
  return new Promise(r => setTimeout(r, wait))
}

/* ────────────────────────────── 登录态治具 ────────────────────────────── */

/**
 * 读 pinia 持久化的 user store（key='user'，见 src/store/index.ts 用 uni.setStorageSync 落盘）。
 *
 * <p>登录成功后 `userInfo.username === 'wx:<openid>'`（src/hooks/useAuth.ts loginToBackend）——
 * 这是 flow 里**唯一能直接照出 clientid 路由对不对**的证据：JP 小程序拿到 `wx:mock-jp-tester`，
 * 现有小程序拿到 `wx:mock-dev-tester`（后端按 clientid 分派不同 mock-stable-openid）。</p>
 *
 * @returns {Promise<{userInfo?: {userId?: number, username?: string, nickname?: string}}|null>}
 */
export async function readPersistedUser(mp) {
  const raw = await mp.callWxMethod('getStorageSync', 'user').catch(() => null)
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) } catch { return null }
}

/** 是否已持久化「同意过隐私协议」（useLoginConsent.hasAgreedPrivacy 的对侧读取）。 */
export async function hasAgreedPrivacy(mp) {
  const v = await mp.callWxMethod('getStorageSync', CONSENT_STORAGE_KEY).catch(() => null)
  return v === true
}

/**
 * 把 app 确定性拨回游客态。
 *
 * <p>不能只 `clearStorageSync`：pinia 持久化只在 store 创建时 hydrate 一次，清 storage 不会清掉
 * **内存里**的 token → `isLoggedIn()` 仍为 true、页面仍是已登录态。所以走 app 自己的登出路径
 * （me/index 的 .logout-btn → useTokenStore.logout()），它同时清内存 token、storage 和
 * 「已同意」flag。没登录则直接返回。</p>
 *
 * @returns {Promise<boolean>} 本次是否真执行了登出
 */
export async function logoutIfLoggedIn(mp) {
  const page = await gotoPage(mp, '/pages/me/index', 1500)
  const btn = await page.$('.logout-btn').catch(() => null)
  if (!btn) return false
  // .logout-btn 写在 me/index.vue 页面模板里（页面作用域），不需要 deep()
  // 登出有 uni.showModal 二次确认 → mock 成恒确认
  await mp.mockWxMethod('showModal', { confirm: true, cancel: false }).catch(() => {})
  await btn.tap().catch(() => {})
  await sleep(1500)
  await mp.restoreWxMethod('showModal').catch(() => {})
  return true
}

/**
 * 把 app 确定性拨到<b>已登录</b>态（{@link logoutIfLoggedIn} 的对侧）。
 *
 * <p>走的仍是<b>真实用户路径</b>（首页「我的订单」入口 → 协议 sheet → 主动勾选 → 点登录），
 * 不是后门注 storage —— 需要登录态的 flow（购物车 / 下单）顺带把「协议闸门没被绕过」也守住了。
 * 已登录则直接返回，不做多余的登出再登录（省 5 秒，也避免把别的 flow 造的数据洗掉）。</p>
 *
 * @returns {Promise<boolean>} 结束时是否处于登录态
 */
export async function loginIfNeeded(mp) {
  const me = await gotoPage(mp, '/pages/me/index', 1200)
  if (await me.$('.logout-btn').catch(() => null)) return true

  const home = await gotoPage(mp, '/pages/index/index', 1500)
  // ★ 入口卡与协议 sheet 都在自定义组件里（BizEntryCard / BizLoginSheet），必须走 deep()：
  //   page.$('.jp-entry-card') 恒为 null —— SelectorQuery 不跨组件边界（见 SCREEN_ROOT 注释）
  const cta = await deep(home, '.jp-entry-card')
  if (!cta) throw new Error('首页找不到登录触发点 .jp-entry-card（订单入口没渲染？）')
  await cta.tap()
  await sleep(1200)

  const box = await deep(home, '.login-agree__box')
  const btn = await deep(home, '.login-sheet__cta')
  if (!box || !btn) {
    throw new Error('点首页订单入口后没弹出协议同意 sheet（合规闸门失效，或误判为已登录态）')
  }
  await box.tap()
  await sleep(400)
  await btn.tap()
  await sleep(3500)

  const meAfter = await gotoPage(mp, '/pages/me/index', 1800)
  return !!(await meAfter.$('.logout-btn').catch(() => null))
}

/**
 * 读 app 当前持有的 sa-token（pinia 持久化 key='token'，见 store/token.ts `persist: true`）。
 *
 * <p>用途：需要登录态的 flow 要用<b>同一个用户</b>的身份直连后端当独立数据源
 * （光断言「页面上有 3 行」证明不了那 3 行是真的落库了）。从 app 自己的 storage 里取，
 * 而不是 flow 另调一次 wx-login —— 后者会拿到<b>另一个会话</b>，看到的车可能不是页面上那辆。</p>
 *
 * @returns {Promise<string>} token；取不到返回空串
 */
export async function readAppToken(mp) {
  const raw = await mp.callWxMethod('getStorageSync', 'token').catch(() => null)
  if (!raw) return ''
  let obj = raw
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) } catch { return '' }
  }
  // 单 token 模式落 tokenInfo.token；双 token 模式落 tokenInfo.accessToken（本项目是单 token）
  return String(obj?.tokenInfo?.token || obj?.tokenInfo?.accessToken || obj?.token || '')
}
