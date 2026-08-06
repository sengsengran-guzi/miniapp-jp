import type { IUserInfoRes } from '@/api/types/login'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getUserInfo } from '@/api/login'

/** 初始用户信息（未登录态） */
const userInfoState: IUserInfoRes = {
  userId: -1,
  username: '',
  nickname: '',
  avatar: '/static/images/default-avatar.png',
  roles: [],
}

/**
 * 用户 store。
 *
 * 通用的 userInfo + 登录态拉取能力；真实资料由 useAuth 微信登录链路写入。
 *
 * 多租户：强制 tenantId='1001'（与现有小程序同租户，共用后端主数据）。
 */
export const useUserStore = defineStore(
  'user',
  () => {
    const userInfo = ref<IUserInfoRes>({ ...userInfoState })
    /** V1 强制 '1001'，对齐后端 gz_* 业务表 tenant_id VARCHAR(20) */
    const tenantId = ref<string>(String(import.meta.env.VITE_APP_TENANT_ID) || '1001')

    const setUserInfo = (val: IUserInfoRes) => {
      if (!val.avatar) {
        val.avatar = userInfoState.avatar
      }
      userInfo.value = val
    }

    const setUserAvatar = (avatar: string) => {
      userInfo.value.avatar = avatar
    }

    const clearUserInfo = () => {
      userInfo.value = { ...userInfoState }
      uni.removeStorageSync('user')
    }

    /** 拉用户信息（roleKeys 在 userInfo.roles） */
    const fetchUserInfo = async () => {
      const res = await getUserInfo()
      setUserInfo(res)
      return res
    }

    return {
      userInfo,
      tenantId,
      setUserInfo,
      setUserAvatar,
      clearUserInfo,
      fetchUserInfo,
    }
  },
  {
    persist: true,
  },
)
