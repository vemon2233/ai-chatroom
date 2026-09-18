<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '@/services/api';
import { store } from '@/store';
import type { AgentTraceLog } from '@server/core/types';
import type { TraceSummaryItem } from '@server/store/trace';
import { useVerticalResize } from './useInspectorResize';

const props = defineProps<{
  sessionType: 'room' | 'direct';
  sessionId: string;
}>();

const tracesList = ref<TraceSummaryItem[]>([]);
const isLoadingTraces = ref(false);
const { t } = useI18n();
const selectedMessageId = ref<string | null>(null);
const currentTraceDetail = ref<AgentTraceLog | null>(null);
const isLoadingDetail = ref(false);
const detailSubTab = ref<'input' | 'output'>('input');
const copyFeedback = ref<'input' | 'output' | null>(null);

const logsResize = useVerticalResize('ai-chatroom:timeline-height', 168);

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

    const prevFirstId = tracesList.value[0]?.messageId;
    const wasTrackingTop = !selectedMessageId.value || selectedMessageId.value === prevFirstId;

    tracesList.value = list;

    if (list.length > 0) {
      if (wasTrackingTop) {
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
      copyFeedback.value = null;
    }, 1500);
  } catch { }
}

let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function triggerAutoRefresh() {
  if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
  autoRefreshTimer = setTimeout(() => {
    void loadTraces(true);
  }, 300);
}

// 监听消息变化自动静默同步日志
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

// 会话切换重置
watch(
  () => props.sessionId,
  () => {
    selectedMessageId.value = null;
    currentTraceDetail.value = null;
    tracesList.value = [];
    void loadTraces(false);
  },
  { immediate: true },
);

onUnmounted(() => {
  if (autoRefreshTimer) {
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  logsResize.cleanup();
});
</script>

<template>
  <div class="inspector-logs-view" :class="{ 'is-timeline-dragging': logsResize.isDragging.value }">
    <!-- 轮次列表条 -->
    <div class="traces-timeline" :style="{ height: `${logsResize.height.value}px` }">
      <div class="logs-subbar">
        <div class="subbar-meta">
          <span class="meta-title">{{ t('inspector.logs.title') }}</span>
          <span class="meta-pill">{{ t('inspector.logs.totalCount', { count: tracesList.length }) }}</span>
        </div>
        <div class="subbar-actions">
          <button
            type="button"
            class="btn-refresh btn btn-ghost"
            :disabled="isLoadingTraces"
            :title="t('inspector.logs.refreshTitle')"
            @click="loadTraces(false)"
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
            {{ t('inspector.logs.refresh') }}
          </button>
        </div>
      </div>

      <div v-if="isLoadingTraces && tracesList.length === 0" class="traces-loading">{{ t('inspector.logs.loadingList') }}</div>
      <div v-else-if="tracesList.length === 0" class="traces-empty">{{ t('inspector.logs.emptyList') }}</div>
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
    <div class="timeline-v-resizer" :title="t('inspector.logs.resizerHint')" @mousedown.prevent="logsResize.onMouseDown">
      <div class="v-resizer-line"></div>
    </div>

    <!-- 选中轮次完整详情 -->
    <div class="trace-detail-panel">
      <div v-if="isLoadingDetail" class="detail-loading">{{ t('inspector.logs.loadingDetail') }}</div>
      <div v-else-if="!currentTraceDetail" class="detail-empty">{{ t('inspector.logs.emptyDetail') }}</div>
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
              {{ t('inspector.logs.tabInput') }}
            </button>
            <button
              type="button"
              class="detail-tab-btn"
              :class="{ active: detailSubTab === 'output' }"
              @click="detailSubTab = 'output'"
            >
              {{ t('inspector.logs.tabOutput') }}
            </button>
          </div>
          <button
            type="button"
            class="btn-copy-trace btn btn-ghost"
            @click="copyText(detailSubTab === 'input' ? currentTraceDetail.input.prompt : currentTraceDetail.output.result, detailSubTab)"
          >
            {{ copyFeedback === detailSubTab ? t('inspector.logs.copied') : t('inspector.logs.copyContent') }}
          </button>
        </div>

        <!-- 输入视图 -->
        <div v-if="detailSubTab === 'input'" class="detail-viewer">
          <div class="viewer-meta-row">
            <span class="label">{{ t('inspector.logs.contextModeLabel') }}</span>
            <span
              class="context-mode-pill"
              :class="currentTraceDetail.input.resumeSessionId ? 'stateful' : 'stateless'"
            >
              {{ currentTraceDetail.input.resumeSessionId ? t('inspector.logs.stateful') : t('inspector.logs.stateless') }}
            </span>
          </div>
          <div v-if="currentTraceDetail.input.command" class="viewer-meta-row">
            <span class="label">{{ t('inspector.logs.cliCommand') }}</span>
            <code>{{ formatCliCommand(currentTraceDetail.input) }}</code>
          </div>
          <div v-if="currentTraceDetail.input.cwd" class="viewer-meta-row">
            <span class="label">{{ t('inspector.logs.workDir') }}</span>
            <code>{{ currentTraceDetail.input.cwd }}</code>
          </div>
          <div class="viewer-code-block">
            <pre><code>{{ currentTraceDetail.input.prompt }}</code></pre>
          </div>
        </div>

        <!-- 输出视图 -->
        <div v-else class="detail-viewer">
          <div v-if="currentTraceDetail.output.thinking" class="thinking-section">
            <div class="section-title">{{ t('inspector.logs.thinking') }}</div>
            <pre class="thinking-text"><code>{{ currentTraceDetail.output.thinking }}</code></pre>
          </div>

          <div
            v-if="currentTraceDetail.output.trace && currentTraceDetail.output.trace.length > 0"
            class="trace-steps-section"
          >
            <div class="section-title">{{ t('inspector.logs.traceTimeline', { count: currentTraceDetail.output.trace.length }) }}</div>
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
            <div class="section-title">{{ t('inspector.logs.result') }}</div>
            <pre class="result-text"><code>{{ currentTraceDetail.output.result }}</code></pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inspector-logs-view {
  flex: 1;
  min-height: 0;
  display: flex;
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

.meta-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-weight: 550;
}

.subbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-refresh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 12px;
  height: auto;
  border-radius: 6px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.btn-refresh:disabled,
.btn-refresh[disabled] {
  opacity: 0.45 !important;
  cursor: not-allowed !important;
  color: var(--muted) !important;
  pointer-events: auto !important;
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
  background: var(--ok-soft);
}

.item-status.error {
  color: var(--danger);
  background: var(--danger-soft);
}

.item-status.cancelled {
  color: var(--warn);
  background: var(--warn-soft);
}

.traces-loading,
.traces-empty {
  padding: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}

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
.inspector-logs-view.is-timeline-dragging .timeline-v-resizer {
  background: var(--accent-soft);
}

.timeline-v-resizer:hover .v-resizer-line,
.inspector-logs-view.is-timeline-dragging .v-resizer-line {
  height: 2px;
  background: var(--accent);
}

.trace-detail-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
}

.detail-loading,
.detail-empty {
  padding: 40px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

.detail-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
  background: var(--panel-softer);
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
</style>
