import type { IResponse } from '@/http/types'
/**
 * 业务文件上传 / 对象存储 API（小程序端）
 *
 * 契约：与后端 ruoyi-gz-common.GzFileMpController 严格对齐
 *   - POST  /app/gz/common/file/upload  multipart/form-data: { file, usageType }
 *   - GET   /app/gz/common/file/url     ?fileId=
 *
 * 使用场景枚举真源在后端 GzFileUsageType.java（后端校验 usageType 合法性）。
 * 本小程序 C 端只上传用户头像；商品 / 场次图片由 admin 侧上传，不走 mp。
 */
import { http } from '@/http/http'
import { useTokenStore } from '@/store'
import { getEnvBaseUrl } from '@/utils'

/** doc/11 §5.3 — gz_file_object 视图字段 */
export interface GzFileObjectVO {
  /** 文件 id（业务表关联用，BIGINT 序列化为 number） */
  fileId: number
  /** 对象存储 key（mp 端置 null） */
  objectKey?: string
  /** 原文件名 */
  fileName: string
  /** 字节数 */
  fileSize: number
  /** MIME */
  mimeType: string
  /** 使用场景 */
  usageType: string
  /** 预签名 URL（1h 过期；调 /url 接口时填充） */
  url?: string
  /** 上传时间（后端返回 ISO 字符串） */
  createTime?: string
}

/**
 * 使用场景枚举（值必须存在于后端 GzFileUsageType，否则后端拒收）。
 * 本小程序当前只用到用户头像；新增场景先加后端枚举再补这里。
 */
export const GZ_FILE_USAGE_TYPE = {
  USER_AVATAR: 'user_avatar',
} as const

export type GzFileUsageType = (typeof GZ_FILE_USAGE_TYPE)[keyof typeof GZ_FILE_USAGE_TYPE]

/**
 * 上传文件
 * <p>
 * 调用方需先 `wx.chooseImage` / `uni.chooseImage` 拿到 tempFilePath，然后调本函数。
 * 内部封装 `uni.uploadFile` — http.ts 的拦截器不能直接拦 multipart 上传，因此本函数
 * 直接调底层 API + 手动注入 baseURL + Authorization + clientid。
 * </p>
 *
 * @param tempFilePath chooseImage 拿到的临时文件路径
 * @param usageType 使用场景枚举
 * @returns 后端返回的 GzFileObjectVO（含 fileId + url 预签名）
 */
export function uploadFile(tempFilePath: string, usageType: GzFileUsageType): Promise<GzFileObjectVO> {
  return new Promise((resolve, reject) => {
    const baseUrl = getEnvBaseUrl()
    const tokenStore = useTokenStore()
    const token = tokenStore.updateNowTime().validToken
    const header: Record<string, string> = {
      clientid: import.meta.env.VITE_APP_CLIENT_ID as string,
    }
    if (token) {
      header.Authorization = `Bearer ${token}`
    }

    uni.uploadFile({
      url: `${baseUrl}/app/gz/common/file/upload`,
      filePath: tempFilePath,
      name: 'file',
      formData: { usageType },
      header,
      timeout: 60_000,
      success: (res) => {
        try {
          const body = JSON.parse(res.data) as IResponse<GzFileObjectVO>
          if (body.code === 200 && body.data) {
            resolve(body.data)
          }
          else {
            reject(new Error(body.msg || 'upload failed'))
          }
        }
        catch (e) {
          reject(new Error(`response parse failed: ${(e as Error).message}`))
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || 'upload io failed'))
      },
    })
  })
}

/**
 * 拿带 1h 过期签名的临时 URL
 */
export function getFileUrl(fileId: number) {
  return http<GzFileObjectVO>({
    url: '/app/gz/common/file/url',
    method: 'GET',
    query: { fileId },
  })
}
