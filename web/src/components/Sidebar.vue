<script setup lang="ts">
import { ref } from 'vue';
import { store, refreshRooms, refreshCharacters } from '../store';
import { api } from '../api';
import { dialog } from '../composables/useDialog';
import NewRoomModal from './NewRoomModal.vue';
import CharacterModal from './CharacterModal.vue';
import SidebarCard from './ui/SidebarCard.vue';

const emit = defineEmits<{ (e: 'enter-room', id: string): void }>();

const showNewRoom = ref(false);
const showCharModal = ref(false); // "新角色"按钮用;编辑走 openEdit(内部置位)
const charModalRef = ref<InstanceType<typeof CharacterModal> | null>(null);

function switchTab(tab: 'rooms' | 'chars') {
  store.sidebarTab = tab;
}

function editCharacter(c: import('@server/core/types').Character) {
  charModalRef.value?.openEdit(c);
}

async function onDeleteRoom(id: string, name: string) {
  const ok = await dialog.confirm(
    '删除房间',
    `删除房间「${name}」?聊天历史文件将保留(重启后不再复活)。`,
    { danger: true, confirmText: '删除' },
  );
  if (!ok) return;
  await api.deleteRoom(id);
  if (store.currentRoom?.config.id === id) store.currentRoom = null;
  await refreshRooms();
}

async function onDeleteCharacter(id: string, name: string) {
  const ok = await dialog.confirm(
    '删除角色',
    `删除角色「${name}」?已拉进房间的成员不受影响。`,
    { danger: true, confirmText: '删除' },
  );
  if (!ok) return;
  await api.deleteCharacter(id);
  await refreshCharacters();
}

/** 房间卡片摘要:最近消息预览,缺省回退主题 */
function roomSub(room: import('../api').RoomListItem): string {
  return room.lastMessage ? `${room.lastMessage.fromName}: ${room.lastMessage.text}` : room.config.topic;
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
        <SidebarCard
          v-for="room in store.rooms"
          :key="room.config.id"
          :icon="room.config.emoji || '💬'"
          :title="room.config.name"
          :badge="`${room.config.members.length}人`"
          :sub="roomSub(room)"
          :active="store.currentRoom?.config.id === room.config.id"
          @click="emit('enter-room', room.config.id)"
          @remove="onDeleteRoom(room.config.id, room.config.name)"
        />
        <div v-if="store.rooms.length === 0" class="list-empty">还没有房间</div>
      </div>
    </div>

    <div v-show="store.sidebarTab === 'chars'" class="panel">
      <div class="actions">
        <button class="new-btn" @click="showCharModal = true">＋ 新角色</button>
      </div>
      <div class="list">
        <SidebarCard
          v-for="c in store.characters"
          :key="c.id"
          :icon="c.emoji || '🙂'"
          :title="c.name"
          :badge="c.adapter"
          :sub="c.persona"
          @click="editCharacter(c)"
          @remove="onDeleteCharacter(c.id, c.name)"
        />
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
</style>
