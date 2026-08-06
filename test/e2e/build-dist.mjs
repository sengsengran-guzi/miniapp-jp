/**
 * build-dist —— 产出一份「完整 + dev profile」的 mp-weixin 编译产物给 E2E 用。
 *
 * 三个坑：
 *   - dev profile（--mode development）才带 VITE_WX_APPID=wxMOCKMOCKMOCKMOCK → 登录走 wxMOCK 短路，
 *     模拟器内零真机即可跑通登录态。
 *   - ★ 本工程独有：`pnpm build:mp`（无 --mode）= production profile，VITE_SERVER_BASEURL 指向
 *     **线上** https://guzi.tianda.studio —— 拿它跑本地 E2E 会静默打到线上后端（不报错、断言却漂）。
 *     所以 E2E 产物必须 --mode development（后端 localhost:8080）。preflight 会体检这一条。
 *   - memory「mp-build-devtools-hang」：uni build 尾部唤 devtools cli 预览会永久挂起，但 dist 其实已生成。
 *     解法：轮询 app.json 出现且大小稳定 → 杀掉构建进程树 + pkill cli 预览 → 视为成功。
 *
 * ⚠️ dist/dev（`pnpm dev:mp` watch 产物）与 dist/build（`uni build` 产物）是两套目录，别搞混：
 *    E2E 统一用 dist/build/mp-weixin（一次性、完整、可确定 profile）。
 */
import { spawn, execSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MINIAPP = path.resolve(__dirname, '../..')
const DIST = path.join(MINIAPP, 'dist/build/mp-weixin')
const APP_JSON = path.join(DIST, 'app.json')
const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function buildDist({ mode = 'development', timeoutMs = 180000 } = {}) {
  console.log(`[build-dist] uni build -p mp-weixin --mode ${mode}  (cwd=${MINIAPP})`)
  const startedAt = Date.now()
  const child = spawn('npx', ['uni', 'build', '-p', 'mp-weixin', '--mode', mode], {
    cwd: MINIAPP,
    stdio: 'ignore',
    env: { ...process.env },
  })

  let lastSize = -1
  let stableHits = 0
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(2000)
    if (existsSync(APP_JSON) && statSync(APP_JSON).mtimeMs >= startedAt) {
      const size = statSync(APP_JSON).size
      if (size === lastSize && size > 0) stableHits++
      else { stableHits = 0; lastSize = size }
      // app.json 稳定 2 拍 + dist 关键文件齐 → 认为产物就绪
      if (stableHits >= 2 && existsSync(path.join(DIST, 'app.js'))) {
        console.log('[build-dist] dist 就绪 → 收尾杀构建进程树')
        try { child.kill('SIGTERM') } catch {}
        try { execSync("pkill -f 'uni build|@dcloudio' 2>/dev/null", { stdio: 'ignore' }) } catch {}
        // ⚠️ 默认**不**杀微信开发者工具：这台机器上 IDE 通常是 Kevin 本人开着的（手工调试 / 已登录态），
        //    杀掉等于抢他的工位，且登录态只能人扫码恢复。automator 能连已在跑的 IDE，冷启动非必需。
        //    确实需要冷启动（IDE 卡死等）时显式 MP_E2E_KILL_DEVTOOLS=1。
        if (process.env.MP_E2E_KILL_DEVTOOLS === '1') {
          console.log('[build-dist] MP_E2E_KILL_DEVTOOLS=1 → 顺带清 devtools 冷启动')
          try { execSync('pkill -f wechatwebdevtools 2>/dev/null', { stdio: 'ignore' }) } catch {}
        }
        await sleep(3000)
        return DIST
      }
    }
    if (child.exitCode !== null) {
      // 构建自己退出了（没挂）→ 校验产物
      if (existsSync(APP_JSON)) { console.log('[build-dist] 构建正常退出, dist 就绪'); return DIST }
      throw new Error('构建退出但 dist 缺 app.json')
    }
  }
  try { child.kill('SIGKILL') } catch {}
  throw new Error(`[build-dist] 超时 ${timeoutMs}ms 仍无完整 dist`)
}

export { DIST }

// 直接 `node build-dist.mjs` 调用
if (import.meta.url === `file://${process.argv[1]}`) {
  buildDist({ mode: process.argv[2] || 'development' })
    .then(d => { console.log('OK →', d); process.exit(0) })
    .catch(e => { console.error('ERR', e.message); process.exit(1) })
}
