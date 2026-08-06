/**
 * GZ-PAY-001 微信支付 V3 通道 API（小程序端）
 *
 * 字段权威：doc/11 §4.2 gz_pay_transaction
 * 后端契约：与 ruoyi-gz-common pay 模块严格对齐
 *
 * 端点：
 *   - POST /system/gz/pay/test/create-order        发起测试单（dev 测试，返回 5 参 + outTradeNo）
 *   - POST /system/gz/pay/test/simulate-callback    模拟回调（mock profile 闭环，驱动 paid）
 *   - GET  /app/gz/pay/transaction/{outTradeNo}/status   查支付状态（result.vue 轮询）
 *
 * ID 字段全部 string（跨层契约：Java Long ↔ JS number 精度坑）。
 */
import { http } from '@/http/http'

/** mp 端 uni.requestPayment 5 参 + out_trade_no（与 MpPayParamsVO.java 对齐） */
export interface MpPayParamsVO {
  timeStamp: string
  nonceStr: string
  /** 后端字段名 packageVal（uni.requestPayment 入参为 package） */
  packageVal: string
  signType: string
  paySign: string
  outTradeNo: string
}

/** 支付订单状态 VO（result.vue 轮询用，doc/11 §4.2 子集） */
export interface PayTransactionStatusVO {
  id: string
  outTradeNo: string
  businessType: string
  amountCent: number
  status: string
  transactionId?: string | null
  paidTime?: string | null
}

/**
 * 发起 0.01 元测试支付单。
 *
 * <p>V1.0 通道 HelloWorld：返回 mp 端 uni.requestPayment 可用的 5 参。
 * dev mock profile 下 paySign 为占位（不连真实微信）。</p>
 */
export function createTestOrder(amountCent: number, openid?: string): Promise<MpPayParamsVO> {
  return http<MpPayParamsVO>({
    url: '/system/gz/pay/test/create-order',
    method: 'POST',
    data: { amountCent, openid },
  })
}

/**
 * 模拟微信回调（仅 dev / mock profile）—— 驱动订单为已支付，等价真实微信回调。
 *
 * <p>真机真实微信支付时不需要调此端点（微信会真回调 /api/pay/v3/notify）；
 * 商户号未到位的 dev 联调期用它让 result.vue 轮询看到 status=paid。</p>
 */
export function simulateCallback(outTradeNo: string): Promise<void> {
  return http<void>({
    url: '/system/gz/pay/test/simulate-callback',
    method: 'POST',
    query: { outTradeNo },
  })
}

/**
 * 查支付单状态（result.vue 轮询等回调到达 paid）。
 */
export function getPayStatus(outTradeNo: string): Promise<PayTransactionStatusVO> {
  return http<PayTransactionStatusVO>({
    url: `/app/gz/pay/transaction/${outTradeNo}/status`,
    method: 'GET',
  })
}
