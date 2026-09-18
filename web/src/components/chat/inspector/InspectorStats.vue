<script setup lang="ts">
// InspectorStats: 右侧边栏中的会话用量与开销度量统计面板
// 统计每个角色的发言条数、活跃份额占比、Token 消耗、费用与耗时，支持导出 Markdown 简报

import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '@/services/api';
import { currentLang } from '@/i18n';
import type { SessionStats, MemberStats } from '@server/core/types';

const props = defineProps<{
  sessionType: 'room' | 'direct';
  sessionId: string;
}>();

const stats = ref<SessionStats | null>(null);
const isLoading = ref(false);
const errorMsg = ref('');
const { t } = useI18n();

const sortedMembers = computed<MemberStats[]>(() => {
  if (!stats.value?.members) return [];
  return [...stats.value.members].sort((a, b) => {
    const getPriority = (item: MemberStats) => {
      if (item.id === 'user' || item.isUser) return 0;
      if (item.id === 'system' || item.name === '系统' || item.name.includes('系统') || item.adapter === 'System') return 1;
      return 2;
    };
    const pDiff = getPriority(a) - getPriority(b);
    if (pDiff !== 0) return pDiff;
    return b.messageCount - a.messageCount || b.totalTokens - a.totalTokens;
  });
});

async function loadStats() {
  if (!props.sessionId) return;
  isLoading.value = true;
  errorMsg.value = '';
  try {
    const res =
      props.sessionType === 'room'
        ? await api.roomStats(props.sessionId)
        : await api.directStats(props.sessionId);
    stats.value = res;
  } catch (err: any) {
    errorMsg.value = err?.message || t('inspector.stats.loadFailed');
  } finally {
    isLoading.value = false;
  }
}

watch(() => props.sessionId, () => {
  void loadStats();
}, { immediate: true });

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '0s';
  return (ms / 1000).toFixed(1) + 's';
}

function formatNumber(num: number): string {
  return (num || 0).toLocaleString(currentLang() === 'zh' ? 'zh-CN' : 'en-US');
}

function initialsFor(name: string): string {
  const t = name.trim();
  return t ? t.slice(0, 1).toUpperCase() : '?';
}
</script>

<template>
  <div class="inspector-stats-view">
    <!-- 顶部轻量操作栏 (样式与摘要、日志、管理严格对齐) -->
    <div class="manage-subbar">
      <div class="subbar-meta">
        <span class="meta-title">{{ t('inspector.stats.title') }}</span>
        <span v-if="stats" class="meta-pill">{{ t('inspector.stats.coversMessages', { count: stats.totalMessages }) }}</span>
      </div>
      <div class="subbar-actions">
        <button type="button" class="btn-refresh btn btn-ghost" :disabled="isLoading" :title="t('inspector.stats.refreshTitle')"
          @click="loadStats">
          <svg class="refresh-icon" :class="{ spinning: isLoading }" viewBox="0 0 24 24" width="13" height="13"
            fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {{ t('inspector.stats.refresh') }}
        </button>
      </div>
    </div>

    <!-- 主体滚动区 -->
    <div class="stats-scroll-body">
      <!-- 错误提示 -->
      <div v-if="errorMsg" class="stats-error">
        {{ errorMsg }}
      </div>

      <!-- 加载状态 -->
      <div v-if="isLoading && !stats" class="stats-loading">
        <div class="shimmer-card"></div>
        <div class="shimmer-card"></div>
        <p class="loading-hint">{{ t('inspector.stats.loadingHint') }}</p>
      </div>

      <template v-else-if="stats">
        <!-- 4格 KPI 概览面板 -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <span class="kpi-icon">💬</span>
            <div class="kpi-info">
              <span class="kpi-label">{{ t('inspector.stats.kpiMessages') }}</span>
              <span class="kpi-val">{{ formatNumber(stats.totalMessages) }}</span>
            </div>
          </div>
          <div class="kpi-card">
            <span class="kpi-icon">💰</span>
            <div class="kpi-info">
              <span class="kpi-label">{{ t('inspector.stats.kpiCost') }}</span>
              <span class="kpi-val cost">${{ stats.totalCostUsd.toFixed(4) }}</span>
            </div>
          </div>
          <div class="kpi-card">
            <span class="kpi-icon">📥</span>
            <div class="kpi-info">
              <span class="kpi-label">{{ t('inspector.stats.kpiInput') }}</span>
              <span class="kpi-val">{{ formatNumber(stats.totalInputTokens) }}</span>
            </div>
          </div>
          <div class="kpi-card">
            <span class="kpi-icon">📤</span>
            <div class="kpi-info">
              <span class="kpi-label">{{ t('inspector.stats.kpiOutput') }}</span>
              <span class="kpi-val">{{ formatNumber(stats.totalOutputTokens) }}</span>
            </div>
          </div>
        </div>

        <!-- 角色用量明细排行榜 -->
        <div class="breakdown-section">
          <div class="section-head">
            <span class="head-title">{{ t('inspector.stats.rankTitle') }}</span>
            <span class="head-sub">{{ t('inspector.stats.rankSub') }}</span>
          </div>

          <div v-if="stats.members.length === 0" class="breakdown-empty">
            {{ t('inspector.stats.rankEmpty') }}
          </div>

          <div v-else class="member-cards-list">
            <div
              v-for="m in sortedMembers"
              :key="m.id"
              class="member-stat-card"
              :class="{ 'is-user-card': m.isUser, 'is-system-card': m.id === 'system' || m.adapter === 'System' }"
            >
              <!-- 角色头部 -->
              <div class="card-top">
                <div class="member-badge">
                  <span
                    class="avatar-circle"
                    :style="{ background: m.color || '#64748b' }"
                  >
                    {{ initialsFor(m.name) }}
                  </span>
                  <div class="member-titles">
                    <span class="member-name">{{ m.name }}</span>
                    <span class="adapter-pill">{{ m.adapter }}</span>
                  </div>
                </div>
                <div class="cost-badge" :class="{ free: m.costUsd === 0 }">
                  {{ m.costUsd > 0 ? `$${m.costUsd.toFixed(4)}` : '$0.00' }}
                </div>
              </div>

              <!-- 活跃度与发言份额条 (借鉴 retro.sharePct) -->
              <div class="share-row">
                <div class="share-labels">
                  <span class="share-text">{{ t('inspector.stats.shareLabel') }}</span>
                  <span class="share-num"><b>{{ m.messageCount }}</b> {{ t('inspector.stats.shareUnit') }} ({{ m.sharePct }}%)</span>
                </div>
                <div class="progress-bar-bg">
                  <div
                    class="progress-bar-fill"
                    :style="{
                      width: `${Math.max(4, m.sharePct)}%`,
                      background: m.color || 'var(--accent)',
                    }"
                  ></div>
                </div>
              </div>

              <!-- Token 与性能微矩阵 -->
              <div class="metrics-matrix">
                <div class="metric-item">
                  <span class="m-label">{{ t('inspector.stats.metricInput') }}</span>
                  <span class="m-val">{{ formatNumber(m.inputTokens) }}</span>
                </div>
                <div class="metric-item">
                  <span class="m-label">{{ t('inspector.stats.metricOutput') }}</span>
                  <span class="m-val">{{ formatNumber(m.outputTokens) }}</span>
                </div>
                <div class="metric-item">
                  <span class="m-label">{{ t('inspector.stats.metricAvgDuration') }}</span>
                  <span class="m-val">{{ formatDuration(m.avgDurationMs) }}</span>
                </div>
                <div v-if="m.skips > 0 || m.errors > 0" class="metric-item quality">
                  <span class="m-label">{{ t('inspector.stats.metricSkipsErrors') }}</span>
                  <span class="m-val">{{ m.skips }} / {{ m.errors }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部计费依据说明 -->
        <div class="stats-footer-note">
          <span>{{ t('inspector.stats.footerNote') }}</span>
        </div>
      </template>

      <!-- 完全无数据 -->
      <div v-else class="empty-placeholder">
        <span class="empty-icon">📊</span>
        <p>{{ t('inspector.stats.emptyStats') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inspector-stats-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--panel);
}

/* 顶部操作栏 */
.manage-subbar {
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
  min-width: 0;
}

.meta-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}

.meta-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
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
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 滚动内容区 */
.stats-scroll-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 4格 KPI 卡片 */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.kpi-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--panel-soft);
  border: 1px solid var(--border-soft);
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
}

.kpi-icon {
  font-size: 18px;
  flex-shrink: 0;
}

.kpi-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.kpi-label {
  font-size: 11px;
  color: var(--muted);
  font-weight: 500;
  line-height: 1.2;
}

.kpi-val {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--text);
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kpi-val.cost {
  color: var(--ok);
}

/* 角色明细段落 */
.breakdown-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.head-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text);
}

.head-sub {
  font-size: 11px;
  color: var(--muted);
}

.member-cards-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.member-stat-card {
  padding: 12px;
  border-radius: 8px;
  background: var(--panel-soft);
  border: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 0.15s ease;
}

.member-stat-card:hover {
  border-color: var(--accent-border);
}

.member-stat-card.is-user-card {
  background: var(--panel-softer);
  border-style: dashed;
}

.member-stat-card.is-system-card {
  background: var(--panel-softer);
  opacity: 0.92;
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.member-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.avatar-circle {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  font-weight: 700;
  flex-shrink: 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.member-titles {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.member-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.adapter-pill {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--border-soft);
  color: var(--muted);
  font-weight: 500;
}

.cost-badge {
  font-size: 12px;
  font-weight: 700;
  color: var(--ok);
  background: var(--ok-soft);
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
}

.cost-badge.free {
  color: var(--muted);
  background: var(--border-soft);
  font-weight: 500;
}

/* 份额进度条 */
.share-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.share-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}

.share-text {
  color: var(--muted);
}

.share-num {
  color: var(--text);
}

.progress-bar-bg {
  width: 100%;
  height: 5px;
  background: var(--border-soft);
  border-radius: 3px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

/* 指标矩阵 */
.metrics-matrix {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--border-soft);
}

.metric-item {
  display: flex;
  flex-direction: column;
}

.m-label {
  font-size: 10.5px;
  color: var(--muted);
}

.m-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stats-footer-note {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--panel-softer);
  border: 1px solid var(--border-soft);
}

.stats-error {
  padding: 10px;
  border-radius: 6px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12px;
}

.stats-loading,
.empty-placeholder {
  padding: 30px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
}

.empty-icon {
  font-size: 28px;
}
</style>
