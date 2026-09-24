<script setup lang="ts">
// Todo 常驻面板(工单16,CLI todo 区的 web 等价):右下角独立浮层,
// HUD 迷你条上方。收起=进度小条(✓ N/M);展开=完整清单(完成划线/进行中紫/待办点)。
// 数据:落库 trace 最新 TodoWrite + 活动缓冲实时 TodoWrite 叠加(取最新;
// CLI 同语义:TodoWrite 一调即更新)。无 todo 时整个面板隐藏。

import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { store } from '@/store';

const { t } = useI18n();

const props = defineProps<{
  mode: 'room' | 'direct';
  /** 渲染部件:bar=小条(容器横排一行)/ panel=弹层面板(容器共享弹层列堆叠) */
  part?: 'bar' | 'panel';
}>();

const open = defineModel<boolean>('open', { default: false });

interface TodoItemVM { content: string; status: string }

/** 解析一份 TodoWrite 的 todos 数组;失败 null */
function parseTodos(raw: string): TodoItemVM[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.todos)) return null;
    return parsed.todos.map((td: any) => ({
      content: String(td.content ?? ''),
      status: String(td.status ?? 'pending'),
    }));
  } catch {
    return null;
  }
}

/** 落库消息里的最新 TodoWrite(倒序找) */
function latestFromHistory(): TodoItemVM[] | null {
  const msgs = props.mode === 'room' ? store.messages : store.directMessages;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const trace = msgs[i]?.detail?.trace ?? [];
    for (let j = trace.length - 1; j >= 0; j--) {
      const e = trace[j]!;
      if (e.kind === 'tool_use' && e.label === 'TodoWrite') {
        const list = parseTodos(e.content);
        if (list) return list;
      }
    }
  }
  return null;
}

/** 进行中缓冲里的 TodoWrite(比落库更新时生效) */
function latestFromLive(): { list: TodoItemVM[]; ts: number } | null {
  const bufs: Array<{ events?: Array<{ label: string; content: string; ts: number }> }> = [];
  if (props.mode === 'room') {
    for (const m of store.currentRoom?.config.members ?? []) {
      const b = store.memberStream[m.id];
      if (b) bufs.push(b);
    }
  } else if (store.directStream) {
    bufs.push(store.directStream);
  }
  let best: { list: TodoItemVM[]; ts: number } | null = null;
  for (const b of bufs) {
    for (const e of b.events ?? []) {
      if (e.label !== 'TodoWrite') continue;
      const list = parseTodos(e.content);
      if (list && (!best || e.ts > best.ts)) best = { list, ts: e.ts };
    }
  }
  return best;
}

const todos = computed<TodoItemVM[] | null>(() => {
  // 实时优先(进行中的 TodoWrite 比落库新);否则落库
  return latestFromLive()?.list ?? latestFromHistory();
});

const doneCount = computed(() =>
  todos.value ? todos.value.filter((td) => td.status === 'completed').length : 0);

// 清单从无到有 → 自动展开;用户手动收起后不强行弹开(下次从无到有才再展开)
watch(todos, (list, old) => {
  if (list && list.length > 0 && (!old || old.length === 0)) open.value = true;
});
</script>

<template>
  <!-- 部件式渲染(工单17:容器统一布局——条横排一行,面板共享弹层列) -->
  <button v-if="part === 'bar'" class="todo-bar" @click="open = !open">
    <span class="todo-mark" :class="{ all: !!todos?.length && doneCount === todos.length }">
      {{ !todos?.length ? '☰' : doneCount === todos.length ? '✓' : '☰' }}
    </span>
    <span class="todo-progress">{{
      todos?.length
        ? t('hud.todos', { done: doneCount, total: todos.length })
        : t('todoPanel.empty')
    }}</span>
    <span class="todo-arrow" :class="{ open }">▸</span>
  </button>

  <div v-else-if="open" class="todo-list">
    <template v-if="todos?.length">
      <div v-for="(td, i) in todos" :key="i" class="todo-item" :class="td.status">
        <span class="ti-mark">{{ td.status === 'completed' ? '✓' : td.status === 'in_progress' ? '▶' : '·' }}</span>
        <span class="ti-text">{{ td.content }}</span>
      </div>
    </template>
    <div v-else class="todo-empty-hint">{{ t('todoPanel.emptyHint') }}</div>
  </div>
</template>

<style scoped>
/* 小条:与 HUD 迷你条统一协议(工单17:容器横排一行) */
.todo-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel);
  color: var(--muted);
  font-size: 11px;
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s, color 0.15s;
  white-space: nowrap;
}

.todo-bar:hover { border-color: var(--accent); color: var(--text); }

.todo-mark { color: #4caf7d; font-weight: 700; }
.todo-mark.all { color: #4caf7d; }

.todo-progress { font-variant-numeric: tabular-nums; }

.todo-arrow {
  display: inline-block;
  font-size: 9px;
  transition: transform 0.15s ease;
  color: var(--faint);
}
.todo-arrow.open { transform: rotate(90deg); }

/* 面板内容块:定位/宽度由容器弹层列统一(工单17) */
.todo-list {
  width: 300px;
  max-height: 220px;
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.todo-item {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.45;
}

.todo-item.completed { opacity: 0.55; text-decoration: line-through; }
.todo-item.in_progress { color: var(--text); font-weight: 600; }

.ti-mark { flex-shrink: 0; width: 12px; color: #4caf7d; }
.todo-item.in_progress .ti-mark { color: #8b5cf6; animation: todo-breathe 1.5s ease-in-out infinite; }

.todo-empty-hint {
  font-size: 11px;
  color: var(--faint);
  line-height: 1.5;
}

@keyframes todo-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
