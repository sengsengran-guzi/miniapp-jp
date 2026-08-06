/**
 * 通用文案（zh-CN）。
 *
 * <p>{@code common.*} — toast / loading / 通用按钮文案（utils/toast.ts / utils/loading.ts 消费）。</p>
 *
 * <p>遵循 CLAUDE.md §6 #9：默认 zh-CN，**不混 emoji**。当前不引 vue-i18n 全套
 * （轻量化策略，与 auth.zh-CN.ts 同款），后续统一接入时把本文件转 messages JSON，
 * key 命名沿用 `<scope>.<key>`。</p>
 */

const commonZhCN = {
  /** 通用 toast 文案 */
  toastSuccess: '操作成功',
  toastFailed: '操作失败',
  toastNetworkError: '网络异常，请稍后重试',
  toastSaved: '已保存',
  toastCopied: '已复制',
  toastLoading: '加载中',
  toastSubmitting: '提交中',

  /** 通用按钮文案 */
  btnConfirm: '确认',
  btnCancel: '取消',
  btnBack: '返回',
  btnRetry: '重试',
  btnBackHome: '返回首页',
} as const

export type CommonMessageKey = keyof typeof commonZhCN

/**
 * 简化版 t()：从字符串常量表里取值（与 auth.zh-CN.ts t() 同款签名）。
 *
 * @param key 文案 key，形如 `common.toastSuccess`
 * @returns 中文文案，找不到时返回 key 本身（便于调试）
 */
export function t(key: string): string {
  if (key.startsWith('common.')) {
    const subKey = key.slice('common.'.length) as CommonMessageKey
    return commonZhCN[subKey] ?? key
  }
  return key
}
