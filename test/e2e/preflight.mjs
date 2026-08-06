/**
 * preflight —— 硬 gate「无降级」的前置体检（Kevin 拍板：环境起不来就阻塞，不静默降级）。
 *
 * 任一**阻塞项**不满足 → 退出码 2 + 打印「唯一修复命令」，让一次阻塞是 30 秒的事而不是排查地狱。
 *
 * 相对源 harness（code/main/miniapp/test/e2e/preflight.mjs）新增四项：
 *   - 【阻塞】devtools 登录态（`cli islogin`）：★ GZ-JP-002 实测最坑的一条。IDE 登录过期时
 *     automator 的报错完全指错方向（详见 probeDevtoolsLogin 注释），前置探明省掉半天排查。
 *   - 【阻塞】dist profile 体检：本工程 `pnpm build:mp`（无 --mode）= production profile，
 *     VITE_SERVER_BASEURL 指向线上 https://guzi.tianda.studio。拿它跑本地 E2E 会**静默打到线上**
 *     后端 —— 不报错、断言却漂，是最贵的一类假绿。所以显式体检产物里是不是 dev profile。
 *   - 【阻塞】后端认不认 clientid=mp-applet-gz-jp（GZ-SYS-020 多 appid 底座在不在），
 *     否则每条 flow 都以「登录失败」形态挂，看不出根因在后端配置。
 *   - 【advisory】devtools「服务端口」体检：GUI 开关（设置→安全设置→服务端口），关掉时 launch 只报
 *     一句 "please make sure http port is open"。这里提前探明并给出 GUI 修复路径。
 *     只 warn 不阻塞 —— 探测方式（读 .ide 端口文件）依赖 devtools 内部布局，误判会比漏判更贵。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { CLI, clearProxy } from './mp-e2e.mjs'

function ok(msg) { console.log(`  ✓ ${msg}`) }
function warn(msg, fix) { console.warn(`  ⚠ ${msg}\n    → 若 launch 失败先修这个：${fix}`) }
function bad(msg, fix) { console.error(`  ✗ ${msg}\n    → 修复：${fix}`) }

/** dist 里必须出现的 dev profile 指纹（构建时 vite 把 import.meta.env.* 内联成字面量）。 */
const DEV_FINGERPRINTS = [
  { needle: 'localhost:8080', what: '后端地址 = 本地（VITE_SERVER_BASEURL）' },
  { needle: 'wxMOCKMOCKMOCKMOCK', what: 'wxMOCK 短路 appid（VITE_WX_APPID）' },
  { needle: 'mp-applet-gz-jp', what: 'clientid 请求头（VITE_APP_CLIENT_ID）' },
]
/** 出现即判定「误用了 staging/prod 产物」的反指纹。 */
const PROD_FINGERPRINT = 'guzi.tianda.studio'

/** 在 dist 里递归找字面量（只扫 .js/.json，够用且快）。 */
function distContains(dist, needle) {
  try {
    execSync(
      `grep -rql --include='*.js' --include='*.json' ${JSON.stringify(needle)} ${JSON.stringify(dist)}`,
      { stdio: 'ignore' },
    )
    return true
  }
  catch { return false }
}

/** 探 devtools「服务端口」：读安装目录下各 profile 的 .ide 端口文件并 HTTP 探活。 */
function probeDevtoolsHttpPort() {
  const root = path.join(os.homedir(), 'Library/Application Support/微信开发者工具')
  if (!existsSync(root)) return { known: false }
  const ports = []
  for (const d of readdirSync(root)) {
    const f = path.join(root, d, 'Default/.ide')
    if (!existsSync(f)) continue
    const p = readFileSync(f, 'utf8').trim()
    if (/^\d+$/.test(p)) ports.push(p)
  }
  if (!ports.length) return { known: false }
  for (const p of ports) {
    try {
      const code = execSync(
        `curl -s --noproxy '*' -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:${p}/`,
        { encoding: 'utf8' },
      ).trim()
      if (code && code !== '000') return { known: true, open: true, port: p }
    }
    catch { /* 该端口不通，试下一个 */ }
  }
  return { known: true, open: false, ports }
}

/**
 * 探 devtools 登录态（`cli islogin` → `{"login":true|false}`）。
 *
 * <p>★ 这是本 harness 最值钱的一条体检。IDE 登录过期时的表象**极具误导性**，两种都见过：</p>
 * <ul>
 *   <li>真 appid 工程：`cli auto` 直接失败，automator 报
 *       "Failed to launch wechat web devTools, please make sure http port is open"
 *       —— 让人去查服务端口，但服务端口其实是开的；</li>
 *   <li>touristappid 工程（本工程一期）：`cli auto` **成功**、automation ws 端口也起来、
 *       `automator.connect()` 秒连 —— 但模拟器 runtime 起不来，之后**每条** App 层命令都在
 *       10s 超时（"timeout waiting for automator response"），看起来像小程序代码写崩了。</li>
 * </ul>
 * <p>底层真实报错要挖到 cli 的 stderr 才看得见：`错误 Error: 需要重新登录 (code 10)`。
 * 所以这里前置探明，把「查半天代码」变成「扫个码」。</p>
 */
function probeDevtoolsLogin() {
  try {
    const out = execSync(`${JSON.stringify(CLI)} islogin`, {
      encoding: 'utf8',
      timeout: 90000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const m = out.match(/"login"\s*:\s*(true|false)/)
    if (!m) return { known: false, raw: out.slice(0, 200) }
    return { known: true, login: m[1] === 'true' }
  }
  catch (e) {
    return { known: false, err: e.message }
  }
}

/** @param {{ dist: string, backend?: string }} opts */
export async function preflight({ dist, backend = 'http://localhost:8080' }) {
  console.log('[preflight] 硬 gate 体检（无降级）')
  clearProxy() // cli / curl 都打 127.0.0.1，别让系统代理（clash）吞掉
  const fails = []

  // 1. devtools cli 存在
  if (existsSync(CLI)) ok(`devtools cli: ${CLI}`)
  else { bad(`找不到 devtools cli: ${CLI}`, '安装微信开发者工具，或设 WX_DEVTOOLS_CLI=<cli路径>'); fails.push('cli') }

  // 2. devtools 服务端口（advisory —— 探测靠 .ide 文件，误判成本高于漏判）
  const probe = probeDevtoolsHttpPort()
  if (!probe.known) warn('测不出 devtools 服务端口状态（没找到 .ide 端口文件；工具没开过？）', '打开微信开发者工具并登录')
  else if (probe.open) ok(`devtools 服务端口开着 (http://127.0.0.1:${probe.port})`)
  else {
    warn(
      `devtools 服务端口疑似关闭（探过 ${probe.ports.join(', ')} 均无响应）`,
      '微信开发者工具 → 设置 → 安全设置 → 打开「服务端口」（本机一次性 GUI 开关，脚本改不了）',
    )
  }

  // 3. devtools 已登录（阻塞）—— 登录态只能人扫码，harness 替不了；不前置探明就会被
  //    "http port is open" / "timeout waiting for automator response" 两种假症状带偏。
  if (!fails.includes('cli')) {
    const li = probeDevtoolsLogin()
    if (li.known && li.login) ok('devtools 已登录')
    else if (li.known) {
      bad(
        'devtools 未登录（cli islogin → {"login":false}）—— 模拟器 runtime 起不来，'
        + '表象会是 launch 报「http port is open」或每条命令 10s 超时，都不是代码问题',
        '打开微信开发者工具 → 用手机微信扫码登录（本机一次性人工动作，脚本代不了），然后重跑',
      )
      fails.push('devtools-login')
    }
    else warn(`测不出 devtools 登录态（${li.err || li.raw || '无输出'}）`, '手动跑 `cli islogin` 看看')
  }

  // 4. dist 完整（必须有 app.json，否则小程序不渲染、App.* 全挂）
  const hasDist = existsSync(`${dist}/app.json`)
  if (hasDist) ok(`dist 完整: ${dist}/app.json`)
  else { bad(`dist 缺 app.json: ${dist}`, 'node test/e2e/run.mjs smoke --build development'); fails.push('dist') }

  // 5. dist 是 dev profile（阻塞）—— 防「拿 production 产物打线上后端」的静默假绿
  if (hasDist) {
    const missing = DEV_FINGERPRINTS.filter(f => !distContains(dist, f.needle))
    const leaked = distContains(dist, PROD_FINGERPRINT)
    if (!missing.length && !leaked) ok('dist = dev profile（本地后端 + wxMOCK + jp clientid）')
    else {
      const why = [
        ...missing.map(m => `缺 ${m.what}（找不到 "${m.needle}"）`),
        ...(leaked ? [`混进了线上地址 "${PROD_FINGERPRINT}"（= staging/production 产物）`] : []),
      ].join('；')
      bad(
        `dist 不是 dev profile：${why}`,
        'node test/e2e/run.mjs <flow> --build development（切勿用 pnpm build:mp，那是 production profile → 打线上后端）',
      )
      fails.push('dist-profile')
    }
  }

  // 6. 后端可达（mp E2E 打真后端 localhost:8080；用 localhost 命中代理 bypass）
  //    健康端点带鉴权 → 401 也算「活着」，只有 000（连不上）才是死的。
  try {
    const code = execSync(
      `curl -s --noproxy '*' -m 3 -o /dev/null -w '%{http_code}' ${backend}/actuator/health`,
      { encoding: 'utf8' },
    ).trim()
    if (code && code !== '000') ok(`后端可达: ${backend} (HTTP ${code})`)
    else { bad(`后端无响应: ${backend}`, 'cd code/main/RuoYi-Vue-Plus && mvn spring-boot:run -pl ruoyi-admin'); fails.push('backend') }
  }
  catch {
    bad(`后端无响应: ${backend}`, 'cd code/main/RuoYi-Vue-Plus && mvn spring-boot:run -pl ruoyi-admin'); fails.push('backend')
  }

  // 7. 后端认得本小程序的 clientid（阻塞）—— GZ-SYS-020 多 appid 底座没部署/没登记时提前炸，
  //    否则每条 flow 都会以「登录失败」形态失败，看不出根因在后端配置。
  if (!fails.includes('backend')) {
    try {
      const body = execSync(
        `curl -s --noproxy '*' -m 5 -X POST ${backend}/app/gz/common/auth/wx-login `
        + `-H 'Content-Type: application/json' -H 'clientid: mp-applet-gz-jp' `
        + `-d '{"code":"preflight-jp"}'`,
        { encoding: 'utf8' },
      )
      const json = JSON.parse(body)
      if (json?.data?.token) ok(`后端认 clientid=mp-applet-gz-jp（openid=${json.data.openid}）`)
      else { bad(`后端拒绝 clientid=mp-applet-gz-jp：${json?.msg || body.slice(0, 160)}`, '确认后端已含 GZ-SYS-020 且 application-<env>.yml 的 wx.miniapp.apps 登记了 mp-applet-gz-jp'); fails.push('clientid') }
    }
    catch (e) {
      bad(`探 wx-login 失败: ${e.message}`, '确认后端已含 GZ-SYS-020（多 appid 底座）'); fails.push('clientid')
    }
  }

  if (fails.length) {
    console.error(`[preflight] ❌ 阻塞（${fails.join(', ')}）—— 硬 gate 无降级，修好上面再跑`)
    process.exit(2)
  }
  console.log('[preflight] ✓ 通过')
}
