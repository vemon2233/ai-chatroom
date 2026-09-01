<script setup lang="ts">
import { ref, watch } from 'vue';
import { store } from '../store';
import { api } from '../api';

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
  <Teleport to="body">
    <div v-if="model" class="mask" @click.self="model = false">
      <div class="drawer">
        <header>房间设置 <button class="close" @click="model = false">✕</button></header>
        <div class="body">
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
        </div>
        <footer>
          <button class="btn btn-ghost" @click="model = false">取消</button>
          <button class="btn btn-primary" @click="save">保存(即时生效)</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 16, 20, 0.35);
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  z-index: 50;
}
.drawer {
  width: 360px;
  max-width: 92vw;
  height: 100%;
  background: var(--panel);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  animation: slide-in 0.18s ease-out;
}
@keyframes slide-in {
  from { transform: translateX(30px); opacity: 0.4; }
  to { transform: none; opacity: 1; }
}
header {
  padding: 15px 18px;
  font-size: 14.5px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-soft);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.close { color: var(--muted); font-size: 14px; }
.body { padding: 16px 18px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; }
.note { font-size: 11.5px; color: var(--muted); line-height: 1.6; }
footer {
  margin-top: auto;
  padding: 13px 18px;
  border-top: 1px solid var(--border-soft);
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}
</style>
