<script lang="ts" setup>
/**
 * GZ-JP-205 — 我的订单列表（UI:mp.order_list）。
 *
 * <p>路由 {@code /pages/order/list?tab=created}（{@code buildOrderListRoute}）——
 * 支付结果页「未支付 / 已关闭」两个出口都跳这里的<b>待支付 tab</b>。</p>
 *
 * <p><b>卡片上刻意没有货态文案</b>（「运输中」「已签收」之类）：一单 30 款各自履约进度不同，
 * 列表卡只能回答「钱怎么样了」（订单级 businessStatus）。要看货到哪了点进详情，
 * 那里按履约状态分组。在列表卡上写一个货态 = 对 29 款撒谎。</p>
 *
 * <p><b>游客态不打接口</b>：订单端点必 401，直接渲染登录引导（与购物车同款处理）。</p>
 */
import type { GzJpOrderListItemVO } from '@/api/gz-jp/order'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { formatYuan } from '@/api/gz-jp/format'
import {
  buildOrderDetailRoute,
  fetchJpOrderList,
  ORDER_LIST_PAGE_SIZE,
} from '@/api/gz-jp/order'
import { useAuth } from '@/hooks/useAuth'
import { t } from '@/locale/order.zh-CN'
import {
  filterOrdersByTab,
  formatOrderTime,
  hasMore,
  moreCountOf,
  ORDER_TABS,
  parseOrderListQuery,
  requestStatusOf,
  resolveListPhase,
  visibleThumbs,
} from './list.logic'

defineOptions({ name: 'GzJpOrderList' })

definePage({
  style: {
    navigationBarTitleText: '我的订单',
  },
})

const { isLoggedIn, ensureLoggedIn } = useAuth()

/** 首页路由（空列表时的出口；首页是 tabbar 页，只能 switchTab）。 */
const HOME_ROUTE = '/pages/index/index'

/* ── 状态 ────────────────────────────────────────────────── */

const activeTab = ref('all')
const rows = ref<GzJpOrderListItemVO[]>([])
const total = ref(0)
const pageNum = ref(1)
const loading = ref(true)
const loadingMore = ref(false)
const loadFailed = ref(false)
const loggedIn = ref(false)

/* ── 取数 ────────────────────────────────────────────────── */

/**
 * 拉一页。
 *
 * @param reset true = 切 tab / 下拉刷新（回到第 1 页并替换数据）；false = 加载更多（追加）
 */
async function load(reset: boolean) {
  loggedIn.value = isLoggedIn()
  if (!loggedIn.value) {
    // 游客态：不打接口（必 401），直接渲染登录引导
    rows.value = []
    total.value = 0
    loading.value = false
    loadingMore.value = false
    loadFailed.value = false
    return
  }

  if (reset) {
    pageNum.value = 1
    loading.value = true
    loadFailed.value = false
  }
  else {
    loadingMore.value = true
  }

  try {
    const page = await fetchJpOrderList({
      pageNum: pageNum.value,
      pageSize: ORDER_LIST_PAGE_SIZE,
      businessStatus: requestStatusOf(activeTab.value),
    })
    // ★ 分页端点读 rows 不是 data（http.ts 已识别 TableDataInfo 直返整对象）
    const list = Array.isArray(page?.rows) ? page.rows : []
    rows.value = reset ? list : [...rows.value, ...list]
    total.value = Number(page?.total ?? 0)
    loadFailed.value = false
  }
  catch (e) {
    console.warn('[jp-order-list] load failed', e)
    // 翻页失败不擦掉已经看到的订单（只有首屏才进整页 error 态）
    if (reset) {
      rows.value = []
      total.value = 0
      loadFailed.value = true
    }
  }
  finally {
    loading.value = false
    loadingMore.value = false
  }
}

/* ── 展示派生 ────────────────────────────────────────────── */

/** 当前 tab 要显示的订单（只有「已完成」需要前端二次筛，见 list.logic 注释）。 */
const visibleRows = computed(() => filterOrdersByTab(rows.value, activeTab.value))

const phase = computed(() => resolveListPhase(loading.value, loadFailed.value, visibleRows.value.length))

/** 还能不能再翻一页（按后端 total 与已加载原始条数比，不按筛后的条数）。 */
const canLoadMore = computed(() => hasMore(rows.value.length, total.value))

/** 卡片展示模型（把逻辑层的派生一次算好，模板里不做计算）。 */
interface OrderCard {
  id: string
  orderNo: string
  timeText: string
  statusLabel: string
  amountYuan: string
  itemCount: number
  totalQty: number
  thumbs: string[]
  moreCount: number
}

const cards = computed<OrderCard[]>(() => visibleRows.value.map((r) => {
  const thumbs = visibleThumbs(r.thumbUrls)
  return {
    id: String(r.id),
    orderNo: String(r.orderNo ?? ''),
    timeText: formatOrderTime(r.createTime),
    statusLabel: String(r.businessStatusLabel ?? ''),
    amountYuan: formatYuan(r.totalAmountCent),
    itemCount: Number(r.itemCount ?? 0),
    totalQty: Number(r.totalQty ?? 0),
    thumbs,
    moreCount: moreCountOf(r.itemCount, thumbs.length),
  }
}))

/* ── 交互 ────────────────────────────────────────────────── */

function onTab(key: string) {
  if (activeTab.value === key) {
    return
  }
  activeTab.value = key
  rows.value = []
  void load(true)
}

function onLoadMore() {
  if (loadingMore.value || !canLoadMore.value) {
    return
  }
  pageNum.value += 1
  void load(false)
}

function goDetail(orderId: string) {
  uni.navigateTo({ url: buildOrderDetailRoute(orderId) })
}

/** 游客态点「微信登录」→ 协议同意 sheet → 登录成功后立刻拉单。 */
async function onLogin() {
  if (await ensureLoggedIn()) {
    await load(true)
  }
}

function goHome() {
  uni.switchTab({ url: HOME_ROUTE })
}

/* ── 生命周期 ────────────────────────────────────────────── */

onLoad((options?: Record<string, string>) => {
  // 支付结果页跳回来带 ?tab=created（后端状态原值，不经前端映射表）
  activeTab.value = parseOrderListQuery(options).tab
})

// onShow 而非 onLoad 取数：从详情页返回时状态可能已变（付了款 / 被关单）
onShow(() => {
  void load(true)
})
</script>

<template>
  <BizScreen class="jp-screen">
    <view class="jp-odl">
      <!-- tab 条 -->
      <view class="jp-odl__tabs">
        <view
          v-for="tab in ORDER_TABS"
          :key="tab.key"
          class="jp-odl__tab"
          :class="{ 'is-on': activeTab === tab.key }"
          @tap="onTab(tab.key)"
        >
          <text class="jp-odl__tab-text">{{ t(tab.labelKey) }}</text>
        </view>
      </view>

      <!-- 游客态：登录引导（不打接口） -->
      <view v-if="!loggedIn" class="jp-pad jp-odl__state">
        <BizPanel pad>
          <BizState
            variant="empty"
            emoji="🔑"
            :text="t('order.listNeedLogin')"
            :sub="t('order.listNeedLoginSub')"
            :cta-text="t('order.listNeedLoginCta')"
            @cta="onLogin"
          />
        </BizPanel>
      </view>

      <template v-else>
        <!-- 首屏加载中 -->
        <view v-if="phase === 'loading'" class="jp-pad jp-odl__state">
          <BizPanel pad>
            <BizState variant="loading" :text="t('order.listLoading')" />
          </BizPanel>
        </view>

        <!-- 加载失败 -->
        <view v-else-if="phase === 'error'" class="jp-pad jp-odl__state">
          <BizPanel pad>
            <BizState
              variant="error"
              :text="t('order.listError')"
              :sub="t('order.listErrorSub')"
              :cta-text="t('order.listErrorCta')"
              @cta="load(true)"
            />
          </BizPanel>
        </view>

        <!-- 空 -->
        <view v-else-if="phase === 'empty'" class="jp-pad jp-odl__state">
          <BizPanel pad>
            <BizState
              variant="empty"
              emoji="📭"
              :text="t('order.listEmpty')"
              :sub="t('order.listEmptySub')"
              :cta-text="t('order.listEmptyCta')"
              @cta="goHome"
            />
          </BizPanel>
        </view>

        <!-- 订单卡片列表 -->
        <view v-else class="jp-pad jp-odl__list">
          <view
            v-for="card in cards"
            :key="card.id"
            class="jp-odl__card"
            @tap="goDetail(card.id)"
          >
            <BizPanel small>
              <!-- 卡头：订单号 + 下单时间 + 订单状态 -->
              <view class="jp-odl__head">
                <view class="jp-odl__head-l">
                  <text class="jp-odl__no">{{ t('order.cardOrderNoPrefix') }}{{ card.orderNo }}</text>
                  <text class="jp-odl__time">{{ card.timeText }}</text>
                </view>
                <text class="jp-odl__status">{{ card.statusLabel }}</text>
              </view>

              <!-- 商品缩略图（前 N 张 + 「+N」） -->
              <view class="jp-odl__thumbs">
                <view
                  v-for="(url, i) in card.thumbs"
                  :key="i"
                  class="jp-odl__thumb"
                >
                  <image class="jp-odl__thumb-img" :src="url" mode="aspectFill" />
                </view>
                <!-- 一张图都没有时给个占位块，别让卡片塌成两行文字 -->
                <view v-if="!card.thumbs.length" class="jp-odl__thumb">
                  <view class="jp-odl__thumb-ph">
                    <text class="jp-odl__thumb-emoji">🧸</text>
                  </view>
                </view>
                <view v-if="card.moreCount > 0" class="jp-odl__more-count">
                  <text class="jp-odl__more-text">{{ t('order.cardMorePrefix') }}{{ card.moreCount }}</text>
                </view>
              </view>

              <!-- 卡尾：款数 / 件数 + 实付 -->
              <view class="jp-odl__foot">
                <text class="jp-odl__count">
                  {{ t('order.cardItemCountPrefix') }}{{ card.itemCount }}{{ t('order.cardItemCountSuffix') }}
                  {{ t('order.cardTotalQtyPrefix') }}{{ card.totalQty }}{{ t('order.cardTotalQtySuffix') }}
                </text>
                <view class="jp-odl__pay">
                  <text class="jp-odl__pay-label">{{ t('order.cardPayLabel') }}</text>
                  <text class="jp-odl__cur">{{ t('order.currency') }}</text>
                  <text class="jp-odl__amount">{{ card.amountYuan }}</text>
                </view>
              </view>
            </BizPanel>
          </view>

          <!-- 分页 -->
          <view v-if="canLoadMore" class="jp-odl__more" @tap="onLoadMore">
            <text class="jp-odl__more-txt">
              {{ loadingMore ? t('order.listLoadingMore') : t('order.listLoadMore') }}
            </text>
          </view>
          <view v-else-if="cards.length" class="jp-odl__more is-end">
            <text class="jp-odl__more-txt">{{ t('order.listNoMore') }}</text>
          </view>
        </view>
      </template>
    </view>
  </BizScreen>
</template>

<style lang="scss" scoped>
.jp-pad {
  padding: 0 var(--c-gap-page);
}

/* ── tab 条 ── */
.jp-odl__tabs {
  display: flex;
  align-items: center;
  padding: 0 var(--c-gap-page);
  gap: 8rpx;
  background: var(--c-surface);
  border-bottom: 2rpx solid var(--c-line);
}
.jp-odl__tab {
  flex: 1;
  height: 84rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.jp-odl__tab-text {
  font-size: var(--c-fs-sm);
  color: var(--c-ink-2);
}
.jp-odl__tab.is-on .jp-odl__tab-text {
  font-size: var(--c-fs-body);
  font-weight: 700;
  color: var(--c-red);
}
/* 选中态下划线（不用整块变色，太吵） */
.jp-odl__tab.is-on::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 48rpx;
  height: 6rpx;
  border-radius: 6rpx;
  background: var(--c-red);
}

.jp-odl__state {
  padding-top: 32rpx;
}

/* ── 卡片列表 ── */
.jp-odl__list {
  padding-top: 20rpx;
  padding-bottom: 40rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.jp-odl__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16rpx;
  padding: 20rpx var(--c-gap-card) 12rpx;
}
.jp-odl__head-l {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  min-width: 0;
}
.jp-odl__no {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
  font-variant-numeric: tabular-nums;
}
.jp-odl__time {
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-3);
  font-variant-numeric: tabular-nums;
}
.jp-odl__status {
  flex-shrink: 0;
  font-size: var(--c-fs-sm);
  font-weight: 700;
  color: var(--c-red);
}

/* ── 缩略图排 ── */
.jp-odl__thumbs {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 0 var(--c-gap-card) 16rpx;
}
.jp-odl__thumb {
  width: 128rpx;
  height: 128rpx;
  flex-shrink: 0;
  border-radius: var(--c-radius);
  overflow: hidden;
  background: var(--c-bg);
}
.jp-odl__thumb-img {
  display: block;
  width: 128rpx;
  height: 128rpx;
}
.jp-odl__thumb-ph {
  width: 128rpx;
  height: 128rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--c-tint-blue), var(--c-tint-pink));
}
.jp-odl__thumb-emoji {
  font-size: 48rpx;
  line-height: 1;
  opacity: 0.7;
}
.jp-odl__more-count {
  width: 72rpx;
  height: 128rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.jp-odl__more-text {
  font-size: var(--c-fs-sm);
  color: var(--c-ink-3);
  font-variant-numeric: tabular-nums;
}

/* ── 卡尾 ── */
.jp-odl__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 0 var(--c-gap-card) 20rpx;
}
.jp-odl__count {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
}
.jp-odl__pay {
  display: flex;
  align-items: baseline;
  gap: 4rpx;
}
.jp-odl__pay-label {
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-3);
}
.jp-odl__cur {
  font-size: var(--c-fs-xs);
  font-weight: 700;
  color: var(--c-red);
}
.jp-odl__amount {
  font-size: var(--c-fs-lg);
  font-weight: 700;
  color: var(--c-red);
  font-variant-numeric: tabular-nums;
}

/* ── 分页 ── */
.jp-odl__more {
  height: 80rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.jp-odl__more-txt {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-3);
}
.jp-odl__more.is-end .jp-odl__more-txt {
  color: var(--c-ink-4, var(--c-ink-3));
}
</style>
