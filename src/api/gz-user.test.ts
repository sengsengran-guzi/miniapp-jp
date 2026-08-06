/**
 * gz-user API 单测（GZ-USER-005 / GZ-USER-006 Tier 1B）。
 *
 * 覆盖个人资料编辑契约（与后端 ruoyi-gz-user GzUserProfileMpController + MeController 严格对齐）：
 *   - GET  /app/gz/common/me        回显 wechatId / avatarImageId / avatarUrl / nickname
 *   - PUT  /app/gz/user/profile      提交 nickname / avatarImageId / wechatId / gender
 *     · 头像真源 = avatarImageId（不传裸 url；ADR-0009）
 *     · wechatId 可空（手动填）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getMe, updateProfile } from './gz-user'

const httpMock = vi.fn()
vi.mock('@/http/http', () => ({
  http: (opts: unknown) => httpMock(opts),
}))

describe('getMe', () => {
  beforeEach(() => {
    httpMock.mockReset()
  })

  it('调 GET /app/gz/common/me，回显含 wechatId / avatarImageId / avatarUrl', async () => {
    httpMock.mockResolvedValueOnce({
      id: '1001',
      userNo: 'U20260609000001',
      nickname: '阿喵',
      avatarUrl: 'https://cos-signed/x.png?sign=abc',
      avatarImageId: '99',
      wechatId: 'my_wx_id',
      gender: 1,
      status: 'authorized',
      registerTime: '2026-06-09T10:00:00',
    })
    const me = await getMe()
    expect(httpMock).toHaveBeenCalledWith({ url: '/app/gz/common/me', method: 'GET' })
    expect(me.wechatId).toBe('my_wx_id')
    expect(me.avatarImageId).toBe('99')
    expect(me.avatarUrl).toContain('cos-signed')
  })
})

describe('updateProfile', () => {
  beforeEach(() => {
    httpMock.mockReset()
  })

  it('调 PUT /app/gz/user/profile，body 带 avatarImageId（头像真源）+ wechatId', async () => {
    httpMock.mockResolvedValueOnce({ id: '1001', nickname: '阿喵', avatarUrl: 'https://cos-signed/x.png' })
    await updateProfile({
      nickname: '阿喵',
      avatarImageId: 99,
      wechatId: 'my_wx_id',
      gender: 1,
    })
    expect(httpMock).toHaveBeenCalledWith({
      url: '/app/gz/user/profile',
      method: 'PUT',
      data: { nickname: '阿喵', avatarImageId: 99, wechatId: 'my_wx_id', gender: 1 },
    })
  })

  it('头像走 avatarImageId 不传裸 url（ADR-0009 头像存 image_id）', async () => {
    httpMock.mockResolvedValueOnce({ id: '1001' })
    await updateProfile({ nickname: '阿喵', avatarImageId: 42 })
    const sent = httpMock.mock.calls[0][0].data
    expect(sent.avatarImageId).toBe(42)
    // 新链路不应携带裸 avatarUrl
    expect(sent.avatarUrl).toBeUndefined()
  })

  it('微信号可空（不传 wechatId 也合法）', async () => {
    httpMock.mockResolvedValueOnce({ id: '1001' })
    await updateProfile({ nickname: '阿喵' })
    const sent = httpMock.mock.calls[0][0].data
    expect(sent.wechatId).toBeUndefined()
    // 不抛错即通过
    expect(httpMock).toHaveBeenCalledTimes(1)
  })
})
