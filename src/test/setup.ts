/**
 * Vitest 全局 setup（SYS-INFRA-009）。
 *
 * 小程序代码运行时依赖宿主 (`uni` / `wx` / `getCurrentPages`) 提供的全局 API；
 * 单测在 happy-dom 里跑，这些全局不存在，触发引用就会 ReferenceError。
 * 本文件提供最小可用 mock，让 `src/store/*` / `src/utils/*` / `src/components/biz/*`
 * 能直接 import 并断言纯逻辑分支。
 *
 * 测试自定义存储 / 网络 / 路由：在用例内 `vi.spyOn(uni, 'xxx')` 改 mock 返回值，
 * 不要在这里写业务逻辑，本文件只负责"全局存在"。
 */
import { beforeEach, vi } from 'vitest'

/**
 * 内存版 storage（替代 wx 的 KV），每次用例前清空，避免互相污染。
 */
const memoryStorage: Record<string, unknown> = {}

function resetMemoryStorage() {
  for (const k of Object.keys(memoryStorage)) {
    delete memoryStorage[k]
  }
}

const uniMock = {
  getStorageSync: vi.fn((key: string) => memoryStorage[key] ?? ''),
  setStorageSync: vi.fn((key: string, value: unknown) => {
    memoryStorage[key] = value
  }),
  removeStorageSync: vi.fn((key: string) => {
    delete memoryStorage[key]
  }),
  clearStorageSync: vi.fn(() => resetMemoryStorage()),

  showToast: vi.fn(),
  showModal: vi.fn(),
  showLoading: vi.fn(),
  hideLoading: vi.fn(),

  navigateTo: vi.fn(),
  redirectTo: vi.fn(),
  reLaunch: vi.fn(),
  switchTab: vi.fn(),
  navigateBack: vi.fn(),

  // 默认 success 路径返 200 空对象；用例需要别的响应自行 spyOn 改实现
  request: vi.fn((options: { success?: (res: unknown) => void }) => {
    options.success?.({ statusCode: 200, data: {} })
  }),

  // 登录 / 图片信息 — 单测里通常 mock 掉，提供 noop 默认避免抛 ref err
  login: vi.fn((options: { success?: (res: unknown) => void }) => {
    options.success?.({ code: 'mock-code' })
  }),
  getImageInfo: vi.fn((options: { success?: (res: unknown) => void }) => {
    options.success?.({ path: 'mock://image', width: 100, height: 100 })
  }),

  getSystemInfoSync: vi.fn(() => ({ platform: 'devtools', system: 'happy-dom', windowWidth: 375 })),
  setNavigationBarTitle: vi.fn(),
}

const wxMock = {
  createSelectorQuery: vi.fn(() => ({
    select: () => ({
      fields: () => ({
        exec: (cb: (res: unknown[]) => void) => cb([{ node: { width: 100, height: 100 }, width: 100, height: 100 }]),
      }),
    }),
    in: () => ({
      select: () => ({
        fields: () => ({
          exec: (cb: (res: unknown[]) => void) => cb([{ node: { width: 100, height: 100 }, width: 100, height: 100 }]),
        }),
      }),
    }),
  })),
  // 微信小程序原生 API 占位（按需扩）
  login: uniMock.login,
}

// 挂全局；vitest 跑在 node + happy-dom，两个全局都得有
;(globalThis as Record<string, unknown>).uni = uniMock
;(globalThis as Record<string, unknown>).wx = wxMock

// 每个用例前 reset storage + spy 状态，避免上一个 test 写入影响下一个
beforeEach(() => {
  resetMemoryStorage()
  vi.clearAllMocks()
})

// 暴露 mock 引用方便用例里直接 import 改返回值
export { memoryStorage, uniMock, wxMock }
