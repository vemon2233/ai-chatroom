<script setup lang="ts">
// EmojiSelect 原语:头像选择的唯一实现(建房/角色/添加成员三弹窗共用)。
// 收起 = 44px 瓷片显示当前 emoji;展开 = 浮层网格点选。

import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: string;
  /** 候选集(默认通用头像) */
  choices?: string[];
}>(), {
  choices: () => [
    '💬', '🗣️', '⚖️', '🔬', '🧭', '🏗️',
    '🎮', '📊', '🔥', '💡', '🎯', '📋',
    '🤖', '🦉', '🐺', '🧙', '🕵️', '🧑‍🔧',
  ],
});

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);

function toggle() {
  open.value = !open.value;
}

function pick(e: string) {
  emit('update:modelValue', e);
  open.value = false;
}

function onDocClick(ev: MouseEvent) {
  if (open.value && rootEl.value && !rootEl.value.contains(ev.target as Node)) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener('mousedown', onDocClick));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));
</script>

<template>
  <div ref="rootEl" class="emoji-select">
    <button type="button" class="tile" :class="{ open }" title="选择头像" @click="toggle">
      <span class="tile-emoji">{{ modelValue }}</span>
      <span class="tile-caret">▾</span>
    </button>
    <div v-if="open" class="pop">
      <button
        v-for="e in choices"
        :key="e"
        type="button"
        class="opt"
        :class="{ sel: e === modelValue }"
        @click="pick(e)"
      >{{ e }}</button>
    </div>
  </div>
</template>

<style scoped>
.emoji-select { position: relative; width: 52px; flex-shrink: 0; }

.tile {
  width: 52px;
  height: 52px;
  border-radius: 11px;
  border: 1px solid var(--border);
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: border-color 0.12s;
}
.tile:hover, .tile.open { border-color: var(--accent); }
.tile-emoji { font-size: 24px; line-height: 1; }
.tile-caret {
  position: absolute;
  right: 3px;
  bottom: 1px;
  font-size: 9px;
  color: var(--muted);
}

.pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 10;
  width: 232px; /* 6 列 */
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-md);
  padding: 6px;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 2px;
}
.opt {
  font-size: 19px;
  padding: 5px 0;
  border-radius: 7px;
  border: 1px solid transparent;
  transition: background 0.1s, border-color 0.1s;
}
.opt:hover { background: var(--border-soft); }
.opt.sel { border-color: var(--accent); background: var(--accent-soft); }
</style>
