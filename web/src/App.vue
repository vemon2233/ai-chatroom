<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { initStore, store, openRoom } from '@/store';
import Sidebar from '@/components/layout/Sidebar.vue';
import RoomTabBar from '@/components/layout/RoomTabBar.vue';
import RoomView from '@/components/chat/RoomView.vue';
import DirectChatView from '@/components/chat/DirectChatView.vue';
import NewRoomModal from '@/components/modals/NewRoomModal.vue';
import DialogHost from '@/components/ui/DialogHost.vue';

import logoUrl from './assets/icon.png';

const { t } = useI18n();
const showNewRoom = ref(false);

onMounted(() => initStore());
</script>

<template>
  <div class="layout">
    <Sidebar @enter-room="openRoom" />
    <main class="main">
      <RoomTabBar @new-room="showNewRoom = true" />
      <DirectChatView v-if="store.activeSession?.type === 'direct' && store.currentDirectChar" />
      <RoomView v-else-if="store.activeSession?.type === 'room' && store.currentRoom" />
      <div v-else class="empty-wrap">
        <div class="empty-content">
          <img class="empty-logo" :src="logoUrl" :alt="t('ui.logoAlt')" />
          <div class="empty-title">{{ t('ui.appTitle') }}</div>
          <div class="empty-sub">{{ t('ui.appSubtitle') }}</div>
          <button class="empty-action-btn" type="button" @click="showNewRoom = true">
            {{ t('ui.newRoomBtn') }}
          </button>
          <div class="empty-hint">{{ t('ui.emptyHint') }}</div>
        </div>
      </div>
    </main>
    <NewRoomModal v-model="showNewRoom" />
    <DialogHost />
  </div>
</template>

<style scoped>
.layout { display: flex; height: 100%; }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.empty-wrap {
  flex: 1;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--panel-soft);
  padding: 24px;
}
.empty-content {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 440px;
}
.empty-logo {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  margin-bottom: 4px;
  box-shadow: var(--shadow-sm);
  display: block;
}
.empty-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.015em;
}
.empty-sub {
  font-size: 13.5px;
  color: var(--muted);
  line-height: 1.5;
}
.empty-action-btn {
  margin-top: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--accent);
  color: #fff;
  padding: 9px 22px;
  border-radius: 9px;
  font-size: 13.5px;
  font-weight: 600;
  transition: opacity 0.15s, transform 0.1s;
}
.empty-action-btn:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}
.empty-hint {
  font-size: 12px;
  color: var(--faint);
  margin-top: 4px;
}
</style>
