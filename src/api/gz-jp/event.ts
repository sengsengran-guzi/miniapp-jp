/**
 * 拼团场（gz_jp_event）mp 端 API —— miniapp-jp / 谷子宇宙拼团。
 *
 * <p>后端契约（GZ-JP-101 建表 + GZ-JP-103 mp 查询 API + 「mp 可见性模型放宽」补丁，
 * 见 doc/jp/tickets/_visibility-extension-pre-201.md）：</p>
 * <ul>
 *   <li>GET /app/gz/jp/event/list?pageNum&amp;pageSize — 可浏览场分页（<b>匿名可读</b>，@SaIgnore）</li>
 *   <li>GET /app/gz/jp/event/{id}                     — 场详情（GZ-JP-202 用）</li>
 * </ul>
 *
 * <p><b>可见性</b>：mp 侧只下发「开过的场」—— {@code open}（进行中）与 {@code closed}（已结束）；
 * {@code draft}（未开场）永不下发（含窗口已过的 draft）。所以 status 的联合类型只有两种取值，
 * 前端不需要处理 draft 分支。</p>
 *
 * <p><b>能不能下单看 {@code status === 'open'}，不要拿「查得到」当放行条件</b>，
 * 也不要在前端拿 endTime 跟本地时钟比（手动关场判不出来 + 客户端时钟不可信）。
 * 首页三组分组（进行中 / 即将开始 / 已结束）是<b>纯展示派生</b>，见 pages/index/index.logic.ts。</p>
 *
 * <p>ID 字段统一 string（跨层契约：Java Long ↔ JS number 精度坑；后端 VO 已加
 * &#64;JsonSerialize(ToStringSerializer)，前端类型一律收 string）。</p>
 */
import { http } from '@/http/http'

/**
 * 场生效状态 —— mp 侧只可能是这两种。
 *
 * - {@code open}：进行中，<b>可加购 / 可下单</b>
 * - {@code closed}：已结束（手动关场 或 end_time 已过），只可浏览，加购入口须置灰
 */
export type GzJpEventStatus = 'open' | 'closed'

/**
 * 后端 {@code GzJpEventMpVO} 的前端镜像。
 *
 * <p>⚠️ 时间字段格式是 {@code 'yyyy-MM-dd HH:mm:ss'}（后端 &#64;JsonFormat 指定，<b>不是 ISO 的 'T' 分隔</b>）。
 * iOS 的 {@code new Date('2026-08-07 10:00:00')} 解析不稳（返回 Invalid Date），
 * <b>禁止直接 Date.parse</b> —— 统一走 index.logic.ts 的 {@code parseBackendTime()}。</p>
 */
export interface GzJpEventMpVO {
  /** 主键（后端 ToString 序列化为 string；场详情接口按它查） */
  id: string
  /** 场编号 EVT-yyyyMMdd-6位（业务码，展示 / 客服沟通 / 分享用，不暴露 id） */
  eventNo: string
  /** 场名称 */
  name: string
  /**
   * 封面可渲染 URL（1h 预签名）。
   * 后端无图时回落占位路径 {@link BACKEND_PLACEHOLDER_COVER}（该文件在 mp 侧并不存在，
   * 前端须按「无封面」处理，见 {@code hasRealCover()}）。
   */
  coverImageUrl: string | null
  /** 场简介（可空） */
  description: string | null
  /** 生效状态：open 可下单 / closed 只可浏览 */
  status: GzJpEventStatus
  /** 开场时间 'yyyy-MM-dd HH:mm:ss' */
  startTime: string
  /** 闭场时间 'yyyy-MM-dd HH:mm:ss' */
  endTime: string
}

/**
 * 后端无图时回落的占位封面路径。
 *
 * <p>后端 {@code GzJpEventServiceImpl.PLACEHOLDER_IMAGE_URL} / {@code GzJpProductServiceImpl} 同值。
 * <b>该静态资源在 miniapp-jp 里并不存在</b>（src/static/images 只有 avatar.jpg / default-avatar.png），
 * 直接丢给 &lt;image&gt; 会 404 出空白框 —— 前端一律当「无封面」走组件内置占位块。</p>
 */
export const BACKEND_PLACEHOLDER_COVER = '/static/images/mock-product.png'

/**
 * ruoyi 分页响应（TableDataInfo）。
 *
 * <p>注意 http.ts 对分页端点的特殊处理：{@code TableDataInfo} 直返 {@code {code,msg,rows,total}}
 * 没有 data 字段，http() 会<b>返回整个对象</b>（不是 .data）—— 所以这里收 {@code rows/total}
 * 而不是数组。历史上前端写 {@code res.data} 取分页数据是本项目踩过的一类系统性契约 bug。</p>
 */
export interface GzJpPageResult<T> {
  /** 当前页数据（无数据时是空数组，不是 null） */
  rows: T[]
  /** 总条数 */
  total: number
}

/** 首页场列表默认拉取条数（一期场次很少，一页足够覆盖三组展示）。 */
export const HOME_EVENT_PAGE_SIZE = 20

/**
 * GET /app/gz/jp/event/list — 可浏览场分页（进行中 + 已结束，draft 不下发）。
 *
 * <p>后端排序 {@code sort_no ASC, end_time DESC, id DESC}：未结束的场天然排在已结束之前，
 * 组内最近的在前。前端分组时<b>保持后端给的相对顺序</b>（稳定分区），不再二次排序。</p>
 *
 * @param params 分页参数（缺省 pageNum=1 / pageSize={@link HOME_EVENT_PAGE_SIZE}）
 * @returns 分页结果；无可浏览场时 rows 为空数组（不是 fail）
 */
export function fetchEventList(
  params: { pageNum?: number, pageSize?: number } = {},
): Promise<GzJpPageResult<GzJpEventMpVO>> {
  return http<GzJpPageResult<GzJpEventMpVO>>({
    url: '/app/gz/jp/event/list',
    method: 'GET',
    query: {
      pageNum: params.pageNum ?? 1,
      pageSize: params.pageSize ?? HOME_EVENT_PAGE_SIZE,
    },
  })
}

/**
 * GET /app/gz/jp/event/{id} — 场详情（GZ-JP-202 进场页头用）。
 *
 * <p>已结束的场同样返回 200（{@code status='closed'}）；只有「不存在 / 未开场(draft)」才 fail，
 * 由 http.ts 统一 reject 并 toast「该场不存在」。</p>
 *
 * @param id 场主键（string，来自列表 VO 的 id）
 */
export function fetchEventDetail(id: string): Promise<GzJpEventMpVO> {
  return http<GzJpEventMpVO>({
    url: `/app/gz/jp/event/${id}`,
    method: 'GET',
  })
}
