// @ts-nocheck
/**
 * gen-tabbar-icons.mjs — 生成底部 tabbar 图标。
 *
 * 背景：本机无 SVG 光栅化器（sharp/canvas/magick/inkscape 全无），但有 pngjs。
 * 故自写一个极小光栅器（点-线段距离画粗线 + 扫描线填充多边形），直接把
 * 几何图形画进 80×80 RGBA buffer，再用 pngjs 编码成 PNG。
 *
 * 输出 4 张（src/static/tabbar/），2 套各异、每套 inactive(墨黑) + active(品牌色)：
 *   - 首页：house  ⌂   → home.png / homeHL.png
 *   - 我的：人像  👤  → me.png / meHL.png
 *
 * ⚠️ 这是 AI 手画的几何图标，美术精度属视觉签字项（Kevin / 真设计师走查）。
 *    最终上线可由真设计师同名 drop-in 替换（home.png / homeHL.png / me.png / meHL.png）。
 *    本脚本 committed 可重跑，方便后续替换 / 精修。
 *
 * 色值真源（src/style/c-tokens.scss，与 tabbar/config.ts 的 color/selectedColor 一致）：
 *   未选中 inactive = --c-ink-2 #857D70 的加深近似 #1A1A1A
 *   选中   active   = --c-red（品牌主色，值为清新绿）#33B36B
 *
 * 用法：
 *   cd code/main/miniapp-jp && node scripts/gen-tabbar-icons.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../src/static/tabbar')

const SIZE = 80 // 80×80 透明底
const INK = { r: 0x1A, g: 0x1A, b: 0x1A } // 未选中：墨黑
const BRAND = { r: 0x33, g: 0xB3, b: 0x6B } // 选中：品牌主色 --c-red(#33B36B，令牌名沿用历史)

// ---------------------------------------------------------------------------
// 极小光栅器：在 80×80 RGBA buffer 上画 C 风「粗墨描边硬朗」图形
// ---------------------------------------------------------------------------

function makeCanvas() {
  // RGBA，初始全透明
  return new Uint8ClampedArray(SIZE * SIZE * 4)
}

function setPx(buf, x, y, color, alpha = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE)
    return
  const i = (y * SIZE + x) * 4
  buf[i] = color.r
  buf[i + 1] = color.g
  buf[i + 2] = color.b
  buf[i + 3] = alpha
}

/** 点 P 到线段 AB 的最短距离（用于粗线条 = 距离阈值实心化）。 */
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** 画一条粗线段（半宽 hw，端点圆头）。带 1px 抗锯齿软边，但整体硬朗。 */
function drawThickSeg(buf, ax, ay, bx, by, hw, color) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx) - hw - 1))
  const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(ax, bx) + hw + 1))
  const minY = Math.max(0, Math.floor(Math.min(ay, by) - hw - 1))
  const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(ay, by) + hw + 1))
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = distToSeg(x + 0.5, y + 0.5, ax, ay, bx, by)
      if (d <= hw - 0.5) {
        setPx(buf, x, y, color, 255)
      }
      else if (d <= hw + 0.5) {
        // 1px 软边抗锯齿，但只在最外圈，保持硬朗
        const a = Math.round((hw + 0.5 - d) * 255)
        blendPx(buf, x, y, color, a)
      }
    }
  }
}

/** alpha 混合：在已有像素上叠加（处理交叉/描边重叠时不破坏已实心部分）。 */
function blendPx(buf, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE)
    return
  const i = (y * SIZE + x) * 4
  const old = buf[i + 3]
  if (old >= alpha)
    return // 已经更实，不覆盖
  setPx(buf, x, y, color, alpha)
}

/** 画折线 / 多段线（points = [[x,y],...]，closed 是否闭合）。 */
function drawPolyline(buf, points, hw, color, closed = false) {
  const n = points.length
  const last = closed ? n : n - 1
  for (let k = 0; k < last; k++) {
    const [ax, ay] = points[k]
    const [bx, by] = points[(k + 1) % n]
    drawThickSeg(buf, ax, ay, bx, by, hw, color)
  }
}

/** 扫描线填充多边形（实心块）。 */
function fillPolygon(buf, points, color) {
  let minY = Infinity
  let maxY = -Infinity
  for (const [, y] of points) {
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  minY = Math.max(0, Math.floor(minY))
  maxY = Math.min(SIZE - 1, Math.ceil(maxY))
  for (let y = minY; y <= maxY; y++) {
    const yc = y + 0.5
    const xs = []
    for (let k = 0; k < points.length; k++) {
      const [ax, ay] = points[k]
      const [bx, by] = points[(k + 1) % points.length]
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
        const x = ax + ((yc - ay) / (by - ay)) * (bx - ax)
        xs.push(x)
      }
    }
    xs.sort((a, b) => a - b)
    for (let m = 0; m + 1 < xs.length; m += 2) {
      const xL = Math.round(xs[m])
      const xR = Math.round(xs[m + 1])
      for (let x = xL; x < xR; x++)
        setPx(buf, x, y, color, 255)
    }
  }
}

/** 画粗圆环（描边圆，半宽 hw）。 */
function strokeCircle(buf, cx, cy, r, hw, color) {
  const minX = Math.max(0, Math.floor(cx - r - hw - 1))
  const maxX = Math.min(SIZE - 1, Math.ceil(cx + r + hw + 1))
  const minY = Math.max(0, Math.floor(cy - r - hw - 1))
  const maxY = Math.min(SIZE - 1, Math.ceil(cy + r + hw + 1))
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r)
      if (d <= hw - 0.5)
        setPx(buf, x, y, color, 255)
      else if (d <= hw + 0.5)
        blendPx(buf, x, y, color, Math.round((hw + 0.5 - d) * 255))
    }
  }
}

// ---------------------------------------------------------------------------
// 2 套图标几何（80×80，留 ~8px 边距，主笔画粗 hw≈3.2）
// ---------------------------------------------------------------------------

const HW = 3.4 // 主描边半宽（粗墨硬朗）

/** 首页：house ⌂ —— 屋顶三角 + 墙体方框 + 一道门。 */
function drawHome(buf, color) {
  // 屋顶（粗折线，山墙）
  drawPolyline(buf, [[14, 40], [40, 16], [66, 40]], HW, color)
  // 墙体方框（左右下三边 + 顶边在屋檐下）
  drawPolyline(buf, [
    [20, 40],
    [20, 66],
    [60, 66],
    [60, 40],
  ], HW, color)
  // 屋檐顶横（连屋顶与墙）
  drawThickSeg(buf, 18, 40, 62, 40, HW, color)
  // 门（实心小方块，朱红/墨同色，体现号外硬块）
  fillPolygon(buf, [[35, 50], [45, 50], [45, 66], [35, 66]], color)
}

/** 我的：人像 👤 —— 头(圆) + 肩(梯形描边)。 */
function drawMe(buf, color) {
  const cx = 40
  // 头（描边圆）
  strokeCircle(buf, cx, 28, 12, HW, color)
  // 肩 / 身（半圆肩线，粗描边梯形顶弧）
  drawPolyline(buf, [
    [18, 64],
    [18, 56],
    [30, 46],
    [50, 46],
    [62, 56],
    [62, 64],
  ], HW, color)
  // 肩底封口
  drawThickSeg(buf, 18, 64, 62, 64, HW, color)
}

// ---------------------------------------------------------------------------
// 编码 + 写盘
// ---------------------------------------------------------------------------

function bufToPng(buf) {
  const png = new PNG({ width: SIZE, height: SIZE })
  for (let i = 0; i < buf.length; i++)
    png.data[i] = buf[i]
  return PNG.sync.write(png)
}

function gen(name, drawFn, color) {
  const buf = makeCanvas()
  drawFn(buf, color)
  const out = resolve(OUT_DIR, name)
  writeFileSync(out, bufToPng(buf))
  // 统计非透明像素，便于 sanity check
  let nonTransparent = 0
  for (let i = 3; i < buf.length; i += 4) {
    if (buf[i] > 0)
      nonTransparent++
  }
  console.log(`  ${name.padEnd(12)} ${SIZE}x${SIZE}  非透明像素=${nonTransparent}`)
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  console.log(`生成 tabbar 图标 → ${OUT_DIR}`)
  console.log('inactive(墨黑 #1A1A1A) + active(品牌 #33B36B)，80×80 透明底：')
  gen('home.png', drawHome, INK)
  gen('homeHL.png', drawHome, BRAND)
  gen('me.png', drawMe, INK)
  gen('meHL.png', drawMe, BRAND)
  console.log('完成。⚠️ AI 手画几何图标，待视觉签字（Kevin / 真设计师）；可同名 drop-in 替换。')
}

main()
