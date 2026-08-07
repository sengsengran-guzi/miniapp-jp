<script lang="ts" setup>
/**
 * 个人资料编辑（会员中心头部 → 「个人资料」进入）。
 *
 * <p>表单：头像（AvatarUpload chooseAvatar → 对象存储）/ 昵称（type=nickname）/ 性别 / 手机号（getPhoneNumber）。</p>
 * <ul>
 *   <li>保存调 PUT /app/gz/user/profile（昵称 / avatarImageId / 性别 一并提交）</li>
 *   <li>头像走微信「头像填写能力」chooseAvatar，昵称走「昵称填写能力」type=nickname
 *       （微信 2022 已废弃 getUserProfile，禁用一键授权；ADR-0009）</li>
 *   <li>头像真源 = avatar_image_id（chooseAvatar → 上传拿 fileId 落库，不存裸 url）；持久化后回显</li>
 *   <li>手机号 &lt;button open-type="getPhoneNumber"&gt; → 回调 code，后端 getuserphonenumber 换明文
 *       （真机原生能力，模拟器拿不到真 code）</li>
 *   <li>保存成功 → 后端写 gz_user_audit_log；前端同步 user store；toast 后返回</li>
 * </ul>
 */
import type { GzUserMeVO } from '@/api/gz-user'
import { onLoad } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { bindMobile, getMe, updateProfile } from '@/api/gz-user'
import { t } from '@/locale/user.zh-CN'
import { useUserStore } from '@/store'
import { toastError, toastInfo, toastSuccess } from '@/utils/toast'

defineOptions({ name: 'GzMeProfile' })

definePage({
  style: {
    navigationBarTitleText: '个人资料',
  },
})

const userStore = useUserStore()

/* ---------- form state ---------- */
const nickname = ref('')
/** 头像预览 url（展示用）；落库以 avatarImageId 为真源（ADR-0009） */
const avatarUrl = ref('')
/** 头像文件 id（avatar_image_id 真源；本次会话新选头像才有值，未改则 undefined 不提交） */
const avatarImageId = ref<number | undefined>(undefined)
const gender = ref<number>(0)
const mobile = ref<string>('')

const loading = ref(false)
const saving = ref(false)
const mobileBinding = ref(false)

/* 性别选项（index → value） */
const GENDER_OPTIONS = computed(() => [
  { value: 0, label: t('user.profile.genderUnknown') },
  { value: 1, label: t('user.profile.genderMale') },
  { value: 2, label: t('user.profile.genderFemale') },
])

const genderLabel = computed(() =>
  GENDER_OPTIONS.value.find(o => o.value === gender.value)?.label ?? t('user.profile.genderUnknown'),
)

const hasMobile = computed(() => !!(mobile.value && mobile.value.length === 11))
const mobileMasked = computed(() => {
  if (!hasMobile.value) {
    return ''
  }
  return `${mobile.value.slice(0, 3)}****${mobile.value.slice(7)}`
})

const ctaText = computed(() => (saving.value ? t('user.profile.ctaSaving') : t('user.profile.ctaSave')))
const ctaDisabled = computed(() => saving.value || loading.value)

/* ---------- load ---------- */
function applyMe(me: GzUserMeVO) {
  nickname.value = me.nickname || ''
  avatarUrl.value = me.avatarUrl || ''
  // 回显不重置 avatarImageId 为已有值：保存时仅当本次新选了头像（avatarImageId 有值）才提交，
  // 避免把回显态当成「未改」误传 / 漏传（USER-006 持久化回显，不重复弹采集）。
  gender.value = me.gender ?? 0
  mobile.value = me.mobile || ''
}

async function loadMe() {
  loading.value = true
  try {
    const me = await getMe()
    applyMe(me)
  }
  catch (e) {
    console.warn('[me-profile] loadMe failed', e)
  }
  finally {
    loading.value = false
  }
}

/* ---------- 昵称输入（微信「昵称填写」能力 type=nickname；@blur / @change 回填） ---------- */
function onNicknameInput(e: any) {
  const v = e?.detail?.value
  if (typeof v === 'string') {
    nickname.value = v
  }
}

/* ---------- 头像上传回调（AvatarUpload emit，USER-006：fileId 落库 + url 预览） ---------- */
function onAvatarChange(payload: { fileId: number, url: string }) {
  avatarImageId.value = payload.fileId
  avatarUrl.value = payload.url
}

/* ---------- 性别选择 ---------- */
function onGenderChange(e: { detail: { value: number } }) {
  const idx = Number(e.detail.value)
  gender.value = GENDER_OPTIONS.value[idx]?.value ?? 0
}

/* ---------- 手机号编辑（AC 3，复用 bindMobile） ---------- */
async function onGetPhoneNumber(e: any) {
  const detail = e?.detail || {}
  let code: string | undefined = detail.code
  // 拿不到 code 时用占位 code 兜底（开发者工具常拿不到可换号的真 code）：① wxMOCK 全 mock；② 本地 dev。
  // 后端 dev mock-phone-fallback 开时忽略 code 返默认测试号；staging/prod 走真换号。
  if (!code && ((import.meta.env.VITE_WX_APPID || '').startsWith('wxMOCK') || import.meta.env.DEV)) {
    code = 'mock-phone-code'
  }
  if (!code) {
    // 用户拒授权 / 未拿到 code（含 session 过期场景，R1）
    toastInfo(t('user.profile.mobileBindFailed'))
    return
  }
  mobileBinding.value = true
  try {
    await bindMobile(code)
    // 明文手机号由后端换取，前端不接触 → 回拉 me 同步真实 mobile（顺带刷 store）
    await refreshStoreFromMe()
    toastSuccess(t('user.profile.saveSuccess'))
  }
  catch (err) {
    console.warn('[me-profile] bindMobile failed', err)
    // http.ts 已全局 toast；session 过期会触发 401 → 自动跳登录（R1 由 http 拦截器兜底）
    toastError(t('user.profile.mobileBindFailed'))
  }
  finally {
    mobileBinding.value = false
  }
}

/* ---------- 保存（AC 1/4） ---------- */
function validate(): boolean {
  if (!nickname.value || !nickname.value.trim()) {
    toastError(t('user.profile.nicknameRequired'))
    return false
  }
  if (nickname.value.length > 32) {
    toastError(t('user.profile.nicknameTooLong'))
    return false
  }
  return true
}

async function refreshStoreFromMe() {
  try {
    const me = await getMe()
    applyMe(me)
    userStore.setUserInfo({
      ...userStore.userInfo,
      nickname: me.nickname || userStore.userInfo.nickname,
      avatar: me.avatarUrl || userStore.userInfo.avatar,
    })
  }
  catch (e) {
    console.warn('[me-profile] refresh store failed', e)
  }
}

async function onSave() {
  if (ctaDisabled.value || !validate()) {
    return
  }
  saving.value = true
  try {
    const updated = await updateProfile({
      nickname: nickname.value.trim(),
      // USER-006：头像落库走 avatarImageId（真源）；仅本次新选了头像才提交，未改不传
      avatarImageId: avatarImageId.value,
      gender: gender.value,
    })
    // 同步 pinia user store（AC 4）；头像用后端回显的签名 URL（按 avatar_image_id 重生成）
    userStore.setUserInfo({
      ...userStore.userInfo,
      nickname: updated.nickname || userStore.userInfo.nickname,
      avatar: updated.avatarUrl || userStore.userInfo.avatar,
    })
    toastSuccess(t('user.profile.saveSuccess'))
    setTimeout(() => uni.navigateBack(), 800)
  }
  catch (e) {
    console.warn('[me-profile] save failed', e)
    // http.ts 已全局 toast
  }
  finally {
    saving.value = false
  }
}

onLoad(() => {
  void loadMe()
})
</script>

<template>
  <BizScreen class="jp-screen">
    <!-- 卡内布局统一放 .row 真实子节点（virtualHost 会丢 BizPanel host 上的外部 flex/padding，
         否则 label 与值竖向堆叠、无内边距 —— Kevin 走查）。label 左、值/控件右，整列对齐。 -->
    <!-- 头像 -->
    <view class="block">
      <BizPanel>
        <view class="row">
          <text class="row__label">{{ t('user.profile.avatarLabel') }}</text>
          <view class="row__avatar">
            <AvatarUpload v-model="avatarUrl" @change="onAvatarChange" />
          </view>
        </view>
      </BizPanel>
    </view>

    <!-- 昵称（微信「昵称填写」能力：type=nickname 唤起微信昵称建议） -->
    <view class="block">
      <BizPanel>
        <view class="row">
          <text class="row__label">{{ t('user.profile.nicknameLabel') }}</text>
          <input
            v-model="nickname"
            type="nickname"
            class="row__input"
            :placeholder="t('user.profile.nicknamePlaceholder')"
            :maxlength="32"
            @blur="onNicknameInput"
            @change="onNicknameInput"
          >
        </view>
      </BizPanel>
    </view>

    <!-- 性别 -->
    <view class="block">
      <BizPanel>
        <view class="row">
          <text class="row__label">{{ t('user.profile.genderLabel') }}</text>
          <picker
            class="row__control"
            mode="selector"
            :range="GENDER_OPTIONS"
            range-key="label"
            @change="onGenderChange"
          >
            <view class="row__picker">
              <text class="row__picker-text">{{ genderLabel }}</text>
              <text class="row__arrow">›</text>
            </view>
          </picker>
        </view>
      </BizPanel>
    </view>

    <!-- 手机号 -->
    <view class="block">
      <BizPanel>
        <view class="row">
          <text class="row__label">{{ t('user.profile.mobileLabel') }}</text>
          <view class="row-mobile">
            <text v-if="hasMobile" class="row-mobile__num c-num">{{ mobileMasked }}</text>
            <text v-else class="row-mobile__none">{{ t('user.profile.mobileUnbound') }}</text>
            <button
              class="row-mobile__btn"
              :class="{ 'is-disabled': mobileBinding }"
              open-type="getPhoneNumber"
              :disabled="mobileBinding"
              @getphonenumber="onGetPhoneNumber"
            >
              {{ mobileBinding ? t('user.profile.mobileBinding') : (hasMobile ? t('user.profile.mobileEditCta') : t('user.profile.mobileBindCta')) }}
            </button>
          </view>
        </view>
      </BizPanel>
    </view>

    <!-- 底部占位 + 保存 -->
    <view style="height: 160rpx" />
    <BizFixedCta
      :primary-text="ctaText"
      :primary-disabled="ctaDisabled"
      @primary="onSave"
    />
  </BizScreen>
</template>

<style lang="scss" scoped>
.block {
  /* 卡片之间间距收小（Kevin 走查：卡片之间的间距变小） */
  padding: 14rpx var(--c-gap-page) 0;
}

/* 行卡内容（真实子节点，承载 flex + 内边距）：label 左，值/控件右，整列垂直居中对齐 */
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  min-height: 96rpx;
  padding: 20rpx 28rpx;
}
.row__label {
  flex-shrink: 0;
  font-size: var(--c-fs-body);
  font-weight: 600;
  color: var(--c-ink);
}
.row__input {
  flex: 1;
  text-align: right;
  font-size: var(--c-fs-body);
  color: var(--c-ink);
}
/* 头像 / picker 控件靠右对齐 */
.row__avatar,
.row__control {
  display: flex;
  align-items: center;
}
.row__picker {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.row__picker-text {
  font-size: var(--c-fs-body);
  color: var(--c-ink);
}
.row__arrow {
  font-size: 36rpx;
  color: var(--c-ink-3);
}

/* 手机号行 */
.row-mobile {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.row-mobile__num {
  font-size: var(--c-fs-body);
  font-weight: 700;
  color: var(--c-ink);
}
.row-mobile__none {
  font-size: var(--c-fs-body);
  color: var(--c-ink-3);
}
.row-mobile__btn {
  padding: 10rpx 26rpx;
  margin: 0;
  font-size: var(--c-fs-sm);
  font-weight: 600;
  color: var(--c-green);
  background: var(--c-green-soft);
  border: none;
  border-radius: var(--c-radius-pill);
  line-height: 1.4;

  &::after {
    border: none;
  }
  &.is-disabled {
    color: var(--c-ink-3);
    background: rgba(33, 29, 23, 0.05);
    opacity: 0.7;
  }
}
</style>
