<script setup lang="ts">
/**
 * BizProductCard — 拼团商品卡（场详情两列网格 / 后续搜索结果页复用）。
 *
 * <pre>
 * &lt;BizProductCard
 *   name="柯南 吧唧 一番赏 A赏" image="https://..." price="128"
 *   currency="¥" free-shipping-label="包邮" delivery-text="8月下旬到货"
 *   :ended="false" @tap="go" /&gt;
 * </pre>
 *
 * <p><b>契约无关</b>：只收展平后的展示字段（价格已是格式化好的元字符串），不 import 任何 api 类型 ——
 * 后端 VO 改字段名只需改页面传参，卡片不动。判定逻辑全在 pages/event/index.logic.ts。</p>
 *
 * <p><b>封面兜底两层</b>：① 页面传空串（后端无图 / 占位路径）→ 直接渲染内置占位块；
 * ② 传了 URL 但加载失败（预签名 1h 过期 / 网络）→ &#64;error 兜到同一个占位块。</p>
 *
 * <p>组件库无关纪律（CLAUDE.md §7.5）：仅用 view / text / image 原语 + BizPanel / BizTag +
 * var(--c-*) token，禁硬编码 hex。</p>
 */
import { computed, ref, watch } from 'vue'

defineOptions({ name: 'BizProductCard' })

const props = withDefaults(defineProps<Props>(), {
  image: '',
  price: '',
  currency: '¥',
  priceTbdLabel: '',
  freeShippingLabel: '',
  deliveryText: '',
  ended: false,
  endedLabel: '',
})
defineEmits<{ tap: [] }>()

interface Props {
  /** 商品名称（最多 2 行） */
  name: string
  /** 主图可渲染 URL；空串 = 无图（渲染内置占位块） */
  image?: string
  /** 价格（元，已格式化的纯数字串，如 '128' / '128.50'）；空串 = 无价 */
  price?: string
  /** 货币符号（与数字分节点渲染，便于小符号 + 大数字排版） */
  currency?: string
  /** 无价时显示的文案（由页面从 locale 传入） */
  priceTbdLabel?: string
  /** 包邮标识文案（传空则不渲染该标签） */
  freeShippingLabel?: string
  /** 预计到货文案（传空则不渲染该行） */
  deliveryText?: string
  /** 所属场是否已结束（整卡降饱和 + 角标；仍可点进详情浏览） */
  ended?: boolean
  /** 已结束角标文案（ended 为 true 且非空时渲染） */
  endedLabel?: string
}

/** 主图运行时加载失败标记（预签名 URL 过期 / 网络失败 → 兜到占位块）。 */
const imageFailed = ref(false)
// image 变了（列表刷新 / 节点复用）要清掉失败标记，否则一次失败会永久卡住该卡片
watch(() => props.image, () => {
  imageFailed.value = false
})

const showImage = computed(() => !!props.image && !imageFailed.value)
const hasPrice = computed(() => !!props.price)
</script>

<template>
  <view class="jp-product-card" :class="{ 'is-ended': ended }" @tap="$emit('tap')">
    <BizPanel small>
      <view class="jp-product-card__media">
        <image
          v-if="showImage"
          class="jp-product-card__img"
          :src="image"
          mode="aspectFill"
          @error="imageFailed = true"
        />
        <view v-else class="jp-product-card__ph">
          <text class="jp-product-card__ph-emoji">🧸</text>
        </view>
        <view v-if="ended && endedLabel" class="jp-product-card__ended">
          <BizTag type="ink">
            {{ endedLabel }}
          </BizTag>
        </view>
      </view>

      <view class="jp-product-card__body">
        <text class="jp-product-card__name">{{ name }}</text>

        <view class="jp-product-card__price-row">
          <template v-if="hasPrice">
            <text class="jp-product-card__cur">{{ currency }}</text>
            <text class="jp-product-card__price">{{ price }}</text>
          </template>
          <text v-else class="jp-product-card__price-tbd">{{ priceTbdLabel }}</text>
          <BizTag v-if="freeShippingLabel" type="green">
            {{ freeShippingLabel }}
          </BizTag>
        </view>

        <text v-if="deliveryText" class="jp-product-card__delivery">{{ deliveryText }}</text>
      </view>
    </BizPanel>
  </view>
</template>

<style lang="scss" scoped>
.jp-product-card {
  &:active {
    opacity: 0.75;
  }
}
/* 场已结束整卡降饱和 —— 仍可点进详情浏览（后端 closed 场照常下发商品），只是加购会被拦 */
.is-ended .jp-product-card__media,
.is-ended .jp-product-card__body {
  opacity: 0.62;
}
.jp-product-card__media {
  position: relative;
  width: 100%;
  /* 正方形图位：两列网格里高度必须由宽度决定，否则图未加载时整行塌陷 */
  aspect-ratio: 1;
  border-radius: var(--c-radius) var(--c-radius) 0 0;
  overflow: hidden;
  background: var(--c-tint-blue);
}
.jp-product-card__img {
  display: block;
  width: 100%;
  height: 100%;
}
.jp-product-card__ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--c-tint-blue), var(--c-tint-pink));
}
.jp-product-card__ph-emoji {
  font-size: 64rpx;
  line-height: 1;
  opacity: 0.7;
}
.jp-product-card__ended {
  position: absolute;
  top: 12rpx;
  left: 12rpx;
}
.jp-product-card__body {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 16rpx var(--c-gap) 20rpx;
}
.jp-product-card__name {
  font-size: var(--c-fs-body);
  font-weight: 600;
  color: var(--c-ink);
  line-height: 1.4;
  min-height: 72rpx;
  /* 两行截断（名称长短不一时保持网格行高一致） */
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.jp-product-card__price-row {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
}
.jp-product-card__cur {
  font-size: var(--c-fs-sm);
  font-weight: 700;
  color: var(--c-red);
}
.jp-product-card__price {
  font-size: var(--c-fs-h2);
  font-weight: 700;
  color: var(--c-red);
  font-variant-numeric: tabular-nums;
}
.jp-product-card__price-tbd {
  font-size: var(--c-fs-sm);
  color: var(--c-ink-3);
}
.jp-product-card__delivery {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
