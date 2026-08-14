<script lang="ts" setup>
/**
 * GZ-JP-204 — 支付结果（FLOW:F-JP-02.step5 → step6）。
 *
 * <p>路由 {@code /pages/order/result?orderId=&orderNo=&outTradeNo=&paid=1}
 * （由下单确认页 {@code redirectTo} 进来，见 result.logic.ts 的 {@code buildPayResultRoute}）。</p>
 *
 * <p><b>★ 这一页存在的唯一理由</b>：{@code uni.requestPayment} 的 success 回调<b>不是最终态</b>
 * （跨层契约 #6）。客人手机上弹「支付成功」时微信的异步回调可能还没打到后端 ——
 * 此刻直接跳订单详情会看到一张「待支付」的已付款订单。所以这里<b>回读后端订单状态</b>
 * 直到 {@code businessStatus} 真的转 paid。</p>
 *
 * <p>三个终态（AC）：</p>
 * <ul>
 *   <li><b>paid</b>   → 跳订单详情（GZ-JP-205；未上线时兜 toast，<b>不静默无反应</b>）</li>
 *   <li><b>unpaid</b> → 回订单列表<b>待支付 tab</b>（{@code ?tab=created}）+ 一个「刷新」再试</li>
 *   <li><b>closed</b> → 订单已关闭，只能回订单列表</li>
 * </ul>
 *
 * <p><b>轮询到顶不说「支付失败」</b>：那会让一个已经付过钱的客人再付一次。到顶的文案是
 * 「还没收到支付结果」+ 刷新按钮。</p>
 *
 * <p><b>定时器纪律</b>：{@code onUnload} 必清（项目已踩过「切走了还在轮询」的坑）；
 * 阶段一进终态立刻停表，不靠次数自然耗尽。</p>
 */
import type { GzJpOrderDetailVO } from '@/api/gz-jp/order'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { formatYuan } from '@/api/gz-jp/format'
import {
  buildOrderDetailRoute,
  buildOrderListRoute,
  fetchJpOrderDetail,
} from '@/api/gz-jp/order'
import { t } from '@/locale/order.zh-CN'
import {
  parsePayResultQuery,
  POLL_INTERVAL_MS,
  POLL_MAX_ATTEMPTS,
  resolvePhase,
  shouldKeepPolling,
} from './result.logic'

defineOptions({ name: 'GzJpOrderResult' })

definePage({
  style: {
    navigationBarTitleText: '支付结果',
  },
})

/** dev mock 支付（页面上标一下，免得看到「支付成功」以为真扣钱了）。 */
const MOCK_PAY = import.meta.env.VITE_MOCK_PAY === 'true'

/* ── 路由参数 ─────────────────────────────────────────────── */

const orderId = ref('')
/** 订单号：首屏立刻能显示（不用等第一次轮询回来），客人截图给客服时不会截到空白 */
const orderNo = ref('')
/** 客人在 requestPayment 那一步的结果 —— 只影响首屏文案，不影响判定 */
const clientPaid = ref(false)

/* ── 轮询 ────────────────────────────────────────────────── */

const detail = ref<GzJpOrderDetailVO | null>(null)
/** 已轮询次数（到 POLL_MAX_ATTEMPTS 就不再等了）。 */
const attempts = ref(0)
/** 后端订单状态（null = 还没拉到）。 */
const businessStatus = ref<string | null>(null)

let timer: ReturnType<typeof setTimeout> | null = null

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

const phase = computed(() => resolvePhase(businessStatus.value, attempts.value, POLL_MAX_ATTEMPTS))

/**
 * 拉一次订单详情。
 *
 * <p>拉失败<b>不判失败</b>（{@code businessStatus} 保持 null → resolvePhase 当未知继续等）：
 * 一次网络抖动不该把「已经付过钱」说成「没付」。错误 toast 已由 api 层关掉
 * （{@code hideErrorToast}），否则每 1.5 秒弹一次会刷屏。</p>
 */
async function pollOnce() {
  if (!orderId.value) {
    return
  }
  try {
    const d = await fetchJpOrderDetail(orderId.value)
    detail.value = d
    businessStatus.value = d?.businessStatus ?? null
  }
  catch (e) {
    console.warn('[jp-order-result] poll failed', e)
  }
  finally {
    attempts.value += 1
  }
}

/** 轮询循环：拉一次 → 还在 polling 就排下一次（进终态立刻停表）。 */
async function tick() {
  clearTimer()
  await pollOnce()
  if (shouldKeepPolling(phase.value)) {
    timer = setTimeout(() => {
      void tick()
    }, POLL_INTERVAL_MS)
  }
}

/** 「刷新」：重置次数重新等一轮（客人说「我明明付了」时的自救按钮）。 */
function onRefresh() {
  attempts.value = 0
  void tick()
}

/* ── 展示派生 ────────────────────────────────────────────── */

const amountYuan = computed(() => formatYuan(detail.value?.totalAmountCent))
const displayOrderNo = computed(() => detail.value?.orderNo || orderNo.value)

/**
 * 转圈文案。
 *
 * <p>刻意<b>不区分</b>「客人说付了」与「客人说取消了」：{@code clientPaid} 只是微信客户端的回执，
 * 取消之后回调姗姗来迟的情况真实存在（客人在收银台点了取消，但其实前一次已经扣款成功）。
 * 这里两种情况说同一句话「正在确认支付结果」，判定交给后端 —— 说得越笃定，说错的代价越大。
 * {@code clientPaid} 保留在 query 里供排障与后续埋点。</p>
 */
const pollingText = computed(() => t('order.resultPolling'))

/* ── 跳转（失败必须报错，绝不静默、也绝不谎称「没上线」）───────── */

function goOrderDetail() {
  if (!orderId.value) {
    // 页面是有的，只是这次没接到单号 —— 给客人一条自己找得回去的路
    uni.showToast({ title: t('order.orderIdMissing'), icon: 'none' })
    return
  }
  uni.navigateTo({
    url: buildOrderDetailRoute(orderId.value),
    fail: (err) => {
      console.error('[jp-result] 订单详情跳转失败（路由 bug）', err)
      uni.showToast({ title: t('order.orderOpenFailed'), icon: 'none' })
    },
  })
}

/** 回订单列表的「待支付」tab（AC：失败 / 取消回这里）。 */
function goOrderList() {
  uni.navigateTo({
    url: buildOrderListRoute(),
    fail: (err) => {
      console.error('[jp-result] 订单列表跳转失败（路由 bug）', err)
      uni.showToast({ title: t('order.orderOpenFailed'), icon: 'none' })
    },
  })
}

/* ── 生命周期 ────────────────────────────────────────────── */

onLoad((options?: Record<string, string>) => {
  const q = parsePayResultQuery(options)
  orderId.value = q.orderId
  orderNo.value = q.orderNo
  clientPaid.value = q.paid
  void tick()
})

// 切走必清表（否则页面已经不在了还在打接口）
onUnload(() => {
  clearTimer()
})
</script>

<template>
  <BizScreen class="jp-screen">
    <view class="jp-payres">
      <view class="jp-pad jp-payres__sec">
        <BizPanel>
          <!-- 轮询中 -->
          <BizState
            v-if="phase === 'polling'"
            variant="loading"
            :text="pollingText"
            :sub="t('order.resultPollingSub')"
          />

          <!-- ★ 已支付 -->
          <BizState
            v-else-if="phase === 'paid'"
            variant="empty"
            emoji="🎉"
            :text="t('order.resultPaid')"
            :sub="t('order.resultPaidSub')"
          />

          <!-- 还没收到支付结果（不说「支付失败」） -->
          <BizState
            v-else-if="phase === 'unpaid'"
            variant="empty"
            emoji="⏳"
            :text="t('order.resultUnpaid')"
            :sub="t('order.resultUnpaidSub')"
          />

          <!-- 订单已关闭 -->
          <BizState
            v-else
            variant="error"
            :text="t('order.resultClosed')"
            :sub="t('order.resultClosedSub')"
          />

          <!-- 订单摘要（订单号 + 实付） -->
          <view v-if="displayOrderNo" class="jp-payres__meta">
            <view class="jp-payres__meta-row">
              <text class="jp-payres__meta-label">{{ t('order.resultOrderNoLabel') }}</text>
              <text class="jp-payres__meta-val">{{ displayOrderNo }}</text>
            </view>
            <view v-if="amountYuan" class="jp-payres__meta-row">
              <text class="jp-payres__meta-label">{{ t('order.resultAmountLabel') }}</text>
              <text class="jp-payres__meta-val is-money">
                {{ t('order.currency') }}{{ amountYuan }}
              </text>
            </view>
          </view>

          <view v-if="MOCK_PAY" class="jp-payres__mock">
            <BizTag type="ink">
              {{ t('order.mockPayTag') }}
            </BizTag>
          </view>
        </BizPanel>
      </view>

      <!-- 出口按钮（每个阶段都有出口，不留死页） -->
      <view v-if="phase !== 'polling'" class="jp-pad jp-payres__acts">
        <template v-if="phase === 'paid'">
          <view class="jp-payres__btn is-primary" @tap="goOrderDetail">
            <text class="jp-payres__btn-text is-on-red">{{ t('order.resultPaidCta') }}</text>
          </view>
        </template>

        <template v-else-if="phase === 'unpaid'">
          <view class="jp-payres__btn is-primary" @tap="onRefresh">
            <text class="jp-payres__btn-text is-on-red">{{ t('order.resultUnpaidRefresh') }}</text>
          </view>
          <view class="jp-payres__btn is-ghost" @tap="goOrderList">
            <text class="jp-payres__btn-text">{{ t('order.resultUnpaidCta') }}</text>
          </view>
        </template>

        <template v-else>
          <view class="jp-payres__btn is-ghost" @tap="goOrderList">
            <text class="jp-payres__btn-text">{{ t('order.resultClosedCta') }}</text>
          </view>
        </template>
      </view>
    </view>
  </BizScreen>
</template>

<style lang="scss" scoped>
.jp-pad {
  padding: 0 var(--c-gap-page);
}
.jp-payres__sec {
  padding-top: 24rpx;
}

.jp-payres__meta {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 0 var(--c-gap-card) 28rpx;
}
.jp-payres__meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}
.jp-payres__meta-label {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-3);
}
.jp-payres__meta-val {
  font-size: var(--c-fs-xs);
  color: var(--c-ink);
  font-variant-numeric: tabular-nums;
}
.jp-payres__meta-val.is-money {
  font-size: var(--c-fs-body);
  font-weight: 700;
  color: var(--c-red);
}
.jp-payres__mock {
  display: flex;
  justify-content: center;
  padding: 0 var(--c-gap-card) 24rpx;
}

.jp-payres__acts {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  padding-top: 24rpx;
}
.jp-payres__btn {
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--c-radius);
}
.jp-payres__btn.is-primary {
  background: var(--c-red);
  box-shadow: var(--c-shadow-btn);
}
.jp-payres__btn.is-ghost {
  background: var(--c-surface);
  border: 2rpx solid var(--c-line);
}
.jp-payres__btn-text {
  font-size: var(--c-fs-body);
  font-weight: 600;
  color: var(--c-ink);
}
.jp-payres__btn-text.is-on-red {
  color: var(--c-on-dark);
}
</style>
