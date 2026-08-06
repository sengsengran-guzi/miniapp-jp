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
 * ⚠️ 两个小程序共用同一后端 sys_config —— HOME_BANNERS 当前是与现有小程序**同一个 key**。
 * GZ-JP-201 落首页轮播时须先决定：拼团首页复用同一批 banner，还是后端另开
 * `gz.jp.home.banners` 独立 key（需 admin 侧同步配置项）。本脚手架不擅自新增后端未支持的 key。
 */
export const GZ_CONFIG_KEYS = {
  /** 首页轮播 banner（JSON 数组 [{imageUrl,link,enabled}]） */
  HOME_BANNERS: 'gz.home.banners',
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
