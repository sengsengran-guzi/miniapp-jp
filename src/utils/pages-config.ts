/* eslint-disable style/indent */
import type { PageMetaDatum, SubPackages } from '@uni-helper/vite-plugin-uni-pages'

import type { PageInstance } from '@/utils'
import { pages, subPackages } from '@/pages.json'
import { currRoute } from '@/utils'

/**
 * 把所有 page.json 依赖（`@/pages.json` import）集中到本文件，
 * `@/utils/index.ts` 保持纯逻辑，避免 vitest 把 pages.json 注释当 JSON 解析失败。
 */

/**
 * 得到所有需要登录的 pages，包括主包和分包的。
 *
 * <p>通用化设计：传 key 表示按 page[key] 过滤；不传 key 表示返回全部 pages。
 * 与 route-block 配对使用。</p>
 */
export function getAllPages(key?: string) {
  const mainPages = (pages as PageMetaDatum[])
    .filter(page => !key || page[key])
    .map(page => ({
      ...page,
      path: `/${page.path}`,
    }))

  const subPages: PageMetaDatum[] = []
    ; (subPackages as SubPackages).forEach((subPageObj) => {
      const { root } = subPageObj
      subPageObj.pages
        .filter(page => !key || page[key])
        .forEach((page) => {
          subPages.push({
            ...page,
            path: `/${root}/${page.path}`,
          })
        })
    })
  return [...mainPages, ...subPages]
}

export function getCurrentPageI18nKey() {
  const routeObj = currRoute()
  const currPage = (pages as PageMetaDatum[]).find(page => `/${page.path}` === routeObj.path)
  if (!currPage) {
    console.warn('路由不正确')
    return ''
  }
  return currPage.style?.navigationBarTitleText || ''
}

/**
 * 首页路径：page.json 里 type='home' 的页面，否则取第一个页面。
 * 通常为 /pages/index/index。
 */
export const HOME_PAGE = `/${(pages as PageMetaDatum[]).find(page => page.type === 'home')?.path || (pages as PageMetaDatum[])[0].path}`

export type { PageInstance }
