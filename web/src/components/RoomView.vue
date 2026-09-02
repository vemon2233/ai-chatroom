<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store';
import MemberBar from './MemberBar.vue';
import ChatFlow from './ChatFlow.vue';
import Composer from './Composer.vue';
import SettingsPanel from './SettingsPanel.vue';

const showSettings = ref(false);

const room = computed(() => store.currentRoom!);

const permName = computed(() =>
  ({ readonly: '只读', readwrite: '读写', full: '完全' } as Record<string, string>)[room.value.config.toolPermission] ?? '只读',
);
const projName = computed(() =>
  room.value.config.projectPath ? room.value.config.projectPath.split(/[\\/]/).pop() : '',
);
const orchName = computed(() =>
  ({ idle: '待命', baton: '自由讨论', roundrobin: '轮流发言' } as Record<string, string>)[room.value.orchestration] ?? '',
);
</script>

<template>
  <div class="room-view">
    <header class="topbar">
      <div class="title-wrap">
        <span class="title">{{ room.config.name }}</span>
        <span class="topic">{{ (projName ? `📁 ${projName}(${permName}) · ` : '') + room.config.topic }}</span>
      </div>
      <div class="topbar-right">
        <span class="orch-tag" :class="room.orchestration">{{ orchName }}</span>
        <button class="btn btn-ghost" @click="showSettings = true">⚙ 设置</button>
      </div>
    </header>

    <MemberBar />
    <ChatFlow />
    <Composer />

    <SettingsPanel v-model="showSettings" />
  </div>
</template>

<style scoped>
.room-view { flex: 1; display: flex; flex-direction: column; min-height: 0; position: relative; }

.topbar {
  background: var(--panel);
  border-bottom: 1px solid var(--border-soft);
  padding: 11px 18px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.title-wrap { flex: 1; display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.title { font-size: 15.5px; font-weight: 650; flex-shrink: 0; }
.topic {
  font-size: 12.5px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topbar-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.orch-tag {
  font-size: 11.5px;
  padding: 3px 10px;
  border-radius: 20px;
  font-weight: 500;
  background: var(--border-soft);
  color: var(--muted);
}
.orch-tag.baton { background: #e8f5ee; color: var(--ok); }
.orch-tag.roundrobin { background: #fdf3e3; color: var(--warn); }
</style>
