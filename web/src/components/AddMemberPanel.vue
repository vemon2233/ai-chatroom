<script setup lang="ts">
// 添加成员 = 顶部角色库预选(可多选拉入)+ 下半部新建角色表单(同 CharacterForm,
// 提交即入库并自动拉入房间)。与「新角色」弹窗共享同一表单——概念只剩"角色",无临时成员。
//
// 互斥手风琴:打开时两区全展开;勾选角色 → 折叠新建区;展开新建区 → 折叠选卡区。
// 防误解:用户不会以为"勾了角色还要填表单"。取消勾选/清空表单不自动回弹(用户主导)。

import { computed, ref, watch } from 'vue';
import { store, refreshCharacters } from '../store';
import { api } from '../api';
import { dialog } from '../composables/useDialog';
import type { Character } from '@server/core/types';
import Modal from './ui/Modal.vue';
import CharacterForm from './CharacterForm.vue';

const model = defineModel<boolean>({ default: false });

const picked = ref<Set<string>>(new Set());
const formRef = ref<InstanceType<typeof CharacterForm> | null>(null);

// 手风琴状态:两区各自是否展开;互斥折叠由用户动作触发,不由状态派生
const showPick = ref(true);
const showCreate = ref(true);

watch(model, (open) => {
  if (open) {
    picked.value = new Set();
    formRef.value?.reset();
    showPick.value = true;   // 打开时全展开
    showCreate.value = true;
  }
});

function togglePick(id: string) {
  if (picked.value.has(id)) picked.value.delete(id);
  else picked.value.add(id);
  // 勾了角色 → 新建区折叠(选卡区保持可见)
  if (picked.value.size > 0) showCreate.value = false;
}

/** 展开/收起新建区;展开时折叠选卡区(用户明确转向"新建"意图) */
function toggleCreate() {
  showCreate.value = !showCreate.value;
  if (showCreate.value) showPick.value = false;
}

/** 展开/收起选卡区(反向对称) */
function togglePickSection() {
  showPick.value = !showPick.value;
  if (showPick.value) showCreate.value = false;
}

const pickedCount = computed(() => picked.value.size);

/** 新建角色并立即拉入房间 */
async function createAndPull(body: Omit<Character, 'id' | 'createdAt'>) {
  if (!body) {
    await dialog.alert('角色需要名字和人设', '名字和人设都是必填项。');
    return;
  }
  const roomId = store.currentRoom!.config.id;
  try {
    const created = await api.createCharacter(body);
    await api.pullCharacters(roomId, [created.id]);
    await refreshCharacters();
    formRef.value?.reset();
  } catch (e) {
    await dialog.alert('添加失败', String((e as Error).message));
  }
}

async function submit() {
  const roomId = store.currentRoom!.config.id;
  if (picked.value.size === 0 && !formRef.value?.valid()) {
    await dialog.alert('还没有可添加的内容', '请先勾选角色库成员,或展开"新建角色"填写。');
    return;
  }
  if (picked.value.size > 0) {
    const j = await api.pullCharacters(roomId, [...picked.value]);
    store.currentRoom = j.state;
  }
  // 表单填了一半也算意图:valid 时新建;否则只拉勾选的
  if (formRef.value?.valid()) {
    formRef.value.submit(); // 触发 submit 事件 → createAndPull
  }
  picked.value = new Set();
  model.value = false;
}
</script>

<template>
  <Modal v-model="model" title="添加成员" width="560px">
    <!-- 选卡区(可折叠;勾选数徽标) -->
    <div class="sec-head" @click="togglePickSection">
      <span class="sec-title">从角色库选择<span v-if="pickedCount > 0" class="sec-badge">已选 {{ pickedCount }}</span></span>
      <span class="sec-caret" :class="{ open: showPick }">▾</span>
    </div>
    <div v-show="showPick" class="char-grid">
      <div
        v-for="c in store.characters"
        :key="c.id"
        class="char-card"
        :class="{ picked: picked.has(c.id) }"
        @click="togglePick(c.id)"
      >
        <span class="check">{{ picked.has(c.id) ? '✓' : '' }}</span>
        <span class="cc-emoji">{{ c.emoji || '🙂' }}</span>
        <span class="cc-name" :title="c.persona">{{ c.name }}</span>
        <span class="cc-adapter">{{ c.adapter }}</span>
      </div>
    </div>

    <!-- 新建区(可折叠) -->
    <div class="sec-head" @click="toggleCreate">
      <span class="sec-title">新建角色<span class="sec-sub">保存进角色库,并立即拉入本房间</span></span>
      <span class="sec-caret" :class="{ open: showCreate }">▾</span>
    </div>
    <CharacterForm v-show="showCreate" ref="formRef" @submit="createAndPull">
      <template #footer />
    </CharacterForm>

    <template #footer>
      <button class="btn btn-ghost" @click="model = false">取消</button>
      <button class="btn btn-primary" @click="submit">添加到房间</button>
    </template>
  </Modal>
</template>

<style scoped>
.sec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 2px 0;
  user-select: none;
}
.sec-title { font-size: 12.5px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 8px; flex: 1; }
.sec-sub { font-size: 11px; font-weight: 400; color: var(--muted); }
.sec-badge {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 10px;
  padding: 1px 8px;
}
.sec-caret { font-size: 10px; color: var(--muted); transition: transform 0.15s; }
.sec-caret.open { transform: rotate(0deg); }
.sec-caret:not(.open) { transform: rotate(-90deg); }

.char-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 7px;
  max-height: 240px;
  overflow-y: auto;
  padding: 2px;
  margin-top: 6px;
}
.char-card {
  position: relative;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  padding: 12px 6px 9px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.char-card:hover { border-color: #b8c2e8; background: #f8f9fc; }
.char-card.picked { border-color: var(--accent); background: var(--accent-soft); }
/* 勾选角标:选中才出现,右上角实底圆 */
.check {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 10.5px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cc-emoji { font-size: 23px; line-height: 1; }
.cc-name {
  font-size: 12.5px;
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cc-adapter { font-size: 10.5px; color: var(--muted); }
</style>
