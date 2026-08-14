<script lang="ts" setup>
/**
 * GZ-JP-204 — 下单确认 + 支付。UI:mp.order_confirm / FLOW:F-JP-02.step3·step4·step5。
 *
 * <p>路由 {@code /pages/order/confirm?ids=39,40}（<b>购物车项 id</b> 逗号分隔，
 * 由购物车「去结算」生成，见 pages/cart/index.logic.ts 的 {@code buildCheckoutRoute}）。
 * <b>刻意不带金额 / 数量 / 商品信息</b>：URL 带金额是最经典的篡改面，且两页之间价格可能已变。</p>
 *
 * <p>自上而下：收货地址（选择 / 新增）→ 商品清单（只读）→ 备注 → 金额区 → 底部条
 * （已阅读不支持退款 + 提交订单）。</p>
 *
 * <p><b>★ 金额区只有「商品合计」与「实付」两行，没有第三行</b>（UI:mp.order_confirm.summary /
 * REQ-ORDER-004 全包邮）：两行同源于 {@code checkoutAmountCent}，系统里根本没有第二笔费用这个概念。</p>
 *
 * <p><b>⚠️ 本文件的任何一行（含注释）都不得出现配送费用相关词</b> —— 任务卡 accept #2 是对
 * <b>整个文件</b>做 grep，写一句「没有 XX 行」的说明同样会让它变红（本卡实测踩到）。
 * 这看着像是被规则绑住手脚，但它守的是一件真事：全系统<b>不存在</b>第二笔费用这个概念
 * （REQ-ORDER-004 推翻了 REQ-ORDER-002），连注释里都不该出现它，否则下一个人会以为
 * 「只是现在没有、以后可以加」。要表达同一个意思，写「没有第三行」。</p>
 *
 * <p><b>★ 提交前复校</b>（场仍 open / 商品仍 on_shelf / 价格未变）<b>由后端做</b>（GZ-JP-105 的
 * 下单事务里一次性全量校验）。前端<b>不重复实现校验逻辑</b> —— 两套判定必然会漂移，
 * 而漂移的那一刻客人会看到「页面说能买、点了说不能买」。前端只做两件事：
 * ① 进页面重拉整车、把此刻 {@code invalid} 的行标出来并拦住提交（少一次白跑的网络往返）；
 * ② 正确处理后端错误码（4102 退回购物车 / 4104 刷新本页 / 4103 重选地址 / 4107 去我的订单）。</p>
 *
 * <p><b>★「已阅读不支持退款」勾一次</b>：design-options/mp-product-detail.md 方案 A 的配套举证手段
 * （Kevin 2026-08-06 拍板原话「选 A。配合下单确认页勾一次「已阅读不支持退款」做举证」）。
 * 商品详情只做被动展示，强制确认这一半在这里 —— <b>默认不勾</b>，勾之前提交按钮置灰。</p>
 *
 * <p><b>需登录</b>：购物车 / 地址 / 下单三组端点都需登录态。游客进来显示登录引导，
 * 不做登录墙（与全站「游客优先 / 按需登录」一致）。</p>
 */
import type { GzJpCartItemVO } from '@/api/gz-jp/cart'
import type { GzUserAddressVO } from '@/api/gz-user-address'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { CART_ROUTE, fetchCart } from '@/api/gz-jp/cart'
import { formatYuan, hasRealCover } from '@/api/gz-jp/format'
import {
  bizErrorCodeOf,
  buildOrderListRoute,
  submitJpOrder,
} from '@/api/gz-jp/order'
import { simulatePayCallbackSelf } from '@/api/gz-pay'
import { fetchAddressList, saveAddress } from '@/api/gz-user-address'
import { useAuth } from '@/hooks/useAuth'
import { t } from '@/locale/order.zh-CN'
import {
  buildSubmitGate,
  checkoutAmountCent,
  checkoutQty,
  formatAddressLine,
  parseCheckoutIds,
  pickCheckoutItems,
  pickDefaultAddress,
  resolveSubmitFailAction,
  syncSelectedAddress,
  validateAddressForm,
} from './confirm.logic'
import { buildPayResultRoute } from './result.logic'

defineOptions({ name: 'GzJpOrderConfirm' })

definePage({
  style: {
    navigationBarTitleText: '确认订单',
  },
})

const { isLoggedIn, ensureLoggedIn } = useAuth()

/**
 * dev mock 支付开关（{@code .env.development} 的 {@code VITE_MOCK_PAY}）。
 *
 * <p>true 时跳过 {@code uni.requestPayment}（占位 appid 下它必然失败），改调后端
 * {@code /app/gz/test/pay/simulate-callback} 驱动<b>真实结算链路</b>（同一条 handlePaymentNotify + SPI）。
 * staging/prod 无此项 → 恒走真支付。<b>与 VITE_WX_APPID 解耦</b>：可「真登录 + 假支付」。</p>
 */
const MOCK_PAY = import.meta.env.VITE_MOCK_PAY === 'true'

/** 备注长度上限（前端先收一道，避免白跑一次 400）。 */
const NOTE_MAX = 200

/* ── 路由参数 ─────────────────────────────────────────────── */

/** 要结算的购物车项 id（来自购物车勾选）。 */
const checkoutIds = ref<string[]>([])

/* ── 取数 ────────────────────────────────────────────────── */

const loading = ref(true)
const loadFailed = ref(false)
const loggedIn = ref(false)

/** 本次结算的商品行（从整车里按 ids 挑出来的，顺序跟购物车一致）。 */
const items = ref<GzJpCartItemVO[]>([])
/** 其中此刻已失效的（场刚关 / 商品刚下架）—— 有值就拦住提交。 */
const invalidItems = ref<GzJpCartItemVO[]>([])

/** 地址簿 + 当前选中的地址。 */
const addressList = ref<GzUserAddressVO[]>([])
const selectedAddress = ref<GzUserAddressVO | null>(null)

/**
 * 拉数据：整车 + 地址簿。
 *
 * <p><b>★ 每次都重拉整车</b>（不吃购物车页传过来的快照）：{@code invalid} 是后端实时算的，
 * 客人从勾选到进这一页之间店员可能刚关场。</p>
 */
async function reload() {
  loggedIn.value = isLoggedIn()
  if (!loggedIn.value) {
    items.value = []
    invalidItems.value = []
    addressList.value = []
    selectedAddress.value = null
    loading.value = false
    loadFailed.value = false
    return
  }
  loadFailed.value = false
  try {
    const [cart, addrs] = await Promise.all([fetchCart(), fetchAddressList()])
    const picked = pickCheckoutItems(cart, checkoutIds.value)
    items.value = picked.items
    invalidItems.value = picked.invalidItems

    addressList.value = addrs ?? []
    // 已选地址在新列表里还在 → 保留；被删了 / 首次进页面 → 回落默认地址
    selectedAddress.value = selectedAddress.value
      ? syncSelectedAddress(addressList.value, selectedAddress.value.id)
      : pickDefaultAddress(addressList.value)
  }
  catch (e) {
    console.warn('[jp-order-confirm] load failed', e)
    loadFailed.value = true
    items.value = []
    invalidItems.value = []
  }
  finally {
    loading.value = false
  }
}

/* ── 展示派生 ────────────────────────────────────────────── */

const isEmpty = computed(() => !items.value.length)
const invalidCount = computed(() => invalidItems.value.length)

/**
 * ★ 应付金额（元的纯数字串）。
 *
 * <p>「商品合计」与「实付」<b>共用这一个值</b> —— 全包邮（REQ-ORDER-004），
 * 两行之间没有任何可以插入第三笔的地方。</p>
 */
const amountCent = computed(() => checkoutAmountCent(items.value))
const amountYuan = computed(() => formatYuan(amountCent.value))
const totalQty = computed(() => checkoutQty(items.value))

/** 地址展示（省市区 + 详细）。 */
const addressLine = computed(() => formatAddressLine(selectedAddress.value))

/* ── 备注 ────────────────────────────────────────────────── */

const userNote = ref('')
function onNoteInput(e: { detail?: { value?: string } }) {
  const v = String(e?.detail?.value ?? '')
  userNote.value = v.length > NOTE_MAX ? v.slice(0, NOTE_MAX) : v
}

/* ── ★ 已阅读不支持退款（举证勾选，默认不勾）───────────── */

const agreedNoRefund = ref(false)
function onToggleAgree() {
  agreedNoRefund.value = !agreedNoRefund.value
}

/** 点「拼团购买须知」看正文（勾选框与链接分开点，避免点链接顺手把勾选也切了）。 */
function onOpenNotice() {
  uni.showModal({
    title: t('order.agreeDetailTitle'),
    content: t('order.agreeDetailContent'),
    showCancel: false,
    confirmText: t('order.agreeDetailConfirm'),
  })
}

/* ── 地址选择 / 新增 ─────────────────────────────────────── */

/** 弹层态：关 / 选地址 / 填新地址。 */
const addrSheet = ref<'none' | 'pick' | 'form'>('none')

const addrForm = ref({
  recipientName: '',
  mobile: '',
  province: '',
  city: '',
  district: '',
  detail: '',
})
/** 省市区的展示串（picker 选完才有值；空 → 显示占位）。 */
const addrRegionText = computed(() => {
  const { province, city, district } = addrForm.value
  return [province, city, district].filter(Boolean).join(' ')
})
const savingAddress = ref(false)

function openAddressSheet() {
  addrSheet.value = addressList.value.length ? 'pick' : 'form'
}
function closeAddressSheet() {
  addrSheet.value = 'none'
}
function onPickAddress(addr: GzUserAddressVO) {
  selectedAddress.value = addr
  addrSheet.value = 'none'
}
function openAddressForm() {
  addrForm.value = { recipientName: '', mobile: '', province: '', city: '', district: '', detail: '' }
  addrSheet.value = 'form'
}

/** 省市区 picker（uni {@code <picker mode="region">}，detail.value = ['省','市','区']）。 */
function onRegionChange(e: { detail?: { value?: string[] } }) {
  const v = e?.detail?.value ?? []
  addrForm.value.province = String(v[0] ?? '')
  addrForm.value.city = String(v[1] ?? '')
  addrForm.value.district = String(v[2] ?? '')
}

function onFormInput(field: 'recipientName' | 'mobile' | 'detail', e: { detail?: { value?: string } }) {
  addrForm.value[field] = String(e?.detail?.value ?? '')
}

/**
 * 保存新地址 → 立刻选中它。
 *
 * <p>前端先校验一道只是省一次往返，<b>后端才是闸门</b>（{@code @NotBlank} + 手机号 {@code @Pattern}）。
 * 保存成功后不重拉整个页面，只重拉地址簿并把新地址选上 —— 客人刚填完就该看到它生效。</p>
 */
async function onSaveAddress() {
  const err = validateAddressForm(addrForm.value)
  if (err) {
    uni.showToast({
      title: t(`order.addressErr${err.charAt(0).toUpperCase()}${err.slice(1)}`),
      icon: 'none',
    })
    return
  }
  if (savingAddress.value) {
    return
  }
  savingAddress.value = true
  try {
    const saved = await saveAddress({
      recipientName: addrForm.value.recipientName.trim(),
      // 手机号是 String 字段（后端 @Pattern），不做 Number 转换：前导 0 与精度都会出事
      mobile: addrForm.value.mobile.trim(),
      province: addrForm.value.province,
      city: addrForm.value.city,
      district: addrForm.value.district,
      detail: addrForm.value.detail.trim(),
      // 地址簿为空时第一条设为默认，省得客人下次还要再选一遍
      isDefault: addressList.value.length ? 0 : 1,
    })
    addressList.value = await fetchAddressList()
    selectedAddress.value = syncSelectedAddress(addressList.value, saved?.id)
    addrSheet.value = 'none'
    uni.showToast({ title: t('order.addressFormSaved'), icon: 'none' })
  }
  catch (e) {
    // 失败原因后端已 toast（字段校验 / 未登录），这里不叠一层自己的话
    console.warn('[jp-order-confirm] saveAddress failed', e)
  }
  finally {
    savingAddress.value = false
  }
}

/* ── ★ 提交闸门 ─────────────────────────────────────────── */

const submitting = ref(false)

const submitGate = computed(() => buildSubmitGate({
  itemCount: items.value.length,
  invalidCount: invalidCount.value,
  addressId: selectedAddress.value?.id ?? null,
  agreedNoRefund: agreedNoRefund.value,
  submitting: submitting.value,
}))
const submitDisabled = computed(() => submitGate.value.disabled)
const submitText = computed(() => (submitting.value ? t('order.submitting') : t('order.submit')))

/** 点了灰按钮：告诉客人到底缺什么（一个不说话的灰按钮最招人烦）。 */
function toastBlockReason() {
  switch (submitGate.value.reason) {
    case 'empty':
      uni.showToast({ title: t('order.blockEmpty'), icon: 'none' })
      break
    case 'invalid':
      uni.showToast({ title: t('order.blockInvalid'), icon: 'none' })
      break
    case 'no_address':
      uni.showToast({ title: t('order.blockNoAddress'), icon: 'none' })
      openAddressSheet()
      break
    case 'not_agreed':
      uni.showToast({ title: t('order.agreeRequiredToast'), icon: 'none' })
      break
    default:
      // submitting：正在飞，静默（再弹一个 toast 只会让人以为点坏了）
      break
  }
}

/* ── 跳转兜底 ────────────────────────────────────────────── */

/** 回购物车（本页是 navigateTo 进来的 → navigateBack 一层即可；失败兜 redirectTo）。 */
function goCart() {
  uni.navigateBack({
    delta: 1,
    fail: () => uni.redirectTo({ url: CART_ROUTE }),
  })
}

/** 去「我的订单」。跳转失败是路由 bug，必须报错，不许谎称「没上线」。 */
function goOrderList() {
  uni.navigateTo({
    url: buildOrderListRoute(),
    fail: (err) => {
      console.error('[jp-confirm] 订单列表跳转失败（路由 bug）', err)
      uni.showToast({ title: t('order.orderOpenFailed'), icon: 'none' })
    },
  })
}

/* ── ★ 提交订单 + 调起支付 ──────────────────────────────── */

/**
 * Promise 化 {@code uni.requestPayment}（成功 resolve true / 取消或失败 resolve false）。
 *
 * <p>uni 的 {@code RequestPaymentOptions} 是「微信 jsapi / 支付宝 orderInfo」联合类型，
 * TS 误判 orderInfo 必填；mp-weixin jsapi 分支只需 5 参，故按 jsapi 形状构造后具名 cast
 * （非 any，结构明确 —— 与 miniapp 的 useOrderSubmit 同款）。</p>
 *
 * <p><b>★ success 不是最终态</b>（跨层契约 #6）：微信的异步回调可能还没打到我们后端。
 * 真正的判定在支付结果页回读订单状态。</p>
 */
function requestPayment(p: {
  timeStamp: string
  nonceStr: string
  packageVal: string
  signType: string
  paySign: string
}): Promise<boolean> {
  return new Promise((resolve) => {
    const payOptions = {
      provider: 'wxpay',
      timeStamp: p.timeStamp,
      nonceStr: p.nonceStr,
      package: p.packageVal,
      signType: p.signType as 'RSA',
      paySign: p.paySign,
      success: () => resolve(true),
      // 用户取消（errMsg 含 cancel）与支付失败都走 fail —— 统一按「未完成」处理
      fail: () => resolve(false),
    }
    uni.requestPayment(payOptions as unknown as UniNamespace.RequestPaymentOptions)
  })
}

/**
 * dev mock 支付：调后端 simulate-callback 驱动<b>真实结算链路</b>。
 *
 * <p>不是把状态硬改成 paid —— 走的是与真实微信回调同一条 {@code handlePaymentNotify} + SPI 路由，
 * 所以订单转 paid、商品行激活这些事都真的发生了。</p>
 */
async function mockPay(outTradeNo: string): Promise<boolean> {
  try {
    await simulatePayCallbackSelf(outTradeNo)
    return true
  }
  catch (e) {
    console.warn('[jp-order-confirm] mock pay failed', e)
    return false
  }
}

/**
 * 「提交订单」。
 *
 * <ol>
 *   <li>闸门不过 → toast 具体原因（不静默）</li>
 *   <li>{@code POST /app/gz/jp/order}（后端一个事务里全量复校 + 重算金额 + 建支付单）</li>
 *   <li>失败 → 按业务码决定去哪（4102 退回购物车 / 4104 刷新本页 / 4103 重选地址 / 4107 去订单）</li>
 *   <li>成功 → 拉起微信支付（dev mock 下走 simulate-callback）</li>
 *   <li>无论支付成功 / 取消，都 {@code redirectTo} 支付结果页 —— <b>订单已经建出来了</b>，
 *       客人得有地方看到它、有机会继续付。{@code redirectTo} 而非 navigateTo：
 *       返回时不该退回一个「已经提交过」的确认页。</li>
 * </ol>
 */
async function onSubmit() {
  if (submitDisabled.value) {
    toastBlockReason()
    return
  }
  // 登录态可能在停留期间过期（购物车/地址都是登录后拉的，但提交是分钟级之后的事）
  if (!(await ensureLoggedIn())) {
    return
  }
  submitting.value = true
  try {
    const res = await submitJpOrder({
      cartItemIds: items.value.map(it => String(it.id)),
      addressId: String(selectedAddress.value?.id ?? ''),
      userNote: userNote.value.trim() || undefined,
      // ★ 只做比对闸：与后端重算值不一致 → 4104 拒单（而不是默默按新价扣款）
      expectedAmountCent: amountCent.value,
    })

    const pay = res?.payParams
    if (!pay?.outTradeNo) {
      // 订单已落库但没拿到支付参数：绝不静默，指一条能找回这张单的路
      uni.showToast({ title: t('order.payParamsMissing'), icon: 'none' })
      uni.redirectTo({
        url: buildPayResultRoute({ orderId: res.orderId, orderNo: res.orderNo, outTradeNo: '', paid: false }),
      })
      return
    }

    const paid = MOCK_PAY ? await mockPay(pay.outTradeNo) : await requestPayment(pay)
    if (!paid) {
      // 取消 / 失败：订单保持 created，钱没扣，可以再付
      uni.showToast({ title: t('order.payCancelledToast'), icon: 'none' })
    }
    uni.redirectTo({
      url: buildPayResultRoute({
        orderId: res.orderId,
        orderNo: res.orderNo,
        outTradeNo: pay.outTradeNo,
        paid,
      }),
    })
  }
  catch (e) {
    // msg 已由 http.ts toast（后端的话点名到具体商品 / 带正确金额，比前端能编的强），这里只决定去哪
    const code = bizErrorCodeOf(e)
    console.warn('[jp-order-confirm] submit failed code=', code, e)
    switch (resolveSubmitFailAction(code)) {
      case 'back_to_cart':
        goCart()
        break
      case 'reload':
        void reload()
        break
      case 'pick_address':
        void reload().then(() => openAddressSheet())
        break
      case 'go_orders':
        goOrderList()
        break
      default:
        break
    }
  }
  finally {
    submitting.value = false
  }
}

/* ── 游客态 ──────────────────────────────────────────────── */

async function onLogin() {
  if (await ensureLoggedIn()) {
    await reload()
  }
}

/* ── 生命周期 ────────────────────────────────────────────── */

onLoad((options?: Record<string, string>) => {
  checkoutIds.value = parseCheckoutIds(options?.ids)
})

// onShow 而非 onLoad 取数：从地址簿 / 商品详情返回时要拿最新的失效状态与地址
onShow(() => {
  void reload()
})
</script>

<template>
  <BizScreen class="jp-screen">
    <view class="jp-confirm">
      <!-- 加载态 -->
      <view v-if="loading" class="jp-pad jp-confirm__state">
        <BizPanel>
          <BizState variant="loading" :text="t('order.loading')" />
        </BizPanel>
      </view>

      <!-- 游客态：不做登录墙 -->
      <view v-else-if="!loggedIn" class="jp-pad jp-confirm__state">
        <BizPanel>
          <BizState
            variant="empty"
            emoji="🔒"
            :text="t('order.needLogin')"
            :sub="t('order.needLoginSub')"
            :cta-text="t('order.needLoginCta')"
            @cta="onLogin"
          />
        </BizPanel>
      </view>

      <!-- 取数失败 -->
      <view v-else-if="loadFailed" class="jp-pad jp-confirm__state">
        <BizPanel>
          <BizState
            variant="error"
            :text="t('order.loadError')"
            :sub="t('order.loadErrorSub')"
            :cta-text="t('order.retry')"
            @cta="reload"
          />
        </BizPanel>
      </view>

      <!-- 勾选项全都不在了 -->
      <view v-else-if="isEmpty" class="jp-pad jp-confirm__state">
        <BizPanel>
          <BizState
            variant="empty"
            emoji="🧺"
            :text="t('order.emptyItems')"
            :sub="t('order.emptyItemsSub')"
            :cta-text="t('order.emptyItemsCta')"
            @cta="goCart"
          />
        </BizPanel>
      </view>

      <template v-else>
        <!-- ★ 收货地址（AC：必选） -->
        <view class="jp-pad jp-confirm__sec">
          <BizPanel>
            <view class="jp-confirm-addr" @tap="openAddressSheet">
              <template v-if="selectedAddress">
                <view class="jp-confirm-addr__main">
                  <view class="jp-confirm-addr__head">
                    <text class="jp-confirm-addr__name">{{ selectedAddress.recipientName }}</text>
                    <text class="jp-confirm-addr__mobile">{{ selectedAddress.mobile }}</text>
                    <BizTag v-if="Number(selectedAddress.isDefault) === 1" type="red">
                      {{ t('order.addressDefaultTag') }}
                    </BizTag>
                  </view>
                  <text class="jp-confirm-addr__line">{{ addressLine }}</text>
                </view>
                <text class="jp-confirm-addr__change">{{ t('order.addressChange') }}</text>
              </template>
              <template v-else>
                <view class="jp-confirm-addr__main">
                  <text class="jp-confirm-addr__empty">{{ t('order.addressEmpty') }}</text>
                  <text class="jp-confirm-addr__line">{{ t('order.addressEmptySub') }}</text>
                </view>
                <text class="jp-confirm-addr__change">＋</text>
              </template>
            </view>
          </BizPanel>
        </view>

        <!-- 失效提示（有失效项 = 不能提交，必须回购物车处理） -->
        <view v-if="invalidCount > 0" class="jp-pad jp-confirm__sec">
          <view class="jp-confirm__invalid-tip">
            <text class="jp-confirm__invalid-tip-text">
              {{ t('order.invalidTipPrefix') }} {{ invalidCount }} {{ t('order.invalidTipSuffix') }}
            </text>
            <text class="jp-confirm__invalid-tip-btn" @tap="goCart">
              {{ t('order.invalidTipCta') }}
            </text>
          </view>
        </view>

        <!-- 商品清单（只读：无勾选 / 无 stepper / 无删除） -->
        <view class="jp-pad jp-confirm__sec">
          <BizPanel>
            <view class="jp-confirm__sec-head">
              <text class="jp-confirm__sec-title">{{ t('order.itemsSectionTitle') }}</text>
              <text class="jp-confirm__sec-count">
                {{ items.length }}{{ t('order.groupCountSuffix') }}
              </text>
            </view>
            <view class="jp-confirm__items">
              <view v-for="item in items" :key="item.id" class="jp-confirm__row">
                <BizCartItem
                  readonly
                  :name="item.name"
                  :image="hasRealCover(item.mainImageUrl) ? String(item.mainImageUrl) : ''"
                  :price-yuan="formatYuan(item.priceCent)"
                  :currency="t('order.currency')"
                  :qty="item.qty"
                  :qty-text="`${t('order.qtyPrefix')}${item.qty}`"
                  :invalid="item.invalid"
                  :invalid-text="item.invalidText || ''"
                  :invalid-badge="t('order.invalidBadge')"
                  delete-text=""
                />
              </view>
            </view>
          </BizPanel>
        </view>

        <!-- 备注 -->
        <view class="jp-pad jp-confirm__sec">
          <BizPanel>
            <view class="jp-confirm__sec-head">
              <text class="jp-confirm__sec-title">{{ t('order.noteSectionTitle') }}</text>
            </view>
            <view class="jp-confirm__note">
              <textarea
                class="jp-confirm__note-input"
                :value="userNote"
                :maxlength="NOTE_MAX"
                :placeholder="t('order.notePlaceholder')"
                placeholder-class="jp-confirm__note-ph"
                @input="onNoteInput"
              />
            </view>
          </BizPanel>
        </view>

        <!--
          ★★ 金额区（UI:mp.order_confirm.summary）：只有「商品合计」与「实付」两行。
          两行同源于 checkoutAmountCent —— 拼团价已含全部配送成本（REQ-ORDER-004），
          中间没有任何可以插入第三笔的地方。
        -->
        <view class="jp-pad jp-confirm__sec">
          <BizPanel>
            <view class="jp-confirm-sum">
              <view class="jp-confirm-sum__row">
                <text class="jp-confirm-sum__label">
                  {{ t('order.amountItemsLabel') }}
                  <text class="jp-confirm-sum__qty">
                    （{{ t('order.amountQtyPrefix') }} {{ totalQty }} {{ t('order.amountQtySuffix') }}）
                  </text>
                </text>
                <text class="jp-confirm-sum__val">
                  {{ t('order.currency') }}{{ amountYuan }}
                </text>
              </view>
              <view class="jp-confirm-sum__row is-pay">
                <text class="jp-confirm-sum__label">{{ t('order.amountPayLabel') }}</text>
                <view class="jp-confirm-sum__pay">
                  <text class="jp-confirm-sum__cur">{{ t('order.currency') }}</text>
                  <text class="jp-confirm-sum__total">{{ amountYuan }}</text>
                </view>
              </view>
              <text class="jp-confirm-sum__note">{{ t('order.amountIncluded') }}</text>
            </view>
          </BizPanel>
        </view>

        <view class="jp-confirm__spacer" />

        <!-- ★ 底部条：已阅读不支持退款（举证勾选）+ 提交订单 -->
        <view class="jp-confirm-bar">
          <view class="jp-confirm-agree">
            <view class="jp-confirm-agree__box-wrap" @tap="onToggleAgree">
              <view class="jp-confirm-agree__box" :class="{ 'is-on': agreedNoRefund }">
                <text v-if="agreedNoRefund" class="jp-confirm-agree__tick">✓</text>
              </view>
            </view>
            <text class="jp-confirm-agree__text" @tap="onToggleAgree">
              {{ t('order.agreeText') }}
            </text>
            <text class="jp-confirm-agree__link" @tap.stop="onOpenNotice">?</text>
          </view>

          <view class="jp-confirm-bar__main">
            <view class="jp-confirm-bar__sum">
              <text class="jp-confirm-bar__label">{{ t('order.amountPayLabel') }}</text>
              <text class="jp-confirm-bar__cur">{{ t('order.currency') }}</text>
              <text class="jp-confirm-bar__total">{{ amountYuan }}</text>
            </view>
            <view
              class="jp-confirm-bar__submit"
              :class="{ 'is-disabled': submitDisabled }"
              @tap="onSubmit"
            >
              <text class="jp-confirm-bar__submit-text">{{ submitText }}</text>
            </view>
          </view>
        </view>
      </template>

      <!-- ── 地址弹层：选择 ─────────────────────────────── -->
      <view v-if="addrSheet === 'pick'" class="jp-addr-mask" @tap="closeAddressSheet">
        <view class="jp-addr-sheet" @tap.stop>
          <text class="jp-addr-sheet__title">{{ t('order.addressSheetTitle') }}</text>
          <scroll-view class="jp-addr-sheet__list" scroll-y>
            <view
              v-for="addr in addressList"
              :key="addr.id"
              class="jp-addr-opt"
              :class="{ 'is-on': selectedAddress && selectedAddress.id === addr.id }"
              @tap="onPickAddress(addr)"
            >
              <view class="jp-addr-opt__head">
                <text class="jp-addr-opt__name">{{ addr.recipientName }}</text>
                <text class="jp-addr-opt__mobile">{{ addr.mobile }}</text>
                <BizTag v-if="Number(addr.isDefault) === 1" type="red">
                  {{ t('order.addressDefaultTag') }}
                </BizTag>
              </view>
              <text class="jp-addr-opt__line">{{ formatAddressLine(addr) }}</text>
            </view>
          </scroll-view>
          <view class="jp-addr-sheet__add" @tap="openAddressForm">
            <text class="jp-addr-sheet__add-text">{{ t('order.addressSheetAdd') }}</text>
          </view>
          <view class="jp-addr-sheet__close" @tap="closeAddressSheet">
            <text class="jp-addr-sheet__close-text">{{ t('order.addressSheetClose') }}</text>
          </view>
        </view>
      </view>

      <!-- ── 地址弹层：新增表单 ─────────────────────────── -->
      <view v-if="addrSheet === 'form'" class="jp-addr-mask" @tap="closeAddressSheet">
        <view class="jp-addr-sheet" @tap.stop>
          <text class="jp-addr-sheet__title">{{ t('order.addressFormTitle') }}</text>

          <view class="jp-addr-form">
            <view class="jp-addr-form__row">
              <text class="jp-addr-form__label">{{ t('order.addressFormName') }}</text>
              <input
                class="jp-addr-form__name"
                type="text"
                :value="addrForm.recipientName"
                :placeholder="t('order.addressFormNamePh')"
                placeholder-class="jp-addr-form__ph"
                @input="onFormInput('recipientName', $event)"
              >
            </view>

            <view class="jp-addr-form__row">
              <text class="jp-addr-form__label">{{ t('order.addressFormMobile') }}</text>
              <!--
                手机号用 type="number" 只为唤起数字键盘；它在 mp 上返回的是**字符串**，
                而后端 mobile 本来就是 String（@Pattern 校验 11 位）—— 不存在「数字字段收到字符串」
                那类 400。真正的数字字段（数量 / 金额）一律 type="digit" + 显式 cast。
              -->
              <input
                class="jp-addr-form__mobile"
                type="number"
                :maxlength="11"
                :value="addrForm.mobile"
                :placeholder="t('order.addressFormMobilePh')"
                placeholder-class="jp-addr-form__ph"
                @input="onFormInput('mobile', $event)"
              >
            </view>

            <picker
              class="jp-addr-form__region"
              mode="region"
              :value="[addrForm.province, addrForm.city, addrForm.district]"
              @change="onRegionChange"
            >
              <view class="jp-addr-form__row">
                <text class="jp-addr-form__label">{{ t('order.addressFormRegion') }}</text>
                <text
                  class="jp-addr-form__region-text"
                  :class="{ 'is-ph': !addrRegionText }"
                >
                  {{ addrRegionText || t('order.addressFormRegionPh') }}
                </text>
              </view>
            </picker>

            <view class="jp-addr-form__row is-detail">
              <text class="jp-addr-form__label">{{ t('order.addressFormDetail') }}</text>
              <input
                class="jp-addr-form__detail"
                type="text"
                :value="addrForm.detail"
                :placeholder="t('order.addressFormDetailPh')"
                placeholder-class="jp-addr-form__ph"
                @input="onFormInput('detail', $event)"
              >
            </view>
          </view>

          <view class="jp-addr-form__save" @tap="onSaveAddress">
            <text class="jp-addr-form__save-text">{{ t('order.addressFormSave') }}</text>
          </view>
          <view class="jp-addr-sheet__close" @tap="closeAddressSheet">
            <text class="jp-addr-sheet__close-text">{{ t('order.addressFormCancel') }}</text>
          </view>
        </view>
      </view>
    </view>
  </BizScreen>
</template>

<style lang="scss" scoped>
/* 页面左右内边距（不用 .block —— 与 UnoCSS 的 display:block 工具类同名会撞） */
.jp-pad {
  padding: 0 var(--c-gap-page);
}
.jp-confirm__state {
  padding-top: 24rpx;
}
.jp-confirm__sec {
  padding-top: 20rpx;
}

/* ── 区块头 ── */
.jp-confirm__sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 20rpx var(--c-gap-card) 12rpx;
  border-bottom: var(--c-divider);
}
.jp-confirm__sec-title {
  font-size: var(--c-fs-body);
  font-weight: 700;
  color: var(--c-ink);
}
.jp-confirm__sec-count {
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-3);
}

/* ── 收货地址卡 ── */
.jp-confirm-addr {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx var(--c-gap-card);
}
.jp-confirm-addr__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.jp-confirm-addr__head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.jp-confirm-addr__name {
  font-size: var(--c-fs-body);
  font-weight: 700;
  color: var(--c-ink);
}
.jp-confirm-addr__mobile {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
  font-variant-numeric: tabular-nums;
}
.jp-confirm-addr__empty {
  font-size: var(--c-fs-body);
  font-weight: 700;
  color: var(--c-red);
}
.jp-confirm-addr__line {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
  line-height: 1.5;
}
.jp-confirm-addr__change {
  flex-shrink: 0;
  font-size: var(--c-fs-xs);
  color: var(--c-ink-3);
}

/* ── 失效提示 ── */
.jp-confirm__invalid-tip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 16rpx var(--c-gap-card);
  border-radius: var(--c-radius);
  background: var(--c-amber-soft);
}
.jp-confirm__invalid-tip-text {
  font-size: var(--c-fs-xs);
  color: #8a5a10;
}
.jp-confirm__invalid-tip-btn {
  font-size: var(--c-fs-xs);
  font-weight: 700;
  color: #8a5a10;
  padding: 4rpx 10rpx;
  border-radius: 8rpx;
  background: rgba(255, 255, 255, 0.7);
}

/* ── 清单 ── */
.jp-confirm__row + .jp-confirm__row {
  border-top: var(--c-divider);
}

/* ── 备注 ── */
.jp-confirm__note {
  padding: 16rpx var(--c-gap-card) 20rpx;
}
.jp-confirm__note-input {
  width: 100%;
  min-height: 120rpx;
  box-sizing: border-box;
  padding: 16rpx;
  font-size: var(--c-fs-sm);
  color: var(--c-ink);
  line-height: 1.5;
  border-radius: var(--c-radius);
  background: var(--c-bg);
}
.jp-confirm__note-ph {
  color: var(--c-ink-3);
}

/* ── ★ 金额区（两行，无第三行）── */
.jp-confirm-sum {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 24rpx var(--c-gap-card);
}
.jp-confirm-sum__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}
.jp-confirm-sum__label {
  font-size: var(--c-fs-sm);
  color: var(--c-ink-2);
}
.jp-confirm-sum__qty {
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-3);
}
.jp-confirm-sum__val {
  font-size: var(--c-fs-sm);
  color: var(--c-ink);
  font-variant-numeric: tabular-nums;
}
.jp-confirm-sum__row.is-pay {
  padding-top: 12rpx;
  border-top: var(--c-divider);
}
.jp-confirm-sum__pay {
  display: flex;
  align-items: baseline;
  gap: 2rpx;
}
.jp-confirm-sum__cur {
  font-size: var(--c-fs-xs);
  font-weight: 700;
  color: var(--c-red);
}
.jp-confirm-sum__total {
  font-size: var(--c-fs-h2);
  font-weight: 700;
  color: var(--c-red);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.jp-confirm-sum__note {
  align-self: flex-end;
  font-size: var(--c-fs-3xs);
  color: var(--c-ink-3);
}

/* ── 底部固定条 ── */
.jp-confirm__spacer {
  height: 220rpx;
}
.jp-confirm-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 16rpx var(--c-gap-page);
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: saturate(180%) blur(16px);
  border-top: var(--c-bw-3) solid var(--c-line);
}

/* ★ 已阅读不支持退款 */
.jp-confirm-agree {
  display: flex;
  align-items: flex-start;
  gap: 10rpx;
}
.jp-confirm-agree__box-wrap {
  padding: 2rpx;
  flex-shrink: 0;
}
.jp-confirm-agree__box {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  box-sizing: border-box;
  border: 2rpx solid var(--c-ink-3);
  background: var(--c-surface);
  display: flex;
  align-items: center;
  justify-content: center;
}
.jp-confirm-agree__box.is-on {
  background: var(--c-red);
  border-color: var(--c-red);
}
.jp-confirm-agree__tick {
  font-size: var(--c-fs-2xs);
  font-weight: 700;
  line-height: 1;
  color: var(--c-on-dark);
}
.jp-confirm-agree__text {
  flex: 1;
  min-width: 0;
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-2);
  line-height: 1.4;
}
.jp-confirm-agree__link {
  flex-shrink: 0;
  width: 32rpx;
  height: 32rpx;
  line-height: 32rpx;
  text-align: center;
  font-size: var(--c-fs-2xs);
  font-weight: 700;
  color: var(--c-ink-3);
  border-radius: 50%;
  background: rgba(33, 29, 23, 0.06);
}

.jp-confirm-bar__main {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.jp-confirm-bar__sum {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 4rpx;
}
.jp-confirm-bar__label {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
}
.jp-confirm-bar__cur {
  font-size: var(--c-fs-xs);
  font-weight: 700;
  color: var(--c-red);
}
.jp-confirm-bar__total {
  font-size: var(--c-fs-h2);
  font-weight: 700;
  color: var(--c-red);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.jp-confirm-bar__submit {
  flex-shrink: 0;
  min-width: 240rpx;
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
.jp-confirm-bar__submit.is-disabled {
  background: #d9d4cb;
  box-shadow: none;
}
.jp-confirm-bar__submit-text {
  font-size: var(--c-fs-body);
  font-weight: 600;
  letter-spacing: 0.5rpx;
  color: var(--c-on-dark);
}

/* ── 地址弹层 ── */
.jp-addr-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(33, 29, 23, 0.45);
  display: flex;
  align-items: flex-end;
}
.jp-addr-sheet {
  width: 100%;
  box-sizing: border-box;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 24rpx var(--c-gap-page);
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  border-radius: 24rpx 24rpx 0 0;
  background: var(--c-surface);
}
.jp-addr-sheet__title {
  font-size: var(--c-fs-body);
  font-weight: 700;
  color: var(--c-ink);
  text-align: center;
  padding-bottom: 8rpx;
}
.jp-addr-sheet__list {
  max-height: 44vh;
}
.jp-addr-opt {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 20rpx 16rpx;
  border-radius: var(--c-radius);
  border: 2rpx solid transparent;
  background: var(--c-bg);
}
.jp-addr-opt + .jp-addr-opt {
  margin-top: 12rpx;
}
.jp-addr-opt.is-on {
  border-color: var(--c-red);
  background: var(--c-red-soft);
}
.jp-addr-opt__head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.jp-addr-opt__name {
  font-size: var(--c-fs-sm);
  font-weight: 700;
  color: var(--c-ink);
}
.jp-addr-opt__mobile {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
  font-variant-numeric: tabular-nums;
}
.jp-addr-opt__line {
  font-size: var(--c-fs-xs);
  color: var(--c-ink-2);
  line-height: 1.5;
}
.jp-addr-sheet__add,
.jp-addr-form__save,
.jp-addr-sheet__close {
  height: 84rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--c-radius);
}
.jp-addr-sheet__add {
  border: 2rpx dashed var(--c-line);
}
.jp-addr-sheet__add-text {
  font-size: var(--c-fs-sm);
  font-weight: 600;
  color: var(--c-red);
}
.jp-addr-form__save {
  background: var(--c-red);
  box-shadow: var(--c-shadow-btn);
}
.jp-addr-form__save-text {
  font-size: var(--c-fs-body);
  font-weight: 600;
  color: var(--c-on-dark);
}
.jp-addr-sheet__close-text {
  font-size: var(--c-fs-sm);
  color: var(--c-ink-3);
}

/* ── 地址表单 ── */
.jp-addr-form {
  display: flex;
  flex-direction: column;
}
.jp-addr-form__row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 4rpx;
  border-bottom: var(--c-divider);
}
.jp-addr-form__label {
  flex-shrink: 0;
  width: 140rpx;
  font-size: var(--c-fs-sm);
  color: var(--c-ink-2);
}
.jp-addr-form__name,
.jp-addr-form__mobile,
.jp-addr-form__detail,
.jp-addr-form__region-text {
  flex: 1;
  min-width: 0;
  font-size: var(--c-fs-sm);
  color: var(--c-ink);
}
.jp-addr-form__region-text.is-ph,
.jp-addr-form__ph {
  color: var(--c-ink-3);
}
</style>
