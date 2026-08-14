/**
 * run.mjs —— mp E2E 入口。kevin-qa 用 Bash 调：`node test/e2e/run.mjs <flow|all> [--build [mode]]`。
 *
 * 串行执行（devtools 自动化端口是共享单例，禁并发——同 8080/8090 撞端口同一类约束）。
 * 两个小程序（miniapp / miniapp-jp）的 E2E 也必须**互相串行**，不能同时开跑。
 *
 * 退出码：0 全过 / 1 有 flow 断言失败 / 2 preflight 或 launch 失败 / 3 硬超时。
 * 兜底超时 = flow 数 × 240s（`MP_E2E_TIMEOUT_MS` 可覆盖整轮预算）。
 * 硬 gate「无降级」：preflight 不过直接退 2，不偷偷降级放过。
 */
import path from 'node:path'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { preflight } from './preflight.mjs'
import { assertBackendReachableFromMp, launch, safeDisconnect, sleep } from './mp-e2e.mjs'
import { buildDist } from './build-dist.mjs'

/**
 * 启动自动化，撞到 devtools 的 `rawPath` 瞬态就自动重来一次。
 *
 * <p>`Cannot destructure property 'rawPath' of 't.getPageMetaByWebviewId(...)' as it is null`
 * 是 devtools **重新导入 / 重新编译工程后第一次连自动化**时的固定现象（dist 刚重建、
 * appid 刚被改写、工程刚被 close 过都会触发）：IDE 还在重建 webview，automator 拿到一个
 * 空的 page meta。**它与被测代码无关**，重来一次就好 —— 不重试的话每次改完代码的第一跑
 * 都会红，久了就没人信这个 gate 了。</p>
 *
 * <p><b>光重试 launch 不够</b>：连上之后 webview 可能还在重建，第一次 `currentPage()` 照样抛
 * 同一个 rawPath —— 那时错误发生在 flow 里，报出来是「[FAIL] cart: ...rawPath」，
 * 长得跟业务断言失败一模一样。所以连上后再<b>探一次就绪</b>，探不动就整个重连。
 * （跑 `all` 时每个 flow 各连一次，7 次里撞上一次的概率不低 —— 实测 6/7、5/7 两次都是栽在这。）</p>
 */
const LAUNCH_ATTEMPTS = 3
const READY_PROBES = 6

function isRawPathTransient(e) {
  return /rawPath|getPageMetaByWebviewId/.test((e && e.message) || '')
}

/**
 * 「等 automator 响应超时」也算可重试的瞬态。
 *
 * <p>它跟 rawPath 是同一类病（devtools 自动化是共享单例，长会话里会累积到不可信），
 * 但**不匹配** {@link isRawPathTransient} 的正则 —— 于是原来会走
 * {@code if (!isRawPathTransient(e)) throw e} 直接把整轮抛掉，
 * <b>三次重试一次都没参与</b>。实测：连跑十几个 flow 之后 checkout 稳定卡在
 * launch 阶段，单独重跑照样卡，清掉孤儿进程后立刻就过。</p>
 */
function isAutomatorTimeout(e) {
  return /timeout waiting for automator|automator response/i.test((e && e.message) || '')
}

/**
 * 回收上一轮遗留的 devtools CLI 子进程。
 *
 * <p>真因就在这里：每次 launch 会拉起 {@code cli -o} 之类的 helper，异常退出时它不一定被收走，
 * 而它**占着自动化通道** —— 下一次 launch 于是一直等不到响应。不清它，重试多少次都是白搭。</p>
 *
 * <p><b>只杀 CLI helper，绝不碰开发者工具本体</b>（Electron 主进程）：本体在无头 shell 里
 * 起不回来，杀了整台机器的 mp 测试就全停了。</p>
 */
function reapOrphanCli() {
  try {
    execSync('pkill -f "cli -o" 2>/dev/null || true', { stdio: 'ignore' })
  }
  catch { /* pkill 没匹配到会返回非 0，属正常 */ }
}

/** 连上之后探到 currentPage() 能用为止；一直是 rawPath 瞬态就返回 false 让外层重连。 */
async function probeReady(mp) {
  for (let i = 1; i <= READY_PROBES; i++) {
    try {
      const page = await mp.currentPage()
      if (page) return true
    }
    catch (e) {
      if (!isRawPathTransient(e)) throw e
    }
    await sleep(2000)
  }
  return false
}

async function launchWithRetry(dist) {
  let last
  for (let i = 1; i <= LAUNCH_ATTEMPTS; i++) {
    let mp = null
    try {
      mp = await launch({ projectPath: dist })
      if (await probeReady(mp)) return mp
      console.log(`[run] devtools webview 还没重建好（第 ${i}/${LAUNCH_ATTEMPTS} 次）→ 断开重连`)
      await safeDisconnect(mp)
    }
    catch (e) {
      last = e
      await safeDisconnect(mp)
      if (!isRawPathTransient(e) && !isAutomatorTimeout(e)) throw e
      if (isAutomatorTimeout(e)) {
        // 等不到响应基本都是上一轮的 cli helper 没被收走、占着自动化通道。
        // 不清它就重连 = 白重连三次然后报同一个错。
        reapOrphanCli()
        console.log(`[run] automator 无响应 → 已回收孤儿 cli 进程，重连（第 ${i}/${LAUNCH_ATTEMPTS} 次）`)
      }
      else {
        console.log(`[run] devtools 重建工程中（rawPath 瞬态，第 ${i}/${LAUNCH_ATTEMPTS} 次）`)
      }
    }
    await sleep(8000)
  }
  throw last || new Error('devtools 连了 3 次都没就绪（rawPath 瞬态一直不退）')
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MINIAPP = path.resolve(__dirname, '../..')

const FLOWS = {
  smoke: () => import('./flows/smoke.mjs'),
  login: () => import('./flows/login.mjs'),
  home: () => import('./flows/home.mjs'),
  product: () => import('./flows/product.mjs'),
  cart: () => import('./flows/cart.mjs'),
  checkout: () => import('./flows/checkout.mjs'),
  orders: () => import('./flows/orders.mjs'),
  // 只验「人点得到」，不验页面内容 —— 其它 flow 全是程序化直达目的地，对可达性集体失明
  reachability: () => import('./flows/reachability.mjs'),
}

/**
 * 产物是否已是可用的 dev profile。
 *
 * <p>为什么要判：accept 命令是**裸** `node test/e2e/run.mjs smoke`（不带 --build），而本工程
 * `pnpm build:mp` 默认出的是 production profile（后端指向线上）。不判就会出现「命令跑绿了、
 * 其实打的是线上后端」。缺产物或 profile 不对 → 自动补一次 dev 构建（可 --no-auto-build 关掉）。</p>
 */
function distLooksDev(dist) {
  if (!existsSync(path.join(dist, 'app.json'))) return false
  for (const needle of ['localhost:8080', 'wxMOCKMOCKMOCKMOCK', 'mp-applet-gz-jp']) {
    try {
      execSync(
        `grep -rql --include='*.js' --include='*.json' ${JSON.stringify(needle)} ${JSON.stringify(dist)}`,
        { stdio: 'ignore' },
      )
    }
    catch { return false }
  }
  return true
}

async function main() {
  const args = process.argv.slice(2)
  const flowArg = args.find(a => !a.startsWith('--')) || 'smoke'
  const doBuild = args.includes('--build')
  const noAutoBuild = args.includes('--no-auto-build')
  const buildMode = (() => { const i = args.indexOf('--build'); return (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : 'development' })()

  const names = flowArg === 'all' ? Object.keys(FLOWS) : flowArg.split(',')
  for (const n of names) if (!FLOWS[n]) { console.error(`未知 flow: ${n}（可选：${Object.keys(FLOWS).join('/')}/all）`); process.exit(2) }

  let dist = process.env.MP_DIST || path.join(MINIAPP, 'dist/build/mp-weixin')
  if (doBuild) {
    dist = await buildDist({ mode: buildMode })
  }
  else if (!noAutoBuild && !distLooksDev(dist)) {
    console.log('[run] 产物缺失或不是 dev profile → 自动补一次 `uni build --mode development`')
    console.log('      （本工程 pnpm build:mp = production profile，后端指向线上，不能拿来跑本地 E2E）')
    dist = await buildDist({ mode: 'development' })
  }

  await preflight({ dist })

  // 兜底超时按 flow 数量摊，别用一个固定值卡整轮：240s 是照「单个 flow」定的，
  // 跑 `all`（7 个 flow）时最后一个必被这把刀砍掉 —— 报出来是 flow 挂了，其实是预算用完，
  // 最能误导人的一类假红。单 flow 仍是 240s，只是整轮按个数放大。
  const budgetMs = Number(process.env.MP_E2E_TIMEOUT_MS || 0) || names.length * 240000
  const hardTimer = setTimeout(() => {
    console.error(`=== HARD TIMEOUT ${Math.round(budgetMs / 1000)}s（${names.length} 个 flow 的总预算）===`)
    process.exit(3)
  }, budgetMs)
  let mp
  try {
    let failures = 0
    for (const name of names) {
      console.log(`\n=== flow: ${name} ===`)
      const mod = await FLOWS[name]()

      // ★ 每个 flow 独占一个全新 automator 会话，跑完就断。
      //
      // 为什么不复用一个长会话（实测教训）：单跑每个 flow 都绿，7 个串在一个会话里跑却
      // **逐个往下烂** —— 先是深层页查不到元素，到后面连首页的场卡都查不出来，而同一时刻
      // 后端 curl 一切正常。devtools 自动化是**共享单例**，长会话里 webview / 页面栈 /
      // 存储会累积到不可信。这种假红最坑：它长得跟真 bug 一模一样，会把人送去查根本没坏的业务代码。
      // 重连一次约 10-20s，换掉「7 个 flow 有 4 个说不清为什么红」很值。
      console.log(`[run] launch automation  dist=${dist}`)
      mp = await launchWithRetry(dist)
      console.log('[run] ✓ automation launched')

      // 硬 gate：小程序自己能不能打到本地后端（preflight 那条是 node 用 curl 探的，
      // 探不出 devtools 的「不校验合法域名」开关关着 —— 那会让所有 flow 以「登录失败 /
      // 页面停在 loading」的面目挂掉，看着像代码 bug）
      await assertBackendReachableFromMp(mp)
      console.log('[run] ✓ 小程序侧 wx.request 能打到本地后端（域名校验已放开）')

      try { await mod.run(mp); console.log(`[PASS] ${name}`) }
      catch (e) { failures++; console.error(`[FAIL] ${name}: ${e.message}`) }

      await safeDisconnect(mp)
      mp = null
    }

    clearTimeout(hardTimer)
    console.log(`\n[run] 结束：${names.length - failures}/${names.length} flow 通过`)
    process.exit(failures ? 1 : 0)
  }
  catch (e) {
    console.error(`[run] launch/run 异常: ${e.message}`)
    if (/http port|port is open/i.test(e.message || '')) {
      console.error(
        '\n  ↑ 这是**本机 GUI 开关**没打开，不是代码问题：\n'
        + '    微信开发者工具 → 设置 → 安全设置 → 打开「服务端口」，然后重跑。\n'
        + '    （脚本无法远程打开它；也不要为了绕过它去改 preflight —— 那是把硬 gate 变成假绿。）',
      )
    }
    await safeDisconnect(mp)
    clearTimeout(hardTimer)
    process.exit(2)
  }
}

main()
