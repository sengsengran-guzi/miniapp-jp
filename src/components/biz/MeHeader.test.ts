import { mount } from '@vue/test-utils'
/**
 * MeHeader 两态切换单测（GZ-USER-001 AC 6）。
 *
 * 覆盖 AC 1/2：
 *   - 未登录 → 显示「点击登录」+ 点击 emit('login')
 *   - 已登录 + 有昵称 → 显示真实昵称
 *   - 已登录 + 无昵称 → 回退「微信用户」
 *   - 已登录 + 有头像 → 渲染 image
 *
 * easycom 全局组件（BizPanel / BizScreentone）在 vitest 环境未注册 — 用 global.stubs 占位，
 * 不影响 MeHeader 自身逻辑（昵称文案 / image 渲染 / emit）断言。
 */
import { describe, expect, it } from 'vitest'
import MeHeader from './MeHeader.vue'

const globalStubs = {
  BizPanel: { template: '<view><slot /></view>' },
  BizScreentone: { template: '<view />' },
}

interface MeHeaderProps {
  loggedIn: boolean
  nickname?: string | null
  avatarUrl?: string | null
}

function mountHeader(props: MeHeaderProps) {
  return mount(MeHeader, { props, global: { stubs: globalStubs } })
}

describe('meHeader', () => {
  it('未登录 → 显示「点击登录」', () => {
    const w = mountHeader({ loggedIn: false })
    expect(w.text()).toContain('点击登录')
  })

  it('未登录 → 点击头部 emit(login)', async () => {
    const w = mountHeader({ loggedIn: false })
    await w.find('.me-header__top').trigger('tap')
    expect(w.emitted('login')).toBeTruthy()
  })

  it('已登录 + 有昵称 → 显示真实昵称', () => {
    const w = mountHeader({ loggedIn: true, nickname: '阿喵', avatarUrl: '' })
    expect(w.text()).toContain('阿喵')
    expect(w.text()).not.toContain('点击登录')
  })

  it('已登录 + 无昵称 → 回退「微信用户」', () => {
    const w = mountHeader({ loggedIn: true, nickname: '', avatarUrl: '' })
    expect(w.text()).toContain('微信用户')
  })

  it('已登录 → 点击头部 emit(edit)（进资料编辑），不 emit login', async () => {
    const w = mountHeader({ loggedIn: true, nickname: '阿喵', avatarUrl: '' })
    await w.find('.me-header__top').trigger('tap')
    expect(w.emitted('edit')).toBeTruthy()
    expect(w.emitted('login')).toBeFalsy()
  })

  it('已登录 + 有头像 → 渲染 image', () => {
    const w = mountHeader({ loggedIn: true, nickname: '阿喵', avatarUrl: 'https://x/a.png' })
    expect(w.find('.me-header__avatar-img').exists()).toBe(true)
  })

  it('已登录 + 无头像 → 显示占位 emoji', () => {
    const w = mountHeader({ loggedIn: true, nickname: '阿喵', avatarUrl: '' })
    expect(w.find('.me-header__avatar-ph').exists()).toBe(true)
    expect(w.find('.me-header__avatar-img').exists()).toBe(false)
  })

  it('已登录 + 无头像 → 副标题引导去完善资料', () => {
    const w = mountHeader({ loggedIn: true, nickname: '阿喵', avatarUrl: '' })
    expect(w.find('.me-header__sub').text()).toContain('完善')
  })
})
