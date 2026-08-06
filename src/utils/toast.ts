/**
 * 全局 toast 工具（GZ-ADMIN-005 AC 4）。
 *
 * <p>封装 uni.showToast，统一以下纪律：</p>
 * <ul>
 *   <li>支持传 i18n key（如 `common.toastSuccess`），内部自动解；也支持直接传文本</li>
 *   <li>duration 默认 2000ms，符合微信小程序设计规范</li>
 *   <li>icon 类型限定 success / error / none / loading（uni-app 平台对齐）</li>
 *   <li>支持 mask（默认 false，避免阻塞用户操作；loading 场景配合 useLoading 用 mask=true）</li>
 * </ul>
 *
 * <p>组件库无关纪律（CLAUDE.md §7.5）：业务代码统一调 toastXxx() 系列函数，
 * 不直接调 uni.showToast。未来切换组件库或换 toast 实现只改本文件。</p>
 *
 * <p>关联文档：跨层契约必背（kevin-coder.md）/ GZ-ADMIN-005 任务卡 AC 4</p>
 */
import { t } from '@/locale/common.zh-CN'

/** uni.showToast icon 类型 */
export type ToastIcon = 'success' | 'error' | 'none' | 'loading'

/** toast 选项 */
export interface ToastOptions {
  /** 显示文本，或 i18n key（如 `common.toastSuccess`） */
  title: string
  /** 图标，默认 none */
  icon?: ToastIcon
  /** 持续时长（ms），默认 2000 */
  duration?: number
  /** 是否显示透明蒙层防止触摸穿透，默认 false */
  mask?: boolean
}

/**
 * 解析文案 — 若以 `xxx.yyy` 形式且 t() 能命中则走 i18n，否则原样返回。
 *
 * @internal
 */
function resolveText(input: string): string {
  if (!input)
    return ''
  if (input.includes('.')) {
    const resolved = t(input)
    // t() 找不到时返回 key 本身，此时回退到 input（视为字面文案）
    return resolved === input ? input : resolved
  }
  return input
}

/**
 * 通用 toast 入口。
 *
 * @example
 * showToast({ title: 'common.toastSuccess', icon: 'success' })
 * showToast({ title: '提交成功，等待审核', icon: 'success', duration: 1500 })
 */
export function showToast(options: ToastOptions): void {
  uni.showToast({
    title: resolveText(options.title),
    icon: options.icon ?? 'none',
    duration: options.duration ?? 2000,
    mask: options.mask ?? false,
  })
}

/**
 * 成功 toast（icon=success 默认 1500ms — 比通用更短，符合「闪现确认」交互）。
 */
export function toastSuccess(titleOrKey: string = 'common.toastSuccess', duration: number = 1500): void {
  showToast({ title: titleOrKey, icon: 'success', duration })
}

/**
 * 错误 toast（icon=error 默认 2000ms — 略长给用户读完错因）。
 *
 * <p>注：mp-weixin 平台 icon=error 在低版本基础库可能降级为 none，业务侧不依赖图标视觉。</p>
 */
export function toastError(titleOrKey: string = 'common.toastFailed', duration: number = 2000): void {
  showToast({ title: titleOrKey, icon: 'error', duration })
}

/**
 * 信息 toast（icon=none 默认 2000ms — 中性提示，无图标）。
 */
export function toastInfo(titleOrKey: string, duration: number = 2000): void {
  showToast({ title: titleOrKey, icon: 'none', duration })
}

/**
 * 网络异常 toast — 业务侧统一调本函数（catch 块兜底用）。
 */
export function toastNetworkError(): void {
  showToast({ title: 'common.toastNetworkError', icon: 'none', duration: 2000 })
}

/**
 * 隐藏当前 toast / loading。
 */
export function hideToast(): void {
  uni.hideToast()
}
