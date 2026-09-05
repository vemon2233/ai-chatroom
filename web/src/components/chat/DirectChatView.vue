<script setup lang="ts">
import { computed } from 'vue';
import { store, resetDirect, toggleInspector } from '@/store';
import { streamPlaceholder } from '@/utils/chat';
import { dialog } from '@/composables/useDialog';
import ChatHeader from './ChatHeader.vue';
import ChatFlow from './ChatFlow.vue';
import Composer from './Composer.vue';
import ChatInspector from './ChatInspector.vue';
import type { ChatMessage } from '@server/core/types';

const char = computed(() => {
  if (!store.currentDirectChar) return null as any;
  return store.characters.find((c) => c.id === store.currentDirectChar?.id) ?? store.currentDirectChar;
});

const isGenerating = computed(() =>
  store.directStatus === 'thinking' || store.directStatus === 'streaming',
);

const renderList = computed<Array<ChatMessage | (ChatMessage & { streaming: true })>>(() => {
  const list: Array<ChatMessage | (ChatMessage & { streaming: true })> = [...store.directMessages];
  if (store.directStream && char.value) {
    list.push({
      id: 'direct_streaming_placeholder',
      roomId: `direct_${char.value.id}`,
      from: char.value.id,
      fromName: char.value.name,
      text: streamPlaceholder(store.directStream),
      ts: Date.now(),
      streaming: true,
    });
  }
  return list;
});

async function handleReset() {
  const ok = await dialog.confirm(
    '清空私聊记录',
    `确认清空与角色「${char.value.name}」的全部私聊记录吗？此操作无法撤销。`,
    { danger: true, confirmText: '清空' },
  );
  if (!ok) return;
  await resetDirect();
}
</script>

<template>
  <div class="room-wrap">
    <div class="room-card">
      <ChatHeader
        :title="char.name"
        :subtitle="`${char.adapter} · ${char.persona}`"
        :live="isGenerating"
        :status-text="isGenerating ? '回复中' : '待命'"
        :status-kind="isGenerating ? 'baton' : 'idle'"
      >
        <template #actions>
          <button
            class="btn btn-ghost btn-panel-toggle"
            :class="{ active: store.activeInspectorTab === 'summary' }"
            type="button"
            title="查看或刷新讨论摘要"
            @click="toggleInspector('summary')"
          >
            摘要
          </button>
          <button
            class="btn btn-ghost btn-panel-toggle"
            :class="{ active: store.activeInspectorTab === 'logs' }"
            type="button"
            title="查看 Agent 调用输入输出日志"
            @click="toggleInspector('logs')"
          >
            日志
          </button>
          <button
            class="btn btn-ghost btn-panel-toggle"
            :class="{ active: store.activeInspectorTab === 'manage' }"
            type="button"
            title="管理角色人设与参数"
            @click="toggleInspector('manage')"
          >
            管理
          </button>
          <button class="btn btn-ghost btn-danger" type="button" @click="handleReset">
            清空
          </button>
        </template>
      </ChatHeader>

      <div class="direct-split-layout">
        <div class="direct-chat-column">
          <ChatFlow
            :messages="renderList"
            :empty-title="`与 ${char.name} 的专属私聊`"
            empty-sub="输入消息，直接开展一对一探讨与交流。"
          />
          <Composer mode="direct" />
        </div>

        <ChatInspector
          v-if="store.activeInspectorTab"
          :active-tab="store.activeInspectorTab"
          session-type="direct"
          :session-id="char.id"
          @update:active-tab="store.activeInspectorTab = $event"
          @close="store.activeInspectorTab = null"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.direct-split-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

.direct-chat-column {
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
</style>
