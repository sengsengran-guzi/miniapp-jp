/**
 * login flow —— 微信登录全链路 + 隐私协议合规闸门，模拟器内零真机（走 wxMOCK 短路）。
 *
 * 机制（src/hooks/useAuth.ts）：dev profile 的 VITE_WX_APPID=wxMOCKMOCKMOCKMOCK →
 * fetchWxCode 跳过 uni.login、直接造 mock-* code → 后端按请求头 clientid=mp-applet-gz-jp
 * 分派到本小程序的 mock 通道 → 返固定 openid `mock-jp-tester` + sa-token。
 * 所以本 flow 必须跑在 dev profile 产物上（preflight 会体检；`--build development` 可现造）。
 *
 * 走的是**真实用户路径**（首页 CTA → 协议 sheet → 勾选 → 登录），不是后门注 storage —— 这样
 * 顺带把三件事锁进回归：
 *   1. 合规：协议勾选框默认**不勾选**、未勾选时登录按钮 disabled（微信审核驳回过的原因）
 *   2. clientid 路由：登录后持久化的 username 必须是 `wx:mock-jp-tester`（现有小程序是
 *      `wx:mock-dev-tester`）—— 这是「两个小程序没串号」在前端侧唯一的直接证据
 *   3. 「同意一次」门控：登录后 gz_privacy_agreed 落地（下次启动才允许 silentLogin 静默登录）
 */
import { mkdirSync } from 'node:fs'
import {
  gotoPage,
  hasAgreedPrivacy,
  logoutIfLoggedIn,
  readPersistedUser,
  screenshot,
  sleep,
  SHOT_DIR,
} from '../mp-e2e.mjs'

/** 后端 application-<env>.yml 里本小程序的 mock-stable-openid 派生值（wx.miniapp.apps）。 */
const EXPECT_OPENID = 'mock-jp-tester'

export async function run(mp) {
  mkdirSync(SHOT_DIR, { recursive: true })

  // 0. 确定性拨回游客态。
  //    不能只 clearStorageSync：pinia 持久化只在 store 创建时 hydrate 一次，清 storage 清不掉
  //    内存里的 token → 页面仍是已登录态、首页 CTA 变「个人资料」、本 flow 直接测了个寂寞。
  //    走 app 自己的登出（me/index 的 .logout-btn）才同时清内存 token / storage / 已同意 flag。
  const didLogout = await logoutIfLoggedIn(mp)
  console.log(`  前置：${didLogout ? '检出已登录态 → 已登出回游客态' : '本来就是游客态'}`)

  const meAfterLogout = await gotoPage(mp, '/pages/me/index', 1200)
  if (await meAfterLogout.$('.logout-btn').catch(() => null)) {
    throw new Error('登出后 me/index 仍有 .logout-btn（= 登录态没清干净，后续断言不可信）')
  }

  // 1. 首页点主 CTA（游客态文案 = 「微信登录」）→ 触发 useAuth.ensureLoggedIn → 弹协议 sheet
  const home = await gotoPage(mp, '/pages/index/index', 1500)
  const cta = await home.$('.jp-hero__cta').catch(() => null)
  if (!cta) throw new Error('首页找不到主 CTA .jp-hero__cta（页面没渲染？）')
  await cta.tap()
  await sleep(1200)

  // 2. 协议 sheet 必须弹出来（游客点敏感动作 → 合规闸门，不是直接登录）
  const sheet = await home.$('.login-sheet').catch(() => null)
  if (!sheet) {
    throw new Error('点首页 CTA 后没弹出协议同意 sheet .login-sheet（合规闸门失效，或 CTA 误判为已登录态）')
  }
  await screenshot(mp, `${SHOT_DIR}/login_1_sheet.png`)

  // 3. 合规断言：勾选框默认未勾选（.is-on 是勾中态 class）
  const boxBefore = await home.$('.login-agree__box').catch(() => null)
  if (!boxBefore) throw new Error('协议 sheet 里找不到勾选框 .login-agree__box')
  const clsBefore = await boxBefore.attribute('class').catch(() => '')
  if (/\bis-on\b/.test(clsBefore || '')) {
    throw new Error(`协议勾选框默认已勾选（class="${clsBefore}"）—— 违反微信合规「不得默认强制同意」`)
  }
  console.log('  ✓ 合规：协议勾选框默认未勾选')

  // 4. 合规断言：未勾选时登录按钮 disabled
  const ctaBtn = await home.$('.login-sheet__cta').catch(() => null)
  if (!ctaBtn) throw new Error('协议 sheet 里找不到登录按钮 .login-sheet__cta')
  const disabledBefore = await ctaBtn.property('disabled').catch(() => undefined)
  if (disabledBefore === false) {
    throw new Error('未勾选协议时登录按钮就可点（disabled=false）—— 违反微信合规')
  }
  console.log(`  ✓ 合规：未勾选时登录按钮不可点 (disabled=${disabledBefore})`)

  // 5. 主动勾选 → 点登录
  await boxBefore.tap()
  await sleep(500)
  const clsAfter = await boxBefore.attribute('class').catch(() => '')
  if (!/\bis-on\b/.test(clsAfter || '')) {
    throw new Error(`点了勾选框但没变勾中态（class="${clsAfter}"）`)
  }
  await ctaBtn.tap()

  // 6. 等 wxMOCK code → 后端 wx-login 换 token（含网络往返）
  await sleep(3500)
  await screenshot(mp, `${SHOT_DIR}/login_2_after.png`)

  // 7. 登录态断言：me/index 出现「退出登录」（v-if="loggedIn" 才渲染）
  const me = await gotoPage(mp, '/pages/me/index', 2000)
  if (!await me.$('.logout-btn').catch(() => null)) {
    throw new Error('登录后 me/index 没出现 .logout-btn（= 未登录成功；查后端 wxMOCK 通道 / clientid 配置）')
  }
  await screenshot(mp, `${SHOT_DIR}/login_3_me.png`)

  // 8. clientid 路由断言：持久化的 username === `wx:${openid}`，openid 必须是本小程序那个。
  //    串到现有小程序会拿到 wx:mock-dev-tester —— 这条断言就是防串号的哨兵。
  const persisted = await readPersistedUser(mp)
  const username = persisted?.userInfo?.username
  if (username !== `wx:${EXPECT_OPENID}`) {
    throw new Error(
      `登录用户不是本小程序的：username=${JSON.stringify(username)}，期望 "wx:${EXPECT_OPENID}"`
      + '（clientid 请求头没带对 / 后端 wx.miniapp.apps 配置串了）',
    )
  }
  console.log(`  ✓ clientid 路由正确：username=${username}, userId=${persisted?.userInfo?.userId}`)

  // 9. 「同意一次」门控落地（下次启动 silentLogin 才允许静默登录）
  if (!await hasAgreedPrivacy(mp)) {
    throw new Error('登录成功但 gz_privacy_agreed 没持久化（下次启动 silentLogin 会被门控挡住）')
  }
  console.log('  ✓ 「同意一次」已持久化 gz_privacy_agreed=true')

  console.log(`  截图 → ${SHOT_DIR}`)
  console.log('  ✓ wxMOCK 登录全链路通过（协议合规闸门 + clientid 路由 + 登录态渲染）')
}
