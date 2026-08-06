<script setup lang="ts">
/**
 * BizSpeechBubble — 漫画对话气泡（白底粗墨边 + 左下尖角圆角）。
 *
 * <pre>&lt;BizSpeechBubble&gt;开团啦!&lt;/BizSpeechBubble&gt;</pre>
 *
 * <p>设计系统：doc/tokens.md / src/style/c-tokens.scss(.c-speech)</p>
 */
defineOptions({ name: 'BizSpeechBubble' })

withDefaults(defineProps<Props>(), { size: 'md' })
interface Props {
  /** 尺寸：sm / md(默认) / lg */
  size?: 'sm' | 'md' | 'lg'
}
</script>

<template>
  <text class="biz-speech" :class="`size-${size}`">
    <slot />
  </text>
</template>

<style lang="scss" scoped>
.biz-speech {
  display: inline-block;
  font-weight: 500;
  color: var(--c-ink);
  background: var(--c-surface);
  border-radius: var(--c-radius);
  box-shadow: var(--c-shadow-sm);
}
.size-sm {
  padding: 8rpx 16rpx;
  font-size: var(--c-fs-xs);
}
.size-md {
  padding: 12rpx 24rpx;
  font-size: var(--c-fs-sm);
}
.size-lg {
  padding: 16rpx 28rpx;
  font-size: var(--c-fs-body);
}
</style>
