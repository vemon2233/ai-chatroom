<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { store } from '../store';
import MessageBubble from './MessageBubble.vue';
import type { ChatMessage } from '@server/core/types';

const flowEl = ref<HTMLElement | null>(null);

/** 渲染源:已落库消息 + 进行中的流式占位(合成消息) */
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
        text: buf.text || (buf.thinking ? '…(思考中)' : '正在思考…'),
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
  padding: 18px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
