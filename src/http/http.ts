import type { CustomRequestOptions, IResponse } from '@/http/types'
import { useTokenStore } from '@/store/token'
import { isDoubleTokenMode } from '@/utils'
import { ResultEnum } from './tools/enum'

// 刷新 token 状态管理
let refreshing = false // 防止重复刷新 token 标识
// 续期期间挂起的请求队列：每项持有 replay（续期成功 → 带新 token 重发并 resolve）+ fail（续期失败 → reject），
// 保证续期成败都对**每个**挂起请求确定性 settle，不留孤儿 Promise（冷启动并发 401 卡死的真因，T1-001）。
let taskQueue: { replay: () => void, fail: () => void }[] = []

export function http<T>(options: CustomRequestOptions) {
  // 1. 返回 Promise 对象
  return new Promise<T>((resolve, reject) => {
    uni.request({
      ...options,
      dataType: 'json',
      // #ifndef MP-WEIXIN
      responseType: 'json',
      // #endif
      // 响应成功
      success: async (res) => {
        const responseData = res.data as IResponse<T>
        const { code } = responseData

        // 检查是否是401错误（包括HTTP状态码401或业务码401）
        const isTokenExpired = res.statusCode === 401 || code === 401

        if (isTokenExpired) {
          const tokenStore = useTokenStore()
          /* -------- 401 静默续期 ----------
           * 单 token（ADR-0009 / GZ-USER-006）：静默 wx-login 重签 sa-token，原请求自动 retry、用户无感；
           * 双 token：用 refreshToken 重签。把当前请求挂入续期队列，续期成功 → replay（带新 token 重发并
           * resolve）、失败 → fail（reject）。⚠️ 续期成败都必须让每个挂起请求确定性 settle，不留孤儿 Promise
           * （并发 401 时若只 reject 触发续期的首请求、丢弃其余队列，外层 Promise 永久 pending → 冷启动
           *   并发首屏请求把落地页卡死在 loading）。
           */
          taskQueue.push({
            replay: () => resolve(http<T>(options)),
            fail: () => reject(res),
          })
          if (!refreshing) {
            refreshing = true
            const renew = isDoubleTokenMode
              ? tokenStore.refreshToken().then(() => true).catch(() => false)
              : tokenStore.silentWxRenew()
            void renew.then((ok) => {
              refreshing = false
              const queued = taskQueue
              taskQueue = []
              if (ok) {
                // 续期成功：重放全部挂起请求（带新 token），各自 resolve
                queued.forEach(task => task.replay())
              }
              else {
                // 续期失败：先逐个 reject 全部挂起请求（不留孤儿），再静默清本地登录态。
                // 全程静默：不 reLaunch 登录页、也不弹「登录已过期」toast —— 游客浏览场次/商品时后台接口
                // 401 属正常，不该打扰浏览。需要登录的动作（提交预约等）由页面点按钮时 ensureLoggedIn
                // 弹底部登录 sheet（BizLoginSheet）承接，登录入口只此一处。
                // （logout skipBackend=true 防 logout 自身 401 死循环）
                queued.forEach(task => task.fail())
                void tokenStore.logout(true)
              }
            })
          }
          // 挂起等待续期结果（不在此处 settle）
          return
        }

        // 处理其他成功状态（HTTP状态码200-299）
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 处理业务逻辑错误
          if (code !== ResultEnum.Success0 && code !== ResultEnum.Success200) {
            !options.hideErrorToast
            && uni.showToast({
              icon: 'none',
              title: responseData.msg || responseData.message || '请求错误',
            })
            // rawBizError：reject 整个响应体，调用方才拿得到 code 决定动作（默认仍只给 data，行为不变）
            return reject(options.rawBizError ? responseData : responseData.data)
          }
          // ruoyi 两种成功响应形态：
          //   1) R<T> = { code, msg, data: T }（绝大多数端点）→ 返回 .data
          //   2) TableDataInfo<T> = { code, msg, rows, total }（分页端点直返，无 data 字段）→ 返回整对象
          const body = responseData as any
          if (body && Array.isArray(body.rows) && typeof body.total === 'number') {
            return resolve(body as unknown as T)
          }
          return resolve(responseData.data)
        }

        // 处理其他错误
        !options.hideErrorToast
        && uni.showToast({
          icon: 'none',
          title: (res.data as any).msg || '请求错误',
        })
        reject(res)
      },
      // 响应失败
      fail(err) {
        uni.showToast({
          icon: 'none',
          title: '网络错误，换个网络试试',
        })
        reject(err)
      },
    })
  })
}

/**
 * GET 请求
 * @param url 后台地址
 * @param query 请求query参数
 * @param header 请求头，默认为json格式
 * @returns
 */
export function httpGet<T>(url: string, query?: Record<string, any>, header?: Record<string, any>, options?: Partial<CustomRequestOptions>) {
  return http<T>({
    url,
    query,
    method: 'GET',
    header,
    ...options,
  })
}

/**
 * POST 请求
 * @param url 后台地址
 * @param data 请求body参数
 * @param query 请求query参数，post请求也支持query，很多微信接口都需要
 * @param header 请求头，默认为json格式
 * @returns
 */
export function httpPost<T>(url: string, data?: Record<string, any>, query?: Record<string, any>, header?: Record<string, any>, options?: Partial<CustomRequestOptions>) {
  return http<T>({
    url,
    query,
    data,
    method: 'POST',
    header,
    ...options,
  })
}
/**
 * PUT 请求
 */
export function httpPut<T>(url: string, data?: Record<string, any>, query?: Record<string, any>, header?: Record<string, any>, options?: Partial<CustomRequestOptions>) {
  return http<T>({
    url,
    data,
    query,
    method: 'PUT',
    header,
    ...options,
  })
}

/**
 * DELETE 请求（无请求体，仅 query）
 */
export function httpDelete<T>(url: string, query?: Record<string, any>, header?: Record<string, any>, options?: Partial<CustomRequestOptions>) {
  return http<T>({
    url,
    query,
    method: 'DELETE',
    header,
    ...options,
  })
}

// 支持与 axios 类似的API调用
http.get = httpGet
http.post = httpPost
http.put = httpPut
http.delete = httpDelete

// 支持与 alovaJS 类似的API调用
http.Get = httpGet
http.Post = httpPost
http.Put = httpPut
http.Delete = httpDelete
