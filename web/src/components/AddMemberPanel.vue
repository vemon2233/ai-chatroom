<script setup lang="ts">
// 添加成员 = 顶部角色库预选(可多选拉入)+ 下半部新建角色表单(同 CharacterForm,
// 提交即入库并自动拉入房间)。与「新角色」弹窗共享同一表单——概念只剩"角色",无临时成员。

import { ref, watch } from 'vue';
import { store, refreshCharacters } from '../store';
import { api } from '../api';
import { dialog } from '../composables/useDialog';
import type { Character } from '@server/core/types';
import Modal from './ui/Modal.vue';
import CharacterForm from './CharacterForm.vue';

const model = defineModel<boolean>({ default: false });

const picked = ref<Set<string>>(new Set());
const formRef = ref<InstanceType<typeof CharacterForm> | null>(null);

watch(model, (open) => {
  if (open) {
    picked.value = new Set();
    formRef.value?.reset();
  }
});

function togglePick(id: string) {
  if (picked.value.has(id)) picked.value.delete(id);
  else picked.value.add(id);
}

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
    await dialog.alert('还没有可添加的内容', '请先在上方勾选角色,或在下方填写新角色。');
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
    <div class="section-label">从角色库选择(可多选,拉入为快照):</div>
    <div class="char-list">
      <div
        v-for="c in store.characters"
        :key="c.id"
        class="char-pick"
        :class="{ picked: picked.has(c.id) }"
        @click="togglePick(c.id)"
      >
        <span class="pk">{{ picked.has(c.id) ? '●' : '○' }}</span>
        <span>{{ c.emoji || '🙂' }}</span>
        <span class="pick-name">{{ c.name }}</span>
        <span class="pick-adapter">{{ c.adapter }}</span>
        <span class="pick-persona">{{ c.persona.slice(0, 40) }}</span>
      </div>
    </div>

    <div class="section-label">或新建角色(保存进角色库,并立即拉入本房间):</div>
    <CharacterForm ref="formRef" @submit="createAndPull">
      <template #after-form>
        <div class="section-hint">留空则跳过,只拉入上方勾选的角色。</div>
      </template>
      <template #footer />
    </CharacterForm>

    <template #footer>
      <button class="btn btn-ghost" @click="model = false">取消</button>
      <button class="btn btn-primary" @click="submit">添加到房间</button>
    </template>
  </Modal>
</template>

<style scoped>
.section-label { font-size: 12px; color: var(--muted); margin-top: 4px; }
.section-hint { font-size: 11px; color: var(--muted); }

.char-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 5px;
}
.char-pick {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
}
.char-pick:hover { background: #f5f7fa; }
.char-pick.picked { background: var(--accent-soft); }
.pk { color: var(--muted); font-size: 12px; }
.char-pick.picked .pk { color: var(--accent); font-weight: 700; }
.pick-name { font-weight: 600; }
.pick-adapter { color: var(--muted); font-size: 11px; flex-shrink: 0; }
.pick-persona { color: var(--muted); font-size: 11px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
