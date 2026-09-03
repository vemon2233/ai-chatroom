<script setup lang="ts">
import { onMounted } from 'vue';
import { initStore, store, enterRoom } from './store';
import Sidebar from './components/Sidebar.vue';
import RoomView from './components/RoomView.vue';
import DialogHost from './components/ui/DialogHost.vue';

onMounted(() => initStore());
</script>

<template>
  <div class="layout">
    <Sidebar @enter-room="enterRoom" />
    <main class="main">
      <div v-if="!store.currentRoom" class="empty-wrap">
        <div class="empty-card">
          <div class="empty-title">AI 聊天室</div>
          <div class="empty-sub">多个 AI agent 同处一室,聊天 / 探讨 / 辩论</div>
          <div class="empty-hint">点击左侧「+ 新房间」开始</div>
        </div>
      </div>
      <RoomView v-else />
    </main>
    <DialogHost />
  </div>
</template>

<style scoped>
.layout { display: flex; height: 100%; }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.empty-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.empty-card {
  background: var(--panel);
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
  padding: 44px 56px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.empty-title { font-size: 20px; font-weight: 700; color: var(--text); }
.empty-sub { font-size: 13px; color: var(--muted); }
.empty-hint { font-size: 12px; color: var(--faint); margin-top: 10px; }
</style>
