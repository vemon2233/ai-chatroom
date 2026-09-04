<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import MessageBubble from './MessageBubble.vue';
import type { ChatMessage } from '@server/core/types';

export type FlowMessage = ChatMessage | (ChatMessage & { streaming: true });

const props = withDefaults(
  defineProps<{
    messages: FlowMessage[];
    emptyTitle?: string;
    emptySub?: string;
  }>(),
  {
    emptyTitle: '',
    emptySub: '',
  },
);

const flowEl = ref<HTMLElement | null>(null);

const PAGE_SIZE = 60;
const visibleCount = ref(PAGE_SIZE);

// 历史落定消息与流式占位分离处理，保证分页只截断历史，不吞没活跃生成
const nonStreamingMessages = computed(() =>
  props.messages.filter((m) => !('streaming' in m && m.streaming)),
);
const streamingMessages = computed(() =>
  props.messages.filter((m) => 'streaming' in m && m.streaming),
);

const totalBaseCount = computed(() => nonStreamingMessages.value.length);
const hiddenCount = computed(() => Math.max(0, totalBaseCount.value - visibleCount.value));

function loadMore() {
  visibleCount.value += PAGE_SIZE;
}

const renderList = computed<FlowMessage[]>(() => {
  const visibleHistory =
    hiddenCount.value > 0
      ? nonStreamingMessages.value.slice(hiddenCount.value)
      : nonStreamingMessages.value;
  return [...visibleHistory, ...streamingMessages.value];
});

/** 自动滚动:贴底时跟随,翻阅历史时不打扰 */
function isNearBottom(): boolean {
  const el = flowEl.value;
  if (!el) return true;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
}

watch(
  () => [renderList.value.length, renderList.value.map((m) => m.text.length).join(',')],
  async () => {
    const stick = isNearBottom();
    await nextTick();
    if (stick && flowEl.value) {
      flowEl.value.scrollTop = flowEl.value.scrollHeight;
    }
  },
  { deep: false },
);
</script>

<template>
  <div ref="flowEl" class="chat-flow">
    <!-- 空状态插槽:支持具名插槽自由定制或默认两行式 -->
    <div v-if="renderList.length === 0" class="empty-hint">
      <slot name="empty">
        <div v-if="emptyTitle" class="empty-title">{{ emptyTitle }}</div>
        <div v-if="emptySub" class="empty-sub">{{ emptySub }}</div>
      </slot>
    </div>

    <!-- 顶部历史折叠指示条 -->
    <div v-if="hiddenCount > 0" class="load-more-wrap">
      <button class="load-more-btn" type="button" @click="loadMore">
        ↑ 查看更早的消息 (还有 {{ hiddenCount }} 条未展开)
      </button>
    </div>

    <MessageBubble v-for="msg in renderList" :key="msg.id" :msg="msg" />
  </div>
</template>

<style scoped>
.chat-flow {
  flex: 1;
  overflow-y: auto;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--panel-soft);
}

.load-more-wrap {
  display: flex;
  justify-content: center;
  margin-bottom: 4px;
}

.load-more-btn {
  font-size: 11.5px;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border-soft);
  padding: 5px 14px;
  border-radius: 14px;
  transition: all 0.15s ease;
  box-shadow: var(--shadow-sm);
}

.load-more-btn:hover {
  background: var(--bg);
  color: var(--text);
  border-color: var(--border);
}

.empty-hint {
  margin: auto;
  text-align: center;
  padding: 40px 20px;
  user-select: none;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 6px;
}

.empty-sub {
  font-size: 13px;
  color: var(--muted);
}
</style>
