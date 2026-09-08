<script setup lang="ts">
// DialogHost:全局唯一对话框渲染点(App.vue 挂载一次)。
// 承载 useDialog 发起的 confirm/prompt/alert,压在一切覆盖层之上(--z-dialog)。

import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { dialogState, settleDialog } from '@/composables/useDialog';

const { t } = useI18n();
const inputValue = ref('');
const d = dialogState;

watch(
  () => d.current?.id,
  () => {
    if (d.current?.kind === 'prompt') {
      inputValue.value = d.current.defaultValue ?? '';
    }
  },
);

function ok() {
  if (!d.current) return;
  if (d.current.kind === 'prompt') settleDialog(inputValue.value);
  else settleDialog(true);
}

function cancel() {
  settleDialog(null);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && d.current?.kind !== 'alert') {
    e.preventDefault();
    ok();
  } else if (e.key === 'Escape') {
    cancel();
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="d.current" class="overlay-mask dialog-layer" @click.self="cancel">
      <div class="overlay-window dialog">
        <header class="overlay-header">
          <span class="overlay-title">{{ d.current.title }}</span>
        </header>
        <div class="overlay-body">
          <div class="dlg-message">{{ d.current.message }}</div>
          <input
            v-if="d.current.kind === 'prompt'"
            v-model="inputValue"
            type="text"
            autofocus
            @keydown="onKeydown"
          />
          <div v-if="d.current.kind === 'prompt'" class="dlg-hint">{{ t('ui.dialogHint') }}</div>
        </div>
        <footer class="overlay-footer">
          <button v-if="d.current.kind !== 'alert'" class="btn btn-ghost" @click="cancel">{{ t('ui.cancel') }}</button>
          <button
            class="btn"
            :class="d.current.danger ? 'btn-danger-solid' : 'btn-primary'"
            @click="ok"
          >
            {{ d.current.confirmText ?? (d.current.kind === 'alert' ? t('ui.gotIt') : t('ui.confirm')) }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-layer { z-index: var(--z-dialog); }
.dialog { width: 400px; }
.dlg-message { font-size: 13.5px; line-height: 1.65; color: var(--text); white-space: pre-wrap; }
.dlg-hint { font-size: 11px; color: var(--muted); margin-top: 6px; }
</style>
