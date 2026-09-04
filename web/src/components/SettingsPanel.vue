<script setup lang="ts">
// 房间设置:RoomForm 的 settings 模式壳——完整房间字段,项目目录/工具权限建时锁定(禁用)。

import { ref, watch, computed } from 'vue';
import { store, refreshRooms } from '../store';
import { api } from '../api';
import type { RoomConfig } from '@server/core/types';
import Modal from './ui/Modal.vue';
import RoomForm, { type RoomFormBody } from './RoomForm.vue';

const model = defineModel<boolean>({ default: false });
const formRef = ref<InstanceType<typeof RoomForm> | null>(null);
const targetRoom = ref<RoomConfig | null>(null);

const activeRoom = computed(() => targetRoom.value || store.currentRoom?.config || null);

function openEdit(r: RoomConfig) {
  targetRoom.value = r;
  model.value = true;
}

watch(model, (open) => {
  if (open) {
    formRef.value?.reset?.();
  } else {
    targetRoom.value = null;
  }
});

async function onSubmit(body: RoomFormBody) {
  const r = activeRoom.value;
  if (!r) return;
  // 即时生效:name/color/topic/speechLength/chainBudget/moderatorId
  // (projectPath/toolPermission 是禁用字段,原样回传也不在服务端生效)
  const state = await api.updateSettings(r.id, {
    name: body.name,
    color: body.color,
    topic: body.topic,
    speechLength: body.speechLength,
    chainBudget: body.chainBudget,
    moderatorId: body.moderatorId,
  });
  if (store.currentRoom?.config.id === r.id) {
    store.currentRoom = state;
  }
  model.value = false;
  targetRoom.value = null;
  await refreshRooms();
}

function onExport() {
  // 导出 UI 占位
}

defineExpose({ openEdit });
</script>

<template>
  <Modal v-model="model" title="房间设置" width="560px">
    <RoomForm ref="formRef" mode="settings" :room="activeRoom" @submit="onSubmit" />
    <template #footer>
      <button class="btn btn-ghost" @click="onExport">导出</button>
      <button class="btn btn-ghost" @click="model = false">取消</button>
      <button class="btn btn-primary" @click="formRef?.submit()">保存</button>
    </template>
  </Modal>
</template>
