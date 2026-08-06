<script setup lang="ts">
/**
 * BizHomeBanner — 首页轮播 banner（「banner 即 hero」）。
 *
 * <p>admin 在 sys_config（gz.home.banners）配置的多图轮播，父页拉取后传入 banners；
 * 空配置 → 内置占位 slide（运营素材到位前不空窗）。GZ-JP-201 首页接入。</p>
 *
 * <p>点击 emit('tap', link)，由父页按站内 tab/普通路由分流（switchTab vs navigateTo）。</p>
 *
 * <p>组件库无关纪律（CLAUDE.md §7.5）：仅用 swiper / image / view / text 原语 + var(--c-*)。</p>
 */
import type { HomeBannerItem } from '@/api/gz-common'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ banners?: HomeBannerItem[] }>(), {
  banners: () => [],
})
const emit = defineEmits<{ tap: [link: string] }>()

/** 无配置时的占位 slide（无跳转，link 为空则不可点） */
const FALLBACK: HomeBannerItem = { imageUrl: '', link: '', enabled: true }

const slides = computed<HomeBannerItem[]>(() => (props.banners.length ? props.banners : [FALLBACK]))
const multiple = computed(() => slides.value.length > 1)

function onTap(link: string) {
  if (link)
    emit('tap', link)
}
</script>

<template>
  <view class="hb">
    <swiper
      class="hb__swiper"
      :indicator-dots="multiple"
      :autoplay="multiple"
      :circular="multiple"
      :interval="4000"
      :duration="400"
      indicator-color="rgba(0,0,0,0.25)"
      indicator-active-color="#33B36B"
    >
      <swiper-item v-for="(s, i) in slides" :key="i" @tap="onTap(s.link)">
        <image v-if="s.imageUrl" class="hb__img" :src="s.imageUrl" mode="aspectFill" />
        <view v-else class="hb__ph">
          <text class="hb__ph-emoji">🧧</text>
          <text class="hb__ph-title">谷子宇宙拼团</text>
          <text class="hb__ph-sub">日本现场直邮 · 一单多款</text>
        </view>
      </swiper-item>
    </swiper>
  </view>
</template>

<style lang="scss" scoped>
.hb {
  border-radius: var(--c-radius-card);
  box-shadow: var(--c-shadow);
  overflow: hidden;
  background: var(--c-paper);
}
.hb__swiper {
  width: 100%;
  height: 300rpx;
}
.hb__img {
  display: block;
  width: 100%;
  height: 300rpx;
}
.hb__ph {
  position: relative;
  width: 100%;
  height: 300rpx;
  background: linear-gradient(135deg, var(--c-tint-pink), var(--c-tint-yellow));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
}
.hb__ph-emoji {
  position: relative;
  z-index: 1;
  font-size: 88rpx;
  line-height: 1;
}
.hb__ph-title {
  position: relative;
  z-index: 1;
  font-size: var(--c-fs-h2);
  font-weight: 700;
  color: var(--c-ink);
}
.hb__ph-sub {
  position: relative;
  z-index: 1;
  font-size: var(--c-fs-sm);
  font-weight: 600;
  color: var(--c-red);
}
</style>
