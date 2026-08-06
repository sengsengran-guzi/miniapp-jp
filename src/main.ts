import { createSSRApp } from 'vue'
import App from './App.vue'
import { requestInterceptor } from './http/interceptor'
import { routeInterceptor } from './router/interceptor'

import store from './store'
import '@/style/index.scss'
import 'virtual:uno.css'

// 谷子宇宙是中国境内 C 端产品（CLAUDE.md：默认 zh-CN），UI 必须恒中文，
// 不随设备系统语言变（English 设备也得显示中文）。启动时锁定 zh-Hans：
// uni.getLocale() 之后恒返回 'zh-Hans'，全站 isEn() 分支恒走中文，
// 同时 wot-design-uni / uni 组件内置 i18n 也跟随中文。
try {
  uni.setLocale('zh-Hans')
}
catch (e) {
  console.warn('[gz] setLocale zh-Hans skipped', e)
}

export function createApp() {
  const app = createSSRApp(App)
  app.use(store)
  app.use(routeInterceptor)
  app.use(requestInterceptor)

  return {
    app,
  }
}
