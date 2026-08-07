# 谷子宇宙拼团小程序 模拟器 E2E（kevin-qa Tier 1B）

AI 驱动微信开发者工具模拟器，自动跑 mp 端功能流 E2E —— 取代过去靠 Kevin 真机点的可达性 / happy-path 人验。
admin 端走 Playwright（kevin-qa 另有）；本目录只管**拼团**小程序（`code/main/miniapp-jp`）。

> 现有小程序（谷子宇宙）另有一套同构 harness 在 `code/main/miniapp/test/e2e/`。
> 两套**共用同一个微信开发者工具**，见下方「并发约束」——必须串行。

## ⚠️ 并发约束（硬约束，别踩）

**devtools 自动化端口是共享单例、禁并发。**

- 同一时刻**只能有一个** `run.mjs` 在跑。第二个会撞到「Port in use」，或更坏 —— 连上**别人的**
  项目窗口，于是断言在错误的小程序上跑（假绿/假红都可能）。
- 两个小程序（`miniapp` / `miniapp-jp`）的 E2E **必须互相串行**，CI 里排队跑，不能并行。
  这和后端 8080 / plus-ui 8090 是同一类「共享单例端口」约束。
- 实操：主线程统一派**一个** kevin-qa 把整批 mp ticket 串着跑完，不要一个 ticket 派一个。
- 同理，跑 E2E 期间别在 IDE 里手工点这个项目（点击会互相打架）。

## 为什么独立 package.json

驱动 `miniprogram-automator`（官方自动化 SDK，仅测试用）装在本目录自己的 `node_modules`，
**不进** `miniapp-jp/package.json` 的依赖树 —— 不触发 CLAUDE.md §6 铁律 8（不引未澄清的 app 依赖）。

```bash
cd code/main/miniapp-jp/test/e2e && npm install   # 首次，装 miniprogram-automator
```

## 跑

```bash
cd code/main/miniapp-jp

# 渲染 + 导航可达性（6 个公开页，置信最高，不需登录态）
node test/e2e/run.mjs smoke

# 微信登录全链路 + 隐私协议合规闸门（wxMOCK 短路，零真机）
node test/e2e/run.mjs login

# 首页聚合三区块（banner 不塌陷 / 场三组 / 订单入口；★ 会直连后端比对场名，
# 证明卡片文案来自真数据而非前端 mock —— 依赖 dev 库里至少有 1 个开过的场）
node test/e2e/run.mjs home

# 场详情 + 商品详情（GZ-JP-202）。★ 真点两跳：首页场卡 → 场详情 → 商品卡 → 商品详情，
# 并把「加购置灰状态」与后端 eventBookable 绑死断言；同样直连后端比对场名/商品名/价格/注意事项。
# 依赖 dev 库里至少有 1 个开过的场，且该场至少 1 件 on_shelf 商品
node test/e2e/run.mjs product

# 加购到结算全流程（GZ-JP-203）。★ 需登录态（flow 自己走真实登录路径），并用 app 自己的 token
# 直连后端当独立数据源：点「加入购物车」后断言**后端购物车真多了一行**（不是看 toast）、
# 三跳可达购物车、按场分组、合计 == validAmountCent、改数量后前后端都跟着变、
# 「去结算」闸门双向（全不选置灰 / 全选可点）、底部只有商品合计一行。
# ⚠️ 会先清空该测试用户的购物车拿确定性起点（dev 的 wxMOCK 用户，userId=14）
node test/e2e/run.mjs cart

# 下单确认 + 支付（GZ-JP-204）。★ 需登录态。真点购物车「去结算」→ 确认页，断言：
# 带过去的是【购物车项 id】不是商品 id、默认地址自动选中、**新增地址走真表单真落库**、
# 商品清单只读（无 stepper / 无删除）、★★ 金额区恰好两行且无配送费用字样、
# ★★「已阅读不支持退款」闸门双向（未勾置灰 / 勾上可点）、提交后**后端订单真多一张**、
# dev mock 支付把订单驱动到 paid 且商品行进 purchasing、下单后购物车被清空。
# ⚠️ 会清空该测试用户的购物车 + 新增一条地址（dev 的 wxMOCK 用户，userId=14）
node test/e2e/run.mjs checkout

# 全部（串行）
node test/e2e/run.mjs all

# 强制重建产物再跑（改了 src 之后）
node test/e2e/run.mjs all --build development
```

退出码：`0` 全过 ｜ `1` flow 断言失败 ｜ `2` preflight/launch 失败 ｜ `3` 硬超时。
kevin-qa 按 ticket 涉及的页选 flow 跑；非 0 = gate 失败，闭环回 coder。

截图落 `/tmp/gz-jp-e2e-shots/`（与现有小程序的 `/tmp/gz-e2e-shots/` 分开，两套不互相覆盖）。

### 产物 profile —— 本工程独有的坑

`pnpm build:mp`（不带 `--mode`）出的是 **production profile**，`VITE_SERVER_BASEURL` 指向**线上**
`https://guzi.tianda.studio`。拿它跑本地 E2E 会静默打到线上后端：不报错，断言却漂 —— 最贵的一类假绿。

所以：

- E2E 产物必须 `--mode development`（后端 `localhost:8080` + `wxMOCK` 短路 appid）。
- `run.mjs` 会在跑之前**自动体检并按需重建**（所以裸跑 `node test/e2e/run.mjs smoke` 是安全的）；
  `--no-auto-build` 可关掉自动重建。
- preflight 另有一道阻塞体检，产物 profile 不对直接退 2。

## 硬 gate「无降级」前置（preflight 逐项体检，缺哪报哪 + 给修复命令）

| # | 检查 | 阻塞? |
|---|---|---|
| 1 | devtools cli 存在 | ✅ |
| 2 | devtools「服务端口」开着（设置 → 安全设置 → 服务端口） | ⚠️ advisory |
| 3 | **devtools 已登录**（`cli islogin`） | ✅ |
| 4 | dist 完整（有 app.json） | ✅ |
| 5 | dist 是 dev profile（本地后端 + wxMOCK + jp clientid） | ✅ |
| 6 | 后端在跑（`localhost:8080`，401 也算活着） | ✅ |
| 7 | 后端认 `clientid=mp-applet-gz-jp`（GZ-SYS-020 多 appid 底座在不在） | ✅ |
| 8 | **小程序自己**的 `wx.request` 能打到本地后端（launch 之后跑，见下） | ✅ |

第 8 项在 `run.mjs` 里、launch 之后跑（`assertBackendReachableFromMp`）：第 6 项是 **node 用 curl** 探的，
只证明后端活着；小程序的请求走 devtools 网络栈，中间还隔一道「不校验合法域名」开关。

起后端：`cd code/main/RuoYi-Vue-Plus && mvn spring-boot:run -pl ruoyi-admin`
起基础设施：`docker compose -f script/docker/dev-compose.yml up -d`（MySQL / Redis / MinIO）

> 环境起不来 = 阻塞 mp ticket（Kevin 拍板的硬 gate，不静默降级）。
> **别为了让命令变绿去注释 preflight** —— 那是把硬 gate 变成假绿，比红更贵。

## 四道已解决的坑（写死在代码里，勿删注释）

- **代理**：shell `no_proxy` 空 → clash 吞 127.0.0.1 → automator HTTP 探测挂死。驱动启动即清代理。
- **checkVersion 崩**：devtools 2.01 把 `Tool.getInfo` 的 `.SDKVersion` 改名 `.version`，旧 SDK 读不到 → 崩。
  monkeypatch 旁路该守卫（协议本身正常）。
- **App.\* 挂死**：automation 模式要「信任并打开」→ `launch({ trustProject: true })`。
- **构建假挂起**：`uni build` 尾部唤 devtools 预览可能永久挂，但 dist 已生成 → build-dist.mjs 轮询 app.json 稳定后杀进程。
  ★ 与源 harness 不同：**默认不 pkill 微信开发者工具**（那通常是 Kevin 本人开着的，登录态只能人扫码恢复）。
  真要冷启动加 `MP_E2E_KILL_DEVTOOLS=1`。

### ★ devtools 登录过期 —— 报错方向完全错，认准这条

IDE 登录过期（`cli islogin` → `{"login":false}`）时表象有两种，**都不指向真因**：

- 真 appid 工程：automator 报 `Failed to launch wechat web devTools, please make sure http port is open`
  —— 让你去查服务端口，但服务端口其实开着；
- `touristappid` 工程（本工程一期就是）：`cli auto` **成功**、ws 端口起来、`connect()` 秒连，
  但之后**每条** App 层命令都 10s 超时（`timeout waiting for automator response`），看着像小程序代码崩了。

真错误藏在 cli 的 stderr：`错误 Error: 需要重新登录 (code 10)`。
**修法只有一个：打开微信开发者工具，用手机微信扫码登录。**（本机一次性人工动作，脚本代不了。）
preflight 第 3 项就是为了把这半天排查压成一句话。

### ★★ 「不校验合法域名」没勾 —— 表象是「登录失败 / 页面全停在 loading」

小程序里所有 `uni.request` 一律 `request:fail url not in domain list`，于是：
flow 报「登录失败」、smoke 报某些页 `views` 不够（其实是停在 loading 态）。**看着像代码 bug，不是。**

**修法只有一个（本机一次性人工动作）**：
微信开发者工具 → 打开本工程（`dist/build/mp-weixin`）→ 右上角「详情」→「本地设置」→
勾上 **「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**。

GZ-JP-204 逐个试过、**全都压不住**已开着的域名校验，别再重复试：
`project.config.json` 的 `setting.urlCheck:false`（uni 已按 manifest 生成，本来就是 false）/
写 `project.private.config.json` / `cli close --project` 重开 / 换 appid / 换工程路径新建工程。
`cli` 也没有对应子命令。

顺带两条同源结论：

- **不能用 `touristappid`**：游客模式下 devtools **强制**域名校验，`urlCheck` 完全无效。
  所以占位 appid（`wxMOCK...`）会被 `mp-e2e.mjs` 换成一个**真** appid（`WX_DEVTOOLS_E2E_APPID`
  可覆盖，默认借用现有谷子宇宙小程序的）。只用于本地工程关联，**不影响运行时**：
  后端按请求头 `clientid` 路由，登录短路看 bundle 里的 `VITE_WX_APPID`（仍是 wxMOCK）。
- **别写 `project.private.config.json`**：一旦存在，devtools 以它为准解释工程设置，
  只写半截反而把域名校验**重新打开**。`ensureLaunchableAppid` 会主动删掉它。

### ★★ 选择器不跨自定义组件 —— `page.$('.biz-xxx')` 恒为 null

微信 `SelectorQuery`（automator `page.$` / `$$` 的底层）**不跨自定义组件边界**：
`.biz-cart-item__name` / `.jp-event-card` / `.login-agree__box` / `.me-header__top` 这类
**写在组件内部**的类，直接查一律 `null` / `[]`，哪怕它就在屏幕上。

**最阴的地方**：`$$` 查不到时返回 `[]`，于是「页面上不该有 X」这类断言会**恒真**——
写了跟没写一样。GZ-JP-204 的「清单必须是只读的（无 stepper / 无删除）」原本就中过这一枪。

**用法**：组件内选择器一律走 `mp-e2e.mjs` 的 `deep / deepAll / deepTexts`，
它们拼的是官方后代选择器 `'.jp-screen >>> 你的选择器'`。

`.jp-screen` 是**页面级锚点**：每个页面的 `<BizScreen class="jp-screen">`（宿主节点写在页面模板里
⇒ 属页面作用域）。`>>>` 的「祖先」必须是页面自己模板里的节点，而本工程每页的模板根就是 `<BizScreen>`
组件、登录弹层还挂在它**内部** —— 没有这个锚点，登录 sheet 在页面作用域里连一个可选的祖先都没有。
**新页照抄 `<BizScreen class="jp-screen">`**（该类无任何样式，纯锚点）。

判断规则很简单：选择器定义在 `src/pages/**` 里 → 直接 `page.$`；定义在
`src/components/biz/**` 里 → 必须 `deep`。

### rawPath 瞬态（dist 刚重建后的第一跑）

`Cannot destructure property 'rawPath' of 't.getPageMetaByWebviewId(...)' as it is null`
= devtools 正在重新导入 / 重新编译工程，automator 拿到空的 page meta。**与被测代码无关**。
`run.mjs` 的 `launchWithRetry` 已自动重试一次；手写脚本撞到就等 5 秒重跑。

## 加新 flow（后续所有 mp ticket 都要做）

0. 页面模板根写 `<BizScreen class="jp-screen">`（跨组件深选择器的锚点，见上）。
1. 写 `flows/<page>.mjs`，导出 `async run(mp)`，用 `mp-e2e.mjs` 的
   `gotoPage / assertRendered / screenshot / sleep`；**组件内选择器用 `deep / deepAll / deepTexts`**；
   登录态用 `logoutIfLoggedIn / loginIfNeeded / readAppToken / readPersistedUser / hasAgreedPrivacy`。
   **需要登录的 flow**（购物车 / 下单）：`loginIfNeeded(mp)` 拨到登录态 → `readAppToken(mp)` 拿
   **app 自己那个会话**的 sa-token 去直连后端当独立数据源（别另调一次 wx-login —— 那是另一个会话，
   看到的车可能不是页面上那辆）。
2. 在 `run.mjs` 的 `FLOWS` 注册表加一行。
3. **新页只是可达性**的话，不用新开 flow —— 往 `flows/smoke.mjs` 的 `PAGES` 加一行即可
   （这就是 mp ticket「AC X(a) AI 模拟器可达」的落点）。
4. 在 `self-test.mjs` 补一个 happy 场景 + **至少一个 negative 场景**（见下）。

## self-test —— 不需要 devtools 的 flow 逻辑体检

```bash
node test/e2e/self-test.mjs     # 0 = 全过
```

用假 miniProgram 句柄把 flow 跑一遍，**零环境依赖**。作用是把两类长得一样的失败分开：

- **flow 代码写错**（选择器打错 / 断言写反 / 漏 await）→ self-test 就红 → 改代码；
- **本机环境不行**（IDE 没登录 / 端口关 / 卡死）→ self-test 绿、`run.mjs` 红 → 修环境，代码是好的。

写 negative 场景不是可选项：只写 happy 的断言常年恒真，等于没写。现有 46 个用例里 **30 个是 negative**
（缺标志元素 / 渲染空壳 / 协议框默认勾选 / 登成另一个小程序的用户 / banner 塌陷 / 分组顺序错 /
跳错页 / 页面显示前端 mock 文案 / 已结束提示条与后端状态不符 / 价格换算错 / 缺包邮标识 /
注意事项被截断 / 注意事项排到 CTA 之后 / **加购置灰态与 eventBookable 不符**（两个方向各一条）/
**加购没真落库** / **底部冒出第二笔费用** / 缺「已包邮」标注 / 改数量没落库 / 合计不跟后端 /
**去结算闸门写死**（恒可点 / 恒置灰，两个方向各一条）/ 失效商品没标「已失效」/ 失效商品被算进合计 /
购物车角标与后端款数对不上 / fixture 空了）。

> cart 的假件比前几个复杂一档：它带一个**内存版后端**，假 app 的 tap 去写它、假页面从它渲染，
> flow 拿到的 `readCart` 读的也是它 —— 于是「页面与后端对得上」这条断言在假件里同样有内容，
> negative 只要让两者故意脱钩（加购不落库 / 合计写死 / 文案写死）就必然 fail。

> **等待时长**：self-test 里假句柄的「渲染」是瞬时的，flow 中为真模拟器准备的 `sleep(2500)` 纯属空等，
> flow 一多就把 self-test 拖到几分钟、于是没人愿意跑。所以 self-test 开头设 `MP_E2E_SLEEP_SCALE=0`，
> 整轮变成秒级。**该变量只缩放「等多久」，不改任何断言、不跳过任何步骤**，`run.mjs` 真跑时不设置（恒为原速）。
