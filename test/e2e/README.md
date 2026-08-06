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

## 加新 flow（后续所有 mp ticket 都要做）

1. 写 `flows/<page>.mjs`，导出 `async run(mp)`，用 `mp-e2e.mjs` 的
   `gotoPage / assertRendered / screenshot / sleep`；登录态用 `logoutIfLoggedIn / readPersistedUser / hasAgreedPrivacy`。
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

写 negative 场景不是可选项：只写 happy 的断言常年恒真，等于没写。现有 7 个用例里 4 个是 negative
（缺标志元素 / 渲染空壳 / 协议框默认勾选 / 登成另一个小程序的用户）。
