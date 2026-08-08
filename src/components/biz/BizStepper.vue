<script setup lang="ts">
/**
 * BizStepper — 数量步进器（商品详情底部 CTA 条 / 后续购物车行内复用）。
 *
 * <pre>
 * &lt;BizStepper v-model="quantity" :min="1" :max="99" :disabled="ended" /&gt;
 * </pre>
 *
 * <p><b>为什么自己写而不用 wd-input-number</b>：组件库无关纪律（CLAUDE.md §7.5）——
 * 页面不直接撒 {@code <wd-*>}，切换底层组件库时只改 Biz 组件。这个控件只有加减两个按钮
 * 和一个只读数字，用 view/text 原语实现比包一层更短。</p>
 *
 * <p><b>刻意不做键盘输入</b>：mp 的 {@code <input type="number">} 在部分基础库上返回<b>字符串</b>
 * （项目已踩过：提交时 400），且数量场景「点几下加号」比「唤起键盘打字」快。真要加输入，
 * 必须 {@code type="digit"} + 提交前显式 cast，别用 {@code type="number"}。</p>
 *
 * <p>值的合法性由调用方用 {@code clampQuantity} 收敛；本组件只负责不越界地 emit。</p>
 *
 * <p><b>加减按钮必须 {@code @tap.stop}（编译成 mp 的 catchtap），别改回 {@code @tap}</b>：
 * mp 里原生 tap 会<b>穿过自定义组件边界</b>往上冒泡，而调用方常把整行包成可点区
 * （购物车行 {@code <BizCartItem @tap="跳商品详情">}）。不 stop 的话点「＋」会在改数量的同时
 * 触发行点击跳走 —— 数量确实改了但人已经离开购物车，表现像「合计不刷新」。
 * 禁用态（{@code is-off}）也要 stop：灰按钮更不该把人带去别的页。</p>
 */
import { computed } from 'vue'

defineOptions({ name: 'BizStepper' })

const props = withDefaults(defineProps<Props>(), {
  min: 1,
  max: 99,
  disabled: false,
})
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

interface Props {
  /** 当前数量（v-model） */
  modelValue: number
  /** 下限（含） */
  min?: number
  /** 上限（含） */
  max?: number
  /** 整体禁用（如场已结束） */
  disabled?: boolean
}

const canMinus = computed(() => !props.disabled && props.modelValue > props.min)
const canPlus = computed(() => !props.disabled && props.modelValue < props.max)

function onMinus() {
  if (!canMinus.value) {
    return
  }
  emit('update:modelValue', props.modelValue - 1)
}

function onPlus() {
  if (!canPlus.value) {
    return
  }
  emit('update:modelValue', props.modelValue + 1)
}
</script>

<template>
  <view class="biz-stepper" :class="{ 'is-disabled': disabled }">
    <view
      class="biz-stepper__btn biz-stepper__minus"
      :class="{ 'is-off': !canMinus }"
      @tap.stop="onMinus"
    >
      <text class="biz-stepper__sign">−</text>
    </view>
    <text class="biz-stepper__value">{{ modelValue }}</text>
    <view
      class="biz-stepper__btn biz-stepper__plus"
      :class="{ 'is-off': !canPlus }"
      @tap.stop="onPlus"
    >
      <text class="biz-stepper__sign">＋</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.biz-stepper {
  display: inline-flex;
  align-items: center;
  gap: 4rpx;
  border-radius: var(--c-radius);
  background: rgba(33, 29, 23, 0.04);
  padding: 4rpx;
}
.is-disabled {
  opacity: 0.5;
}
.biz-stepper__btn {
  width: 56rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: calc(var(--c-radius) - 6rpx);
  background: var(--c-surface);
  transition: opacity 0.12s ease;

  &:active:not(.is-off) {
    opacity: 0.7;
  }
}
.biz-stepper__btn.is-off {
  background: transparent;
}
.biz-stepper__btn.is-off .biz-stepper__sign {
  color: var(--c-ink-3);
}
.biz-stepper__sign {
  font-size: var(--c-fs-body);
  font-weight: 700;
  line-height: 1;
  color: var(--c-ink);
}
.biz-stepper__value {
  min-width: 64rpx;
  text-align: center;
  font-size: var(--c-fs-body);
  font-weight: 700;
  color: var(--c-ink);
  font-variant-numeric: tabular-nums;
}
</style>
