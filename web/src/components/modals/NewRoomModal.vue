<script setup lang="ts">
// 新建房间:RoomForm 的 create 模式壳(完整字段可编辑)。

import { ref, watch } from 'vue';
import { refreshRooms, openRoom } from '@/store';
import { api } from '@/services/api';
import Modal from '@/components/ui/Modal.vue';
import RoomForm, { type RoomFormBody } from './RoomForm.vue';

const model = defineModel<boolean>({ default: false });
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
    projectPath: body.projectPath || undefined,
    toolPermission: body.toolPermission,
    members: [],
  });
  model.value = false;
  await refreshRooms();
  await openRoom(j.id);
}
</script>

<template>
  <Modal v-model="model" title="新建房间">
    <RoomForm ref="formRef" mode="create" @submit="onSubmit">
      <template #after-form>
        <div class="hint">
          创建后进入房间再添加成员(角色库拉入或新建角色,像微信群拉人)。<br />
          互动方式不预设——发消息随时切换:<b>直接发言</b>=接棒续聊 · <b>接棒@成员</b>=TA直接起头 · <b>@成员</b>=点名(答完指定下一位并暂停) · <b>@all2</b>=轮流2轮
        </div>
      </template>
    </RoomForm>
    <template #footer>
      <button class="btn btn-ghost" @click="model = false">取消</button>
      <button class="btn btn-primary" @click="formRef?.submit()">创建并进入</button>
    </template>
  </Modal>
</template>

<style scoped>
.hint { font-size: 12px; color: var(--muted); line-height: 1.7; }
</style>
