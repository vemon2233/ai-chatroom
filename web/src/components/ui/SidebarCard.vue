<script setup lang="ts">
// SidebarCard 原语:侧栏列表项的唯一卡片实现(房间/角色同构)。
// 结构:图标瓷片(圆角底) + 右两行(名称+徽标 / 摘要);删除按钮 hover 悬浮右侧居中,
// 实底(侧栏同色)保证压住摘要时不产生文字叠字的脏感。
// 样式只存在这一份;业务列表只负责传数据与接事件(对齐 overlay 原语化先例)。

defineProps<{
  /** 头像 emoji */
  icon: string;
  /** 主行名称 */
  title: string;
  /** 右侧徽标(房间=N人;角色=adapter);空则不占位 */
  badge?: string;
  /** 次行摘要(单行截断) */
  sub?: string;
  /** 激活态(当前房间):左侧主题色条 + 提亮底 */
  active?: boolean;
}>();

const emit = defineEmits<{
  (e: 'click'): void;
  (e: 'remove'): void;
}>();
</script>

<template>
  <div class="card" :class="{ active }" @click="emit('click')">
    <div class="card-icon-tile">
      <span class="card-icon">{{ icon }}</span>
    </div>
    <div class="card-main">
      <div class="card-line">
        <span class="card-title">{{ title }}</span>
        <span v-if="badge" class="card-badge">{{ badge }}</span>
      </div>
      <div class="card-sub">{{ sub }}</div>
    </div>
    <button class="card-remove" title="删除" @click.stop="emit('remove')">删除</button>
  </div>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px 7px 8px;
  margin-bottom: 2px;
  border-radius: 9px;
  cursor: pointer;
  border-left: 2px solid transparent; /* 与激活态色条等宽,激活时换色不跳动 */
  transition: background 0.12s;
}
.card:hover { background: rgba(255, 255, 255, 0.06); }
.card.active {
  background: rgba(255, 255, 255, 0.09);
  border-left-color: var(--accent);
}

/* 图标瓷片:emoji 的视觉锚点(裸 emoji 尺寸感不稳,瓷片统一体量) */
.card-icon-tile {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.07);
  display: flex;
  align-items: center;
  justify-content: center;
}
.card.active .card-icon-tile { background: rgba(79, 110, 247, 0.22); }
.card-icon { font-size: 16px; line-height: 1; }

.card-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; padding-right: 52px; /* 删除按钮悬浮位预留 */ }
.card-line { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.card-title {
  font-size: 13px;
  font-weight: 550;
  color: #eceef2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 徽标:纯灰字,无框(描边 pill 在暗底上显重) */
.card-badge {
  font-size: 10.5px;
  color: #767b85;
  flex-shrink: 0;
}
.card-sub {
  font-size: 11px;
  color: #80858f;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 悬浮删除:右侧垂直居中;实底(侧栏同色系)+红字红框,
 * 压住摘要尾部时是"一枚按钮盖在卡上",不会红灰文字叠字 */
.card-remove {
  position: absolute;
  right: 7px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  font-weight: 500;
  color: var(--danger);
  background: #232529;
  border: 1px solid rgba(229, 72, 77, 0.45);
  border-radius: 6px;
  padding: 3.5px 10px;
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.12s;
}
.card:hover .card-remove { visibility: visible; opacity: 1; }
.card-remove:hover { background: var(--danger); color: #fff; }
</style>
