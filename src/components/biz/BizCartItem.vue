<script setup lang="ts">
/**
 * BizCartItem — 购物车行（UI:mp.cart）。
 *
 * <pre>
 * &lt;BizCartItem
 *   :name="item.name" :image="item.mainImageUrl" :price-yuan="'128'"
 *   :qty="item.qty" :checked="isChecked" :invalid="item.invalid"
 *   :invalid-text="item.invalidText"
 *   @check="onCheck" @qty="onQty" @remove="onRemove" @tap="goProduct"
 * /&gt;
 * </pre>
 *
 * <p><b>为什么不复用 BizProductCard</b>：那个是两列网格里的竖版卡（图在上、名在下），
 * 购物车是横向行（勾选框 + 方图 + 右侧信息三行）。硬套要传一堆 variant 开关，
 * 两种形态各写一个组件反而更短、更好改。</p>
 *
 * <p><b>失效态</b>（AC：失效项置灰、标「已失效」、不可勾选、不计入合计）：
 * 整行降饱和 + 勾选框变禁用样式 + 图上盖「已失效」角标 + 单价位置换成失效原因文案。
 * <b>删除按钮在失效态照常可用</b> —— 客人对着一件买不了的商品，唯一想做的就是把它弄走。</p>
 *
 * <p>组件库无关纪律（CLAUDE.md §7.5）：内部仅用 view / text / image 原语，无 wd-* 依赖。
 * 数量步进器复用 BizStepper（easycom 自动引入）。</p>
 */
import { computed, ref, watch } from 'vue'

defineOptions({ name: 'BizCartItem' })

const props = withDefaults(defineProps<Props>(), {
  image: '',
  priceYuan: '',
  checked: false,
  invalid: false,
  invalidText: '',
  minQty: 1,
  maxQty: 99,
})

const emit = defineEmits<{
  /** 勾选框被点（payload = 点击后应有的勾选态） */
  check: [checked: boolean]
  /** 数量变化（payload = 目标数量，绝对值） */
  qty: [value: number]
  /** 点删除 */
  remove: []
  /** 点行主体（跳商品详情） */
  tap: []
}>()

interface Props {
  /** 商品名 */
  name: string
  /** 主图 URL（空 / 加载失败 → 内置占位块，不出破图） */
  image?: string
  /** 单价（元的纯数字串，由 formatYuan 产出；空串 = 无价） */
  priceYuan?: string
  /** 货币符号（由页面从 locale 传入，组件不绑死文案） */
  currency: string
  /** 数量 */
  qty: number
  /** 是否已勾选 */
  checked?: boolean
  /** ★ 是否失效（置灰 + 不可勾选） */
  invalid?: boolean
  /** 失效文案（后端 invalidText，直接展示） */
  invalidText?: string
  /** 失效角标文案（locale） */
  invalidBadge: string
  /** 删除按钮文案（locale） */
  deleteText: string
  /** 数量下限 */
  minQty?: number
  /** 数量上限 */
  maxQty?: number
}

/** 图片运行时加载失败（预签名 URL 1h 过期 / 网络失败）→ 回落占位块。 */
const imageBroken = ref(false)
watch(() => props.image, () => {
  imageBroken.value = false
})

const showImage = computed(() => !!props.image && !imageBroken.value)

function onCheckTap() {
  // 失效行点勾选框无反应（逻辑层 toggleItem 也拦一道，两层都拦是刻意的）
  if (props.invalid) {
    return
  }
  emit('check', !props.checked)
}
</script>

<template>
  <view class="biz-cart-item" :class="{ 'is-invalid': invalid }">
    <!-- 勾选框（失效态禁用） -->
    <view class="biz-cart-item__check" @tap.stop="onCheckTap">
      <view
        class="biz-cart-item__box"
        :class="{ 'is-on': checked && !invalid, 'is-off': invalid }"
      >
        <text v-if="checked && !invalid" class="biz-cart-item__tick">✓</text>
      </view>
    </view>

    <!-- 主图（点它进商品详情） -->
    <view class="biz-cart-item__thumb" @tap="emit('tap')">
      <image
        v-if="showImage"
        class="biz-cart-item__img"
        :src="image"
        mode="aspectFill"
        @error="imageBroken = true"
      />
      <view v-else class="biz-cart-item__img-ph">
        <text class="biz-cart-item__img-emoji">🧸</text>
      </view>
      <view v-if="invalid" class="biz-cart-item__mask">
        <text class="biz-cart-item__mask-text">{{ invalidBadge }}</text>
      </view>
    </view>

    <!-- 右侧信息 -->
    <view class="biz-cart-item__main">
      <text class="biz-cart-item__name" @tap="emit('tap')">{{ name }}</text>

      <!-- 失效态：把单价位置让给失效原因（客人先要知道为什么买不了） -->
      <text v-if="invalid" class="biz-cart-item__invalid">{{ invalidText }}</text>

      <view class="biz-cart-item__foot">
        <view v-if="!invalid" class="biz-cart-item__price">
          <text class="biz-cart-item__cur">{{ currency }}</text>
          <text class="biz-cart-item__amount">{{ priceYuan }}</text>
        </view>
        <view v-else class="biz-cart-item__price-ph" />

        <view class="biz-cart-item__ops">
          <BizStepper
            v-if="!invalid"
            :model-value="qty"
            :min="minQty"
            :max="maxQty"
            @update:model-value="emit('qty', $event)"
          />
          <text class="biz-cart-item__del" @tap.stop="emit('remove')">{{ deleteText }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.biz-cart-item {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  padding: 20rpx var(--c-gap-card);
}
/* ★ 失效整行降饱和（不是隐藏 —— 客人要看得见自己加过什么） */
.is-invalid {
  opacity: 0.55;
}

/* ── 勾选框 ── */
.biz-cart-item__check {
  padding: 8rpx 4rpx;
  flex-shrink: 0;
}
.biz-cart-item__box {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  box-sizing: border-box;
  border: 2rpx solid var(--c-ink-3);
  background: var(--c-surface);
  display: flex;
  align-items: center;
  justify-content: center;
}
.biz-cart-item__box.is-on {
  background: var(--c-red);
  border-color: var(--c-red);
}
.biz-cart-item__box.is-off {
  background: rgba(33, 29, 23, 0.04);
  border-style: dashed;
}
.biz-cart-item__tick {
  font-size: var(--c-fs-sm);
  font-weight: 700;
  line-height: 1;
  color: var(--c-on-dark);
}

/* ── 主图 ── */
.biz-cart-item__thumb {
  position: relative;
  width: 150rpx;
  height: 150rpx;
  flex-shrink: 0;
  border-radius: var(--c-radius);
  overflow: hidden;
  background: var(--c-bg);
}
.biz-cart-item__img {
  display: block;
  width: 150rpx;
  height: 150rpx;
}
.biz-cart-item__img-ph {
  width: 150rpx;
  height: 150rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--c-tint-blue), var(--c-tint-pink));
}
.biz-cart-item__img-emoji {
  font-size: 56rpx;
  line-height: 1;
  opacity: 0.7;
}
.biz-cart-item__mask {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 6rpx 0;
  background: rgba(33, 29, 23, 0.62);
  display: flex;
  align-items: center;
  justify-content: center;
}
.biz-cart-item__mask-text {
  font-size: var(--c-fs-2xs);
  font-weight: 700;
  letter-spacing: 1rpx;
  color: var(--c-on-dark);
}

/* ── 右侧信息 ── */
.biz-cart-item__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  /* 与主图等高，让底部行（价格 / stepper）贴住图片下沿 */
  min-height: 150rpx;
}
.biz-cart-item__name {
  font-size: var(--c-fs-body);
  font-weight: 600;
  color: var(--c-ink);
  line-height: 1.4;
  /* 两行截断（商品名很长，谷圈惯例带一串限定词） */
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.biz-cart-item__invalid {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
}
.biz-cart-item__foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}
.biz-cart-item__price {
  display: flex;
  align-items: baseline;
  gap: 2rpx;
  flex-shrink: 0;
}
.biz-cart-item__price-ph {
  flex: 1;
}
.biz-cart-item__cur {
  font-size: var(--c-fs-xs);
  font-weight: 700;
  color: var(--c-red);
}
.biz-cart-item__amount {
  font-size: var(--c-fs-lg);
  font-weight: 700;
  color: var(--c-red);
  font-variant-numeric: tabular-nums;
}
.biz-cart-item__ops {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.biz-cart-item__del {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-3);
  padding: 6rpx 4rpx;
}
</style>
