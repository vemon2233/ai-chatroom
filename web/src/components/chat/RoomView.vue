<script setup lang="ts">
import { computed, ref } from 'vue';
import { store, clearRoomMessages, toggleInspector } from '@/store';
import { api } from '@/services/api';
import { initialsFor } from '@/utils/avatar';
import { streamPlaceholder } from '@/utils/chat';
import { dialog } from '@/composables/useDialog';
import { exportChatHistoryMarkdown } from '@/utils/exportMarkdown';
import ChatHeader from './ChatHeader.vue';
import MemberBar from './MemberBar.vue';
import ChatFlow from './ChatFlow.vue';
import Composer from './Composer.vue';
import ChatInspector from './ChatInspector.vue';
import type { ChatMessage } from '@server/core/types';

const room = computed(() => store.currentRoom!);

const permName = computed(() =>
  ({ readonly: '只读', readwrite: '读写', full: '完全' } as Record<string, string>)[room.value.config.toolPermission] ?? '只读',
);
const projName = computed(() =>
  room.value.config.projectPath ? room.value.config.projectPath.split(/[\\/]/).pop() : '',
);
const orchName = computed(() =>
  ({ idle: '待命', baton: '自由讨论', roundrobin: '轮流发言' } as Record<string, string>)[room.value.orchestration] ?? '',
);
/** 副行「绿点」:编排进行中(baton/roundrobin)= ok 绿;待命 = 灰 */
const live = computed(() => room.value.orchestration !== 'idle');
/** 顶栏头像堆:前 5 个成员,超出 +N 灰圆 */
const stackMembers = computed(() => room.value.config.members.slice(0, 5));
const stackOverflow = computed(() => room.value.config.members.length - 5);
const memberCount = computed(() => room.value.config.members.length);

const renderList = computed<Array<ChatMessage | (ChatMessage & { streaming: true })>>(() => {
  const list: Array<ChatMessage | (ChatMessage & { streaming: true })> = [
    ...(store.messages as ChatMessage[]),
  ];
  if (room.value) {
    for (const m of room.value.config.members) {
      const status = room.value.statuses[m.id];
      const isGenerating = status === 'thinking' || status === 'streaming';
      const buf = store.memberStream[m.id];
      if (!isGenerating && !buf) continue;

      list.push({
        id: `stream_${m.id}`,
        roomId: room.value.config.id,
        from: m.id,
        fromName: m.name,
        text: streamPlaceholder(buf || { text: '', thinking: status === 'thinking' ? '推理中…' : '' }),
        ts: Date.now(),
        streaming: true,
      });
    }
  }
  return list;
});

async function handleClear() {
  const ok = await dialog.confirm(
    '清空聊天记录',
    `确认清空房间「${room.value.config.name}」的全部聊天记录吗？此操作无法撤销。`,
    { danger: true, confirmText: '清空' },
  );
  if (!ok) return;
  await clearRoomMessages(room.value.config.id);
}

function handleExport() {
  if (!room.value) return;
  exportChatHistoryMarkdown({
    title: room.value.config.name,
    sessionType: 'room',
    members: room.value.config.members.map((m) => m.name),
    messages: store.messages,
  });
}
</script>

<template>
  <div class="room-wrap">
    <div class="room-card">
      <ChatHeader :title="room.config.name"
        :subtitle="`${memberCount} 成员 · ${orchName}${projName ? ` · ${projName}(${permName})` : ''}`" :live="live"
        :status-text="orchName" :status-kind="room.orchestration">
        <template #prefix>
          <div class="avatar-stack">
            <span v-for="(m, i) in stackMembers" :key="m.id" class="stack-avatar"
              :style="{ background: m.color, zIndex: stackMembers.length - i }" :title="m.name">
              {{ initialsFor(m.name) }}
            </span>
            <span v-if="stackOverflow > 0" class="stack-avatar more">+{{ stackOverflow }}</span>
          </div>
        </template>
        <template #actions>
          <button class="btn btn-ghost btn-panel-toggle" :class="{ active: store.activeInspectorTab === 'summary' }"
            type="button" title="查看或刷新讨论摘要" @click="toggleInspector('summary')">
            摘要
          </button>
          <button class="btn btn-ghost btn-panel-toggle" :class="{ active: store.activeInspectorTab === 'stats' }"
            type="button" title="查看会话用量与开销统计" @click="toggleInspector('stats')">
            统计
          </button>
          <button class="btn btn-ghost btn-panel-toggle" :class="{ active: store.activeInspectorTab === 'logs' }"
            type="button" title="查看 Agent 调用输入输出日志" @click="toggleInspector('logs')">
            日志
          </button>
          <button class="btn btn-ghost btn-panel-toggle" :class="{ active: store.activeInspectorTab === 'manage' }"
            type="button" title="管理房间设置与成员" @click="toggleInspector('manage')">
            管理
          </button>
          <button class="btn btn-ghost" type="button" title="导出当前房间聊天记录为 Markdown" @click="handleExport">
            导出
          </button>
          <button class="btn btn-ghost btn-danger" type="button" @click="handleClear">
            清空
          </button>
        </template>
      </ChatHeader>

      <div class="room-split-layout">
        <div class="room-chat-column">
          <MemberBar />
          <ChatFlow :messages="renderList" :empty-title="`欢迎来到 ${room.config.name}`"
            empty-sub="输入消息开始讨论，可使用 @ 呼叫成员参与交流。" />
          <Composer mode="room" />
        </div>

        <ChatInspector v-if="store.activeInspectorTab" :active-tab="store.activeInspectorTab" session-type="room"
          :session-id="room.config.id" @update:active-tab="store.activeInspectorTab = $event"
          @close="store.activeInspectorTab = null" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 全铺满工作台模式:完全撑满右侧区域,无缝对接顶部 Tab 栏 */
.room-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.room-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
  background: var(--panel);
  overflow: hidden;
}

.room-split-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

.room-chat-column {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.btn-panel-toggle.active {
  background: var(--accent-soft);
  color: var(--accent-deep);
  border-color: var(--accent-border);
  font-weight: 600;
}

.avatar-stack {
  display: flex;
  align-items: center;
  margin-right: 2px;
}

.stack-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid var(--panel);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  margin-left: -6px;
  flex-shrink: 0;
}

.stack-avatar:first-child {
  margin-left: 0;
}

.stack-avatar.more {
  background: var(--muted);
  font-size: 9px;
  font-weight: 600;
}

.mode-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--panel-soft);
  color: var(--muted);
  border: 1px solid var(--border-soft);
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-pill:hover {
  background: var(--hover);
  color: var(--text);
}

.mode-pill.stateful {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
  border-color: rgba(245, 158, 11, 0.35);
}

.mode-pill.stateful:hover {
  background: rgba(245, 158, 11, 0.22);
}
</style>
