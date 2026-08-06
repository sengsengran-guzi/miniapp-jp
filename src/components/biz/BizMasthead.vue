<script setup lang="ts">
/**
 * BizMasthead — C 套报头条（号外报纸风：issue 编码小字 + 漫画大标题 + 右侧黑签导航 + 虚线尾规）。
 *
 * <p>各页统一的页面报头块：标题 + 右侧导航链接；副标恒走 --c-ink-2。</p>
 *
 * <pre>
 * &lt;BizMasthead title="谷子宇宙拼团" nav-text="我的订单" @nav="goOrders" /&gt;
 * &lt;BizMasthead title="场详情"&gt;&lt;template #nav&gt;…自定义右侧…&lt;/template&gt;&lt;/BizMasthead&gt;
 * </pre>
 *
 * <p>设计系统：doc/tokens.md / src/style/c-tokens.scss / doc/13。</p>
 */
defineOptions({ name: 'BizMasthead' })

withDefaults(defineProps<Props>(), { issue: '', size: 'h1', navText: '' })
defineEmits<{ nav: [] }>()
interface Props {
  /** 页面标题 */
  title: string
  /** 旧版号外编码小字（清爽版不渲染，保留 prop 向后兼容） */
  issue?: string
  /** 标题字号档（默认 h1=40） */
  size?: 'hero' | 'display' | 'h1' | 'h2'
  /** 右侧导航文案（如「我的预约」）；传则渲染纯文本链接，自定义用 #nav slot */
  navText?: string
}
</script>

<template>
  <view class="biz-masthead">
    <BizMangaTitle :size="size">
      {{ title }}
    </BizMangaTitle>
    <slot name="nav">
      <text v-if="navText" class="biz-masthead__nav" @tap="$emit('nav')">{{ navText }} ›</text>
    </slot>
  </view>
</template>

<style lang="scss" scoped>
/* 清爽：朴素页面标题 + 右侧纯文本导航链接（去号外编码小字 / 黑签 / 虚线尾规）。 */
.biz-masthead {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  /* 顶部留白：标题与导航栏拉开间距（Kevin 走查：标题的间距） */
  padding: 24rpx var(--c-gap-page) 16rpx;
}
.biz-masthead__nav {
  margin-left: auto;
  align-self: center;
  font-size: var(--c-fs-xs);
  font-weight: 500;
  color: var(--c-ink-2);
}
</style>
