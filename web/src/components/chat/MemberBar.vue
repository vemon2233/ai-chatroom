<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '@/store';
import { api } from '@/services/api';
import { dialog } from '@/composables/useDialog';
import { initialsFor } from '@/utils/avatar';
import AddMemberPanel from '@/components/modals/AddMemberPanel.vue';

const showAdd = ref(false);
const room = computed(() => store.currentRoom!);

const STATUS_LABEL: Record<string, string> = {
  idle: '待命',
  thinking: '思考中',
  streaming: '输出中',
  error: '出错',
};

async function onChipClick(memberId: string) {
  const member = room.value.config.members.find((m) => m.id === memberId);
  if (!member) return;
  const text = await dialog.prompt(
    `给 ${member.name} 下指令`,
    '这条指令只有 TA 会看到(注入 TA 下一次发言的 prompt):',
  );
  if (text?.trim()) {
    await api.instruct(room.value.config.id, memberId, text.trim());
  }
}

async function onRemove(memberId: string, name: string) {
  const ok = await dialog.confirm('移出房间', `确定让 ${name} 退出房间?`, {
    danger: true,
    confirmText: '移出',
  });
  if (!ok) return;
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
      <span class="chip-avatar" :style="{ background: m.color }">{{ initialsFor(m.name) }}</span>
      <span class="chip-name">{{ m.name }}</span>
      <span class="chip-adapter">{{ m.adapter }} · {{ STATUS_LABEL[room.statuses[m.id] ?? 'idle'] }}</span>
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
  gap: 7px;
  padding: 4px 11px 4px 8px;
  border: 1px solid var(--border);
  border-radius: 18px;
  font-size: 12px;
  cursor: pointer;
  background: var(--panel);
  white-space: nowrap;
  transition: border-color 0.15s;
}
.chip:hover { border-color: var(--accent); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--faint); flex-shrink: 0; }
.dot.thinking { background: var(--warn); animation: pulse 1s infinite; }
.dot.streaming { background: var(--ok); animation: pulse 0.6s infinite; }
.dot.error { background: var(--danger); }

/* initials 迷你圆:颜色由头像承担,名字回到墨色 */
.chip-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 9.5px;
  font-weight: 600;
  flex-shrink: 0;
}
.chip-name { font-weight: 600; color: var(--text); }
.chip-adapter { color: var(--muted); font-size: 11px; }
.chip-remove { color: var(--muted); font-size: 11px; padding: 0 2px; }
.chip-remove:hover { color: var(--danger); }
.chip.add {
  border-style: dashed;
  color: var(--accent);
  background: var(--accent-soft);
}
.chip.add:hover { border-color: var(--accent); }
@keyframes pulse { 50% { opacity: 0.3; } }
</style>
