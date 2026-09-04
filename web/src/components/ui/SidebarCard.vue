<script setup lang="ts">
// SidebarCard 原语:侧栏列表项的唯一卡片实现(房间/角色同构)。
// 结构:initials 彩圆(房间灰底取名称首字;角色哈希取色)+ 右两行(名称+徽标 / 摘要);
// 删除按钮 hover 悬浮右侧居中,实底(侧栏同色)保证压住摘要时不产生文字叠字的脏感。
// 样式只存在这一份;业务列表只负责传数据与接事件(对齐 overlay 原语化先例)。

import { computed } from 'vue';
import { initialsFor, colorForName } from '../../lib/avatar';

const props = defineProps<{
  /** 主行名称(initials 取字真源) */
  title: string;
  /** 右侧徽标(房间=N人;角色=adapter);空则不占位 */
  badge?: string;
  /** 次行摘要(单行截断) */
  sub?: string;
  /** 激活态(当前房间):左侧主题色条 + 提亮底 */
  active?: boolean;
  /** 头像自定义背景色(可选，未提供则按名称哈希取多色板) */
  color?: string;
  /** 是否支持编辑按钮 */
  canEdit?: boolean;
  /** 编辑按钮悬浮提示(默认'编辑') */
  editTitle?: string;
}>();

const emit = defineEmits<{
  (e: 'click'): void;
  (e: 'remove'): void;
  (e: 'edit'): void;
}>();

const initials = computed(() => initialsFor(props.title));
const avatarColor = computed(() => props.color ?? colorForName(props.title));
</script>

<template>
  <div class="card" :class="{ active }" @click="emit('click')">
    <div class="card-avatar" :style="{ background: avatarColor }">{{ initials }}</div>
    <div class="card-main">
      <div class="card-line">
        <span class="card-title">{{ title }}</span>
        <span v-if="badge" class="card-badge">{{ badge }}</span>
      </div>
      <div class="card-sub">{{ sub }}</div>
    </div>
    <div class="card-actions">
      <button v-if="canEdit" class="card-btn edit" :title="editTitle || '编辑'" @click.stop="emit('edit')">编辑</button>
      <button class="card-btn remove" title="删除" @click.stop="emit('remove')">删除</button>
    </div>
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
.card:hover { background: var(--panel-softer); }
.card.active {
  background: var(--accent-soft);
  border-left-color: var(--accent);
}

/* initials 彩圆:名称首字/双字母的视觉锚点 */
.card-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}

.card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.card-line { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.card-title {
  font-size: 13px;
  font-weight: 550;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 徽标:纯灰字,无框(描边 pill 在浅底上显重) */
.card-badge {
  font-size: 10.5px;
  color: var(--faint);
  flex-shrink: 0;
}
.card-sub {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 悬浮操作区:右侧垂直居中;实底(白,与卡片同面) */
.card-actions {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 4px;
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.12s;
  z-index: 2;
}
.card:hover .card-actions { visibility: visible; opacity: 1; }

.card-btn {
  font-size: 11px;
  font-weight: 500;
  background: var(--panel);
  border-radius: 5px;
  padding: 3px 7px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.card-btn.edit {
  color: var(--text-muted);
  border: 1px solid var(--border);
}
.card-btn.edit:hover {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent-border);
}
.card-btn.remove {
  color: var(--danger);
  border: 1px solid rgba(229, 72, 77, 0.45);
}
.card-btn.remove:hover {
  background: var(--danger);
  color: #fff;
}
</style>
