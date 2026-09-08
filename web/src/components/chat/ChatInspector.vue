<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import InspectorSummary from './inspector/InspectorSummary.vue';
import InspectorLogs from './inspector/InspectorLogs.vue';
import InspectorStats from './inspector/InspectorStats.vue';
import InspectorRoomManage from './inspector/InspectorRoomManage.vue';
import InspectorDirectManage from './inspector/InspectorDirectManage.vue';

const props = defineProps<{
  activeTab: 'summary' | 'stats' | 'logs' | 'manage';
  sessionType: 'room' | 'direct';
  sessionId: string;
}>();

const emit = defineEmits<{
  (e: 'update:activeTab', tab: 'summary' | 'stats' | 'logs' | 'manage'): void;
  (e: 'close'): void;
}>();

// ---------- 左右拖拽面板宽度逻辑 ----------
const STORAGE_KEY = 'ai-chatroom:inspector-width';
const DEFAULT_WIDTH = 480;
const MIN_WIDTH = 340;

function getInitialWidth(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!Number.isNaN(parsed) && parsed >= MIN_WIDTH) {
        return Math.min(parsed, Math.round(window.innerWidth * 0.7));
      }
    }
  } catch {}
  return DEFAULT_WIDTH;
}

const inspectorWidth = ref<number>(getInitialWidth());
const isDragging = ref(false);
let startX = 0;
let startWidth = 0;

function onMouseDown(e: MouseEvent) {
  isDragging.value = true;
  startX = e.clientX;
  startWidth = inspectorWidth.value;

  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'col-resize';

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;
  const delta = startX - e.clientX;
  const maxAllowed = Math.round(window.innerWidth * 0.7);
  const newWidth = Math.max(MIN_WIDTH, Math.min(maxAllowed, startWidth + delta));
  inspectorWidth.value = newWidth;
}

function onMouseUp() {
  if (!isDragging.value) return;
  isDragging.value = false;
  document.body.style.userSelect = '';
  document.body.style.cursor = '';

  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);

  try {
    localStorage.setItem(STORAGE_KEY, inspectorWidth.value.toString());
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
    class="chat-inspector"
    :style="{ width: `${inspectorWidth}px` }"
    :class="{ 'is-dragging': isDragging }"
  >
    <!-- 左侧可拖拽分割线 -->
    <div class="inspector-resizer" title="按住左右拖动调节面板宽度" @mousedown.prevent="onMouseDown">
      <div class="resizer-line"></div>
    </div>

    <!-- Tab 1: 讨论摘要视图 -->
    <InspectorSummary
      v-if="activeTab === 'summary'"
      :session-type="sessionType"
      :session-id="sessionId"
    />

    <!-- Tab 2: 调用日志视图 -->
    <InspectorLogs
      v-else-if="activeTab === 'logs'"
      :session-type="sessionType"
      :session-id="sessionId"
    />

    <!-- Tab 3: 数据度量统计视图 -->
    <InspectorStats
      v-else-if="activeTab === 'stats'"
      :session-type="sessionType"
      :session-id="sessionId"
    />

    <!-- Tab 4: 房间管理 / 角色管理视图 -->
    <div v-else-if="activeTab === 'manage'" class="tab-content manage-tab-view">
      <InspectorRoomManage v-if="sessionType === 'room'" />
      <InspectorDirectManage v-else />
    </div>
  </aside>
</template>

<style scoped>
.chat-inspector {
  min-width: 320px;
  max-width: 70vw;
  height: 100%;
  background: var(--panel);
  border-left: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  z-index: 10;
  flex-shrink: 0;
}

.manage-tab-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 拖拽把手与分割线高光 */
.inspector-resizer {
  position: absolute;
  left: 0;
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

.resizer-line {
  width: 2px;
  height: 100%;
  background: transparent;
  transition: background 0.15s ease;
}

.inspector-resizer:hover .resizer-line,
.chat-inspector.is-dragging .resizer-line {
  background: var(--accent);
}

.inspector-resizer:hover,
.chat-inspector.is-dragging .inspector-resizer {
  background: var(--accent-soft);
}

.tab-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
