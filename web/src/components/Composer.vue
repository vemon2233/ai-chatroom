<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store';
import { api } from '../api';

const text = ref('');
const inputEl = ref<HTMLTextAreaElement | null>(null);

const busy = computed(() => {
  const room = store.currentRoom;
  if (!room) return false;
  return Object.values(room.statuses).some((s) => s === 'thinking' || s === 'streaming');
});

async function send() {
  const t = text.value.trim();
  if (!t || !store.currentRoom) return;
  text.value = '';
  await api.say(store.currentRoom.config.id, t);
}

async function onStop() {
  if (!store.currentRoom) return;
  await api.stop(store.currentRoom.config.id);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void send();
  }
}
</script>

<template>
  <div class="composer">
    <textarea
      ref="inputEl"
      v-model="text"
      rows="1"
      placeholder="直接发言=自由讨论(接棒);@名字 点名;@all2 轮流2轮"
      @keydown="onKeydown"
    ></textarea>
    <button v-if="!busy" class="btn btn-primary send" @click="send">发送</button>
    <button v-else class="btn stop send" @click="onStop">‖ 停止</button>
  </div>
  <div class="hint">无@=接棒模式 · @成员名=点名(答完即止) · @allN=轮流N轮 · Enter 发送 / Shift+Enter 换行</div>
</template>

<style scoped>
.composer {
  background: var(--panel);
  border-top: 1px solid var(--border-soft);
  padding: 12px 18px 6px;
  display: flex;
  gap: 10px;
  align-items: flex-end;
}
textarea {
  flex: 1;
  resize: none;
  min-height: 42px;
  max-height: 140px;
}
.send { padding: 11px 22px; }
.send.stop { background: var(--danger); color: #fff; }
.hint {
  background: var(--panel);
  padding: 0 18px 10px;
  font-size: 11px;
  color: var(--muted);
}
</style>
