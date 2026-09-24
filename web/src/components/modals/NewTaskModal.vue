<script setup lang="ts">
// 新建任务(工单07):任务专属简表单——任务名/项目路径(必填)/角色(含工程师模板)/权限档(默认 full)。
// 无聊天概念字段(chainBudget/mode/订阅/上下文);kind:'task' 与默认值束由后端 makeRoomConfig 落实。

import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { store, refreshRooms, openRoom, refreshCharacters } from '@/store';
import { api } from '@/services/api';
import Modal from '@/components/ui/Modal.vue';
import { currentLang } from '@/i18n';

const model = defineModel<boolean>({ default: false });
const { t, locale } = useI18n();

/** 工程师模板 persona(任务行为契约的默认版,用户可改) */
const ENGINEER_PERSONA = {
  zh: '你是一名资深软件工程师。用户会给你派编程任务:先探索项目理解现状,再动手实现;改完汇报做了什么、动了哪些文件、如何验证;需求不清或遇到抉择先问,不要基于误解狂奔。',
  en: 'You are a senior software engineer. The user assigns you coding tasks: explore the project first, then implement; when done, report what you did, which files changed, and how you verified it; ask when requirements are unclear or a decision has options — never run long on a misunderstanding.',
};

const name = ref('');
const projectPath = ref('');
const permission = ref<'full' | 'readonly'>('full');
/** 角色:库选 or 工程师模板 */
const charId = ref<string>('');
const customPersona = ref('');
const useTemplate = ref(true);
const error = ref('');
const submitting = ref(false);

const templatePersona = computed(() => ENGINEER_PERSONA[currentLang()]);

watch(model, (open) => {
  if (open) {
    name.value = '';
    projectPath.value = '';
    permission.value = 'full';
    charId.value = '';
    customPersona.value = '';
    useTemplate.value = true;
    error.value = '';
    if (store.characters.length === 0) void refreshCharacters();
  }
});

const selectedChar = computed(() => store.characters.find((c) => c.id === charId.value));
/** 实际生效 persona:库角色用其 persona(可微调),模板用 ENGINEER_PERSONA(可改) */
const effectivePersona = computed(() =>
  useTemplate.value ? (customPersona.value || templatePersona.value) : (customPersona.value || selectedChar.value?.persona || ''),
);

async function submit() {
  error.value = '';
  if (!name.value.trim()) { error.value = t('taskForm.errName'); return; }
  if (!projectPath.value.trim()) { error.value = t('taskForm.errProject'); return; }
  if (!useTemplate.value && !charId.value) { error.value = t('taskForm.errChar'); return; }
  submitting.value = true;
  try {
    const members = useTemplate.value
      ? [{ name: name.value.trim(), adapter: defaultAdapter(), persona: effectivePersona.value }]
      : [{
          name: selectedChar.value!.name,
          adapter: selectedChar.value!.adapter,
          persona: effectivePersona.value,
          characterId: selectedChar.value!.id,
        }];
    const j = await api.createRoom({
      name: name.value.trim(),
      kind: 'task',
      topic: t('taskForm.defaultTopic'),
      projectPath: projectPath.value.trim(),
      toolPermission: permission.value,
      members: members as any,
    });
    model.value = false;
    await refreshRooms();
    store.sidebarTab = 'tasks';
    await openRoom(j.id);
  } catch (e: any) {
    error.value = e?.message || String(e);
  } finally {
    submitting.value = false;
  }
}

function defaultAdapter(): string {
  // 工程师模板默认用第一个适配器(claude 通常居首)
  return store.adapters[0]?.key ?? 'claude';
}
</script>

<template>
  <Modal v-model="model" :title="t('taskForm.title')" width="440px">
    <div class="form">
      <label class="field">
        <span class="label">{{ t('taskForm.name') }}</span>
        <input v-model="name" type="text" :placeholder="t('taskForm.namePh')" @keydown.enter="submit" />
      </label>

      <label class="field">
        <span class="label">{{ t('taskForm.project') }}</span>
        <input v-model="projectPath" type="text" :placeholder="t('taskForm.projectPh')" @keydown.enter="submit" />
        <span class="hint">{{ t('taskForm.projectHint') }}</span>
      </label>

      <div class="field">
        <span class="label">{{ t('taskForm.role') }}</span>
        <div class="role-switch">
          <button class="role-btn" :class="{ active: useTemplate }" @click="useTemplate = true">{{ t('taskForm.roleTemplate') }}</button>
          <button class="role-btn" :class="{ active: !useTemplate }" @click="useTemplate = false">{{ t('taskForm.roleLibrary') }}</button>
        </div>
        <select v-if="!useTemplate" v-model="charId">
          <option value="" disabled>{{ t('taskForm.charPh') }}</option>
          <option v-for="c in store.characters" :key="c.id" :value="c.id">{{ c.name }} · {{ c.adapter }}</option>
        </select>
        <textarea v-model="customPersona" rows="4" :placeholder="useTemplate ? templatePersona : (selectedChar?.persona || t('taskForm.personaPh'))" />
        <span class="hint">{{ t('taskForm.personaHint') }}</span>
      </div>

      <div class="field">
        <span class="label">{{ t('taskForm.permission') }}</span>
        <div class="perm-options">
          <label class="perm" :class="{ active: permission === 'full' }">
            <input v-model="permission" type="radio" value="full" />
            <span class="perm-name">{{ t('taskForm.permFull') }}</span>
            <span class="perm-desc">{{ t('taskForm.permFullDesc') }}</span>
          </label>
          <label class="perm" :class="{ active: permission === 'readonly' }">
            <input v-model="permission" type="radio" value="readonly" />
            <span class="perm-name">{{ t('taskForm.permReadonly') }}</span>
            <span class="perm-desc">{{ t('taskForm.permReadonlyDesc') }}</span>
          </label>
        </div>
      </div>

      <div v-if="error" class="error">{{ error }}</div>
    </div>

    <template #footer>
      <button class="btn btn-ghost" @click="model = false">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" :disabled="submitting" @click="submit">{{ t('taskForm.create') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 5px; }
.label { font-size: 12.5px; font-weight: 600; color: var(--text); }
.hint { font-size: 11.5px; color: var(--muted); line-height: 1.5; }
input[type="text"], select, textarea {
  width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 8px;
  background: var(--panel); color: var(--text); font-size: 13px; padding: 8px 10px;
}
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); }
textarea { resize: vertical; font-family: inherit; }

.role-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.role-btn {
  padding: 7px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel);
  color: var(--text); font-size: 12.5px; cursor: pointer;
}
.role-btn.active { border-color: var(--accent); background: var(--accent-soft); }

.perm-options { display: flex; flex-direction: column; gap: 6px; }
.perm {
  display: grid; grid-template-columns: auto auto 1fr; align-items: baseline; gap: 8px;
  padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; background: var(--panel);
}
.perm.active { border-color: var(--accent); background: var(--accent-soft); }
.perm input { accent-color: var(--accent); }
.perm-name { font-size: 13px; font-weight: 600; color: var(--text); }
.perm-desc { font-size: 11.5px; color: var(--muted); }

.error {
  font-size: 12.5px; color: #d45a5a; background: rgba(212, 90, 90, 0.08);
  border-radius: 6px; padding: 8px 10px;
}
</style>
