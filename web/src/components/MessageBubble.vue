<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store';
import { splitMentions } from '../mentions';
import { initialsFor } from '../lib/avatar';
import type { ChatMessage } from '@server/core/types';
import TraceDetail from './TraceDetail.vue';

const props = defineProps<{ msg: ChatMessage & { streaming?: true } }>();
const showDetail = ref(false);

/** 正文按 @提及 切段(与输入框高亮同一解析真源) */
const segments = computed(() => splitMentions(props.msg.text));

const room = computed(() => store.currentRoom);
const member = computed(() => room.value?.config.members.find((m) => m.id === props.msg.from));
const isMe = computed(() => props.msg.from === 'user');
const isScout = computed(() => props.msg.from === 'scout');
const isSystem = computed(() => props.msg.system === true);

const avatarBg = computed(() => {
  if (isMe.value) return '#6B7280';
  if (isScout.value) return '#0EA5E9';
  return member.value?.color ?? '#9CA3AF';
});
const avatarText = computed(() => {
  if (isMe.value) return '我';
  if (isScout.value) return '侦';
  return initialsFor(member.value?.name ?? props.msg.fromName ?? '?');
});

/** 名字行「名字 · adapter · HH:MM」(截图样式;时间超淡) */
const senderName = computed(() =>
  isMe.value ? '我' : member.value?.name ?? props.msg.fromName ?? props.msg.from,
);
const senderRole = computed(() => {
  if (isMe.value) return '用户';
  if (isScout.value) return '侦察';
  return member.value?.adapter ?? '';
});
const timeLabel = computed(() => {
  const d = new Date(props.msg.ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
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
  <!-- 系统消息:居中白底药丸 -->
  <div v-if="isSystem" class="sysrow">{{ msg.text }}</div>

  <!-- 用户/成员/侦察员气泡 -->
  <div v-else class="row" :class="{ me: isMe }">
    <div class="avatar" :style="{ background: avatarBg }">{{ avatarText }}</div>
    <div class="wrap">
      <div class="sender">
        <span class="sender-name">{{ senderName }}</span>
        <span v-if="senderRole" class="sender-role">· {{ senderRole }}</span>
        <span class="sender-time">· {{ timeLabel }}</span>
      </div>
      <div
        class="bubble"
        :class="{ clickable, streaming: msg.streaming }"
        @click="clickable && (showDetail = !showDetail)"
        :title="clickable ? '点击展开工作过程 / 用量' : undefined"
      >
        <div class="text">
          <template v-for="(seg, i) in segments" :key="i">
            <span v-if="seg.mention" class="mention">{{ seg.text }}</span>
            <template v-else>{{ seg.text }}</template>
          </template>
        </div>
        <div v-if="meta" class="meta">{{ meta }}</div>
        <TraceDetail v-if="showDetail && msg.detail" :detail="msg.detail" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sysrow {
  align-self: center;
  max-width: min(620px, 92%);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  background: var(--panel);
  border: 1px solid var(--border-soft);
  padding: 3px 12px;
  border-radius: 14px;
}

.row { display: flex; gap: 10px; max-width: min(640px, 86%); }
.row.me { align-self: flex-end; flex-direction: row-reverse; }

/* initials 正圆头像(颜色 = 成员色;用户灰;侦察青) */
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}
.wrap { display: flex; flex-direction: column; gap: 4px; min-width: 0; }

/* 名字行:粗体名字 · 灰角色 · 超淡时间(截图样式) */
.sender { font-size: 11.5px; display: flex; align-items: baseline; gap: 5px; }
.row.me .sender { flex-direction: row-reverse; }
.sender-name { color: var(--text-muted); font-weight: 600; }
.sender-role { color: var(--muted); }
.sender-time { color: var(--faint); }

/* 气泡:agent = 白底描边四角等圆;我 = 淡靛底无边框深靛字 */
.bubble {
  background: var(--panel);
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  padding: 9px 12px;
  font-size: 13px;
  line-height: 1.6;
  position: relative;
  cursor: default;
}
.row.me .bubble {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent-deep);
}
.bubble.clickable { cursor: pointer; }
.bubble.clickable:hover { border-color: var(--accent-border); }
.bubble.streaming .text::after {
  content: '▍';
  animation: caret 0.8s infinite;
  color: var(--accent);
}
.text { white-space: pre-wrap; word-break: break-word; }
.mention { color: var(--accent); font-weight: 600; }
.row.me .bubble .mention { color: var(--accent-deep); }
.meta {
  margin-top: 6px;
  font-size: 11px;
  color: var(--muted);
}
.row.me .meta { color: var(--accent-deep); opacity: 0.65; }

@keyframes caret { 50% { opacity: 0.25; } }
</style>
