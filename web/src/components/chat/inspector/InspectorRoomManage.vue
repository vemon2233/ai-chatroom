<script setup lang="ts">
// InspectorRoomManage: 右侧 Inspector 中的房间管理面板
// 边聊边改，即时更新房间配置与参数

import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { store, refreshRooms, closeRoom, closeInspector } from '@/store';
import { api } from '@/services/api';
import { dialog } from '@/composables/useDialog';
import { downloadFile } from '@/utils/download';
import type { RoomConfig } from '@server/core/types';
import RoomForm, { type RoomFormBody } from '@/components/modals/RoomForm.vue';

const formRef = ref<InstanceType<typeof RoomForm> | null>(null);
const isSaving = ref(false);
const saveSuccess = ref(false);
const errorMessage = ref('');
const { t } = useI18n();

const room = computed<RoomConfig | null>(() => store.currentRoom?.config ?? null);

watch(
  () => room.value?.id,
  () => {
    formRef.value?.reset?.();
    saveSuccess.value = false;
    errorMessage.value = '';
  },
);

function handleExportRoom() {
  if (!room.value) return;
  downloadFile(api.exportRoomUrl(room.value.id), `${room.value.name}.json`);
}

async function handleSubmit(body: RoomFormBody) {
  if (!room.value) return;
  isSaving.value = true;
  saveSuccess.value = false;
  errorMessage.value = '';
  try {
    const updated = await api.updateSettings(room.value.id, {
      name: body.name,
      color: body.color,
      topic: body.topic,
      speechLength: body.speechLength,
      chainBudget: body.chainBudget,
      userPersona: body.userPersona ?? undefined,
    });
    if (store.currentRoom && store.currentRoom.config.id === room.value.id) {
      store.currentRoom = updated;
    }
    await refreshRooms();
    saveSuccess.value = true;
    setTimeout(() => {
      saveSuccess.value = false;
    }, 2000);
  } catch (err: any) {
    errorMessage.value = err?.message || t('inspector.roomManage.saveFailed');
  } finally {
    isSaving.value = false;
  }
}

async function handleDeleteRoom() {
  if (!room.value) return;
  const targetId = room.value.id;
  const targetName = room.value.name;

  const ok = await dialog.confirm(
    t('inspector.roomManage.deleteConfirmTitle'),
    t('inspector.roomManage.deleteConfirmBody', { name: targetName }),
    { danger: true, confirmText: t('inspector.roomManage.deleteConfirmBtn') },
  );
  if (!ok) return;

  closeInspector();
  await api.deleteRoom(targetId);
  await closeRoom(targetId);
  await refreshRooms();
}
</script>

<template>
  <div class="inspector-room-manage">
    <div class="manage-subbar">
      <div class="subbar-meta">
        <span class="meta-title">{{ t('inspector.roomManage.title') }}</span>
      </div>
      <div class="subbar-actions">
        <button type="button" class="btn-export btn btn-secondary" @click="handleExportRoom">
          {{ t('inspector.roomManage.exportConfig') }}
        </button>
        <button type="button" class="btn-save btn btn-primary" :disabled="isSaving" @click="formRef?.submit()">
          {{ isSaving ? t('inspector.roomManage.saving') : t('inspector.roomManage.saveSettings') }}
        </button>
      </div>
    </div>

    <!-- 成功或错误通知提示条 -->
    <div v-if="saveSuccess" class="alert-bar success">
      {{ t('inspector.roomManage.savedToast') }}
    </div>
    <div v-if="errorMessage" class="alert-bar error">
      {{ errorMessage }}
    </div>

    <!-- 房间表单主体 -->
    <div class="manage-body">
      <RoomForm
        ref="formRef"
        mode="settings"
        :room="room"
        :is-locked="store.messages.length > 0"
        @submit="handleSubmit"
      />

      <!-- 底部危险区 -->
      <div class="danger-zone">
        <div class="danger-title">{{ t('inspector.roomManage.dangerTitle') }}</div>
        <div class="danger-row">
          <div class="danger-desc">
            <span class="danger-name">{{ t('inspector.roomManage.deleteRoomName') }}</span>
            <span class="danger-sub">{{ t('inspector.roomManage.deleteRoomSub') }}</span>
          </div>
          <button type="button" class="btn btn-ghost btn-danger-action" @click="handleDeleteRoom">
            {{ t('inspector.roomManage.deleteRoomBtn') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inspector-room-manage {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--panel);
}

.manage-subbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-soft);
  background: var(--panel-softer);
  flex-shrink: 0;
}

.subbar-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.meta-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}

.meta-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-deep);
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
}

.subbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-export {
  display: flex;
  align-items: center;
  padding: 4px 10px;
  font-size: 12px;
  height: auto;
  border-radius: 6px;
  background: var(--panel);
  color: var(--text-muted);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-export:hover {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent-border);
}

.btn-save {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-size: 12px;
  height: auto;
  border-radius: 6px;
  font-weight: 500;
}

.alert-bar {
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  animation: fadeIn 0.2s ease;
}

.alert-bar.success {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  border-bottom: 1px solid rgba(16, 185, 129, 0.25);
}

.alert-bar.error {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  border-bottom: 1px solid rgba(239, 68, 68, 0.25);
}

.manage-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 覆盖并适配内嵌 RoomForm 的间距与尺寸 */
.manage-body :deep(.room-form) {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.manage-body :deep(.form-row) {
  margin-bottom: 0;
}

.manage-body :deep(.form-row label) {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}

.manage-body :deep(input[type="text"]),
.manage-body :deep(input[type="number"]),
.manage-body :deep(textarea),
.manage-body :deep(select) {
  font-size: 12.5px;
}

.danger-zone {
  margin-top: 10px;
  padding-top: 16px;
  border-top: 1px dashed var(--border-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.danger-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--danger);
}

.danger-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 8px;
}

.danger-desc {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.danger-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.danger-sub {
  font-size: 11px;
  color: var(--muted);
}

.btn-danger-action {
  font-size: 12px;
  padding: 5px 12px;
  color: var(--danger);
  border-color: rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  flex-shrink: 0;
  background: var(--panel);
}

.btn-danger-action:hover {
  background: rgba(239, 68, 68, 0.12);
  color: var(--danger);
  border-color: var(--danger);
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
