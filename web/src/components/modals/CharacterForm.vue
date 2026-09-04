<script setup lang="ts">
// CharacterForm 原语:角色字段表单的唯一实现(新角色/编辑角色/添加成员内嵌共用)。
// 只管字段编辑;提交逻辑由宿主组件决定(入库/入库+拉入房间)。

import { onMounted, ref, watch } from 'vue';
import { store } from '@/store';
import { COLOR_OPTIONS, colorForName } from '@/utils/avatar';
import type { Character } from '@server/core/types';

const props = defineProps<{
  /** 编辑预填(传入即视为编辑态);null = 新建空白 */
  character?: Character | null;
}>();

const emit = defineEmits<{
  (e: 'submit', body: Omit<Character, 'id' | 'createdAt'>): void;
  /** 任一字段被用户改动(select 切换/文本输入——它们不冒泡 input) */
  (e: 'touched'): void;
}>();

const name = ref('');
const color = ref(COLOR_OPTIONS[0]!.value);
const persona = ref('');
const modelArg = ref('');
const note = ref('');
const adapter = ref('');

watch(
  () => props.character,
  (c) => {
    if (c) {
      name.value = c.name;
      color.value = c.color || colorForName(c.name);
      persona.value = c.persona;
      modelArg.value = (c.extraArgs ?? []).join(' ').replace('--model', '').trim();
      note.value = c.note || '';
      adapter.value = c.adapter;
    } else {
      name.value = '';
      color.value = COLOR_OPTIONS[0]!.value;
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
    color: color.value,
    adapter: adapter.value,
    persona: persona.value.trim(),
    extraArgs: modelArg.value.trim() ? ['--model', modelArg.value.trim()] : undefined,
    note: note.value.trim() || undefined,
  });
}

// 任一字段变动 → touched(宿主手风琴互斥用;watch 覆盖一切变更源:
// 文本输入/select 切换)。挂载后才开始上报,预填/重置不误触。
let armed = false;
onMounted(() => { armed = true; });
watch([name, color, persona, modelArg, note, adapter], () => {
  if (armed) emit('touched');
});

/** 供宿主:校验态(禁用提交按钮)与重置为空白 */
const valid = () => !!name.value.trim() && !!persona.value.trim();
function reset() {
  name.value = '';
  color.value = COLOR_OPTIONS[0]!.value;
  persona.value = '';
  modelArg.value = '';
  note.value = '';
  adapter.value = store.adapters[0]?.key ?? '';
}
defineExpose({ submit, valid, reset });
</script>

<template>
  <!-- 单根容器:宿主的 v-show(手风琴折叠)需要唯一根元素——fragment 根会让 v-show 静默失效 -->
  <div class="char-form">
    <div class="form-row">
      <label>名字与颜色</label>
      <div class="name-color-row">
        <div class="color-select-wrap">
          <span class="color-dot" :style="{ background: color }"></span>
          <select v-model="color" class="color-select" title="选择头像背景颜色">
            <option v-for="opt in COLOR_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <input v-model="name" type="text" class="name-input" placeholder="如:正方 / 首席架构师" />
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
.grid2-eq { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.name-color-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.color-select-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.color-dot {
  position: absolute;
  left: 10px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  pointer-events: none;
  border: 1px solid rgba(0, 0, 0, 0.12);
  z-index: 1;
  transition: background 0.15s;
}
.color-select {
  padding-left: 30px;
  padding-right: 18px;
  width: 102px;
  height: 38px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  background: var(--panel);
}
.name-input {
  flex: 1;
  min-width: 0;
  height: 38px;
}
</style>
