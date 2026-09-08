<script setup lang="ts">
import { computed } from 'vue';
import { store } from '@/store';
import { initialsFor } from '@/utils/avatar';
import type { UserPersonaSnapshot } from '@server/core/types';

const props = withDefaults(
  defineProps<{
    modelValue?: UserPersonaSnapshot | null;
    isLocked?: boolean;
    label?: string;
  }>(),
  {
    modelValue: null,
    isLocked: false,
    label: '',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', val: UserPersonaSnapshot | null): void;
  (e: 'change', val: UserPersonaSnapshot | null): void;
}>();

const selectedCharId = computed({
  get: () => props.modelValue?.characterId ?? (props.modelValue ? '__custom__' : ''),
  set: (val: string) => {
    let next: UserPersonaSnapshot | null = null;
    if (val) {
      const found = store.characters.find((c) => c.id === val);
      if (found) {
        next = {
          characterId: found.id,
          name: found.name,
          color: found.color,
          persona: found.persona,
        };
      }
    }
    emit('update:modelValue', next);
    emit('change', next);
  },
});

const currentPersona = computed(() => props.modelValue);
</script>

<template>
  <div class="user-persona-selector">
    <!-- 仅当宿主明确传入 label 时展示，默认由外部 .form-row > label 控制，防止套娃双重标题 -->
    <div v-if="label" class="field-header">
      <label class="field-label">{{ label }}</label>
      <span v-if="isLocked" class="lock-pill">已有消息锁定</span>
    </div>

    <div class="select-wrapper">
      <select
        v-model="selectedCharId"
        class="persona-select"
        :disabled="isLocked"
      >
        <option value="">默认 (以「用户」身份发言)</option>
        <optgroup v-if="store.characters.length > 0" label="角色库">
          <option v-for="c in store.characters" :key="c.id" :value="c.id">
            {{ c.name }} ({{ c.adapter }})
          </option>
        </optgroup>
      </select>
    </div>

    <div v-if="isLocked" class="locked-hint">
      🔒 会话已有消息记录，身份设定已锁定。如需更换请先清空历史消息。
    </div>

    <!-- 选中身份的轻量预览条：极简微卡片，无深色侵入，完全契合纸面质感 -->
    <div v-if="currentPersona" class="persona-chip">
      <div
        class="chip-avatar"
        :style="{ background: currentPersona.color || '#5B6AFF' }"
      >
        {{ initialsFor(currentPersona.name) }}
      </div>
      <div class="chip-info">
        <div class="chip-name-row">
          <span class="chip-name">{{ currentPersona.name }}</span>
          <span class="chip-tag">我的化身</span>
        </div>
        <div class="chip-desc" :title="currentPersona.persona">
          {{ currentPersona.persona || '无详细设定' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 彻底去壳：零背景、零边框、零内边距，作为纯粹的表单项嵌入 */
.user-persona-selector {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.field-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
}

.field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}

.lock-pill {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--muted);
  background: var(--border-soft);
  border-radius: 10px;
  padding: 1px 8px;
}

.select-wrapper {
  width: 100%;
}

/* 严格对齐全局表单 select 样式 */
.persona-select {
  width: 100%;
  height: 38px;
  padding: 0 10px;
  font-size: 13px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  outline: none;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.persona-select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-soft);
}

.persona-select:disabled {
  cursor: not-allowed;
  background: var(--panel-softer);
  color: var(--muted);
  border-color: var(--border-soft);
}

/* 锁定提示条：柔和的暖黄微光，无黑底侵染 */
.locked-hint {
  font-size: 11.5px;
  color: #b45309;
  background: #fef3c7;
  border: 1px solid #fde68a;
  border-radius: 6px;
  padding: 6px 10px;
  line-height: 1.4;
}

/* 预览条：纸面微卡片质感 */
.persona-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--panel-softer);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  margin-top: 2px;
}

.chip-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  flex-shrink: 0;
}

.chip-info {
  min-width: 0;
  flex: 1;
}

.chip-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.chip-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}

.chip-tag {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 1px 6px;
  border-radius: 4px;
}

.chip-desc {
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}
</style>
