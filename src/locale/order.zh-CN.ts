/**
 * 下单确认 + 支付结果页文案（zh-CN）—— GZ-JP-204 / UI:mp.order_confirm。
 *
 * <p>简化 t() 签名（与 home / event / product / cart.zh-CN.ts 同款），key 形如 `order.xxx`。</p>
 *
 * <p><b>★ 全包邮（REQ-ORDER-004）</b>：金额区<b>只有「商品合计」与「实付」两行</b>。
 * 本文件刻意<b>不提供</b>任何表达第二笔费用的文案 key —— 页面想写也写不出来，
 * accept #2 的 grep 也就不可能被一句「这里只是文案」绕过去。</p>
 */

const orderZhCN = {
  /* ── 下单确认页 ────────────────────────────── */
  confirmTitle: '确认订单',

  loading: '正在加载…',
  loadError: '订单信息加载失败',
  loadErrorSub: '检查网络后重试',
  retry: '重试',

  /** 勾选项全都不在了（别的端删了 / 已经结算过） */
  emptyItems: '这些商品已不在购物车里',
  emptyItemsSub: '回购物车重新选一次',
  emptyItemsCta: '回购物车',

  needLogin: '登录后继续下单',
  needLoginSub: '订单与收货地址跟着你的微信号走',
  needLoginCta: '微信登录',

  /* ── 收货地址 ──────────────────────────────── */
  addressSectionTitle: '收货地址',
  /** 地址簿为空时的卡片主文案（★ AC：地址必选） */
  addressEmpty: '添加收货地址',
  addressEmptySub: '拼团商品到货后寄到这里',
  /** 卡片右侧「更换」 */
  addressChange: '更换',
  /** 默认地址标 */
  addressDefaultTag: '默认',

  /** 地址选择弹层 */
  addressSheetTitle: '选择收货地址',
  addressSheetAdd: '＋ 新增收货地址',
  addressSheetClose: '取消',

  /** 新增地址表单 */
  addressFormTitle: '新增收货地址',
  addressFormName: '收货人',
  addressFormNamePh: '请填写收货人姓名',
  addressFormMobile: '手机号',
  addressFormMobilePh: '请填写 11 位手机号',
  addressFormRegion: '所在地区',
  addressFormRegionPh: '请选择省 / 市 / 区',
  addressFormDetail: '详细地址',
  addressFormDetailPh: '街道、门牌号、楼层等',
  addressFormSave: '保存并使用',
  addressFormCancel: '取消',
  addressFormSaved: '地址已保存',

  /** 表单校验（与 validateAddressForm 的 AddressFormError 一一对应） */
  addressErrName: '请填写收货人姓名',
  addressErrMobile: '请填写正确的 11 位手机号',
  addressErrRegion: '请选择所在地区',
  addressErrDetail: '请填写详细地址',

  /* ── 商品清单（只读）───────────────────────── */
  itemsSectionTitle: '商品清单',
  /** 组头场名后的款数后缀 */
  groupCountSuffix: '款',
  /** 行内数量前缀，如「×2」 */
  qtyPrefix: '×',
  /** 失效角标（清单里出现失效项 = 不能提交，要回购物车处理） */
  invalidBadge: '已失效',
  invalidTipPrefix: '有',
  invalidTipSuffix: '件商品已失效，请回购物车处理',
  invalidTipCta: '回购物车',

  /* ── 备注 ──────────────────────────────────── */
  noteSectionTitle: '订单备注',
  notePlaceholder: '选填，如包装要求（不作为发货承诺）',
  /** 备注长度上限（后端 gz_jp_order.user_note 是 VARCHAR，前端先收一道） */
  noteMaxTip: '备注最多 200 字',

  /* ── ★ 金额区（UI:mp.order_confirm.summary：只有两行）── */
  currency: '¥',
  /** 第一行 */
  amountItemsLabel: '商品合计',
  /** 第二行（== 第一行，全包邮） */
  amountPayLabel: '实付',
  /** 合计旁的说明：告诉客人这个数字就是全部 */
  amountIncluded: '已包邮',
  /** 共 N 件 */
  amountQtyPrefix: '共',
  amountQtySuffix: '件',

  /* ── ★ 已阅读不支持退款（举证勾选）───────── */
  agreeText: '我已阅读并同意《拼团购买须知》，知悉商品下单后不支持退款',
  /** 点「购买须知」链接后弹出的详情标题 */
  agreeDetailTitle: '拼团购买须知',
  /**
   * 须知正文。★ 内容按甲方口径写死在前端（不是商品的 noticeText —— 那是每件商品各自的）。
   * 甲方正式版本到位后替换本段。
   */
  agreeDetailContent:
    '1. 拼团商品为日本线下代购，下单即视为委托本店代为购买，付款后不支持退款、不支持中途取消。\n'
    + '2. 预计到货时间为参考值，受官方发货、国际物流与清关影响可能延后。\n'
    + '3. 若代购失败（未抢到 / 官方缺货），该商品将按实付金额原路退款。\n'
    + '4. 商品外包装可能有轻微磨损，介意者请慎拍。',
  agreeDetailConfirm: '我知道了',
  /** 未勾选时点提交的提示（★ AC 配套） */
  agreeRequiredToast: '请先阅读并勾选购买须知',

  /* ── 提交 ──────────────────────────────────── */
  submit: '提交订单',
  submitting: '提交中…',
  /** 各类不可提交的原因提示（与 SubmitBlockReason 一一对应） */
  blockEmpty: '没有可结算的商品',
  blockInvalid: '有商品已失效，请回购物车处理',
  blockNoAddress: '请先选择收货地址',
  /** 提交成功但没拿到支付参数（理论上不会发生，兜住别静默） */
  payParamsMissing: '订单已创建，但支付参数异常，请到「我的订单」继续支付',

  /* ── 支付结果页 ────────────────────────────── */
  resultTitle: '支付结果',
  /** 轮询中 */
  resultPolling: '正在确认支付结果…',
  resultPollingSub: '支付结果以微信通知为准，请稍候',
  /** 已支付 */
  resultPaid: '支付成功',
  resultPaidSub: '我们会尽快在日本下单，进度可在订单详情里看',
  resultPaidCta: '查看订单详情',
  /** 未支付（取消 / 回调还没到） */
  resultUnpaid: '还没收到支付结果',
  resultUnpaidSub: '如果你已经付过款，稍等片刻再刷新；未付款可回订单列表继续支付',
  resultUnpaidRefresh: '刷新',
  resultUnpaidCta: '去我的订单',
  /** 订单已关闭 */
  resultClosed: '订单已关闭',
  resultClosedSub: '未支付订单会自动关闭，可回购物车重新下单',
  resultClosedCta: '去我的订单',
  /** 订单号 / 实付 */
  resultOrderNoLabel: '订单号',
  resultAmountLabel: '实付',
  /** 支付被取消时的即时提示（跳结果页前 toast） */
  payCancelledToast: '支付未完成，可在「我的订单」继续支付',
  /** dev mock 支付通道的说明标（真机 / staging 不出现） */
  mockPayTag: '开发模式：已跳过真实支付',

  /* ── 跳转失败兜底 ──────────────────────────
   * ★ 措辞一律是「打不开」，不许再写「即将上线」：这两个目标页 GZ-JP-205 早已交付，
   *   跳不过去只可能是路由 bug。首页那个订单入口就是被「订单功能即将上线」这句话
   *   藏了整整一期（路由常量指向没注册的页面，客人付完款回不到订单列表）。
   *   见 src/pages.routes.test.ts。
   */
  orderOpenFailed: '订单打不开了，请退出重进试试',
  /** 支付结果页拿不到 orderId 时的提示（不是页面没上线，是这次没接到单号） */
  orderIdMissing: '没拿到订单号，请到「我的 - 我的订单」里查看',

  /* ══════════════════════════════════════════════
   * GZ-JP-205 我的订单列表（UI:mp.order_list）
   * ══════════════════════════════════════════════ */
  listTitle: '我的订单',

  /** 四个 tab（与 list.logic.ts 的 ORDER_TABS labelKey 一一对应） */
  tabAll: '全部',
  tabUnpaid: '待支付',
  tabOngoing: '进行中',
  tabDone: '已完成',

  listLoading: '正在加载订单…',
  listEmpty: '还没有订单',
  listEmptySub: '去逛逛正在拼的场次吧',
  listEmptyCta: '去看看',
  listError: '订单加载失败',
  listErrorSub: '检查网络后重试',
  listErrorCta: '重试',
  listNeedLogin: '登录后查看我的订单',
  listNeedLoginSub: '订单跟着你的微信号走',
  listNeedLoginCta: '微信登录',

  /** 卡片：订单号前缀 / 款数 / 件数 / 实付 */
  cardOrderNoPrefix: '订单号 ',
  cardItemCountPrefix: '共 ',
  cardItemCountSuffix: ' 款',
  cardTotalQtyPrefix: '·',
  cardTotalQtySuffix: ' 件',
  cardPayLabel: '实付',
  /** 缩略图排后面的「+N」 */
  cardMorePrefix: '+',

  /** 分页 */
  listLoadMore: '加载更多',
  listLoadingMore: '加载中…',
  listNoMore: '没有更多了',

  /* ══════════════════════════════════════════════
   * GZ-JP-205 订单详情（UI:mp.order_detail）
   * ══════════════════════════════════════════════ */
  detailTitle: '订单详情',

  detailLoading: '正在加载…',
  detailError: '订单加载失败',
  detailErrorSub: '检查网络后重试',
  detailErrorCta: '重试',
  detailNotFound: '找不到这张订单',
  detailNotFoundSub: '可能已被删除，或不属于当前账号',
  detailNotFoundCta: '去我的订单',

  /** 订单头 */
  detailStatusLabel: '订单状态',
  detailOrderNoLabel: '订单号',
  detailCreateTimeLabel: '下单时间',
  detailPaidTimeLabel: '支付时间',
  detailAmountLabel: '实付',
  detailQtyLabel: '共',
  detailQtySuffix: '件',

  /** 收货地址 */
  detailAddressTitle: '收货地址',

  /** 备注 */
  detailNoteTitle: '订单备注',

  /* ── ★ 按履约状态分组（UI:mp.order_detail.status_group）── */
  detailItemsTitle: '商品进度',
  /** 组头「<状态> N 款」的单位 */
  groupUnit: '款',
  /**
   * ★ 已发货组组头下方的物流行 —— 快递中文名 + 运单号 + 复制。
   * 同一运单号只出现一次（分组保证，不靠模板去重）。
   */
  trackingLabel: '运单号',
  trackingCopy: '复制',
  trackingCopied: '运单号已复制',
  /** 拿不到快递中文名时（未知编码）物流行左侧的兜底词 */
  trackingCarrierFallback: '快递',

  /* ── 购买失败组的退款文案（GZ-JP-107 口径）── */
  /** ★ 已退款：显示金额 */
  refundRefundedPrefix: '已退款 ',
  /** ★ 退款中 / 退款失败：一律「退款处理中」，不显示金额、不出现「失败」二字 */
  refundProcessing: '退款处理中',
  /** refund_failed 时多给一句出口（客人不知道该找谁时最慌） */
  refundContactSupport: '如有疑问请联系客服',
  /** 购买失败组的组内说明（甲方口径：没抢到是常态，不是事故） */
  failedGroupTip: '这些商品没能抢到，货款按实付金额原路退回',

  /** 行内数量（复用 qtyPrefix「×」） */
  detailItemQtyPrefix: '×',
} as const

export type OrderMessageKey = keyof typeof orderZhCN

/**
 * 简化版 t()：从字符串常量表里取值。
 *
 * @param key 文案 key，形如 `order.confirmTitle`
 * @returns 中文文案，找不到时返回 key 本身（便于调试）
 */
export function t(key: string): string {
  if (key.startsWith('order.')) {
    const subKey = key.slice('order.'.length) as OrderMessageKey
    return orderZhCN[subKey] ?? key
  }
  return key
}
