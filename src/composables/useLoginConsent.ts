/**
 * useLoginConsent — 按需登录的协议同意闸门（微信合规）。
 *
 * <p>模块级单例状态：所有 BizScreen 里挂的 {@code <BizLoginSheet/>} 共享同一份 visible/agreed/
 * resolver。`ensureLoggedIn`（useAuth）在未登录时 `await open()` 弹出底部协议 sheet —— 用户**主动
 * 勾选**协议（默认不勾选）后点「微信登录」才 resolve(true)，否则 resolve(false)。</p>
 *
 * <p>合规要点（微信审核驳回整改）：不得默认强制同意《用户服务协议》《隐私政策》—— 勾选框每次打开
 * 重置为未勾选，未勾选时登录按钮不可点。</p>
 *
 * <p>关联：useAuth.ensureLoggedIn / BizLoginSheet.vue / doc/10 §1.E1</p>
 */
import { ref } from 'vue'

/**
 * 协议同意持久化 key（「同意一次」门控）：用户在 sheet 主动勾选同意后落地，
 * 之后 App 启动的 silentLogin 才允许静默自动登录（已同意过 → 无感；未同意 → 游客匿名浏览）。
 */
const CONSENT_STORAGE_KEY = 'gz_privacy_agreed'

/**
 * 是否已同意过隐私协议（持久化态）。
 * silentLogin 用它决定是否允许启动静默自动登录；未同意过 → 不自动登录，留游客态。
 */
export function hasAgreedPrivacy(): boolean {
  try {
    return uni.getStorageSync(CONSENT_STORAGE_KEY) === true
  }
  catch {
    return false
  }
}

/**
 * 清除「已同意」态（登出时调用）：登出后回到游客首启态，下次启动不自动登录、
 * 再次敏感动作时重新弹协议 sheet。否则 silentLogin 会因 flag 仍在而把刚登出的用户自动登回去。
 */
export function clearAgreedPrivacy(): void {
  try {
    uni.removeStorageSync(CONSENT_STORAGE_KEY)
  }
  catch {
    // 忽略：清除失败最坏只是下次启动仍自动登录
  }
}

/** sheet 是否可见 */
const visible = ref(false)
/** 协议勾选态（每次打开重置为 false） */
const agreed = ref(false)
/** 当前打开的 promise resolver；resolve 后置空，保证只 settle 一次 */
let resolver: ((ok: boolean) => void) | null = null

export function useLoginConsent() {
  /**
   * 打开协议登录 sheet，等待用户决定。
   *
   * @returns 用户勾选协议并点登录 → true；取消 / 关闭 → false
   */
  function open(): Promise<boolean> {
    // 若已有未决的打开，先把旧的判为取消，避免孤儿 promise
    resolver?.(false)
    agreed.value = false
    visible.value = true
    return new Promise<boolean>((resolve) => {
      resolver = resolve
    })
  }

  /** 切换协议勾选 */
  function toggleAgree() {
    agreed.value = !agreed.value
  }

  /** 用户点「微信登录」：仅在已勾选时放行，并持久化「已同意」（之后启动允许 silentLogin 静默登录） */
  function confirm() {
    if (!agreed.value) {
      return
    }
    try {
      uni.setStorageSync(CONSENT_STORAGE_KEY, true)
    }
    catch {
      // 持久化失败不阻断登录；最坏只是下次启动仍需再同意一次
    }
    visible.value = false
    const r = resolver
    resolver = null
    r?.(true)
  }

  /** 用户取消（点遮罩 / ✕ / 暂不登录） */
  function cancel() {
    visible.value = false
    const r = resolver
    resolver = null
    r?.(false)
  }

  return { visible, agreed, open, toggleAgree, confirm, cancel }
}
