<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { store, type StreamBuf } from '@/store';
import MessageBubble from './MessageBubble.vue';
import type { ChatMessage } from '@server/core/types';

const flowEl = ref<HTMLElement | null>(null);

const PAGE_SIZE = 60;
const visibleCount = ref(PAGE_SIZE);

// 切换房间时复位展示数量
watch(
  () => store.currentRoom?.config.id,
  () => {
    visibleCount.value = PAGE_SIZE;
  },
);

const totalBaseCount = computed(() => store.messages.length);
const hiddenCount = computed(() => Math.max(0, totalBaseCount.value - visibleCount.value));

function loadMore() {
  visibleCount.value += PAGE_SIZE;
}

/** 流式占位文本:真实状态三阶——启动中(无输出)/推理中(有 thinking 无正文)/正文流出 */
function streamPlaceholder(buf: StreamBuf): string {
  if (buf.text) return buf.text;
  if (buf.thinking) return '推理中…';
  return '启动中…';
}

const renderList = computed<Array<ChatMessage | (ChatMessage & { streaming: true })>>(() => {
  const base = store.messages as ChatMessage[];
  const visibleBase = hiddenCount.value > 0 ? base.slice(hiddenCount.value) : base;
  const streaming: Array<ChatMessage & { streaming: true }> = [];
  const room = store.currentRoom;
  if (room) {
    for (const m of room.config.members) {
      const buf = store.memberStream[m.id];
      if (!buf) continue;
      streaming.push({
        id: `stream_${m.id}`,
        roomId: room.config.id,
        from: m.id,
        fromName: m.name,
        text: streamPlaceholder(buf),
        ts: Date.now(),
        streaming: true,
      });
    }
  }
  return [...visibleBase, ...streaming];
});

/** 自动滚动:贴底时跟随,翻阅历史时不打扰 */
function isNearBottom(): boolean {
  const el = flowEl.value;
  if (!el) return true;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
}

watch(
  () => [store.messages.length, Object.keys(store.memberStream).length, renderList.value.map(m => m.text.length).join(',')],
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
  color: var(--accent);
  border-color: var(--accent-border);
  background: var(--panel);
}
</style>
