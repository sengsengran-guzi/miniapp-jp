<script lang="ts" setup>
import type { EventGroupKey, EventTiming } from './index.logic'
/**
 * GZ-JP-201 — 首页（tabbar 第 1 格，启动落地页）。UI:mp.home。
 *
 * <p>Kevin 拍板做<b>聚合</b>而非裸场列表，自上而下三块：</p>
 * <ol>
 *   <li><b>轮播 banner</b> —— sys_config 后台可配；一期无运营内容，
 *       无配置时降级为单张默认图（BizHomeBanner 内置品牌占位块），<b>绝不出空轮播</b></li>
 *   <li><b>拼团场次</b> —— 纵向卡片流，分「进行中 / 即将开始 / 已结束」三组，进行中置顶</li>
 *   <li><b>我的订单快捷入口</b> —— 带待收货单数角标</li>
 * </ol>
 *
 * <p><b>分组是纯展示派生</b>（进行中 = status==='open' && startTime<=now），
 * 判定逻辑与边界兜底全在 ./index.logic.ts（有 41 条单测）。
 * <b>能不能下单永远看 status/eventBookable，不看这里的分组</b>（GZ-JP-202 加购置灰按 eventBookable）。</p>
 *
 * <p><b>游客优先</b>：场列表匿名可读（后端 &#64;SaIgnore），首页整页不需要登录态；
 * 只有点「我的订单」才 ensureLoggedIn 弹协议同意 sheet（登录入口收口在 BizLoginSheet）。</p>
 *
 * <p>关联蓝图：UI:mp.home / UI:mp.home.banner / UI:mp.home.event_card / UI:mp.home.order_entry
 * / UI:global.theme（token 走 var(--c-*)，禁硬编码 hex）</p>
 */
import type { HomeBannerItem } from '@/api/gz-common'
import type { GzJpEventMpVO } from '@/api/gz-jp/event'
import { onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { fetchHomeBanners } from '@/api/gz-common'
import { fetchEventList } from '@/api/gz-jp/event'
import { useAuth } from '@/hooks/useAuth'
import { t } from '@/locale/home.zh-CN'
import {
  buildBannerSlides,
  buildEventRoute,
  buildEventTiming,
  formatBadgeCount,
  groupEvents,
  hasRealCover,
  ORDER_LIST_ROUTE,
} from './index.logic'

defineOptions({ name: 'GzJpHome' })

definePage({
  type: 'home',
  style: {
    navigationBarTitleText: '谷子宇宙拼团',
  },
})

const { ensureLoggedIn } = useAuth()

/* ── 1. 轮播 banner ───────────────────────────────────────── */

const banners = ref<HomeBannerItem[]>([])
/** 永不为空：无配置 / 拉取失败 → 单张默认图（不塌陷，见 index.logic.ts） */
const bannerSlides = computed(() => buildBannerSlides(banners.value))

/* ── 2. 场次 ──────────────────────────────────────────────── */

const events = ref<GzJpEventMpVO[]>([])
const loading = ref(true)
const loadFailed = ref(false)
/**
 * 分组时基。每次拉取时快照一次而不是在 computed 里读 Date.now()：
 * computed 读实时时钟会让分组结果随渲染时机漂移（同一帧内两次读到不同值），
 * 且无法在测试/排障时复现。跨过开场时刻的重新分组由下次 onShow 拉取带上。
 */
const nowMs = ref(Date.now())

/** 固定 3 组（含空组），顺序恒为 进行中 → 即将开始 → 已结束。 */
const eventGroups = computed(() => groupEvents(events.value, nowMs.value))
/**
 * 只渲染有内容的组。
 * 先 filter 再 v-for（而不是 v-for + v-if）：Vue 3 里 v-if 优先级高于 v-for 不能同元素并用，
 * 而套一层空壳 view 会让「组间距」的相邻选择器把空组也算进去、多出一段空白。
 */
const visibleGroups = computed(() => eventGroups.value.filter(g => g.events.length > 0))

const GROUP_LABEL_KEY: Record<EventGroupKey, string> = {
  live: 'home.groupLive',
  upcoming: 'home.groupUpcoming',
  ended: 'home.groupEnded',
}

function groupLabel(key: EventGroupKey): string {
  return t(GROUP_LABEL_KEY[key])
}

/** 把 {kind, at} 结构化时间套上 locale 组成整句（i18n 归页面，纯逻辑层不出中文）。 */
function timingText(timing: EventTiming): string {
  switch (timing.kind) {
    case 'deadline':
      return `${t('home.timingDeadline')} ${timing.at}`
    case 'start':
      return `${timing.at} ${t('home.timingStart')}`
    case 'endedAt':
      return `${t('home.timingEndedPrefix')} ${timing.at} ${t('home.timingEndedSuffix')}`
    default:
      return ''
  }
}

/** 卡片封面：后端无图会回落一个 mp 侧并不存在的占位路径，一律当无封面处理。 */
function cardCover(event: GzJpEventMpVO): string {
  return hasRealCover(event.coverImageUrl) ? (event.coverImageUrl as string) : ''
}

function cardTiming(event: GzJpEventMpVO, group: EventGroupKey): string {
  return timingText(buildEventTiming(event, group))
}

/* ── 3. 我的订单入口 ──────────────────────────────────────── */

/**
 * 待收货单数角标。
 *
 * <p>⚠️ <b>本卡是占位常量 0</b> —— 订单域后端接口（GZ-JP-105）与订单页（GZ-JP-205）都还没上线，
 * 现在没有任何可查的真实数据。0 会被 formatBadgeCount 收敛成空串 → 角标不渲染
 * （不会显示一个误导性的「0」）。GZ-JP-205 实施时把这里换成订单统计接口的返回值即可，
 * 组件与格式化都不用动。</p>
 */
const pendingOrderCount = ref(0)
const orderBadge = computed(() => formatBadgeCount(pendingOrderCount.value))

/* ── 取数 ────────────────────────────────────────────────── */

/** banner 与场列表各自独立降级：banner 挂了不影响场列表，反之亦然。 */
async function loadBanners() {
  // fetchHomeBanners 内部已吞掉解析/网络异常并返 []，这里不需要再 try
  banners.value = await fetchHomeBanners()
}

async function loadEvents() {
  loadFailed.value = false
  try {
    const page = await fetchEventList()
    // 分页端点返回 { rows, total }（http.ts 对 TableDataInfo 直返整对象，不是 .data）
    events.value = page?.rows ?? []
    nowMs.value = Date.now()
  }
  catch (e) {
    console.warn('[jp-home] loadEvents failed', e)
    loadFailed.value = true
    events.value = []
  }
  finally {
    loading.value = false
  }
}

/**
 * 刷新首页数据。已有场数据时<b>静默刷新</b>（不闪 loading 骨架）——
 * onShow 每次切回 tab 都会跑，每次都亮骨架会让列表反复闪一下。
 */
async function reload() {
  if (!events.value.length) {
    loading.value = true
  }
  await Promise.all([loadBanners(), loadEvents()])
}

/* ── 交互 ────────────────────────────────────────────────── */

/** 站内 tabBar 页（只能 switchTab，navigateTo 会失败）。 */
const TAB_ROUTES = ['/pages/index/index', '/pages/me/index']

/**
 * banner 点击：站内路由分流。
 *
 * <p>⚠️ 入参刻意收 unknown 后再判类型：BizHomeBanner 用的是<b>带 payload 的 $emit('tap', link)</b>，
 * 而 mp 里子节点的原生 tap 也会冒泡到 &lt;biz-home-banner&gt; 的 bindtap 上 —— 那一路进来的实参是
 * <b>原生事件对象</b>而不是字符串。直接 {@code link.startsWith()} 会在真机上抛 TypeError。
 * （项目里其它卡片组件都是无 payload 的 emit('tap')，不受影响；本组件是全项目第一处带 payload 的用法。）</p>
 */
function onBannerTap(link: unknown) {
  if (typeof link !== 'string' || !link) {
    return
  }
  if (TAB_ROUTES.some(r => link.startsWith(r))) {
    uni.switchTab({ url: link })
    return
  }
  uni.navigateTo({ url: link, fail: () => uni.showToast({ title: link, icon: 'none' }) })
}

/**
 * 点场卡 → 场详情页。
 * 目标页由 <b>GZ-JP-202</b> 交付；未上线期间 navigateTo 会 fail，兜一个 toast 而不是静默无反应。
 * 202 合并后此路由自然可达，本函数无需改动。
 */
function onEventTap(event: GzJpEventMpVO) {
  uni.navigateTo({
    url: buildEventRoute(event),
    fail: () => uni.showToast({ title: t('home.eventDetailComingSoon'), icon: 'none' }),
  })
}

/**
 * 点订单入口 → 订单列表页（需登录：游客点这里会弹协议同意 sheet 走微信登录）。
 * 目标页由 <b>GZ-JP-205</b> 交付；未上线期间同样兜 toast。
 */
async function onOrderEntryTap() {
  if (!(await ensureLoggedIn())) {
    return
  }
  uni.navigateTo({
    url: ORDER_LIST_ROUTE,
    fail: () => uni.showToast({ title: t('home.orderComingSoon'), icon: 'none' }),
  })
}

onShow(() => {
  void reload()
})
</script>

<template>
  <BizScreen>
    <!-- ① 轮播 banner（banner 即 hero；无配置降级单张默认图，不出空轮播） -->
    <view class="jp-pad jp-home__banner">
      <BizHomeBanner :banners="bannerSlides" @tap="onBannerTap" />
    </view>

    <!-- ② 拼团场次：三组，进行中置顶 -->
    <view class="section-title-wrap">
      <BizSectionTitle :title="t('home.eventSectionTitle')" />
    </view>
    <view class="jp-home__events">
      <view v-if="loading" class="jp-pad">
        <BizPanel>
          <BizState variant="loading" :text="t('home.eventLoading')" />
        </BizPanel>
      </view>

      <view v-else-if="loadFailed" class="jp-pad">
        <BizPanel>
          <BizState
            variant="error"
            :text="t('home.eventError')"
            :sub="t('home.eventErrorSub')"
            :cta-text="t('home.retry')"
            @cta="reload"
          />
        </BizPanel>
      </view>

      <view v-else-if="!events.length" class="jp-pad">
        <BizPanel>
          <BizState
            variant="empty"
            emoji="🧧"
            :text="t('home.eventEmpty')"
            :sub="t('home.eventEmptySub')"
          />
        </BizPanel>
      </view>

      <template v-else>
        <view v-for="group in visibleGroups" :key="group.key" class="jp-home__group">
          <view class="jp-home__group-head">
            <text class="jp-home__group-title">{{ groupLabel(group.key) }}</text>
            <text class="jp-home__group-count">{{ group.events.length }}</text>
          </view>
          <view v-for="event in group.events" :key="event.id" class="jp-pad jp-home__card">
            <BizEventCard
              :name="event.name"
              :cover="cardCover(event)"
              :description="event.description || ''"
              :status-label="groupLabel(group.key)"
              :timing-text="cardTiming(event, group.key)"
              :tone="group.key"
              @tap="onEventTap(event)"
            />
          </view>
        </view>
      </template>
    </view>

    <!-- ③ 我的订单快捷入口（带待收货单数角标） -->
    <view class="section-title-wrap">
      <BizSectionTitle :title="t('home.orderSectionTitle')" />
    </view>
    <view class="jp-pad jp-home__order">
      <BizEntryCard
        icon="🧾"
        :title="t('home.orderEntryTitle')"
        :sub="t('home.orderEntrySub')"
        :badge="orderBadge"
        @tap="onOrderEntryTap"
      />
    </view>
  </BizScreen>
</template>

<style lang="scss" scoped>
/* 页面左右内边距（不用 .block —— 与 UnoCSS 的 display:block 工具类同名会撞） */
.jp-pad {
  padding: 0 var(--c-gap-page);
}
/* 页面底部留白（tabbar 之上） */
.jp-home__order {
  padding-bottom: 48rpx;
}
/* 区块间距：每个区块标题上方统一留白 */
.section-title-wrap {
  padding-top: 32rpx;
}
/* 标题与其内容的小间距（压掉 BizSectionTitle 自带 20rpx，仅本页） */
.section-title-wrap :deep(.biz-section-title) {
  padding-bottom: 12rpx;
}
/* 组间距 */
.jp-home__group + .jp-home__group {
  padding-top: 20rpx;
}
.jp-home__group-head {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding: 8rpx var(--c-gap-page) 12rpx;
}
.jp-home__group-title {
  font-size: var(--c-fs-sm);
  font-weight: 600;
  color: var(--c-ink-2);
}
.jp-home__group-count {
  font-size: var(--c-fs-2xs);
  color: var(--c-ink-3);
}
/* 卡片之间的竖向间距 */
.jp-home__card + .jp-home__card {
  padding-top: 16rpx;
}
</style>
