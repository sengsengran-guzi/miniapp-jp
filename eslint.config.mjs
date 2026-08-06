import uniHelper from '@uni-helper/eslint-config'

export default uniHelper({
  unocss: true,
  vue: true,
  markdown: false,
  ignores: [
    // 忽略uni_modules目录
    '**/uni_modules/',
    // 忽略原生插件目录
    '**/nativeplugins/',
    'dist',
    // unplugin-auto-import 生成的类型文件，每次提交都改变，所以加入这里吧，与 .gitignore 配合使用
    'auto-import.d.ts',
    // vite-plugin-uni-pages 生成的类型文件，每次切换分支都一堆不同的，所以直接 .gitignore
    'uni-pages.d.ts',
    // 插件生成的文件
    'src/pages.json',
    'src/manifest.json',
    // 忽略自动生成文件
    'src/service/**',
    // unibest 脚手架 CLI（create-unibest）+ 其模板素材，非本项目业务代码，不参与 lint
    'packages/**',
    // 微信小程序自定义 tabbar 原生入口（Component() 全局，非 ESM 环境）
    'src/customize-tab-bar/**',
    // 模拟器 E2E harness：独立 node 包（自带 package.json + node_modules，node 运行时，非 app 源码，
    // 也不在 tsconfig 里）。风格刻意与兄弟工程 code/main/miniapp/test/e2e/ 保持逐行一致 —— 两套
    // harness 会长期共同演进、互相 cherry-pick，被 antfu 风格规则重排会让 diff 永久噪声化。
    // 它自己的逻辑体检走 `node test/e2e/self-test.mjs`（见该目录 README）。
    'test/e2e/**',
  ],
  // https://eslint-config.antfu.me/rules
  rules: {
    'no-useless-return': 'off',
    'no-console': 'off',
    'no-unused-vars': 'off',
    'vue/no-unused-refs': 'off',
    'unused-imports/no-unused-vars': 'off',
    'eslint-comments/no-unlimited-disable': 'off',
    'jsdoc/check-param-names': 'off',
    'jsdoc/require-returns-description': 'off',
    'ts/no-empty-object-type': 'off',
    'no-extend-native': 'off',
    'vue/singleline-html-element-content-newline': [
      'error',
      {
        externalIgnores: ['text'],
      },
    ],
    // vue SFC 调换顺序改这里
    'vue/block-order': ['error', {
      order: [['script', 'template'], 'style'],
    }],
  },
  formatters: {
    /**
     * Format CSS, LESS, SCSS files, also the `<style>` blocks in Vue
     * By default uses Prettier
     */
    css: true,
    /**
     * Format HTML files
     * By default uses Prettier
     */
    html: true,
  },
})
