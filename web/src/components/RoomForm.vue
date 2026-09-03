<script setup lang="ts">
// RoomForm 原语:房间字段表单的唯一实现(新建房间 / 房间设置共用)。
// mode='create':全部可编辑(项目目录/权限在此确定)。
// mode='settings':项目目录/工具权限禁用(建房时锁定——历史讨论的语境依赖它们),
//                 其余(名称/主题/长度/接棒上限/主持人)可改即时生效。

import { ref, watch } from 'vue';
import { store } from '../store';
import type { RoomConfig } from '@server/core/types';

const props = withDefaults(defineProps<{
  mode: 'create' | 'settings';
  /** settings 模式的预填 */
  room?: RoomConfig | null;
}>(), { room: null });

const emit = defineEmits<{ (e: 'submit', body: RoomFormBody): void }>();

export interface RoomFormBody {
  name: string;
  topic: string;
  speechLength: 'short' | 'normal' | 'long';
  projectPath: string;
  toolPermission: 'readonly' | 'readwrite' | 'full';
  chainBudget: number;
  moderatorId: string;
}

const name = ref('');
const topic = ref('');
const speechLength = ref<'short' | 'normal' | 'long'>('normal');
const projectPath = ref('');
const toolPermission = ref<'readonly' | 'readwrite' | 'full'>('readonly');
const chainBudget = ref(6);
const moderatorId = ref('');

const isCreate = () => props.mode === 'create';

watch(
  () => props.room,
  (r) => {
    if (r) {
      name.value = r.name;
      topic.value = r.topic;
      speechLength.value = r.speechLength;
      projectPath.value = r.projectPath ?? '';
      toolPermission.value = r.toolPermission;
      chainBudget.value = r.chainBudget;
      moderatorId.value = r.moderatorId ?? '';
    } else {
      name.value = '';
      topic.value = '';
      speechLength.value = 'normal';
      projectPath.value = '';
      toolPermission.value = 'readonly';
      chainBudget.value = 6;
      moderatorId.value = '';
    }
  },
  { immediate: true },
);

function submit() {
  emit('submit', {
    name: name.value.trim() || (isCreate() ? '新房间' : name.value.trim()),
    topic: topic.value.trim() || (isCreate() ? '自由聊天' : topic.value.trim()),
    speechLength: speechLength.value,
    projectPath: projectPath.value.trim(),
    toolPermission: projectPath.value.trim() ? toolPermission.value : 'readonly',
    chainBudget: Math.max(1, Math.min(50, chainBudget.value || 6)),
    moderatorId: moderatorId.value,
  });
}

function reset() {
  name.value = '';
  topic.value = '';
  speechLength.value = 'normal';
  projectPath.value = '';
  toolPermission.value = 'readonly';
  chainBudget.value = 6;
  moderatorId.value = '';
}

defineExpose({ submit, reset });
</script>

<template>
  <!-- 单根容器(宿主 v-show/布局锚点) -->
  <div class="room-form">
    <div class="form-row">
      <label>房间名称</label>
      <input v-model="name" type="text" placeholder="例如:技术选型讨论" />
    </div>

    <div class="form-row">
      <label>主题 / 讨论题目</label>
      <textarea v-model="topic" placeholder="例如:React 和 Vue 该选哪个?考虑团队规模和学习成本"></textarea>
    </div>

    <div class="grid2-eq">
      <div class="form-row">
        <label>发言长度<span v-if="isCreate()" class="field-hint">(进房后可随时改)</span></label>
        <select v-model="speechLength">
          <option value="short">简短(300字内,快节奏交锋)</option>
          <option value="normal">标准(600字内,论证完整)</option>
          <option value="long">详尽(不限长,充分展开论述)</option>
        </select>
      </div>
      <div class="form-row">
        <label>接棒上限<span v-if="!isCreate()" class="field-hint">(即时生效)</span></label>
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

    <!-- 主持人只在 settings 模式显示(建房时还没有成员) -->
    <div v-if="!isCreate()" class="form-row">
      <label>主持人(@allN 轮流时每轮末小结;留空 = 无)</label>
      <select v-model="moderatorId">
        <option value="">(无)</option>
        <option v-for="m in store.currentRoom?.config.members ?? []" :key="m.id" :value="m.id">
          {{ m.name }}
        </option>
      </select>
    </div>

    <slot name="after-form" />
  </div>
</template>

<style scoped>
.room-form { display: flex; flex-direction: column; gap: 14px; }
.grid2-eq { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
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
</style>
