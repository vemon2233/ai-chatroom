<script setup lang="ts">
// InspectorDirectManage: 右侧 Inspector 中的角色管理面板
// 边 1v1 私聊边微调人设 Prompt 与模型参数，支持上下文模式切换与角色删除

import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { store, refreshCharacters, closeSession, closeInspector } from '@/store';
import { api } from '@/services/api';
import { dialog } from '@/composables/useDialog';
import { downloadFile } from '@/utils/download';
import type { Character, UserPersonaSnapshot } from '@server/core/types';
import CharacterForm from '@/components/modals/CharacterForm.vue';
import UserPersonaSelector from '@/components/chat/inspector/UserPersonaSelector.vue';

const formRef = ref<InstanceType<typeof CharacterForm> | null>(null);
const isSaving = ref(false);
const saveSuccess = ref(false);
const errorMessage = ref('');
const { t } = useI18n();

const userPersona = ref<UserPersonaSnapshot | null>(null);
const isMetaSaving = ref(false);
const metaSaveSuccess = ref(false);
const metaError = ref('');

const character = computed<Character | null>(() => store.currentDirectChar);
const isDirectLocked = computed(() => store.directMessages.length > 0);

watch(
  () => character.value?.id,
  async (cid) => {
    formRef.value?.reset?.();
    saveSuccess.value = false;
    errorMessage.value = '';
    metaSaveSuccess.value = false;
    metaError.value = '';
    if (cid) {
      try {
        const meta = await api.getDirectMeta(cid);
        userPersona.value = meta?.userPersona ?? null;
      } catch (e: any) {
        userPersona.value = null;
      }
    } else {
      userPersona.value = null;
    }
  },
  { immediate: true },
);

async function handleSavePersona(persona?: UserPersonaSnapshot | null) {
  if (!character.value) return;
  const targetPersona = persona !== undefined ? persona : userPersona.value;
  isMetaSaving.value = true;
  metaSaveSuccess.value = false;
  metaError.value = '';
  try {
    const updated = await api.updateDirectMeta(character.value.id, {
      userPersona: targetPersona,
    });
    userPersona.value = updated.meta?.userPersona ?? null;
    metaSaveSuccess.value = true;
    setTimeout(() => {
      metaSaveSuccess.value = false;
    }, 1500);
  } catch (err: any) {
    metaError.value = err?.message || t('inspector.directManage.savePersonaFailed');
  } finally {
    isMetaSaving.value = false;
  }
}

function handleExportCharacter() {
  if (!character.value) return;
  downloadFile(api.exportCharacterUrl(character.value.id), `${character.value.name}.json`);
}

async function handleSubmit(body: Omit<Character, 'id' | 'createdAt'>) {
  if (!character.value) return;
  isSaving.value = true;
  saveSuccess.value = false;
  errorMessage.value = '';
  try {
    const updated = await api.updateCharacter(character.value.id, body);
    store.currentDirectChar = updated;
    await refreshCharacters();
    saveSuccess.value = true;
    setTimeout(() => {
      saveSuccess.value = false;
    }, 2000);
  } catch (err: any) {
    errorMessage.value = err?.message || t('inspector.directManage.saveCharFailed');
  } finally {
    isSaving.value = false;
  }
}

async function handleDeleteCharacter() {
  if (!character.value) return;
  const targetId = character.value.id;
  const targetName = character.value.name;

  const ok = await dialog.confirm(
    t('inspector.directManage.deleteConfirmTitle'),
    t('inspector.directManage.deleteConfirmBody', { name: targetName }),
    { danger: true, confirmText: t('inspector.directManage.deleteConfirmBtn') },
  );
  if (!ok) return;

  closeInspector();
  await closeSession({ type: 'direct', characterId: targetId });
  await api.deleteCharacter(targetId);
  await refreshCharacters();
}
</script>

<template>
  <div class="inspector-direct-manage">
    <div class="manage-subbar">
      <div class="subbar-meta">
        <span class="meta-title">{{ t('inspector.directManage.title') }}</span>
      </div>
      <div class="subbar-actions">
        <button
          type="button"
          class="btn-export btn btn-secondary"
          @click="handleExportCharacter"
        >
          {{ t('inspector.directManage.exportCharacter') }}
        </button>
        <button
          type="button"
          class="btn-save btn btn-primary"
          :disabled="isSaving"
          @click="formRef?.submit()"
        >
          {{ isSaving ? t('inspector.directManage.saving') : t('inspector.directManage.savePersona') }}
        </button>
      </div>
    </div>

    <!-- 成功或错误通知提示条 -->
    <div v-if="saveSuccess || metaSaveSuccess" class="alert-bar success">
      ✓ {{ saveSuccess ? t('inspector.directManage.toastCharUpdated') : t('inspector.directManage.toastPersonaApplied') }}
    </div>
    <div v-if="errorMessage || metaError" class="alert-bar error">
      {{ errorMessage || metaError }}
    </div>

    <!-- 角色表单主体: 单层平级，零嵌套套娃 -->
    <div class="manage-body">
      <div class="form-row">
        <label>
          {{ t('inspector.directManage.myPersona') }}
          <span v-if="isDirectLocked" class="lock-pill">{{ t('inspector.directManage.lockPill') }}</span>
        </label>
        <UserPersonaSelector
          v-model="userPersona"
          :is-locked="isDirectLocked"
          @change="handleSavePersona"
        />
      </div>

      <CharacterForm
        ref="formRef"
        :character="character"
        @submit="handleSubmit"
      />

      <!-- 底部危险区 -->
      <div class="danger-zone">
        <div class="danger-title">{{ t('inspector.directManage.dangerTitle') }}</div>
        <div class="danger-row">
          <div class="danger-desc">
            <span class="danger-name">{{ t('inspector.directManage.deleteCharName') }}</span>
            <span class="danger-sub">{{ t('inspector.directManage.deleteCharSub') }}</span>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-danger-action"
            @click="handleDeleteCharacter"
          >
            {{ t('inspector.directManage.deleteCharBtn') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inspector-direct-manage {
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
  gap: 18px;
}

.lock-pill {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--muted);
  background: var(--border-soft);
  border-radius: 10px;
  padding: 1px 8px;
  margin-left: 6px;
}

/* 适配内嵌表单样式 */
.manage-body :deep(.char-form) {
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
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
