/**
 * GZ 通用 API（小程序端）— sys_config 读取等跨域公共接口。
 *
 * 后端契约：ruoyi-gz-common applet controller
 *   - GET /app/gz/common/config/get?key={key}   读单个 sys_config 值
 *     · @SaIgnore 公开端点：未登录匿名用户也能读（落地页运营素材场景）
 *     · 返回 R<String>，data 是 config_value 原始字符串（可能为空串）
 *
 * 注意：本端点公开（不强制登录），与 customer-service.ts 走 ruoyi 自带 /system/config（需登录）
 *       不同 —— banner / 落地页素材需匿名可读，故后端单开 @SaIgnore 包装。
 */
import { http } from '@/http/http'

/**
 * GZ sys_config 键常量（与 admin / DDL 严格一致）。
 *
 * ⚠️ 两个小程序共用同一后端 + 同一张 sys_config 表，运营素材必须**各配一套**，
 * 否则后台配一次两边首页串味。本小程序的首页轮播独立 key = `gz.jp.home.banners`
 * （谷子宇宙小程序仍是 `gz.home.banners`，两者互不影响 — GZ-JP-201）。
 * 后端 MpPublicConfigKeyResolver 还会按请求 header clientid 再归一一次（漏改常量也不会串味）。
 */
export const GZ_CONFIG_KEYS = {
  /** 拼团首页轮播 banner（JSON 数组 [{imageUrl,link,enabled}]） */
  HOME_BANNERS: 'gz.jp.home.banners',
} as const

/**
 * 读单个 sys_config 值（公开端点，匿名可读）。
 *
 * @param key sys_config 的 config_key（用 GZ_CONFIG_KEYS 常量）
 * @returns 配置值原始字符串；key 不存在时后端返空串
 */
export function getSysConfig(key: string): Promise<string> {
  return http<string>({
    url: '/app/gz/common/config/get',
    method: 'GET',
    query: { key },
  })
}

/**
 * 首页轮播 banner 单项（sys_config gz.home.banners JSON 数组元素）。
 */
export interface HomeBannerItem {
  /** 图 URL（对象存储）；空则该项不渲染 */
  imageUrl: string
  /** 点击跳转站内 mp 路由（如 /pages/index/index）；空则不可点 */
  link: string
  /** 是否启用（false 则前端跳过） */
  enabled: boolean
}

/**
 * 拉首页轮播 banner 列表（公开端点，匿名可读）。
 *
 * - 后端返空串 / 非数组 / 解析失败 → 返空数组（调用方降级内置占位）
 * - 过滤 enabled=false 与 imageUrl 为空的项
 */
export async function fetchHomeBanners(): Promise<HomeBannerItem[]> {
  try {
    const raw = await getSysConfig(GZ_CONFIG_KEYS.HOME_BANNERS)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed
      .map((it: Partial<HomeBannerItem>) => ({
        imageUrl: it.imageUrl ?? '',
        link: it.link ?? '',
        enabled: it.enabled !== false,
      }))
      .filter(it => it.enabled && !!it.imageUrl)
  }
  catch (e) {
    console.warn('[gz-common] fetchHomeBanners failed, fallback to empty', e)
    return []
  }
}
