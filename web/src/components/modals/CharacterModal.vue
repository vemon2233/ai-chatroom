<script setup lang="ts">
// CharacterModal:新角色/编辑角色的 Modal 壳(字段表单在 CharacterForm——与添加成员弹窗共用)。

import { ref, watch } from 'vue';
import { store, refreshCharacters } from '@/store';
import { api } from '@/services/api';
import { dialog } from '@/composables/useDialog';
import type { Character } from '@server/core/types';
import Modal from '@/components/ui/Modal.vue';
import CharacterForm from './CharacterForm.vue';

const model = defineModel<boolean>({ default: false });

const editing = ref<Character | null>(null);
const formRef = ref<InstanceType<typeof CharacterForm> | null>(null);

watch(model, (open) => {
  if (open && !editing.value) formRef.value?.reset?.();
});

/** 编辑入口:直接传角色数据 */
function openEdit(c: Character) {
  editing.value = c;
  model.value = true;
}

async function save(body: Omit<Character, 'id' | 'createdAt'>) {
  if (!body) {
    await dialog.alert('角色需要名字和人设', '名字和人设都是必填项。');
    return;
  }
  try {
    if (editing.value) {
      await api.updateCharacter(editing.value.id, body);
    } else {
      await api.createCharacter(body);
    }
    model.value = false;
    editing.value = null;
    await refreshCharacters();
  } catch (e) {
    await dialog.alert('保存失败', String((e as Error).message));
  }
}

function onExport() {
  // 导出 UI 占位
}

defineExpose({ openEdit });
</script>

<template>
  <Modal v-model="model" :title="editing ? '编辑角色' : '新角色'">
    <CharacterForm ref="formRef" :character="editing" @submit="save" />
    <template #footer>
      <button v-if="editing" class="btn btn-ghost" @click="onExport">导出</button>
      <button class="btn btn-ghost" @click="model = false; editing = null">取消</button>
      <button class="btn btn-primary" @click="formRef?.submit()">保存</button>
    </template>
  </Modal>
</template>
