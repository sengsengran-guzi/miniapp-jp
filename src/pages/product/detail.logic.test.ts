/**
 * GZ-JP-202 商品详情纯逻辑单测。
 *
 * <p>锁四件事：</p>
 * <ol>
 *   <li><b>★ 注意事项区块在 CTA 之上</b>（甲方硬要求，模板顺序由 SECTION_ORDER 常量托管）</li>
 *   <li><b>★ 注意事项正文恒有</b>（商家漏填时兜底，区块从不消失）</li>
 *   <li><b>轮播图</b>：主图在前、滤掉后端占位图、去重、可为空</li>
 *   <li><b>数量</b>：越界 / 小数 / 非数一律收敛</li>
 * </ol>
 *
 * <p>全部纯函数，不碰 uni / 网络 / 组件 —— 任何机器都能跑。</p>
 */
import type { GzJpProductMpVO } from '@/api/gz-jp/product'
import { describe, expect, it } from 'vitest'
import { BACKEND_PLACEHOLDER_COVER } from '@/api/gz-jp/event'
import {
  buildGalleryImages,
  buildNoticeText,
  clampQuantity,
  MAX_QUANTITY,
  MIN_QUANTITY,
  noticeIsAboveCta,
  SECTION_ORDER,
} from './detail.logic'

/** 造一个商品 VO（只覆盖测试关心的字段）。 */
function prod(over: Partial<GzJpProductMpVO> = {}): GzJpProductMpVO {
  return {
    id: '1',
    productNo: 'JPP-20260807-000001',
    eventId: '1',
    eventNo: 'EVT-20260807-000001',
    eventName: '8月上旬快闪场',
    name: '柯南 吧唧 一番赏 A赏',
    mainImageUrl: 'https://cdn/main.png',
    galleryImageUrls: [],
    priceCent: 12800,
    deliveryDateText: '8月下旬',
    noticeText: '日本线下采购，包装可能有轻微磨损，介意慎拍',
    status: 'on_shelf',
    eventBookable: true,
    ...over,
  }
}

/* ══════════════════════════════════════════════════════════
 * 1. ★ 区块顺序（甲方硬要求：注意事项必须在 CTA 之上）
 * ══════════════════════════════════════════════════════════ */

describe('sectionOrder（SECTION_ORDER）—— ★ 注意事项必须在 CTA 之上（甲方硬要求）', () => {
  it('★ notice 的位置严格小于 cta', () => {
    expect(SECTION_ORDER.indexOf('notice')).toBeLessThan(SECTION_ORDER.indexOf('cta'))
    expect(noticeIsAboveCta()).toBe(true)
  })

  it('★ 顺序被改坏（notice 掉到 cta 之下）时断言必须红 —— 证明这条断言不是恒真', () => {
    expect(noticeIsAboveCta(['gallery', 'name', 'price', 'delivery', 'cta', 'notice'])).toBe(false)
  })

  it('★ notice 区块被整个删掉时也判 false（不是「找不到就当通过」）', () => {
    expect(noticeIsAboveCta(['gallery', 'name', 'price', 'delivery', 'cta'])).toBe(false)
  })

  it('cta 缺失同样判 false', () => {
    expect(noticeIsAboveCta(['gallery', 'notice'])).toBe(false)
  })

  it('完整顺序与蓝图 UI:mp.product_detail 一致（主图→名→价→到货→须知→CTA）', () => {
    expect([...SECTION_ORDER]).toEqual(['gallery', 'name', 'price', 'delivery', 'notice', 'cta'])
  })
})

/* ══════════════════════════════════════════════════════════
 * 2. ★ 注意事项正文
 * ══════════════════════════════════════════════════════════ */

describe('buildNoticeText —— ★ 风险告知位正文（REQ-PROD-005）', () => {
  const FB = '兜底须知正文'

  it('商家填了 → 原样整段返回', () => {
    expect(buildNoticeText('不支持退款，介意慎拍', FB)).toBe('不支持退款，介意慎拍')
  })

  it('★ 商家没填（null / undefined / 空串 / 纯空白）→ 兜底正文，区块不因此消失', () => {
    expect(buildNoticeText(null, FB)).toBe(FB)
    expect(buildNoticeText(undefined, FB)).toBe(FB)
    expect(buildNoticeText('', FB)).toBe(FB)
    expect(buildNoticeText('   \n  ', FB)).toBe(FB)
  })

  it('★ 长文不截断（风险告知位看不全等于没写）', () => {
    const long = '注意事项'.repeat(200)
    expect(buildNoticeText(long, FB)).toBe(long)
    expect(buildNoticeText(long, FB).length).toBe(long.length)
  })

  it('多行原样保留（页面 white-space: pre-wrap 承接）', () => {
    expect(buildNoticeText('第一条\n第二条\n第三条', FB)).toBe('第一条\n第二条\n第三条')
  })

  it('两侧空白裁掉但内部不动', () => {
    expect(buildNoticeText('  甲  乙  ', FB)).toBe('甲  乙')
  })
})

/* ══════════════════════════════════════════════════════════
 * 3. 顶部轮播图
 * ══════════════════════════════════════════════════════════ */

describe('buildGalleryImages —— 主图 + 图集', () => {
  it('★ 主图恒在最前，其后接图集（顺序即轮播顺序）', () => {
    const r = buildGalleryImages(prod({
      mainImageUrl: 'https://cdn/main.png',
      galleryImageUrls: ['https://cdn/g1.png', 'https://cdn/g2.png'],
    }))
    expect(r).toEqual(['https://cdn/main.png', 'https://cdn/g1.png', 'https://cdn/g2.png'])
  })

  it('★ 滤掉后端占位图（该静态文件在 mp 侧不存在，直接渲染会 404 出白框）', () => {
    const r = buildGalleryImages(prod({
      mainImageUrl: BACKEND_PLACEHOLDER_COVER,
      galleryImageUrls: ['https://cdn/g1.png'],
    }))
    expect(r).toEqual(['https://cdn/g1.png'])
  })

  it('★ 去重（店员常把主图也传进图集，不去重会连着两张一样的）', () => {
    const r = buildGalleryImages(prod({
      mainImageUrl: 'https://cdn/main.png',
      galleryImageUrls: ['https://cdn/main.png', 'https://cdn/g1.png'],
    }))
    expect(r).toEqual(['https://cdn/main.png', 'https://cdn/g1.png'])
  })

  it('★ 一张真图都没有 → 空数组（页面据此渲染占位块，而不是空 swiper）', () => {
    expect(buildGalleryImages(prod({
      mainImageUrl: BACKEND_PLACEHOLDER_COVER,
      galleryImageUrls: [],
    }))).toEqual([])
    expect(buildGalleryImages(prod({ mainImageUrl: null, galleryImageUrls: [] }))).toEqual([])
    expect(buildGalleryImages(prod({ mainImageUrl: '   ', galleryImageUrls: [] }))).toEqual([])
  })

  it('主图为空但有图集 → 只出图集（不留空洞）', () => {
    expect(buildGalleryImages(prod({ mainImageUrl: null, galleryImageUrls: ['https://cdn/g1.png'] })))
      .toEqual(['https://cdn/g1.png'])
  })

  it('图集里的空串 / null 被滤掉', () => {
    const r = buildGalleryImages(prod({
      mainImageUrl: 'https://cdn/main.png',
      galleryImageUrls: ['', null as never, '  ', 'https://cdn/g1.png'],
    }))
    expect(r).toEqual(['https://cdn/main.png', 'https://cdn/g1.png'])
  })

  it('galleryImageUrls 缺失（后端契约漂移成 null）→ 只出主图，不抛', () => {
    expect(buildGalleryImages(prod({ galleryImageUrls: null as never })))
      .toEqual(['https://cdn/main.png'])
  })

  it('product 为 null / undefined → 空数组，不抛', () => {
    expect(buildGalleryImages(null)).toEqual([])
    expect(buildGalleryImages(undefined)).toEqual([])
  })

  it('图片地址两侧空白被裁（后端偶发带空格时不会被当成两个不同 URL）', () => {
    const r = buildGalleryImages(prod({
      mainImageUrl: ' https://cdn/main.png ',
      galleryImageUrls: ['https://cdn/main.png'],
    }))
    expect(r).toEqual(['https://cdn/main.png'])
  })
})

/* ══════════════════════════════════════════════════════════
 * 4. 数量
 * ══════════════════════════════════════════════════════════ */

describe('clampQuantity —— 加购数量收敛', () => {
  it('区间内原样返回', () => {
    expect(clampQuantity(1)).toBe(1)
    expect(clampQuantity(7)).toBe(7)
    expect(clampQuantity(MAX_QUANTITY)).toBe(MAX_QUANTITY)
  })

  it('★ 低于下限夹到 min（0 / 负数不能加购）', () => {
    expect(clampQuantity(0)).toBe(MIN_QUANTITY)
    expect(clampQuantity(-5)).toBe(MIN_QUANTITY)
  })

  it('★ 高于上限夹到 max（防长按 + 号 / 手滑输入 999）', () => {
    expect(clampQuantity(1000)).toBe(MAX_QUANTITY)
  })

  it('★ 小数向下取整（1.9 件按 1 件算，绝不凭空多算钱）', () => {
    expect(clampQuantity(1.9)).toBe(1)
    expect(clampQuantity(2.5)).toBe(2)
  })

  it('★ 非数 / NaN / null / undefined / 对象 → min，不抛也不出 NaN', () => {
    expect(clampQuantity('abc')).toBe(MIN_QUANTITY)
    expect(clampQuantity(Number.NaN)).toBe(MIN_QUANTITY)
    expect(clampQuantity(null)).toBe(MIN_QUANTITY)
    expect(clampQuantity(undefined)).toBe(MIN_QUANTITY)
    expect(clampQuantity({})).toBe(MIN_QUANTITY)
    expect(clampQuantity(Number.POSITIVE_INFINITY)).toBe(MIN_QUANTITY)
  })

  it('★ 数字字符串按数字处理（mp input 在部分基础库返回字符串，这是项目踩过的坑）', () => {
    expect(clampQuantity('3')).toBe(3)
    expect(clampQuantity('300')).toBe(MAX_QUANTITY)
  })

  it('自定义上下限生效（将来接库存时改传参即可，签名不变）', () => {
    expect(clampQuantity(9, 1, 5)).toBe(5)
    expect(clampQuantity(0, 2, 5)).toBe(2)
  })

  it('一期没有库存字段，MAX 只是防误触上限（不是库存约束）', () => {
    expect(MIN_QUANTITY).toBe(1)
    expect(MAX_QUANTITY).toBe(99)
  })
})
