<script setup lang="ts">
/**
 * BizButton — C 套主行动按钮（粗墨边 + 硬投影 + 900 字重 + 按下位移）。
 *
 * <pre>
 * &lt;BizButton @click="submit"&gt;预约 →&lt;/BizButton&gt;
 * &lt;BizButton type="green" size="lg" block @click="pay"&gt;微信支付&lt;/BizButton&gt;
 * &lt;BizButton type="ghost" size="sm"&gt;再想想&lt;/BizButton&gt;
 * &lt;BizButton :disabled="!agree" @click="next"&gt;立即预约&lt;/BizButton&gt;
 * </pre>
 *
 * <p>设计系统：doc/tokens.md / src/style/c-tokens.scss(.c-btn)</p>
 */
defineOptions({ name: 'BizButton' })

const props = withDefaults(defineProps<Props>(), {
  type: 'red',
  size: 'md',
  block: false,
  disabled: false,
})
const emit = defineEmits<{ click: [] }>()
interface Props {
  /** 配色：red(默认主) / green(支付/成功) / ink(次要) / ghost(白底描边) */
  type?: 'red' | 'green' | 'ink' | 'ghost'
  /** 尺寸：sm / md(默认) / lg */
  size?: 'sm' | 'md' | 'lg'
  /** 占满整行宽度 */
  block?: boolean
  /** 禁用态 */
  disabled?: boolean
}
function onTap() {
  if (props.disabled)
    return
  emit('click')
}
</script>

<template>
  <view
    class="biz-btn"
    :class="[`type-${type}`, `size-${size}`, { 'is-block': block, 'is-disabled': disabled }]"
    @tap="onTap"
  >
    <slot />
  </view>
</template>

<style lang="scss" scoped>
/* 清爽：圆角 + 红光阴影（主） + 600 字重，去粗墨边/硬投影。 */
.biz-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  box-sizing: border-box;
  font-weight: 600;
  letter-spacing: 0.5rpx;
  color: var(--c-on-dark);
  background: var(--c-red);
  border-radius: var(--c-radius);
  box-shadow: var(--c-shadow-btn);
  transition:
    transform 0.12s ease,
    opacity 0.12s ease;
}
.is-block {
  display: flex;
  width: 100%;
}
.size-sm {
  padding: 12rpx 28rpx;
  font-size: var(--c-fs-sm);
}
.size-md {
  padding: 22rpx 40rpx;
  font-size: var(--c-fs-body);
}
.size-lg {
  padding: 28rpx 44rpx;
  font-size: var(--c-fs-lg);
}

.type-red {
  background: var(--c-red);
}
/* 仅主红按钮带红光阴影，其余扁平 */
.type-green {
  background: var(--c-green);
  box-shadow: none;
}
.type-ink {
  background: var(--c-ink);
  box-shadow: none;
}
.type-ghost {
  background: transparent;
  color: var(--c-ink);
  border: var(--c-bw-3) solid var(--c-line);
  box-shadow: none;
}
.size-sm.type-red {
  box-shadow: none;
}

.biz-btn:active:not(.is-disabled) {
  transform: translateY(1rpx);
  opacity: 0.92;
}
.is-disabled {
  background: #d9d4cb;
  color: var(--c-on-dark);
  box-shadow: none;
}
</style>
