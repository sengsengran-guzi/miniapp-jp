/**
 * 收货地址簿 mp 端 API（后端 {@code GzUserAddressMpController}，GZ-USER-003）。
 *
 * <p>路径 {@code /app/gz/user/address/*}，<b>全部需登录态</b>（地址是用户私有数据）。
 * 两个小程序共用同一后端与同一份地址簿（按 clientid 只影响 appid 路由，不影响数据归属）。</p>
 *
 * <ul>
 *   <li>{@code GET    /list}          — 列表（默认地址置顶 + 创建时间倒序，后端已排好）</li>
 *   <li>{@code GET    /{id}}          — 详情（仅本人）</li>
 *   <li>{@code POST   /}              — 新增（body 不带 id）</li>
 *   <li>{@code PUT    /}              — 编辑（body 带 id）</li>
 *   <li>{@code DELETE /{id}}          — 软删</li>
 *   <li>{@code POST   /{id}/default}  — 设为默认</li>
 * </ul>
 *
 * <p><b>本域不属于拼团</b>（不是 {@code gz-jp/}）：地址簿是 gz-user 的通用能力，
 * 拼豆 / 预购 / 拼团共用。放 {@code api/gz-jp/} 下会让人以为改它只影响拼团。</p>
 *
 * <p>ID 字段统一 string（跨层契约 #1）。手机号是 <b>String</b> 字段（后端 {@code @Pattern} 校验 11 位），
 * 不是数字 —— 别在前端做 Number 转换（前导 0 与精度都会出事）。</p>
 */
import { http } from '@/http/http'

/** 地址（后端 {@code GzUserAddressVO} 的前端镜像）。 */
export interface GzUserAddressVO {
  /** 地址主键 */
  id: string
  /** 收件人姓名 */
  recipientName: string
  /** 收件人手机号（11 位字符串） */
  mobile: string
  /** 省 */
  province: string
  /** 市 */
  city: string
  /** 区 / 县 */
  district: string
  /** 详细地址（街道门牌） */
  detail: string
  /** 标签 home / company / school / 自定义，可空 */
  tag?: string | null
  /** 是否默认 0=否 / 1=是 */
  isDefault: number
  /** 创建时间 */
  createTime?: string | null
}

/**
 * 新增 / 编辑请求体（后端 {@code GzUserAddressBo}）。
 *
 * <p>后端校验：姓名 / 手机号 / 省 / 市 / 区 / 详细地址<b>全部 {@code @NotBlank}</b>，
 * 手机号还有 {@code ^1[3-9]\d{9}$}。前端先拦一道只是为了不让客人白等一次网络往返，
 * <b>后端才是闸门</b>（前端校验绕过去也进不来）。</p>
 */
export interface GzUserAddressSaveReq {
  /** 地址主键：不传 = 新增，传 = 编辑 */
  id?: string
  recipientName: string
  mobile: string
  province: string
  city: string
  district: string
  detail: string
  tag?: string
  /** 是否设为默认 0=否 / 1=是 */
  isDefault?: number
}

/** GET /app/gz/user/address/list — 地址列表（默认置顶）。空地址簿返回 `[]`。 */
export function fetchAddressList(): Promise<GzUserAddressVO[]> {
  return http<GzUserAddressVO[]>({
    url: '/app/gz/user/address/list',
    method: 'GET',
  })
}

/** POST/PUT /app/gz/user/address — 保存（带 id 走编辑，不带走新增），返回保存后的地址。 */
export function saveAddress(body: GzUserAddressSaveReq): Promise<GzUserAddressVO> {
  const editing = !!body.id
  return http<GzUserAddressVO>({
    url: '/app/gz/user/address',
    method: editing ? 'PUT' : 'POST',
    data: body,
  })
}

/** POST /app/gz/user/address/{id}/default — 设为默认。 */
export function setDefaultAddress(id: string): Promise<void> {
  return http<void>({
    url: `/app/gz/user/address/${id}/default`,
    method: 'POST',
  })
}
