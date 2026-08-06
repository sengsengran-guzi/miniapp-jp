import type { TabBar } from '@uni-helper/vite-plugin-uni-pages'
import type { CustomTabBarItem, NativeTabBarItem } from './types'

/**
 * miniapp-jp（谷子宇宙拼团）tabbar 配置 —— 一期 2 tab：首页 / 我的。
 *
 * tabbar 策略：
 * 0: NO_TABBAR     无 tabbar — 所有 page 按普通页面渲染
 * 1: NATIVE_TABBAR 原生 tabbar — **当前启用**
 * 2: CUSTOM_TABBAR 自定义 tabbar — 不启用（C 端不需要按角色动态显示 tab）
 *
 * 顺序固定：首页（UI:mp.home 聚合页：banner + 场 + 订单入口）/ 我的。
 *   - 启动默认落地首页（pages/index/index definePage type: 'home'）
 *   - 购物车 / 场详情 / 商品详情 / 订单列表都是普通页（navigateTo），不占 tab 位
 *   - 落地页走懒登录 + App.onLaunch silentLogin 静默建态；敏感动作（加购 / 下单 / 我的操作）
 *     才 ensureLoggedIn 弹协议 sheet 兜底
 *
 * 颜色对齐视觉基调方案 A（UI:global.theme，token 真源 src/style/c-tokens.scss）：
 *   选中品牌绿 #33B36B，未选中 --c-ink-2 (#857D70)，背景 --c-surface (#FFFFFF)。
 *
 * 图标：`static/tabbar/{home,homeHL,me,meHL}.png`（80x80 透明底 PNG，inactive 墨黑 + active 主色）。
 *   同名 drop-in 替换即可换图，无需改本文件。
 *
 * 修改本文件后需重启 `pnpm dev:mp-weixin` 才能让 pages.json 重新生成。
 */
export const TABBAR_STRATEGY_MAP = {
  NO_TABBAR: 0,
  NATIVE_TABBAR: 1,
  CUSTOM_TABBAR: 2,
}

export const selectedTabbarStrategy = TABBAR_STRATEGY_MAP.NATIVE_TABBAR

const homeTab: NativeTabBarItem = {
  iconPath: 'static/tabbar/home.png',
  selectedIconPath: 'static/tabbar/homeHL.png',
  pagePath: 'pages/index/index',
  text: '首页',
}
const meTab: NativeTabBarItem = {
  iconPath: 'static/tabbar/me.png',
  selectedIconPath: 'static/tabbar/meHL.png',
  pagePath: 'pages/me/index',
  text: '我的',
}

/** 原生 tabbar 配置：首页 / 我的（一期 2 格）。 */
export const nativeTabbarList: NativeTabBarItem[] = [homeTab, meTab]

/** 自定义 tabbar 配置（本项目不启用，保留同款结构兼容 tabbar/store.ts） */
export const customTabbarList: CustomTabBarItem[] = nativeTabbarList.map(item => ({
  text: item.text,
  pagePath: item.pagePath,
  iconType: 'unocss',
  icon: 'i-carbon-home',
  roles: [],
}))

export const tabbarCacheEnable
  = [TABBAR_STRATEGY_MAP.NATIVE_TABBAR, TABBAR_STRATEGY_MAP.CUSTOM_TABBAR].includes(selectedTabbarStrategy)

export const customTabbarEnable = [TABBAR_STRATEGY_MAP.CUSTOM_TABBAR].includes(selectedTabbarStrategy)
export const needHideNativeTabbar = selectedTabbarStrategy === TABBAR_STRATEGY_MAP.CUSTOM_TABBAR

const _tabbarList = customTabbarEnable
  ? customTabbarList.map(item => ({ text: item.text, pagePath: item.pagePath }))
  : nativeTabbarList
export const tabbarList = customTabbarEnable ? customTabbarList : nativeTabbarList

// 不下发 `customize` 字段：它仅 mp-alipay 支持，mp-weixin 收到会 console warning
// "invalid app.json tabBar[\"customize\"]"；本项目只发微信小程序，且自定义 tabbar 未启用。
const _tabbar: TabBar = {
  custom: selectedTabbarStrategy === TABBAR_STRATEGY_MAP.CUSTOM_TABBAR,
  // 对齐 c-tokens.scss：未选中 --c-ink-2 (#857D70)，选中品牌绿 (#33B36B)，背景 --c-surface (#FFFFFF)
  color: '#857D70',
  selectedColor: '#33B36B',
  backgroundColor: '#FFFFFF',
  borderStyle: 'white',
  height: '50px',
  fontSize: '10px',
  iconWidth: '24px',
  spacing: '3px',
  list: _tabbarList as unknown as TabBar['list'],
}

export const tabBar = tabbarCacheEnable ? _tabbar : undefined
