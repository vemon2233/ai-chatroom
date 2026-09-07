<script setup lang="ts">
// InspectorRoomManage: 右侧 Inspector 中的房间管理面板
// 边聊边改，即时更新房间配置与参数

import { computed, ref, watch } from 'vue';
import { store, refreshRooms, closeRoom, closeInspector } from '@/store';
import { api } from '@/services/api';
import { dialog } from '@/composables/useDialog';
import type { RoomConfig } from '@server/core/types';
import RoomForm, { type RoomFormBody } from '@/components/modals/RoomForm.vue';

const formRef = ref<InstanceType<typeof RoomForm> | null>(null);
const isSaving = ref(false);
const saveSuccess = ref(false);
const errorMessage = ref('');

const room = computed<RoomConfig | null>(() => store.currentRoom?.config ?? null);

watch(
  () => room.value?.id,
  () => {
    formRef.value?.reset?.();
    saveSuccess.value = false;
    errorMessage.value = '';
  },
);

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
      mode: body.mode,
      contextMode: body.contextMode,
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
    errorMessage.value = err?.message || '保存设置失败';
  } finally {
    isSaving.value = false;
  }
}

async function handleDeleteRoom() {
  if (!room.value) return;
  const targetId = room.value.id;
  const targetName = room.value.name;

  const ok = await dialog.confirm(
    '删除房间',
    `确定删除房间「${targetName}」吗？聊天历史文件将保留（重启后不再复活）。`,
    { danger: true, confirmText: '删除房间' },
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
        <span class="meta-title">房间管理</span>
      </div>
      <button type="button" class="btn-save btn btn-primary" :disabled="isSaving" @click="formRef?.submit()">
        {{ isSaving ? '保存中...' : '保存设置' }}
      </button>
    </div>

    <!-- 成功或错误通知提示条 -->
    <div v-if="saveSuccess" class="alert-bar success">
      ✓ 设置已保存并即时生效
    </div>
    <div v-if="errorMessage" class="alert-bar error">
      {{ errorMessage }}
    </div>

    <!-- 房间表单主体 -->
    <div class="manage-body">
      <RoomForm ref="formRef" mode="settings" :room="room" @submit="handleSubmit" />

      <!-- 底部危险区 -->
      <div class="danger-zone">
        <div class="danger-title">危险区域</div>
        <div class="danger-row">
          <div class="danger-desc">
            <span class="danger-name">删除此房间</span>
            <span class="danger-sub">解散当前房间讨论，关闭全部会话窗口</span>
          </div>
          <button type="button" class="btn btn-ghost btn-danger-action" @click="handleDeleteRoom">
            删除房间
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
