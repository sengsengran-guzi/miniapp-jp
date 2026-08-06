/**
 * 拼团 mp 端「后端原始值 → 可展示值」适配层（GZ-JP-202 抽出）。
 *
 * <p><b>为什么在 api 目录而不是 utils</b>：这里每个函数都在补一条<b>后端契约</b>的坑
 * （后端发的时间串格式 / 后端无图时回落的占位路径 / 后端金额单位是分），
 * 契约变了要一起改。放 utils 会让人以为是通用工具、改后端时想不到来看。</p>
 *
 * <p><b>纪律</b>：纯函数，不 import uni / vue / 组件，<b>不出中文</b>
 * （可见文案归 locale，本层只返回结构化结果或纯数字串），不读全局时钟
 * （{@code now} 一律由调用方传入，测试才造得出「刚好等于开场时刻」这种边界）。</p>
 *
 * <p>GZ-JP-201 首页与 GZ-JP-202 场详情 / 商品详情共用。201 当时只有一个使用方，
 * 三个函数暂放在 pages/index/index.logic.ts；202 起有了第二个使用方，按约定上提到这里。
 * {@code index.logic.ts} 原样 re-export 这三个，201 的既有单测与页面 import 路径不受影响。</p>
 */
import { BACKEND_PLACEHOLDER_COVER } from './event'

/* ============================================================
 * 1. 时间解析（后端发 'yyyy-MM-dd HH:mm:ss'，不是 ISO）
 * ============================================================ */

/**
 * 匹配 {@code yyyy-MM-dd HH:mm[:ss]}，日期与时间之间允许空格或 'T'（两种都收，前后端谁改格式都不炸）。
 * 秒可选；毫秒 / 时区后缀直接忽略（后端 @JsonFormat 不带，真带了也不影响到分钟级判定）。
 */
const BACKEND_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/

/**
 * 解析后端时间串 → 本地毫秒时间戳。无效返回 {@code NaN}。
 *
 * <p>⚠️ <b>不能用 new Date(str) / Date.parse(str)</b>：iOS（真机 + 部分基础库）对
 * {@code '2026-08-07 10:00:00'} 这种空格分隔格式返回 Invalid Date，模拟器上却是好的 ——
 * 典型的「模拟器全绿、真机全崩」。这里按字段手工构造 {@code new Date(y, m-1, d, ...)}
 * （<b>本地时区</b>语义），与 {@link formatClock} 的读取方式对称，所以「解析后再格式化」
 * 恒等于原始墙钟时间，与运行环境时区无关。</p>
 *
 * @param value 后端时间串，如 '2026-08-07 10:00:00'
 * @returns 毫秒时间戳；null / 空串 / 格式不符 / 字段越界 → NaN
 */
export function parseBackendTime(value: string | null | undefined): number {
  if (!value) {
    return Number.NaN
  }
  const m = BACKEND_TIME_RE.exec(String(value).trim())
  if (!m) {
    return Number.NaN
  }
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = m[6] === undefined ? 0 : Number(m[6])
  // 手工范围校验：new Date(2026, 12, 40) 会静默滚到下一年，不校验就会把脏数据算成一个合法时间
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return Number.NaN
  }
  const d = new Date(year, month - 1, day, hour, minute, second, 0)
  // 反查月份：2 月 31 日这类「格式合法但日期不存在」的串会被 Date 滚到 3 月，这里拒掉
  if (d.getMonth() !== month - 1 || d.getDate() !== day) {
    return Number.NaN
  }
  return d.getTime()
}

/**
 * 毫秒时间戳 → {@code 'MM/DD HH:mm'}（本地时区，与 {@link parseBackendTime} 对称）。
 *
 * @param ms 毫秒时间戳
 * @returns 格式化串；NaN / 非有限值 → 空串
 */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) {
    return ''
  }
  const d = new Date(ms)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/* ============================================================
 * 2. 倒计时（场详情页头 UI:mp.event_detail）
 * ============================================================ */

/** 倒计时拆分结果（天 / 时 / 分 / 秒，均已借位，非累计值）。 */
export interface CountdownParts {
  days: number
  hours: number
  minutes: number
  seconds: number
}

/** 一秒 / 一分 / 一时 / 一天的毫秒数。 */
const MS_MIN = 60_000
const MS_HOUR = 60 * MS_MIN
const MS_DAY = 24 * MS_HOUR

/**
 * 剩余时间拆成天/时/分/秒。<b>已到点或时间不可用 → null</b>（调用方据此切「已结束」文案）。
 *
 * <p><b>刻意不返回负数倒计时</b>：负值倒计时（-00:00:03）是最常见的一类展示 bug，
 * 从源头收敛成 null 比在模板里到处判 {@code < 0} 稳。</p>
 *
 * <p>⚠️ 倒计时只是<b>展示</b>。能不能下单永远看后端 {@code eventBookable} /
 * {@code status}，不能拿这里归零与否当闸门（客户端时钟不可信 + 店员可手动关场）。</p>
 *
 * @param targetMs 目标时刻毫秒（如闭场时间）
 * @param nowMs    当前时刻毫秒（调用方传入）
 * @returns 拆分结果；已到点 / NaN → null
 */
export function countdownParts(targetMs: number, nowMs: number): CountdownParts | null {
  if (!Number.isFinite(targetMs) || !Number.isFinite(nowMs)) {
    return null
  }
  const left = targetMs - nowMs
  if (left <= 0) {
    return null
  }
  return {
    days: Math.floor(left / MS_DAY),
    hours: Math.floor((left % MS_DAY) / MS_HOUR),
    minutes: Math.floor((left % MS_HOUR) / MS_MIN),
    seconds: Math.floor((left % MS_MIN) / 1000),
  }
}

/**
 * 倒计时的「时:分:秒」部分 → {@code 'HH:mm:ss'}（天数由页面单独套 locale 拼「N 天」）。
 *
 * @param parts {@link countdownParts} 的结果
 * @returns 形如 {@code '05:12:33'}；null 入参 → 空串
 */
export function formatHms(parts: CountdownParts | null | undefined): string {
  if (!parts) {
    return ''
  }
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(parts.hours)}:${p2(parts.minutes)}:${p2(parts.seconds)}`
}

/* ============================================================
 * 3. 图片兜底
 * ============================================================ */

/**
 * 这个图片 URL 是不是「真有图」（场封面 / 商品主图 / 商品图集通用）。
 *
 * <p>后端无图时回落 {@link BACKEND_PLACEHOLDER_COVER}，但该静态文件在 miniapp-jp 里<b>不存在</b>，
 * 直接渲染会 404 出空白框。判 false 时由卡片 / 详情渲染内置占位块（有品牌感，比破图强）。</p>
 *
 * @param url 后端给的图片 URL
 */
export function hasRealCover(url: string | null | undefined): boolean {
  const v = (url ?? '').trim()
  if (!v) {
    return false
  }
  return v !== BACKEND_PLACEHOLDER_COVER
}

/* ============================================================
 * 4. 金额（后端单位是「分」）
 * ============================================================ */

/**
 * 价格（<b>分</b>）→ 元的<b>纯数字串</b>（不带 ¥，整元省小数，有角分保留 2 位）。
 *
 * <p><b>为什么不返回 '¥128'</b>：详情页价格是「小 ¥ + 大数字」两段不同字号的排版
 * （UI:mp.product_detail「价格大字」），拼死在一个字符串里就没法分别设字号了。
 * 货币符号由模板作为独立节点渲染。</p>
 *
 * <p>⚠️ 此价<b>已包邮</b>（REQ-ORDER-004），全系统无运费概念，任何页面都不得再叠加运费行。</p>
 *
 * @param cent 价格分；null / undefined / 非有限数 → 空串（调用方据此显示「价格待定」）
 * @returns 形如 {@code '128'} / {@code '128.50'}；无价 → 空串
 */
export function formatYuan(cent: number | null | undefined): string {
  if (cent == null || typeof cent !== 'number' || !Number.isFinite(cent)) {
    return ''
  }
  const yuan = cent / 100
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2)
}
