<script setup lang="ts">
// 新建房间:RoomForm 的 create 模式壳(完整字段可编辑)。

import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { refreshRooms, openRoom } from '@/store';
import { api } from '@/services/api';
import Modal from '@/components/ui/Modal.vue';
import RoomForm, { type RoomFormBody } from './RoomForm.vue';

const model = defineModel<boolean>({ default: false });
const { t } = useI18n();
const formRef = ref<InstanceType<typeof RoomForm> | null>(null);

watch(model, (open) => {
  if (open) formRef.value?.reset?.();
});

async function onSubmit(body: RoomFormBody) {
  const j = await api.createRoom({
    name: body.name,
    color: body.color,
    topic: body.topic,
    speechLength: body.speechLength,
    chainBudget: body.chainBudget,
    projectPath: body.projectPath || undefined,
    toolPermission: body.toolPermission,
    mode: body.mode,
    contextMode: body.contextMode,
    userPersona: body.userPersona ?? undefined,
    members: [],
  });
  model.value = false;
  await refreshRooms();
  await openRoom(j.id);
}
</script>

<template>
  <Modal v-model="model" :title="t('form.newRoomTitle')">
    <RoomForm ref="formRef" mode="create" @submit="onSubmit">
      <template #after-form>
        <div class="hint">
          {{ t('form.newRoomHintLine1') }}<br />
          {{ t('form.newRoomHintIntro') }}<b>{{ t('form.newRoomHintDirectLabel') }}</b>{{ t('form.newRoomHintDirectDesc') }} · <b>{{ t('form.newRoomHintBatonLabel') }}</b>{{ t('form.newRoomHintBatonDesc') }} · <b>{{ t('form.newRoomHintCalloutLabel') }}</b>{{ t('form.newRoomHintCalloutDesc') }} · <b>{{ t('form.newRoomHintRoundLabel') }}</b>{{ t('form.newRoomHintRoundDesc') }}
        </div>
      </template>
    </RoomForm>
    <template #footer>
      <button class="btn btn-ghost" @click="model = false">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" @click="formRef?.submit()">{{ t('form.createAndEnter') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.hint { font-size: 12px; color: var(--muted); line-height: 1.7; }
</style>
