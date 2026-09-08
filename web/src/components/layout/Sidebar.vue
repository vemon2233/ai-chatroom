<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { store, refreshRooms, refreshCharacters, openRoom, closeRoom, closeSession, openDirectChat, openInspector } from '@/store';
import { api, type RoomListItem } from '@/services/api';
import { dialog } from '@/composables/useDialog';
import { downloadFile } from '@/utils/download';
import { currentLang, setLang } from '@/i18n';
import NewRoomModal from '@/components/modals/NewRoomModal.vue';
import CharacterModal from '@/components/modals/CharacterModal.vue';
import SidebarCard from '@/components/ui/SidebarCard.vue';
import logoUrl from '@/assets/icon.png';

const { t } = useI18n();
const lang = computed(() => currentLang());

const emit = defineEmits<{ (e: 'enter-room', id: string): void }>();

const showNewRoom = ref(false);
const showCharModal = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

function switchTab(tab: 'rooms' | 'chars') {
  store.sidebarTab = tab;
}

function onExportRoom(r: RoomListItem) {
  downloadFile(api.exportRoomUrl(r.config.id), `${r.config.name}.json`);
}

function triggerImport() {
  fileInputRef.value?.click();
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) return;

  let importedChars = 0;
  let lastRoomId: string | null = null;
  let lastCharId: string | null = null;

  for (const file of files) {
    try {
      const res = await api.smartImport(file);
      if (res.type === 'character') {
        importedChars++;
        lastCharId = res.id;
      } else if (res.type === 'room') {
        lastRoomId = res.id;
      }
    } catch (err: any) {
      void dialog.alert(t('sidebar.importFailedTitle'), t('sidebar.importFailedBody', { file: file.name, reason: err?.message || String(err) }));
    }
  }

  if (lastRoomId) {
    await refreshRooms();
    store.sidebarTab = 'rooms';
    await openRoom(lastRoomId);
  }
  if (importedChars > 0) {
    await refreshCharacters();
    if (!lastRoomId) {
      store.sidebarTab = 'chars';
      if (lastCharId) {
        const char = store.characters.find((c) => c.id === lastCharId);
        if (char) openDirectChat(char);
      }
    }
  }

  input.value = '';
}

function onExportCharacter(c: import('@server/core/types').Character) {
  downloadFile(api.exportCharacterUrl(c.id), `${c.name}.json`);
}

async function onDeleteRoom(id: string, name: string) {
  const ok = await dialog.confirm(
    t('sidebar.deleteRoomTitle'),
    t('sidebar.deleteRoomBody', { name }),
    { danger: true, confirmText: t('sidebar.delete') },
  );
  if (!ok) return;
  await api.deleteRoom(id);
  await closeRoom(id);
  await refreshRooms();
}

async function onDeleteCharacter(id: string, name: string) {
  const ok = await dialog.confirm(
    t('sidebar.deleteCharTitle'),
    t('sidebar.deleteCharBody', { name }),
    { danger: true, confirmText: t('sidebar.delete') },
  );
  if (!ok) return;
  await closeSession({ type: 'direct', characterId: id });
  await api.deleteCharacter(id);
  await refreshCharacters();
}

/** 房间卡片摘要:主题/讨论题目 */
function roomSub(room: RoomListItem): string {
  return room.config.topic;
}

// ---------- 拖拽调节侧边栏宽度逻辑 ----------
const SIDEBAR_WIDTH_KEY = 'ai-chatroom:sidebar-width';
const DEFAULT_SIDEBAR_WIDTH = 250;
const MIN_SIDEBAR_WIDTH = 200;

function getInitialSidebarWidth(): number {
  try {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!Number.isNaN(parsed) && parsed >= MIN_SIDEBAR_WIDTH) {
        return Math.min(parsed, 480);
      }
    }
  } catch {}
  return DEFAULT_SIDEBAR_WIDTH;
}

const sidebarWidth = ref<number>(getInitialSidebarWidth());
const isDragging = ref(false);
let startX = 0;
let startWidth = 0;

function onMouseDown(e: MouseEvent) {
  isDragging.value = true;
  startX = e.clientX;
  startWidth = sidebarWidth.value;

  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'col-resize';

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;
  const delta = e.clientX - startX;
  const maxAllowed = Math.min(480, Math.round(window.innerWidth * 0.4));
  const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxAllowed, startWidth + delta));
  sidebarWidth.value = newWidth;
}

function onMouseUp() {
  if (!isDragging.value) return;
  isDragging.value = false;
  document.body.style.userSelect = '';
  document.body.style.cursor = '';

  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);

  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.value.toString());
  } catch {}
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
});
</script>

<template>
  <aside
    class="sidebar"
    :style="{ width: `${sidebarWidth}px` }"
    :class="{ 'is-dragging': isDragging }"
  >
    <!-- 顶部品牌区:logo + 项目名 + 语言切换 -->
    <header class="brand">
      <img class="brand-mark" :src="logoUrl" alt="AI Chatroom logo" />
      <span class="brand-name">{{ t('app.title') }}</span>
      <div class="lang-switch" :title="lang === 'zh' ? 'Switch to English' : '切换为中文'">
        <button type="button" class="lang-btn" :class="{ active: lang === 'zh' }" @click="setLang('zh')">{{ t('sidebar.langZh') }}</button>
        <button type="button" class="lang-btn" :class="{ active: lang === 'en' }" @click="setLang('en')">{{ t('sidebar.langEn') }}</button>
      </div>
    </header>

    <header class="tabs">
      <button class="tab" :class="{ active: store.sidebarTab === 'rooms' }" @click="switchTab('rooms')">{{ t('sidebar.rooms') }}</button>
      <button class="tab" :class="{ active: store.sidebarTab === 'chars' }" @click="switchTab('chars')">{{ t('sidebar.chars') }}</button>
    </header>

    <div v-show="store.sidebarTab === 'rooms'" class="panel">
      <div class="actions">
        <button class="new-btn" @click="showNewRoom = true">{{ t('sidebar.newRoom') }}</button>
        <button class="import-btn" @click="triggerImport">{{ t('sidebar.import') }}</button>
      </div>
      <div class="list">
        <SidebarCard v-for="r in store.rooms" :key="r.config.id" :title="r.config.name" :badge="`${r.config.members.length}${t('sidebar.memberUnit')}`"
          :sub="roomSub(r)" :color="r.config.color" :active="store.activeSession?.type === 'room' && store.activeSession.id === r.config.id"
          :can-export="true" :export-title="t('sidebar.exportCfg')" @click="openRoom(r.config.id)" @export="onExportRoom(r)"
          @remove="onDeleteRoom(r.config.id, r.config.name)" />
        <div v-if="store.rooms.length === 0" class="list-empty">{{ t('sidebar.noRooms') }}</div>
      </div>
    </div>

    <div v-show="store.sidebarTab === 'chars'" class="panel">
      <div class="actions">
        <button class="new-btn" @click="showCharModal = true">{{ t('sidebar.newChar') }}</button>
        <button class="import-btn" @click="triggerImport">{{ t('sidebar.import') }}</button>
      </div>
      <div class="list">
        <SidebarCard v-for="c in store.characters" :key="c.id" :title="c.name" :badge="c.adapter" :sub="c.persona"
          :color="c.color" :can-export="true" :export-title="t('sidebar.exportChar')" :active="store.activeSession?.type === 'direct' && store.activeSession.characterId === c.id"
          @click="openDirectChat(c)" @export="onExportCharacter(c)" @remove="onDeleteCharacter(c.id, c.name)" />
        <div v-if="store.characters.length === 0" class="list-empty">{{ t('sidebar.noChars') }}</div>
      </div>
    </div>

    <NewRoomModal v-model="showNewRoom" />
    <CharacterModal v-model="showCharModal" />

    <!-- 隐藏的通用文件导入 input (自动嗅探角色卡或房间配置) -->
    <input ref="fileInputRef" type="file" accept=".json,image/png" multiple style="display: none" @change="onFileChange" />

    <!-- 右侧可拖拽分割线 -->
    <div
      class="sidebar-resizer"
      :title="t('sidebar.resizeHint')"
      @mousedown.prevent="onMouseDown"
    >
      <div class="resizer-line"></div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  min-width: 200px;
  max-width: 480px;
  flex-shrink: 0;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border-soft);
  color: var(--sidebar-text);
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 语言切换(品牌区右缘) */
.lang-switch {
  margin-left: auto;
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.lang-btn {
  border: none;
  background: transparent;
  color: var(--sidebar-text);
  font-size: 11px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  opacity: 0.65;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.lang-btn:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.08);
}

.lang-btn.active {
  opacity: 1;
  background: var(--accent);
  color: #fff;
}

/* 拖拽把手与分割线高光 */
.sidebar-resizer {
  position: absolute;
  right: -3px;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
}

.sidebar-resizer .resizer-line {
  width: 2px;
  height: 100%;
  background: transparent;
  transition: background 0.15s ease;
}

.sidebar-resizer:hover .resizer-line,
.sidebar.is-dragging .resizer-line {
  background: var(--accent);
}

.sidebar-resizer:hover,
.sidebar.is-dragging .sidebar-resizer {
  background: var(--accent-soft);
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

.tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

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

.new-btn:hover {
  opacity: 0.88;
}

.import-btn {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
}

.import-btn:hover {
  background: var(--panel-softer);
  border-color: var(--accent);
}

.list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}

.list-empty {
  color: var(--faint);
  font-size: 12px;
  text-align: center;
  padding: 24px 0;
}
</style>
