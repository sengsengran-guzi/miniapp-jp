<script setup lang="ts">
/**
 * MeHeader — 会员中心头部（头像 + 昵称 + 收藏占位，清爽白卡资料头）。GZ-USER-001。
 *
 * <p>两态（AC 1/2）：</p>
 * <ul>
 *   <li>未登录：头像占位 + 「点击登录」 → 点击 emit('login')（外层调 useAuth）</li>
 *   <li>已登录：真实头像（无则占位）+ 昵称（无则「微信用户」）</li>
 * </ul>
 *
 * <p>收藏占位（doc/12 §7 偏差 D4）：数字硬编码 0，UI 保留不可点。等级 / 签到 / 邀请 / 优惠券全删。</p>
 *
 * <p>组件库无关纪律（CLAUDE.md §7.5）：内部仅用 view / text / image 原语 + BizPanel。</p>
 *
 * <p>设计系统：doc/tokens.md / c-tokens.scss。关联文档：doc/10 §4.N1 / doc/11 §2.1 / GZ-USER-001 AC 1/2/4</p>
 */
import { computed } from 'vue'
import { t } from '@/locale/user.zh-CN'

interface Props {
  /** 是否已登录 */
  loggedIn: boolean
  /** 昵称（已登录态；空则回退「微信用户」） */
  nickname?: string | null
  /** 头像 URL（已登录态；空则占位） */
  avatarUrl?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  nickname: '',
  avatarUrl: '',
})

const emit = defineEmits<{ login: [], edit: [] }>()

const displayName = computed(() =>
  props.loggedIn ? (props.nickname || t('user.home.defaultNickname')) : t('user.home.loginPrompt'),
)
const hasAvatar = computed(() => props.loggedIn && !!props.avatarUrl)
const displaySub = computed(() => {
  if (!props.loggedIn) {
    return t('user.home.loginPromptSub')
  }
  // 已登录但还没设头像 → 引导去个人资料用 chooseAvatar + 昵称填写补全（微信已禁用自动获取）
  return hasAvatar.value ? t('user.home.loggedInSub') : t('user.home.completeProfileHint')
})

function onTapHead() {
  if (props.loggedIn) {
    // 已登录 → 进个人资料编辑（USER-002）
    emit('edit')
  }
  else {
    emit('login')
  }
}
</script>

<template>
  <BizPanel class="me-header">
    <view class="me-header__top" @tap="onTapHead">
      <view class="me-header__avatar">
        <image v-if="hasAvatar" class="me-header__avatar-img" :src="avatarUrl!" mode="aspectFill" />
        <text v-else class="me-header__avatar-ph">🐰</text>
      </view>
      <view class="me-header__info">
        <text class="me-header__name">{{ displayName }}</text>
        <text class="me-header__sub">{{ displaySub }}</text>
      </view>
      <text class="me-header__arrow">›</text>
    </view>
  </BizPanel>
</template>

<style lang="scss" scoped>
.me-header {
  overflow: hidden;
  padding: 0;
}
.me-header__top {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 32rpx 28rpx 24rpx;
}
.me-header__avatar {
  flex-shrink: 0;
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  overflow: hidden;
  background: var(--c-bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.me-header__avatar-img {
  width: 100%;
  height: 100%;
}
.me-header__avatar-ph {
  font-size: 64rpx;
  line-height: 1;
}
.me-header__info {
  flex: 1;
  min-width: 0;
}
.me-header__name {
  display: block;
  font-size: var(--c-fs-h2);
  font-weight: 700;
  color: var(--c-ink);
}
.me-header__sub {
  display: block;
  margin-top: 8rpx;
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
}
.me-header__arrow {
  flex-shrink: 0;
  font-size: 48rpx;
  font-weight: 600;
  color: var(--c-ink-3);
}
</style>
