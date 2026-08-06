<script setup lang="ts">
/**
 * MeGrid — 会员中心功能区九宫格（GZ-USER-001 AC 3）。
 *
 * <p>传入 items 数组渲染入口格；点击 emit('tap', item)。客服入口（type='contact'）特殊：
 * 用原生 &lt;button open-type="contact"&gt; 包裹（微信客服会话），不走 emit。</p>
 *
 * <p>组件库无关纪律（CLAUDE.md §7.5）：内部仅用 view / text / button 原语。</p>
 *
 * <p>设计系统：doc/tokens.md / c-tokens.scss。关联文档：doc/10 §4.N8/N9 / GZ-USER-001 AC 3</p>
 */

export interface MeGridItem {
  /** 入口唯一 key */
  key: string
  /** 图标（emoji 占位；上线替换为 iconify / 本地 SVG — doc/tokens.md §8.6） */
  icon: string
  /** 入口名 */
  label: string
  /** 入口类型：nav=普通跳转 / contact=微信客服 open-type */
  type?: 'nav' | 'contact'
  /** 禁用（灰色不可点） */
  disabled?: boolean
}

interface Props {
  items: MeGridItem[]
}

defineProps<Props>()
const emit = defineEmits<{ tap: [item: MeGridItem] }>()

function onTap(item: MeGridItem) {
  if (item.disabled || item.type === 'contact') {
    return
  }
  emit('tap', item)
}
</script>

<template>
  <BizPanel class="me-grid">
    <view class="me-grid__inner">
      <template v-for="item in items" :key="item.key">
        <!-- 客服入口：原生 button open-type="contact"（微信会话，不接第三方） -->
        <button
          v-if="item.type === 'contact'"
          class="me-grid__cell me-grid__cell--btn"
          open-type="contact"
        >
          <text class="me-grid__icon">{{ item.icon }}</text>
          <text class="me-grid__label">{{ item.label }}</text>
        </button>
        <!-- 普通跳转入口 -->
        <view
          v-else
          class="me-grid__cell"
          :class="{ 'is-disabled': item.disabled }"
          @tap="onTap(item)"
        >
          <text class="me-grid__icon">{{ item.icon }}</text>
          <text class="me-grid__label">{{ item.label }}</text>
        </view>
      </template>
    </view>
  </BizPanel>
</template>

<style lang="scss" scoped>
.me-grid__inner {
  /* 卡内留白（Kevin 走查）：左右 24rpx 图标不贴卡边；顶部 52rpx 加大首行更透气。
     ⚠️ 必须放在组件自己 scope 内的 __inner 真实节点上，不能放 .me-grid（外部类加在
     BizPanel host，virtualHost 合并时 MeGrid scope data-v 不转移 → 选择器失配被丢，实测 padding=0）。 */
  padding: 52rpx 24rpx 28rpx;
  display: grid;
  /* minmax(0,1fr) 防内容 min-content 撑破列导致第 3 列溢出（1fr 默认 minmax(auto,1fr)，Kevin 走查 #4） */
  grid-template-columns: repeat(3, minmax(0, 1fr));
  column-gap: 8rpx;
  row-gap: 32rpx;
}
.me-grid__cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  min-width: 0;

  &.is-disabled {
    opacity: 0.4;
  }
}
/* 客服 button 去掉微信原生样式 */
.me-grid__cell--btn {
  padding: 0;
  margin: 0;
  background: transparent;
  line-height: 1.2;
  border: none;

  &::after {
    border: none;
  }
}
.me-grid__icon {
  font-size: 52rpx;
  line-height: 1.1;
}
.me-grid__label {
  font-size: var(--c-fs-sm);
  font-weight: 500;
  color: var(--c-ink-2);
}
</style>
