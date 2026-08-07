<script lang="ts" setup>
/**
 * GZ-JP-203 — 购物车。UI:mp.cart / UI:mp.cart.group / UI:mp.cart.summary。
 *
 * <p>路由 {@code /pages/cart/index}（无参数）。入口两处：
 * 商品详情底部 CTA 条左侧的购物车图标（带件数角标）/「我的」页入口格。</p>
 *
 * <p><b>按场分组</b>（design-options/mp-cart.md 方案 A，Kevin 2026-08-06 拍板）：
 * 场是甲方的组织单位、且有截止时间 —— 快闭场的那批要能优先结。分组顺序由后端排好
 * （可下单场 → 已结束场 → 孤儿组沉底），<b>前端不重排</b>。</p>
 *
 * <p>自上而下：失效提示条（有失效项时）→ 分组卡片（组头 = 场名 + 款数 + 组级全选）→
 * 组内行（勾选框 + 图 + 名 + 单价 + 数量 stepper + 删除）→ 底部固定条（全选 + 合计 + 去结算）。</p>
 *
 * <p><b>★ 底部只有「商品合计」一行</b>（UI:mp.cart.summary / REQ-ORDER-004）：
 * 拼团价已含国际与国内配送成本，系统里根本没有第二笔费用这个概念，
 * 合计旁只标一个「已包邮」告诉客人这个数字就是全部。</p>
 *
 * <p><b>勾选态是纯前端的</b>（后端 GZ-JP-104 刻意不落库）。全部勾选算术在
 * ./index.logic.ts（有单测），本文件只负责取数、调接口、跳转。</p>
 *
 * <p><b>需登录</b>：购物车是用户私有数据（四个端点都无 &#64;SaIgnore）。游客进来显示
 * 「登录后查看购物车」+ 一个按钮，<b>不做登录墙</b>（不 reLaunch 到登录页）——
 * 与全站「游客优先 / 按需登录」一致。</p>
 */
import type { GzJpCartGroupVO, GzJpCartItemVO, GzJpCartVO } from '@/api/gz-jp/cart'
import { onHide, onShow, onUnload } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import {
  CART_MAX_QTY,
  CART_MIN_QTY,
  deleteCartItems,
  fetchCart,
  updateCartQty,
} from '@/api/gz-jp/cart'
import { formatYuan, hasRealCover } from '@/api/gz-jp/format'
import { useAuth } from '@/hooks/useAuth'
import { t } from '@/locale/cart.zh-CN'
import { debounce } from '@/utils/debounce'
import { buildProductRoute } from '../event/index.logic'
import { clampQuantity } from '../product/detail.logic'
import {
  buildCheckoutRoute,
  canCheckout as canCheckoutOf,
  cartSelectionState,
  checkoutIds,
  groupSelectableIds,
  groupSelectionState,
  HOME_ROUTE,
  invalidIds,
  selectedAmountCent,
  selectedQty,
  syncSelection,
  toggleAll,
  toggleGroup,
  toggleItem,
} from './index.logic'

defineOptions({ name: 'GzJpCart' })

definePage({
  style: {
    navigationBarTitleText: '购物车',
  },
})

const { isLoggedIn, ensureLoggedIn } = useAuth()

/* ── 取数 ────────────────────────────────────────────────── */

const cart = ref<GzJpCartVO | null>(null)
const loading = ref(true)
const loadFailed = ref(false)
const loggedIn = ref(false)

/** 勾选集合（购物车项 id）。纯前端状态，不落库。 */
const selectedIds = ref<string[]>([])
/** 上一轮快照里出现过的全部行 id —— 用来识别「本次新出现的行」（默认勾上）。 */
const knownIds = ref<string[]>([])

async function reload() {
  loggedIn.value = isLoggedIn()
  if (!loggedIn.value) {
    // 游客态：不打接口（必 401），直接渲染登录引导
    cart.value = null
    selectedIds.value = []
    knownIds.value = []
    loading.value = false
    loadFailed.value = false
    return
  }
  loadFailed.value = false
  try {
    const data = await fetchCart()
    cart.value = data
    // ★ 每次拿到新快照都重新对账勾选集合：失效 / 已消失的摘掉，新来的默认勾上
    const synced = syncSelection(data, selectedIds.value, knownIds.value)
    selectedIds.value = synced.selected
    knownIds.value = synced.known
  }
  catch (e) {
    console.warn('[jp-cart] load failed', e)
    loadFailed.value = true
    cart.value = null
  }
  finally {
    loading.value = false
  }
}

/* ── 展示派生 ────────────────────────────────────────────── */

const groups = computed<GzJpCartGroupVO[]>(() => cart.value?.groups ?? [])
const isEmpty = computed(() => !groups.value.length)
const invalidCount = computed(() => cart.value?.invalidCount ?? 0)

/** ★ 已勾选合计（元的纯数字串）—— 唯一的一行金额。 */
const totalYuan = computed(() => formatYuan(selectedAmountCent(cart.value, selectedIds.value)))
/** 已勾选件数（去结算按钮上的角标）。 */
const totalQty = computed(() => selectedQty(cart.value, selectedIds.value))
/** ★ 未勾选任何项时「去结算」置灰（AC）。 */
const canCheckout = computed(() => canCheckoutOf(cart.value, selectedIds.value))
/** 底部「全选」框三态。 */
const allState = computed(() => cartSelectionState(cart.value, selectedIds.value))
/** 去结算按钮文案（带已选件数；一件没选时只显示「去结算」，不出一个尴尬的 (0)）。 */
const checkoutText = computed(() =>
  totalQty.value > 0
    ? `${t('cart.checkout')}${t('cart.checkoutCountPrefix')}${totalQty.value}${t('cart.checkoutCountSuffix')}`
    : t('cart.checkout'))

function isChecked(item: GzJpCartItemVO): boolean {
  return selectedIds.value.includes(String(item.id))
}

function groupState(group: GzJpCartGroupVO) {
  return groupSelectionState(group, selectedIds.value)
}

/** 组内可勾选款数（组头显示的是「能买的有几款」，失效的不算进去）。 */
function groupCount(group: GzJpCartGroupVO): number {
  return groupSelectableIds(group).length || (group.items?.length ?? 0)
}

/** 行主图：后端无图会回落一个 mp 侧并不存在的占位路径，一律当无图处理（组件渲染占位块）。 */
function itemImage(item: GzJpCartItemVO): string {
  return hasRealCover(item.mainImageUrl) ? String(item.mainImageUrl) : ''
}

/** 行单价（元的纯数字串；无价 → 空串，组件只渲染货币符号不出 NaN）。 */
function itemPrice(item: GzJpCartItemVO): string {
  return formatYuan(item.priceCent)
}

/** 失效文案：后端已给中文人话，直接用；理论上不会缺，缺了兜一句通用的。 */
function itemInvalidText(item: GzJpCartItemVO): string {
  return (item.invalidText ?? '').trim() || t('cart.invalidFallback')
}

/* ── 勾选交互 ────────────────────────────────────────────── */

function onItemCheck(item: GzJpCartItemVO, checked: boolean) {
  selectedIds.value = toggleItem(selectedIds.value, item, checked)
}

function onGroupCheck(group: GzJpCartGroupVO) {
  selectedIds.value = toggleGroup(group, selectedIds.value)
}

function onAllCheck() {
  selectedIds.value = toggleAll(cart.value, selectedIds.value)
}

/* ── 改数量 ──────────────────────────────────────────────── */

/**
 * 待同步到后端的数量（id → 目标值）。
 *
 * <p>stepper 是「点一下 +1」，1→5 会连点 4 次。每次都打一发 PUT + 整车重拉太吵，
 * 所以本地先改（合计立刻跟着变 = AC「改数量实时刷新合计」），350ms 内的连点合并成一发。
 * 后端 PUT 是<b>绝对赋值</b>语义，合并成最后一个值天然正确（不是增量所以不会丢）。</p>
 */
const pendingQty = new Map<string, number>()

const flushQty = debounce(() => {
  void syncQty()
}, 350)

async function syncQty() {
  if (!pendingQty.size) {
    return
  }
  // Array.from 而不是展开 Map 迭代器：tsconfig target 低于 es2015 时展开迭代器编不过
  const entries = Array.from(pendingQty)
  pendingQty.clear()
  try {
    for (const [id, qty] of entries) {
      await updateCartQty(id, qty)
    }
  }
  catch (e) {
    // 失败原因后端已 toast（超上限 / 项不存在）；这里不吞不重复弹，靠下面的整车重拉把本地乐观值拨回真值
    console.warn('[jp-cart] updateQty failed', e)
  }
  // ★ 无论成败都整车重拉：失效状态是后端实时算的，本地改数会让「刚被店员关场」的项仍显示可勾选
  await reload()
}

function onQtyChange(item: GzJpCartItemVO, value: number) {
  const next = clampQuantity(value, CART_MIN_QTY, CART_MAX_QTY)
  if (next === item.qty) {
    return
  }
  // 乐观本地更新：只活到下一次整车重拉（几百 ms），之后一律以后端 amountCent 为准
  item.qty = next
  if (typeof item.priceCent === 'number' && Number.isFinite(item.priceCent)) {
    item.amountCent = item.priceCent * next
  }
  pendingQty.set(String(item.id), next)
  flushQty()
}

/* ── 删除 ────────────────────────────────────────────────── */

async function removeItems(ids: string[], doneText: string) {
  if (!ids.length) {
    return
  }
  try {
    await deleteCartItems(ids)
    uni.showToast({ title: doneText, icon: 'none' })
  }
  catch (e) {
    console.warn('[jp-cart] delete failed', e)
  }
  await reload()
}

function onRemove(item: GzJpCartItemVO) {
  uni.showModal({
    title: t('cart.deleteTitle'),
    content: t('cart.deleteContent'),
    confirmText: t('cart.deleteConfirm'),
    cancelText: t('cart.deleteCancel'),
    success: (res) => {
      if (res.confirm) {
        void removeItems([String(item.id)], t('cart.deleteDone'))
      }
    },
  })
}

/** 清空失效商品：收集 invalid 行的 id 调一次批量删除（后端刻意没做独立端点）。 */
function onClearInvalid() {
  const ids = invalidIds(cart.value)
  if (!ids.length) {
    return
  }
  uni.showModal({
    title: t('cart.invalidClearTitle'),
    content: t('cart.invalidClearContent'),
    confirmText: t('cart.deleteConfirm'),
    cancelText: t('cart.deleteCancel'),
    success: (res) => {
      if (res.confirm) {
        void removeItems(ids, t('cart.invalidClearDone'))
      }
    },
  })
}

/* ── 跳转 ────────────────────────────────────────────────── */

/** 点行 → 商品详情（商品已被删的孤儿行点了没意义，直接不跳）。 */
function onItemTap(item: GzJpCartItemVO) {
  if (item.invalidReason === 'product_removed') {
    return
  }
  uni.navigateTo({ url: buildProductRoute({ id: item.productId, productNo: item.productNo }) })
}

/**
 * 「去结算」→ 下单确认页（GZ-JP-204 交付）。
 *
 * <p>只带勾选的购物车项 id；价格与数量由确认页重拉、由后端重算（金额不从 URL 带）。
 * 目标页未上线期间 navigateTo 会 fail，兜一个 toast 而不是静默无反应；204 合并后自然可达。</p>
 */
function onCheckout() {
  if (!canCheckout.value) {
    uni.showToast({ title: t('cart.checkoutEmptyToast'), icon: 'none' })
    return
  }
  uni.navigateTo({
    url: buildCheckoutRoute(checkoutIds(cart.value, selectedIds.value)),
    fail: () => uni.showToast({ title: t('cart.checkoutComingSoon'), icon: 'none' }),
  })
}

/** 空车 / 游客态的出口：回首页逛场（首页是 tabbar 页，只能 switchTab）。 */
function goHome() {
  uni.switchTab({ url: HOME_ROUTE })
}

/** 游客态点「微信登录」→ 协议同意 sheet → 登录成功后立刻拉车。 */
async function onLogin() {
  if (await ensureLoggedIn()) {
    await reload()
  }
}

/* ── 生命周期 ────────────────────────────────────────────── */

onShow(() => {
  void reload()
})

// 离开页面前把还没发出去的数量改动落地，别让客人改完就走导致白改
onHide(() => {
  flushQty.flush()
})
onUnload(() => {
  flushQty.flush()
})
</script>

<template>
  <BizScreen class="jp-screen">
    <view class="jp-cart">
      <!-- 加载态 -->
      <view v-if="loading" class="jp-pad jp-cart__state">
        <BizPanel>
          <BizState variant="loading" :text="t('cart.loading')" />
        </BizPanel>
      </view>

      <!-- 游客态：不做登录墙，给一个明确的登录入口 -->
      <view v-else-if="!loggedIn" class="jp-pad jp-cart__state">
        <BizPanel>
          <BizState
            variant="empty"
            emoji="🔒"
            :text="t('cart.needLogin')"
            :sub="t('cart.needLoginSub')"
            :cta-text="t('cart.needLoginCta')"
            @cta="onLogin"
          />
        </BizPanel>
      </view>

      <!-- 取数失败 -->
      <view v-else-if="loadFailed" class="jp-pad jp-cart__state">
        <BizPanel>
          <BizState
            variant="error"
            :text="t('cart.loadError')"
            :sub="t('cart.loadErrorSub')"
            :cta-text="t('cart.retry')"
            @cta="reload"
          />
        </BizPanel>
      </view>

      <!-- 空车 -->
      <view v-else-if="isEmpty" class="jp-pad jp-cart__state">
        <BizPanel>
          <BizState
            variant="empty"
            emoji="🧺"
            :text="t('cart.empty')"
            :sub="t('cart.emptySub')"
            :cta-text="t('cart.emptyCta')"
            @cta="goHome"
          />
        </BizPanel>
      </view>

      <template v-else>
        <!-- 失效提示条（有失效项时才出；清理复用批量删除端点） -->
        <view v-if="invalidCount > 0" class="jp-pad jp-cart__invalid-tip-wrap">
          <view class="jp-cart__invalid-tip">
            <text class="jp-cart__invalid-tip-text">
              {{ t('cart.invalidTipPrefix') }} {{ invalidCount }} {{ t('cart.invalidTipSuffix') }}
            </text>
            <text class="jp-cart__invalid-tip-btn" @tap="onClearInvalid">
              {{ t('cart.invalidClear') }}
            </text>
          </view>
        </view>

        <!-- 分组卡片（UI:mp.cart.group：跨场商品共存于同一购物车） -->
        <view
          v-for="group in groups"
          :key="group.eventId || 'orphan'"
          class="jp-pad jp-cart__group"
        >
          <BizPanel>
            <!-- 组头：组级全选 + 场名 + 款数 +（已结束标） -->
            <view class="jp-cart__group-head">
              <view class="jp-cart__group-check" @tap="onGroupCheck(group)">
                <view
                  class="jp-cart__box"
                  :class="{
                    'is-on': groupState(group) === 'all',
                    'is-part': groupState(group) === 'some',
                  }"
                >
                  <text v-if="groupState(group) === 'all'" class="jp-cart__tick">✓</text>
                  <text v-else-if="groupState(group) === 'some'" class="jp-cart__tick">−</text>
                </view>
              </view>
              <text class="jp-cart__group-name">
                {{ group.eventName || t('cart.groupOrphan') }}
              </text>
              <text class="jp-cart__group-count">
                {{ groupCount(group) }}{{ t('cart.groupCountSuffix') }}
              </text>
              <BizTag v-if="!group.eventBookable" type="ink">
                {{ t('cart.groupEnded') }}
              </BizTag>
            </view>

            <!-- 组内行 -->
            <view class="jp-cart__items">
              <view v-for="item in group.items" :key="item.id" class="jp-cart__row">
                <BizCartItem
                  :name="item.name"
                  :image="itemImage(item)"
                  :price-yuan="itemPrice(item)"
                  :currency="t('cart.currency')"
                  :qty="item.qty"
                  :checked="isChecked(item)"
                  :invalid="item.invalid"
                  :invalid-text="itemInvalidText(item)"
                  :invalid-badge="t('cart.invalidBadge')"
                  :delete-text="t('cart.delete')"
                  :min-qty="CART_MIN_QTY"
                  :max-qty="CART_MAX_QTY"
                  @check="onItemCheck(item, $event)"
                  @qty="onQtyChange(item, $event)"
                  @remove="onRemove(item)"
                  @tap="onItemTap(item)"
                />
              </view>
            </view>
          </BizPanel>
        </view>

        <!-- 底部固定条让位 -->
        <view class="jp-cart__spacer" />

        <!--
          ★ 底部固定条（UI:mp.cart.summary）：全选 + 合计 +「去结算」。
          ★★ 只有「商品合计」这一行金额 —— 拼团价已含全部配送成本（REQ-ORDER-004），
             合计旁只标一个「已包邮」，系统里没有第二笔费用可显示。
        -->
        <view class="jp-cart-bar">
          <view class="jp-cart-bar__all" @tap="onAllCheck">
            <view
              class="jp-cart__box"
              :class="{ 'is-on': allState === 'all', 'is-part': allState === 'some' }"
            >
              <text v-if="allState === 'all'" class="jp-cart__tick">✓</text>
              <text v-else-if="allState === 'some'" class="jp-cart__tick">−</text>
            </view>
            <text class="jp-cart-bar__all-text">{{ t('cart.selectAll') }}</text>
          </view>

          <view class="jp-cart-bar__sum">
            <view class="jp-cart-bar__sum-row">
              <text class="jp-cart-bar__sum-label">{{ t('cart.totalLabel') }}</text>
              <text class="jp-cart-bar__cur">{{ t('cart.currency') }}</text>
              <text class="jp-cart-bar__total">{{ totalYuan }}</text>
            </view>
            <text class="jp-cart-bar__note">{{ t('cart.totalIncluded') }}</text>
          </view>

          <view
            class="jp-cart-bar__checkout"
            :class="{ 'is-disabled': !canCheckout }"
            @tap="onCheckout"
          >
            <text class="jp-cart-bar__checkout-text">{{ checkoutText }}</text>
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
.jp-cart__state {
  padding-top: 24rpx;
}

/* ── 失效提示条 ── */
.jp-cart__invalid-tip-wrap {
  padding-top: 20rpx;
}
.jp-cart__invalid-tip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 16rpx var(--c-gap-card);
  border-radius: var(--c-radius);
  background: var(--c-amber-soft);
}
.jp-cart__invalid-tip-text {
  font-size: var(--c-fs-xs);
  color: #8a5a10;
}
.jp-cart__invalid-tip-btn {
  font-size: var(--c-fs-xs);
  font-weight: 700;
  color: #8a5a10;
  padding: 4rpx 10rpx;
  border-radius: 8rpx;
  background: rgba(255, 255, 255, 0.7);
}

/* ── 分组 ── */
.jp-cart__group {
  padding-top: 20rpx;
}
.jp-cart__group-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 20rpx var(--c-gap-card) 12rpx;
  border-bottom: var(--c-divider);
}
.jp-cart__group-check {
  padding: 4rpx;
  flex-shrink: 0;
}
.jp-cart__group-name {
  flex: 1;
  min-width: 0;
  font-size: var(--c-fs-body);
  font-weight: 700;
  color: var(--c-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jp-cart__group-count {
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-3);
  flex-shrink: 0;
}

/* ── 勾选框（组头 / 底部全选共用；行内的在 BizCartItem 里） ── */
.jp-cart__box {
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
.jp-cart__box.is-on,
.jp-cart__box.is-part {
  background: var(--c-red);
  border-color: var(--c-red);
}
.jp-cart__tick {
  font-size: var(--c-fs-sm);
  font-weight: 700;
  line-height: 1;
  color: var(--c-on-dark);
}

/* ── 行 ── */
.jp-cart__row + .jp-cart__row {
  border-top: var(--c-divider);
}

/* ── 底部固定条 ── */
.jp-cart__spacer {
  height: var(--c-cta-spacer);
}
.jp-cart-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx var(--c-gap-page);
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: saturate(180%) blur(16px);
  border-top: var(--c-bw-3) solid var(--c-line);
}
.jp-cart-bar__all {
  display: flex;
  align-items: center;
  gap: 8rpx;
  flex-shrink: 0;
}
.jp-cart-bar__all-text {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
}
.jp-cart-bar__sum {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2rpx;
}
.jp-cart-bar__sum-row {
  display: flex;
  align-items: baseline;
  gap: 4rpx;
}
.jp-cart-bar__sum-label {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
}
.jp-cart-bar__cur {
  font-size: var(--c-fs-xs);
  font-weight: 700;
  color: var(--c-red);
}
.jp-cart-bar__total {
  font-size: var(--c-fs-h2);
  font-weight: 700;
  color: var(--c-red);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.jp-cart-bar__note {
  font-size: var(--c-fs-3xs);
  color: var(--c-ink-3);
}
.jp-cart-bar__checkout {
  flex-shrink: 0;
  min-width: 220rpx;
  height: 84rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 24rpx;
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
.jp-cart-bar__checkout.is-disabled {
  background: #d9d4cb;
  box-shadow: none;
}
.jp-cart-bar__checkout-text {
  font-size: var(--c-fs-body);
  font-weight: 600;
  letter-spacing: 0.5rpx;
  color: var(--c-on-dark);
}
</style>
