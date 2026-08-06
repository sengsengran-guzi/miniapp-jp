/**
 * useCountdown — 截止倒计时 composable（GZ-ORD-102 决策 D4 / R2）。
 *
 * <p>以接口返回的 {@code serverNow}（服务器时间）为基准起算，<b>不用本地 Date.now() 直接对比 deadline</b>
 * （防客户端改表，偏差 < 1min 用户无感）。挂载时记录「serverNow 与本地时钟的偏移」，每秒用
 * 本地时钟 + 偏移推算「校准后的当前时间」，再与 deadline 求差。归零返回 expired=true。</p>
 *
 * <p>组件库无关：纯 Vue ref + setInterval，{@code onUnmounted} 清理（强约束 #5 防泄漏）。</p>
 *
 * 纯计算 {@link computeRemaining} 抽出供单测（AC7 ① 倒计时含归零分支）。
 */
import { onUnmounted, ref } from 'vue'

/** 倒计时剩余结构。 */
export interface CountdownRemaining {
  /** 是否已归零（截止）。归零后 days/hours/minutes/seconds 均为 0 */
  expired: boolean
  /** 剩余天 */
  days: number
  /** 剩余小时（0-23） */
  hours: number
  /** 剩余分（0-59） */
  minutes: number
  /** 剩余秒（0-59） */
  seconds: number
  /** 剩余总毫秒（>= 0） */
  totalMs: number
}

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/**
 * 纯计算：给定「校准后的当前时间」与「截止时间」（均为毫秒时间戳），算剩余天时分秒。
 * 差 <= 0 → expired=true 且全 0（归零分支）。
 *
 * @param calibratedNowMs 校准后的当前时间（serverNow + 本地流逝），毫秒
 * @param deadlineMs      截止时间，毫秒
 */
export function computeRemaining(calibratedNowMs: number, deadlineMs: number): CountdownRemaining {
  const diff = deadlineMs - calibratedNowMs
  if (diff <= 0) {
    return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0 }
  }
  return {
    expired: false,
    days: Math.floor(diff / DAY),
    hours: Math.floor((diff % DAY) / HOUR),
    minutes: Math.floor((diff % HOUR) / MIN),
    seconds: Math.floor((diff % MIN) / SEC),
    totalMs: diff,
  }
}

/**
 * 解析 ISO8601（"yyyy-MM-ddTHH:mm:ss"）→ 毫秒。无效返回 NaN。
 * mp（iOS）对 "yyyy-MM-dd HH:mm:ss" 解析不稳，后端已统一发 'T' 分隔的 ISO，这里直接 Date.parse。
 */
export function parseIsoMs(iso: string | null | undefined): number {
  if (!iso) {
    return Number.NaN
  }
  return new Date(iso).getTime()
}

/**
 * 倒计时 composable。传入 ISO 截止时间 + 服务器当前时间，返回每秒刷新的剩余 ref。
 *
 * @param deadlineIso  截止时间 ISO8601
 * @param serverNowIso 服务器当前时间 ISO8601（接口外层返回；缺省回退本地时钟）
 * @returns remaining ref（响应式，每秒更新）
 */
export function useCountdown(deadlineIso: string, serverNowIso?: string) {
  const deadlineMs = parseIsoMs(deadlineIso)
  // serverNow 与本地时钟的偏移（serverNow - localNow）。后续校准当前时间 = localNow + offset
  const serverMs = parseIsoMs(serverNowIso)
  const offset = Number.isNaN(serverMs) ? 0 : serverMs - Date.now()

  const remaining = ref<CountdownRemaining>(tick())

  function tick(): CountdownRemaining {
    if (Number.isNaN(deadlineMs)) {
      return { expired: true, days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0 }
    }
    return computeRemaining(Date.now() + offset, deadlineMs)
  }

  let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
    remaining.value = tick()
    if (remaining.value.expired && timer) {
      // 归零后停表，省资源
      clearInterval(timer)
      timer = null
    }
  }, SEC)

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  onUnmounted(stop)

  return { remaining, stop }
}
