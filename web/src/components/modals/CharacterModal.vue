<script setup lang="ts">
// CharacterModal: 新建角色的独立 Modal 弹窗(角色管理在右侧 Inspector 边栏)。

import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { refreshCharacters } from '@/store';
import { api } from '@/services/api';
import { dialog } from '@/composables/useDialog';
import type { Character } from '@server/core/types';
import Modal from '@/components/ui/Modal.vue';
import CharacterForm from './CharacterForm.vue';

const { t } = useI18n();

const model = defineModel<boolean>({ default: false });

const formRef = ref<InstanceType<typeof CharacterForm> | null>(null);

watch(model, (open) => {
  if (open) {
    formRef.value?.reset?.();
  }
});

async function save(body: Omit<Character, 'id' | 'createdAt'>) {
  if (!body) {
    await dialog.alert(t('form.needNamePersonaTitle'), t('form.needNamePersonaBody'));
    return;
  }
  try {
    await api.createCharacter(body);
    model.value = false;
    await refreshCharacters();
  } catch (e) {
    await dialog.alert(t('form.saveFailedTitle'), String((e as Error).message));
  }
}
</script>

<template>
  <Modal v-model="model" :title="t('form.newCharTitle')">
    <CharacterForm ref="formRef" @submit="save" />
    <template #footer>
      <button class="btn btn-ghost" @click="model = false">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" @click="formRef?.submit()">{{ t('form.createChar') }}</button>
    </template>
  </Modal>
</template>
