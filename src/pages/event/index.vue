<script lang="ts" setup>
import type { EventHeaderTiming, EventPhase } from './index.logic'
/**
 * GZ-JP-202 — 场详情 / 本场商品列表。UI:mp.event_detail。
 *
 * <p>路由 {@code /pages/event/index?id=<场主键>&eventNo=<场编号>}（GZ-JP-201 首页场卡生成，
 * 见 index.logic.ts 的 {@code buildEventRoute}）。<b>id 用来调接口</b>（后端只提供按主键查），
 * <b>eventNo 用来展示 / 分享 / 客服对单</b>，两个都收。</p>
 *
 * <p>自上而下：</p>
 * <ol>
 *   <li><b>场信息头</b> —— 封面 / 名称 / 场编号 / 状态标签 / 倒计时（进行中）或开场·结束时刻</li>
 *   <li><b>已结束提示条</b> —— 仅 {@code status==='closed'} 时出现，说明「商品仍可浏览、不能加购」</li>
 *   <li><b>商品两列网格</b> —— 主图 + 名称 + 价格（标包邮）+ 预计到货，上拉加载下一页</li>
 * </ol>
 *
 * <p><b>一期不做筛选、不做排序</b>（任务卡明确）：后端已按 {@code sort_no} 排好，前端不二次排序。</p>
 *
 * <p><b>游客优先</b>：场与商品都是匿名可读（后端 &#64;SaIgnore），整页不需要登录态；
 * 加购才需要登录，而加购归 GZ-JP-104/203。</p>
 *
 * <p>关联蓝图：UI:mp.event_detail / UI:mp.event_detail.product_grid / REQ-EVENT-001 / REQ-PROD-001</p>
 */
import type { GzJpEventMpVO } from '@/api/gz-jp/event'
import type { GzJpProductMpVO } from '@/api/gz-jp/product'
import { onLoad, onReachBottom, onUnload } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { fetchEventDetail } from '@/api/gz-jp/event'
import { formatHms, formatYuan, hasRealCover } from '@/api/gz-jp/format'
import { EVENT_PRODUCT_PAGE_SIZE, fetchProductList } from '@/api/gz-jp/product'
import { t } from '@/locale/event.zh-CN'
import { t as tp } from '@/locale/product.zh-CN'
import {
  buildHeaderTiming,
  buildProductRoute,
  eventPhase,
  hasMoreProducts,
  HOME_ROUTE,
  mergeProductPage,
} from './index.logic'

defineOptions({ name: 'GzJpEventDetail' })

definePage({
  style: {
    navigationBarTitleText: '场详情',
  },
})

/* ── 路由参数 ─────────────────────────────────────────────── */

const eventId = ref('')
/** 场编号（业务码，展示 / 客服对单用；接口一律用 id） */
const eventNoFromRoute = ref('')

/* ── 场本体 ──────────────────────────────────────────────── */

const event = ref<GzJpEventMpVO | null>(null)
const eventLoading = ref(true)
const eventFailed = ref(false)

/**
 * 倒计时时基。每秒 tick 一次驱动页头倒计时重算。
 * 用 ref 而不是在 computed 里读 Date.now()：computed 读实时时钟会让结果随渲染时机漂移，
 * 且无法在排障时复现（同 GZ-JP-201 首页的处理）。
 */
const nowMs = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null

/** 展示态：进行中 / 即将开始 / 已结束（★ 不是下单闸门，加购看 eventBookable）。 */
const phase = computed<EventPhase>(() => eventPhase(event.value, nowMs.value))
const timing = computed<EventHeaderTiming>(() => buildHeaderTiming(event.value, phase.value, nowMs.value))

/** 场已结束（页头提示条 + 商品卡降饱和的依据）。 */
const eventEnded = computed(() => event.value?.status === 'closed')

const PHASE_LABEL_KEY: Record<EventPhase, string> = {
  live: 'event.statusLive',
  upcoming: 'event.statusUpcoming',
  ended: 'event.statusEnded',
}
const phaseLabel = computed(() => t(PHASE_LABEL_KEY[phase.value]))
const PHASE_TAG_TYPE = { live: 'red', upcoming: 'yellow', ended: 'ink' } as const
const phaseTagType = computed(() => PHASE_TAG_TYPE[phase.value])

/** 页头时间行整句（i18n 归页面，纯逻辑层只给 {kind, at, parts}）。 */
const timingText = computed(() => {
  const v = timing.value
  switch (v.kind) {
    case 'countdown': {
      const d = v.parts?.days ?? 0
      const day = d > 0 ? `${d}${t('event.countdownDayUnit')} ` : ''
      return `${t('event.countdownPrefix')} ${day}${formatHms(v.parts)}`
    }
    case 'start':
      return `${v.at} ${t('event.timingStart')}`
    case 'endedAt':
      return `${t('event.timingEndedPrefix')} ${v.at} ${t('event.timingEndedSuffix')}`
    default:
      return ''
  }
})

/** 封面：后端无图会回落一个 mp 侧并不存在的占位路径，一律当无封面处理。 */
const coverUrl = computed(() =>
  hasRealCover(event.value?.coverImageUrl) ? String(event.value?.coverImageUrl) : '')
const coverFailed = ref(false)
const showCover = computed(() => !!coverUrl.value && !coverFailed.value)

/** 展示用场编号：优先后端返回的，取不到时退回路由带来的。 */
const displayEventNo = computed(() => event.value?.eventNo || eventNoFromRoute.value)

/* ── 商品列表（分页）─────────────────────────────────────── */

const products = ref<GzJpProductMpVO[]>([])
const productTotal = ref(0)
const productLoading = ref(true)
const productFailed = ref(false)
const loadingMore = ref(false)
/** 已请求到第几页（下一页 = pageNum + 1） */
const pageNum = ref(0)

const hasMore = computed(() => hasMoreProducts(products.value.length, productTotal.value))

/* ── 取数 ────────────────────────────────────────────────── */

async function loadEvent(id: string) {
  eventLoading.value = true
  eventFailed.value = false
  try {
    event.value = await fetchEventDetail(id)
    nowMs.value = Date.now()
  }
  catch (e) {
    // 场不存在 / 未开场(draft) → 后端 R.fail，http.ts 已 toast，这里只切失败态
    console.warn('[jp-event] loadEvent failed', e)
    eventFailed.value = true
    event.value = null
  }
  finally {
    eventLoading.value = false
  }
}

/**
 * 拉一页商品。
 *
 * @param id      场主键
 * @param next    要拉的页码
 * @param append  true = 上拉加载（追加并去重）；false = 首屏（覆盖）
 */
async function loadProducts(id: string, next: number, append: boolean) {
  if (append) {
    loadingMore.value = true
  }
  else {
    productLoading.value = true
    productFailed.value = false
  }
  try {
    // 分页端点返回 { rows, total }（http.ts 对 TableDataInfo 直返整对象，不是 .data）
    const page = await fetchProductList(id, { pageNum: next, pageSize: EVENT_PRODUCT_PAGE_SIZE })
    const rows = page?.rows ?? []
    products.value = append ? mergeProductPage(products.value, rows) : mergeProductPage([], rows)
    productTotal.value = page?.total ?? 0
    pageNum.value = next
  }
  catch (e) {
    console.warn('[jp-event] loadProducts failed', e)
    if (!append) {
      productFailed.value = true
      products.value = []
      productTotal.value = 0
    }
    // 上拉加载失败不清空已渲染的前几页（用户滚了半天不该被清屏），
    // 也不前移 pageNum —— 下次触底会重试同一页
  }
  finally {
    productLoading.value = false
    loadingMore.value = false
  }
}

/** 首屏 / 重试：场与商品并行拉，互不影响（场挂了商品照样能显示，反之亦然）。 */
async function reload() {
  const id = eventId.value
  if (!id) {
    return
  }
  pageNum.value = 0
  await Promise.all([loadEvent(id), loadProducts(id, 1, false)])
}

function retryProducts() {
  void loadProducts(eventId.value, 1, false)
}

/* ── 交互 ────────────────────────────────────────────────── */

/** 点商品卡 → 商品详情（第 2 跳；首页 → 场详情 → 商品详情）。 */
function onProductTap(product: GzJpProductMpVO) {
  uni.navigateTo({ url: buildProductRoute(product) })
}

/** 场取数失败时的兜底出口（首页是 tabbar 页，只能 switchTab）。 */
function backHome() {
  uni.switchTab({ url: HOME_ROUTE })
}

/** 商品卡展示字段（价格已格式化成元的纯数字串，无价则空串 → 卡片显示「价格待定」）。 */
function cardImage(p: GzJpProductMpVO): string {
  return hasRealCover(p.mainImageUrl) ? String(p.mainImageUrl) : ''
}
function cardPrice(p: GzJpProductMpVO): string {
  return formatYuan(p.priceCent)
}
function cardDelivery(p: GzJpProductMpVO): string {
  const v = (p.deliveryDateText ?? '').trim()
  return v ? `${tp('product.deliveryLabel')} ${v}` : ''
}

/* ── 生命周期 ────────────────────────────────────────────── */

onLoad((query?: Record<string, string | undefined>) => {
  const id = String(query?.id ?? '')
  eventNoFromRoute.value = String(query?.eventNo ?? '')
  if (!id) {
    // 没带 id 进来（手改路由 / 分享链接被截断）→ 直接失败态，不打无意义的请求
    eventLoading.value = false
    productLoading.value = false
    eventFailed.value = true
    return
  }
  eventId.value = id
  void reload()
  // 倒计时每秒 tick；页面卸载时清掉（不清会在后台空转、并持有页面引用）
  tickTimer = setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
})

onUnload(() => {
  if (tickTimer) {
    clearInterval(tickTimer)
    tickTimer = null
  }
})

/** 上拉触底 → 加载下一页（UI:mp.event_detail.product_grid「上拉分页」）。 */
onReachBottom(() => {
  if (!hasMore.value || loadingMore.value || productLoading.value) {
    return
  }
  void loadProducts(eventId.value, pageNum.value + 1, true)
})
</script>

<template>
  <BizScreen>
    <view class="jp-event-detail">
      <!-- ① 场信息头 -->
      <view v-if="eventLoading" class="jp-pad jp-event-detail__head">
        <BizPanel>
          <BizState variant="loading" :text="t('event.productLoading')" />
        </BizPanel>
      </view>

      <view v-else-if="eventFailed" class="jp-pad jp-event-detail__head">
        <BizPanel>
          <BizState
            variant="error"
            :text="t('event.eventError')"
            :sub="t('event.eventErrorSub')"
            :cta-text="t('event.backHome')"
            @cta="backHome"
          />
        </BizPanel>
      </view>

      <template v-else-if="event">
        <view class="jp-pad jp-event-detail__head">
          <BizPanel>
            <view class="jp-event-detail__cover">
              <image
                v-if="showCover"
                class="jp-event-detail__cover-img"
                :src="coverUrl"
                mode="aspectFill"
                @error="coverFailed = true"
              />
              <view v-else class="jp-event-detail__cover-ph">
                <text class="jp-event-detail__cover-emoji">🎏</text>
              </view>
            </view>
            <view class="jp-event-detail__info">
              <view class="jp-event-detail__title-row">
                <text class="jp-event-detail__name">{{ event.name }}</text>
                <BizTag :type="phaseTagType">
                  {{ phaseLabel }}
                </BizTag>
              </view>
              <text v-if="event.description" class="jp-event-detail__desc">{{ event.description }}</text>
              <text v-if="timingText" class="jp-event-detail__timing">{{ timingText }}</text>
              <text v-if="displayEventNo" class="jp-event-detail__no">{{ displayEventNo }}</text>
            </view>
          </BizPanel>
        </view>

        <!-- ② 已结束提示条（场已结束时商品仍可浏览，加购入口置灰 —— AC） -->
        <view v-if="eventEnded" class="jp-pad jp-event-detail__ended-bar">
          <view class="jp-event-detail__ended-inner">
            <text class="jp-event-detail__ended-text">{{ t('event.endedBanner') }}</text>
          </view>
        </view>
      </template>

      <!-- ③ 商品两列网格 -->
      <view class="section-title-wrap">
        <BizSectionTitle :title="t('event.productSectionTitle')" />
      </view>

      <view class="jp-event-detail__grid">
        <view v-if="productLoading" class="jp-pad">
          <BizPanel>
            <BizState variant="loading" :text="t('event.productLoading')" />
          </BizPanel>
        </view>

        <view v-else-if="productFailed" class="jp-pad">
          <BizPanel>
            <BizState
              variant="error"
              :text="t('event.productError')"
              :sub="t('event.productErrorSub')"
              :cta-text="t('event.retry')"
              @cta="retryProducts"
            />
          </BizPanel>
        </view>

        <view v-else-if="!products.length" class="jp-pad">
          <BizPanel>
            <BizState
              variant="empty"
              emoji="📦"
              :text="t('event.productEmpty')"
              :sub="t('event.productEmptySub')"
            />
          </BizPanel>
        </view>

        <template v-else>
          <view class="jp-pad jp-event-detail__count">
            <text class="jp-event-detail__count-text">
              {{ t('event.productCountPrefix') }} {{ productTotal }} {{ t('event.productCountSuffix') }}
            </text>
          </view>
          <view class="jp-pad jp-event-detail__cols">
            <view
              v-for="product in products"
              :key="product.id"
              class="jp-event-detail__col"
            >
              <BizProductCard
                :name="product.name"
                :image="cardImage(product)"
                :price="cardPrice(product)"
                :currency="tp('product.currency')"
                :price-tbd-label="tp('product.priceTbd')"
                :free-shipping-label="tp('product.shippingFree')"
                :delivery-text="cardDelivery(product)"
                :ended="!product.eventBookable"
                :ended-label="t('event.statusEnded')"
                @tap="onProductTap(product)"
              />
            </view>
          </view>
          <view class="jp-pad jp-event-detail__more">
            <text class="jp-event-detail__more-text">
              {{ loadingMore ? t('event.loadingMore') : (hasMore ? '' : t('event.noMore')) }}
            </text>
          </view>
        </template>
      </view>
    </view>
  </BizScreen>
</template>

<style lang="scss" scoped>
/* 页面左右内边距（不用 .block —— 与 UnoCSS 的 display:block 工具类同名会撞） */
.jp-pad {
  padding: 0 var(--c-gap-page);
}
.jp-event-detail__head {
  padding-top: 24rpx;
}
/* 区块标题上方统一留白 */
.section-title-wrap {
  padding-top: 32rpx;
}
.section-title-wrap :deep(.biz-section-title) {
  padding-bottom: 12rpx;
}

/* ── 场信息头 ── */
.jp-event-detail__cover {
  width: 100%;
  height: 320rpx;
  border-radius: var(--c-radius-card) var(--c-radius-card) 0 0;
  overflow: hidden;
  background: var(--c-tint-green);
}
.jp-event-detail__cover-img {
  display: block;
  width: 100%;
  height: 320rpx;
}
.jp-event-detail__cover-ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--c-tint-green), var(--c-tint-yellow));
}
.jp-event-detail__cover-emoji {
  font-size: 96rpx;
  line-height: 1;
  opacity: 0.7;
}
.jp-event-detail__info {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  padding: var(--c-gap-card);
}
.jp-event-detail__title-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.jp-event-detail__name {
  flex: 1;
  min-width: 0;
  font-size: var(--c-fs-h1);
  font-weight: 700;
  color: var(--c-ink);
}
.jp-event-detail__desc {
  font-size: var(--c-fs-sm);
  color: var(--c-ink-2);
  line-height: 1.5;
}
.jp-event-detail__timing {
  font-size: var(--c-fs-body);
  font-weight: 600;
  color: var(--c-red);
  font-variant-numeric: tabular-nums;
}
.jp-event-detail__no {
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-3);
  font-family: var(--c-font-mono);
}

/* ── 已结束提示条 ── */
.jp-event-detail__ended-bar {
  padding-top: 16rpx;
}
.jp-event-detail__ended-inner {
  padding: 18rpx var(--c-gap-card);
  border-radius: var(--c-radius);
  background: var(--c-amber-soft);
}
.jp-event-detail__ended-text {
  font-size: var(--c-fs-sm);
  font-weight: 600;
  color: #b5791a;
  line-height: 1.5;
}

/* ── 商品两列网格 ── */
.jp-event-detail__count {
  padding-bottom: 12rpx;
}
.jp-event-detail__count-text {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-3);
}
.jp-event-detail__cols {
  display: flex;
  flex-wrap: wrap;
  gap: var(--c-gap);
}
/* 两列：减去列间距后各占一半 */
.jp-event-detail__col {
  width: calc((100% - var(--c-gap)) / 2);
}
.jp-event-detail__more {
  padding-top: 24rpx;
  padding-bottom: 48rpx;
  display: flex;
  justify-content: center;
}
.jp-event-detail__more-text {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-3);
}
</style>
