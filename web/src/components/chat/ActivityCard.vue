<script setup lang="ts">
// 活动卡片 v3(工单12,对齐 claude CLI 视觉):
//  - 思考:灰色斜体全文(CLI ∴ Thinking 的 web 等价;用户已定全量)
//  - 工具行三态:执行中呼吸紫点 / 完成实心绿点(CLI ToolUseLoader)
//  - 正在执行的工具行高亮(一眼看出在跑哪个)
//  - Edit 工具:红绿行级 diff + "Added N lines, removed M lines" 摘要
//  - 工具输出:默认 3 行预览 + "+M 行"折叠计数,点击展开(CLI MAX_LINES_TO_SHOW=3)
//  - 状态条置底:耗时实时;估算 token 30s 后才显示(CLI SHOW_TOKENS_AFTER_MS);
//    3s 无新事件显示"无新输出"提示(CLI stalled 检测)
// 运行结束由 MessageBubble 切回正文 markdown(过程进 detail.trace)。

import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ActivityItem, StreamBuf } from '@/store';
import { buildEditDiff, foldOutput, type DiffLine } from '@/utils/diffView';

const { t } = useI18n();

const props = withDefaults(defineProps<{
  buf: StreamBuf;
  status: 'idle' | 'thinking' | 'streaming' | 'error';
}>(), { status: 'thinking' });

// ---------- 计时器(1s 跳动) ----------
const nowTick = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = setInterval(() => { nowTick.value = Date.now(); }, 1000);
onBeforeUnmount(() => { if (timer) clearInterval(timer); timer = null; });

const elapsedMs = computed(() => (props.buf.startedAt ? nowTick.value - props.buf.startedAt : 0));

const elapsed = computed(() => {
  const s = Math.floor(elapsedMs.value / 1000);
  if (!s) return '';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
});

/** 卡顿检测(CLI useStalledAnimation 同语义):思考中且 3s 无新事件(流式思考/正文=活) */
const stalled = computed(() => {
  if (props.status !== 'thinking') return false;
  const flowing = !!(props.buf.thinking || props.buf.text);
  if (flowing) return false;
  const evs = props.buf.events ?? [];
  const last = evs[evs.length - 1]?.ts ?? props.buf.startedAt ?? 0;
  return last > 0 && nowTick.value - last > 3000;
});

/** 估算 token:30s 后才显示(CLI SHOW_TOKENS_AFTER_MS=30_000) */
const SHOW_TOKENS_AFTER_MS = 30_000;
const estTokens = computed(() => {
  if (elapsedMs.value < SHOW_TOKENS_AFTER_MS) return '';
  const chars = props.buf.thinking.length + props.buf.text.length
    + (props.buf.events ?? []).reduce((n, e) => n + e.content.length, 0);
  if (chars < 500) return '';
  return `~${Math.round(chars / 3.5 / 1000)}k tok`;
});

/** 工具计数(Bash ×3 · Read ×5) */
const toolCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const e of props.buf.events ?? []) {
    if (e.kind !== 'tool_use') continue;
    const name = e.label.split(':')[0]!;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([name, n]) => `${name} ×${n}`);
});

// ---------- 渲染模型(一次性预处理,模板零重复计算) ----------

interface ToolRowVM {
  key: string;
  name: string;
  args: string;
  state: 'running' | 'done';
  /** Edit/Write 的 diff 视图(仅编辑类工具) */
  diff?: { lines: DiffLine[]; added: number; removed: number };
  /** 配对的结果(展开态渲染) */
  result?: { key: string; full: string; preview: string; hidden: number };
}

interface RowVM {
  kind: 'thinking' | 'tool' | 'text';
  text?: string;
  tool?: ToolRowVM;
}

const OUTPUT_PREVIEW_LINES = 3;

/** 解析 tool_use 的 JSON 参数 */
function parseRaw(e: ActivityItem): Record<string, unknown> | null {
  if (!e.raw) return null;
  try { return JSON.parse(e.raw); } catch { return null; }
}

const rows = computed<RowVM[]>(() => {
  const evs = props.buf.events ?? [];
  const resolved = new Set<string>();
  for (const e of evs) {
    if (e.kind === 'tool_result' && e.id) resolved.add(e.id);
  }

  const out: RowVM[] = [];
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i]!;
    if (e.kind === 'thinking') {
      out.push({ kind: 'thinking', text: e.content });
      continue;
    }
    if (e.kind !== 'tool_use') continue; // tool_result 经配对并入 tool 行

    const state: 'running' | 'done' = e.id && !resolved.has(e.id) ? 'running' : 'done';
    const vm: ToolRowVM = {
      key: e.id ?? `t${i}`,
      name: e.label,
      args: e.content,
      state,
    };

    // Edit/Write → 红绿 diff
    if (e.label === 'Edit' || e.label === 'Write') {
      const raw = parseRaw(e);
      if (raw) {
        const oldS = typeof raw.old_string === 'string' ? raw.old_string : '';
        const newS = typeof raw.new_string === 'string' ? raw.new_string
          : typeof raw.content === 'string' ? raw.content : '';
        vm.diff = buildEditDiff(oldS, newS);
      }
    }

    // 配对结果(有 id 精确配对;无 id 退化取下一条 tool_result)
    const result = e.id
      ? evs.find((x) => x.kind === 'tool_result' && x.id === e.id)
      : evs.slice(i + 1).find((x) => x.kind === 'tool_result');
    if (result && result.content.trim()) {
      const f = foldOutput(result.content, OUTPUT_PREVIEW_LINES);
      vm.result = { key: vm.key, full: result.content, preview: f.preview, hidden: f.hidden };
    }

    out.push({ kind: 'tool', tool: vm });
  }

  const nowThinking = props.buf.thinking.trim();
  if (nowThinking) out.push({ kind: 'thinking', text: nowThinking });
  if (props.buf.text.trim()) out.push({ kind: 'text', text: props.buf.text });
  return out;
});

// 展开态(按行 key)
const expanded = ref(new Set<string>());
function toggleExpand(key: string) {
  const s = new Set(expanded.value);
  if (s.has(key)) s.delete(key); else s.add(key);
  expanded.value = s;
}

const isRunning = computed(() => props.status === 'thinking' || props.status === 'streaming');
</script>

<template>
  <div class="activity-card">
    <div v-if="rows.length" class="proc-list">
      <template v-for="(r, i) in rows" :key="i">
        <!-- 思考段:灰色斜体全文(CLI ∴ Thinking) -->
        <div v-if="r.kind === 'thinking'" class="think-block">
          <span class="think-mark">∴</span>
          <pre class="think-text">{{ r.text }}</pre>
        </div>

        <!-- 正文 -->
        <pre v-else-if="r.kind === 'text'" class="text-out">{{ r.text }}</pre>

        <!-- 工具行 -->
        <template v-else-if="r.tool">
          <div class="tool-line" :class="r.tool.state">
            <span class="dot" :class="r.tool.state"></span>
            <span class="tool-name">{{ r.tool.name }}</span>
            <span v-if="r.tool.args && !r.tool.diff" class="tool-args">{{ r.tool.args }}</span>
            <span v-if="r.tool.diff" class="edit-summary">
              +{{ r.tool.diff.added }} <span class="rm">−{{ r.tool.diff.removed }}</span>
            </span>
          </div>

          <!-- Edit/Write 红绿 diff -->
          <div v-if="r.tool.diff" class="diff-block" :class="{ dimmed: r.tool.state === 'running' }">
            <div
              v-for="(dl, di) in r.tool.diff.lines"
              :key="di"
              class="diff-line"
              :class="dl.kind"
            >
              <pre class="diff-text">{{ dl.kind === 'remove' ? '− ' : dl.kind === 'add' ? '+ ' : '  ' }}{{ dl.text }}</pre>
            </div>
          </div>

          <!-- 结果:3 行预览 + 折叠(点击展开) -->
          <div
            v-if="r.tool.result"
            class="result-block"
            @click="toggleExpand(r.tool.result.key)"
          >
            <pre class="result-text">{{
              expanded.has(r.tool.result.key) ? r.tool.result.full : r.tool.result.preview
            }}</pre>
            <div v-if="r.tool.result.hidden > 0" class="fold-hint">
              {{ expanded.has(r.tool.result.key)
                ? t('activity.foldUp')
                : t('activity.foldDown', { n: r.tool.result.hidden }) }}
            </div>
          </div>
        </template>
      </template>
    </div>
    <div v-else class="proc-empty">{{ t('chat.startingText') }}</div>

    <!-- 状态条(置底) -->
    <div v-if="isRunning" class="status-line">
      <span class="status-chip" :class="stalled ? 'stalled' : status">
        {{ stalled ? t('activity.stalled') : (status === 'streaming' ? t('activity.streaming') : t('activity.thinking')) }}
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

.proc-list { display: flex; flex-direction: column; gap: 5px; }
.proc-empty { color: var(--faint); font-size: 12px; }

/* 思考:灰色斜体(CLI ∴ Thinking dim italic) */
.think-block {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.think-mark { color: var(--faint); font-size: 12px; flex-shrink: 0; }

.think-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--faint);
  font-style: italic;
  font-size: 11.5px;
  line-height: 1.55;
}

/* 正文 */
.text-out {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text);
  font-size: 13px;
  line-height: 1.6;
}

/* 工具行:三态点 */
.tool-line {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 1px 0;
}

.tool-line.running {
  background: linear-gradient(90deg, rgba(139, 92, 246, 0.08), transparent 70%);
  border-radius: 4px;
  padding: 2px 4px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot.running {
  background: #8b5cf6;
  animation: breathe 1.2s ease-in-out infinite;
}

.dot.done { background: #4caf7d; }

@keyframes breathe {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.8); }
}

.tool-name {
  flex-shrink: 0;
  font-weight: 700;
  font-size: 11.5px;
  color: var(--text);
}

.tool-args {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  color: var(--muted);
}

.edit-summary {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: #4caf7d;
}

.edit-summary .rm { color: #d45a5a; }

/* Edit 红绿 diff */
.diff-block {
  margin: 1px 0 2px 15px;
  border-radius: 4px;
  overflow: hidden;
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
}

.diff-block.dimmed { opacity: 0.6; }

.diff-line { padding: 0 6px; }

.diff-line .diff-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
}

.diff-line.add { background: rgba(76, 175, 125, 0.14); }
.diff-line.add .diff-text { color: #2e7d5b; }

.diff-line.remove { background: rgba(212, 90, 90, 0.12); }
.diff-line.remove .diff-text { color: #a54848; }

.diff-line.context .diff-text { color: var(--muted); }

/* 工具结果:预览 + 折叠 */
.result-block {
  margin: 0 0 2px 15px;
  padding: 4px 6px 2px;
  border-radius: 4px;
  background: var(--panel-softer, rgba(127, 127, 127, 0.06));
  cursor: pointer;
}

.result-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--muted);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 10.5px;
  line-height: 1.45;
}

.fold-hint {
  color: var(--accent);
  font-size: 10.5px;
  padding: 2px 0;
  user-select: none;
}

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

.status-chip.thinking { background: rgba(139, 92, 246, 0.12); color: #8b5cf6; }
.status-chip.streaming { background: rgba(76, 175, 125, 0.12); color: #4caf7d; }
.status-chip.stalled { background: rgba(212, 90, 90, 0.15); color: #d45a5a; animation: breathe 1s ease-in-out infinite; }

.metric { color: var(--muted); font-variant-numeric: tabular-nums; }
.metric.dim { opacity: 0.75; }
</style>
