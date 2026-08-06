/**
 * watermark.ts 纯函数单测（SYS-INFRA-009 样例 1 / 3）。
 *
 * 覆盖：
 * - buildWatermarkLines：根据 ctx 字段拼接行（空字段跳过，顺序固定）
 * - formatWatermarkTime：yyyy-MM-dd HH:mm:ss 补零
 * - formatGps：经纬度 4 位小数
 *
 * renderWatermark 走 wx.createSelectorQuery + canvas API，依赖宿主 DOM；
 * 留给 e2e（微信开发者工具自动化，V2 范围），本文件不覆盖。
 */
import { describe, expect, it } from 'vitest'
import { buildWatermarkLines, formatGps, formatWatermarkTime } from './watermark'

describe('buildWatermarkLines', () => {
  it('全字段都有时按 time / gps / farm / operator / bizTag 顺序生成 5 行', () => {
    const lines = buildWatermarkLines({
      timeText: '2026-05-21 14:32:08',
      gpsText: '121.4737, 31.2304',
      farmName: '东角山主农场',
      operatorName: '张三',
      bizTag: '耳号 M2026A001',
    })
    expect(lines).toEqual([
      { text: '2026-05-21 14:32:08' },
      { text: 'GPS: 121.4737, 31.2304' },
      { text: '东角山主农场' },
      { text: '操作人: 张三' },
      { text: '耳号 M2026A001' },
    ])
  })

  it('空字段跳过 — 只传 timeText + bizTag 应返 2 行', () => {
    const lines = buildWatermarkLines({
      timeText: '2026-05-21 14:32:08',
      gpsText: '',
      farmName: undefined,
      bizTag: 'A1 圈舍',
    })
    expect(lines).toEqual([
      { text: '2026-05-21 14:32:08' },
      { text: 'A1 圈舍' },
    ])
  })

  it('全空 ctx 返空数组', () => {
    expect(buildWatermarkLines({})).toEqual([])
  })
})

describe('formatWatermarkTime', () => {
  it('补零到 yyyy-MM-dd HH:mm:ss 格式', () => {
    // month=0 (1月)、day=3、hour=4、minute=5、second=6 全是个位数
    const d = new Date(2026, 0, 3, 4, 5, 6)
    expect(formatWatermarkTime(d)).toBe('2026-01-03 04:05:06')
  })

  it('两位数值不重复加 0', () => {
    const d = new Date(2026, 10, 23, 14, 32, 8) // 11月23日 14:32:08
    expect(formatWatermarkTime(d)).toBe('2026-11-23 14:32:08')
  })

  it('默认参数取 new Date()，长度恒为 19', () => {
    expect(formatWatermarkTime()).toHaveLength(19)
  })
})

describe('formatGps', () => {
  it('经纬度保留 4 位小数', () => {
    expect(formatGps(121.47372, 31.230416)).toBe('121.4737, 31.2304')
  })

  it('整数经纬度也补到 4 位', () => {
    expect(formatGps(0, 0)).toBe('0.0000, 0.0000')
  })

  it('负数 GPS（西半球 / 南半球）也兼容', () => {
    expect(formatGps(-122.41941, -37.7749)).toBe('-122.4194, -37.7749')
  })
})
