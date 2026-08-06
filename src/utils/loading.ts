/**
 * 全局 loading 工具（GZ-ADMIN-005 AC 4）。
 *
 * <p>封装 uni.showLoading / uni.hideLoading，自动 try-finally：</p>
 * <ul>
 *   <li>{@link withLoading} 高阶函数：传入异步任务，自动 show/hide，异常仍向上抛</li>
 *   <li>{@link showLoading} / {@link hideLoading}：底层手动控制（少用，复杂分支用 withLoading）</li>
 * </ul>
 *
 * <p>纪律：</p>
 * <ul>
 *   <li>支持 i18n key（如 `common.toastLoading`）</li>
 *   <li>mask 默认 true — loading 期间禁止用户操作，避免重复提交（与 toast 默认相反）</li>
 *   <li>并发计数：多个 withLoading 嵌套时只在外层 show / 全部完成后 hide</li>
 * </ul>
 *
 * <p>关联文档：GZ-ADMIN-005 任务卡 AC 4 / 强约束 #4 (i18n 走 t)</p>
 */
import { t } from '@/locale/common.zh-CN'

/** loading 选项 */
export interface LoadingOptions {
  /** 显示文本，或 i18n key（如 `common.toastLoading`） */
  title?: string
  /** 是否显示透明蒙层防止触摸穿透，默认 true（loading 默认阻塞） */
  mask?: boolean
}

/** 并发计数 — 嵌套场景下保证 show/hide 配对 */
let _loadingCount = 0

/**
 * 解析文案 — 与 toast.ts 同款逻辑（独立保留以避免循环依赖）。
 *
 * @internal
 */
function resolveText(input: string): string {
  if (!input)
    return ''
  if (input.includes('.')) {
    const resolved = t(input)
    return resolved === input ? input : resolved
  }
  return input
}

/**
 * 显示 loading（与 hideLoading 配对调用，复杂分支请用 withLoading）。
 *
 * @example
 * showLoading({ title: 'common.toastSubmitting' })
 * try { await submitOrder() } finally { hideLoading() }
 */
export function showLoading(options: LoadingOptions = {}): void {
  _loadingCount++
  if (_loadingCount === 1) {
    uni.showLoading({
      title: resolveText(options.title || 'common.toastLoading'),
      mask: options.mask ?? true,
    })
  }
}

/**
 * 隐藏 loading（并发计数到 0 才真正隐藏）。
 */
export function hideLoading(): void {
  if (_loadingCount > 0) {
    _loadingCount--
  }
  if (_loadingCount === 0) {
    uni.hideLoading()
  }
}

/**
 * 强制清空 loading 计数 + 隐藏（用于异常恢复场景，如全局错误处理）。
 */
export function forceHideLoading(): void {
  _loadingCount = 0
  uni.hideLoading()
}

/**
 * 高阶函数：包裹异步任务，自动 show/hide loading（推荐用法）。
 *
 * <p>异常仍会向上抛 — 调用方应自行处理（toast 提示 / 业务回滚等）。</p>
 *
 * @param task 异步任务函数
 * @param options loading 选项
 * @returns 任务的 promise 结果
 *
 * @example
 * await withLoading(async () => {
 *   await submitPaidBooking(payload)
 *   toastSuccess('common.toastSaved')
 * }, { title: 'common.toastSubmitting' })
 */
export async function withLoading<T>(
  task: () => Promise<T>,
  options: LoadingOptions = {},
): Promise<T> {
  showLoading(options)
  try {
    return await task()
  }
  finally {
    hideLoading()
  }
}
