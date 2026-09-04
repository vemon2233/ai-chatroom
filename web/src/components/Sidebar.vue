<script setup lang="ts">
import { computed, ref } from 'vue';
import { store, refreshRooms, refreshCharacters, openRoom, closeRoom } from '../store';
import { api } from '../api';
import { dialog } from '../composables/useDialog';
import NewRoomModal from './NewRoomModal.vue';
import CharacterModal from './CharacterModal.vue';
import SettingsPanel from './SettingsPanel.vue';
import SidebarCard from './ui/SidebarCard.vue';
import logoUrl from '../assets/icon.png';

const emit = defineEmits<{ (e: 'enter-room', id: string): void }>();

const showNewRoom = ref(false);
const showCharModal = ref(false); // "新角色"按钮用;编辑走 openEdit(内部置位)
const charModalRef = ref<InstanceType<typeof CharacterModal> | null>(null);
const roomSettingsRef = ref<InstanceType<typeof SettingsPanel> | null>(null);

/** 仅保留群聊探讨房间，私聊房间收敛至角色 Tab */
const groupRooms = computed(() =>
  store.rooms.filter(
    (r) => !r.config.dmCharacterId && !(r.config.members.length === 1 && !!r.config.members[0]?.characterId),
  ),
);

function switchTab(tab: 'rooms' | 'chars') {
  store.sidebarTab = tab;
}

function editRoom(room: import('../api').RoomListItem) {
  roomSettingsRef.value?.openEdit(room.config);
}

function editCharacter(c: import('@server/core/types').Character) {
  charModalRef.value?.openEdit(c);
}

function onImportRoom() {
  // 导入房间 UI 占位
}

function onImportCharacter() {
  // 导入角色 UI 占位
}

/** 点击角色进入专属 1v1 私聊房间 */
async function openDirectChat(c: import('@server/core/types').Character) {
  let dmRoom = store.rooms.find(
    (r) => r.config.dmCharacterId === c.id || (r.config.members.length === 1 && r.config.members[0]?.characterId === c.id),
  );
  if (!dmRoom) {
    const res = await api.createRoom({
      name: c.name,
      color: c.color,
      topic: c.persona,
      speechLength: 'normal',
      toolPermission: 'readonly',
      dmCharacterId: c.id,
      members: [
        {
          name: c.name,
          adapter: c.adapter,
          persona: c.persona,
          color: c.color,
          characterId: c.id,
        },
      ],
    });
    await refreshRooms();
    await openRoom(res.id);
  } else {
    await openRoom(dmRoom.config.id);
  }
}

async function onDeleteRoom(id: string, name: string) {
  const ok = await dialog.confirm(
    '删除房间',
    `删除房间「${name}」?聊天历史文件将保留(重启后不再复活)。`,
    { danger: true, confirmText: '删除' },
  );
  if (!ok) return;
  await api.deleteRoom(id);
  await closeRoom(id);
  await refreshRooms();
}

async function onDeleteCharacter(id: string, name: string) {
  const ok = await dialog.confirm(
    '删除角色',
    `删除角色「${name}」?已拉进房间的成员不受影响。`,
    { danger: true, confirmText: '删除' },
  );
  if (!ok) return;
  // 若有该角色的 1v1 私聊房间，一同清理
  const dmRoom = store.rooms.find((r) => r.config.dmCharacterId === id);
  if (dmRoom) {
    await api.deleteRoom(dmRoom.config.id);
    await closeRoom(dmRoom.config.id);
  }
  await api.deleteCharacter(id);
  await refreshCharacters();
  await refreshRooms();
}

/** 房间卡片摘要:主题/讨论题目 */
function roomSub(room: import('../api').RoomListItem): string {
  return room.config.topic;
}
</script>

<template>
  <aside class="sidebar">
    <!-- 顶部品牌区:logo + 项目名 -->
    <header class="brand">
      <img class="brand-mark" :src="logoUrl" alt="AI 聊天室 logo" />
      <span class="brand-name">AI 聊天室</span>
    </header>

    <header class="tabs">
      <button class="tab" :class="{ active: store.sidebarTab === 'rooms' }" @click="switchTab('rooms')">房间</button>
      <button class="tab" :class="{ active: store.sidebarTab === 'chars' }" @click="switchTab('chars')">角色</button>
    </header>

    <div v-show="store.sidebarTab === 'rooms'" class="panel">
      <div class="actions">
        <button class="new-btn" @click="showNewRoom = true">＋ 新房间</button>
        <button class="import-btn" @click="onImportRoom">导入</button>
      </div>
      <div class="list">
        <SidebarCard
          v-for="room in groupRooms"
          :key="room.config.id"
          :title="room.config.name"
          :badge="`${room.config.members.length}人`"
          :sub="roomSub(room)"
          :color="room.config.color"
          :can-edit="true"
          edit-title="编辑房间"
          :active="store.currentRoom?.config.id === room.config.id"
          @click="emit('enter-room', room.config.id)"
          @edit="editRoom(room)"
          @remove="onDeleteRoom(room.config.id, room.config.name)"
        />
        <div v-if="groupRooms.length === 0" class="list-empty">还没有房间</div>
      </div>
    </div>

    <div v-show="store.sidebarTab === 'chars'" class="panel">
      <div class="actions">
        <button class="new-btn" @click="showCharModal = true">＋ 新角色</button>
        <button class="import-btn" @click="onImportCharacter">导入</button>
      </div>
      <div class="list">
        <SidebarCard
          v-for="c in store.characters"
          :key="c.id"
          :title="c.name"
          :badge="c.adapter"
          :sub="c.persona"
          :color="c.color"
          :can-edit="true"
          edit-title="编辑角色"
          :active="store.currentRoom?.config.dmCharacterId === c.id"
          @click="openDirectChat(c)"
          @edit="editCharacter(c)"
          @remove="onDeleteCharacter(c.id, c.name)"
        />
        <div v-if="store.characters.length === 0" class="list-empty">还没有角色</div>
      </div>
    </div>

    <NewRoomModal v-model="showNewRoom" />
    <CharacterModal ref="charModalRef" v-model="showCharModal" />
    <SettingsPanel ref="roomSettingsRef" />
  </aside>
</template>

<style scoped>
.sidebar {
  width: 250px;
  flex-shrink: 0;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border-soft);
  color: var(--sidebar-text);
  display: flex;
  flex-direction: column;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 10px;
}
/* logo:512 PNG(圆形徽标),28px 渲染 */
.brand-mark {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
  display: block;
}
.brand-name {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--text);
}

.tabs {
  display: flex;
  border-bottom: 1px solid var(--border-soft);
}
.tab {
  flex: 1;
  padding: 10px;
  font-size: 13px;
  color: var(--muted);
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}
.tab.active { color: var(--text); border-bottom-color: var(--accent); }

.panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.actions {
  padding: 10px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.new-btn,
.import-btn {
  width: 100%;
  border-radius: 8px;
  padding: 8px 0;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: center;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s, background 0.15s, border-color 0.15s;
}
.new-btn {
  background: var(--accent);
  color: #fff;
  border: 1px solid var(--accent);
}
.new-btn:hover { opacity: 0.88; }
.import-btn {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
}
.import-btn:hover {
  background: var(--panel-softer);
  border-color: var(--accent);
}

.list { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
.list-empty { color: var(--faint); font-size: 12px; text-align: center; padding: 24px 0; }
</style>
