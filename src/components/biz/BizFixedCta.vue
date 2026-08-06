<script setup lang="ts">
/**
 * BizFixedCta — 详情页底部 fixed CTA 业务壳（GZ-ADMIN-005 AC 5）。
 *
 * <p>用法范例（未来 booking-select / news-detail / order-detail 等详情页）：</p>
 * <pre>
 * &lt;BizFixedCta
 *   :primary-text="`确认预约（¥${price}）`"
 *   :primary-disabled="!canSubmit"
 *   @primary="onSubmit"
 *   secondary-text="加入购物车"
 *   @secondary="onAddCart"
 * /&gt;
 * </pre>
 *
 * <p>设计纪律（tokens.md §6/§7 + 任务卡强约束 #3）：</p>
 * <ul>
 *   <li>底部 fixed 条高约 100rpx，与 tab 栏 mutually exclusive — 详情页 page config
 *       `tabBar: false` 隐藏 tab；本组件在 fixed 条内</li>
 *   <li>客服浮层 (BizCustomerServiceFab) 离底 132rpx → 与 fixed CTA 条 100rpx + 间距 32rpx 错开</li>
 *   <li>主 CTA 用 C 系统朱红 var(--c-red)；价格高亮同 var(--c-red)（c-tokens.scss 单一真源）</li>
 *   <li>支持单 CTA 模式（不传 secondaryText）+ 双 CTA 模式（主次按 1:2 比例）</li>
 * </ul>
 *
 * <p>组件库无关纪律（CLAUDE.md §7.5）：内部仅用 view / text 原语，无 wd-* 依赖。</p>
 *
 * <p>关联文档：tokens.md §6 .fixed-cta-bar / §7 详情页不显示 tab / GZ-ADMIN-005 AC 5</p>
 */

interface Props {
  /** 主 CTA 文字（必传） */
  primaryText: string
  /** 主 CTA 是否禁用 */
  primaryDisabled?: boolean
  /** 次 CTA 文字（不传则单 CTA 模式 — 主 CTA 占满宽度） */
  secondaryText?: string
  /** 次 CTA 是否禁用 */
  secondaryDisabled?: boolean
  /** 左侧补充信息（如「¥199 起」），可选 */
  hint?: string
  /**
   * 本页是否为 tabbar 页（首页 / 我的）。tabbar 页 webview 底下已是原生 tab 栏，
   * home-indicator 安全区由 tab 栏兜底，CTA 条不再额外加 safe-area，否则与 tab 栏间留大空隙。
   * 详情页（无 tab 栏）保持默认 false → 加 safe-area。
   */
  tabbarBelow?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  primaryDisabled: false,
  secondaryDisabled: false,
  tabbarBelow: false,
})

const emit = defineEmits<{
  primary: []
  secondary: []
}>()

function onPrimaryTap() {
  if (props.primaryDisabled)
    return
  emit('primary')
}

function onSecondaryTap() {
  if (props.secondaryDisabled)
    return
  emit('secondary')
}
</script>

<template>
  <view class="biz-fixed-cta" :class="{ 'is-tabbar-below': tabbarBelow }">
    <!-- 左侧补充信息（如价格 / 数量） -->
    <view v-if="hint" class="biz-fixed-cta__hint">
      {{ hint }}
    </view>

    <!-- 次 CTA（可选） -->
    <view
      v-if="secondaryText"
      class="biz-fixed-cta__btn biz-fixed-cta__btn--secondary"
      :class="{ 'is-disabled': secondaryDisabled }"
      @tap="onSecondaryTap"
    >
      {{ secondaryText }}
    </view>

    <!-- 主 CTA -->
    <view
      class="biz-fixed-cta__btn biz-fixed-cta__btn--primary"
      :class="{ 'is-disabled': primaryDisabled, 'is-full': !secondaryText }"
      @tap="onPrimaryTap"
    >
      {{ primaryText }}
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 清爽：半透白 + 毛玻璃 + 发丝顶边；主 CTA 圆角红光，次按钮描边幽灵态。 */
.biz-fixed-cta {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 20rpx var(--c-gap-page);
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));

  /* tabbar 页：原生 tab 栏在 webview 之下已兜底安全区，CTA 条不再加 safe-area */
  &.is-tabbar-below {
    padding-bottom: 20rpx;
  }
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: saturate(180%) blur(16px);
  border-top: var(--c-bw-3) solid var(--c-line);
  display: flex;
  align-items: center;
  gap: 20rpx;
  z-index: 100;
}

.biz-fixed-cta__hint {
  /* 价格红 */
  color: var(--c-red);
  font-size: var(--c-fs-lg);
  font-weight: 700;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.biz-fixed-cta__btn {
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--c-fs-body);
  font-weight: 600;
  letter-spacing: 0.5rpx;
  border-radius: var(--c-radius);
  flex: 1;
  transition:
    transform 0.12s ease,
    opacity 0.12s ease;

  &:active:not(.is-disabled) {
    transform: translateY(1rpx);
    opacity: 0.92;
  }

  &.is-disabled {
    background: #d9d4cb;
    color: var(--c-on-dark);
    box-shadow: none;
  }
}

.biz-fixed-cta__btn--primary {
  background: var(--c-red);
  color: var(--c-on-dark);
  box-shadow: var(--c-shadow-btn);
  flex: 2;

  &.is-full {
    flex: 1;
  }

  &.is-disabled {
    box-shadow: none;
  }
}

.biz-fixed-cta__btn--secondary {
  /* 描边幽灵态次按钮 */
  background: transparent;
  color: var(--c-ink);
  border: var(--c-bw-3) solid var(--c-line);
  flex: 1;
}
</style>
