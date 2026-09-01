<script setup lang="ts">
import { ref } from 'vue';
import { store, refreshRooms } from '../store';
import { api } from '../api';
import NewRoomModal from './NewRoomModal.vue';
import CharacterModal from './CharacterModal.vue';

const emit = defineEmits<{ (e: 'enter-room', id: string): void }>();

const showNewRoom = ref(false);
const showCharModal = ref(false);
const charModalRef = ref<InstanceType<typeof CharacterModal> | null>(null);

function switchTab(tab: 'rooms' | 'chars') {
  store.sidebarTab = tab;
}

function editCharacter(c: import('@server/core/types').Character) {
  charModalRef.value?.openEdit(c);
}

async function onDeleteRoom(id: string) {
  if (!confirm('删除房间?聊天历史文件将保留(重启后不再复活)。')) return;
  await api.deleteRoom(id);
  if (store.currentRoom?.config.id === id) store.currentRoom = null;
  await refreshRooms();
}
</script>

<template>
  <aside class="sidebar">
    <header class="tabs">
      <button class="tab" :class="{ active: store.sidebarTab === 'rooms' }" @click="switchTab('rooms')">房间</button>
      <button class="tab" :class="{ active: store.sidebarTab === 'chars' }" @click="switchTab('chars')">角色</button>
    </header>

    <div v-show="store.sidebarTab === 'rooms'" class="panel">
      <div class="actions">
        <button class="new-btn" @click="showNewRoom = true">＋ 新房间</button>
      </div>
      <div class="list">
        <div
          v-for="room in store.rooms"
          :key="room.config.id"
          class="room-item"
          :class="{ active: store.currentRoom?.config.id === room.config.id }"
          @click="emit('enter-room', room.config.id)"
        >
          <div class="room-line">
            <span class="room-name">{{ room.config.name }}</span>
            <span class="room-count">{{ room.config.members.length }}人</span>
            <button class="room-del" title="删除房间" @click.stop="onDeleteRoom(room.config.id)">✕</button>
          </div>
          <div class="room-last">
            {{ room.lastMessage ? `${room.lastMessage.fromName}: ${room.lastMessage.text}` : room.config.topic }}
          </div>
        </div>
        <div v-if="store.rooms.length === 0" class="list-empty">还没有房间</div>
      </div>
    </div>

    <div v-show="store.sidebarTab === 'chars'" class="panel">
      <div class="actions">
        <button class="new-btn" @click="showCharModal = true">＋ 新角色</button>
      </div>
      <div class="list">
        <div v-for="c in store.characters" :key="c.id" class="char-item" @click="editCharacter(c)">
          <span class="char-emoji">{{ c.emoji || '🙂' }}</span>
          <div class="char-info">
            <span class="char-name">{{ c.name }}</span>
            <span class="char-meta">{{ c.persona.slice(0, 30) }}…</span>
          </div>
        </div>
        <div v-if="store.characters.length === 0" class="list-empty">还没有角色</div>
      </div>
    </div>

    <NewRoomModal v-model="showNewRoom" />
    <CharacterModal ref="charModalRef" v-model="showCharModal" />
  </aside>
</template>

<style scoped>
.sidebar {
  width: 250px;
  flex-shrink: 0;
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  display: flex;
  flex-direction: column;
}
.tabs { display: flex; border-bottom: 1px solid rgba(255, 255, 255, 0.07); }
.tab {
  flex: 1;
  padding: 13px;
  font-size: 13.5px;
  color: #8b8f98;
  border-bottom: 2px solid transparent;
  transition: color 0.15s;
}
.tab.active { color: #fff; border-bottom-color: var(--accent); }

.panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.actions { padding: 10px; }
.new-btn {
  width: 100%;
  background: var(--accent);
  color: #fff;
  border-radius: 8px;
  padding: 8px;
  font-size: 13px;
  font-weight: 500;
}
.new-btn:hover { opacity: 0.9; }

.list { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
.list-empty { color: #6b7078; font-size: 12px; text-align: center; padding: 24px 0; }

.room-item {
  padding: 10px;
  border-radius: 9px;
  cursor: pointer;
  margin-bottom: 3px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.room-item:hover { background: rgba(255, 255, 255, 0.05); }
.room-item.active { background: rgba(255, 255, 255, 0.1); }
.room-line { display: flex; align-items: center; gap: 6px; }
.room-name { font-size: 13.5px; font-weight: 500; color: #e8eaee; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.room-count { font-size: 11px; color: #6b7078; flex-shrink: 0; }
.room-del {
  font-size: 11px; color: #6b7078; flex-shrink: 0; padding: 0 3px;
  visibility: hidden;
}
.room-item:hover .room-del { visibility: visible; }
.room-del:hover { color: var(--danger); }
.room-last {
  font-size: 11.5px;
  color: #8b8f98;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.char-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border-radius: 9px;
  cursor: pointer;
  margin-bottom: 3px;
}
.char-item:hover { background: rgba(255, 255, 255, 0.05); }
.char-emoji { font-size: 19px; }
.char-info { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.char-name { font-size: 13px; font-weight: 500; }
.char-meta { font-size: 11px; color: #8b8f98; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
