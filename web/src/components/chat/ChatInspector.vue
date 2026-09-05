<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { api } from '@/services/api';
import { store } from '@/store';
import { renderMarkdown } from '@/utils/markdown';
import type { AgentTraceLog, DiscussionSummary } from '@server/core/types';
import type { TraceSummaryItem } from '@server/store/trace';

const props = defineProps<{
  activeTab: 'summary' | 'logs';
  sessionType: 'room' | 'direct';
  sessionId: string;
}>();

const emit = defineEmits<{
  (e: 'update:activeTab', tab: 'summary' | 'logs'): void;
  (e: 'close'): void;
}>();

// ---------- 讨论摘要逻辑 ----------
const isRefreshingSummary = ref(false);
const summaryError = ref('');

const summaryData = computed<DiscussionSummary | null>(() => store.currentSummary);

async function handleRefreshSummary() {
  if (isRefreshingSummary.value) return;
  isRefreshingSummary.value = true;
  summaryError.value = '';
  try {
    let res: DiscussionSummary;
    if (props.sessionType === 'room') {
      res = await api.refreshRoomSummary(props.sessionId);
    } else {
      res = await api.refreshDirectSummary(props.sessionId);
    }
    store.currentSummary = res;
  } catch (err: any) {
    summaryError.value = err?.message || '生成摘要失败';
  } finally {
    isRefreshingSummary.value = false;
  }
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
  } catch {}
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
  } catch {}
}

// ---------- 拖拽调节轮次列表高度逻辑 ----------
const TIMELINE_HEIGHT_KEY = 'ai-chatroom:timeline-height';
const DEFAULT_TIMELINE_HEIGHT = 168;
const MIN_TIMELINE_HEIGHT = 110;

function getInitialTimelineHeight(): number {
  try {
    const saved = localStorage.getItem(TIMELINE_HEIGHT_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!Number.isNaN(parsed) && parsed >= MIN_TIMELINE_HEIGHT) {
        return Math.min(parsed, 550);
      }
    }
  } catch {}
  return DEFAULT_TIMELINE_HEIGHT;
}

const timelineHeight = ref<number>(getInitialTimelineHeight());
const isTimelineDragging = ref(false);
let startTimelineY = 0;
let startTimelineHeight = 0;

function onTimelineMouseDown(e: MouseEvent) {
  isTimelineDragging.value = true;
  startTimelineY = e.clientY;
  startTimelineHeight = timelineHeight.value;

  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'row-resize';

  window.addEventListener('mousemove', onTimelineMouseMove);
  window.addEventListener('mouseup', onTimelineMouseUp);
}

function onTimelineMouseMove(e: MouseEvent) {
  if (!isTimelineDragging.value) return;
  const delta = e.clientY - startTimelineY;
  const maxAllowed = Math.min(550, Math.round(window.innerHeight * 0.6));
  const newHeight = Math.max(MIN_TIMELINE_HEIGHT, Math.min(maxAllowed, startTimelineHeight + delta));
  timelineHeight.value = newHeight;
}

function onTimelineMouseUp() {
  if (!isTimelineDragging.value) return;
  isTimelineDragging.value = false;
  document.body.style.userSelect = '';
  document.body.style.cursor = '';

  window.removeEventListener('mousemove', onTimelineMouseMove);
  window.removeEventListener('mouseup', onTimelineMouseUp);

  try {
    localStorage.setItem(TIMELINE_HEIGHT_KEY, timelineHeight.value.toString());
  } catch {}
}

let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function triggerAutoRefresh() {
  if (props.activeTab !== 'logs') return;
  if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
  autoRefreshTimer = setTimeout(() => {
    void loadTraces(true);
  }, 300);
}

// 监听当前会话消息数量或末尾消息变化，实时自动静默同步日志
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
    if (props.activeTab === 'logs') {
      void loadTraces(false);
    }
  },
);

// 切换到日志 Tab 时自动触发拉取
watch(
  () => props.activeTab,
  (newTab) => {
    if (newTab === 'logs') {
      void loadTraces(false);
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
  window.removeEventListener('mousemove', onTimelineMouseMove);
  window.removeEventListener('mouseup', onTimelineMouseUp);
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
    <div
      class="inspector-resizer"
      title="按住左右拖动调节面板宽度"
      @mousedown.prevent="onMouseDown"
    >
      <div class="resizer-line"></div>
    </div>
    <!-- Tab 1: 讨论摘要视图 -->
    <div v-if="activeTab === 'summary'" class="tab-content summary-view">
      <div class="summary-subbar">
        <div class="subbar-meta">
          <span class="meta-title">讨论摘要</span>
          <span v-if="summaryData?.messageCount" class="meta-pill">涵盖 {{ summaryData.messageCount }} 条</span>
          <span v-else class="meta-pill meta-pill-empty">未生成</span>
          <span v-if="summaryData?.updatedAt" class="meta-time">{{ formattedSummaryTime }}</span>
        </div>
        <button
          type="button"
          class="btn-refresh btn btn-ghost"
          :disabled="isRefreshingSummary"
          @click="handleRefreshSummary"
        >
          <svg
            class="refresh-icon"
            :class="{ spinning: isRefreshingSummary }"
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {{ isRefreshingSummary ? '生成中...' : '刷新摘要' }}
        </button>
      </div>

      <div class="summary-body">
        <div v-if="summaryError" class="summary-error">
          {{ summaryError }}
        </div>

        <div v-if="isRefreshingSummary && !summaryData?.text" class="summary-loading-placeholder">
          <div class="shimmer-line short"></div>
          <div class="shimmer-line"></div>
          <div class="shimmer-line mid"></div>
          <p class="loading-tip">管理员正在全面梳理近期发言并提炼共识...</p>
        </div>

        <div
          v-else-if="summaryData?.text"
          class="summary-markdown-box"
          v-html="renderMarkdown(summaryData.text)"
        ></div>

        <div v-else class="summary-empty-state">
          <div class="empty-icon">📝</div>
          <h4>暂无讨论摘要</h4>
          <p>多 Agent 交流或私聊积累一定量后，点击右上角「刷新摘要」，管理员将提炼核心议题与分歧。</p>
          <button type="button" class="btn btn-primary" @click="handleRefreshSummary">立即生成首份摘要</button>
        </div>
      </div>
    </div>

    <!-- Tab 2: 调用日志视图 (分栏列表 + 详情) -->
    <div
      v-else
      class="tab-content logs-view"
      :class="{ 'is-timeline-dragging': isTimelineDragging }"
    >
      <!-- 轮次列表条 -->
      <div class="traces-timeline" :style="{ height: `${timelineHeight}px` }">
        <div class="logs-subbar">
          <div class="subbar-meta">
            <span class="meta-title">Agent 调用轮次</span>
            <span class="meta-pill">共 {{ tracesList.length }} 次</span>
          </div>
          <button
            type="button"
            class="btn-refresh btn btn-ghost"
            :disabled="isLoadingTraces"
            title="刷新日志列表"
            @click="loadTraces"
          >
            <svg
              class="refresh-icon"
              :class="{ spinning: isLoadingTraces }"
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {{ isLoadingTraces ? '拉取中...' : '刷新日志' }}
          </button>
        </div>

        <div v-if="isLoadingTraces" class="traces-loading">正在拉取日志列表...</div>
        <div v-else-if="tracesList.length === 0" class="traces-empty">暂无 Agent 调用记录</div>
        <div v-else class="traces-items-scroll">
          <button
            v-for="item in tracesList"
            :key="item.messageId"
            type="button"
            class="trace-item"
            :class="{ active: selectedMessageId === item.messageId, error: item.status === 'error' }"
            @click="selectTrace(item.messageId)"
          >
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
      <div
        class="timeline-v-resizer"
        title="按住上下拖动调节轮次列表高度"
        @mousedown.prevent="onTimelineMouseDown"
      >
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
              <button
                type="button"
                class="detail-tab-btn"
                :class="{ active: detailSubTab === 'input' }"
                @click="detailSubTab = 'input'"
              >
                全部输入 (Prompt)
              </button>
              <button
                type="button"
                class="detail-tab-btn"
                :class="{ active: detailSubTab === 'output' }"
                @click="detailSubTab = 'output'"
              >
                全部输出 (Result)
              </button>
            </div>
            <button
              type="button"
              class="btn-copy-trace btn btn-ghost"
              @click="
                copyText(
                  detailSubTab === 'input'
                    ? currentTraceDetail.input.prompt
                    : currentTraceDetail.output.result,
                  detailSubTab
                )
              "
            >
              {{ copyFeedback === detailSubTab ? '已复制 ✓' : '复制内容' }}
            </button>
          </div>

          <!-- 输入视图 -->
          <div v-if="detailSubTab === 'input'" class="detail-viewer">
            <div class="viewer-meta-row">
              <span class="label">上下文模式:</span>
              <span
                class="context-mode-pill"
                :class="currentTraceDetail.input.resumeSessionId ? 'stateful' : 'stateless'"
              >
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

            <div v-if="currentTraceDetail.output.trace && currentTraceDetail.output.trace.length > 0" class="trace-steps-section">
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
}

.refresh-icon.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
.shimmer-line.short { width: 40%; }
.shimmer-line.mid { width: 75%; }
.loading-tip {
  font-size: 12px;
  color: var(--muted);
  margin-top: 10px;
}

@keyframes pulse {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
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
</style>
