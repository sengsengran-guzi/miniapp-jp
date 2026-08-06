/**
 * 商品详情（UI:mp.product_detail）纯逻辑层 —— GZ-JP-202。
 *
 * <p><b>纪律</b>（同 pages/index/index.logic.ts）：不 import uni / vue / 任何组件，纯函数，
 * 不出中文（文案归 locale），不读全局时钟。</p>
 *
 * <p>加购放行判定（{@code buildAddToCartState}）刻意<b>不在这里重写</b>，直接复用场详情逻辑层的
 * 同一个函数 —— 两个页面各写一份「怎么算能不能加购」是这类 bug 的经典温床。</p>
 */
import type { GzJpProductMpVO } from '@/api/gz-jp/product'
import { hasRealCover } from '@/api/gz-jp/format'

/* ============================================================
 * 1. 顶部轮播图（主图 + 图集）
 * ============================================================ */

/**
 * 组装顶部轮播图列表：<b>主图恒在最前</b>，其后接图集，去掉假图与重复项。
 *
 * <p>三件事一起做：</p>
 * <ol>
 *   <li><b>滤掉「后端占位图」</b> —— 后端无图时回落一个 mp 侧并不存在的静态路径，
 *       直接丢给 {@code <image>} 会 404 出白框（{@code hasRealCover} 判真假）；</li>
 *   <li><b>去重</b> —— 店员可能把主图也传进图集，不去重轮播会连着两张一样的；</li>
 *   <li><b>可能返回空数组</b> —— 一张真图都没有是合法状态，页面据此渲染内置占位块
 *       而不是一个高 600rpx 的空白 swiper。</li>
 * </ol>
 *
 * @param product 商品 VO（null → 空数组）
 * @returns 可直接喂 swiper 的 URL 列表（可能为空）
 */
export function buildGalleryImages(product: GzJpProductMpVO | null | undefined): string[] {
  if (!product) {
    return []
  }
  const candidates = [product.mainImageUrl, ...(product.galleryImageUrls ?? [])]
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of candidates) {
    if (!hasRealCover(raw)) {
      continue
    }
    const url = String(raw).trim()
    if (seen.has(url)) {
      continue
    }
    seen.add(url)
    out.push(url)
  }
  return out
}

/* ============================================================
 * 2. 数量 stepper
 * ============================================================ */

/** 加购数量下限（一次至少买 1 件）。 */
export const MIN_QUANTITY = 1

/**
 * 加购数量上限。
 *
 * <p>一期<b>没有库存字段</b>（集单预订本质不限量，「卖完」由店员手动下架表达），
 * 所以这里不是库存约束，只是一道防误触的合理上限（长按 + 号 / 手滑输入 999 件）。
 * 将来真要接库存，改成从 VO 取值即可，stepper 组件与本函数签名都不用动。</p>
 */
export const MAX_QUANTITY = 99

/**
 * 把任意输入收敛成合法数量。
 *
 * <p>非数 / NaN / 小数 / 越界一律夹到 {@code [min, max]}；小数向下取整
 * （「1.9 件」按 1 件算，不能凭空多算钱）。</p>
 *
 * @param value 原始值（stepper 输出 / 路由参数 / 恢复的草稿都可能脏）
 * @param min   下限（默认 {@link MIN_QUANTITY}）
 * @param max   上限（默认 {@link MAX_QUANTITY}）
 */
export function clampQuantity(
  value: unknown,
  min: number = MIN_QUANTITY,
  max: number = MAX_QUANTITY,
): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) {
    return min
  }
  const floored = Math.floor(n)
  if (floored < min) {
    return min
  }
  return floored > max ? max : floored
}

/* ============================================================
 * 3. ★ 注意事项区块（REQ-PROD-005 / UI:mp.product_detail.notice）
 * ============================================================ */

/**
 * 注意事项正文。
 *
 * <p><b>★ 区块本身恒定渲染，从不因为「商家没填」而消失</b> —— 这是甲方明确要的下单前风险
 * 告知位（谷子预订常见的「不支持退款」「到货可能延期」「介意慎拍」）。商家漏填时用
 * {@code fallback} 兜一段通用风险提示，而不是把整块隐藏掉：一个时有时无的告知位，
 * 客人形成不了阅读习惯，事后纠纷时也没有「页面上一直写着」这个立足点。</p>
 *
 * <p>返回值是<b>整段正文</b>，页面直接整段渲染（不做「查看更多 / 收起」的截断交互）。</p>
 *
 * @param noticeText 后端 {@code noticeText}（未填为 null）
 * @param fallback   商家没填时的兜底正文（由页面从 locale 传入）
 */
export function buildNoticeText(
  noticeText: string | null | undefined,
  fallback: string,
): string {
  const v = (noticeText ?? '').trim()
  return v || fallback
}

/* ============================================================
 * 4. 页面区块顺序（★ 注意事项必须在 CTA 之上）
 * ============================================================ */

/**
 * 商品详情页自上而下的区块顺序（UI:mp.product_detail）。
 *
 * <p>写成常量数组而不是只存在于模板里，是为了让「★ 注意事项排在 CTA 之上」这条<b>甲方硬要求</b>
 * 能被单测直接断言 —— 模板里的先后顺序改坏了没人拦得住，这里改坏了单测立刻红。</p>
 *
 * <p>模板必须按此顺序渲染；改模板顺序请同步改这里（单测锁死 notice 的下标必须小于 cta）。</p>
 */
export const SECTION_ORDER = [
  'gallery',
  'name',
  'price',
  'delivery',
  'notice',
  'cta',
] as const

export type ProductSection = typeof SECTION_ORDER[number]

/**
 * 「注意事项在 CTA 之上」是否成立（供单测断言，也可在开发期自检）。
 *
 * @param order 区块顺序（默认 {@link SECTION_ORDER}）
 */
export function noticeIsAboveCta(order: readonly ProductSection[] = SECTION_ORDER): boolean {
  const notice = order.indexOf('notice')
  const cta = order.indexOf('cta')
  return notice >= 0 && cta >= 0 && notice < cta
}
