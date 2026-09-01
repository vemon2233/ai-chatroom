<script setup lang="ts">
import { ref, watch } from 'vue';
import { store, refreshRooms, enterRoom } from '../store';
import { api, type CreateRoomBody } from '../api';
import Modal from './ui/Modal.vue';

const model = defineModel<boolean>({ default: false });

const name = ref('');
const topic = ref('');
const speechLength = ref<'short' | 'normal' | 'long'>('normal');
const projectPath = ref('');
const toolPermission = ref<'readonly' | 'readwrite' | 'full'>('readonly');

watch(model, (open) => {
  if (open) {
    name.value = '';
    topic.value = '';
    speechLength.value = 'normal';
    projectPath.value = '';
    toolPermission.value = 'readonly';
  }
});

async function create() {
  const body: CreateRoomBody = {
    name: name.value.trim() || '新房间',
    topic: topic.value.trim() || '自由聊天',
    speechLength: speechLength.value,
    projectPath: projectPath.value.trim() || undefined,
    toolPermission: projectPath.value.trim() ? toolPermission.value : 'readonly',
    members: [],
  };
  const j = await api.createRoom(body);
  model.value = false;
  await refreshRooms();
  await enterRoom(j.id);
}
</script>

<template>
  <Modal v-model="model" title="新建房间">
    <div class="form-row">
      <label>房间名称</label>
      <input v-model="name" type="text" placeholder="例如:技术选型讨论" />
    </div>
    <div class="form-row">
      <label>主题 / 讨论题目</label>
      <textarea v-model="topic" placeholder="例如:React 和 Vue 该选哪个?考虑团队规模和学习成本"></textarea>
    </div>
    <div class="form-row">
      <label>发言长度(AI 成员每次发言的详细程度;进房后可随时改)</label>
      <select v-model="speechLength">
        <option value="short">简短(300字内,快节奏交锋)</option>
        <option value="normal">标准(600字内,论证完整)</option>
        <option value="long">详尽(不限长,充分展开论述)</option>
      </select>
    </div>
    <div class="form-row">
      <label>项目目录(可选——绑定后成员可用工具阅读该项目,围绕真实代码讨论)</label>
      <input v-model="projectPath" type="text" placeholder="D:\path\to\project(留空则纯话题讨论)" />
    </div>
    <div v-if="projectPath.trim()" class="form-row">
      <label>成员工具权限(作用于绑定的项目)</label>
      <div class="perm-row">
        <label class="perm" :class="{ sel: toolPermission === 'readonly' }">
          <input v-model="toolPermission" type="radio" value="readonly" />
          <span><b>只读</b>可读/搜项目文件,不可改</span>
        </label>
        <label class="perm" :class="{ sel: toolPermission === 'readwrite' }">
          <input v-model="toolPermission" type="radio" value="readwrite" />
          <span><b>读写</b>可修改项目文件</span>
        </label>
        <label class="perm" :class="{ sel: toolPermission === 'full' }">
          <input v-model="toolPermission" type="radio" value="full" />
          <span><b>完全</b>读写+执行命令(危险)</span>
        </label>
      </div>
    </div>
    <div class="hint">
      创建后进入房间再添加成员(角色库拉入或自定义,像微信群拉人)。<br />
      互动方式不预设——发消息随时切换:<b>直接发言</b>=自由讨论(接棒) · <b>@成员名</b>=点名 · <b>@all2</b>=轮流2轮
    </div>

    <template #footer>
      <button class="btn btn-ghost" @click="model = false">取消</button>
      <button class="btn btn-primary" @click="create">创建并进入</button>
    </template>
  </Modal>
</template>

<style scoped>
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
.perm input { display: none; }
.perm b { font-size: 12.5px; display: block; }
.hint { font-size: 12px; color: var(--muted); line-height: 1.7; }
</style>
