<script setup lang="ts">
// CharacterForm 原语:角色字段表单的唯一实现(新角色/编辑角色/添加成员内嵌共用)。
// 只管字段编辑;提交逻辑由宿主组件决定(入库/入库+拉入房间)。

import { ref, watch } from 'vue';
import { store } from '../store';
import EmojiSelect from './ui/EmojiSelect.vue';
import type { Character } from '@server/core/types';

const props = defineProps<{
  /** 编辑预填(传入即视为编辑态);null = 新建空白 */
  character?: Character | null;
}>();

const emit = defineEmits<{ (e: 'submit', body: Omit<Character, 'id' | 'createdAt'>): void }>();

const emoji = ref('🙂');
const name = ref('');
const persona = ref('');
const modelArg = ref('');
const note = ref('');
const adapter = ref('');

watch(
  () => props.character,
  (c) => {
    if (c) {
      emoji.value = c.emoji || '🙂';
      name.value = c.name;
      persona.value = c.persona;
      modelArg.value = (c.extraArgs ?? []).join(' ').replace('--model', '').trim();
      note.value = c.note || '';
      adapter.value = c.adapter;
    } else {
      emoji.value = '🙂';
      name.value = '';
      persona.value = '';
      modelArg.value = '';
      note.value = '';
      adapter.value = store.adapters[0]?.key ?? '';
    }
  },
  { immediate: true },
);

function submit() {
  if (!name.value.trim() || !persona.value.trim()) {
    emit('submit', '' as never); // 宿主校验提示;正常路径不会走到(按钮已禁用)
    return;
  }
  emit('submit', {
    name: name.value.trim(),
    emoji: emoji.value,
    adapter: adapter.value,
    persona: persona.value.trim(),
    extraArgs: modelArg.value.trim() ? ['--model', modelArg.value.trim()] : undefined,
    note: note.value.trim() || undefined,
  });
}

/** 供宿主:校验态(禁用提交按钮)与重置为空白 */
const valid = () => !!name.value.trim() && !!persona.value.trim();
/** 供宿主(手风琴互斥):用户是否已开始填写(任一关键字段非空) */
const dirty = () => !!name.value.trim() || !!persona.value.trim();
function reset() {
  emoji.value = '🙂';
  name.value = '';
  persona.value = '';
  modelArg.value = '';
  note.value = '';
  adapter.value = store.adapters[0]?.key ?? '';
}
defineExpose({ submit, valid, dirty, reset });
</script>

<template>
  <!-- 单根容器:宿主的 v-show(手风琴折叠)需要唯一根元素——fragment 根会让 v-show 静默失效 -->
  <div class="char-form">
    <div class="form-head">
      <EmojiSelect v-model="emoji" />
      <div class="form-row grow">
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
    <slot name="after-form" />
    <slot name="footer" :submit="submit" :valid="valid()" />
  </div>
</template>

<style scoped>
.char-form { display: flex; flex-direction: column; gap: 14px; }
.form-head { display: flex; gap: 12px; align-items: flex-start; }
.form-head .grow { flex: 1; }
.grid2-eq { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
</style>
