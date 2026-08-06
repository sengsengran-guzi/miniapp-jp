<script setup lang="ts">
/**
 * BizScreentone — 网点纸底纹（绝对定位覆盖层）。放在 BizPanel / 彩底区内做漫画网点。
 *
 * <p>父级须 position:relative。本组件 inset:0 + pointer-events:none，不挡点击。</p>
 * <pre>&lt;BizPanel tint="pink"&gt;&lt;BizScreentone density="fine" /&gt;…&lt;/BizPanel&gt;</pre>
 *
 * <p>设计系统：doc/tokens.md / src/style/c-tokens.scss(.c-screentone)</p>
 */
defineOptions({ name: 'BizScreentone' })

withDefaults(defineProps<Props>(), { density: 'mid', light: false, opacity: 0.2 })
interface Props {
  /** 点密度：fine(6) / mid(8,默认) / wide(12) */
  density?: 'fine' | 'mid' | 'wide'
  /** 白点（用于黑底报头上的网点） */
  light?: boolean
  /** 不透明度（默认 0.2） */
  opacity?: number
}
</script>

<template>
  <view
    class="biz-screentone"
    :class="[`density-${density}`, { 'is-light': light }]"
    :style="{ opacity }"
  />
</template>

<style lang="scss" scoped>
/* 清爽改版：网点纸退场。保留组件壳让历史用例不报错，但不渲染任何底纹。 */
.biz-screentone {
  display: none;
}
</style>
