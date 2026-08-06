<script lang="ts" setup>
/**
 * GZ-JP-202 — 商品详情。UI:mp.product_detail。
 *
 * <p>路由 {@code /pages/product/detail?id=<商品主键>&productNo=<商品编号>}
 * （场详情商品卡生成，见 pages/event/index.logic.ts 的 {@code buildProductRoute}）。
 * 首页 → 场详情 → 商品详情 = <b>两跳可达</b>（AC）。</p>
 *
 * <p>自上而下严格按 {@code detail.logic.ts} 的 {@code SECTION_ORDER}：</p>
 * <ol>
 *   <li>主图轮播（主图 + 图集）</li>
 *   <li>名称（+ 所属场次面包屑）</li>
 *   <li>价格（大字）+ ★「包邮」标识（REQ-ORDER-004：拼团全包邮，此价即最终支付价）</li>
 *   <li>预计到货时间（REQ-PROD-004）</li>
 *   <li>★ <b>购买须知区块</b>（REQ-PROD-005 / UI:mp.product_detail.notice）</li>
 *   <li>底部固定 CTA：数量 stepper + 加入购物车（UI:mp.product_detail.cta）</li>
 * </ol>
 *
 * <p><b>★ 第 5 块（notice）的三条硬要求</b>（甲方明确、design-options/mp-product-detail.md 选定方案 A）：
 * 必须<b>在 CTA 之上</b>、正文<b>默认整段展开</b>（不做「查看更多 / 收起」的截断交互）、
 * <b>底色区分于正文</b>。这是下单前的风险告知位，藏起来等于没有。
 * 顺序由 {@code SECTION_ORDER} 常量 + 单测锁死，正文完整性由 {@code buildNoticeText} 保证
 * （商家漏填时兜底一段通用提示，区块本身从不消失）。</p>
 *
 * <p><b>★ 加购是占位交互</b>：购物车域归 GZ-JP-104（后端）/ GZ-JP-203（购物车页），本卡不实现。
 * 点「加入购物车」只 toast「购物车即将上线」——<b>刻意不写入任何本地/远端购物车</b>，
 * 不制造一个看起来能用其实是假的功能。接真购物车时的改法见完工报告「对下游提示」。</p>
 *
 * <p><b>加购置灰唯一依据 = 后端 {@code eventBookable}</b>（{@code buildAddToCartState}）：
 * 不判 {@code status}、不拿场的 endTime 跟本地时钟比（店员手动关场判不出来 + 客户端时钟不可信）。</p>
 *
 * <p><b>游客优先</b>：商品详情匿名可读（后端 &#64;SaIgnore），浏览不需要登录态。</p>
 */
import type { GzJpProductMpVO } from '@/api/gz-jp/product'
import { onLoad } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { formatYuan } from '@/api/gz-jp/format'
import { fetchProductDetail } from '@/api/gz-jp/product'
import { t } from '@/locale/product.zh-CN'
import { buildAddToCartState, HOME_ROUTE } from '../event/index.logic'
import {
  buildGalleryImages,
  buildNoticeText,
  clampQuantity,
  MAX_QUANTITY,
  MIN_QUANTITY,
} from './detail.logic'

defineOptions({ name: 'GzJpProductDetail' })

definePage({
  style: {
    navigationBarTitleText: '商品详情',
  },
})

/* ── 路由参数 ─────────────────────────────────────────────── */

const productId = ref('')
/** 商品编号（业务码，展示 / 客服对单用；接口一律用 id） */
const productNoFromRoute = ref('')

/* ── 取数 ────────────────────────────────────────────────── */

const product = ref<GzJpProductMpVO | null>(null)
const loading = ref(true)
const loadFailed = ref(false)

async function load(id: string) {
  loading.value = true
  loadFailed.value = false
  try {
    // 商品不存在 / 已下架 / 所属场未开场 → 后端 R.fail（http.ts 已 toast）。
    // ★ 场已结束不是失败：照常 200 + eventBookable=false，别按 code!==200 走失效页。
    product.value = await fetchProductDetail(id)
  }
  catch (e) {
    console.warn('[jp-product] load failed', e)
    loadFailed.value = true
    product.value = null
  }
  finally {
    loading.value = false
  }
}

/* ── 展示派生 ────────────────────────────────────────────── */

/** 顶部轮播：主图在前 + 图集，已滤掉后端占位图与重复项；可能为空（→ 渲染内置占位块）。 */
const galleryImages = computed(() => buildGalleryImages(product.value))
/** 轮播图运行时加载失败的下标集合（预签名 URL 1h 过期 / 网络失败 → 单张兜到占位块）。 */
const failedImages = ref<Record<number, boolean>>({})
function onImageError(index: number) {
  failedImages.value = { ...failedImages.value, [index]: true }
}

/** 价格（元的纯数字串，货币符号单独渲染以便「小 ¥ + 大数字」排版）；空串 = 无价。 */
const priceYuan = computed(() => formatYuan(product.value?.priceCent))

/** 预计到货：商家没填时给明确兜底，不留空行让人以为漏渲染。 */
const deliveryText = computed(() => {
  const v = (product.value?.deliveryDateText ?? '').trim()
  return v || t('product.deliveryUnset')
})

/**
 * ★ 购买须知正文（REQ-PROD-005）。
 * 商家漏填时用兜底文案，<b>区块本身恒定渲染</b>——一个时有时无的告知位客人形成不了阅读习惯。
 */
const noticeText = computed(() =>
  buildNoticeText(product.value?.noticeText, t('product.noticeFallback')))

/** ★ 加购状态：唯一依据是后端 eventBookable。 */
const addToCartState = computed(() => buildAddToCartState(product.value?.eventBookable))
const ctaDisabled = computed(() => addToCartState.value.disabled)
const ctaText = computed(() =>
  addToCartState.value.reason === 'ended' ? t('product.addToCartEnded') : t('product.addToCart'))

/** 展示用商品编号：优先后端返回的，取不到时退回路由带来的。 */
const displayProductNo = computed(() => product.value?.productNo || productNoFromRoute.value)

/* ── 数量 ────────────────────────────────────────────────── */

const quantity = ref(MIN_QUANTITY)
function onQuantityChange(value: number) {
  quantity.value = clampQuantity(value)
}

/* ── 交互 ────────────────────────────────────────────────── */

/**
 * 点「加入购物车」。
 *
 * <p>场已结束 → 明确告知不能加购；否则 → <b>占位提示</b>（购物车归 GZ-JP-104/203）。
 * 两条分支都<b>不写任何购物车数据</b>，页面也不给「已加入」的成功反馈。</p>
 */
function onAddToCart() {
  if (ctaDisabled.value) {
    uni.showToast({ title: t('product.endedToast'), icon: 'none' })
    return
  }
  uni.showToast({ title: t('product.addToCartComingSoon'), icon: 'none' })
}

/** 取数失败 / 用户想回退时的出口：有上一页就返回，直达进来的（分享链接）回首页 tab。 */
function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.switchTab({ url: HOME_ROUTE })
}

/* ── 生命周期 ────────────────────────────────────────────── */

onLoad((query?: Record<string, string | undefined>) => {
  const id = String(query?.id ?? '')
  productNoFromRoute.value = String(query?.productNo ?? '')
  if (!id) {
    // 没带 id 进来（手改路由 / 分享链接被截断）→ 直接失败态，不打无意义的请求
    loading.value = false
    loadFailed.value = true
    return
  }
  productId.value = id
  void load(id)
})
</script>

<template>
  <BizScreen>
    <view class="jp-product-detail">
      <!-- 加载态 -->
      <view v-if="loading" class="jp-pad jp-product-detail__state">
        <BizPanel>
          <BizState variant="loading" :text="t('product.loading')" />
        </BizPanel>
      </view>

      <!-- 商品不存在 / 已下架 / 所属场未开场 -->
      <view v-else-if="loadFailed || !product" class="jp-pad jp-product-detail__state">
        <BizPanel>
          <BizState
            variant="error"
            :text="t('product.loadError')"
            :sub="t('product.loadErrorSub')"
            :cta-text="t('product.back')"
            @cta="goBack"
          />
        </BizPanel>
      </view>

      <template v-else>
        <!-- ① 主图轮播（主图 + 图集） -->
        <view class="jp-product-detail__gallery">
          <swiper
            v-if="galleryImages.length"
            class="jp-product-detail__swiper"
            :indicator-dots="galleryImages.length > 1"
            :circular="galleryImages.length > 1"
            indicator-color="rgba(0,0,0,0.25)"
            indicator-active-color="#33B36B"
          >
            <swiper-item v-for="(img, i) in galleryImages" :key="i">
              <image
                v-if="!failedImages[i]"
                class="jp-product-detail__img"
                :src="img"
                mode="aspectFill"
                @error="onImageError(i)"
              />
              <view v-else class="jp-product-detail__img-ph">
                <text class="jp-product-detail__img-emoji">🧸</text>
              </view>
            </swiper-item>
          </swiper>
          <view v-else class="jp-product-detail__img-ph">
            <text class="jp-product-detail__img-emoji">🧸</text>
          </view>
        </view>

        <!-- ② 名称 + 所属场次 -->
        <view class="jp-pad jp-product-detail__block">
          <text class="jp-product-detail__name">{{ product.name }}</text>
          <view class="jp-product-detail__event">
            <text class="jp-product-detail__event-label">{{ t('product.eventLabel') }}</text>
            <text class="jp-product-detail__event-name">{{ product.eventName }}</text>
          </view>
          <text v-if="displayProductNo" class="jp-product-detail__no">{{ displayProductNo }}</text>
        </view>

        <!-- ③ 价格（大字）+ ★ 包邮标识 -->
        <view class="jp-pad jp-product-detail__block">
          <view class="jp-product-detail__price-row">
            <template v-if="priceYuan">
              <text class="jp-product-detail__cur">{{ t('product.currency') }}</text>
              <text class="jp-product-detail__price">{{ priceYuan }}</text>
            </template>
            <text v-else class="jp-product-detail__price-tbd">{{ t('product.priceTbd') }}</text>
            <BizTag type="green">
              {{ t('product.shippingFree') }}
            </BizTag>
          </view>
          <text class="jp-product-detail__ship-hint">{{ t('product.shippingFreeHint') }}</text>
        </view>

        <!-- ④ 预计到货时间 -->
        <view class="jp-pad jp-product-detail__block">
          <view class="jp-product-detail__row">
            <text class="jp-product-detail__row-label">{{ t('product.deliveryLabel') }}</text>
            <text class="jp-product-detail__row-value">{{ deliveryText }}</text>
          </view>
        </view>

        <!--
          ⑤ ★ 购买须知（REQ-PROD-005 / UI:mp.product_detail.notice）
          位置 = CTA 之上；正文 = 整段直出；底色 = 琥珀浅底，与正文白底区分。
          三条都是甲方硬要求，改动前先看 design-options/mp-product-detail.md（方案 A）。
        -->
        <view class="jp-pad jp-product-detail__block">
          <view class="jp-product-notice">
            <view class="jp-product-notice__head">
              <text class="jp-product-notice__badge">!</text>
              <text class="jp-product-notice__title">{{ t('product.noticeTitle') }}</text>
            </view>
            <text class="jp-product-notice__body">{{ noticeText }}</text>
          </view>
        </view>

        <!-- 底部 fixed CTA 让位 -->
        <view class="jp-product-detail__spacer" />

        <!-- ⑥ 底部固定 CTA：数量 stepper + 加入购物车 -->
        <view class="jp-product-cta">
          <view class="jp-product-cta__qty">
            <text class="jp-product-cta__qty-label">{{ t('product.quantityLabel') }}</text>
            <BizStepper
              :model-value="quantity"
              :min="MIN_QUANTITY"
              :max="MAX_QUANTITY"
              :disabled="ctaDisabled"
              @update:model-value="onQuantityChange"
            />
          </view>
          <view
            class="jp-product-cta__btn"
            :class="{ 'is-disabled': ctaDisabled }"
            @tap="onAddToCart"
          >
            <text class="jp-product-cta__btn-text">{{ ctaText }}</text>
          </view>
        </view>
      </template>
    </view>
  </BizScreen>
</template>

<style lang="scss" scoped>
/* 页面左右内边距（不用 .block —— 与 UnoCSS 的 display:block 工具类同名会撞） */
.jp-pad {
  padding: 0 var(--c-gap-page);
}
.jp-product-detail__state {
  padding-top: 24rpx;
}

/* ── ① 主图轮播 ── */
.jp-product-detail__swiper {
  width: 100%;
  height: 640rpx;
}
.jp-product-detail__img {
  display: block;
  width: 100%;
  height: 640rpx;
}
.jp-product-detail__img-ph {
  width: 100%;
  height: 640rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--c-tint-blue), var(--c-tint-pink));
}
.jp-product-detail__img-emoji {
  font-size: 120rpx;
  line-height: 1;
  opacity: 0.7;
}

/* ── 通用区块 ── */
.jp-product-detail__block {
  padding-top: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

/* ── ② 名称 ── */
.jp-product-detail__name {
  font-size: var(--c-fs-h1);
  font-weight: 700;
  color: var(--c-ink);
  line-height: 1.4;
}
.jp-product-detail__event {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.jp-product-detail__event-label {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-3);
}
.jp-product-detail__event-name {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
}
.jp-product-detail__no {
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-3);
  font-family: var(--c-font-mono);
}

/* ── ③ 价格 ── */
.jp-product-detail__price-row {
  display: flex;
  align-items: baseline;
  gap: 10rpx;
}
.jp-product-detail__cur {
  font-size: var(--c-fs-lg);
  font-weight: 700;
  color: var(--c-red);
}
.jp-product-detail__price {
  font-size: var(--c-fs-display);
  font-weight: 700;
  color: var(--c-red);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.jp-product-detail__price-tbd {
  font-size: var(--c-fs-lg);
  font-weight: 700;
  color: var(--c-ink-3);
}
.jp-product-detail__ship-hint {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-3);
}

/* ── ④ 到货 ── */
.jp-product-detail__row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx var(--c-gap-card);
  border-radius: var(--c-radius);
  background: var(--c-surface);
  box-shadow: var(--c-shadow-sm);
}
.jp-product-detail__row-label {
  font-size: var(--c-fs-sm);
  color: var(--c-ink-2);
  flex-shrink: 0;
}
.jp-product-detail__row-value {
  flex: 1;
  min-width: 0;
  font-size: var(--c-fs-body);
  font-weight: 600;
  color: var(--c-ink);
  text-align: right;
}

/* ── ⑤ ★ 购买须知：底色区分正文（琥珀浅底 vs 白卡），整段直出无截断 ── */
.jp-product-notice {
  padding: var(--c-gap-card);
  border-radius: var(--c-radius);
  /* 与正文白卡形成对比的告知位底色（甲方硬要求「底色区分于正文」） */
  background: var(--c-amber-soft);
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}
.jp-product-notice__head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.jp-product-notice__badge {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: var(--c-amber);
  color: var(--c-on-dark);
  font-size: var(--c-fs-xs);
  font-weight: 700;
  line-height: 32rpx;
  text-align: center;
}
.jp-product-notice__title {
  font-size: var(--c-fs-body);
  font-weight: 700;
  color: #8a5a10;
}
/* 正文整段渲染：不限行数、不截断（这是风险告知位，看不全等于没写） */
.jp-product-notice__body {
  font-size: var(--c-fs-sm);
  color: #8a5a10;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ── ⑥ 底部固定 CTA ── */
.jp-product-detail__spacer {
  height: var(--c-cta-spacer);
}
.jp-product-cta {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 20rpx var(--c-gap-page);
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: saturate(180%) blur(16px);
  border-top: var(--c-bw-3) solid var(--c-line);
}
.jp-product-cta__qty {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
}
.jp-product-cta__qty-label {
  font-size: var(--c-fs-sm);
  color: var(--c-ink-2);
}
.jp-product-cta__btn {
  flex: 1;
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--c-radius);
  background: var(--c-red);
  box-shadow: var(--c-shadow-btn);
  transition:
    transform 0.12s ease,
    opacity 0.12s ease;

  &:active:not(.is-disabled) {
    transform: translateY(1rpx);
    opacity: 0.92;
  }
}
.jp-product-cta__btn.is-disabled {
  background: #d9d4cb;
  box-shadow: none;
}
.jp-product-cta__btn-text {
  font-size: var(--c-fs-body);
  font-weight: 600;
  letter-spacing: 0.5rpx;
  color: var(--c-on-dark);
}
</style>
