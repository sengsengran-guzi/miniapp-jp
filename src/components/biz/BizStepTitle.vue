<script setup lang="ts">
/**
 * BizStepTitle — 步骤标题（朱红序号 ①②③ + 漫画标题 + 右侧 monospace 备注）。
 * 多步流程的步骤标题（如「选场 / 选商品 / 确认下单」）。
 *
 * <pre>&lt;BizStepTitle n="①" title="挑日子" date="本周可约" /&gt;</pre>
 *
 * <p>设计系统：doc/tokens.md / src/style/c-tokens.scss(.c-step-title)</p>
 */
import { computed } from 'vue'

defineOptions({ name: 'BizStepTitle' })

const props = withDefaults(defineProps<Props>(), { date: '' })
interface Props {
  /** 序号字符（① ② ③ 或 1 2 3，圈号自动转纯数字填进墨色圆点） */
  n: string
  /** 步骤标题 */
  title: string
  /** 右侧备注（如「本周可约」「3 场」） */
  date?: string
}

/** 圈号 ①..⑩ 归一化为纯数字（清爽版步骤号是实心墨点 + 白数字，不用圈号字形）。 */
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩'
const displayN = computed(() => {
  const i = CIRCLED.indexOf(props.n)
  return i >= 0 ? String(i + 1) : props.n
})
</script>

<template>
  <view class="biz-step-title">
    <text class="biz-step-title__n">{{ displayN }}</text>
    <BizMangaTitle size="h2">
      {{ title }}
    </BizMangaTitle>
    <text v-if="date" class="biz-step-title__date">{{ date }}</text>
  </view>
</template>

<style lang="scss" scoped>
.biz-step-title {
  display: flex;
  align-items: center;
  gap: 12rpx;
  /* 顶部留白：与上一区块拉开间距（Kevin 走查：标题和上面的间距） */
  padding: var(--c-gap-card) var(--c-gap-page) 16rpx;
}
/* 清爽：实心墨色圆点 + 白数字（取代红色 ① 圈号大字） */
.biz-step-title__n {
  width: 44rpx;
  height: 44rpx;
  flex-shrink: 0;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--c-ink);
  color: var(--c-on-dark);
  font-size: var(--c-fs-sm);
  font-weight: 700;
  line-height: 1;
}
.biz-step-title__date {
  margin-left: auto;
  font-size: var(--c-fs-xs);
  color: var(--c-ink-3);
}
</style>
