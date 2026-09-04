<script setup lang="ts">
import { computed, ref } from 'vue';
import { store, clearRoomMessages } from '@/store';
import { initialsFor } from '@/utils/avatar';
import { streamPlaceholder } from '@/utils/chat';
import { dialog } from '@/composables/useDialog';
import ChatHeader from './ChatHeader.vue';
import MemberBar from './MemberBar.vue';
import ChatFlow from './ChatFlow.vue';
import Composer from './Composer.vue';
import SettingsPanel from '@/components/modals/SettingsPanel.vue';
import type { ChatMessage } from '@server/core/types';

const showSettings = ref(false);

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
      const buf = store.memberStream[m.id];
      if (!buf) continue;
      list.push({
        id: `stream_${m.id}`,
        roomId: room.value.config.id,
        from: m.id,
        fromName: m.name,
        text: streamPlaceholder(buf),
        ts: Date.now(),
        streaming: true,
      });
    }
  }
  return list;
});

function onActionClick() {
  showSettings.value = true;
}

async function handleClear() {
  const ok = await dialog.confirm(
    '清空聊天记录',
    `确认清空房间「${room.value.config.name}」的全部聊天记录吗？此操作无法撤销。`,
    { danger: true, confirmText: '清空' },
  );
  if (!ok) return;
  await clearRoomMessages(room.value.config.id);
}
</script>

<template>
  <div class="room-wrap">
    <div class="room-card">
      <ChatHeader
        :title="room.config.name"
        :subtitle="`${memberCount} 成员 · ${orchName}${projName ? ` · ${projName}(${permName})` : ''}`"
        :live="live"
        :status-text="orchName"
        :status-kind="room.orchestration"
      >
        <template #prefix>
          <div class="avatar-stack">
            <span
              v-for="(m, i) in stackMembers"
              :key="m.id"
              class="stack-avatar"
              :style="{ background: m.color, zIndex: stackMembers.length - i }"
              :title="m.name"
            >
              {{ initialsFor(m.name) }}
            </span>
            <span v-if="stackOverflow > 0" class="stack-avatar more">+{{ stackOverflow }}</span>
          </div>
        </template>
        <template #actions>
          <button class="btn btn-ghost" type="button" @click="onActionClick">
            设置
          </button>
          <button class="btn btn-ghost btn-danger" type="button" @click="handleClear">
            清空
          </button>
        </template>
      </ChatHeader>

      <MemberBar />
      <ChatFlow
        :messages="renderList"
        :empty-title="`欢迎来到 ${room.config.name}`"
        empty-sub="输入消息开始讨论，可使用 @ 呼叫成员参与交流。"
      />
      <Composer mode="room" />

      <SettingsPanel v-model="showSettings" />
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
</style>
