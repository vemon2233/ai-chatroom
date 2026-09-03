<script setup lang="ts">
// 房间设置:RoomForm 的 settings 模式壳——完整房间字段,项目目录/工具权限建时锁定(禁用)。

import { ref, watch } from 'vue';
import { store } from '../store';
import { api } from '../api';
import Modal from './ui/Modal.vue';
import RoomForm, { type RoomFormBody } from './RoomForm.vue';

const model = defineModel<boolean>({ default: false });
const formRef = ref<InstanceType<typeof RoomForm> | null>(null);

watch(model, (open) => {
  if (open) formRef.value?.reset?.();
});

async function onSubmit(body: RoomFormBody) {
  if (!store.currentRoom) return;
  // 即时生效:name/topic/speechLength/chainBudget/moderatorId
  // (projectPath/toolPermission 是禁用字段,原样回传也不在服务端生效)
  const state = await api.updateSettings(store.currentRoom.config.id, {
    name: body.name,
    topic: body.topic,
    speechLength: body.speechLength,
    chainBudget: body.chainBudget,
    moderatorId: body.moderatorId,
  });
  store.currentRoom = state;
  model.value = false;
}
</script>

<template>
  <Modal v-model="model" title="房间设置" width="560px">
    <RoomForm ref="formRef" mode="settings" :room="store.currentRoom?.config ?? null" @submit="onSubmit" />
    <template #footer>
      <button class="btn btn-ghost" @click="model = false">取消</button>
      <button class="btn btn-primary" @click="formRef?.submit()">保存(即时生效)</button>
    </template>
  </Modal>
</template>
