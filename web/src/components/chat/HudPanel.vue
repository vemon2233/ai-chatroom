<script setup lang="ts">
// 任务 HUD 小面板(工单14):输入框上方右缘迷你条(费用/耗时常显)+
// 点击上弹仪表(模型/权限/累计与本次耗时/费用token/工具计数/session 轮次)。
// 数据:stats 端点落库聚合 + 活动缓冲实时叠加(进行中耗时/工具计数即时);
// 不动后端。房间与私聊通用(数据端点各一)。

import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { store } from '@/store';
import { api } from '@/services/api';
import type { SessionStats } from '@server/core/types';

const { t } = useI18n();

const props = defineProps<{
  mode: 'room' | 'direct';
  /** 渲染部件:bar=小条(容器横排一行)/ panel=弹层面板(容器共享弹层列堆叠) */
  part?: 'bar' | 'panel';
}>();

const open = defineModel<boolean>('open', { default: false });
const stats = ref<SessionStats | null>(null);

// ---------- 数据拉取(进房/落库消息数变化时刷新) ----------
const sessionId = computed(() =>
  props.mode === 'room' ? store.currentRoom?.config.id : store.currentDirectChar?.id,
);
const msgCount = computed(() =>
  props.mode === 'room' ? store.messages.length : store.directMessages.length,
);

async function refresh() {
  const id = sessionId.value;
  if (!id) return;
  try {
    stats.value = props.mode === 'room' ? await api.roomStats(id) : await api.directStats(id);
  } catch {
    stats.value = null;
  }
}

// git 状态(HUD 工单15:分支+脏标记;仅任务房/绑项目房)
const gitInfo = ref<{ branch: string; dirty: boolean } | null>(null);
const roomProject = computed(() => store.currentRoom?.config.projectPath);

async function refreshGit() {
  const id = store.currentRoom?.config.id;
  if (!id || props.mode !== 'room' || !roomProject.value) { gitInfo.value = null; return; }
  try {
    const r = await api.roomGit(id);
    gitInfo.value = r.git;
  } catch {
    gitInfo.value = null;
  }
}

// 展开时刷新 git(脏状态实时性);进房也刷一次
watch([sessionId, open], () => { if (open.value) void refreshGit(); }, { immediate: true });
watch(sessionId, () => { void refreshGit(); });

watch([sessionId, msgCount], () => { void refresh(); }, { immediate: true });

// ---------- 进行中实时叠加(活动缓冲:本次耗时/工具计数) ----------
const liveBuf = computed(() => {
  if (props.mode === 'room') {
    // 任一成员生成中:取其缓冲(任务房单成员即唯一;多成员取首个活跃)
    for (const m of store.currentRoom?.config.members ?? []) {
      const s = store.currentRoom?.statuses[m.id];
      const b = store.memberStream[m.id];
      if ((s === 'thinking' || s === 'streaming') && b) return b;
    }
    return null;
  }
  const gen = store.directStatus === 'thinking' || store.directStatus === 'streaming';
  return gen ? store.directStream : null;
});

const nowTick = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;
watch(liveBuf, (b) => {
  if (b && !timer) timer = setInterval(() => { nowTick.value = Date.now(); }, 1000);
  else if (!b && timer) { clearInterval(timer); timer = null; }
}, { immediate: true });

/** 本次(进行中)耗时 */
const liveElapsed = computed(() => {
  const b = liveBuf.value;
  if (!b?.startedAt) return '';
  return fmtDuration(nowTick.value - b.startedAt);
});

/** 本次工具计数(实时) */
const liveTools = computed(() => {
  const counts = new Map<string, number>();
  for (const e of liveBuf.value?.events ?? []) {
    if (e.kind !== 'tool_use') continue;
    const n = e.label.split(':')[0]!;
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return Array.from(counts.entries());
});

// ---------- 聚合呈现 ----------
const PERM_KEY: Record<string, string> = { readonly: 'hud.permReadonly', readwrite: 'hud.permReadwrite', full: 'hud.permFull' };

const roomCfg = computed(() => store.currentRoom?.config);
/** 模型名:成员 extraArgs 的 --model;无则"默认" */
const modelName = computed(() => {
  const m = props.mode === 'room' ? roomCfg.value?.members[0] : store.currentDirectChar;
  const args = m?.extraArgs ?? [];
  const i = args.indexOf('--model');
  return (i >= 0 && args[i + 1]) ? args[i + 1]! : t('hud.modelDefault');
});
const adapterName = computed(() =>
  props.mode === 'room' ? roomCfg.value?.members[0]?.adapter : store.currentDirectChar?.adapter);

/** 累计耗时(stats 端点 avgDuration×count 不可靠——落库消息 durationMs 求和更准,端点没给;
 *  用 totalTokens/cost 之外的折中:消息流 detail.durationMs 前端聚合) */
const totalDurationMs = computed(() => {
  const msgs = props.mode === 'room' ? store.messages : store.directMessages;
  return msgs.reduce((n, m) => n + (m.detail?.durationMs ?? 0), 0);
});

const totalCost = computed(() => stats.value?.totalCostUsd ?? 0);
const totalTokens = computed(() => stats.value?.totalTokens ?? 0);

/** 工具计数(落库 trace 聚合 + 实时叠加) */
const toolCounts = computed(() => {
  const counts = new Map<string, number>();
  const msgs = props.mode === 'room' ? store.messages : store.directMessages;
  for (const m of msgs) {
    for (const e of m.detail?.trace ?? []) {
      if (e.kind !== 'tool_use') continue;
      const n = (e.label ?? 'tool').split(':')[0]!;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }
  for (const [n, c] of liveTools.value) counts.set(n, (counts.get(n) ?? 0) + c);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
});

/** stateful session 轮次:agent 成功发言条数 */
const sessionTurns = computed(() => {
  const msgs = props.mode === 'room' ? store.messages : store.directMessages;
  return msgs.filter((m) => m.from !== 'user' && m.from !== 'system' && m.from !== 'scout').length;
});

// ---------- Context 占比估算(工单15:末次发言的 input+cacheRead ÷ 窗口) ----------
/** 上下文窗口:模型名含 [1m]/1m → 1M,否则 200k(保守查表;显示"估算") */
function contextWindow(model: string | undefined): number {
  const m = (model ?? '').toLowerCase();
  if (m.includes('[1m]') || m.includes('1m')) return 1_000_000;
  return 200_000;
}

const contextPct = computed<number | null>(() => {
  const msgs = props.mode === 'room' ? store.messages : store.directMessages;
  // 末条带 usage 的 agent 消息(stateful 语义:session 现存上下文)
  for (let i = msgs.length - 1; i >= 0; i--) {
    const u = msgs[i]?.detail?.usage;
    if (!u) continue;
    const used = (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0);
    if (used <= 0) return null;
    const pct = Math.min(100, Math.round((used / contextWindow(modelName.value)) * 100));
    return pct;
  }
  return null;
});

/** 项目尾段名(git 行展示) */
const projName = computed(() => {
  const p = roomProject.value;
  return p ? p.split(/[\\/]/).filter(Boolean).pop() ?? '' : '';
});

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}
</script>

<template>
  <!-- 部件式渲染(工单17:容器统一布局——条横排一行,面板共享弹层列) -->
  <template v-if="part === 'bar'">
    <button class="hud-mini" :class="{ on: open }" @click="open = !open" :title="t('hud.title')">
      <span v-if="liveElapsed" class="mini-live">▶ {{ liveElapsed }}</span>
      <span class="mini-cost">${{ totalCost.toFixed(2) }}</span>
      <span class="mini-dur">{{ fmtDuration(totalDurationMs) }}</span>
    </button>
  </template>

  <div v-else class="hud-panel">
        <div class="hud-head">
          <span class="hud-title">{{ t('hud.title') }}</span>
          <button class="hud-close" @click="open = false">✕</button>
        </div>

        <!-- Context 占比(末次发言估算,工单15) -->
        <div v-if="contextPct != null" class="ctx-row">
          <div class="ctx-bar"><div class="ctx-fill" :class="{ warn: contextPct >= 80 }" :style="{ width: `${contextPct}%` }"></div></div>
          <span class="ctx-pct">Context {{ contextPct }}% <span class="ctx-est">~</span></span>
        </div>

        <!-- git 分支+脏状态(绑项目房) -->
        <div v-if="gitInfo && projName" class="hud-row">
          <span class="hud-k">🌿</span>
          <span class="hud-v mono">{{ projName }} <span class="git-branch">git:({{ gitInfo.branch }}<span v-if="gitInfo.dirty" class="git-dirty">*</span>)</span></span>
        </div>

        <div class="hud-row">
          <span class="hud-k">⚡</span>
          <span class="hud-v">{{ adapterName }}<template v-if="modelName"> · {{ modelName }}</template></span>
          <span v-if="props.mode === 'room' && roomCfg" class="hud-pill" :class="roomCfg.toolPermission">
            {{ t(PERM_KEY[roomCfg.toolPermission] ?? 'hud.permReadonly') }}
          </span>
        </div>

        <div class="hud-row">
          <span class="hud-k">⏱</span>
          <span class="hud-v">{{ t('hud.total') }} {{ fmtDuration(totalDurationMs) }}</span>
          <span v-if="liveElapsed" class="hud-live">▶ {{ t('hud.current') }} {{ liveElapsed }}</span>
        </div>

        <div class="hud-row">
          <span class="hud-k">💰</span>
          <span class="hud-v">${{ totalCost.toFixed(3) }} · {{ fmtTokens(totalTokens) }} tok</span>
        </div>

        <div v-if="toolCounts.length" class="hud-row">
          <span class="hud-k">🔧</span>
          <span class="hud-v tools">
            <span v-for="([n, c]) in toolCounts.slice(0, 6)" :key="n" class="tool-chip">{{ n }} ×{{ c }}</span>
          </span>
        </div>

        <div class="hud-row">
          <span class="hud-k">📜</span>
          <span class="hud-v">{{ t('hud.turns', { n: sessionTurns }) }}</span>
        </div>
      </div>
</template>

<style scoped>
/* 迷你条:容器横排一行中的一员(工单17 统一样式协议) */
.hud-mini {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s, color 0.15s;
  white-space: nowrap;
}

.hud-mini:hover, .hud-mini.on {
  border-color: var(--accent);
  color: var(--text);
}

.mini-live { color: #8b5cf6; font-weight: 600; animation: hud-breathe 1.5s ease-in-out infinite; }

.mini-cost { font-weight: 600; color: var(--text); }

@keyframes hud-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

/* 面板:宽度/圆角/阴影统一协议(定位由容器弹层列负责) */
.hud-panel {
  width: 300px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.hud-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-soft);
}

.hud-title { font-size: 12px; font-weight: 700; color: var(--text); }

.hud-close {
  border: none; background: transparent; color: var(--faint);
  font-size: 12px; cursor: pointer; padding: 2px 4px; border-radius: 4px;
}
.hud-close:hover { color: var(--text); background: var(--hover); }

.hud-row { display: flex; align-items: baseline; gap: 8px; font-size: 11.5px; }
.hud-k { flex-shrink: 0; width: 16px; }
.hud-v { color: var(--text); }

.hud-live { color: #8b5cf6; font-weight: 600; font-variant-numeric: tabular-nums; }

.hud-pill {
  margin-left: auto;
  padding: 1px 7px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
}
.hud-pill.full { background: rgba(212, 90, 90, 0.12); color: #c05050; }
.hud-pill.readwrite { background: rgba(230, 170, 60, 0.14); color: #b8862e; }
.hud-pill.readonly { background: rgba(127, 127, 127, 0.14); color: var(--muted); }

.tools { display: flex; flex-wrap: wrap; gap: 4px; }
.tool-chip {
  background: var(--panel-softer, rgba(127, 127, 127, 0.08));
  border-radius: 5px;
  padding: 1px 6px;
  font-size: 10.5px;
}

/* Context 占比条 */
.ctx-row { display: flex; align-items: center; gap: 8px; }
.ctx-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: rgba(127, 127, 127, 0.15);
  overflow: hidden;
}
.ctx-fill {
  height: 100%;
  border-radius: 3px;
  background: #4caf7d;
  transition: width 0.3s ease;
}
.ctx-fill.warn { background: #d4903c; }
.ctx-pct { font-size: 10.5px; color: var(--muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.ctx-est { opacity: 0.6; }

/* git 行 */
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 11px; }
.git-branch { color: var(--accent); }
.git-dirty { color: #d4903c; font-weight: 700; }

/* 弹出动画 */
</style>
