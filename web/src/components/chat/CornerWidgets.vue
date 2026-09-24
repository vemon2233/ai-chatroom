<script setup lang="ts">
// 右下角仪表容器(工单17):统一布局协议——
// 小条一行横排(Todo 条 + HUD 条,同样式);弹层共享一列(absolute 锚定行上方,
// 同宽 300px,同时展开则上下堆叠不遮挡)。子组件 HudPanel/TodoPanel 以
// part='bar'|'panel' 双态渲染,open 状态由本容器持有(受控)。

import { ref } from 'vue';
import HudPanel from './HudPanel.vue';
import TodoPanel from './TodoPanel.vue';

defineProps<{ mode: 'room' | 'direct' }>();

const openHud = ref(false);
const openTodo = ref(false);
</script>

<template>
  <div class="corner-widgets">
    <!-- 共享弹层列:锚定行上方,右对齐;两面板同宽,同时开自然堆叠 -->
    <div class="pop-col">
      <TodoPanel v-if="openTodo" :mode="mode" part="panel" v-model:open="openTodo" />
      <HudPanel v-if="openHud" :mode="mode" part="panel" v-model:open="openHud" />
    </div>

    <!-- 小条行 -->
    <div class="bars-row">
      <TodoPanel :mode="mode" part="bar" v-model:open="openTodo" />
      <HudPanel :mode="mode" part="bar" v-model:open="openHud" />
    </div>
  </div>
</template>

<style scoped>
.corner-widgets {
  position: relative; /* 弹层列锚点 */
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;
}

.bars-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 弹层列:行上方 6px,右对齐;面板纵向堆叠 */
.pop-col {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
  z-index: 20;
}
</style>
