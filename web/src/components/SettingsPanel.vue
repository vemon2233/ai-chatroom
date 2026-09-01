<script setup lang="ts">
import { ref, watch } from 'vue';
import { store } from '../store';
import { api } from '../api';
import Modal from './ui/Modal.vue';

const model = defineModel<boolean>({ default: false });

const speechLength = ref<'short' | 'normal' | 'long'>('normal');
const chainBudget = ref(6);
const moderatorId = ref('');

watch(model, (open) => {
  if (open && store.currentRoom) {
    speechLength.value = store.currentRoom.config.speechLength;
    chainBudget.value = store.currentRoom.config.chainBudget;
    moderatorId.value = store.currentRoom.config.moderatorId ?? '';
  }
});

async function save() {
  const roomId = store.currentRoom!.config.id;
  const state = await api.updateSettings(roomId, {
    speechLength: speechLength.value,
    chainBudget: chainBudget.value,
    moderatorId: moderatorId.value,
  });
  store.currentRoom = state; // 即时生效(下一条 prompt 即用新值)
  model.value = false;
}
</script>

<template>
  <Modal v-model="model" title="房间设置" width="440px">
    <div class="form-row">
      <label>发言长度(即时生效:下一次发言即按新长度)</label>
      <select v-model="speechLength">
        <option value="short">简短(300字内,快节奏交锋)</option>
        <option value="normal">标准(600字内,论证完整)</option>
        <option value="long">详尽(不限长,充分展开论述)</option>
      </select>
    </div>

    <div class="form-row">
      <label>接棒上限(连续自动接棒 N 棒后停止;你发新消息即重置)</label>
      <input v-model.number="chainBudget" type="number" min="1" max="50" />
    </div>

    <div class="form-row">
      <label>主持人(@allN 轮流时每轮末小结;留空 = 无主持人)</label>
      <select v-model="moderatorId">
        <option value="">(无)</option>
        <option v-for="m in store.currentRoom?.config.members ?? []" :key="m.id" :value="m.id">
          {{ m.emoji }} {{ m.name }}
        </option>
      </select>
    </div>

    <div class="note">
      主题、绑定项目、工具权限为房间固有属性,创建时确定(重构历史讨论的语境依赖它们)。
    </div>

    <template #footer>
      <button class="btn btn-ghost" @click="model = false">取消</button>
      <button class="btn btn-primary" @click="save">保存(即时生效)</button>
    </template>
  </Modal>
</template>

<style scoped>
.note { font-size: 11.5px; color: var(--muted); line-height: 1.6; }
</style>
