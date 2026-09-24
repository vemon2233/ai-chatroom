<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { store, resetDirect, toggleInspector, type StreamBuf } from '@/store';
import { dialog } from '@/composables/useDialog';
import { exportChatHistoryMarkdown } from '@/utils/exportMarkdown';
import ChatHeader from './ChatHeader.vue';
import ChatFlow from './ChatFlow.vue';
import Composer from './Composer.vue';
import ChatInspector from './ChatInspector.vue';
import type { ChatMessage } from '@server/core/types';

const { t } = useI18n();

const char = computed(() => {
  if (!store.currentDirectChar) return null as any;
  return store.characters.find((c) => c.id === store.currentDirectChar?.id) ?? store.currentDirectChar;
});

const isGenerating = computed(() =>
  store.directStatus === 'thinking' || store.directStatus === 'streaming',
);

const renderList = computed<Array<ChatMessage | (ChatMessage & { streaming: true; liveBuf?: StreamBuf; liveStatus?: string })>>(() => {
  const list: Array<ChatMessage | (ChatMessage & { streaming: true; liveBuf?: StreamBuf; liveStatus?: string })> = [...store.directMessages];
  if ((store.directStream || isGenerating.value) && char.value) {
    const buf = store.directStream ?? { text: '', thinking: t('chat.replyingText') };
    list.push({
      id: 'direct_streaming_placeholder',
      roomId: `direct_${char.value.id}`,
      from: char.value.id,
      fromName: char.value.name,
      text: buf.text,
      ts: Date.now(),
      streaming: true,
      liveBuf: buf,
      liveStatus: store.directStatus,
    });
  }
  return list;
});

async function handleReset() {
  const ok = await dialog.confirm(
    t('chat.directClearTitle'),
    t('chat.directClearBody', { name: char.value.name }),
    { danger: true, confirmText: t('chat.clearConfirm') },
  );
  if (!ok) return;
  await resetDirect();
}

function handleExport() {
  if (!char.value) return;
  exportChatHistoryMarkdown({
    title: t('chat.exportDirectTitle', { name: char.value.name }),
    sessionType: 'direct',
    members: [char.value.name, t('chat.roleUser')],
    messages: store.directMessages,
  });
}
</script>

<template>
  <div class="room-wrap">
    <div class="room-card">
      <ChatHeader
        :title="char.name"
        :subtitle="`${char.adapter} · ${char.persona}`"
        :live="isGenerating"
        :status-text="isGenerating ? t('chat.statusReplying') : t('chat.statusIdle')"
        :status-kind="isGenerating ? 'baton' : 'idle'"
      >
        <template #actions>
          <button
            class="btn btn-ghost btn-panel-toggle"
            :class="{ active: store.activeInspectorTab === 'summary' }"
            type="button"
            :title="t('chat.titleSummary')"
            @click="toggleInspector('summary')"
          >
            {{ t('chat.tabSummary') }}
          </button>
          <button
            class="btn btn-ghost btn-panel-toggle"
            :class="{ active: store.activeInspectorTab === 'stats' }"
            type="button"
            :title="t('chat.titleStats')"
            @click="toggleInspector('stats')"
          >
            {{ t('chat.tabStats') }}
          </button>
          <button
            class="btn btn-ghost btn-panel-toggle"
            :class="{ active: store.activeInspectorTab === 'logs' }"
            type="button"
            :title="t('chat.titleLogs')"
            @click="toggleInspector('logs')"
          >
            {{ t('chat.tabLogs') }}
          </button>
          <button
            class="btn btn-ghost btn-panel-toggle"
            :class="{ active: store.activeInspectorTab === 'manage' }"
            type="button"
            :title="t('chat.titleManageDirect')"
            @click="toggleInspector('manage')"
          >
            {{ t('chat.tabManage') }}
          </button>
          <button
            class="btn btn-ghost"
            type="button"
            :title="t('chat.titleExportDirect')"
            @click="handleExport"
          >
            {{ t('chat.exportBtn') }}
          </button>
          <button class="btn btn-ghost btn-danger" type="button" @click="handleReset">
            {{ t('chat.clearBtn') }}
          </button>
        </template>
      </ChatHeader>

      <div class="direct-split-layout">
        <div class="direct-chat-column">
          <ChatFlow
            :messages="renderList"
            :empty-title="t('chat.directEmptyTitle', { name: char.name })"
            :empty-sub="t('chat.directEmptySub')"
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
