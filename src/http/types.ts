/**
 * 在 uniapp 的 RequestOptions 和 IUniUploadFileOptions 基础上，添加自定义参数
 */
export type CustomRequestOptions = UniApp.RequestOptions & {
  query?: Record<string, any>
  /** 出错时是否隐藏错误提示（业务错误 code!=200 与 HTTP 非 2xx 都生效） */
  hideErrorToast?: boolean
  /**
   * 业务错误（HTTP 200 + body code != 200）时 reject <b>整个响应体</b> {@code { code, msg, data }}
   * 而不是默认的 {@code responseData.data}。
   *
   * <p><b>为什么需要</b>：默认行为下 data 在业务错误时恒为 null，调用方拿不到 code，
   * 于是没法区分「商品失效要退回购物车」（4102）与「价格变了要刷新本页」（4104）——
   * 两者的正确动作完全不同，不能都只 toast 一下了事。</p>
   *
   * <p><b>默认关</b>：既有页面的 catch 分支一行不用改。开启方用
   * {@code bizErrorCodeOf(e)} 取码（见 api/gz-jp/order.ts）。</p>
   */
  rawBizError?: boolean
} & IUniUploadFileOptions // 添加uni.uploadFile参数类型

/** 主要提供给 openapi-ts-request 生成的代码使用 */
export type CustomRequestOptions_ = Omit<CustomRequestOptions, 'url'>

export interface HttpRequestResult<T> {
  promise: Promise<T>
  requestTask: UniApp.RequestTask
}

// 通用响应格式（兼容 msg + message 字段）
export type IResponse<T = any> = {
  code: number
  data: T
  message: string
  [key: string]: any // 允许额外属性
} | {
  code: number
  data: T
  msg: string
  [key: string]: any // 允许额外属性
}

// 分页请求参数
export interface PageParams {
  page: number
  pageSize: number
  [key: string]: any
}

// 分页响应数据
export interface PageResult<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}
