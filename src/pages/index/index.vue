<script lang="ts" setup>
/**
 * GZ-JP-001 — 首页（tabbar 第 1 格，启动落地页）。
 *
 * <p>本卡是工程脚手架：只落「可达 + 登录态 + 占位」三件事，页面骨架与真实内容由
 * GZ-JP-201 按 UI:mp.home 实装（轮播 banner → 进行中的场 → 我的订单快捷入口）。</p>
 *
 * <ul>
 *   <li>懒登录：未登录可正常浏览；点「微信登录」走 useAuth.ensureLoggedIn → BizLoginSheet
 *       协议同意 sheet（默认不勾选，微信合规）</li>
 *   <li>已登录：拉 getMe 显示昵称，点进个人资料</li>
 * </ul>
 *
 * <p>关联蓝图：UI:mp.home / UI:global.theme（方案 A，token 走 var(--c-*)，禁硬编码 hex）</p>
 */
import type { GzUserMeVO } from '@/api/gz-user'
import { onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { getMe } from '@/api/gz-user'
import { useAuth } from '@/hooks/useAuth'
import { t } from '@/locale/home.zh-CN'

defineOptions({ name: 'GzJpHome' })

definePage({
  type: 'home',
  style: {
    navigationBarTitleText: '谷子宇宙拼团',
  },
})

const { isLoggedIn, ensureLoggedIn } = useAuth()

const me = ref<GzUserMeVO | null>(null)
const loggedIn = ref(false)

const greeting = computed(() =>
  loggedIn.value
    ? `${t('home.welcomePrefix')}${me.value?.nickname || ''}`
    : t('home.welcomeGuest'),
)

async function loadMe() {
  if (!isLoggedIn()) {
    loggedIn.value = false
    me.value = null
    return
  }
  loggedIn.value = true
  try {
    me.value = await getMe()
  }
  catch (e) {
    // 拉资料失败不影响首页浏览（游客态渲染），仅记录
    console.warn('[jp-home] loadMe failed', e)
  }
}

/** 未登录 → 弹协议同意 sheet 后微信登录；已登录 → 进个人资料。 */
async function onPrimaryTap() {
  if (loggedIn.value) {
    uni.navigateTo({ url: '/pages/me/profile' })
    return
  }
  if (await ensureLoggedIn()) {
    await loadMe()
  }
}

onShow(() => {
  void loadMe()
})
</script>

<template>
  <BizScreen>
    <BizMasthead :title="t('home.pageTitle')" />

    <view class="block">
      <BizPanel>
        <view class="jp-hero">
          <text class="jp-hero__greet">{{ greeting }}</text>
          <view class="jp-hero__cta" @tap="onPrimaryTap">
            <text class="jp-hero__cta-txt">
              {{ loggedIn ? t('home.profileCta') : t('home.loginCta') }}
            </text>
          </view>
        </view>
      </BizPanel>
    </view>

    <view class="section-title-wrap">
      <BizSectionTitle :title="t('home.eventSectionTitle')" />
    </view>
    <view class="block">
      <BizPanel>
        <BizState
          variant="empty"
          emoji="🧧"
          :text="t('home.eventEmpty')"
          :sub="t('home.eventEmptySub')"
        />
      </BizPanel>
    </view>
  </BizScreen>
</template>

<style lang="scss" scoped>
.block {
  padding: 0 var(--c-gap-page);
}
.section-title-wrap {
  padding-top: 32rpx;
}
.jp-hero {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 32rpx 28rpx;
}
.jp-hero__greet {
  flex: 1;
  min-width: 0;
  font-size: var(--c-fs-body);
  color: var(--c-ink-2);
}
.jp-hero__cta {
  flex-shrink: 0;
  padding: 14rpx 28rpx;
  border-radius: var(--c-radius-pill);
  /* --c-red 是品牌主色令牌（值为清新绿 #33b36b，令牌名沿用历史，见 c-tokens.scss） */
  background: var(--c-red);
  box-shadow: var(--c-shadow-btn);

  &:active {
    opacity: 0.8;
  }
}
.jp-hero__cta-txt {
  font-size: var(--c-fs-sm);
  font-weight: 600;
  color: #fff;
}
</style>
