<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ChatMessage } from '@server/core/types';

const props = defineProps<{ detail: NonNullable<ChatMessage['detail']> }>();

const tab = ref<'trace' | 'thinking' | 'usage'>('trace');
const hasTrace = computed(() => (props.detail.trace?.length ?? 0) > 0);
const hasThinking = computed(() => !!props.detail.thinking);

const collapsed = ref(true);
const COLLAPSE_AT = 12;

const visibleTrace = computed(() => {
  const trace = props.detail.trace ?? [];
  if (!collapsed.value || trace.length <= COLLAPSE_AT) return trace;
  return trace.slice(-8);
});

const ICON: Record<string, string> = { thinking: '💭', tool_use: '🛠', tool_result: '📋', text: '✍️' };
const LABEL: Record<string, string> = { thinking: '思考', tool_use: '工具调用', tool_result: '结果', text: '正文' };

if (!hasTrace.value && hasThinking.value) tab.value = 'thinking';
if (!hasTrace.value && !hasThinking.value) tab.value = 'usage';
</script>

<template>
  <div class="detail" @click.stop>
    <div class="tabs">
      <span v-if="hasTrace" :class="{ on: tab === 'trace' }" @click="tab = 'trace'">工作过程</span>
      <span v-if="hasThinking" :class="{ on: tab === 'thinking' }" @click="tab = 'thinking'">思考全文</span>
      <span :class="{ on: tab === 'usage' }" @click="tab = 'usage'">用量</span>
    </div>

    <!-- 工作过程时间线 -->
    <div v-if="tab === 'trace' && hasTrace" class="trace-line">
      <div
        v-if="collapsed && (detail.trace?.length ?? 0) > 8"
        class="trace-toggle"
        @click="collapsed = false"
      >
        ⋯ 展开全部 {{ detail.trace!.length }} 步(当前显示最后 8 步)
      </div>
      <div v-for="(t, i) in visibleTrace" :key="i" class="trace-item" :class="t.kind">
        <div class="tlabel">{{ ICON[t.kind] ?? '·' }} {{ t.label ? `${t.label} · ` : '' }}{{ LABEL[t.kind] ?? t.kind }}</div>
        <pre>{{ t.content }}</pre>
      </div>
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
.tabs { display: flex; gap: 8px; margin-bottom: 5px; }
.tabs span {
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 5px;
  font-size: 11.5px;
}
.tabs span.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }

.block {
  background: #f7f8fa;
  border-radius: 7px;
  padding: 8px;
  margin-top: 4px;
  max-height: 220px;
  overflow-y: auto;
  white-space: pre-wrap;
  font-size: 12px;
}

.trace-line {
  max-height: 420px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 4px;
}
.trace-item {
  border-left: 3px solid #ddd;
  padding: 5px 8px;
  background: #f9fafb;
  border-radius: 0 7px 7px 0;
}
.trace-item.thinking { border-left-color: #b39ddb; }
.trace-item.tool_use { border-left-color: #4f6ef7; }
.trace-item.tool_result { border-left-color: #9ba65d; }
.trace-item.text { border-left-color: #30a46c; }
.tlabel { font-size: 11px; font-weight: 700; color: var(--muted); margin-bottom: 3px; }
.trace-item pre {
  background: #fff;
  border: 1px solid var(--border-soft);
  border-radius: 5px;
  padding: 6px;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow-y: auto;
  margin: 0;
}
.trace-toggle { cursor: pointer; font-size: 12px; color: var(--accent); padding: 3px 0; }
.trace-toggle:hover { text-decoration: underline; }
</style>
