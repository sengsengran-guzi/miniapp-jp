<script lang="ts" setup>
import type { RefundDisplayKind } from './detail.logic'
/**
 * GZ-JP-205 — 订单详情（UI:mp.order_detail + UI:mp.order_detail.status_group）。
 *
 * <p>路由 {@code /pages/order/detail?id=<订单主键>}（{@code buildOrderDetailRoute}）。</p>
 *
 * <p><b>★ 商品行按履约状态分组，不平铺</b>（Kevin 拍板方案 A）：一单可能 30 款，逐款状态
 * 各自独立。平铺时同一个运单号会重复十几次；分组后<b>运单号只在组头出现一次</b>，
 * 客人一眼看到「发货完毕 12 款 / 顺丰速运 SF7654321000 [复制]」。
 * 分组与排序全在 {@code detail.logic.ts}（纯函数，vitest 直接跑）。</p>
 *
 * <p><b>★ 客人不感知我们内部怎么装箱</b>（REQ-FULFILL-006）：分组依据只有
 * <b>履约状态 + 运单号</b>，全页不出现任何表达装箱单位的词。这条由 accept #3 的 grep 守着，
 * 中英文都不放过 —— 所以本文件<b>连注释里也不能写那个词</b>（禁的是哪个词见
 * {@code detail.logic.ts} 顶注，那个文件不在 grep 范围内）。</p>
 *
 * <p><b>订单头的状态不盖行状态</b>（ADR-0020 §1：订单只管钱、行才管货）：
 * 订单显示「部分退款」时，没失败的行仍在正常发货 —— 两者各说各的，不互相覆盖。</p>
 */
import type { GzJpOrderDetailVO } from '@/api/gz-jp/order'
import { onLoad } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { formatYuan } from '@/api/gz-jp/format'
import { buildOrderListRoute, fetchJpOrderDetail } from '@/api/gz-jp/order'
import { t } from '@/locale/order.zh-CN'
import {
  groupHeaderText,
  groupItemsByFulfillStatus,
  parseOrderDetailQuery,
  resolveRefundDisplay,
} from './detail.logic'

defineOptions({ name: 'GzJpOrderDetail' })

definePage({
  style: {
    navigationBarTitleText: '订单详情',
  },
})

/* ── 取数 ────────────────────────────────────────────────── */

const orderId = ref('')
const detail = ref<GzJpOrderDetailVO | null>(null)
const loading = ref(true)
const loadFailed = ref(false)

async function reload() {
  if (!orderId.value) {
    loading.value = false
    loadFailed.value = true
    return
  }
  loading.value = true
  loadFailed.value = false
  try {
    detail.value = await fetchJpOrderDetail(orderId.value)
  }
  catch (e) {
    // 4105（不存在 / 不是本人）与网络失败在这里不区分：都渲染「找不到这张订单」+ 出口，
    // 不把「这单不是你的」说给客人听（后端也是同码不泄漏）
    console.warn('[jp-order-detail] load failed', e)
    loadFailed.value = true
    detail.value = null
  }
  finally {
    loading.value = false
  }
}

/* ── 订单头 ──────────────────────────────────────────────── */

const orderNo = computed(() => detail.value?.orderNo ?? '')
const statusLabel = computed(() => detail.value?.businessStatusLabel ?? '')
const amountYuan = computed(() => formatYuan(detail.value?.totalAmountCent))
const itemCount = computed(() => Number(detail.value?.itemCount ?? 0))
const totalQty = computed(() => Number(detail.value?.totalQty ?? 0))
const createTime = computed(() => detail.value?.createTime ?? '')
const paidTime = computed(() => detail.value?.paidTime ?? '')
const address = computed(() => detail.value?.address ?? null)
const userNote = computed(() => String(detail.value?.userNote ?? '').trim())

/** 收货地址一行展示（省市区连写，详细地址跟后面）。 */
const addressLine = computed(() => {
  const a = address.value
  if (!a) {
    return ''
  }
  return `${a.province ?? ''}${a.city ?? ''}${a.district ?? ''} ${a.detail ?? ''}`.trim()
})

/* ── ★ 商品行分组 ────────────────────────────────────────── */

/** 一行商品的展示模型（模板里不做计算）。 */
interface DetailRow {
  key: string
  name: string
  image: string
  priceYuan: string
  qty: number
  qtyText: string
  /** 退款展示态（none 时不渲染退款行） */
  refundKind: RefundDisplayKind
  /** 退款主文案（已退款 ¥xx / 退款处理中） */
  refundText: string
  /** 额外的客服出口（只有 refund_failed 有） */
  refundSupport: string
}

/** 一个分组的展示模型。 */
interface DetailGroup {
  key: string
  /** 组头「<状态> N 款」 */
  headerText: string
  isFailed: boolean
  /** ★ 本组共用运单号（只在组头下方出现一次） */
  trackingNo: string
  /** 快递中文名（未知编码 → 兜底词） */
  carrierName: string
  rows: DetailRow[]
}

const groups = computed<DetailGroup[]>(() =>
  groupItemsByFulfillStatus(detail.value?.items).map(g => ({
    key: g.key,
    headerText: groupHeaderText(g, t('order.groupUnit')),
    isFailed: g.isFailed,
    trackingNo: g.trackingNo ?? '',
    carrierName: g.carrierName || t('order.trackingCarrierFallback'),
    rows: g.items.map((it) => {
      const refund = resolveRefundDisplay(it.refundStatus, it.refundAmountCent)
      return {
        key: String(it.id),
        name: String(it.name ?? ''),
        image: String(it.mainImageUrl ?? ''),
        priceYuan: formatYuan(it.amountCent),
        qty: Number(it.qty ?? 0),
        qtyText: `${t('order.detailItemQtyPrefix')}${Number(it.qty ?? 0)}`,
        refundKind: refund.kind,
        refundText: refund.kind === 'refunded'
          // ★ 只有真退到账才给具体金额（退款中金额还可能变，见 detail.logic 注释）
          ? `${t('order.refundRefundedPrefix')}${t('order.currency')}${formatYuan(refund.amountCent)}`
          : t('order.refundProcessing'),
        refundSupport: refund.needsSupport ? t('order.refundContactSupport') : '',
      }
    }),
  })),
)

/* ── 交互 ────────────────────────────────────────────────── */

/**
 * 复制运单号 —— {@code uni.setClipboardData}，<b>不引外部库</b>（AC）。
 */
function copyTracking(no: string) {
  const value = String(no ?? '').trim()
  if (!value) {
    return
  }
  uni.setClipboardData({
    data: value,
    success: () => uni.showToast({ title: t('order.trackingCopied'), icon: 'none' }),
  })
}

/** 找不到订单时的出口（不留死页）。 */
function goOrderList() {
  uni.redirectTo({ url: buildOrderListRoute('all') })
}

/* ── 生命周期 ────────────────────────────────────────────── */

onLoad((options?: Record<string, string>) => {
  orderId.value = parseOrderDetailQuery(options).orderId
  void reload()
})
</script>

<template>
  <BizScreen class="jp-screen">
    <view class="jp-odt">
      <!-- 加载中 -->
      <view v-if="loading" class="jp-pad jp-odt__state">
        <BizPanel pad>
          <BizState variant="loading" :text="t('order.detailLoading')" />
        </BizPanel>
      </view>

      <!-- 拉不到（不存在 / 不是本人 / 网络失败，一律同一句） -->
      <view v-else-if="loadFailed || !detail" class="jp-pad jp-odt__state">
        <BizPanel pad>
          <BizState
            variant="error"
            :text="t('order.detailNotFound')"
            :sub="t('order.detailNotFoundSub')"
            :cta-text="t('order.detailNotFoundCta')"
            @cta="goOrderList"
          />
        </BizPanel>
      </view>

      <template v-else>
        <!-- ── 订单头 ── -->
        <view class="jp-pad jp-odt__sec">
          <BizPanel small>
            <view class="jp-odt__head">
              <text class="jp-odt__status">{{ statusLabel }}</text>
              <view class="jp-odt__pay">
                <text class="jp-odt__pay-label">{{ t('order.detailAmountLabel') }}</text>
                <text class="jp-odt__cur">{{ t('order.currency') }}</text>
                <text class="jp-odt__amount">{{ amountYuan }}</text>
              </view>
            </view>
            <view class="jp-odt__meta">
              <view class="jp-odt__meta-row">
                <text class="jp-odt__meta-label">{{ t('order.detailOrderNoLabel') }}</text>
                <text class="jp-odt__meta-val">{{ orderNo }}</text>
              </view>
              <view class="jp-odt__meta-row">
                <text class="jp-odt__meta-label">{{ t('order.detailQtyLabel') }}</text>
                <text class="jp-odt__meta-val">
                  {{ itemCount }}{{ t('order.groupUnit') }} · {{ totalQty }}{{ t('order.detailQtySuffix') }}
                </text>
              </view>
              <view v-if="createTime" class="jp-odt__meta-row">
                <text class="jp-odt__meta-label">{{ t('order.detailCreateTimeLabel') }}</text>
                <text class="jp-odt__meta-val">{{ createTime }}</text>
              </view>
              <view v-if="paidTime" class="jp-odt__meta-row">
                <text class="jp-odt__meta-label">{{ t('order.detailPaidTimeLabel') }}</text>
                <text class="jp-odt__meta-val">{{ paidTime }}</text>
              </view>
            </view>
          </BizPanel>
        </view>

        <!-- ── 收货地址 ── -->
        <view v-if="address" class="jp-pad jp-odt__sec">
          <BizPanel small>
            <view class="jp-odt__addr">
              <text class="jp-odt__addr-title">{{ t('order.detailAddressTitle') }}</text>
              <view class="jp-odt__addr-line">
                <text class="jp-odt__addr-name">{{ address.recipient }}</text>
                <text class="jp-odt__addr-mobile">{{ address.mobile }}</text>
              </view>
              <text class="jp-odt__addr-detail">{{ addressLine }}</text>
            </view>
          </BizPanel>
        </view>

        <!-- ══ ★ 商品进度：按履约状态分组 ══ -->
        <view class="jp-pad jp-odt__sec">
          <BizSectionTitle :title="t('order.detailItemsTitle')" />
        </view>

        <view
          v-for="group in groups"
          :key="group.key"
          class="jp-pad jp-odt__sec jp-odt__group"
        >
          <BizPanel small>
            <!-- 组头「<状态> N 款」 -->
            <view class="jp-odt__group-head" :class="{ 'is-failed': group.isFailed }">
              <text class="jp-odt__group-title">{{ group.headerText }}</text>
            </view>

            <!--
              ★ 物流行：快递中文名 + 运单号 + 复制，紧跟组头下方。
              同一运单号只出现一次 —— 由分组结构保证（同状态同单号的行合成一组），
              不是在模板里去重。
            -->
            <view v-if="group.trackingNo" class="jp-odt__tracking">
              <text class="jp-odt__tracking-carrier">{{ group.carrierName }}</text>
              <text class="jp-odt__tracking-no">{{ group.trackingNo }}</text>
              <view class="jp-odt__tracking-copy" @tap.stop="copyTracking(group.trackingNo)">
                <text class="jp-odt__tracking-copy-txt">{{ t('order.trackingCopy') }}</text>
              </view>
            </view>

            <!-- 购买失败组的说明（甲方口径：没抢到是常态，不是事故） -->
            <view v-if="group.isFailed" class="jp-odt__failed-tip">
              <text class="jp-odt__failed-tip-txt">{{ t('order.failedGroupTip') }}</text>
            </view>

            <!-- 组内商品行（只读复用 BizCartItem） -->
            <view v-for="row in group.rows" :key="row.key" class="jp-odt__row">
              <BizCartItem
                readonly
                :name="row.name"
                :image="row.image"
                :price-yuan="row.priceYuan"
                :currency="t('order.currency')"
                :qty="row.qty"
                :qty-text="row.qtyText"
                invalid-badge=""
                delete-text=""
              />
              <!-- 退款行（只有购买失败的行有；已退款才显金额） -->
              <view v-if="row.refundKind !== 'none'" class="jp-odt__refund">
                <text
                  class="jp-odt__refund-txt"
                  :class="{ 'is-done': row.refundKind === 'refunded' }"
                >
                  {{ row.refundText }}
                </text>
                <text v-if="row.refundSupport" class="jp-odt__refund-sub">{{ row.refundSupport }}</text>
              </view>
            </view>
          </BizPanel>
        </view>

        <!-- ── 订单备注 ── -->
        <view v-if="userNote" class="jp-pad jp-odt__sec">
          <BizPanel small>
            <view class="jp-odt__note">
              <text class="jp-odt__note-title">{{ t('order.detailNoteTitle') }}</text>
              <text class="jp-odt__note-txt">{{ userNote }}</text>
            </view>
          </BizPanel>
        </view>

        <view class="jp-odt__tail" />
      </template>
    </view>
  </BizScreen>
</template>

<style lang="scss" scoped>
.jp-pad {
  padding: 0 var(--c-gap-page);
}
.jp-odt__sec {
  padding-top: 20rpx;
}
.jp-odt__state {
  padding-top: 32rpx;
}
.jp-odt__tail {
  height: 40rpx;
}

/* ── 订单头 ── */
.jp-odt__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 24rpx var(--c-gap-card) 16rpx;
  border-bottom: 2rpx solid var(--c-line);
}
.jp-odt__status {
  font-size: var(--c-fs-lg);
  font-weight: 700;
  color: var(--c-red);
}
.jp-odt__pay {
  display: flex;
  align-items: baseline;
  gap: 4rpx;
}
.jp-odt__pay-label {
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-3);
}
.jp-odt__cur {
  font-size: var(--c-fs-xs);
  font-weight: 700;
  color: var(--c-red);
}
.jp-odt__amount {
  font-size: var(--c-fs-lg);
  font-weight: 700;
  color: var(--c-red);
  font-variant-numeric: tabular-nums;
}
.jp-odt__meta {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 16rpx var(--c-gap-card) 24rpx;
}
.jp-odt__meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}
.jp-odt__meta-label {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-3);
  flex-shrink: 0;
}
.jp-odt__meta-val {
  font-size: var(--c-fs-xs);
  color: var(--c-ink);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/* ── 收货地址 ── */
.jp-odt__addr {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  padding: 24rpx var(--c-gap-card);
}
.jp-odt__addr-title {
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-3);
}
.jp-odt__addr-line {
  display: flex;
  align-items: baseline;
  gap: 16rpx;
}
.jp-odt__addr-name {
  font-size: var(--c-fs-body);
  font-weight: 700;
  color: var(--c-ink);
}
.jp-odt__addr-mobile {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
  font-variant-numeric: tabular-nums;
}
.jp-odt__addr-detail {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
  line-height: 1.5;
}

/* ══ ★ 分组 ══ */
.jp-odt__group-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 20rpx var(--c-gap-card) 12rpx;
}
.jp-odt__group-title {
  font-size: var(--c-fs-body);
  font-weight: 700;
  color: var(--c-ink);
}
/* 购买失败组的组头压低存在感（坏消息不需要更大声） */
.jp-odt__group-head.is-failed .jp-odt__group-title {
  color: var(--c-ink-2);
}

/* ★ 物流行：组头下方，同一运单号只此一处 */
.jp-odt__tracking {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin: 0 var(--c-gap-card) 12rpx;
  padding: 14rpx 16rpx;
  border-radius: var(--c-radius);
  background: var(--c-bg);
}
.jp-odt__tracking-carrier {
  font-size: var(--c-fs-xs);
  font-weight: 700;
  color: var(--c-ink);
  flex-shrink: 0;
}
.jp-odt__tracking-no {
  flex: 1;
  min-width: 0;
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
  font-variant-numeric: tabular-nums;
}
.jp-odt__tracking-copy {
  flex-shrink: 0;
  padding: 6rpx 20rpx;
  border-radius: 999rpx;
  border: 2rpx solid var(--c-line);
  background: var(--c-surface);
}
.jp-odt__tracking-copy-txt {
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-2);
}

/* 购买失败组说明 */
.jp-odt__failed-tip {
  margin: 0 var(--c-gap-card) 12rpx;
  padding: 12rpx 16rpx;
  border-radius: var(--c-radius);
  background: var(--c-bg);
}
.jp-odt__failed-tip-txt {
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-3);
  line-height: 1.5;
}

/* ── 组内行 ── */
.jp-odt__row {
  border-top: 2rpx solid var(--c-line);
}
.jp-odt__refund {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 0 var(--c-gap-card) 16rpx;
}
.jp-odt__refund-txt {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
}
/* 已退到账 = 好消息，给它颜色；处理中保持低调 */
.jp-odt__refund-txt.is-done {
  font-weight: 700;
  color: var(--c-red);
}
.jp-odt__refund-sub {
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-3);
}

/* ── 备注 ── */
.jp-odt__note {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  padding: 24rpx var(--c-gap-card);
}
.jp-odt__note-title {
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-3);
}
.jp-odt__note-txt {
  font-size: var(--c-fs-xs);
  color: var(--c-ink);
  line-height: 1.5;
}
</style>
