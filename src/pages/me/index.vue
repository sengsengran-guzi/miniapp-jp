<script lang="ts" setup>
/**
 * GZ-JP-001 — 「我的」tab 落地页（会员中心）。
 *
 * <p>脚手架版：头像两态 + 入口格 + 退出登录。订单入口（我的订单 / 待收货角标）由
 * GZ-JP-205 接入真实订单页后加进 gridItems + ROUTE_MAP。</p>
 *
 * <ul>
 *   <li>未登录：头部显「点击登录」→ ensureLoggedIn 弹协议同意 sheet（默认不勾选，微信合规）</li>
 *   <li>已登录：拉 getMe 显示真实头像 + 昵称，点头部进个人资料</li>
 * </ul>
 *
 * <p>关联蓝图：UI:global.theme（方案 A，token 走 var(--c-*)，禁硬编码 hex）</p>
 */
import type { GzUserMeVO } from '@/api/gz-user'
import type { MeGridItem } from '@/components/biz/MeGrid.vue'
import { onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { CART_ROUTE } from '@/api/gz-jp/cart'
import { getMe } from '@/api/gz-user'
import { useAuth } from '@/hooks/useAuth'
import { t } from '@/locale/user.zh-CN'

defineOptions({
  name: 'GzJpMe',
})

definePage({
  style: {
    navigationBarTitleText: '我的',
  },
})

// 懒登录：「我的」tab 可进，未登录显「点击登录」头部；点需登录的入口时才 ensureLoggedIn。
const { isLoggedIn, ensureLoggedIn, logout } = useAuth()

const me = ref<GzUserMeVO | null>(null)
const loggedIn = ref(false)

const nickname = computed(() => me.value?.nickname ?? '')
const avatarUrl = computed(() => me.value?.avatarUrl ?? '')

/**
 * 会员中心入口格。
 * GZ-JP-205 落订单页后在此加 { key: 'orders', icon: '🧾', label: t('user.home.entryOrders') }
 * 并在 ROUTE_MAP 补 orders 路由。
 */
const gridItems = computed<MeGridItem[]>(() => [
  // 购物车（GZ-JP-203）：商品详情底部那个入口只在看商品时才有，这里是「随时能回去」的常驻入口
  { key: 'cart', icon: '🛒', label: t('user.home.entryCart'), type: 'nav' },
  { key: 'about', icon: 'ℹ️', label: t('user.home.entryAbout'), type: 'nav' },
])

/** 入口格跳转目标（真实路由，无占位）。 */
const ROUTE_MAP: Record<string, string> = {
  cart: CART_ROUTE,
  about: '/pages/me/about',
}

/**
 * 需登录才能进的入口 key（其余直接跳）。
 * 购物车是用户私有数据（后端四个端点都需登录）→ 游客点这里先弹协议同意 sheet 走微信登录。
 */
const LOGIN_REQUIRED_KEYS = new Set<string>(['cart'])

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
    console.warn('[jp-me] loadMe failed', e)
  }
}

/** 头部「点击登录」→ ensureLoggedIn 弹协议同意 sheet（微信合规：主动勾选协议后才登录）。 */
async function onLogin() {
  if (await ensureLoggedIn()) {
    await loadMe()
  }
}

/** 退出登录：二次确认 → 清登录态 + 「已同意」态 → 回游客态（再登录会重弹协议 sheet）。 */
function onLogout() {
  uni.showModal({
    title: t('user.home.logoutTitle'),
    content: t('user.home.logoutContent'),
    confirmText: t('user.home.logoutConfirm'),
    cancelText: t('user.home.logoutCancel'),
    success: async (res) => {
      if (!res.confirm) {
        return
      }
      await logout()
      await loadMe()
      uni.showToast({ title: t('user.home.logoutDone'), icon: 'none' })
    },
  })
}

/** 已登录态点击头部 → 进个人资料编辑。 */
function onEditProfile() {
  uni.navigateTo({ url: '/pages/me/profile' })
}

async function onGridTap(item: MeGridItem) {
  const url = ROUTE_MAP[item.key]
  if (!url) {
    return
  }
  if (LOGIN_REQUIRED_KEYS.has(item.key) && !(await ensureLoggedIn())) {
    return
  }
  uni.navigateTo({ url })
}

onShow(() => {
  void loadMe()
})
</script>

<template>
  <BizScreen class="jp-screen">
    <!-- 头部：头像 + 昵称（两态） -->
    <view class="block">
      <MeHeader
        :logged-in="loggedIn"
        :nickname="nickname"
        :avatar-url="avatarUrl"
        @login="onLogin"
        @edit="onEditProfile"
      />
    </view>

    <!-- 功能区（BizSectionTitle 自带横向 padding，不套 .block） -->
    <view class="section-title-wrap">
      <BizSectionTitle :title="t('user.home.sectionTitle')" />
    </view>
    <view class="block--tail block">
      <MeGrid :items="gridItems" @tap="onGridTap" />
    </view>

    <!-- 退出登录（仅已登录态显示） -->
    <view v-if="loggedIn" class="logout-wrap">
      <view class="logout-btn" @tap="onLogout">
        {{ t('user.home.logoutBtn') }}
      </view>
    </view>
  </BizScreen>
</template>

<style lang="scss" scoped>
.block {
  padding: 0 var(--c-gap-page) 0;
}
/* 卡片底不单独留白，区块间距统一由下一个 section-title-wrap 的 padding-top 提供（节奏一致） */
.block--tail {
  padding-bottom: 0;
}
/* 区块间距：每个区块标题上方统一留白 */
.section-title-wrap {
  padding-top: 32rpx;
}
/* 标题与其卡片的小间距（压掉 BizSectionTitle 自带 20rpx，仅本页） */
.section-title-wrap :deep(.biz-section-title) {
  padding-bottom: 12rpx;
}
.logout-wrap {
  padding: 48rpx var(--c-gap-page) 32rpx;
}
.logout-btn {
  width: 100%;
  box-sizing: border-box;
  padding: 22rpx 0;
  text-align: center;
  font-size: var(--c-fs-body);
  color: var(--c-ink-2);
  background: var(--c-surface);
  border-radius: var(--c-radius);
  box-shadow: var(--c-shadow-sm);

  &:active {
    opacity: 0.7;
  }
}
</style>
