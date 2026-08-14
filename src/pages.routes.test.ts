/**
 * 路由常量机器闸 —— 跨模块，不属于任何一张卡。
 *
 * <p><b>为什么需要它</b>：mp 的 {@code navigateTo} 传一个没注册的路径<b>不会编译报错</b>，
 * 运行时也只是走 fail 回调。而 fail 回调常被写成一句友好提示，于是
 * <b>「路由写错」在页面上长得和「功能还没做」一模一样</b>。</p>
 *
 * <p><b>真实事故</b>（本文件因此而生）：首页那张「我的订单」卡片的
 * {@code ORDER_LIST_ROUTE} 被写成 {@code '/pages/order/index'} —— 那是 GZ-JP-201 落地时
 * 订单页还没交付，<b>按约定猜</b>的值；GZ-JP-205 最终交付在 {@code '/pages/order/list'}，
 * 没人回来改。结果客人付完款离开支付结果页后，<b>全小程序没有任何一条路径能回订单列表</b>，
 * 一期最重的履约展示（六段状态 / 运单号复制 / 行级部分退款）整块不可达，
 * 而首页只提示「订单功能即将上线」。</p>
 *
 * <p><b>为什么单测和 E2E 都没拦住</b>：单测从没断言过这个常量的<b>值</b>；
 * E2E 的 orders flow 是 {@code gotoPage('/pages/order/list')} <b>程序化直达</b>目的地，
 * 它证明了「页面能渲染」，从没证明「人点得到」。两层测试同时对「可达性」这件事失明。</p>
 *
 * <p>所以这里不测某一个常量，而是<b>把全仓所有 {@code *_ROUTE} 常量按同一条规则扫一遍</b> ——
 * 下次谁再猜一个路由，这条用例立刻红。</p>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = path.dirname(fileURLToPath(import.meta.url))

/** pages.json 允许 // 与 /* *\/ 注释（uni-app 惯例），标准 JSON.parse 会炸，先剥掉。 */
function readPagesJson(): { pages: { path: string }[], tabBar?: { list?: { pagePath: string }[] } } {
  const raw = readFileSync(path.join(SRC, 'pages.json'), 'utf-8')
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  return JSON.parse(stripped)
}

/** 已注册页面路径集合（含 tabBar），统一带前导斜杠。 */
function registeredRoutes(): Set<string> {
  const cfg = readPagesJson()
  const out = new Set<string>()
  for (const p of cfg.pages ?? []) out.add(`/${p.path}`)
  for (const t of cfg.tabBar?.list ?? []) out.add(`/${t.pagePath}`)
  return out
}

interface RouteConst { file: string, line: number, name: string, value: string }

/** 扫全仓 `export const XXX_ROUTE = '/pages/...'`。测试文件与 e2e 不算。 */
function collectRouteConstants(): RouteConst[] {
  const found: RouteConst[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (entry === 'node_modules' || entry === 'dist')
          continue
        walk(full)
        continue
      }
      if (!/\.(?:ts|vue)$/.test(entry) || /\.test\.ts$/.test(entry))
        continue
      const text = readFileSync(full, 'utf-8')
      text.split('\n').forEach((line, i) => {
        const m = line.match(/export\s+const\s+([A-Z0-9_]*ROUTE)\s*=\s*['"](\/pages\/[^'"]*)['"]/)
        if (m)
          found.push({ file: path.relative(SRC, full), line: i + 1, name: m[1], value: m[2] })
      })
    }
  }
  walk(SRC)
  return found
}

describe('路由常量', () => {
  it('至少扫得到常量（防止正则失效导致整条闸静默通过）', () => {
    // 没有这条，上面正则哪天写坏了，下面两条会因为「一个都没扫到」而空转全绿。
    expect(collectRouteConstants().length).toBeGreaterThanOrEqual(3)
  })

  it('★ 每个 *_ROUTE 常量都必须指向 pages.json 里已注册的页面', () => {
    const registered = registeredRoutes()
    const bad = collectRouteConstants().filter(r => !registered.has(r.value))
    expect(
      bad.map(r => `${r.file}:${r.line} ${r.name} = '${r.value}'`),
      `以下路由常量指向未注册页面 —— navigateTo 会静默走 fail 回调，`
      + `在界面上长得像「功能没做」。已注册页面：\n${Array.from(registered).sort().join('\n')}`,
    ).toEqual([])
  })

  it('★ 同名 *_ROUTE 常量不许在多个模块里取不同的值', () => {
    // 事故当时正是这个形态：index.logic.ts 和 api/gz-jp/order.ts 各有一个
    // ORDER_LIST_ROUTE，值不一样，首页 import 了错的那个。
    const byName = new Map<string, Set<string>>()
    for (const r of collectRouteConstants()) {
      if (!byName.has(r.name))
        byName.set(r.name, new Set())
      byName.get(r.name)!.add(r.value)
    }
    const conflicts = Array.from(byName.entries())
      .filter(([, values]) => values.size > 1)
      .map(([name, values]) => `${name} 有 ${values.size} 个值：${Array.from(values).join(' / ')}`)
    expect(conflicts, '同名路由常量取值不一致 —— 调用方 import 到哪个全看运气').toEqual([])
  })
})
