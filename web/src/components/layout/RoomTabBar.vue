<script setup lang="ts">
import { computed } from 'vue';
import { store, enterRoom, openDirectChat, closeSession, type Session } from '@/store';

const emit = defineEmits<{ (e: 'new-room'): void }>();

interface TabItem {
  key: string;
  session: Session;
  name: string;
  isCurrent: boolean;
  live: boolean;
}

const tabs = computed<TabItem[]>(() => {
  return store.openSessions.map((s) => {
    if (s.type === 'room') {
      const roomInList = store.rooms.find((r) => r.config.id === s.id);
      const isCurrent = store.activeSession?.type === 'room' && store.activeSession.id === s.id;
      const name = isCurrent && store.currentRoom ? store.currentRoom.config.name : roomInList?.config.name ?? '新房间';
      const live = isCurrent && store.currentRoom ? store.currentRoom.orchestration !== 'idle' : false;
      return {
        key: `room:${s.id}`,
        session: s,
        name,
        isCurrent,
        live,
      };
    } else {
      const char = store.characters.find((c) => c.id === s.characterId);
      const isCurrent =
        store.activeSession?.type === 'direct' && store.activeSession.characterId === s.characterId;
      const name = char ? char.name : '私聊';
      const live = isCurrent ? store.directStatus !== 'idle' : false;
      return {
        key: `direct:${s.characterId}`,
        session: s,
        name,
        isCurrent,
        live,
      };
    }
  });
});

async function onTabClick(item: TabItem) {
  if (item.session.type === 'room') {
    const rid = item.session.id;
    if (!store.activeSession || store.activeSession.type !== 'room' || store.activeSession.id !== rid) {
      await enterRoom(rid);
    }
  } else {
    const cid = item.session.characterId;
    if (!store.activeSession || store.activeSession.type !== 'direct' || store.activeSession.characterId !== cid) {
      const char = store.characters.find((c) => c.id === cid);
      if (char) await openDirectChat(char);
    }
  }
}

function onCloseClick(e: MouseEvent, s: Session) {
  e.stopPropagation();
  void closeSession(s);
}
</script>

<template>
  <div v-if="tabs.length > 0" class="tab-bar">
    <div class="tabs-scroll">
      <div
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-item"
        :class="{ active: tab.isCurrent }"
        :title="tab.name"
        @click="onTabClick(tab)"
      >
        <span v-if="tab.live" class="tab-live-dot" title="活跃中"></span>
        <span class="tab-title">{{ tab.name }}</span>
        <button
          class="tab-close"
          type="button"
          title="关闭标签页"
          @click="onCloseClick($event, tab.session)"
        >
          ✕
        </button>
      </div>
    </div>

    <button
      class="tab-add"
      type="button"
      title="新建房间"
      @click="emit('new-room')"
    >
      ＋
    </button>
  </div>
</template>

<style scoped>
.tab-bar {
  height: 38px;
  background: var(--bg);
  border-bottom: 1px solid var(--border-soft);
  display: flex;
  align-items: flex-end;
  padding: 0 8px;
  user-select: none;
  flex-shrink: 0;
}

.tabs-scroll {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  max-width: calc(100% - 36px);
  /* 全局滚动条体系(style.css)的豁免项:tab 条横滚有意整条隐藏 */
  scrollbar-width: none; /* Firefox */
}
.tabs-scroll::-webkit-scrollbar {
  display: none; /* Chrome / Safari */
}

.tab-item {
  height: 32px;
  padding: 0 10px 0 12px;
  display: flex;
  align-items: center;
  gap: 7px;
  border-radius: 7px 7px 0 0;
  background: transparent;
  color: var(--muted);
  font-size: 12.5px;
  cursor: pointer;
  position: relative;
  transition: background 0.15s, color 0.15s;
  min-width: 90px;
  max-width: 170px;
  box-sizing: border-box;
}

.tab-item:hover {
  background: rgba(0, 0, 0, 0.04);
  color: var(--text);
}

.tab-item.active {
  background: var(--panel);
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 -1px 2px rgba(0, 0, 0, 0.03);
  border: 1px solid var(--border-soft);
  border-bottom: 1px solid var(--panel);
  margin-bottom: -1px;
}

.tab-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ok);
  flex-shrink: 0;
  animation: pulse 1.8s infinite;
}

@keyframes pulse {
  0% { opacity: 0.6; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.15); }
  100% { opacity: 0.6; transform: scale(0.9); }
}

.tab-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-close {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  color: var(--faint);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.12s;
  padding: 0;
}

.tab-close:hover {
  background: var(--border);
  color: var(--text);
}

.tab-add {
  width: 28px;
  height: 28px;
  margin-left: 4px;
  margin-bottom: 2px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  color: var(--muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}

.tab-add:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text);
}
</style>
