/**
 * 拼团商品（gz_jp_product）mp 端 API —— miniapp-jp / 谷子宇宙拼团。
 *
 * <p>后端契约（GZ-JP-102 建表 + GZ-JP-103 mp 查询 API + 「mp 可见性模型放宽」补丁，
 * 见 doc/jp/tickets/_visibility-extension-pre-201.md）：</p>
 * <ul>
 *   <li>GET /app/gz/jp/product/list?eventId&amp;pageNum&amp;pageSize — 场内商品分页（<b>匿名可读</b>，@SaIgnore）</li>
 *   <li>GET /app/gz/jp/product/{id}                                — 商品详情（<b>只有它下发图集</b>）</li>
 * </ul>
 *
 * <p><b>可见性</b>：只下发「商品 on_shelf <b>且</b> 所属场可浏览（open / closed）」的商品。
 * 已下架商品、未开场（draft）场里的商品一律查不到 —— 列表是空页、详情是 fail。</p>
 *
 * <p><b>★ 加购 / 下单放行只看 {@link GzJpProductMpVO.eventBookable}</b>，不看「查得到」、
 * 不看 {@code status}、更不要在前端拿场的 endTime 跟本地时钟比（手动关场判不出来 +
 * 客户端时钟不可信）。已结束的场照常 200 返回商品，只是 {@code eventBookable=false}。</p>
 *
 * <p>ID 字段统一 string（跨层契约：Java Long ↔ JS number 精度坑）。</p>
 */
import type { GzJpPageResult } from './event'
import { http } from '@/http/http'

/**
 * 后端 {@code GzJpProductMpVO} 的前端镜像。
 *
 * <p><b>★ 一期没有库存字段</b>（集单预订本质不限量，「卖完」由店员手动下架表达）——
 * 不要臆造 {@code stockRemain}，后端 VO 里根本没有。</p>
 */
export interface GzJpProductMpVO {
  /** 主键（后端 ToString 序列化为 string；详情接口按它查） */
  id: string
  /** 商品编号 JPP-yyyyMMdd-6位（业务码，客服沟通 / 订单快照用） */
  productNo: string
  /** 所属场主键（加购时回传，避免再查一次） */
  eventId: string
  /** 所属场编号 EVT-yyyyMMdd-6位 */
  eventNo: string
  /** 所属场名称（商品详情页面包屑用，省掉再打一次场详情） */
  eventName: string
  /** 商品名称 */
  name: string
  /**
   * 主图可渲染 URL（1h 预签名）。
   * 后端无图时回落占位路径（该文件在 mp 侧并不存在），须过 {@code hasRealCover()} 判真假。
   */
  mainImageUrl: string | null
  /**
   * 图集可渲染 URL 列表（商品详情顶部轮播 = 主图 + 图集）。
   *
   * <p><b>★ 只有详情接口下发</b>；{@link fetchProductList} 恒返空数组
   * （一页 20 条 × N 张图集 = N×20 次预签名纯浪费）。列表卡片只用得到主图。</p>
   */
  galleryImageUrls: string[]
  /** 售价（<b>分</b>）★ 已包邮（REQ-ORDER-004），此价即客人最终支付价，任何页面不得再叠加运费 */
  priceCent: number | null
  /** 预计到货时间（文本，如「8月下旬」，谷圈惯用模糊表述；未填为 null） */
  deliveryDateText: string | null
  /**
   * ★ 额外注意事项（REQ-PROD-005，甲方明确要求的独立字段）。
   *
   * <p>UI:mp.product_detail.notice：必须在 CTA 之上、默认全文展开、底色区分于正文 ——
   * 这是下单前的风险告知位。未填为 null。</p>
   */
  noticeText: string | null
  /** 商品自身状态 —— mp 侧恒为 {@code 'on_shelf'}（下架的根本查不到） */
  status: string
  /**
   * ★ 所属场此刻<b>能不能下单</b> —— 加购 CTA 置灰的<b>唯一</b>依据。
   *
   * <p>{@code true} = 场进行中；{@code false} = 场已结束（店员关场或 end_time 已过），
   * 商品仍可浏览但加购入口必须置灰并提示「本场已结束」。</p>
   *
   * <p><b>与 {@link status} 是两码事</b>：{@code status} 说商品在不在架上，
   * 本字段说所属场还收不收单。已结束场里的在架商品 = {@code status:'on_shelf'} + {@code eventBookable:false}。</p>
   */
  eventBookable: boolean
}

/** 场详情页商品网格每页条数（两列网格，20 条 = 10 行，一屏多一点，够触发上拉加载）。 */
export const EVENT_PRODUCT_PAGE_SIZE = 20

/**
 * GET /app/gz/jp/product/list — 场内商品分页（UI:mp.event_detail 两列网格 + 上拉加载）。
 *
 * <p>场未开场（draft）/ 不存在 → 返回<b>空页</b>（rows=[]，total=0）而非报错。
 * 场已结束 → 照常返回商品，每条 {@code eventBookable:false}。</p>
 *
 * @param eventId 场主键（必传，后端 @NotNull「请选择场」）
 * @param params  分页参数（缺省 pageNum=1 / pageSize={@link EVENT_PRODUCT_PAGE_SIZE}）
 * @returns 分页结果（<b>图集恒为空数组</b>，要图集打 {@link fetchProductDetail}）
 */
export function fetchProductList(
  eventId: string,
  params: { pageNum?: number, pageSize?: number } = {},
): Promise<GzJpPageResult<GzJpProductMpVO>> {
  return http<GzJpPageResult<GzJpProductMpVO>>({
    url: '/app/gz/jp/product/list',
    method: 'GET',
    query: {
      eventId,
      pageNum: params.pageNum ?? 1,
      pageSize: params.pageSize ?? EVENT_PRODUCT_PAGE_SIZE,
    },
  })
}

/**
 * GET /app/gz/jp/product/{id} — 商品详情（UI:mp.product_detail）。
 *
 * <p>商品不存在 / 已下架 / 所属场未开场 → 后端 R.fail，http.ts 统一 reject 并 toast「该商品已下架」。
 * <b>场已结束不是失败</b>，照常 200 并带 {@code eventBookable:false} —— 别按 {@code code !== 200} 走失效页。</p>
 *
 * @param id 商品主键（string）
 */
export function fetchProductDetail(id: string): Promise<GzJpProductMpVO> {
  return http<GzJpProductMpVO>({
    url: `/app/gz/jp/product/${id}`,
    method: 'GET',
  })
}
