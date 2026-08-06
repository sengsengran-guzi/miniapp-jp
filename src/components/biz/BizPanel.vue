<script setup lang="ts">
/**
 * BizPanel — C 套分镜框（纸底 + 粗墨边 + 硬投影）。C 设计的核心承载容器。
 *
 * <p>组合用法：</p>
 * <pre>
 * &lt;BizPanel&gt;普通分镜&lt;/BizPanel&gt;
 * &lt;BizPanel dark&gt;黑底报头&lt;/BizPanel&gt;
 * &lt;BizPanel tint="pink" flat&gt;商品占位彩纸底&lt;/BizPanel&gt;
 * &lt;BizPanel accent dashed&gt;带红点角标 + 虚线边&lt;/BizPanel&gt;
 * &lt;BizPanel @tap="go"&gt;可点击（@tap 透传到根 view）&lt;/BizPanel&gt;
 * </pre>
 *
 * <p>设计系统：doc/tokens.md / src/style/c-tokens.scss(.c-panel)</p>
 */
defineOptions({ name: 'BizPanel' })

withDefaults(defineProps<Props>(), {
  dark: false,
  dashed: false,
  accent: false,
  flat: false,
  small: false,
  pad: false,
})
interface Props {
  /** 黑底报头风（墨底白字） */
  dark?: boolean
  /** 虚线描边 */
  dashed?: boolean
  /** 右上角红点角标 */
  accent?: boolean
  /** 去掉硬投影 */
  flat?: boolean
  /** 细描边 + 小投影（小卡片用） */
  small?: boolean
  /** 卡内统一内边距（清爽版卡片留白；不传则由页面自管） */
  pad?: boolean
  /** 彩纸底（商品/角色占位区）：pink/red/blue/yellow/green */
  tint?: 'pink' | 'red' | 'blue' | 'yellow' | 'green'
}
</script>

<template>
  <view
    class="biz-panel"
    :class="[
      { 'is-dark': dark, 'is-dashed': dashed, 'is-accent': accent, 'is-flat': flat, 'is-small': small, 'is-pad': pad },
      tint ? `tint-${tint}` : '',
    ]"
  >
    <slot />
  </view>
</template>

<style lang="scss" scoped>
.biz-panel {
  position: relative;
  /* 防御性撑满：mp 自定义组件 host 默认不撑满父宽，子件 width:100% 会解析到内容宽。
     BizPanel 作为卡片承载容器，列表/列布局里恒等宽（列表卡宽度一致）。 */
  width: 100%;
  box-sizing: border-box;
  background: var(--c-surface);
  border-radius: var(--c-radius-card);
  box-shadow: var(--c-shadow);
}
.is-small {
  border-radius: var(--c-radius);
  box-shadow: var(--c-shadow-sm);
}
.is-dashed {
  box-shadow: none;
  border: var(--c-bw-3) dashed var(--c-line);
}
.is-flat {
  box-shadow: none;
}
.is-pad {
  padding: var(--c-gap-card);
}
.is-dark {
  background: var(--c-ink);
  color: var(--c-on-dark);
}
.tint-pink {
  background: var(--c-tint-pink);
}
.tint-red {
  background: var(--c-tint-red);
}
.tint-blue {
  background: var(--c-tint-blue);
}
.tint-yellow {
  background: var(--c-tint-yellow);
}
.tint-green {
  background: var(--c-tint-green);
}

/* 清爽改版：取消漫画右上角红点角标（accent 属性保留兼容，但不渲染装饰）。 */
.is-accent::after {
  content: none;
}
</style>
