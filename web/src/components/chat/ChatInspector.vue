<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { api } from '@/services/api';
import { store } from '@/store';
import { renderMarkdown } from '@/utils/markdown';
import type { AgentTraceLog, DiscussionSummary, DiscussionSummarySnapshot, SummarySnapshotItem } from '@server/core/types';
import type { TraceSummaryItem } from '@server/store/trace';
import InspectorRoomManage from './inspector/InspectorRoomManage.vue';
import InspectorDirectManage from './inspector/InspectorDirectManage.vue';
import InspectorStats from './inspector/InspectorStats.vue';

const props = defineProps<{
  activeTab: 'summary' | 'stats' | 'logs' | 'manage';
  sessionType: 'room' | 'direct';
  sessionId: string;
}>();

const emit = defineEmits<{
  (e: 'update:activeTab', tab: 'summary' | 'stats' | 'logs' | 'manage'): void;
  (e: 'close'): void;
}>();

// ---------- 讨论摘要历史与详情逻辑 ----------
const summariesList = ref<SummarySnapshotItem[]>([]);
const isLoadingSummaries = ref(false);
const isRefreshingSummary = ref(false);
const summaryError = ref('');
const selectedSummaryId = ref<string | null>(null);
const currentSummaryDetail = ref<DiscussionSummarySnapshot | null>(null);
const isLoadingSummaryDetail = ref(false);
const summarySubTab = ref<'public' | 'private'>('public');
const copySummaryFeedback = ref(false);

const summaryData = computed<DiscussionSummary | null>(() => {
  return currentSummaryDetail.value || store.currentSummary;
});

async function loadSummaries(isAuto: boolean | unknown = false) {
  const isSilent = isAuto === true;
  if (!isSilent) {
    isLoadingSummaries.value = true;
  }
  try {
    const list =
      props.sessionType === 'room'
        ? await api.roomSummaries(props.sessionId)
        : await api.directSummaries(props.sessionId);

    const prevFirstId = summariesList.value[0]?.id;
    const wasTrackingTop = !selectedSummaryId.value || selectedSummaryId.value === prevFirstId;

    summariesList.value = list;

    if (list.length > 0) {
      if (wasTrackingTop) {
        void selectSummary(list[0]!.id);
      } else {
        const stillExists = list.some((item) => item.id === selectedSummaryId.value);
        if (!stillExists) {
          void selectSummary(list[0]!.id);
        }
      }
    } else {
      selectedSummaryId.value = null;
      currentSummaryDetail.value = null;
    }
  } catch (err) {
    console.error('加载讨论摘要文件列表失败:', err);
  } finally {
    if (!isSilent) {
      isLoadingSummaries.value = false;
    }
  }
}

async function selectSummary(summaryId: string) {
  selectedSummaryId.value = summaryId;
  isLoadingSummaryDetail.value = true;
  summaryError.value = '';
  try {
    if (props.sessionType === 'room') {
      currentSummaryDetail.value = await api.roomSummaryDetail(props.sessionId, summaryId);
    } else {
      currentSummaryDetail.value = await api.directSummaryDetail(props.sessionId, summaryId);
    }
  } catch (err) {
    console.error('加载摘要详情失败:', err);
  } finally {
    isLoadingSummaryDetail.value = false;
  }
}

const hasNewMessagesForSummary = computed(() => {
  const msgs = sessionMessages.value;
  if (msgs.length === 0) return false;

  // 有效消息: 排除系统消息，若是房间还排除私聊消息，并要求正文非空
  const validMsgs = props.sessionType === 'room'
    ? msgs.filter((m) => !m.system && (!m.audience || m.audience.length === 0) && !!m.text?.trim())
    : msgs.filter((m) => !m.system && !!m.text?.trim());

  if (validMsgs.length === 0) return false;

  // 检查是否已有历史摘要
  const latestItem = summariesList.value[0];
  const currentSum = summaryData.value;
  const hasExistingSummary = (latestItem && latestItem.messageCount > 0) || !!currentSum?.text;
  if (!hasExistingSummary) {
    // 从未生成过摘要，且当前有发言，允许生成首份
    return true;
  }

  const coveredId = latestItem?.coveredMessageId ?? currentSum?.coveredMessageId;
  // 若无锚点覆盖，比对数量
  if (!coveredId) {
    const coveredCount = latestItem?.messageCount ?? currentSum?.messageCount ?? 0;
    return validMsgs.length > coveredCount;
  }

  // 检查 validMsgs 中是否包含该 coveredId，以及在 coveredId 之后是否有新的有效发言
  const coveredIndex = validMsgs.findIndex((m) => m.id === coveredId);
  if (coveredIndex === -1) {
    // 锚点不在当前有效消息中(例如被截断/清空)，允许全量重新生成
    return true;
  }

  // 只有当有效消息在 coveredIndex 之后还有新发言时，才算有新消息
  return coveredIndex < validMsgs.length - 1;
});

async function handleRefreshSummary() {
  if (isRefreshingSummary.value || !hasNewMessagesForSummary.value) return;
  isRefreshingSummary.value = true;
  summaryError.value = '';
  try {
    let res: DiscussionSummary;
    if (props.sessionType === 'room') {
      res = await api.refreshRoomSummary(props.sessionId);
    } else {
      res = await api.refreshDirectSummary(props.sessionId);
    }
    if (res.status === 'error') {
      summaryError.value = res.error || '生成摘要失败';
    } else {
      store.currentSummary = res;
      await loadSummaries(false);
    }
  } catch (err: any) {
    summaryError.value = err?.message || '生成摘要失败';
  } finally {
    isRefreshingSummary.value = false;
  }
}

async function copySummaryText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copySummaryFeedback.value = true;
    setTimeout(() => {
      copySummaryFeedback.value = false;
    }, 1500);
  } catch { }
}

const hasPrivateDigests = computed(() => {
  const digests = currentSummaryDetail.value?.privateDigests;
  return !!(digests && Object.keys(digests).length > 0);
});

const privateDigestCount = computed(() => {
  const digests = currentSummaryDetail.value?.privateDigests;
  return digests ? Object.keys(digests).length : 0;
});

const privateDigestsMarkdown = computed(() => {
  const digests = currentSummaryDetail.value?.privateDigests;
  if (!digests || Object.keys(digests).length === 0) {
    return '_暂无成员私聊纪要_';
  }
  const lines: string[] = [];
  for (const [memberId, d] of Object.entries(digests)) {
    // 尝试在房间成员里找名字
    const member = props.sessionType === 'room'
      ? store.currentRoom?.config.members.find((m) => m.id === memberId)
      : null;
    const name = member?.name ?? memberId;
    lines.push(`### 【${name}】的私聊纪要\n`);
    lines.push(d.text.trim());
    lines.push('\n---\n');
  }
  return lines.join('\n');
});

function formatSummaryTitle(item: SummarySnapshotItem): string {
  const time = formatTime(item.createdAt);
  const typeStr = item.trigger === 'auto' ? '自动提炼' : '手动刷新';
  return `${time} (${typeStr})`;
}

const formattedSummaryTime = computed(() => {
  if (!summaryData.value?.updatedAt) return '';
  const d = new Date(summaryData.value.updatedAt);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
});

// ---------- 调用日志逻辑 ----------
const tracesList = ref<TraceSummaryItem[]>([]);
const isLoadingTraces = ref(false);
const selectedMessageId = ref<string | null>(null);
const currentTraceDetail = ref<AgentTraceLog | null>(null);
const isLoadingDetail = ref(false);
const detailSubTab = ref<'input' | 'output'>('input');
const copyFeedback = ref<'input' | 'output' | null>(null);

const sessionMessages = computed(() => {
  return props.sessionType === 'room' ? store.messages : store.directMessages;
});

async function loadTraces(isAuto: boolean | unknown = false) {
  const isSilent = isAuto === true;
  if (!isSilent) {
    isLoadingTraces.value = true;
  }
  try {
    const list =
      props.sessionType === 'room'
        ? await api.roomTraces(props.sessionId)
        : await api.directTraces(props.sessionId);

    // 记录刷新前的第一项 ID 与跟踪态
    const prevFirstId = tracesList.value[0]?.messageId;
    const wasTrackingTop = !selectedMessageId.value || selectedMessageId.value === prevFirstId;

    tracesList.value = list;

    if (list.length > 0) {
      if (wasTrackingTop) {
        // 自动聚焦查看最新一次的调用
        void selectTrace(list[0]!.messageId);
      } else {
        const stillExists = list.some((item) => item.messageId === selectedMessageId.value);
        if (!stillExists) {
          void selectTrace(list[0]!.messageId);
        }
      }
    } else {
      selectedMessageId.value = null;
      currentTraceDetail.value = null;
    }
  } catch (err) {
    console.error('加载调用日志列表失败:', err);
  } finally {
    if (!isSilent) {
      isLoadingTraces.value = false;
    }
  }
}

async function selectTrace(messageId: string) {
  selectedMessageId.value = messageId;
  isLoadingDetail.value = true;
  currentTraceDetail.value = null;
  try {
    if (props.sessionType === 'room') {
      currentTraceDetail.value = await api.roomTraceDetail(props.sessionId, messageId);
    } else {
      currentTraceDetail.value = await api.directTraceDetail(props.sessionId, messageId);
    }
  } catch (err) {
    console.error('加载 Trace 详情失败:', err);
  } finally {
    isLoadingDetail.value = false;
  }
}

function formatDuration(ms?: number): string {
  if (!ms) return '0s';
  return (ms / 1000).toFixed(1) + 's';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function formatCliCommand(input?: AgentTraceLog['input']): string {
  if (!input?.command) return '';
  const parts = [input.command];
  if (input.resumeSessionId) {
    parts.push('--resume', input.resumeSessionId);
  }
  if (input.args && input.args.length > 0) {
    parts.push(...input.args);
  }
  return parts.join(' ');
}

async function copyText(text: string, type: 'input' | 'output') {
  try {
    await navigator.clipboard.writeText(text);
    copyFeedback.value = type;
    setTimeout(() => {
      if (copyFeedback.value === type) copyFeedback.value = null;
    }, 1500);
  } catch { }
}

// ---------- 拖拽调节宽度逻辑 ----------
const STORAGE_KEY = 'ai-chatroom:inspector-width';
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 320;

function getInitialWidth(): number {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!Number.isNaN(parsed) && parsed >= MIN_WIDTH) {
        return Math.min(parsed, Math.round(window.innerWidth * 0.7));
      }
    }
  } catch { }
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
  const maxAllowed = Math.min(850, Math.round(window.innerWidth * 0.65));
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
  } catch { }
}

// ---------- 通用拖拽调节列表高度逻辑 ----------
function createVerticalResize(storageKey: string, defaultHeight = 168, minHeight = 110) {
  function getInitialHeight(): number {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!Number.isNaN(parsed) && parsed >= minHeight) {
          return Math.min(parsed, 550);
        }
      }
    } catch { }
    return defaultHeight;
  }

  const height = ref<number>(getInitialHeight());
  const isDragging = ref(false);
  let startY = 0;
  let startHeight = 0;

  function onMouseDown(e: MouseEvent) {
    isDragging.value = true;
    startY = e.clientY;
    startHeight = height.value;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDragging.value) return;
    const delta = e.clientY - startY;
    const maxAllowed = Math.min(550, Math.round(window.innerHeight * 0.6));
    const newHeight = Math.max(minHeight, Math.min(maxAllowed, startHeight + delta));
    height.value = newHeight;
  }

  function onMouseUp() {
    if (!isDragging.value) return;
    isDragging.value = false;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';

    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);

    try {
      localStorage.setItem(storageKey, height.value.toString());
    } catch { }
  }

  function cleanup() {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  return {
    height,
    isDragging,
    onMouseDown,
    cleanup,
  };
}

const summaryResize = createVerticalResize('ai-chatroom:summary-timeline-height', 168);
const logsResize = createVerticalResize('ai-chatroom:timeline-height', 168);

let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function triggerAutoRefresh() {
  if (props.activeTab !== 'logs' && props.activeTab !== 'summary') return;
  if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
  autoRefreshTimer = setTimeout(() => {
    if (props.activeTab === 'logs') {
      void loadTraces(true);
    } else if (props.activeTab === 'summary') {
      void loadSummaries(true);
    }
  }, 300);
}

// 监听当前会话消息数量或末尾消息变化，实时自动静默同步日志与摘要
watch(
  () => {
    const msgs = sessionMessages.value;
    const lastMsg = msgs[msgs.length - 1];
    return `${msgs.length}_${lastMsg?.id ?? ''}`;
  },
  () => {
    triggerAutoRefresh();
  },
);

// 会话切换时重置选中并刷新
watch(
  () => props.sessionId,
  () => {
    selectedMessageId.value = null;
    currentTraceDetail.value = null;
    tracesList.value = [];
    selectedSummaryId.value = null;
    currentSummaryDetail.value = null;
    summariesList.value = [];

    if (props.activeTab === 'logs') {
      void loadTraces(false);
    } else if (props.activeTab === 'summary') {
      void loadSummaries(false);
    }
  },
);

// 切换到对应 Tab 时自动静默同步拉取
watch(
  () => props.activeTab,
  (newTab) => {
    if (newTab === 'logs') {
      void loadTraces(true);
    } else if (newTab === 'summary') {
      void loadSummaries(true);
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (autoRefreshTimer) {
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
  summaryResize.cleanup();
  logsResize.cleanup();
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
});
</script>

<template>
  <aside class="chat-inspector" :style="{ width: `${inspectorWidth}px` }" :class="{ 'is-dragging': isDragging }">
    <!-- 左侧可拖拽分割线 -->
    <div class="inspector-resizer" title="按住左右拖动调节面板宽度" @mousedown.prevent="onMouseDown">
      <div class="resizer-line"></div>
    </div>

    <!-- Tab 1: 讨论摘要视图 (分栏列表 + 详情) -->
    <div v-if="activeTab === 'summary'" class="tab-content logs-view"
      :class="{ 'is-timeline-dragging': summaryResize.isDragging.value }">
      <!-- 摘要文件列表条 -->
      <div class="traces-timeline" :style="{ height: `${summaryResize.height.value}px` }">
        <div class="logs-subbar">
          <div class="subbar-meta">
            <span class="meta-title">讨论摘要文件</span>
            <span class="meta-pill">共 {{ summariesList.length }} 份</span>
          </div>
          <div class="subbar-actions">
            <button type="button" class="btn-refresh btn btn-ghost"
              :disabled="isRefreshingSummary || !hasNewMessagesForSummary"
              :title="!hasNewMessagesForSummary ? '暂无新增发言，当前摘要已是最新' : (isRefreshingSummary ? '生成中...' : '提炼并保存最新摘要')"
              @click="handleRefreshSummary">
              <svg class="refresh-icon" :class="{ spinning: isRefreshingSummary }" viewBox="0 0 24 24" width="13"
                height="13" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              {{ isRefreshingSummary ? '生成中...' : '生成摘要' }}
            </button>
            <button type="button" class="btn-refresh btn btn-ghost" :disabled="isLoadingSummaries"
              title="刷新文件列表" @click="loadSummaries(false)">
              <svg class="refresh-icon" :class="{ spinning: isLoadingSummaries }" viewBox="0 0 24 24" width="13"
                height="13" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              刷新
            </button>
          </div>
        </div>

        <div v-if="isLoadingSummaries && summariesList.length === 0" class="traces-loading">正在拉取摘要文件列表...</div>
        <div v-else-if="summariesList.length === 0" class="traces-empty">暂无历史摘要文件</div>
        <div v-else class="traces-items-scroll">
          <button v-for="item in summariesList" :key="item.id" type="button" class="trace-item"
            :class="{ active: selectedSummaryId === item.id, error: item.status === 'error' }"
            @click="selectSummary(item.id)">
            <div class="item-head">
              <span class="item-name">{{ formatSummaryTitle(item) }}</span>
              <span class="item-time">{{ formatTime(item.createdAt) }}</span>
            </div>
            <div class="item-sub">
              <span class="item-adapter">涵盖 {{ item.messageCount }} 条</span>
              <span class="item-duration">{{ item.trigger === 'auto' ? '自动' : '手动' }}</span>
              <span class="item-status" :class="item.status ?? 'ok'">{{ item.status === 'error' ? '失败' : '有效' }}</span>
            </div>
          </button>
        </div>
      </div>

      <!-- 上下拖拽分界线 -->
      <div class="timeline-v-resizer" title="按住上下拖动调节摘要列表高度" @mousedown.prevent="summaryResize.onMouseDown">
        <div class="v-resizer-line"></div>
      </div>

      <!-- 选中摘要完整详情 -->
      <div class="trace-detail-panel">
        <div v-if="summaryError" class="summary-error">
          {{ summaryError }}
        </div>
        <div v-if="isLoadingSummaryDetail" class="detail-loading">正在读取摘要详情...</div>
        <div v-else-if="!currentSummaryDetail && !summaryData?.text" class="detail-empty">
          <div class="empty-icon">📝</div>
          <h4>暂无讨论摘要</h4>
          <p>多 Agent 交流或私聊积累一定量后，点击上方「生成新摘要」，管理员将提炼核心议题与分歧。</p>
          <button type="button" class="btn btn-primary"
            :disabled="isRefreshingSummary || !hasNewMessagesForSummary"
            :title="!hasNewMessagesForSummary ? '暂无有效发言，无法生成摘要' : '立即生成首份摘要'"
            @click="handleRefreshSummary">
            立即生成首份摘要
          </button>
        </div>
        <div v-else-if="currentSummaryDetail" class="detail-content">
          <!-- 详情顶栏切换与操作 -->
          <div class="detail-switch-bar">
            <div class="detail-tabs">
              <button type="button" class="detail-tab-btn" :class="{ active: summarySubTab === 'public' }"
                @click="summarySubTab = 'public'">
                公聊大纲总结
              </button>
              <button v-if="hasPrivateDigests" type="button" class="detail-tab-btn"
                :class="{ active: summarySubTab === 'private' }" @click="summarySubTab = 'private'">
                成员私聊纪要 ({{ privateDigestCount }})
              </button>
            </div>
            <button type="button" class="btn-copy-trace btn btn-ghost"
              @click="copySummaryText(summarySubTab === 'public' ? currentSummaryDetail.text : privateDigestsMarkdown)">
              {{ copySummaryFeedback ? '已复制' : '复制文本' }}
            </button>
          </div>

          <!-- 详情正文展示区 -->
          <div class="detail-body-scroll">
            <div v-if="summarySubTab === 'public'" class="summary-markdown-box"
              v-html="renderMarkdown(currentSummaryDetail.text)"></div>
            <div v-else class="summary-markdown-box"
              v-html="renderMarkdown(privateDigestsMarkdown)"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 2: 调用日志视图 (分栏列表 + 详情) -->
    <div v-else-if="activeTab === 'logs'" class="tab-content logs-view"
      :class="{ 'is-timeline-dragging': logsResize.isDragging.value }">
      <!-- 轮次列表条 -->
      <div class="traces-timeline" :style="{ height: `${logsResize.height.value}px` }">
        <div class="logs-subbar">
          <div class="subbar-meta">
            <span class="meta-title">Agent 调用轮次</span>
            <span class="meta-pill">共 {{ tracesList.length }} 次</span>
          </div>
          <button type="button" class="btn-refresh btn btn-ghost" :disabled="isLoadingTraces" title="刷新日志列表"
            @click="loadTraces(false)">
            <svg class="refresh-icon" :class="{ spinning: isLoadingTraces }" viewBox="0 0 24 24" width="13" height="13"
              fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            刷新
          </button>
        </div>

        <div v-if="isLoadingTraces && tracesList.length === 0" class="traces-loading">正在拉取日志列表...</div>
        <div v-else-if="tracesList.length === 0" class="traces-empty">暂无 Agent 调用记录</div>
        <div v-else class="traces-items-scroll">
          <button v-for="item in tracesList" :key="item.messageId" type="button" class="trace-item"
            :class="{ active: selectedMessageId === item.messageId, error: item.status === 'error' }"
            @click="selectTrace(item.messageId)">
            <div class="item-head">
              <span class="item-name">{{ item.memberName }}</span>
              <span class="item-time">{{ formatTime(item.ts) }}</span>
            </div>
            <div class="item-sub">
              <span class="item-adapter">{{ item.adapter }}</span>
              <span class="item-duration">{{ formatDuration(item.durationMs) }}</span>
              <span class="item-status" :class="item.status">{{ item.status }}</span>
            </div>
          </button>
        </div>
      </div>

      <!-- 上下拖拽分界线 -->
      <div class="timeline-v-resizer" title="按住上下拖动调节轮次列表高度" @mousedown.prevent="logsResize.onMouseDown">
        <div class="v-resizer-line"></div>
      </div>

      <!-- 选中轮次完整详情 -->
      <div class="trace-detail-panel">
        <div v-if="isLoadingDetail" class="detail-loading">正在读取完整输入输出...</div>
        <div v-else-if="!currentTraceDetail" class="detail-empty">请在上方选择一次调用记录</div>
        <div v-else class="detail-content">
          <!-- 详情顶栏切换 -->
          <div class="detail-switch-bar">
            <div class="detail-tabs">
              <button type="button" class="detail-tab-btn" :class="{ active: detailSubTab === 'input' }"
                @click="detailSubTab = 'input'">
                全部输入 (Prompt)
              </button>
              <button type="button" class="detail-tab-btn" :class="{ active: detailSubTab === 'output' }"
                @click="detailSubTab = 'output'">
                全部输出 (Result)
              </button>
            </div>
            <button type="button" class="btn-copy-trace btn btn-ghost" @click="
              copyText(
                detailSubTab === 'input'
                  ? currentTraceDetail.input.prompt
                  : currentTraceDetail.output.result,
                detailSubTab
              )
              ">
              {{ copyFeedback === detailSubTab ? '已复制 ✓' : '复制内容' }}
            </button>
          </div>

          <!-- 输入视图 -->
          <div v-if="detailSubTab === 'input'" class="detail-viewer">
            <div class="viewer-meta-row">
              <span class="label">上下文模式:</span>
              <span class="context-mode-pill"
                :class="currentTraceDetail.input.resumeSessionId ? 'stateful' : 'stateless'">
                {{ currentTraceDetail.input.resumeSessionId ? '⚡ 有状态增量 (Delta Resume)' : '📦 无状态全量 (Full Context)' }}
              </span>
            </div>
            <div v-if="currentTraceDetail.input.command" class="viewer-meta-row">
              <span class="label">CLI 指令:</span>
              <code>{{ formatCliCommand(currentTraceDetail.input) }}</code>
            </div>
            <div v-if="currentTraceDetail.input.cwd" class="viewer-meta-row">
              <span class="label">工作目录:</span>
              <code>{{ currentTraceDetail.input.cwd }}</code>
            </div>
            <div class="viewer-code-block">
              <pre><code>{{ currentTraceDetail.input.prompt }}</code></pre>
            </div>
          </div>

          <!-- 输出视图 -->
          <div v-else class="detail-viewer">
            <div v-if="currentTraceDetail.output.thinking" class="thinking-section">
              <div class="section-title">🧠 思考过程 (Thinking)</div>
              <pre class="thinking-text"><code>{{ currentTraceDetail.output.thinking }}</code></pre>
            </div>

            <div v-if="currentTraceDetail.output.trace && currentTraceDetail.output.trace.length > 0"
              class="trace-steps-section">
              <div class="section-title">🛠️ 工作过程时间线 ({{ currentTraceDetail.output.trace.length }} 步)</div>
              <div class="trace-timeline-box">
                <div v-for="(t, idx) in currentTraceDetail.output.trace" :key="idx" class="trace-step-item">
                  <div class="step-head">
                    <span class="step-kind" :class="t.kind">{{ t.kind }}</span>
                    <span v-if="t.label" class="step-label">{{ t.label }}</span>
                  </div>
                  <pre class="step-content"><code>{{ t.content }}</code></pre>
                </div>
              </div>
            </div>

            <div class="result-section">
              <div class="section-title">💬 最终输出正文 (Result)</div>
              <pre class="result-text"><code>{{ currentTraceDetail.output.result }}</code></pre>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 2: 用量与开销度量统计视图 -->
    <div v-else-if="activeTab === 'stats'" class="tab-content stats-tab-view">
      <InspectorStats :session-type="sessionType" :session-id="sessionId" />
    </div>

    <!-- Tab 3: 管理视图 (房间管理 / 角色管理) -->
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

.stats-tab-view,
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

/* Tab 内容区通用 */
.tab-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 面板顶部轻量操作栏 (摘要与日志共用) */
.summary-subbar,
.logs-subbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--panel-softer);
  flex-shrink: 0;
}

.subbar-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.meta-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}

.meta-time {
  font-size: 11.5px;
  color: var(--muted);
}

.meta-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-weight: 550;
}

.meta-pill.meta-pill-empty {
  background: var(--border-soft);
  color: var(--muted);
  font-weight: 500;
}

.btn-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 12px;
  height: auto;
  transition: all 0.15s ease;
}

.btn-refresh:disabled,
.btn-refresh[disabled] {
  opacity: 0.45 !important;
  cursor: not-allowed !important;
  color: var(--muted) !important;
  pointer-events: auto !important;
}

.btn-refresh:disabled:hover,
.btn-refresh[disabled]:hover {
  background: transparent !important;
  border-color: transparent !important;
}

.refresh-icon.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.summary-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  background: var(--panel);
}

.summary-markdown-box {
  font-size: 13.5px;
  line-height: 1.68;
  color: var(--text);
}

.summary-markdown-box :deep(h1),
.summary-markdown-box :deep(h2),
.summary-markdown-box :deep(h3) {
  margin-top: 16px;
  margin-bottom: 8px;
  font-weight: 700;
  color: var(--text);
}

.summary-markdown-box :deep(h3) {
  font-size: 13.5px;
  border-bottom: 1px solid var(--border-soft);
  padding-bottom: 4px;
  color: var(--accent-deep);
}

.summary-markdown-box :deep(p) {
  margin-bottom: 10px;
  color: var(--text-muted);
}

.summary-markdown-box :deep(ul) {
  padding-left: 18px;
  margin-bottom: 10px;
  color: var(--text-muted);
}

.summary-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 80%;
  text-align: center;
  padding: 0 24px;
  color: var(--muted);
}

.empty-icon {
  font-size: 32px;
  margin-bottom: 12px;
}

.summary-empty-state h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
}

.summary-empty-state p {
  font-size: 12.5px;
  line-height: 1.5;
  margin-bottom: 16px;
  color: var(--muted);
}

.summary-loading-placeholder {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 0;
}

.shimmer-line {
  height: 14px;
  background: var(--border-soft);
  border-radius: 4px;
  animation: pulse 1.5s infinite ease-in-out;
}

.shimmer-line.short {
  width: 40%;
}

.shimmer-line.mid {
  width: 75%;
}

.loading-tip {
  font-size: 12px;
  color: var(--muted);
  margin-top: 10px;
}

@keyframes pulse {
  0% {
    opacity: 0.6;
  }

  50% {
    opacity: 1;
  }

  100% {
    opacity: 0.6;
  }
}

/* 调用日志面板 */
.logs-view {
  flex-direction: column;
  overflow: hidden;
}

.traces-timeline {
  min-height: 110px;
  max-height: 65vh;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: var(--panel-soft);
}

/* 上下拖拽分界线 */
.timeline-v-resizer {
  height: 6px;
  width: 100%;
  cursor: row-resize;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 15;
  margin-top: -3px;
  margin-bottom: -3px;
  transition: background 0.15s ease;
}

.v-resizer-line {
  height: 1px;
  width: 100%;
  background: var(--border-soft);
  transition: background 0.15s ease, height 0.15s ease;
}

.timeline-v-resizer:hover,
.logs-view.is-timeline-dragging .timeline-v-resizer {
  background: var(--accent-soft);
}

.timeline-v-resizer:hover .v-resizer-line,
.logs-view.is-timeline-dragging .v-resizer-line {
  height: 2px;
  background: var(--accent);
}

.traces-items-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trace-item {
  padding: 7px 10px;
  border-radius: 6px;
  background: var(--panel);
  border: 1px solid var(--border-soft);
  text-align: left;
  cursor: pointer;
  transition: all 0.12s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}

.trace-item:hover {
  border-color: var(--border);
  background: var(--panel-soft);
}

.trace-item.active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
}

.trace-item.active .item-name {
  color: var(--accent-deep);
  font-weight: 600;
}

.item-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 3px;
}

.item-time {
  font-size: 11px;
  color: var(--faint);
}

.item-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--muted);
}

.item-status {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 600;
}

.item-status.ok {
  color: var(--ok);
  background: rgba(16, 185, 129, 0.1);
}

.item-status.error {
  color: var(--danger);
  background: rgba(229, 72, 77, 0.1);
}

.item-status.cancelled {
  color: var(--warn);
  background: rgba(245, 158, 11, 0.1);
}

.traces-loading,
.traces-empty {
  padding: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}

/* 详情面板 */
.trace-detail-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
}

.detail-switch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--panel-soft);
}

.detail-tabs {
  display: flex;
  gap: 16px;
}

.detail-tab-btn {
  padding: 4px 0;
  font-size: 12.5px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.detail-tab-btn:hover {
  color: var(--text);
}

.detail-tab-btn.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.btn-copy-trace {
  font-size: 11.5px;
  padding: 4px 10px;
  height: auto;
}

.detail-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.detail-viewer {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  font-size: 12.5px;
}

.viewer-meta-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 11.5px;
}

.viewer-meta-row .label {
  color: var(--muted);
  flex-shrink: 0;
}

.context-mode-pill {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 4px;
  font-weight: 500;
}

.context-mode-pill.stateful {
  background: var(--accent-soft);
  color: var(--accent-deep);
}

.context-mode-pill.stateless {
  background: var(--border-soft);
  color: var(--muted);
}

.viewer-meta-row code {
  background: var(--panel-softer);
  border: 1px solid var(--border-soft);
  color: var(--text-muted);
  padding: 2px 6px;
  border-radius: 4px;
  word-break: break-all;
  font-family: monospace;
}

.viewer-code-block pre,
.thinking-text,
.result-text {
  margin: 0;
  padding: 12px;
  background: var(--panel-softer);
  border-radius: 8px;
  border: 1px solid var(--border-soft);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text);
}

.thinking-section {
  margin-bottom: 12px;
}

.thinking-text {
  background: #FBFBFE;
  border: 1px dashed var(--accent-border);
  color: var(--text-muted);
}

.section-title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--muted);
  margin-top: 10px;
  margin-bottom: 6px;
}

.trace-timeline-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.trace-step-item {
  padding: 9px 12px;
  background: var(--panel);
  border-radius: 6px;
  border: 1px solid var(--border-soft);
  box-shadow: var(--shadow-sm);
}

.step-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.step-kind {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-weight: 600;
}

.step-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text);
}

.step-content {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  max-height: 140px;
  overflow-y: auto;
  white-space: pre-wrap;
  font-family: monospace;
  background: var(--panel-softer);
  border-radius: 4px;
  padding: 6px;
}

.detail-loading,
.detail-empty {
  padding: 40px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

.subbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.detail-body-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
}

.summary-error {
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #ef4444;
  font-size: 12px;
  border-radius: 6px;
  margin: 10px 14px 0;
}
</style>
