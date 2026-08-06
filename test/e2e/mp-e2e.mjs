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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

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
 * 占位 appid（wxMOCKMOCKMOCKMOCK）/ 空 appid 非法 → devtools 打不开工程、cli 退出。
 * 切 touristappid 让工程能开（登录短路看的是 bundle 里的 VITE_WX_APPID，不受此影响）。
 *
 * ⚠️ 本工程一期 appid 恒为占位（GZ-JP-001 决策），所以这条**每次都会触发**，属预期行为；
 * appid 回补后自动不再触发。
 */
function ensureLaunchableAppid(projectPath) {
  const pc = `${projectPath}/project.config.json`
  if (!existsSync(pc)) return
  const cfg = JSON.parse(readFileSync(pc, 'utf8'))
  if (!cfg.appid || /^wxMOCK/i.test(cfg.appid)) {
    cfg.appid = 'touristappid'
    writeFileSync(pc, JSON.stringify(cfg, null, 2))
    console.log('[mp-e2e] project.config.json appid → touristappid（占位 appid 非法，切游客模式）')
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
  const cta = await home.$('.jp-entry-card').catch(() => null)
  if (!cta) throw new Error('首页找不到登录触发点 .jp-entry-card（订单入口没渲染？）')
  await cta.tap()
  await sleep(1200)

  const box = await home.$('.login-agree__box').catch(() => null)
  const btn = await home.$('.login-sheet__cta').catch(() => null)
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
