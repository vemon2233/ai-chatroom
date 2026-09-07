<script setup lang="ts">
// RoomForm 原语:房间字段表单的唯一实现(新建房间 / 房间设置共用)。
// mode='create':全部可编辑(项目目录/权限在此确定)。
// mode='settings':项目目录/工具权限禁用(建房时锁定——历史讨论的语境依赖它们),
//                 其余(名称/主题/长度/接棒上限等)可改即时生效。

import { ref, watch } from 'vue';
import { store } from '@/store';
import { COLOR_OPTIONS, colorForName } from '@/utils/avatar';
import type { RoomConfig } from '@server/core/types';

const props = withDefaults(defineProps<{
  mode: 'create' | 'settings';
  /** settings 模式的预填 */
  room?: RoomConfig | null;
}>(), { room: null });

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
    }
  },
  { immediate: true },
);

function submit() {
  emit('submit', {
    name: name.value.trim() || (isCreate() ? '新房间' : name.value.trim()),
    color: color.value,
    topic: topic.value.trim() || (isCreate() ? '自由聊天' : topic.value.trim()),
    speechLength: speechLength.value,
    projectPath: projectPath.value.trim(),
    toolPermission: projectPath.value.trim() ? toolPermission.value : 'readonly',
    chainBudget: Math.max(1, Math.min(50, chainBudget.value || 6)),
    mode: mode.value,
    contextMode: contextMode.value,
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
  }
}

defineExpose({ submit, reset });
</script>

<template>
  <!-- 单根容器(宿主 v-show/布局锚点) -->
  <div class="room-form">
    <div class="form-row">
      <label>房间名称与颜色</label>
      <div class="name-color-row">
        <div class="color-select-wrap">
          <span class="color-dot" :style="{ background: color }"></span>
          <select v-model="color" class="color-select" title="选择房间背景颜色">
            <option v-for="opt in COLOR_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <input v-model="name" type="text" class="name-input" placeholder="例如:技术选型讨论" />
      </div>
    </div>

    <div class="form-row">
      <label>主题 / 讨论题目</label>
      <textarea v-model="topic" placeholder="例如:React 和 Vue 该选哪个?考虑团队规模和学习成本"></textarea>
    </div>

    <!-- 讨论模式选择 -->
    <div class="form-row">
      <label>讨论模式<span v-if="!isCreate()" class="field-hint">(即时生效)</span></label>
      <div class="perm-row">
        <label class="perm" :class="{ sel: mode === 'baton' }">
          <input v-model="mode" type="radio" value="baton" />
          <span><b>接棒模式 (默认)</b>发言者尾行指定下一位, 链式推进</span>
        </label>
        <label class="perm" :class="{ sel: mode === 'subscribe' }">
          <input v-model="mode" type="radio" value="subscribe" />
          <span><b>订阅模式 (去中心群聊)</b>Agent 错峰心跳自主刷群, 支持纯并行发言、沉默与私聊握手</span>
        </label>
      </div>
    </div>

    <!-- 上下文供给模式选择 -->
    <div class="form-row">
      <label>上下文供给模式<span v-if="!isCreate()" class="field-hint">(即时生效)</span></label>
      <div class="perm-row">
        <label class="perm" :class="{ sel: contextMode === 'stateless' }">
          <input v-model="contextMode" type="radio" value="stateless" />
          <span><b>模式 1: 无状态全量 (推荐)</b>每次注入最新完整历史与人设，稳定可靠，重roll/截断极其敏捷</span>
        </label>
        <label class="perm" :class="{ sel: contextMode === 'stateful' }">
          <input v-model="contextMode" type="radio" value="stateful" />
          <span><b>模式 2: 有状态增量 (--resume)</b>首次全量，后续仅投递新增订阅消息，Token 极省，响应极快</span>
        </label>
      </div>
    </div>

    <div class="grid2-eq">
      <div class="form-row">
        <label class="nowrap-label">发言长度<span v-if="isCreate()" class="field-hint">(进房可改)</span></label>
        <select v-model="speechLength">
          <option value="short" title="300字内，快节奏交锋">简短 (约300字)</option>
          <option value="normal" title="600字内，论证完整">标准 (约600字)</option>
          <option value="long" title="不限长，充分展开论述">详尽 (不限长)</option>
        </select>
      </div>
      <div class="form-row">
        <label class="nowrap-label" title="所有讨论模式通用，达到上限后自动暂停讨论，发新消息继续">发言上限 (轮次)<span v-if="!isCreate()" class="field-hint">(即时生效)</span></label>
        <input v-model.number="chainBudget" type="number" min="1" max="50" />
      </div>
    </div>

    <!-- 建时锁定区:settings 模式禁用 -->
    <div class="form-row">
      <label>项目目录<span v-if="!isCreate()" class="lock-pill">创建后不可改</span></label>
      <input
        v-model="projectPath"
        type="text"
        :disabled="!isCreate()"
        placeholder="D:\path\to\project(留空则纯话题讨论)"
      />
    </div>
    <div class="form-row" :class="{ 'row-locked': !isCreate() }">
      <label>成员工具权限<span v-if="!isCreate()" class="lock-pill">作用于绑定项目</span></label>
      <div class="perm-row">
        <label class="perm" :class="{ sel: toolPermission === 'readonly', dis: !isCreate() }">
          <input v-model="toolPermission" type="radio" value="readonly" :disabled="!isCreate()" />
          <span><b>只读</b>可读/搜项目文件,不可改</span>
        </label>
        <label class="perm" :class="{ sel: toolPermission === 'readwrite', dis: !isCreate() }">
          <input v-model="toolPermission" type="radio" value="readwrite" :disabled="!isCreate()" />
          <span><b>读写</b>可修改项目文件</span>
        </label>
        <label class="perm" :class="{ sel: toolPermission === 'full', dis: !isCreate() }">
          <input v-model="toolPermission" type="radio" value="full" :disabled="!isCreate()" />
          <span><b>完全</b>读写+执行命令(危险)</span>
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
