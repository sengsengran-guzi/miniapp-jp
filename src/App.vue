<script setup lang="ts">
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app'
import { useAuth } from '@/hooks/useAuth'
import { navigateToInterceptor } from '@/router/interceptor'

onLaunch(async (options) => {
  console.log('App.vue onLaunch', options)

  // 启动静默登录（标准 mp 模式，无弹窗）：wx.login 不需手势，dev/H5 走 wxMOCK 短路。
  // 让落地页接口（场次 / 商品 / getMe）有登录态，避免「懒登录去掉强弹后一进来全 401」。
  // 失败静默退化匿名浏览；敏感动作时 ensureLoggedIn 再兜底。
  // 「同意一次」门控：未同意过隐私协议的用户不会被静默登录（见 useAuth.silentLogin）。
  try {
    void useAuth().silentLogin()
  }
  catch (e) {
    console.warn('[gz-jp] silent login skipped on launch', e)
  }
})
onShow((options) => {
  console.log('App.vue onShow', options)
  if (options?.path) {
    navigateToInterceptor.invoke({
      url: `/${options.path}`,
      query: options.query,
    })
  }
  else {
    navigateToInterceptor.invoke({ url: '/' })
  }
})
onHide(() => {
  console.log('App Hide')
})
</script>

<style lang="scss"></style>
