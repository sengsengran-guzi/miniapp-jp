<script setup lang="ts">
/**
 * BizMangaTitle — 漫画粗黑标题（900 字重 + 紧字距 + 可选白描边）。
 *
 * <p>白描边在 mp-weixin 用 text-shadow 四角模拟（-webkit-text-stroke 不稳）。</p>
 * <pre>
 * &lt;BizMangaTitle&gt;拼团场次&lt;/BizMangaTitle&gt;
 * &lt;BizMangaTitle size="display" color="red" stroke&gt;欧皇!!&lt;/BizMangaTitle&gt;
 * </pre>
 *
 * <p>设计系统：doc/tokens.md / src/style/c-tokens.scss(.c-manga-title)</p>
 */
defineOptions({ name: 'BizMangaTitle' })

withDefaults(defineProps<Props>(), { size: 'h1', color: 'ink', stroke: false })
interface Props {
  /** 字号档：hero(84) / display(56) / h1(40,默认) / h2(32) */
  size?: 'hero' | 'display' | 'h1' | 'h2'
  /** 颜色：ink(默认) / red / green / blue / yellow / white */
  color?: 'ink' | 'red' | 'green' | 'blue' | 'yellow' | 'white'
  /** 白描边（叠在彩底/图上时增强识别度） */
  stroke?: boolean
}
</script>

<template>
  <text class="biz-manga-title" :class="[`size-${size}`, `color-${color}`, { 'has-stroke': stroke }]">
    <slot />
  </text>
</template>

<style lang="scss" scoped>
.biz-manga-title {
  display: inline-block;
  font-family: var(--c-font);
  font-weight: 700;
  letter-spacing: -0.4rpx;
  line-height: 1.2;
}
.size-hero {
  font-size: var(--c-fs-hero);
}
.size-display {
  font-size: var(--c-fs-display);
}
.size-h1 {
  font-size: var(--c-fs-h1);
}
.size-h2 {
  font-size: var(--c-fs-h2);
}

.color-ink {
  color: var(--c-ink);
}
.color-red {
  color: var(--c-red);
}
.color-green {
  color: var(--c-green);
}
.color-blue {
  color: var(--c-blue);
}
.color-yellow {
  color: var(--c-yellow);
}
.color-white {
  color: #fff;
}

/* 清爽改版：取消漫画白描边（stroke 属性保留兼容，但不再加 text-shadow）。 */
.has-stroke {
  text-shadow: none;
}
</style>
