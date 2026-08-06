# 谷子宇宙拼团 小程序（miniapp-jp）

日本代购拼团 C 端微信小程序。独立 appid、独立仓，**与 `code/main/miniapp`（拼豆 / 回收 / 扭蛋）
共用同一套后端**（RuoYi-Vue-Plus），后端按请求头 `clientid` 区分两个小程序。

- 本小程序 clientid：**`mp-applet-gz-jp`**（写错会收到「未配置的小程序客户端」报错，不会静默串到另一个小程序）
- 工程来源：GZ-JP-001 从 `code/main/miniapp` 复制裁剪（保留 http / token / useAuth / 登录合规件 / 样式 token）

## 技术栈

- uni-app + Vue 3 + TypeScript（脚手架 unibest：约定式路由 + pinia + UnoCSS）
- UI：wot-design-uni（**页面不直接撒 `<wd-*>`**，统一用 `src/components/biz/Biz*` 包一层，组件库无关纪律）
- 请求：`src/http/http.ts`（uni.request 封装 + sa-token 单 token + 401 静默续期，失败静默退化匿名浏览）
- 状态：Pinia + pinia-plugin-persistedstate
- 视觉：`src/style/c-tokens.scss`（CSS 变量真源）+ `uno.config.ts`，**组件禁止硬编码 hex**

## 常用命令

```bash
pnpm install                 # 安装依赖（pnpm only）
pnpm dev:mp-weixin           # 开发（watch）→ 产物 dist/dev/mp-weixin，用微信开发者工具打开这个目录
pnpm build:mp                # 生产构建     → 产物 dist/build/mp-weixin
pnpm type-check              # vue-tsc 类型检查
pnpm lint                    # eslint
pnpm test                    # vitest 单测
```

⚠️ `pnpm build:mp` 尾部会唤起微信开发者工具 cli 预览、进程看起来「挂住」——`pkill -f 'cli -o'`
即可，dist 其实已经生成完毕（已知现象，不代表构建失败）。

⚠️ `dist/dev` 与 `dist/build` 别搞混：开发者工具 import 的是哪个目录取决于你导入时选的路径，
改完代码要重跑对应命令重建。

## 环境变量

| 文件 | 用途 |
|---|---|
| `.env` | 公共：`VITE_APP_CLIENT_ID=mp-applet-gz-jp`、`VITE_UNI_APPID=__UNI__GZJP01`、租户 |
| `.env.development` | 本地：后端 `http://localhost:8080`、`VITE_MOCK_PAY=true` |
| `.env.staging` | 体验版：后端 `https://guzi.tianda.studio` |
| `.env.production` | 正式版：后端 `https://guzi.tianda.studio` |

**appid 一期用 `wxMOCKMOCKMOCKMOCK` 占位**（Kevin 2026-08-06 定）：业务代码见到 `wxMOCK` 前缀
自动短路（登录不调 `uni.login`、直接给后端 `mock-*` code；支付按 `VITE_MOCK_PAY` 走模拟回调）。
真 appid 到位后按 `doc/jp/phase-plan.md`「appid 回补清单」把三套 env 换真值 + 放
`private.<appid>.key`（上传私钥，`.gitignore` 已排除 `private.*.key`，永不入库），**代码无需改**。

## 目录结构（关键）

```
src/
├── api/           login / gz-common(sys_config) / gz-user / gz-file / gz-pay
├── components/biz Biz* 基础原子件（按钮/面板/弹层/空态/报头）+ BizLoginSheet 登录协议 sheet
├── composables/   useLoginConsent（隐私协议同意闸门）/ useCountdown
├── hooks/         useAuth（微信登录 / 静默登录 / ensureLoggedIn）/ useUpload / useScroll
├── http/          http.ts（401 静默续期）/ interceptor.ts（注入 clientid + Authorization）
├── locale/        auth / common / home / user / agreement（协议正文）
├── pages/         index(首页 tab) / me(我的 tab + about + profile) / login(兜底) / agreement
├── store/         token（sa-token + 静默续期）/ user
├── style/         c-tokens.scss（视觉 token 真源）
└── tabbar/        config.ts —— 一期 2 tab：首页 / 我的
```

## 登录模型（微信合规）

游客优先：未登录可浏览，**不设登录墙**。敏感动作触发 `useAuth.ensureLoggedIn()` → 弹
`BizLoginSheet` 协议同意 sheet（**默认不勾选**，主动勾选后才发起登录）。用户同意过一次后，
App 启动才允许 `silentLogin` 静默建态；登出会清除「已同意」态。
