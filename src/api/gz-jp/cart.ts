/**
 * 拼团购物车（gz_jp_cart_item）mp 端 API —— miniapp-jp / 谷子宇宙拼团。
 *
 * <p>后端契约（GZ-JP-104）：</p>
 * <ul>
 *   <li>GET    /app/gz/jp/cart/list      — 购物车（<b>按场分组</b> + 实时标失效项）</li>
 *   <li>POST   /app/gz/jp/cart           — 加购（同商品已存在 → <b>数量累加</b>），返回累加后数量</li>
 *   <li>PUT    /app/gz/jp/cart           — 改数量（<b>绝对赋值</b>，1..99）</li>
 *   <li>DELETE /app/gz/jp/cart/{ids}     — 删除（逗号分隔批量），返回实际删除行数</li>
 * </ul>
 *
 * <p><b>★ 四个端点都需要登录态</b>（后端本类刻意无 &#64;SaIgnore）—— 购物车是用户私有数据。
 * 未登录调用返 401，http.ts 会静默续期（游客态续期失败 → 静默清态，不弹登录墙）。
 * 所以调用前必须先 {@code ensureLoggedIn()}，别指望 401 之后还能补救。</p>
 *
 * <p><b>userId 不在任何入参里</b>：后端一律取 {@code LoginHelper.getUserId()}。
 * 前端传 userId 既没用也不安全，不要加。</p>
 *
 * <p>ID 字段统一 string（跨层契约：Java Long ↔ JS number 精度坑）。金额单位统一<b>分</b>。</p>
 */
import { http } from '@/http/http'

/**
 * 购物车项失效原因（后端 {@code GzJpCartInvalidReason}）。
 *
 * <p><b>展示一律用 {@link GzJpCartItemVO.invalidText}</b>（后端已给中文人话），
 * 前端不要再维护一份 code → 文案的映射表：后端加了新原因而前端映射表没跟上时，
 * 客人会看到一个空白的失效标签。本类型只用于埋点 / 排障分流。</p>
 *
 * <p>后端刻意<b>不向 C 端区分</b>「商品被删」与「商品下架」（对客人是同一件事），
 * 两个 code 分开只为服务端排障。</p>
 */
export type GzJpCartInvalidReason = 'event_closed' | 'product_off_shelf' | 'product_removed'

/** 购物车行（后端 {@code GzJpCartItemVO} 的前端镜像）。 */
export interface GzJpCartItemVO {
  /** 购物车项主键 —— <b>改数量 / 删除 / 结算勾选都用它</b>（不是 productId） */
  id: string
  /** 商品主键（跳商品详情用） */
  productId: string
  /** 商品编号 JPP-yyyyMMdd-6位（业务码，客服对单用） */
  productNo: string
  /** 商品名称（商品已被删时后端回落「商品已下架」） */
  name: string
  /** 主图可渲染 URL（1h 预签名）；后端保证非 null（无图回落占位图） */
  mainImageUrl: string | null
  /** 单价（<b>分</b>）★ 已包邮（REQ-ORDER-004），此价即最终支付价 */
  priceCent: number | null
  /** 数量（1..99） */
  qty: number
  /** 行金额（<b>分</b>）= priceCent × qty，后端算好，前端不要自己乘 */
  amountCent: number
  /** 所属场主键（孤儿组为 null） */
  eventId: string | null
  /**
   * ★ 是否已失效 —— <b>「能不能勾选」的唯一依据</b>。
   *
   * <p>别拿 {@code group.eventBookable} 或场的 endTime 跟本地时钟比来自己判：
   * 判不出店员手动关场，客户端时钟也不可信。后端每次列表都实时重算这个字段。</p>
   */
  invalid: boolean
  /** 失效原因 code（{@code invalid=false} 时为 null）—— 仅埋点 / 排障用 */
  invalidReason: GzJpCartInvalidReason | null
  /** 失效文案（中文人话，<b>直接展示</b>）；{@code invalid=false} 时为 null */
  invalidText: string | null
}

/** 购物车分组（按场，UI:mp.cart.group / 设计方案 A）。 */
export interface GzJpCartGroupVO {
  /** 场主键；<b>可能为 null</b>（商品已被删的孤儿组「已失效商品」）—— 渲染组头要判空 */
  eventId: string | null
  /** 场编号 EVT-yyyyMMdd-6位（孤儿组为 null） */
  eventNo: string | null
  /** 场名称（孤儿组为「已失效商品」） */
  eventName: string
  /** 场状态 'open' | 'closed'（孤儿组为 null） */
  eventStatus: string | null
  /** 本场此刻能否下单；false → 整组失效（组头可提示「本场已结束」） */
  eventBookable: boolean
  /** 组内购物车行（后端已按最近加购在前排好） */
  items: GzJpCartItemVO[]
}

/** 购物车整车（后端 {@code GzJpCartVO}）。 */
export interface GzJpCartVO {
  /**
   * 分组列表。<b>空车时为 [] 不是 null</b>（对 null 做 v-for 会崩）。
   * <p>后端已排好序：可下单场 → 已结束场 → 孤儿组沉底，<b>前端不要再排</b>。</p>
   */
  groups: GzJpCartGroupVO[]
  /** 款数（含失效项）—— 入口角标用这个 */
  itemCount: number
  /** 失效款数（&gt; 0 时可提示「N 件商品已失效」） */
  invalidCount: number
  /** 有效项总件数（Σ qty，全选口径） */
  validQty: number
  /**
   * 有效项合计（<b>分</b>，<b>全选口径</b>）。
   *
   * <p>用户实际勾选后的合计由前端按选中项的 {@code amountCent} 累加
   * （后端不维护勾选态，见 {@code pages/cart/index.logic.ts}）。
   * 本字段的用途是「首次进页面全选时的对账基准」与空车判定。</p>
   */
  validAmountCent: number
}

/** 单款数量下限（减到 0 请走删除，PUT 最小值是 1）。 */
export const CART_MIN_QTY = 1
/** 单款数量上限（后端同值硬拦：超限报「单款商品最多 99 件」，不静默截断）。 */
export const CART_MAX_QTY = 99

/** 购物车页路由（入口方与 E2E flow 共用同一个常量，改文件名时只改这里）。 */
export const CART_ROUTE = '/pages/cart/index'

/**
 * GET /app/gz/jp/cart/list — 拉整车（<b>需登录</b>）。
 *
 * <p><b>改数量 / 删除后建议整车重拉</b>而不是本地改数：失效状态是后端<b>实时</b>算的，
 * 本地改数会让「刚被店员关场」的项在页面上仍显示可勾选。</p>
 */
export function fetchCart(): Promise<GzJpCartVO> {
  return http<GzJpCartVO>({
    url: '/app/gz/jp/cart/list',
    method: 'GET',
  })
}

/**
 * POST /app/gz/jp/cart — 加购（<b>需登录</b>）。
 *
 * <p>同商品重复加购 = <b>数量累加</b>，不产生新行（后端唯一键 uk_user_product 保证）。</p>
 *
 * <p>后端拒绝路径（{@code code=500} + msg，http.ts 已统一 toast）：
 * 该商品已下架 / 本场已结束，无法加入购物车 / 该商品数量已达上限（99 件）/
 * 购物车最多放 50 款商品。<b>加购走后端 isBookable 严格闸</b>，前端置灰只是体验层。</p>
 *
 * @param productId 商品主键（string）
 * @param qty       本次加购数量（1..99；与车里已有数量<b>累加</b>）
 * @returns 累加后的该款总数量
 */
export function addToCart(productId: string, qty: number): Promise<number> {
  return http<number>({
    url: '/app/gz/jp/cart',
    method: 'POST',
    data: { productId, qty },
  })
}

/**
 * PUT /app/gz/jp/cart — 改数量（<b>需登录</b>）。
 *
 * <p><b>★ 绝对赋值</b>（传目标值不是增量）。<b>减到 0 请走 {@link deleteCartItems}</b>——
 * 后端最小值是 1，传 0 会报「数量至少为 1，如需移除请删除该商品」。</p>
 *
 * @param id  购物车项主键（不是 productId）
 * @param qty 目标数量（1..99）
 */
export function updateCartQty(id: string, qty: number): Promise<void> {
  return http<void>({
    url: '/app/gz/jp/cart',
    method: 'PUT',
    data: { id, qty },
  })
}

/**
 * DELETE /app/gz/jp/cart/{ids} — 批量删除（<b>需登录</b>）。
 *
 * <p>后端<b>物理删</b>（不软删）—— 删掉再重新加购同款不会撞唯一键。
 * 非本人 / 不存在的 id 静默忽略（返回的删除数会小于传入数），不报错也不泄漏别人车里有什么。</p>
 *
 * <p>「清空失效商品」不需要独立端点：收集 {@code invalid === true} 的行 id 调一次本方法即可。</p>
 *
 * @param ids 购物车项主键列表（空数组直接返回 0，不打请求）
 * @returns 实际删除行数
 */
export function deleteCartItems(ids: string[]): Promise<number> {
  const list = (ids ?? []).filter(Boolean)
  if (!list.length) {
    return Promise.resolve(0)
  }
  return http<number>({
    url: `/app/gz/jp/cart/${list.join(',')}`,
    method: 'DELETE',
  })
}
