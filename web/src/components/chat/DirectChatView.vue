<script setup lang="ts">
import { computed, ref } from 'vue';
import { store, resetDirect } from '@/store';
import { streamPlaceholder } from '@/utils/chat';
import { dialog } from '@/composables/useDialog';
import ChatHeader from './ChatHeader.vue';
import ChatFlow from './ChatFlow.vue';
import Composer from './Composer.vue';
import ChatInspector from './ChatInspector.vue';
import CharacterModal from '@/components/modals/CharacterModal.vue';
import type { ChatMessage } from '@server/core/types';

const char = computed(() => {
  if (!store.currentDirectChar) return null as any;
  return store.characters.find((c) => c.id === store.currentDirectChar?.id) ?? store.currentDirectChar;
});
const charModalRef = ref<InstanceType<typeof CharacterModal> | null>(null);
const showCharModal = ref(false);
const activeInspectorTab = ref<'summary' | 'logs' | null>(null);

function toggleInspector(tab: 'summary' | 'logs') {
  if (activeInspectorTab.value === tab) {
    activeInspectorTab.value = null;
  } else {
    activeInspectorTab.value = tab;
  }
}

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

function openEditChar() {
  charModalRef.value?.openEdit(char.value);
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
            :class="{ active: activeInspectorTab === 'summary' }"
            type="button"
            title="查看或刷新讨论摘要"
            @click="toggleInspector('summary')"
          >
            摘要
          </button>
          <button
            class="btn btn-ghost btn-panel-toggle"
            :class="{ active: activeInspectorTab === 'logs' }"
            type="button"
            title="查看 Agent 调用输入输出日志"
            @click="toggleInspector('logs')"
          >
            日志
          </button>
          <button class="btn btn-ghost" type="button" @click="openEditChar">
            设置
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
          v-if="activeInspectorTab"
          :active-tab="activeInspectorTab"
          session-type="direct"
          :session-id="char.id"
          @update:active-tab="activeInspectorTab = $event"
          @close="activeInspectorTab = null"
        />
      </div>

      <CharacterModal ref="charModalRef" v-model="showCharModal" />
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
