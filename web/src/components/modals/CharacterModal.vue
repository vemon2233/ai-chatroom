<script setup lang="ts">
// CharacterModal: 新建角色的独立 Modal 弹窗(角色管理在右侧 Inspector 边栏)。

import { ref, watch } from 'vue';
import { refreshCharacters } from '@/store';
import { api } from '@/services/api';
import { dialog } from '@/composables/useDialog';
import type { Character } from '@server/core/types';
import Modal from '@/components/ui/Modal.vue';
import CharacterForm from './CharacterForm.vue';

const model = defineModel<boolean>({ default: false });

const formRef = ref<InstanceType<typeof CharacterForm> | null>(null);

watch(model, (open) => {
  if (open) {
    formRef.value?.reset?.();
  }
});

async function save(body: Omit<Character, 'id' | 'createdAt'>) {
  if (!body) {
    await dialog.alert('角色需要名字和人设', '名字和人设都是必填项。');
    return;
  }
  try {
    await api.createCharacter(body);
    model.value = false;
    await refreshCharacters();
  } catch (e) {
    await dialog.alert('保存失败', String((e as Error).message));
  }
}
</script>

<template>
  <Modal v-model="model" title="新角色">
    <CharacterForm ref="formRef" @submit="save" />
    <template #footer>
      <button class="btn btn-ghost" @click="model = false">取消</button>
      <button class="btn btn-primary" @click="formRef?.submit()">创建角色</button>
    </template>
  </Modal>
</template>
