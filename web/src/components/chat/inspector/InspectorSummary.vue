<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { api } from '@/services/api';
import { store } from '@/store';
import { renderMarkdown } from '@/utils/markdown';
import type { DiscussionSummary, DiscussionSummarySnapshot, SummarySnapshotItem } from '@server/core/types';
import { useVerticalResize } from './useInspectorResize';

const props = defineProps<{
  sessionType: 'room' | 'direct';
  sessionId: string;
}>();

const summariesList = ref<SummarySnapshotItem[]>([]);
const isLoadingSummaries = ref(false);
const isRefreshingSummary = ref(false);
const summaryError = ref('');
const selectedSummaryId = ref<string | null>(null);
const currentSummaryDetail = ref<DiscussionSummarySnapshot | null>(null);
const isLoadingSummaryDetail = ref(false);
const summarySubTab = ref<'public' | 'private'>('public');
const copySummaryFeedback = ref(false);

const summaryResize = useVerticalResize('ai-chatroom:summary-timeline-height', 168);

const sessionMessages = computed(() => {
  return props.sessionType === 'room' ? store.messages : store.directMessages;
});

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

  const validMsgs = props.sessionType === 'room'
    ? msgs.filter((m) => !m.system && (!m.audience || m.audience.length === 0) && !!m.text?.trim())
    : msgs.filter((m) => !m.system && !!m.text?.trim());

  if (validMsgs.length === 0) return false;

  const latestItem = summariesList.value[0];
  const currentSum = summaryData.value;
  const hasExistingSummary = (latestItem && latestItem.messageCount > 0) || !!currentSum?.text;
  if (!hasExistingSummary) {
    return true;
  }

  const coveredId = latestItem?.coveredMessageId ?? currentSum?.coveredMessageId;
  if (!coveredId) {
    const coveredCount = latestItem?.messageCount ?? currentSum?.messageCount ?? 0;
    return validMsgs.length > coveredCount;
  }

  const coveredIndex = validMsgs.findIndex((m) => m.id === coveredId);
  if (coveredIndex === -1) {
    return true;
  }

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

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function formatSummaryTitle(item: SummarySnapshotItem): string {
  const time = formatTime(item.createdAt);
  const typeStr = item.trigger === 'auto' ? '自动提炼' : '手动刷新';
  return `${time} (${typeStr})`;
}

let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function triggerAutoRefresh() {
  if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
  autoRefreshTimer = setTimeout(() => {
    void loadSummaries(true);
  }, 300);
}

// 监听消息增减自动刷新
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

// 监听 store.currentSummary 变更 (自动摘要或私聊纪要生成后实时静默刷新)
watch(
  () => store.currentSummary,
  () => {
    triggerAutoRefresh();
  },
);

// 会话切换重置
watch(
  () => props.sessionId,
  () => {
    selectedSummaryId.value = null;
    currentSummaryDetail.value = null;
    summariesList.value = [];
    void loadSummaries(false);
  },
  { immediate: true },
);

onUnmounted(() => {
  if (autoRefreshTimer) {
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  summaryResize.cleanup();
});
</script>

<template>
  <div class="inspector-summary-view" :class="{ 'is-timeline-dragging': summaryResize.isDragging.value }">
    <!-- 摘要文件列表条 -->
    <div class="traces-timeline" :style="{ height: `${summaryResize.height.value}px` }">
      <div class="logs-subbar">
        <div class="subbar-meta">
          <span class="meta-title">讨论摘要文件</span>
          <span class="meta-pill">共 {{ summariesList.length }} 份</span>
        </div>
        <div class="subbar-actions">
          <button
            type="button"
            class="btn-generate-summary btn btn-primary"
            :disabled="isRefreshingSummary || !hasNewMessagesForSummary"
            :title="!hasNewMessagesForSummary ? '暂无新增发言，当前摘要已是最新' : (isRefreshingSummary ? '生成中...' : '提炼并保存最新摘要')"
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
            {{ isRefreshingSummary ? '生成中...' : '生成摘要' }}
          </button>
          <button
            type="button"
            class="btn-refresh btn btn-ghost"
            :disabled="isLoadingSummaries"
            title="刷新文件列表"
            @click="loadSummaries(false)"
          >
            <svg
              class="refresh-icon"
              :class="{ spinning: isLoadingSummaries }"
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            刷新
          </button>
        </div>
      </div>

      <div v-if="isLoadingSummaries && summariesList.length === 0" class="traces-loading">正在拉取摘要文件列表...</div>
      <div v-else-if="summariesList.length === 0" class="traces-empty">暂无历史摘要文件</div>
      <div v-else class="traces-items-scroll">
        <button
          v-for="item in summariesList"
          :key="item.id"
          type="button"
          class="trace-item"
          :class="{ active: selectedSummaryId === item.id, error: item.status === 'error' }"
          @click="selectSummary(item.id)"
        >
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
        <button
          type="button"
          class="btn btn-primary"
          :disabled="isRefreshingSummary || !hasNewMessagesForSummary"
          :title="!hasNewMessagesForSummary ? '暂无有效发言，无法生成摘要' : '立即生成首份摘要'"
          @click="handleRefreshSummary"
        >
          立即生成首份摘要
        </button>
      </div>
      <div v-else-if="currentSummaryDetail" class="detail-content">
        <!-- 详情顶栏切换与操作 -->
        <div class="detail-switch-bar">
          <div class="detail-tabs">
            <button
              type="button"
              class="detail-tab-btn"
              :class="{ active: summarySubTab === 'public' }"
              @click="summarySubTab = 'public'"
            >
              公聊大纲总结
            </button>
            <button
              v-if="hasPrivateDigests"
              type="button"
              class="detail-tab-btn"
              :class="{ active: summarySubTab === 'private' }"
              @click="summarySubTab = 'private'"
            >
              成员私聊纪要 ({{ privateDigestCount }})
            </button>
          </div>
          <button
            type="button"
            class="btn-copy-trace btn btn-ghost"
            @click="copySummaryText(summarySubTab === 'public' ? currentSummaryDetail.text : privateDigestsMarkdown)"
          >
            {{ copySummaryFeedback ? '已复制' : '复制文本' }}
          </button>
        </div>

        <!-- 详情正文展示区 -->
        <div class="detail-body-scroll">
          <div
            v-if="summarySubTab === 'public'"
            class="summary-markdown-box"
            v-html="renderMarkdown(currentSummaryDetail.text)"
          ></div>
          <div
            v-else
            class="summary-markdown-box"
            v-html="renderMarkdown(privateDigestsMarkdown)"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inspector-summary-view {
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

.btn-generate-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-size: 12px;
  height: auto;
  border-radius: 6px;
  font-weight: 500;
  background: var(--accent);
  color: #fff;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}

.btn-generate-summary:hover:not(:disabled) {
  opacity: 0.9;
  background: var(--accent);
  color: #fff;
}

.btn-generate-summary:disabled,
.btn-generate-summary[disabled] {
  opacity: 0.45 !important;
  cursor: not-allowed !important;
  background: var(--accent) !important;
  color: #fff !important;
  border-color: transparent !important;
  pointer-events: auto !important;
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

.traces-loading,
.traces-empty {
  padding: 24px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
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
.inspector-summary-view.is-timeline-dragging .timeline-v-resizer {
  background: var(--accent-soft);
}

.timeline-v-resizer:hover .v-resizer-line,
.inspector-summary-view.is-timeline-dragging .v-resizer-line {
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

.summary-error {
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #ef4444;
  font-size: 12px;
  border-radius: 6px;
  margin: 10px 14px 0;
}

.detail-loading,
.detail-empty {
  padding: 40px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}

.empty-icon {
  font-size: 32px;
  margin-bottom: 12px;
}

.detail-empty h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
}

.detail-empty p {
  font-size: 12.5px;
  line-height: 1.5;
  margin-bottom: 16px;
  color: var(--muted);
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

.detail-body-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
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
</style>
