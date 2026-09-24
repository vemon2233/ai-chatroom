<script setup lang="ts">
// 原始流面板(工单11):agentEvent 不加工全量实时展示——JSONL 式滚动。
// 与活动卡片(ActivityCard 渲染后的形态)同屏对比用:验证渲染是否完整/及时。
// 数据:store.rawEvents 环形缓冲(全部房间,按当前房过滤展示)。

import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { store } from '@/store';
import type { AgentEvent } from '@server/adapters/base';

const { t } = useI18n();

const props = defineProps<{
  sessionType: 'room' | 'direct';
  sessionId: string;
}>();

const flowEl = ref<HTMLElement | null>(null);
const paused = ref(false);
const MAX_RENDER = 200;

/** 当前会话的事件(房间按 roomId 过滤;私聊匹配当前角色) */
interface RawRow {
  ts: number;
  line: string;
  kind: 'thinking' | 'tool' | 'text' | 'status';
}

function summarizeEvent(ev: AgentEvent): RawRow | null {
  const ts = Date.now();
  const mk = (kind: RawRow['kind'], line: string): RawRow => ({ ts, kind, line });
  if (ev.phase === 'thinking') {
    if (ev.thinkingDelta) return mk('thinking', ev.thinkingDelta);
    if (ev.toolUse) return mk('tool', `TOOL_USE ${ev.toolUse.name} ${ev.toolUse.input}`);
    if (ev.toolResult) return mk('tool', `TOOL_RESULT ${ev.toolResult.name}\n${ev.toolResult.output}`);
    return mk('status', `phase=thinking${ev.sessionId ? ` sessionId=${ev.sessionId}` : ''}`);
  }
  if (ev.phase === 'streaming' && ev.textDelta) return mk('text', ev.textDelta);
  if (ev.phase === 'streaming') return null;
  if (ev.phase === 'done') return mk('status', `DONE${ev.usage ? ` · in=${ev.usage.inputTokens ?? '?'} out=${ev.usage.outputTokens ?? '?'}${ev.usage.costUsd != null ? ` $${ev.usage.costUsd.toFixed(3)}` : ''}` : ''}`);
  if (ev.phase === 'error') return mk('status', `ERROR ${ev.error ?? ''}`);
  return null;
}

const rows = computed<RawRow[]>(() => {
  const out: RawRow[] = [];
  for (const re of store.rawEvents) {
    if (props.sessionType === 'room' && re.roomId !== props.sessionId) continue;
    // 私聊事件在 directEvent 包里,不经 agentEvent;此面板只服务房间(与 InspectorLogs 的 trace 详情互补)
    const row = summarizeEvent(re.event);
    if (row) out.push(row);
  }
  return out.slice(-MAX_RENDER);
});

const hiddenCount = computed(() => Math.max(0, store.rawEvents.length - rows.value.length));

/** 跟随滚动:贴底时自动滚到底;paused(用户上翻)不打扰 */
function isNearBottom(): boolean {
  const el = flowEl.value;
  if (!el) return true;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
}

watch(
  () => rows.value.length,
  async () => {
    if (paused.value) return;
    await nextTick();
    if (flowEl.value && isNearBottom()) flowEl.value.scrollTop = flowEl.value.scrollHeight;
  },
);

function resume() {
  paused.value = false;
  nextTick(() => { if (flowEl.value) flowEl.value.scrollTop = flowEl.value.scrollHeight; });
}

function clearRaw() {
  store.rawEvents = [];
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}
</script>

<template>
  <div class="tab-content raw-panel">
    <div class="raw-head">
      <span class="raw-title">{{ t('inspector.raw.title') }}</span>
      <span class="raw-hint">{{ t('inspector.raw.hint') }}</span>
      <div class="raw-actions">
        <button v-if="paused" class="btn btn-ghost raw-btn" @click="resume">⏵ {{ t('inspector.raw.resume') }}</button>
        <span v-else class="live-dot">●</span>
        <button class="btn btn-ghost raw-btn" @click="clearRaw">{{ t('inspector.raw.clear') }}</button>
      </div>
    </div>

    <div
      ref="flowEl"
      class="raw-flow"
      @scroll="paused = flowEl ? !(flowEl.scrollTop + flowEl.clientHeight >= flowEl.scrollHeight - 40) : false"
    >
      <div v-if="rows.length === 0" class="raw-empty">{{ t('inspector.raw.empty') }}</div>
      <div v-for="(r, i) in rows" :key="`${r.ts}-${i}`" class="raw-row" :class="r.kind">
        <span class="raw-ts">{{ fmtTime(r.ts) }}</span>
        <pre class="raw-line">{{ r.line }}</pre>
      </div>
      <div v-if="hiddenCount > 0" class="raw-hidden">…{{ t('inspector.raw.hidden', { n: hiddenCount }) }}</div>
    </div>
  </div>
</template>

<style scoped>
.raw-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.raw-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-soft);
  flex-wrap: wrap;
}

.raw-title { font-size: 13px; font-weight: 600; color: var(--text); }
.raw-hint { font-size: 11px; color: var(--faint); flex: 1; min-width: 120px; }

.raw-actions { display: flex; align-items: center; gap: 6px; }
.raw-btn { font-size: 11.5px; padding: 3px 8px; }

.live-dot {
  color: #4caf7d;
  font-size: 10px;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.raw-flow {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.5;
}

.raw-empty { color: var(--faint); text-align: center; padding: 30px 0; font-family: inherit; }

.raw-row {
  display: flex;
  gap: 8px;
  padding: 1px 0;
  align-items: baseline;
}

.raw-ts {
  flex-shrink: 0;
  color: var(--faint);
  font-size: 10px;
}

.raw-line {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--muted);
  font-family: inherit;
  font-size: inherit;
}

/* 分色:思考/工具/正文/状态(claude CLI 灰字风格) */
.raw-row.thinking .raw-line { color: var(--faint); }
.raw-row.tool .raw-line { color: #d08770; }
.raw-row.text .raw-line { color: var(--text); }
.raw-row.status .raw-line { color: #4caf7d; font-weight: 600; }

.raw-hidden { color: var(--faint); text-align: center; padding: 6px 0; }
</style>
