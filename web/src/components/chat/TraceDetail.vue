<script setup lang="ts">
// 工作过程详情(工单13 改版):"过程"tab 由文字列表替换为 ActivityCard 回放
// (与进行中活动卡片同一视觉:三态点/红绿 diff/输出折叠);thinking/usage tab 保留。
// 数据:detail.trace 经 traceToActivities 转换(thinking 聚段/工具带原参数/顺序配对)。

import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ChatMessage } from '@server/core/types';
import ActivityCard from './ActivityCard.vue';
import { traceToActivities } from '@/utils/traceToActivity';
import type { StreamBuf } from '@/store';

const { t } = useI18n();

const props = defineProps<{ detail: NonNullable<ChatMessage['detail']> }>();

const tab = ref<'trace' | 'thinking' | 'usage'>('trace');
const hasTrace = computed(() => (props.detail.trace?.length ?? 0) > 0);
const hasThinking = computed(() => !!props.detail.thinking);

/** 过程摘要行(工具计数 + 耗时) */
const procSummary = computed(() => {
  const trace = props.detail.trace ?? [];
  const counts = new Map<string, number>();
  let steps = 0;
  for (const e of trace) {
    if (e.kind !== 'tool_use') continue;
    steps++;
    const name = (e.label ?? 'tool').split(':')[0]!;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const parts = Array.from(counts.entries()).map(([n, c]) => `${n} ×${c}`);
  return { steps, parts: parts.slice(0, 4).join(' · '), durationMs: props.detail.durationMs };
});

/** 回放缓冲(ActivityCard 最终态) */
const replayBuf = computed<StreamBuf>(() => ({
  text: '',
  thinking: '',
  events: traceToActivities(props.detail.trace ?? []),
  startedAt: 0,
}));

function fmtDuration(ms?: number): string {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

if (!hasTrace.value && hasThinking.value) tab.value = 'thinking';
if (!hasTrace.value && !hasThinking.value) tab.value = 'usage';
</script>

<template>
  <div class="detail" @click.stop>
    <div class="tabs">
      <span v-if="hasTrace" :class="{ on: tab === 'trace' }" @click="tab = 'trace'">{{ t('chat.tabTrace') }}</span>
      <span v-if="hasThinking" :class="{ on: tab === 'thinking' }" @click="tab = 'thinking'">{{ t('chat.tabThinking') }}</span>
      <span :class="{ on: tab === 'usage' }" @click="tab = 'usage'">{{ t('chat.tabUsage') }}</span>
    </div>

    <!-- 过程 tab:ActivityCard 回放(与进行中同视觉) -->
    <div v-if="tab === 'trace' && hasTrace">
      <div class="proc-meta">
        <span>{{ t('chat.procSteps', { steps: procSummary.steps }) }}</span>
        <span v-if="procSummary.parts">🔧 {{ procSummary.parts }}</span>
        <span v-if="procSummary.durationMs">⏱ {{ fmtDuration(procSummary.durationMs) }}</span>
      </div>
      <ActivityCard :buf="replayBuf" status="idle" />
    </div>

    <pre v-else-if="tab === 'thinking' && hasThinking" class="block">{{ detail.thinking }}</pre>

    <pre v-else class="block">{{ JSON.stringify({
      trigger: detail.trigger,
      usage: detail.usage,
      durationMs: detail.durationMs,
      adapter: detail.adapter,
    }, null, 2) }}</pre>
  </div>
</template>

<style scoped>
.detail {
  margin-top: 9px;
  border-top: 1px dashed var(--border);
  padding-top: 8px;
  font-size: 12px;
  color: var(--muted);
}

.tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 6px;
}

.tabs span {
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11.5px;
}

.tabs span.on {
  background: var(--accent-soft);
  color: var(--text);
  font-weight: 600;
}

.proc-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 11px;
  margin-bottom: 6px;
  color: var(--muted);
}

.block {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  line-height: 1.5;
  margin: 0;
}
</style>
