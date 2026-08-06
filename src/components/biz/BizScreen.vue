<script setup lang="ts">
/**
 * BizScreen — C 日漫海报浓墨 屏幕根容器（米白纸底 + 横线稿纸纹）。
 *
 * <p>用法：作为页面根节点包裹整页内容，给统一的纸底 + 字体 + 横线纹。</p>
 * <pre>&lt;BizScreen&gt; …页面内容… &lt;/BizScreen&gt;</pre>
 *
 * <p>设计系统：doc/tokens.md / doc/13-设计语言-C日漫浓墨.md / src/style/c-tokens.scss(.c-screen)</p>
 */
defineOptions({ name: 'BizScreen' })

withDefaults(defineProps<Props>(), { tone: true })
interface Props {
  /** 是否显示横线稿纸纹（默认 true；纯净页可关） */
  tone?: boolean
}
</script>

<template>
  <view class="biz-screen" :class="{ 'biz-screen--plain': !tone }">
    <slot />
    <!-- 按需登录协议同意弹层（useLoginConsent 单例驱动；ensureLoggedIn 触发）。挂根容器全页通用 -->
    <BizLoginSheet />
  </view>
</template>

<style lang="scss" scoped>
.biz-screen {
  min-height: 100vh;
  box-sizing: border-box;
  color: var(--c-ink);
  font-family: var(--c-font);
  background-color: var(--c-bg);
}
.biz-screen--plain {
  background-color: var(--c-bg);
}
</style>
