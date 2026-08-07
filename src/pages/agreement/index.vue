<script lang="ts" setup>
/**
 * 协议正文页 —— 渲染《用户服务协议》/《隐私政策》（微信合规：链接须能打开可读正文）。
 *
 * <p>由登录页 / 协议 sheet / 关于页的《》链接 `navigateTo('/pages/agreement/index?type=service|privacy')`
 * 进入。正文真源 src/locale/agreement.zh-CN.ts。</p>
 */
import { onLoad } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { getAgreementDoc } from '@/locale/agreement.zh-CN'

defineOptions({ name: 'GzAgreement' })

definePage({
  style: {
    navigationBarTitleText: '协议',
  },
})

const doc = ref(getAgreementDoc('service'))

onLoad((query) => {
  const type = (query?.type as string) || 'service'
  doc.value = getAgreementDoc(type)
  uni.setNavigationBarTitle({ title: doc.value.title })
})
</script>

<template>
  <BizScreen class="jp-screen">
    <view class="block">
      <BizPanel>
        <view class="doc">
          <view class="doc__head">
            <BizMangaTitle size="h1">
              {{ doc.title }}
            </BizMangaTitle>
            <text class="doc__meta">{{ doc.publisher }}</text>
            <text class="doc__meta c-mono">生效日期：{{ doc.updated }}</text>
          </view>

          <view
            v-for="(sec, si) in doc.sections"
            :key="si"
            class="doc__section"
          >
            <text v-if="sec.heading" class="doc__heading">{{ sec.heading }}</text>
            <text
              v-for="(p, pi) in sec.body"
              :key="pi"
              class="doc__p"
            >
              {{ p }}
            </text>
          </view>
        </view>
      </BizPanel>
    </view>
  </BizScreen>
</template>

<style lang="scss" scoped>
.block {
  padding: 24rpx var(--c-gap-page) 48rpx;
}
.doc {
  padding: 32rpx 28rpx;
}
.doc__head {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding-bottom: 24rpx;
  margin-bottom: 16rpx;
  border-bottom: var(--c-bw-3) solid var(--c-line);
}
.doc__meta {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-3);
}
.doc__section {
  margin-top: 28rpx;
}
.doc__heading {
  display: block;
  font-size: var(--c-fs-lg);
  font-weight: 700;
  color: var(--c-ink);
  margin-bottom: 12rpx;
}
.doc__p {
  display: block;
  font-size: var(--c-fs-body);
  line-height: 1.8;
  color: var(--c-ink-2);
  margin-bottom: 12rpx;
}
</style>
