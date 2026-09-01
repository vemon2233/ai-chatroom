<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store';
import type { ChatMessage } from '@server/core/types';
import TraceDetail from './TraceDetail.vue';

const props = defineProps<{ msg: ChatMessage & { streaming?: true } }>();
const showDetail = ref(false);

const room = computed(() => store.currentRoom);
const member = computed(() => room.value?.config.members.find((m) => m.id === props.msg.from));
const isMe = computed(() => props.msg.from === 'user');
const isScout = computed(() => props.msg.from === 'scout');
const isSystem = computed(() => props.msg.system === true);

const avatarBg = computed(() => {
  if (isMe.value) return '#7f8c9b';
  if (isScout.value) return '#6ABFC3';
  return member.value?.color ?? '#999';
});
const avatarText = computed(() => {
  if (isMe.value) return '用';
  if (isScout.value) return '🔍';
  return member.value?.emoji || member.value?.name?.[0] || '?';
});

const meta = computed(() => {
  const d = props.msg.detail;
  if (!d) return '';
  const parts: string[] = [];
  if (d.durationMs != null && d.durationMs > 0) parts.push(`${(d.durationMs / 1000).toFixed(1)}s`);
  if (d.usage?.outputTokens != null) parts.push(`${d.usage.outputTokens} tok`);
  if (d.usage?.costUsd != null) parts.push(`$${d.usage.costUsd.toFixed(3)}`);
  return parts.join(' · ');
});

const clickable = computed(() => !isMe.value && !isSystem.value && !props.msg.streaming && !!props.msg.detail);
</script>

<template>
  <!-- 系统消息:居中小字 -->
  <div v-if="isSystem" class="sysrow">{{ msg.text }}</div>

  <!-- 用户/成员/侦察员气泡 -->
  <div v-else class="row" :class="{ me: isMe }">
    <div class="avatar" :style="{ background: avatarBg }">{{ avatarText }}</div>
    <div class="wrap">
      <div class="sender">{{ msg.fromName || member?.name || msg.from }}</div>
      <div
        class="bubble"
        :class="{ clickable, streaming: msg.streaming }"
        @click="clickable && (showDetail = !showDetail)"
        :title="clickable ? '点击展开工作过程 / 用量' : undefined"
      >
        <div class="text">{{ msg.text }}</div>
        <div v-if="meta" class="meta">{{ meta }}</div>
        <TraceDetail v-if="showDetail && msg.detail" :detail="msg.detail" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sysrow {
  align-self: center;
  max-width: 90%;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
  background: var(--border-soft);
  padding: 3px 12px;
  border-radius: 14px;
}

.row { display: flex; gap: 10px; max-width: 84%; }
.row.me { align-self: flex-end; flex-direction: row-reverse; }

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}
.wrap { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.sender { font-size: 11.5px; color: var(--muted); }
.row.me .sender { text-align: right; }

.bubble {
  background: var(--panel);
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 10px 13px;
  font-size: 14px;
  line-height: 1.65;
  box-shadow: var(--shadow-sm);
  position: relative;
  cursor: default;
}
.row.me .bubble {
  background: var(--me-bubble);
  border-color: transparent;
  color: var(--me-text);
}
.bubble.clickable { cursor: pointer; }
.bubble.clickable:hover { border-color: var(--accent); }
.bubble.streaming .text::after {
  content: '▍';
  animation: caret 0.8s infinite;
  color: var(--accent);
}
.text { white-space: pre-wrap; word-break: break-word; }
.meta {
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
}
.row.me .meta { color: rgba(255, 255, 255, 0.75); }

@keyframes caret { 50% { opacity: 0.25; } }
</style>
