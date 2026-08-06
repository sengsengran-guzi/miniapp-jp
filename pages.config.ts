import { defineUniPages } from '@uni-helper/vite-plugin-uni-pages'
import { tabBar } from './src/tabbar/config'

export default defineUniPages({
  globalStyle: {
    navigationStyle: 'default',
    navigationBarTitleText: '谷子宇宙拼团',
    // 视觉基调方案 A（UI:global.theme）：导航栏白 + 墨黑字，页面底暖浅灰（src/style/c-tokens.scss）
    navigationBarBackgroundColor: '#FFFFFF',
    navigationBarTextStyle: 'black',
    backgroundColor: '#F4F2ED',
  },
  easycom: {
    autoscan: true,
    custom: {
      '^fg-(.*)': '@/components/fg-$1/fg-$1.vue',
      '^(?!z-paging-refresh|z-paging-load-more)z-paging(.*)':
        'z-paging/components/z-paging$1/z-paging$1.vue',
      '^wd-(.*)': 'wot-design-uni/components/wd-$1/wd-$1.vue',
      // 业务组件统一前缀 `Biz`，自动从 src/components/biz/ 加载（组件库无关纪律 CLAUDE.md §7.5）
      // 用法：<BizPanel />（kebab-case 在 mp-weixin 自动转换为 file PascalCase）
      '^Biz(.*)': '@/components/biz/Biz$1.vue',
    },
  },
  // tabbar 的配置统一在 “./src/tabbar/config.ts” 文件中
  tabBar: tabBar as any,
})
