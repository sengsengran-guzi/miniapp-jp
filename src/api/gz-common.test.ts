/**
 * gz-common API 单测。
 *
 * 覆盖 fetchHomeBanners 的兜底链路（首页轮播不能因后端 / 解析异常而渲染失败）：
 *   1. 正常 JSON 数组 → 解析并过滤
 *   2. 后端返空串（key 不存在 / 未配置）→ 空数组
 *   3. 非法 JSON → catch 兜底空数组
 *   4. 非数组 JSON → 空数组
 *   5. enabled=false / imageUrl 为空的项被过滤
 *   6. http 请求抛错 → catch 兜底空数组
 * 以及 getSysConfig 的 query 透传契约。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchHomeBanners, getSysConfig, GZ_CONFIG_KEYS } from './gz-common'

const httpMock = vi.fn()
vi.mock('@/http/http', () => ({
  http: (opts: unknown) => httpMock(opts),
}))

describe('getSysConfig', () => {
  beforeEach(() => {
    httpMock.mockReset()
  })

  it('调 GET /app/gz/common/config/get + query.key 透传', async () => {
    httpMock.mockResolvedValueOnce('some-value')
    const val = await getSysConfig('gz.test.key')
    expect(val).toBe('some-value')
    expect(httpMock).toHaveBeenCalledWith({
      url: '/app/gz/common/config/get',
      method: 'GET',
      query: { key: 'gz.test.key' },
    })
  })
})

describe('fetchHomeBanners', () => {
  beforeEach(() => {
    httpMock.mockReset()
  })

  it('用 HOME_BANNERS 常量 key', async () => {
    httpMock.mockResolvedValueOnce('')
    await fetchHomeBanners()
    expect(httpMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: { key: GZ_CONFIG_KEYS.HOME_BANNERS } }),
    )
  })

  it('正常 JSON 数组 → 解析出各项', async () => {
    httpMock.mockResolvedValueOnce(
      '[{"imageUrl":"https://oss/a.png","link":"/pages/index/index","enabled":true}]',
    )
    const list = await fetchHomeBanners()
    expect(list).toEqual([
      { imageUrl: 'https://oss/a.png', link: '/pages/index/index', enabled: true },
    ])
  })

  it('后端返空串（未配置）→ 空数组', async () => {
    httpMock.mockResolvedValueOnce('')
    await expect(fetchHomeBanners()).resolves.toEqual([])
  })

  it('非法 JSON → catch 兜底空数组', async () => {
    httpMock.mockResolvedValueOnce('not-a-json{{{')
    await expect(fetchHomeBanners()).resolves.toEqual([])
  })

  it('非数组 JSON → 空数组', async () => {
    httpMock.mockResolvedValueOnce('{"imageUrl":"https://oss/a.png"}')
    await expect(fetchHomeBanners()).resolves.toEqual([])
  })

  it('enabled=false / imageUrl 空的项被过滤（link 缺省为空串）', async () => {
    httpMock.mockResolvedValueOnce(
      '[{"imageUrl":"https://oss/a.png"},{"imageUrl":"https://oss/b.png","enabled":false},{"imageUrl":""}]',
    )
    const list = await fetchHomeBanners()
    expect(list).toEqual([{ imageUrl: 'https://oss/a.png', link: '', enabled: true }])
  })

  it('http 请求抛错 → catch 兜底空数组（首页不崩）', async () => {
    httpMock.mockRejectedValueOnce(new Error('network'))
    await expect(fetchHomeBanners()).resolves.toEqual([])
  })
})
