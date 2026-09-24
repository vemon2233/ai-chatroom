<script setup lang="ts">
// 活动卡片(工单10 v2,按用户定案改版):运行中=原始流全量呈现(思考全文/全部工具调用
// 与输出/正文,按时间序,无时间戳);状态条(耗时/估算tok/工具计数)置底。
// 运行结束由 MessageBubble 切回正文 markdown 渲染(过程进 detail.trace 可展开)。

import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { StreamBuf } from '@/store';

const { t } = useI18n();

const props = withDefaults(defineProps<{
  buf: StreamBuf;
  /** 成员状态(thinking=纯思考期;streaming=正文已流出) */
  status: 'idle' | 'thinking' | 'streaming' | 'error';
}>(), { status: 'thinking' });

// 进行中耗时:每秒跳动
const nowTick = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = setInterval(() => { nowTick.value = Date.now(); }, 1000);
onBeforeUnmount(() => { if (timer) clearInterval(timer); timer = null; });

const elapsed = computed(() => {
  const started = props.buf.startedAt ?? 0;
  if (!started) return '';
  const s = Math.floor((nowTick.value - started) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
});

/** 估算 token:已产出字符(思考+正文+工具内容)粗除 3.5,标"~" */
const estTokens = computed(() => {
  const chars = props.buf.thinking.length + props.buf.text.length
    + (props.buf.events ?? []).reduce((n, e) => n + e.content.length, 0);
  if (chars < 200) return '';
  return `~${Math.round(chars / 3.5 / 1000)}k tok`;
});

/** 工具计数(Bash ×3 · Read ×5 式) */
const toolCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const e of props.buf.events ?? []) {
    if (e.kind !== 'tool_use') continue;
    const name = e.label.split(':')[0]!;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([name, n]) => `${name} ×${n}`);
});

// ---------- 全量过程行(原始流同构,无时间戳) ----------

/** 过程行:思考段/工具调用/工具输出/正文按到达序(正文置尾——正文即最终答复,工具必在其前) */
interface ProcRow { kind: 'thinking' | 'tool_use' | 'tool_result' | 'text'; content: string; label?: string }

const procRows = computed<ProcRow[]>(() => {
  const rows: ProcRow[] = (props.buf.events ?? []).map((e) => ({
    kind: e.kind,
    label: e.label || undefined,
    content: e.content,
  }));
  // 现行思考段(工具之后的最新思考,尚未落盘为 event)
  const nowThinking = props.buf.thinking.trim();
  if (nowThinking) rows.push({ kind: 'thinking', content: nowThinking });
  // 正文(增量累积,置尾)
  if (props.buf.text.trim()) rows.push({ kind: 'text', content: props.buf.text });
  return rows;
});

const isRunning = computed(() => props.status === 'thinking' || props.status === 'streaming');
</script>

<template>
  <div class="activity-card">
    <!-- 全量过程行(原始流同构:思考灰/工具橙/工具输出暗/正文正常;无时间戳) -->
    <div v-if="procRows.length" class="proc-list">
      <div v-for="(r, i) in procRows" :key="i" class="proc-row" :class="r.kind">
        <span v-if="r.kind === 'tool_use'" class="proc-mark">▸</span>
        <span v-else-if="r.kind === 'tool_result'" class="proc-mark">✓</span>
        <span v-if="r.kind === 'tool_use'" class="proc-label">{{ r.label }}</span>
        <pre class="proc-content">{{ r.kind === 'tool_use' ? r.content : r.content }}</pre>
      </div>
    </div>
    <!-- 无任何过程时的启动占位 -->
    <div v-else class="proc-empty">{{ t('chat.startingText') }}</div>

    <!-- 状态条(定案:置底) -->
    <div v-if="isRunning" class="status-line">
      <span class="status-chip" :class="status">
        {{ status === 'streaming' ? t('activity.streaming') : t('activity.thinking') }}
      </span>
      <span v-if="elapsed" class="metric">⏱ {{ elapsed }}</span>
      <span v-if="estTokens" class="metric dim">{{ estTokens }}</span>
      <span v-if="toolCounts.length" class="metric dim">🔧 {{ toolCounts.slice(0, 3).join(' · ') }}</span>
    </div>
  </div>
</template>

<style scoped>
.activity-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}

/* 全量过程列表 */
.proc-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.proc-empty { color: var(--faint); font-size: 12px; }

.proc-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
  min-width: 0;
}

.proc-mark { flex-shrink: 0; color: var(--accent); font-size: 11px; }
.proc-row.tool_result .proc-mark { color: #4caf7d; }

.proc-label {
  flex-shrink: 0;
  font-weight: 600;
  font-size: 11.5px;
  color: var(--text);
  opacity: 0.85;
}

.proc-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11.5px;
  line-height: 1.5;
  min-width: 0;
}

/* 分色(原始流同款):思考灰/工具调用橙/工具输出暗橙/正文正常 */
.proc-row.thinking .proc-content { color: var(--faint); }
.proc-row.tool_use .proc-content { color: #d08770; font-family: ui-monospace, Consolas, monospace; font-size: 11px; }
.proc-row.tool_result .proc-content { color: #b07a5e; font-family: ui-monospace, Consolas, monospace; font-size: 11px; opacity: 0.85; }
.proc-row.text .proc-content { color: var(--text); font-size: 13px; }

/* 状态条(置底) */
.status-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12px;
  border-top: 1px solid var(--border-soft);
  padding-top: 6px;
}

.status-chip {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11.5px;
  font-weight: 600;
}

.status-chip.thinking {
  background: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
}

.status-chip.streaming {
  background: rgba(76, 175, 125, 0.12);
  color: #4caf7d;
}

.metric { color: var(--muted); font-variant-numeric: tabular-nums; }
.metric.dim { opacity: 0.75; }
</style>
