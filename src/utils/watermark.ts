/**
 * 小程序拍照水印工具（SYS-INFRA-003）。
 *
 * 用 uni 原生 canvas 把多行文本叠到右下角（半透明黑底白字），导出新的临时图片路径。
 *
 * 设计选择：
 * - 用 canvas 2d type（小程序基础库 2.9.0+）+ `wx.createSelectorQuery` 拿 canvas 节点；
 * - H5 / app-plus 走 `uni.createCanvasContext` 老 API 兼容路径（V1 范围只跑 mp-weixin，
 *   但留兜底逻辑避免 build 报 #ifdef 不一致）；
 * - 字体大小按图片宽度自适应（width / 30，clamp 20-44px），不读屏幕 dpr 防止微信端虚化；
 * - 文本背景框带 16px padding，圆角 8px，黑色 60% 透明度。
 */

/**
 * 单行水印文本（按渲染顺序从上到下排列）。
 */
export interface WatermarkLine {
  /** 显示文本（已 i18n / 已拼接）。空字符串会跳过该行 */
  text: string
}

/**
 * 水印位置（V1 仅支持右下 `br`，其他选项为 V2 预留 / 后续业务自行扩展时不破坏签名）。
 */
export type WatermarkPosition = 'br' | 'bl' | 'tr' | 'tl'

export interface WatermarkOptions {
  /** 水印多行内容（按顺序渲染，空数组会直接返回原图） */
  lines: WatermarkLine[]
  /** 位置，默认 br（右下） */
  position?: WatermarkPosition
  /** canvas 2d 节点的 canvas-id（页面里 `<canvas type="2d" id="xxx">` 的 id） */
  canvasId: string
  /** 调用 createSelectorQuery 的页面实例（页面 setup 内 `getCurrentInstance().proxy`） */
  pageContext?: WechatMiniprogram.Page.TrivialInstance | null
  /** 字体颜色，默认 #ffffff */
  fontColor?: string
  /** 背景颜色（rgba），默认 rgba(0,0,0,0.6) */
  bgColor?: string
  /**
   * canvas 长边上限（像素），默认 2400。超过则按比例缩放以防低端 Android OOM
   * （4032×3024 主摄 ~48MB canvas，2400×1800 ~17MB，差 3 倍）。
   */
  maxSide?: number
}

interface ImageInfo {
  /** 临时文件路径（uni.getImageInfo 给出的 path） */
  path: string
  /** 原始像素宽 */
  width: number
  /** 原始像素高 */
  height: number
}

function getImageInfo(imagePath: string): Promise<ImageInfo> {
  return new Promise((resolve, reject) => {
    uni.getImageInfo({
      src: imagePath,
      success: (res) => {
        resolve({ path: res.path, width: res.width, height: res.height })
      },
      fail: (err) => {
        reject(new Error(`getImageInfo 失败: ${typeof err === 'string' ? err : JSON.stringify(err)}`))
      },
    })
  })
}

/**
 * 在指定 canvas 上绘制图片 + 水印，并导出新图片临时路径。
 *
 * 仅 mp-weixin 路径（V1 范围）。其他平台调用此函数会抛 `unsupported platform`。
 */
export async function renderWatermark(imagePath: string, options: WatermarkOptions): Promise<string> {
  const visibleLines = options.lines.filter(l => !!l.text)
  if (visibleLines.length === 0) {
    // 没有水印行 → 直接返回原图，不浪费一次 canvas 渲染
    return imagePath
  }

  const info = await getImageInfo(imagePath)

  // #ifdef MP-WEIXIN
  return renderOnWeixinCanvas2d(info, visibleLines, options)
  // #endif

  // #ifndef MP-WEIXIN
  throw new Error('[watermark] 当前平台不支持，V1 仅实现 mp-weixin')
  // #endif
}

// #ifdef MP-WEIXIN
interface WxCanvasNode {
  width: number
  height: number
  getContext: (type: '2d') => CanvasRenderingContext2D
}

/**
 * 取微信小程序 Canvas 2D 节点。
 *
 * 微信要求必须从 `wx.createSelectorQuery().in(page).select('#id').fields({node:true,size:true}).exec()` 取，
 * 不能跨页面拿。pageContext 由调用方（组件 onReady）传进来。
 */
function queryCanvasNode(canvasId: string, pageContext: WechatMiniprogram.Page.TrivialInstance | null | undefined): Promise<WxCanvasNode> {
  return new Promise((resolve, reject) => {
    const query = pageContext ? wx.createSelectorQuery().in(pageContext) : wx.createSelectorQuery()
    query
      .select(`#${canvasId}`)
      .fields({ node: true, size: true })
      .exec((res) => {
        const node: WxCanvasNode | undefined = res?.[0]?.node
        if (!node) {
          reject(new Error(`[watermark] canvas 节点未找到: #${canvasId}`))
          return
        }
        resolve(node)
      })
  })
}

function loadImageOnCanvas(canvasNode: WxCanvasNode, path: string): Promise<{ width: number, height: number } & { image: CanvasImageSource }> {
  return new Promise((resolve, reject) => {
    // 微信 canvas 2d 的 createImage 在 node 上
    const image = (canvasNode as unknown as { createImage: () => HTMLImageElement }).createImage()
    image.onload = () => {
      resolve({ image: image as unknown as CanvasImageSource, width: image.width, height: image.height })
    }
    image.onerror = () => {
      reject(new Error(`[watermark] canvas createImage onerror, path=${path}`))
    }
    image.src = path
  })
}

async function renderOnWeixinCanvas2d(
  info: ImageInfo,
  lines: WatermarkLine[],
  options: WatermarkOptions,
): Promise<string> {
  const node = await queryCanvasNode(options.canvasId, options.pageContext)
  const ctx = node.getContext('2d')

  // 长边上限 2400px 防止低端 Android canvas OOM；
  // 高分辨率主摄（如 4032×3024）按比例缩放后再渲染。
  const maxSide = options.maxSide ?? 2400
  const scale = Math.min(1, maxSide / Math.max(info.width, info.height))
  const renderW = Math.round(info.width * scale)
  const renderH = Math.round(info.height * scale)
  node.width = renderW
  node.height = renderH

  const { image } = await loadImageOnCanvas(node, info.path)
  ctx.clearRect(0, 0, renderW, renderH)
  ctx.drawImage(image, 0, 0, renderW, renderH)

  // 字体大小按渲染宽自适应
  const fontSize = Math.max(20, Math.min(44, Math.round(renderW / 30)))
  const lineHeight = Math.round(fontSize * 1.4)
  const padding = 16
  const radius = 8

  ctx.font = `${fontSize}px sans-serif`
  ctx.textBaseline = 'top'

  // 量算每行宽度，取最大
  const measured = lines.map(l => ({ text: l.text, w: ctx.measureText(l.text).width }))
  const boxInnerW = Math.ceil(Math.max(...measured.map(m => m.w)))
  const boxInnerH = lineHeight * lines.length
  const boxW = boxInnerW + padding * 2
  const boxH = boxInnerH + padding * 2

  const pos = options.position ?? 'br'
  const margin = padding
  let boxX = renderW - boxW - margin
  let boxY = renderH - boxH - margin
  if (pos === 'bl') {
    boxX = margin
    boxY = renderH - boxH - margin
  }
  else if (pos === 'tr') {
    boxX = renderW - boxW - margin
    boxY = margin
  }
  else if (pos === 'tl') {
    boxX = margin
    boxY = margin
  }

  ctx.fillStyle = options.bgColor ?? 'rgba(0,0,0,0.6)'
  drawRoundedRect(ctx, boxX, boxY, boxW, boxH, radius)
  ctx.fill()

  ctx.fillStyle = options.fontColor ?? '#ffffff'
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i].text, boxX + padding, boxY + padding + i * lineHeight)
  }

  // 导出
  return new Promise<string>((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas: node as unknown as WechatMiniprogram.Canvas,
      fileType: 'jpg',
      quality: 0.9,
      success: (res: { tempFilePath: string }) => resolve(res.tempFilePath),
      fail: (err: WechatMiniprogram.GeneralCallbackResult) => reject(new Error(`[watermark] canvasToTempFilePath 失败: ${err.errMsg}`)),
    })
  })
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}
// #endif

/**
 * 组装常用水印行（业务页可直接复用）。
 *
 * 字段全部可选，传 undefined / null / '' 会跳过对应行。
 */
export interface WatermarkContext {
  /** 时间戳（已格式化，例：2026-05-21 14:32:08） */
  timeText?: string
  /** GPS 经纬度（例：121.4737, 31.2304） */
  gpsText?: string
  /** 地址 / 农场名 */
  farmName?: string
  /** 操作人名 */
  operatorName?: string
  /** 业务标记（例：耳号 01A1260520001 / 圈舍 A1） */
  bizTag?: string
}

export function buildWatermarkLines(ctx: WatermarkContext): WatermarkLine[] {
  const lines: WatermarkLine[] = []
  if (ctx.timeText) {
    lines.push({ text: ctx.timeText })
  }
  if (ctx.gpsText) {
    lines.push({ text: `GPS: ${ctx.gpsText}` })
  }
  if (ctx.farmName) {
    lines.push({ text: ctx.farmName })
  }
  if (ctx.operatorName) {
    lines.push({ text: `操作人: ${ctx.operatorName}` })
  }
  if (ctx.bizTag) {
    lines.push({ text: ctx.bizTag })
  }
  return lines
}

/**
 * yyyy-MM-dd HH:mm:ss 格式化（不依赖 dayjs，省一个 import；与项目其他时间格式对齐）。
 */
export function formatWatermarkTime(date: Date = new Date()): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * GPS 经纬度文本（4 位小数 ≈ 11m 精度，对生态农场场景够用）。
 */
export function formatGps(longitude: number, latitude: number): string {
  return `${longitude.toFixed(4)}, ${latitude.toFixed(4)}`
}
