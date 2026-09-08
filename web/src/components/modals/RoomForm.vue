<script setup lang="ts">
// RoomForm 原语:房间字段表单的唯一实现(新建房间 / 房间设置共用)。
// mode='create':全部可编辑(项目目录/权限在此确定)。
// mode='settings':建时属性禁用锁定(讨论模式/上下文模式/项目目录/工具权限建房时确定),
//                 其余(名称/主题/发言长度/发言上限)可改即时生效。

import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { store } from '@/store';
import { COLOR_OPTIONS, colorForName } from '@/utils/avatar';
import type { RoomConfig, UserPersonaSnapshot } from '@server/core/types';
import UserPersonaSelector from '@/components/chat/inspector/UserPersonaSelector.vue';

const { t } = useI18n();

const props = withDefaults(defineProps<{
  mode: 'create' | 'settings';
  /** settings 模式的预填 */
  room?: RoomConfig | null;
  /** 方案 A 锁定：当已有历史消息时锁定身份变更 */
  isLocked?: boolean;
}>(), { room: null, isLocked: false });

const emit = defineEmits<{ (e: 'submit', body: RoomFormBody): void }>();

export interface RoomFormBody {
  name: string;
  color: string;
  topic: string;
  speechLength: 'short' | 'normal' | 'long';
  projectPath: string;
  toolPermission: 'readonly' | 'readwrite' | 'full';
  chainBudget: number;
  mode: 'baton' | 'subscribe';
  contextMode: 'stateless' | 'stateful';
  userPersona?: UserPersonaSnapshot | null;
}

const name = ref('');
const color = ref(COLOR_OPTIONS[0]!.value);
const topic = ref('');
const speechLength = ref<'short' | 'normal' | 'long'>('normal');
const projectPath = ref('');
const toolPermission = ref<'readonly' | 'readwrite' | 'full'>('readonly');
const chainBudget = ref(6);
const mode = ref<'baton' | 'subscribe'>('baton');
const contextMode = ref<'stateless' | 'stateful'>('stateless');
const userPersona = ref<UserPersonaSnapshot | null>(null);

const isCreate = () => props.mode === 'create';

watch(
  () => props.room,
  (r) => {
    if (r) {
      name.value = r.name;
      color.value = r.color || colorForName(r.name);
      topic.value = r.topic;
      speechLength.value = r.speechLength;
      projectPath.value = r.projectPath ?? '';
      toolPermission.value = r.toolPermission;
      chainBudget.value = r.chainBudget;
      mode.value = r.mode ?? 'baton';
      contextMode.value = r.contextMode ?? 'stateless';
      userPersona.value = r.userPersona ?? null;
    } else {
      name.value = '';
      color.value = COLOR_OPTIONS[0]!.value;
      topic.value = '';
      speechLength.value = 'normal';
      projectPath.value = '';
      toolPermission.value = 'readonly';
      chainBudget.value = 6;
      mode.value = 'baton';
      contextMode.value = 'stateless';
      userPersona.value = null;
    }
  },
  { immediate: true },
);

function submit() {
  emit('submit', {
    name: name.value.trim() || (isCreate() ? t('form.defaultRoomName') : name.value.trim()),
    color: color.value,
    topic: topic.value.trim() || (isCreate() ? t('form.defaultTopic') : topic.value.trim()),
    speechLength: speechLength.value,
    projectPath: projectPath.value.trim(),
    toolPermission: projectPath.value.trim() ? toolPermission.value : 'readonly',
    chainBudget: Math.max(1, Math.min(50, chainBudget.value || 6)),
    mode: mode.value,
    contextMode: contextMode.value,
    userPersona: userPersona.value,
  });
}

function reset() {
  if (props.room) {
    name.value = props.room.name;
    color.value = props.room.color || colorForName(props.room.name);
    topic.value = props.room.topic;
    speechLength.value = props.room.speechLength;
    projectPath.value = props.room.projectPath ?? '';
    toolPermission.value = props.room.toolPermission;
    chainBudget.value = props.room.chainBudget;
    mode.value = props.room.mode ?? 'baton';
    contextMode.value = props.room.contextMode ?? 'stateless';
    userPersona.value = props.room.userPersona ?? null;
  } else {
    name.value = '';
    color.value = COLOR_OPTIONS[0]!.value;
    topic.value = '';
    speechLength.value = 'normal';
    projectPath.value = '';
    toolPermission.value = 'readonly';
    chainBudget.value = 6;
    mode.value = 'baton';
    contextMode.value = 'stateless';
    userPersona.value = null;
  }
}

defineExpose({ submit, reset });
</script>

<template>
  <!-- 单根容器(宿主 v-show/布局锚点) -->
  <div class="room-form">
    <div class="form-row">
      <label>{{ t('form.roomNameColor') }}</label>
      <div class="name-color-row">
        <div class="color-select-wrap">
          <span class="color-dot" :style="{ background: color }"></span>
          <select v-model="color" class="color-select" :title="t('form.pickRoomColor')">
            <option v-for="opt in COLOR_OPTIONS" :key="opt.value" :value="opt.value">
              {{ t('color.' + opt.key) }}
            </option>
          </select>
        </div>
        <input v-model="name" type="text" class="name-input" :placeholder="t('form.roomNamePlaceholder')" />
      </div>
    </div>

    <div class="form-row">
      <label>{{ t('form.topicLabel') }}</label>
      <textarea v-model="topic" :placeholder="t('form.topicPlaceholder')"></textarea>
    </div>

    <div class="form-row">
      <label>
        {{ t('form.myPersona') }}
        <span v-if="isLocked" class="lock-pill">{{ t('form.lockedByMessages') }}</span>
      </label>
      <UserPersonaSelector v-model="userPersona" :is-locked="isLocked" />
    </div>

    <div class="grid2-eq">
      <div class="form-row">
        <label class="nowrap-label">{{ t('form.speechLength') }}<span v-if="isCreate()" class="field-hint">{{ t('form.editableHint') }}</span></label>
        <select v-model="speechLength">
          <option value="short" :title="t('form.speechShortTitle')">{{ t('form.speechShort') }}</option>
          <option value="normal" :title="t('form.speechNormalTitle')">{{ t('form.speechNormal') }}</option>
          <option value="long" :title="t('form.speechLongTitle')">{{ t('form.speechLong') }}</option>
        </select>
      </div>
      <div class="form-row">
        <label class="nowrap-label" :title="t('form.chainBudgetTitle')">{{ t('form.chainBudget') }}<span v-if="!isCreate()" class="field-hint">{{ t('form.instantHint') }}</span></label>
        <input v-model.number="chainBudget" type="number" min="1" max="50" />
      </div>
    </div>

    <!-- 建时锁定区:settings 模式禁用 -->
    <div class="form-row" :class="{ 'row-locked': !isCreate() }">
      <label>{{ t('form.modeLabel') }}<span v-if="!isCreate()" class="lock-pill">{{ t('form.lockedAfterCreate') }}</span></label>
      <div class="perm-row">
        <label class="perm" :class="{ sel: mode === 'baton', dis: !isCreate() }">
          <input v-model="mode" type="radio" value="baton" :disabled="!isCreate()" />
          <span><b>{{ t('form.modeBatonLabel') }}</b>{{ t('form.modeBatonDesc') }}</span>
        </label>
        <label class="perm" :class="{ sel: mode === 'subscribe', dis: !isCreate() }">
          <input v-model="mode" type="radio" value="subscribe" :disabled="!isCreate()" />
          <span><b>{{ t('form.modeSubscribeLabel') }}</b>{{ t('form.modeSubscribeDesc') }}</span>
        </label>
      </div>
    </div>

    <div class="form-row" :class="{ 'row-locked': !isCreate() }">
      <label>{{ t('form.contextModeLabel') }}<span v-if="!isCreate()" class="lock-pill">{{ t('form.lockedAfterCreate') }}</span></label>
      <div class="perm-row">
        <label class="perm" :class="{ sel: contextMode === 'stateless', dis: !isCreate() }">
          <input v-model="contextMode" type="radio" value="stateless" :disabled="!isCreate()" />
          <span><b>{{ t('form.ctxStatelessLabel') }}</b>{{ t('form.ctxStatelessDesc') }}</span>
        </label>
        <label class="perm" :class="{ sel: contextMode === 'stateful', dis: !isCreate() }">
          <input v-model="contextMode" type="radio" value="stateful" :disabled="!isCreate()" />
          <span><b>{{ t('form.ctxStatefulLabel') }}</b>{{ t('form.ctxStatefulDesc') }}</span>
        </label>
      </div>
    </div>

    <div class="form-row">
      <label>{{ t('form.projectDir') }}<span v-if="!isCreate()" class="lock-pill">{{ t('form.lockedAfterCreate') }}</span></label>
      <input
        v-model="projectPath"
        type="text"
        :disabled="!isCreate()"
        :placeholder="t('form.projectPathPlaceholder')"
      />
    </div>
    <div class="form-row" :class="{ 'row-locked': !isCreate() }">
      <label>{{ t('form.toolPerm') }}<span v-if="!isCreate()" class="lock-pill">{{ t('form.toolPermScope') }}</span></label>
      <div class="perm-row">
        <label class="perm" :class="{ sel: toolPermission === 'readonly', dis: !isCreate() }">
          <input v-model="toolPermission" type="radio" value="readonly" :disabled="!isCreate()" />
          <span><b>{{ t('form.permReadonlyLabel') }}</b>{{ t('form.permReadonlyDesc') }}</span>
        </label>
        <label class="perm" :class="{ sel: toolPermission === 'readwrite', dis: !isCreate() }">
          <input v-model="toolPermission" type="radio" value="readwrite" :disabled="!isCreate()" />
          <span><b>{{ t('form.permReadwriteLabel') }}</b>{{ t('form.permReadwriteDesc') }}</span>
        </label>
        <label class="perm" :class="{ sel: toolPermission === 'full', dis: !isCreate() }">
          <input v-model="toolPermission" type="radio" value="full" :disabled="!isCreate()" />
          <span><b>{{ t('form.permFullLabel') }}</b>{{ t('form.permFullDesc') }}</span>
        </label>
      </div>
    </div>

    <slot name="after-form" />
  </div>
</template>

<style scoped>
.room-form { display: flex; flex-direction: column; gap: 14px; }
.grid2-eq {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.grid2-eq > .form-row {
  min-width: 0;
}
.grid2-eq select,
.grid2-eq input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.nowrap-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.field-hint { font-size: 10.5px; font-weight: 400; color: var(--muted); margin-left: 4px; }
.lock-pill {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--muted);
  margin-left: 6px;
  background: var(--border-soft);
  border-radius: 10px;
  padding: 1px 8px;
}

.row-locked input { background: var(--border-soft); }
.perm-row { display: flex; gap: 8px; }
.perm {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 8px;
  display: flex;
  gap: 6px;
  align-items: flex-start;
  cursor: pointer;
  font-size: 12px;
  font-weight: 400;
  transition: border-color 0.15s;
}
.perm.sel { border-color: var(--accent); background: var(--accent-soft); }
.perm.dis { cursor: not-allowed; opacity: 0.55; }
.perm.dis.sel { border-color: var(--accent); opacity: 0.75; }
.perm input { display: none; }
.perm b { font-size: 12.5px; display: block; }

.name-color-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.color-select-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.color-dot {
  position: absolute;
  left: 10px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  pointer-events: none;
  border: 1px solid rgba(0, 0, 0, 0.12);
  z-index: 1;
  transition: background 0.15s;
}
.color-select {
  padding-left: 30px;
  padding-right: 18px;
  width: 102px;
  height: 38px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  background: var(--panel);
}
.name-input {
  flex: 1;
  min-width: 0;
  height: 38px;
}
</style>
