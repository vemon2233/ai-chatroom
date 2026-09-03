<script setup lang="ts">
// SidebarCard 原语:侧栏列表项的唯一卡片实现(房间/角色同构)。
// 结构:左 icon(emoji) + 右两行(上行 名称+徽标+hover ✕;下行 摘要灰字)。
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
  /** 激活态(当前房间) */
  active?: boolean;
}>();

const emit = defineEmits<{
  (e: 'click'): void;
  (e: 'remove'): void;
}>();
</script>

<template>
  <div class="card" :class="{ active }" @click="emit('click')">
    <span class="card-icon">{{ icon }}</span>
    <div class="card-main">
      <div class="card-line">
        <span class="card-title">{{ title }}</span>
        <span v-if="badge" class="card-badge">{{ badge }}</span>
      </div>
      <div v-if="sub" class="card-sub">{{ sub }}</div>
    </div>
    <!-- 删除:悬浮卡片右侧垂直居中,允许遮挡摘要文字 -->
    <button class="card-remove" title="删除" @click.stop="emit('remove')">✕</button>
  </div>
</template>

<style scoped>
.card {
  position: relative; /* ✕ 悬浮锚点 */
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 14px 9px 10px; /* 右侧给悬浮 ✕ 让位 */
  border-radius: 9px;
  cursor: pointer;
  margin-bottom: 3px;
}
.card:hover { background: rgba(255, 255, 255, 0.05); }
.card.active { background: rgba(255, 255, 255, 0.1); }

.card-icon { font-size: 19px; flex-shrink: 0; line-height: 1; }
.card-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.card-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.card-title {
  font-size: 13px;
  font-weight: 500;
  color: #e8eaee;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-badge {
  font-size: 11px;
  color: #8b8f98;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 0 7px;
  line-height: 17px;
  flex-shrink: 0;
}
/* 悬浮删除:卡片右侧垂直居中,hover 出现;可遮挡摘要(卡片右 padding 已预留,
 * 摘要超长被 ✕ 压住的是尾部省略号部分,信息损失可接受) */
.card-remove {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: #6b7078;
  padding: 6px 7px;
  visibility: hidden;
}
.card:hover .card-remove { visibility: visible; }
.card-remove:hover { color: var(--danger); }
.card-sub {
  font-size: 11px;
  color: #8b8f98;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
