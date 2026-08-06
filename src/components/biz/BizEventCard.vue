<script setup lang="ts">
/**
 * BizEventCard — 拼团场卡片（首页场列表 / 后续「全部场次」页复用）。
 *
 * <pre>
 * &lt;BizEventCard
 *   name="8月上旬快闪场" cover="https://..." tone="live"
 *   status-label="进行中" timing-text="截止 09/30 22:00" description="…"
 *   @tap="go" /&gt;
 * </pre>
 *
 * <p><b>契约无关</b>：只收展平后的展示字段，不 import 任何 api 类型 —— 后端 VO 改字段名
 * 只需改页面的传参，卡片不动。分组 / 时间 / 封面兜底的判定全在 pages/index/index.logic.ts。</p>
 *
 * <p><b>封面兜底两层</b>：① 页面传空串（后端无图 / 占位路径）→ 直接渲染内置占位块；
 * ② 传了 URL 但加载失败（签名过期 / 网络）→ &#64;error 兜到同一个占位块。
 * 两层都做是因为预签名 URL 只有 1h 有效期，列表停留久了必然遇到 ②。</p>
 *
 * <p>组件库无关纪律（CLAUDE.md §7.5）：仅用 view / text / image 原语 + BizPanel / BizTag +
 * var(--c-*) token，禁硬编码 hex。</p>
 */
import { computed, ref, watch } from 'vue'

defineOptions({ name: 'BizEventCard' })

const props = withDefaults(defineProps<Props>(), {
  cover: '',
  description: '',
  timingText: '',
  tone: 'live',
})
defineEmits<{ tap: [] }>()

interface Props {
  /** 场名称 */
  name: string
  /** 封面可渲染 URL；空串 = 无封面（渲染内置占位块） */
  cover?: string
  /** 场简介（可空，最多显示 2 行） */
  description?: string
  /** 状态标签文案（「进行中」/「即将开始」/「已结束」，由页面从 locale 取） */
  statusLabel: string
  /** 时间行文案（「截止 09/30 22:00」等，由页面组装；空串则不渲染该行） */
  timingText?: string
  /** 视觉基调：live 进行中 / upcoming 即将开始 / ended 已结束（整卡降饱和） */
  tone?: 'live' | 'upcoming' | 'ended'
}

/** 标签配色：进行中走品牌色，即将开始走提醒色，已结束走弱墨。 */
const TAG_TYPE = { live: 'red', upcoming: 'yellow', ended: 'ink' } as const
const tagType = computed(() => TAG_TYPE[props.tone])

/** 封面运行时加载失败标记（预签名 URL 过期 / 网络失败 → 兜到占位块）。 */
const coverFailed = ref(false)
// cover 变了（列表刷新 / 复用节点）要把失败标记清掉，否则一次失败会永久卡住该卡片
watch(() => props.cover, () => {
  coverFailed.value = false
})

const showCover = computed(() => !!props.cover && !coverFailed.value)
</script>

<template>
  <view class="jp-event-card" :class="{ 'is-ended': tone === 'ended' }" @tap="$emit('tap')">
    <BizPanel>
      <view class="jp-event-card__inner">
        <view class="jp-event-card__cover">
          <image
            v-if="showCover"
            class="jp-event-card__img"
            :src="cover"
            mode="aspectFill"
            @error="coverFailed = true"
          />
          <view v-else class="jp-event-card__ph">
            <text class="jp-event-card__ph-emoji">🎏</text>
          </view>
        </view>

        <view class="jp-event-card__body">
          <view class="jp-event-card__head">
            <text class="jp-event-card__name">{{ name }}</text>
            <BizTag :type="tagType">
              {{ statusLabel }}
            </BizTag>
          </view>
          <text v-if="description" class="jp-event-card__desc">{{ description }}</text>
          <text v-if="timingText" class="jp-event-card__timing">{{ timingText }}</text>
        </view>
      </view>
    </BizPanel>
  </view>
</template>

<style lang="scss" scoped>
.jp-event-card {
  &:active {
    opacity: 0.75;
  }
}
/* 已结束整卡降饱和 —— 仍可点进去浏览商品（后端 closed 场照常下发商品），只是不再是主推 */
.is-ended .jp-event-card__inner {
  opacity: 0.62;
}
.jp-event-card__inner {
  display: flex;
  align-items: stretch;
  gap: var(--c-gap);
  padding: var(--c-gap-card);
}
.jp-event-card__cover {
  flex-shrink: 0;
  width: 200rpx;
  height: 150rpx;
  border-radius: var(--c-radius);
  overflow: hidden;
  background: var(--c-tint-green);
}
.jp-event-card__img {
  display: block;
  width: 200rpx;
  height: 150rpx;
}
.jp-event-card__ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--c-tint-green), var(--c-tint-yellow));
}
.jp-event-card__ph-emoji {
  font-size: 56rpx;
  line-height: 1;
  opacity: 0.7;
}
.jp-event-card__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.jp-event-card__head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.jp-event-card__name {
  flex: 1;
  min-width: 0;
  font-size: var(--c-fs-lg);
  font-weight: 600;
  color: var(--c-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jp-event-card__desc {
  font-size: var(--c-fs-sm);
  color: var(--c-ink-2);
  line-height: 1.5;
  /* 两行截断 */
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.jp-event-card__timing {
  margin-top: auto;
  font-size: var(--c-fs-xs);
  color: var(--c-ink-3);
}
</style>
