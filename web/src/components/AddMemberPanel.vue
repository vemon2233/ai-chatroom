<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { store } from '../store';
import { api } from '../api';
import { dialog } from '../composables/useDialog';
import Modal from './ui/Modal.vue';

const model = defineModel<boolean>({ default: false });

// 角色库多选
const picked = ref<Set<string>>(new Set());

// 自定义成员行
interface Row { name: string; adapter: string; modelArg: string; persona: string }
const rows = ref<Row[]>([]);

watch(model, (open) => {
  if (open) {
    picked.value = new Set();
    if (rows.value.length === 0) rows.value = [emptyRow()];
  }
});

function emptyRow(): Row {
  return {
    name: '',
    adapter: store.adapters[0]?.key ?? '',
    modelArg: '',
    persona: '',
  };
}

function togglePick(id: string) {
  if (picked.value.has(id)) picked.value.delete(id);
  else picked.value.add(id);
}

async function submit() {
  const roomId = store.currentRoom!.config.id;
  const custom = rows.value
    .filter((r) => r.name.trim() || r.persona.trim())
    .map((r) => ({
      name: r.name.trim() || '成员',
      adapter: r.adapter,
      persona: r.persona.trim() || '你是讨论参与者,积极表达观点,观点鲜明。',
      extraArgs: r.modelArg.trim() ? ['--model', r.modelArg.trim()] : undefined,
    }));

  if (picked.value.size === 0 && custom.length === 0) {
    await dialog.alert('还没有可添加的内容', '请先在角色库勾选,或填写自定义成员行。');
    return;
  }

  if (picked.value.size > 0) {
    const j = await api.pullCharacters(roomId, [...picked.value]);
    store.currentRoom = j.state;
  }
  if (custom.length > 0) {
    const j = await api.addMembers(roomId, custom);
    store.currentRoom = j.state;
  }
  rows.value = [];
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
        <span class="pick-persona">{{ c.persona.slice(0, 40) }}</span>
      </div>
    </div>

    <div class="section-label">或自定义临时成员:</div>
    <div class="rows">
      <div v-for="(row, i) in rows" :key="i" class="row">
        <div class="row-top">
          <select v-model="row.adapter">
            <option v-for="a in store.adapters" :key="a.key" :value="a.key">{{ a.displayName }}</option>
          </select>
          <input v-model="row.name" type="text" placeholder="显示名" />
          <input v-model="row.modelArg" type="text" placeholder="model(可选)" />
          <button class="row-del" @click="rows.splice(i, 1)">✕</button>
        </div>
        <input v-model="row.persona" class="row-persona" type="text" placeholder="人设 / 立场(注入该成员每次发言)" />
      </div>
    </div>
    <button class="add-row" @click="rows.push(emptyRow())">＋ 添加一行</button>

    <template #footer>
      <button class="btn btn-ghost" @click="model = false">关闭</button>
      <button class="btn btn-primary" @click="submit">添加到房间</button>
    </template>
  </Modal>
</template>

<style scoped>
.section-label { font-size: 12px; color: var(--muted); margin-top: 4px; }

.char-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 5px;
}
.char-pick {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
}
.char-pick:hover { background: #f5f7fa; }
.char-pick.picked { background: var(--accent-soft); }
.pk { color: var(--muted); font-size: 12px; }
.char-pick.picked .pk { color: var(--accent); font-weight: 700; }
.pick-name { font-weight: 600; }
.pick-persona { color: var(--muted); font-size: 11px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.rows { display: flex; flex-direction: column; gap: 8px; }
.row {
  border: 1px solid var(--border-soft);
  border-radius: 9px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row-top { display: grid; grid-template-columns: 140px 1fr 110px 26px; gap: 6px; }
.row-top select, .row-top input { font-size: 12px; padding: 6px 7px; }
.row-del { color: var(--danger); font-size: 14px; }
.row-persona { font-size: 12px; }
.add-row {
  align-self: flex-start;
  border: 1px dashed var(--border);
  border-radius: 7px;
  padding: 6px 13px;
  color: var(--muted);
  font-size: 12.5px;
}
.add-row:hover { border-color: var(--accent); color: var(--accent); }
</style>
