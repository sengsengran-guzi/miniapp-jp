import type { Preset } from 'unocss'
import { FileSystemIconLoader } from '@iconify/utils/lib/loader/node-loaders'

// https://www.npmjs.com/package/@uni-helper/unocss-preset-uni
import { presetUni } from '@uni-helper/unocss-preset-uni'
// @see https://unocss.dev/presets/legacy-compat
import { presetLegacyCompat } from '@unocss/preset-legacy-compat'
import {
  defineConfig,
  presetIcons,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'

export default defineConfig({
  presets: [
    presetUni({
      attributify: false,
    }),
    presetIcons({
      scale: 1.2,
      warn: true,
      extraProperties: {
        'display': 'inline-block',
        'vertical-align': 'middle',
      },
      collections: {
        // 注册本地 SVG 图标集合, 从本地文件系统加载图标
        // 在 './src/static/my-icons' 目录下的所有 svg 文件将被注册为图标，
        // my-icons 是图标集合名称，使用 `i-my-icons-图标名` 调用
        'my-icons': FileSystemIconLoader(
          './src/static/my-icons',
          // 可选的，你可以提供一个 transform 回调来更改每个图标
          (svg) => {
            let svgStr = svg

            // 如果 SVG 文件未定义 `fill` 属性，则默认填充 `currentColor`, 这样图标颜色会继承文本颜色，方便在不同场景下适配
            svgStr = svgStr.includes('fill="')
              ? svgStr
              : svgStr.replace(/^<svg /, '<svg fill="currentColor" ')

            // 如果 svg 有 width, 和 height 属性，将这些属性改为 1em，否则无法显示图标
            svgStr = svgStr
              .replace(/(<svg.*?width=)"(.*?)"/, '$1"1em"')
              .replace(/(<svg.*?height=)"(.*?)"/, '$1"1em"')

            return svgStr
          },
        ),
      },
    }),
    // TODO: check 是否会有别的影响
    // 处理低端安卓机的样式问题
    // 将颜色函数 (rgb()和hsl()) 从空格分隔转换为逗号分隔，更好的兼容性app端，example：
    // `rgb(255 0 0)` -> `rgb(255, 0, 0)`
    // `rgba(255 0 0 / 0.5)` -> `rgba(255, 0, 0, 0.5)`
    presetLegacyCompat({
      commaStyleColorFunction: true,
      legacyColorSpace: true, // by QQ4群-量子蔷薇
      // @菲鸽 unocss 配置中，建议在 presetLegacyCompat 中添加 legacyColorSpace: true，以去除生成的颜色样式中的 in oklch 关键字，现在发现有些渐变色生成不符合预期
    }) as Preset,
  ],
  transformers: [
    // 启用指令功能：主要用于支持 @apply、@screen 和 theme() 等 CSS 指令
    transformerDirectives(),
    // 启用 () 分组功能
    // 支持css class组合，eg: `<div class="hover:(bg-gray-400 font-medium) font-(light mono)">测试 unocss</div>`
    transformerVariantGroup(),
  ],
  shortcuts: [
    {
      center: 'flex justify-center items-center',
    },
  ],
  // 注：C 设计系统的组件类（.c-panel / .c-btn / .c-tag / .c-manga-title 等）由
  // src/style/c-tokens.scss 全局定义（避免与 Uno shortcut 重名冲突）；这里只补色板 + 字号别名
  // 供 Uno 原子类用（text-c-red / bg-c-paper / border-c-ink / text-c-body 等）。
  // 动态图标需要在这里配置，或者写在vue页面中注释掉
  safelist: [
    'i-carbon-code',
    'i-carbon-home',
    'i-carbon-user',
    'i-carbon-ibm-watson-language-translator',
    'i-carbon-menu',
    // 4 板块 tabbar 图标（src/tabbar/config.ts customTabbarList）
    'i-carbon-pig',
    'i-carbon-tree',
    'i-carbon-warehouse',
    'i-carbon-store',
  ],
  rules: [
    [
      'p-safe',
      {
        padding:
          'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)',
      },
    ],
    ['pt-safe', { 'padding-top': 'env(safe-area-inset-top)' }],
    ['pb-safe', { 'padding-bottom': 'env(safe-area-inset-bottom)' }],
  ],
  theme: {
    colors: {
      /** 主题色，用法如: text-primary（C 套已对齐 --wot-color-theme = 朱红） */
      primary: 'var(--wot-color-theme,#E73E2A)',
      /**
       * C 日漫海报浓墨 调色板（text-c-red / bg-c-paper / border-c-ink …）。
       * ⚠ 必须与 src/style/c-tokens.scss 的 CSS 变量保持一致（两处真源）。
       */
      c: {
        'bg': '#F4F2ED',
        'surface': '#FFFFFF',
        'paper': '#FFFFFF',
        'ink': '#211D17',
        'ink-2': '#857D70',
        'ink-3': '#B4ADA1',
        'red': '#33B36B',
        'red-deep': '#2AA05E',
        'red-soft': '#E5F6EC',
        'danger': '#E0452F',
        'danger-soft': '#FCE9E4',
        'green': '#3FA85C',
        'green-soft': '#E6F4EA',
        'amber': '#E5A83C',
        'amber-soft': '#FBF0DC',
        'yellow': '#E5A83C',
        'blue': '#3C7BD4',
        'blue-soft': '#E7EFFA',
        'line': 'rgba(33,29,23,0.07)',
        // 占位彩纸底 tint（镜像 --c-tint-*，供 bg-c-tint-* 原子类）
        'tint-pink': '#FBE9F1',
        'tint-red': '#FCE9E4',
        'tint-blue': '#E7EFFA',
        'tint-yellow': '#FBF0DC',
        'tint-green': '#E6F4EA',
      },
    },
    fontSize: {
      /** 提供更小号的字体，用法如：text-2xs */
      '2xs': ['20rpx', '28rpx'],
      '3xs': ['18rpx', '26rpx'],
      // C 套字号别名（text-c-h1 / text-c-body …）
      'c-hero': ['84rpx', '90rpx'],
      'c-display': ['56rpx', '62rpx'],
      'c-h1': ['40rpx', '48rpx'],
      'c-h2': ['32rpx', '40rpx'],
      'c-lg': ['30rpx', '40rpx'],
      'c-body': ['26rpx', '36rpx'],
      'c-sm': ['22rpx', '30rpx'],
      'c-xs': ['20rpx', '28rpx'],
      'c-2xs': ['18rpx', '26rpx'],
      'c-3xs': ['16rpx', '22rpx'],
    },
  },
  // windows 系统会报错：[plugin:unocss:transformers:pre] Cannot overwrite a zero-length range - use append Left or prependRight instead.
  // 去掉下面的就正常了
  // content: {
  //   /**
  //    * 解决小程序报错 `./app.wxss(78:2814): unexpected unexpected at pos 5198`
  //    * 为什么同时使用include和exclude？虽然看起来多余，但同时配置两者是一种常见的 `防御性编程` 做法。
  //      1. 结构变化保障 : 如果未来项目结构发生变化，某些排除目录可能被移动到包含路径下，exclude配置可以确保它们仍被排除
  //      2. 明确性 : 明确列出要排除的目录使配置意图更加清晰
  //      3. 性能优化 : 避免处理不必要的文件，提高构建性能
  //      4. 防止冲突 : 排除第三方库和构建输出目录，避免潜在的CSS冲突
  //    */
  //   pipeline: {
  //     exclude: [
  //       'node_modules/**/*',
  //       'public/**/*',
  //       'dist/**/*',
  //     ],
  //     include: [
  //       './src/**/*',
  //     ],
  //   },
  // },
})
