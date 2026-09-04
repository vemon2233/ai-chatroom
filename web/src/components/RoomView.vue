<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store';
import { initialsFor } from '../lib/avatar';
import MemberBar from './MemberBar.vue';
import ChatFlow from './ChatFlow.vue';
import Composer from './Composer.vue';
import SettingsPanel from './SettingsPanel.vue';
import CharacterModal from './CharacterModal.vue';

const showSettings = ref(false);
const charModalRef = ref<InstanceType<typeof CharacterModal> | null>(null);

const room = computed(() => store.currentRoom!);

const isDm = computed(() =>
  !!room.value.config.dmCharacterId ||
  (room.value.config.members.length === 1 && !!room.value.config.members[0]?.characterId),
);
const dmChar = computed(() => {
  const cid = room.value.config.dmCharacterId || room.value.config.members[0]?.characterId;
  return store.characters.find((c) => c.id === cid);
});

const permName = computed(() =>
  ({ readonly: '只读', readwrite: '读写', full: '完全' } as Record<string, string>)[room.value.config.toolPermission] ?? '只读',
);
const projName = computed(() =>
  room.value.config.projectPath ? room.value.config.projectPath.split(/[\\/]/).pop() : '',
);
const orchName = computed(() => {
  if (isDm.value) {
    return live.value ? '回复中' : '待命';
  }
  return ({ idle: '待命', baton: '自由讨论', roundrobin: '轮流发言' } as Record<string, string>)[room.value.orchestration] ?? '';
});
/** 副行「绿点」:编排进行中(baton/roundrobin)= ok 绿;待命 = 灰 */
const live = computed(() => room.value.orchestration !== 'idle');
/** 顶栏头像堆:前 5 个成员,超出 +N 灰圆 */
const stackMembers = computed(() => room.value.config.members.slice(0, 5));
const stackOverflow = computed(() => room.value.config.members.length - 5);
const memberCount = computed(() => room.value.config.members.length);

function onActionClick() {
  if (isDm.value && dmChar.value) {
    charModalRef.value?.openEdit(dmChar.value);
  } else {
    showSettings.value = true;
  }
}
</script>

<template>
  <div class="room-wrap">
    <div class="room-card">
      <header class="topbar">
        <div class="title-wrap">
          <span class="title">{{ room.config.name }}</span>
          <span class="sub">
            <span class="live-dot" :class="{ on: live }"></span>
            <template v-if="isDm">
              {{ dmChar?.adapter ?? 'CLI' }} · {{ dmChar?.persona || '一对一私聊' }}
            </template>
            <template v-else>
              {{ memberCount }} 成员 · {{ orchName }}{{ projName ? ` · ${projName}(${permName})` : '' }}
            </template>
          </span>
        </div>
        <div class="topbar-right">
          <div v-if="!isDm" class="avatar-stack">
            <span v-for="(m, i) in stackMembers" :key="m.id" class="stack-avatar"
              :style="{ background: m.color, zIndex: stackMembers.length - i }" :title="m.name">{{ initialsFor(m.name)
              }}</span>
            <span v-if="stackOverflow > 0" class="stack-avatar more">+{{ stackOverflow }}</span>
          </div>
          <span class="pill orch" :class="room.orchestration">{{ orchName }}</span>
          <button class="btn btn-ghost" @click="onActionClick">
            {{ '设置' }}
          </button>
        </div>
      </header>

      <MemberBar v-if="!isDm" />
      <ChatFlow />
      <Composer />

      <SettingsPanel v-model="showSettings" />
      <CharacterModal ref="charModalRef" />
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

.topbar {
  padding: 11px 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--border-soft);
}

.title-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.title {
  font-size: 15px;
  font-weight: 650;
}

.sub {
  font-size: 11.5px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--faint);
  flex-shrink: 0;
}

.live-dot.on {
  background: var(--ok);
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

/* 成员头像堆:20px 正圆重叠,右往左压盖 */
.avatar-stack {
  display: flex;
}

.stack-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid var(--panel);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 9px;
  font-weight: 600;
  margin-left: -6px;
}

.stack-avatar:first-child {
  margin-left: 0;
}

.stack-avatar.more {
  background: var(--border-soft);
  color: var(--muted);
}

/* 编排药丸:三色语义(默认灰 / baton 绿 / roundrobin 琥珀) */
.pill.orch.baton {
  background: #ECFDF3;
  color: #047857;
}

.pill.orch.roundrobin {
  background: #FFFBEB;
  color: #B45309;
}
</style>
