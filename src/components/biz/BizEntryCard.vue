<script setup lang="ts">
/**
 * BizEntryCard — 单行快捷入口卡（图标 + 标题 + 副标 + 角标 + 右箭头）。
 *
 * <pre>&lt;BizEntryCard icon="🧾" title="我的订单" sub="查看拼团进度" badge="3" @tap="go" /&gt;</pre>
 *
 * <p>与 MeGrid（「我的」页多格宫格）互补：宫格用于并列的次级入口，本组件用于单条主推入口
 * （首页「我的订单」）。GZ-JP-205 落订单页后可直接复用。</p>
 *
 * <p>角标传空串即隐藏 —— 数字格式化（0 隐藏 / >99 收敛成 99+）在
 * pages/index/index.logic.ts 的 formatBadgeCount()，组件不做数字判断，只认字符串。</p>
 *
 * <p>组件库无关纪律（CLAUDE.md §7.5）：仅用 view / text 原语 + BizPanel + var(--c-*) token。</p>
 */
defineOptions({ name: 'BizEntryCard' })

withDefaults(defineProps<Props>(), { icon: '', sub: '', badge: '' })
defineEmits<{ tap: [] }>()

interface Props {
  /** 左侧图标（过渡期 emoji 占位；素材到位后换矢量） */
  icon?: string
  /** 主标题 */
  title: string
  /** 副标（可空） */
  sub?: string
  /** 角标文案（空串则不渲染；数字格式化由调用方完成） */
  badge?: string
}
</script>

<template>
  <view class="jp-entry-card" @tap="$emit('tap')">
    <BizPanel>
      <view class="jp-entry-card__inner">
        <text v-if="icon" class="jp-entry-card__icon">{{ icon }}</text>
        <view class="jp-entry-card__texts">
          <text class="jp-entry-card__title">{{ title }}</text>
          <text v-if="sub" class="jp-entry-card__sub">{{ sub }}</text>
        </view>
        <text v-if="badge" class="jp-entry-card__badge">{{ badge }}</text>
        <text class="jp-entry-card__arrow">›</text>
      </view>
    </BizPanel>
  </view>
</template>

<style lang="scss" scoped>
.jp-entry-card {
  &:active {
    opacity: 0.75;
  }
}
.jp-entry-card__inner {
  display: flex;
  align-items: center;
  gap: var(--c-gap);
  padding: var(--c-gap-card);
}
.jp-entry-card__icon {
  flex-shrink: 0;
  font-size: 44rpx;
  line-height: 1;
}
.jp-entry-card__texts {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.jp-entry-card__title {
  font-size: var(--c-fs-body);
  font-weight: 600;
  color: var(--c-ink);
}
.jp-entry-card__sub {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
}
.jp-entry-card__badge {
  flex-shrink: 0;
  min-width: 36rpx;
  padding: 2rpx 12rpx;
  text-align: center;
  font-size: var(--c-fs-2xs);
  font-weight: 700;
  line-height: 1.6;
  color: var(--c-on-dark);
  background: var(--c-danger);
  border-radius: var(--c-radius-pill);
}
.jp-entry-card__arrow {
  flex-shrink: 0;
  font-size: var(--c-fs-h2);
  line-height: 1;
  color: var(--c-ink-3);
}
</style>
