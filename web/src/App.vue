<script setup lang="ts">
import { onMounted } from 'vue';
import { initStore, store, enterRoom } from './store';
import Sidebar from './components/Sidebar.vue';
import RoomView from './components/RoomView.vue';

onMounted(() => initStore());
</script>

<template>
  <div class="layout">
    <Sidebar @enter-room="enterRoom" />
    <main class="main">
      <div v-if="!store.currentRoom" class="empty">
        <div class="empty-icon">💬</div>
        <div class="empty-title">AI 聊天室</div>
        <div class="empty-sub">多个 AI agent 同处一室,聊天 / 探讨 / 辩论</div>
        <div class="empty-hint">点击左侧「+ 新房间」开始</div>
      </div>
      <RoomView v-else />
    </main>
  </div>
</template>

<style scoped>
.layout { display: flex; height: 100%; }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--muted);
}
.empty-icon { font-size: 52px; }
.empty-title { font-size: 20px; font-weight: 700; color: var(--text); }
.empty-sub { font-size: 13px; }
.empty-hint { font-size: 12px; margin-top: 12px; }
</style>
