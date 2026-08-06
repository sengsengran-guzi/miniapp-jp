/**
 * gz_user 会员中心 mp 端 API（miniapp-jp / 谷子宇宙拼团）。
 *
 * <p>端点契约（与 ruoyi-gz-common / ruoyi-gz-user 后端严格对齐，两个小程序共用同一后端，
 * 按请求头 clientid 区分 —— 本小程序恒为 <code>mp-applet-gz-jp</code>）：</p>
 * <ul>
 *   <li>GET  /app/gz/common/me              — 当前用户基础信息（GZ-SYS-003）</li>
 *   <li>PUT  /app/gz/user/profile           — 个人资料编辑（GZ-USER-002）</li>
 *   <li>POST /app/gz/common/user/bind-mobile — 手机号绑定 / 修改（getPhoneNumber 动态 code 换明文）</li>
 * </ul>
 *
 * <p>ID 字段统一 string（跨层契约 #1 / #3：Java Long ↔ JS number 精度坑；后端 VO 已加
 * @JsonSerialize(ToStringSerializer)，前端类型一律收 string）。</p>
 */
import { http } from '@/http/http'

/** GET /app/gz/common/me 返回的用户基础信息（GZ-SYS-003 GzUserVO 子集）。 */
export interface GzUserMeVO {
  /** 用户主键（后端 ToString 序列化为 string） */
  id: string
  /** 业务码 U{yyyyMMdd}{6 位序号} */
  userNo: string
  /** 昵称（chooseAvatar 时代用 input type=nickname 采集，可编辑覆盖；ADR-0009） */
  nickname?: string | null
  /** 头像可渲染 URL（后端按 avatarImageId 重生成的 1h 签名 URL；ADR-0009） */
  avatarUrl?: string | null
  /** 头像文件 id（FK gz_file_object，后端 ToString 序列化为 string；GZ-USER-006） */
  avatarImageId?: string | null
  /** 手机号（11 位，未绑定为 null） */
  mobile?: string | null
  /** 微信号（手动填，可空；GZ-USER-005） */
  wechatId?: string | null
  /** 性别 0=未知 / 1=男 / 2=女 */
  gender?: number | null
  /** 用户状态 browse_only / authorized / phone_bound */
  status: string
  /** 注册时间 */
  registerTime: string
  /** 最后登录时间 */
  lastLoginTime?: string | null
}

/**
 * GET /app/gz/common/me — 拿当前用户基础信息。
 */
export function getMe(): Promise<GzUserMeVO> {
  return http<GzUserMeVO>({
    url: '/app/gz/common/me',
    method: 'GET',
  })
}

/* ============================================================
 * GZ-USER-002 个人资料编辑
 * ============================================================ */

/** PUT /app/gz/user/profile 请求体（昵称 / 头像 / 性别 / 微信号；手机号走独立 bind-mobile）。 */
export interface UserProfileUpdateRequest {
  /** 昵称（≤ 32 字符） */
  nickname?: string
  /**
   * 头像文件 id（FK gz_file_object；GZ-USER-006 头像真源，ADR-0009）。
   * chooseAvatar → 上传对象存储拿 fileId 传此字段；后端落 avatar_image_id 不存裸 url。
   */
  avatarImageId?: number
  /** 头像 URL（兜底兼容旧链路；未传 avatarImageId 时才生效） */
  avatarUrl?: string
  /** 性别 0=未知 / 1=男 / 2=女 */
  gender?: number
  /** 微信号（≤ 64 字符，手动填，可空；GZ-USER-005） */
  wechatId?: string
}

/**
 * PUT /app/gz/user/profile — 保存个人资料。
 *
 * <p>后端在 Service 层 @Transactional 内：UPDATE gz_user + 写 gz_user_audit_log。</p>
 *
 * @returns 更新后的用户基础信息（前端用于同步 store）
 */
export function updateProfile(body: UserProfileUpdateRequest): Promise<GzUserMeVO> {
  return http<GzUserMeVO>({
    url: '/app/gz/user/profile',
    method: 'PUT',
    data: body,
  })
}

/* ============================================================
 * 手机号绑定（mp getPhoneNumber → 后端换明文）
 * ============================================================ */

/**
 * POST /app/gz/common/user/bind-mobile — 绑定 / 修改手机号。
 *
 * <p>mp 端 <code>&lt;button open-type="getPhoneNumber"&gt;</code> 回调返回动态 code，
 * 后端用 access_token 调微信 getuserphonenumber 换明文落库（前端全程不接触明文）。
 * access_token 按 appid 隔离（GZ-SYS-021），本小程序走自己的 appid 缓存。</p>
 *
 * @param code getPhoneNumber 回调里的动态 code
 */
export function bindMobile(code: string): Promise<void> {
  return http<void>({
    url: '/app/gz/common/user/bind-mobile',
    method: 'POST',
    data: { code },
  })
}
