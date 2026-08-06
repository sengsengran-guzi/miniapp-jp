<script setup lang="ts">
/**
 * BizState — 统一占位态（loading / empty / error）：居中 + 弱墨主文案 + 可选副文 + 可选 CTA。
 *
 * <p>收口各列表 / 详情页各写一份的 .state / .empty 占位骨架（此前 padding 56~120rpx、灰度
 * --c-ink-2 vs --c-ink-3、emoji 透明度全漂移）。文案 / locale 由调用方传入，组件不绑死业务文案。</p>
 *
 * <pre>
 * &lt;BizState variant="loading" :text="t('...')" /&gt;
 * &lt;BizState variant="empty" emoji="📭" text="还没有记录" sub="去逛逛吧" /&gt;
 * &lt;BizState variant="error" text="加载失败" cta-text="重试" @cta="reload" /&gt;
 * </pre>
 */
defineOptions({ name: 'BizState' })

withDefaults(defineProps<Props>(), { variant: 'loading', emoji: '', sub: '', ctaText: '' })
defineEmits<{ cta: [] }>()
interface Props {
  /** 态：loading(默认) / empty / error */
  variant?: 'loading' | 'empty' | 'error'
  /** 主文案 */
  text: string
  /** 副文案（可选） */
  sub?: string
  /** 占位 emoji（empty 态用，过渡期占位；上线替矢量素材） */
  emoji?: string
  /** CTA 文案（传则渲染按钮：error 重试 / empty 去逛逛等） */
  ctaText?: string
}
</script>

<template>
  <view class="biz-state">
    <text v-if="emoji" class="biz-state__emoji">{{ emoji }}</text>
    <text class="biz-state__text" :class="{ 'is-error': variant === 'error' }">{{ text }}</text>
    <text v-if="sub" class="biz-state__sub">{{ sub }}</text>
    <view v-if="ctaText" class="biz-state__cta" @tap="$emit('cta')">
      <text class="biz-state__cta-txt">{{ ctaText }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.biz-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  padding: 96rpx var(--c-gap-page);
}
.biz-state__emoji {
  font-size: 80rpx;
  line-height: 1;
  opacity: 0.5;
}
.biz-state__text {
  font-size: var(--c-fs-body);
  font-weight: 700;
  color: var(--c-ink-2);
  text-align: center;

  &.is-error {
    color: var(--c-danger);
  }
}
.biz-state__sub {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-3);
  text-align: center;
}
.biz-state__cta {
  margin-top: 12rpx;
  padding: 14rpx 40rpx;
  background: transparent;
  border: var(--c-bw-3) solid var(--c-line);
  border-radius: var(--c-radius);
}
.biz-state__cta-txt {
  font-size: var(--c-fs-body);
  font-weight: 600;
  color: var(--c-ink);
}
</style>
