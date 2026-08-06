<script lang="ts" setup>
/**
 * BizLoginSheet — 按需登录协议同意底部弹层（微信合规整改）。
 *
 * <p>挂在 BizScreen 根容器里（全页通用，零散页改动）；由 {@link useLoginConsent} 单例状态驱动。
 * `useAuth.ensureLoggedIn` 在未登录触发敏感动作时 `await open()` 弹本 sheet：用户**主动勾选**
 * 《用户服务协议》《隐私政策》（默认不勾选）后点「微信登录」才放行登录，否则视为取消。</p>
 *
 * <p>系统 modal 带不了勾选框与可点链接 → 自定义底部 sheet（复用 BizConsentSheet / BizAuthSheet 同款
 * mask + 上滑面板 primitive，纯 view/text + var(--c-*)，组件库无关纪律 CLAUDE.md §7.5）。</p>
 *
 * <p>关联：useLoginConsent.ts / useAuth.ensureLoggedIn / doc/10 §1.E1</p>
 */
import { useLoginConsent } from '@/composables/useLoginConsent'
import { t } from '@/locale/auth.zh-CN'

defineOptions({ name: 'BizLoginSheet' })

const { visible, agreed, toggleAgree, confirm, cancel } = useLoginConsent()

/** 打开协议正文页（pages/agreement/index?type=service|privacy）。 */
function onOpenAgreement(which: 'service' | 'privacy') {
  uni.navigateTo({ url: `/pages/agreement/index?type=${which}` })
}
</script>

<template>
  <view v-if="visible" class="login-mask" @tap="cancel">
    <view class="login-sheet" @tap.stop>
      <view class="login-sheet__head">
        <text class="login-sheet__title">{{ t('auth.sheetTitle') }}</text>
        <text class="login-sheet__close" @tap="cancel">✕</text>
      </view>

      <text class="login-sheet__hint">{{ t('auth.sheetHint') }}</text>

      <!-- 协议勾选（合规：默认不勾选，主动勾选后才能登录） -->
      <view class="login-agree">
        <view class="login-agree__box" :class="{ 'is-on': agreed }" @tap="toggleAgree">
          <text v-if="agreed" class="login-agree__tick">✓</text>
        </view>
        <view class="login-agree__text">
          <text @tap="toggleAgree">{{ t('auth.agreementCheckPrefix') }}</text>
          <text class="link" @tap.stop="onOpenAgreement('service')">{{ t('auth.agreementService') }}</text>
          <text @tap="toggleAgree">{{ t('auth.agreementAnd') }}</text>
          <text class="link" @tap.stop="onOpenAgreement('privacy')">{{ t('auth.agreementPrivacy') }}</text>
        </view>
      </view>

      <button
        class="login-sheet__cta"
        :class="{ 'is-disabled': !agreed }"
        :disabled="!agreed"
        @tap="confirm"
      >
        <text class="login-sheet__cta-icon">💬</text>
        {{ t('auth.sheetCta') }}
      </button>

      <view class="login-sheet__cancel" @tap="cancel">
        {{ t('auth.sheetCancel') }}
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 功能优先清爽（复用 BizConsentSheet 同款底部弹层 primitive）。 */
.login-mask {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: var(--c-mask);
  display: flex;
  align-items: flex-end;
}
.login-sheet {
  width: 100%;
  box-sizing: border-box;
  padding: 28rpx var(--c-gap-page) calc(28rpx + env(safe-area-inset-bottom));
  background: var(--c-surface);
  border-radius: var(--c-radius-card) var(--c-radius-card) 0 0;
  box-shadow: 0 -8rpx 32rpx rgba(33, 29, 23, 0.12);
}
.login-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.login-sheet__title {
  font-size: var(--c-fs-h2);
  font-weight: 700;
  color: var(--c-ink);
}
.login-sheet__close {
  font-size: 40rpx;
  color: var(--c-ink-3);
  padding: 0 8rpx;
}
.login-sheet__hint {
  display: block;
  margin: 12rpx 0 24rpx;
  font-size: var(--c-fs-body);
  color: var(--c-ink-2);
  line-height: 1.6;
}

/* 协议勾选 */
.login-agree {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  padding: 8rpx 0 4rpx;
}
.login-agree__box {
  width: 36rpx;
  height: 36rpx;
  margin-top: 2rpx;
  flex-shrink: 0;
  border: var(--c-bw-3) solid var(--c-line);
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--c-surface);

  &.is-on {
    background: var(--c-red);
    border-color: var(--c-red);
  }
}
.login-agree__tick {
  color: #fff;
  font-size: 26rpx;
  line-height: 1;
}
.login-agree__text {
  flex: 1;
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
  line-height: 1.6;

  .link {
    color: var(--c-blue);
    font-weight: 700;
  }
}

/* 登录按钮 */
.login-sheet__cta {
  margin: 28rpx 0 0;
  width: 100%;
  padding: 22rpx 0;
  font-size: var(--c-fs-lg);
  font-weight: 600;
  color: #fff;
  background: var(--c-green);
  border: none;
  border-radius: var(--c-radius);
  box-shadow: var(--c-shadow-btn);

  &::after {
    border: none;
  }
  &.is-disabled {
    opacity: 0.5;
  }
}
.login-sheet__cta-icon {
  margin-right: 8rpx;
}
.login-sheet__cancel {
  margin: 16rpx 0 4rpx;
  text-align: center;
  font-size: var(--c-fs-sm);
  color: var(--c-ink-3);
  padding: 12rpx 0;
}
</style>
