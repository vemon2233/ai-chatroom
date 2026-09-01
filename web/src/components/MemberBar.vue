<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store';
import { api } from '../api';
import AddMemberPanel from './AddMemberPanel.vue';

const showAdd = ref(false);
const room = computed(() => store.currentRoom!);

async function onChipClick(memberId: string) {
  const member = room.value.config.members.find((m) => m.id === memberId);
  if (!member) return;
  const text = prompt(`给 ${member.name} 下指令(仅 TA 可见):`);
  if (text?.trim()) {
    await api.instruct(room.value.config.id, memberId, text.trim());
  }
}

async function onRemove(memberId: string, name: string) {
  if (!confirm(`确定让 ${name} 退出房间?`)) return;
  await api.removeMember(room.value.config.id, memberId);
}
</script>

<template>
  <div class="member-bar">
    <div
      v-for="m in room.config.members"
      :key="m.id"
      class="chip"
      :title="`${m.persona}\n点击下指令 | ✕ 移出房间`"
      @click="onChipClick(m.id)"
    >
      <span class="dot" :class="room.statuses[m.id] ?? 'idle'"></span>
      <span class="chip-emoji">{{ m.emoji || '' }}</span>
      <span class="chip-name" :style="{ color: m.color }">{{ m.name }}</span>
      <span class="chip-adapter">{{ m.adapter }}</span>
      <span class="chip-remove" @click.stop="onRemove(m.id, m.name)">✕</span>
    </div>
    <button class="chip add" @click="showAdd = true">＋ 添加成员</button>

    <AddMemberPanel v-model="showAdd" />
  </div>
</template>

<style scoped>
.member-bar {
  display: flex;
  gap: 8px;
  padding: 9px 16px;
  background: var(--panel);
  border-bottom: 1px solid var(--border-soft);
  overflow-x: auto;
  align-items: center;
}
.chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border: 1px solid var(--border);
  border-radius: 18px;
  font-size: 12px;
  cursor: pointer;
  background: var(--panel);
  white-space: nowrap;
  transition: border-color 0.15s;
}
.chip:hover { border-color: var(--accent); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #c4c8cf; flex-shrink: 0; }
.dot.thinking { background: var(--warn); animation: pulse 1s infinite; }
.dot.streaming { background: var(--ok); animation: pulse 0.6s infinite; }
.dot.error { background: var(--danger); }
.chip-emoji { font-size: 14px; }
.chip-name { font-weight: 600; }
.chip-adapter { color: var(--muted); font-size: 11px; }
.chip-remove { color: var(--muted); font-size: 11px; padding: 0 2px; }
.chip-remove:hover { color: var(--danger); }
.chip.add {
  border-style: dashed;
  color: var(--muted);
  background: none;
}
.chip.add:hover { border-color: var(--accent); color: var(--accent); }
@keyframes pulse { 50% { opacity: 0.3; } }
</style>
