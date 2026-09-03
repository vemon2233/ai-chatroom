<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { store, type StreamBuf } from '../store';
import MessageBubble from './MessageBubble.vue';
import type { ChatMessage } from '@server/core/types';

const flowEl = ref<HTMLElement | null>(null);

/** 流式占位文本:真实状态三阶——启动中(无任何输出)/推理中(有 thinking 无正文)/正文流出 */
/** 流式占位文本:启动中(无输出)/推理中(有 thinking 无正文——不播思考内容)/正文流出 */
function streamPlaceholder(buf: StreamBuf): string {
  if (buf.text) return buf.text;
  if (buf.thinking) return '推理中…';
  return '启动中…';
}

const renderList = computed<Array<ChatMessage | (ChatMessage & { streaming: true })>>(() => {
  const base = store.messages as ChatMessage[];
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
  return [...base, ...streaming];
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
</style>
