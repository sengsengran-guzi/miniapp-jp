/**
 * run.mjs —— mp E2E 入口。kevin-qa 用 Bash 调：`node test/e2e/run.mjs <flow|all> [--build [mode]]`。
 *
 * 串行执行（devtools 自动化端口是共享单例，禁并发——同 8080/8090 撞端口同一类约束）。
 * 两个小程序（miniapp / miniapp-jp）的 E2E 也必须**互相串行**，不能同时开跑。
 *
 * 退出码：0 全过 / 1 有 flow 断言失败 / 2 preflight 或 launch 失败 / 3 硬超时。
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
 */
async function launchWithRetry(dist) {
  try {
    return await launch({ projectPath: dist })
  }
  catch (e) {
    if (!/rawPath|getPageMetaByWebviewId/.test(e.message || '')) throw e
    console.log('[run] devtools 重建工程中（rawPath 瞬态）→ 5 秒后重试一次')
    await sleep(5000)
    return launch({ projectPath: dist })
  }
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

  const hardTimer = setTimeout(() => { console.error('=== HARD TIMEOUT 240s ==='); process.exit(3) }, 240000)
  let mp
  try {
    console.log(`[run] launch automation  dist=${dist}`)
    mp = await launchWithRetry(dist)
    console.log('[run] ✓ automation launched')

    // 硬 gate：小程序自己能不能打到本地后端（preflight 那条是 node 用 curl 探的，
    // 探不出 devtools 的「不校验合法域名」开关关着 —— 那会让所有 flow 以「登录失败 /
    // 页面停在 loading」的面目挂掉，看着像代码 bug）
    await assertBackendReachableFromMp(mp)
    console.log('[run] ✓ 小程序侧 wx.request 能打到本地后端（域名校验已放开）')

    let failures = 0
    for (const name of names) {
      console.log(`\n=== flow: ${name} ===`)
      const mod = await FLOWS[name]()
      try { await mod.run(mp); console.log(`[PASS] ${name}`) }
      catch (e) { failures++; console.error(`[FAIL] ${name}: ${e.message}`) }
    }

    await safeDisconnect(mp)
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
