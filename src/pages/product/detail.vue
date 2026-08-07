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
 * <p><b>★ 加购是真的</b>（GZ-JP-203 起）：点「加入购物车」→ {@code ensureLoggedIn}（购物车是
 * 用户私有数据，四个端点都需登录）→ {@code POST /app/gz/jp/cart} → 成功后刷新 CTA 条上的
 * 购物车角标。同商品重复加购由后端<b>累加数量</b>，不会产生第二行。</p>
 *
 * <p><b>加购置灰唯一依据 = 后端 {@code eventBookable}</b>（{@code buildAddToCartState}）：
 * 不判 {@code status}、不拿场的 endTime 跟本地时钟比（店员手动关场判不出来 + 客户端时钟不可信）。
 * <b>前端置灰只是体验层</b>，后端加购时还会用 {@code isBookable} 再拦一道。</p>
 *
 * <p><b>游客优先</b>：商品详情匿名可读（后端 &#64;SaIgnore），浏览不需要登录态；
 * 只有点加购才触发协议同意 sheet 走微信登录。</p>
 */
import type { GzJpProductMpVO } from '@/api/gz-jp/product'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { addToCart, CART_ROUTE, fetchCart } from '@/api/gz-jp/cart'
import { formatYuan } from '@/api/gz-jp/format'
import { fetchProductDetail } from '@/api/gz-jp/product'
import { useAuth } from '@/hooks/useAuth'
import { t } from '@/locale/product.zh-CN'
import { buildAddToCartState, HOME_ROUTE } from '../event/index.logic'
import { formatBadgeCount } from '../index/index.logic'
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

const { isLoggedIn, ensureLoggedIn } = useAuth()

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

/* ── 购物车角标 ──────────────────────────────────────────── */

/**
 * CTA 条左侧购物车入口的款数角标。
 *
 * <p>游客不显示（购物车是登录后的私有数据，游客的车恒为空）。拉取失败只是不显示角标 ——
 * 角标是附属信息，不该因为它挂了就打扰正在看商品的客人。</p>
 */
const cartCount = ref(0)
const cartBadge = computed(() => formatBadgeCount(cartCount.value))

async function refreshCartCount() {
  if (!isLoggedIn()) {
    cartCount.value = 0
    return
  }
  try {
    const c = await fetchCart()
    cartCount.value = c?.itemCount ?? 0
  }
  catch (e) {
    console.warn('[jp-product] refreshCartCount failed', e)
    cartCount.value = 0
  }
}

/* ── 交互 ────────────────────────────────────────────────── */

/** 加购中（防连点打出两笔累加）。 */
const adding = ref(false)

/**
 * 点「加入购物车」（GZ-JP-203 起是<b>真加购</b>）。
 *
 * <p>三步：场已结束先拦（置灰态兜底提示）→ {@code ensureLoggedIn}（购物车需登录，
 * 游客会弹协议同意 sheet；用户取消则什么也不做）→ {@code POST /app/gz/jp/cart}。</p>
 *
 * <p>成功后<b>停留在本页</b>只 toast + 刷新角标，不自动跳购物车 ——
 * 客人加一件通常还要接着挑下一件，跳走等于每加一件都要退回来一次。
 * 要去购物车走 CTA 条左侧那个入口（角标已经变了，看得见）。</p>
 *
 * <p>失败（商品刚被下架 / 场刚关 / 超上限 / 车里款数触顶）由 http.ts 统一 toast 后端原文，
 * 这里不再叠一层自己的提示 —— 后端的话比「加入失败」有用得多。</p>
 */
async function onAddToCart() {
  if (ctaDisabled.value) {
    uni.showToast({ title: t('product.endedToast'), icon: 'none' })
    return
  }
  if (adding.value || !product.value) {
    return
  }
  if (!(await ensureLoggedIn())) {
    return
  }
  adding.value = true
  try {
    await addToCart(String(product.value.id), quantity.value)
    uni.showToast({ title: t('product.addToCartSuccess'), icon: 'none' })
    await refreshCartCount()
  }
  catch (e) {
    console.warn('[jp-product] addToCart failed', e)
  }
  finally {
    adding.value = false
  }
}

/** 点 CTA 条左侧购物车入口 → 购物车页（业务主线真入口，不是临时入口）。 */
function goCart() {
  uni.navigateTo({ url: CART_ROUTE })
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

// 每次回到本页都刷角标（从购物车页删了东西再返回，角标要跟着降）
onShow(() => {
  void refreshCartCount()
})
</script>

<template>
  <BizScreen class="jp-screen">
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

        <!-- ⑥ 底部固定 CTA：购物车入口 + 数量 stepper + 加入购物车 -->
        <view class="jp-product-cta">
          <!-- 购物车入口（GZ-JP-203）：加购后角标就在旁边变，客人看得见「东西进去了」 -->
          <view class="jp-product-cta__cart" @tap="goCart">
            <text class="jp-product-cta__cart-icon">🛒</text>
            <text v-if="cartBadge" class="jp-product-cta__cart-badge">{{ cartBadge }}</text>
          </view>
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
/* 购物车入口（GZ-JP-203）：图标 + 右上角款数角标 */
.jp-product-cta__cart {
  position: relative;
  width: 72rpx;
  height: 72rpx;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--c-radius);
  background: rgba(33, 29, 23, 0.04);

  &:active {
    opacity: 0.7;
  }
}
.jp-product-cta__cart-icon {
  font-size: 36rpx;
  line-height: 1;
}
.jp-product-cta__cart-badge {
  position: absolute;
  top: -6rpx;
  right: -6rpx;
  min-width: 30rpx;
  height: 30rpx;
  padding: 0 6rpx;
  box-sizing: border-box;
  border-radius: var(--c-radius-pill);
  background: var(--c-red);
  color: var(--c-on-dark);
  font-size: var(--c-fs-3xs);
  font-weight: 700;
  line-height: 30rpx;
  text-align: center;
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
