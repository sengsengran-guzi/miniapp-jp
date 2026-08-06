<script setup lang="ts">
/**
 * BizSectionTitle — 区块标题（黑色平行四边形签 + monospace 英文副标 + 「全部 →」）。
 *
 * <pre>&lt;BizSectionTitle title="拼团场次" sub="EVENTS" more @more="goAll" /&gt;</pre>
 *
 * <p>clip-path 平行四边形老基础库降级为矩形，不影响可读性。</p>
 * <p>设计系统：doc/tokens.md / src/style/c-tokens.scss(.c-section-title)</p>
 */
defineOptions({ name: 'BizSectionTitle' })

withDefaults(defineProps<Props>(), { sub: '', accent: 'red', more: false })
defineEmits<{ more: [] }>()
interface Props {
  /** 中文区块名（黑签内） */
  title: string
  /** 英文副标（// XXX） */
  sub?: string
  /** 副标颜色：red(默认) / green / blue / yellow */
  accent?: 'red' | 'green' | 'blue' | 'yellow'
  /** 是否显示右侧「全部 →」 */
  more?: boolean
}
</script>

<template>
  <view class="biz-section-title">
    <text class="biz-section-title__tag">{{ title }}</text>
    <text v-if="more" class="biz-section-title__more" @tap="$emit('more')">全部 ›</text>
  </view>
</template>

<style lang="scss" scoped>
/* 清爽：朴素粗体标题 + 右侧「更多」链接（去黑色平行四边形签 / monospace // 副标）。 */
.biz-section-title {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  padding: 0 var(--c-gap-page) 20rpx;
}
.biz-section-title__tag {
  font-size: var(--c-fs-lg);
  font-weight: 600;
  letter-spacing: -0.4rpx;
  color: var(--c-ink);
}
.biz-section-title__more {
  margin-left: auto;
  font-size: var(--c-fs-xs);
  font-weight: 500;
  color: var(--c-ink-2);
}
</style>
