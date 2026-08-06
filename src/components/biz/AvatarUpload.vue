<script setup lang="ts">
/**
 * AvatarUpload — 头像上传业务组件（GZ-USER-002 / GZ-USER-006）。
 *
 * <p>微信端用「头像填写能力」{@code <button open-type="chooseAvatar">} 取微信头像（微信 2022 起
 * 已废弃 getUserProfile 自动获取，chooseAvatar 是现行唯一正路）；非微信端回落 uni.chooseImage 相册/拍照。
 * 两路都把临时文件经 GZ-SYS-005 uploadFile（usageType=user_avatar）传腾讯云 COS。</p>
 *
 * <p><b>头像真源 = fileId（ADR-0009 / doc/11 §2.1）</b>：上传成功后 emit('change', { fileId, url })，
 * 父组件拿 <b>fileId</b> 落库（gz_user.avatar_image_id），url 仅作即时预览（不落裸 url）。
 * v-model 绑预览 url（展示用），落库以 fileId 为准。</p>
 *
 * <p>组件库无关纪律（CLAUDE.md §7.5）：内部仅用 view / image / button 原语 + 全局 uni API。</p>
 *
 * <p>关联文档：GZ-USER-006 AC 1 / GZ-SYS-005 OssClient / doc/11 §2.1 avatar_image_id / ADR-0009</p>
 */
import { ref } from 'vue'
import { GZ_FILE_USAGE_TYPE, uploadFile } from '@/api/gz-file'
import { t } from '@/locale/user.zh-CN'
import { toastError } from '@/utils/toast'

interface Props {
  /** 当前头像预览 URL（空则占位） */
  modelValue?: string | null
}

const props = withDefaults(defineProps<Props>(), { modelValue: '' })
const emit = defineEmits<{
  /** 上传成功：fileId 落库（avatar_image_id），url 即时预览 */
  'change': [payload: { fileId: number, url: string }]
  /** v-model 预览 url */
  'update:modelValue': [url: string]
}>()

const uploading = ref(false)

/** 临时文件路径 → COS → emit { fileId, url }（fileId 落库，url 预览）。 */
async function uploadTemp(tempPath?: string) {
  if (!tempPath || uploading.value) {
    return
  }
  uploading.value = true
  try {
    const file = await uploadFile(tempPath, GZ_FILE_USAGE_TYPE.USER_AVATAR)
    const url = file.url || ''
    const fileId = file.fileId
    if (!fileId || !url) {
      toastError(t('user.profile.avatarUploadFailed'))
      return
    }
    emit('update:modelValue', url)
    emit('change', { fileId, url })
  }
  catch (e) {
    console.warn('[avatar-upload] upload failed', e)
    toastError(t('user.profile.avatarUploadFailed'))
  }
  finally {
    uploading.value = false
  }
}

/** 微信「头像填写能力」回调：e.detail.avatarUrl 为微信头像临时路径。 */
function onChooseAvatar(e: any) {
  void uploadTemp(e?.detail?.avatarUrl)
}

/** 非微信端：相册 / 拍照选图。 */
function onTap() {
  if (uploading.value) {
    return
  }
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (res) => {
      void uploadTemp(res.tempFilePaths?.[0])
    },
  })
}
</script>

<template>
  <!-- #ifdef MP-WEIXIN -->
  <button class="avatar-upload avatar-upload--btn" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
    <view class="avatar-upload__frame">
      <image v-if="modelValue" class="avatar-upload__img" :src="modelValue" mode="aspectFill" />
      <text v-else class="avatar-upload__ph">🐰</text>
      <view v-if="uploading" class="avatar-upload__mask">
        <text class="avatar-upload__mask-text">{{ t('user.profile.avatarUploading') }}</text>
      </view>
    </view>
  </button>
  <!-- #endif -->
  <!-- #ifndef MP-WEIXIN -->
  <view class="avatar-upload" @tap="onTap">
    <view class="avatar-upload__frame">
      <image v-if="modelValue" class="avatar-upload__img" :src="modelValue" mode="aspectFill" />
      <text v-else class="avatar-upload__ph">🐰</text>
      <view v-if="uploading" class="avatar-upload__mask">
        <text class="avatar-upload__mask-text">{{ t('user.profile.avatarUploading') }}</text>
      </view>
    </view>
  </view>
  <!-- #endif -->
</template>

<style lang="scss" scoped>
.avatar-upload {
  display: inline-block;

  &:active {
    opacity: 0.8;
  }
}
/* chooseAvatar 用 <button> 承载 → 清掉微信默认按钮样式，只留头像框 */
.avatar-upload--btn {
  padding: 0;
  margin: 0;
  background: transparent;
  border: none;
  line-height: 1;

  &::after {
    border: none;
  }
}
.avatar-upload__frame {
  position: relative;
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  overflow: hidden;
  background: var(--c-amber-soft);
  border: var(--c-bw-3) solid var(--c-line);
  display: flex;
  align-items: center;
  justify-content: center;
}
.avatar-upload__img {
  width: 100%;
  height: 100%;
}
.avatar-upload__ph {
  font-size: 64rpx;
  line-height: 1;
}
.avatar-upload__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.avatar-upload__mask-text {
  font-size: var(--c-fs-2xs);
  color: #fff;
}
</style>
