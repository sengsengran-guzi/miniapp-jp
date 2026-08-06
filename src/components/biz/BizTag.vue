<script setup lang="ts">
/**
 * BizTag — C 套标签（鸟金底黑字 / 反白墨底 / 红 / 绿 / 描边）。
 *
 * <pre>
 * &lt;BizTag&gt;免费&lt;/BizTag&gt;                  &lt;!-- 鸟金底 --&gt;
 * &lt;BizTag type="red"&gt;限定&lt;/BizTag&gt;
 * &lt;BizTag type="ink"&gt;EXTRA!!&lt;/BizTag&gt;     &lt;!-- 墨底金字 --&gt;
 * &lt;BizTag type="outline"&gt;截止 06/15&lt;/BizTag&gt;
 * </pre>
 *
 * <p>设计系统：doc/tokens.md / src/style/c-tokens.scss(.c-tag)</p>
 */
defineOptions({ name: 'BizTag' })

withDefaults(defineProps<Props>(), { type: 'yellow' })
interface Props {
  /** 配色：yellow(默认) / red / green / ink(墨底金字) / outline(白底描边) */
  type?: 'yellow' | 'red' | 'green' | 'ink' | 'outline'
}
</script>

<template>
  <text class="biz-tag" :class="`type-${type}`">
    <slot />
  </text>
</template>

<style lang="scss" scoped>
/* 清爽：柔和底 + 同色系文字，小圆角去描边。 */
.biz-tag {
  display: inline-flex;
  align-items: center;
  gap: 6rpx;
  padding: 4rpx 14rpx;
  font-size: var(--c-fs-2xs);
  font-weight: 600;
  letter-spacing: 0.4rpx;
  line-height: 1.5;
  border-radius: 8rpx;
  color: #b5791a;
  background: var(--c-amber-soft);
}
.type-red {
  background: var(--c-red-soft);
  color: var(--c-red);
}
.type-green {
  background: var(--c-green-soft);
  color: var(--c-green);
}
.type-ink {
  background: rgba(33, 29, 23, 0.05);
  color: var(--c-ink);
}
.type-outline {
  background: transparent;
  border: var(--c-bw-3) solid var(--c-line);
  color: var(--c-ink-2);
}
</style>
