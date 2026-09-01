<script setup lang="ts">
import { ref, watch } from 'vue';
import { store, refreshCharacters } from '../store';
import { api } from '../api';
import { dialog } from '../composables/useDialog';
import type { Character } from '@server/core/types';
import Modal from './ui/Modal.vue';

const model = defineModel<boolean>({ default: false });

const emoji = ref('🙂');
const name = ref('');
const persona = ref('');
const modelArg = ref('');
const note = ref('');
const adapter = ref('');
const editingId = ref<string | null>(null);

watch(model, (open) => {
  if (open && !editingId.value) reset();
});

function reset() {
  emoji.value = '🙂';
  name.value = '';
  persona.value = '';
  modelArg.value = '';
  note.value = '';
  adapter.value = store.adapters[0]?.key ?? '';
  editingId.value = null;
}

/** 编辑入口:直接传角色数据(v-model 开合由调用方/自身管理,无 expose 桥接) */
function openEdit(c: Character) {
  editingId.value = c.id;
  emoji.value = c.emoji || '🙂';
  name.value = c.name;
  persona.value = c.persona;
  modelArg.value = (c.extraArgs ?? []).join(' ').replace('--model', '').trim();
  note.value = c.note || '';
  adapter.value = c.adapter;
  model.value = true;
}

async function save() {
  if (!name.value.trim() || !persona.value.trim()) {
    await dialog.alert('角色需要名字和人设', '名字和人设都是必填项。');
    return;
  }
  const body = {
    name: name.value.trim(),
    emoji: emoji.value.trim() || '🙂',
    adapter: adapter.value,
    persona: persona.value.trim(),
    extraArgs: modelArg.value.trim() ? ['--model', modelArg.value.trim()] : undefined,
    note: note.value.trim() || undefined,
  };
  try {
    if (editingId.value) {
      await api.updateCharacter(editingId.value, body);
    } else {
      await api.createCharacter(body);
    }
    model.value = false;
    reset();
    await refreshCharacters();
  } catch (e) {
    await dialog.alert('保存失败', String((e as Error).message));
  }
}

async function remove() {
  const c = store.characters.find((x) => x.id === editingId.value);
  if (!c) return;
  const ok = await dialog.confirm(
    '删除角色',
    `删除角色「${c.name}」?已拉进房间的成员不受影响。`,
    { danger: true, confirmText: '删除' },
  );
  if (!ok) return;
  await api.deleteCharacter(c.id);
  model.value = false;
  reset();
  await refreshCharacters();
}

defineExpose({ openEdit });
</script>

<template>
  <Modal v-model="model" :title="editingId ? '编辑角色' : '新角色'">
    <div class="grid2">
      <div class="form-row">
        <label>Emoji</label>
        <input v-model="emoji" type="text" style="text-align: center; font-size: 17px" />
      </div>
      <div class="form-row">
        <label>名字</label>
        <input v-model="name" type="text" placeholder="如:正方 / 首席架构师" />
      </div>
    </div>
    <div class="form-row">
      <label>适配器(CLI)</label>
      <select v-model="adapter">
        <option v-for="a in store.adapters" :key="a.key" :value="a.key">{{ a.displayName }}</option>
      </select>
    </div>
    <div class="form-row">
      <label>人设 / 立场(注入该角色每次发言)</label>
      <textarea v-model="persona" placeholder="这个角色是谁、什么立场、怎么说话"></textarea>
    </div>
    <div class="grid2-eq">
      <div class="form-row">
        <label>model 档(可选)</label>
        <input v-model="modelArg" type="text" placeholder="如 sonnet / haiku" />
      </div>
      <div class="form-row">
        <label>备注(可选,仅自己可见)</label>
        <input v-model="note" type="text" placeholder="什么时候用这个角色" />
      </div>
    </div>

    <div v-if="editingId" class="danger-zone">
      <button class="btn btn-danger" @click="remove">删除此角色</button>
    </div>

    <template #footer>
      <button class="btn btn-ghost" @click="model = false; reset()">取消</button>
      <button class="btn btn-primary" @click="save">保存</button>
    </template>
  </Modal>
</template>

<style scoped>
.grid2 { display: grid; grid-template-columns: 80px 1fr; gap: 10px; }
.grid2-eq { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.danger-zone { border-top: 1px dashed var(--border); padding-top: 12px; display: flex; justify-content: flex-end; }
</style>
