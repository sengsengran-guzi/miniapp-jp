<script lang="ts" setup>
/**
 * 微信登录页（整页版，兜底路径）。
 *
 * <p>本项目主登录入口是 <b>按需登录</b>：未登录用户可正常浏览，触发敏感动作时由
 * {@link useAuth.ensureLoggedIn} 弹 BizLoginSheet 协议同意 sheet（挂在 BizScreen 根容器）。
 * 本整页保留为兜底（外部链接 / 历史跳转落到此页时仍能登录），不做主入口、tabbar 不占位。</p>
 *
 * <p>微信合规：协议勾选默认不勾选，用户主动勾选后才能发起登录（不得默认强制同意）。</p>
 */
import { onLoad } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { useAuth } from '@/hooks/useAuth'
import { t } from '@/locale/auth.zh-CN'

defineOptions({
  name: 'GzJpLogin',
})

definePage({
  style: {
    navigationBarTitleText: '登录',
  },
})

const { loginWithWechat, isLoggedIn } = useAuth()
const loading = ref(false)
// 协议同意态：微信合规要求默认不勾选，用户主动勾选后才能登录（不得默认强制同意）
const agreed = ref(false)

/** 落地页 = 首页 tab。 */
const HOME_TAB = '/pages/index/index'

function toggleAgree() {
  agreed.value = !agreed.value
}

// 打开协议正文页（pages/agreement/index?type=service|privacy）
function onOpenAgreement(which: 'service' | 'privacy') {
  uni.navigateTo({ url: `/pages/agreement/index?type=${which}` })
}

function backToHome() {
  uni.switchTab({
    url: HOME_TAB,
    // switchTab 失败时 fallback reLaunch
    fail: () => {
      uni.reLaunch({ url: HOME_TAB })
    },
  })
}

// 已登录用户重进登录页 → 直接回首页 tab
onLoad(() => {
  if (isLoggedIn()) {
    backToHome()
  }
})

async function onWechatLogin() {
  if (loading.value) {
    return
  }
  // 微信合规：未主动勾选同意协议前不得发起登录（采集 openid 等）
  if (!agreed.value) {
    uni.showToast({ title: t('auth.toastAgreeFirst'), icon: 'none' })
    return
  }
  loading.value = true
  try {
    await loginWithWechat()
    setTimeout(backToHome, 600)
  }
  catch {
    // 错误 toast 已在 useAuth 内显示
  }
  finally {
    loading.value = false
  }
}

function onBrowseOnly() {
  uni.showToast({ title: t('auth.toastDeclined'), icon: 'none' })
  setTimeout(backToHome, 600)
}
</script>

<template>
  <BizScreen>
    <view class="login">
      <!-- 品牌卡 -->
      <BizPanel>
        <!-- 卡内布局放内层真实节点：virtualHost 丢 host 外部 class -->
        <view class="brand">
          <view class="brand__body">
            <text class="brand__emoji">🧧</text>
            <view class="brand__title">
              <BizMangaTitle size="display">
                {{ t('auth.title') }}
              </BizMangaTitle>
            </view>
            <text class="brand__sub-text">{{ t('auth.subtitle') }}</text>
          </view>
        </view>
      </BizPanel>

      <!-- 登录动作 -->
      <view class="actions">
        <BizButton
          type="green"
          size="lg"
          block
          :disabled="loading"
          @click="onWechatLogin"
        >
          {{ loading ? '登录中…' : t('auth.btnWechatLogin') }}
        </BizButton>
        <view class="browse-only" @tap="onBrowseOnly">
          {{ t('auth.btnBrowseOnly') }}
        </view>
      </view>

      <!-- 协议勾选（微信合规：默认不勾选，主动勾选后才能登录） -->
      <view class="agreement">
        <view class="agreement__box" :class="{ 'is-on': agreed }" @tap="toggleAgree">
          <text v-if="agreed" class="agreement__tick">✓</text>
        </view>
        <view class="agreement__text">
          <text @tap="toggleAgree">{{ t('auth.agreementCheckPrefix') }}</text>
          <text class="link" @tap.stop="onOpenAgreement('service')">{{ t('auth.agreementService') }}</text>
          <text @tap="toggleAgree">{{ t('auth.agreementAnd') }}</text>
          <text class="link" @tap.stop="onOpenAgreement('privacy')">{{ t('auth.agreementPrivacy') }}</text>
        </view>
      </view>
    </view>
  </BizScreen>
</template>

<style lang="scss" scoped>
/* 视觉基调方案 A（token 真源 c-tokens.scss，禁硬编码 hex）。 */
.login {
  min-height: 100vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 96rpx var(--c-gap-page) 48rpx;
}

/* 品牌卡 */
.brand {
  width: 100%;
  overflow: hidden;
  padding: 48rpx 40rpx 40rpx;
}
.brand__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
}
.brand__emoji {
  font-size: 96rpx;
  line-height: 1;
}
.brand__title {
  text-align: center;
}
.brand__sub-text {
  font-size: var(--c-fs-sm);
  color: var(--c-ink-2);
  text-align: center;
}

/* 登录动作 */
.actions {
  width: 100%;
  margin-top: 64rpx;
}
.browse-only {
  margin-top: 24rpx;
  text-align: center;
  font-size: var(--c-fs-sm);
  color: var(--c-ink-3);
  padding: 12rpx 0;
}

/* 协议勾选 */
.agreement {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  margin-top: 40rpx;
}
.agreement__box {
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
.agreement__tick {
  color: var(--c-on-dark);
  font-size: 26rpx;
  line-height: 1;
}
.agreement__text {
  flex: 1;
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
  line-height: 1.6;

  .link {
    color: var(--c-blue);
    font-weight: 700;
  }
}
</style>
