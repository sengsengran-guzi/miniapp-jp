<script lang="ts" setup>
/**
 * GZ-USER-001 — 关于页（静态：版本号 + 合规备案 + 服务协议链接）。
 *
 * <p>从会员中心九宫格「关于」入口跳入。内容极少，合并到 USER-001（任务卡决策 D2）。</p>
 *
 * <p>i18n 走 t('user.home.aboutXxx')；C 设计系统。关联文档：GZ-USER-001 AC 3.5</p>
 */
import { t } from '@/locale/user.zh-CN'

defineOptions({
  name: 'GzMeAbout',
})

definePage({
  style: {
    navigationBarTitleText: '关于',
  },
})

/** 版本号（读编译期注入；缺省兜底）。 */
const version = (import.meta.env.VITE_APP_VERSION as string) || '1.0.0'

/** 协议链接（占位；上线替换甲方实际协议页 URL）。 */
const links = [
  { key: 'agreement', label: t('user.home.aboutAgreement') },
  { key: 'privacy', label: t('user.home.aboutPrivacy') },
]

function onLink(key: string) {
  // 打开协议正文页（agreement→服务协议 / privacy→隐私政策）
  uni.navigateTo({ url: `/pages/agreement/index?type=${key === 'agreement' ? 'service' : 'privacy'}` })
}
</script>

<template>
  <BizScreen>
    <!-- 卡内布局放 __inner 真实子节点（virtualHost 会丢 BizPanel host 上的外部 flex/padding） -->
    <view class="block">
      <BizPanel>
        <view class="about-logo">
          <view class="about-logo__badge">
            🐰
          </view>
          <BizMangaTitle size="h1">
            谷子宇宙
          </BizMangaTitle>
          <text class="about-logo__ver c-mono">v{{ version }}</text>
        </view>
      </BizPanel>
    </view>

    <view class="block">
      <BizPanel>
        <view class="about-info">
          <view class="about-info__row">
            <text class="about-info__k">{{ t('user.home.aboutVersionLabel') }}</text>
            <text class="about-info__v c-num">v{{ version }}</text>
          </view>
          <view
            v-for="link in links"
            :key="link.key"
            class="about-info__row about-info__row--link"
            @tap="onLink(link.key)"
          >
            <text class="about-info__k">{{ link.label }}</text>
            <text class="about-info__arrow">›</text>
          </view>
        </view>
      </BizPanel>
    </view>

    <view class="block--tail block">
      <text class="about-foot">{{ t('user.home.aboutCompany') }}</text>
      <text class="about-foot about-foot--mono c-mono">{{ t('user.home.aboutIcp') }}</text>
      <text class="about-foot about-foot--mono c-mono">{{ t('user.home.aboutCopyright') }}</text>
    </view>
  </BizScreen>
</template>

<style lang="scss" scoped>
.block {
  padding: 24rpx var(--c-gap-page) 0;
}
.block--tail {
  padding: 48rpx var(--c-gap-page) 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10rpx;
}

/* ── logo 区 ── */
.about-logo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
  padding: 40rpx 24rpx;
}
.about-logo__badge {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
  background: var(--c-amber-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 72rpx;
  line-height: 1;
}
.about-logo__ver {
  font-size: var(--c-fs-sm);
  color: var(--c-ink-2);
}

/* ── 信息行 ── */
.about-info {
  padding: 8rpx 24rpx;
}
.about-info__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 0;
  border-bottom: var(--c-bw-3) solid var(--c-line);

  &:last-child {
    border-bottom: none;
  }
}
.about-info__row--link {
  &:active {
    opacity: 0.6;
  }
}
.about-info__k {
  font-size: var(--c-fs-body);
  color: var(--c-ink);
}
.about-info__v {
  font-size: var(--c-fs-body);
  font-weight: 600;
  color: var(--c-ink-2);
}
.about-info__arrow {
  font-size: 40rpx;
  color: var(--c-ink-3);
}

/* ── 页脚 ── */
.about-foot {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-3);
  text-align: center;
}
.about-foot--mono {
  font-size: var(--c-fs-2xs);
}
</style>
