<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { store } from '../store';
import { api } from '../api';
import { detectMention, type TextSegment } from '../mentions';
import type { MemberConfig } from '@server/core/types';

const text = ref('');
const inputEl = ref<HTMLTextAreaElement | null>(null);
const popupEl = ref<HTMLElement | null>(null);

const busy = computed(() => {
  const room = store.currentRoom;
  if (!room) return false;
  return Object.values(room.statuses).some((s) => s === 'thinking' || s === 'streaming');
});

// ---------- 微信式 @ 弹选 ----------

/** 弹层候选:成员名 + 全员指令(@all)。按 query 前缀过滤。 */
interface Candidate { label: string; sub: string; insert: string; member?: MemberConfig }

const popup = ref<{ start: number; query: string } | null>(null);
const activeIdx = ref(0);

const candidates = computed<Candidate[]>(() => {
  if (!popup.value) return [];
  const q = popup.value.query.toLowerCase();
  const list: Candidate[] = [];
  if ('all'.startsWith(q) || q === '') {
    list.push({ label: '@all', sub: '所有人轮流发言(可带轮数,如 @all2)', insert: '@all' });
  }
  for (const m of store.currentRoom?.config.members ?? []) {
    if (m.name.toLowerCase().includes(q)) {
      list.push({ label: `@${m.name}`, sub: m.persona.slice(0, 24), insert: `@${m.name}`, member: m });
    }
  }
  return list;
});

watch(candidates, (list) => {
  if (activeIdx.value >= list.length) activeIdx.value = 0;
});

function refreshPopup() {
  const el = inputEl.value;
  if (!el) return;
  const pos = el.selectionStart ?? text.value.length;
  const detected = detectMention(text.value.slice(0, pos));
  popup.value = detected && candidatesWouldShow(detected.query) ? detected : null;
}

function candidatesWouldShow(query: string): boolean {
  // 无候选也保持弹层打开(用户正在输入过滤词),除非 query 里已出现空白(token 终止由 detectMention 保证)
  return true;
}

/** 弹性增高:内容超出时按 scrollHeight 长高(上限 CSS max-height),删减回缩。 */
function autoGrow() {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
}

function onInput() {
  autoGrow();
  refreshPopup();
}

function onKeydown(e: KeyboardEvent) {
  // 弹层激活时接管导航键
  if (popup.value && candidates.value.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx.value = (activeIdx.value + 1) % candidates.value.length;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx.value = (activeIdx.value - 1 + candidates.value.length) % candidates.value.length;
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      pickCandidate(activeIdx.value);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      popup.value = null;
      return;
    }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void send();
  }
}

/** 选中候补:替换光标前激活的 @token 为完整 @名字 + 尾随空格(微信语义)。 */
function pickCandidate(idx: number) {
  const c = candidates.value[idx];
  const p = popup.value;
  const el = inputEl.value;
  if (!c || !p || !el) return;
  const pos = el.selectionStart ?? text.value.length;
  const after = text.value.slice(pos);
  text.value = text.value.slice(0, p.start) + c.insert + ' ' + after;
  popup.value = null;
  const newPos = p.start + c.insert.length + 1;
  nextTick(() => {
    el.focus();
    el.setSelectionRange(newPos, newPos);
  });
}

// ---------- 发送 ----------

async function send() {
  const t = text.value.trim();
  if (!t || !store.currentRoom) return;
  text.value = '';
  nextTick(() => autoGrow()); // 清空后回缩到单行高
  popup.value = null;
  await api.say(store.currentRoom.config.id, t);
}

async function onStop() {
  if (!store.currentRoom) return;
  await api.stop(store.currentRoom.config.id);
}
</script>

<template>
  <div class="composer">
    <div class="input-wrap">
      <textarea
        ref="inputEl"
        v-model="text"
        rows="1"
        placeholder="无@=接棒模式 · @成员名=点名(答完即止) · @allN=轮流N轮 · Enter 发送 / Shift+Enter 换行"
        @input="onInput"
        @click="refreshPopup"
        @keydown="onKeydown"
      ></textarea>

      <!-- 微信式 @ 弹选:锚定输入框上方 -->
      <div v-if="popup && candidates.length" ref="popupEl" class="mention-popup">
        <div
          v-for="(c, i) in candidates"
          :key="c.insert"
          class="mention-item"
          :class="{ active: i === activeIdx }"
          @mousedown.prevent="pickCandidate(i)"
          @mousemove="activeIdx = i"
        >
          <span class="mention-label">{{ c.label }}</span>
          <span class="mention-sub">{{ c.sub }}</span>
        </div>
        <div class="mention-footer">↑↓ 选择 · Tab/Enter 确认 · Esc 关闭</div>
      </div>
    </div>
    <button v-if="!busy" class="btn btn-primary send" @click="send">发送</button>
    <button v-else class="btn stop send" @click="onStop">‖ 停止</button>
  </div>
</template>

<style scoped>
.composer {
  background: var(--panel);
  border-top: 1px solid var(--border-soft);
  padding: 12px 18px;
  display: flex;
  gap: 10px;
  align-items: center; /* 输入框与发送按钮同一行垂直居中 */
}
.input-wrap { flex: 1; position: relative; min-width: 0; }
/* 单行 42px 精确分解:20px 行高 + 上下 10px padding + 上下 1px 边框。
 * padding 垂直对称 → placeholder/文字真正居中(textarea 的多余高度默认垫底,不能靠 min-height 撑)。 */
textarea {
  display: block; /* 关键:textarea 默认 inline,基线对齐会在容器内留下 descender 空隙(input-wrap 46px > 42px),flex 居中后按钮视觉下沉 2px */
  width: 100%;
  resize: none;
  height: 42px;
  min-height: 42px;
  max-height: 140px;
  padding: 10px;
  line-height: 20px;
  box-sizing: border-box;
  overflow-y: auto;
}
/* 发送/停止按钮:与输入框同一排版坐标(font 13px / line 20px)——
 * 盒高逐像素 42px 一致,文字行参数也一致,视觉重心同线,消灭"低一点点"的字体错觉 */
.send {
  height: 42px;
  padding: 0 22px;
  font-size: 13px;
  line-height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-sizing: border-box;
}
.send.stop { background: var(--danger); color: #fff; }

.mention-popup {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  width: 300px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-md);
  z-index: 20;
}
.mention-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
}
.mention-item.active { background: var(--accent-soft); }
.mention-label { color: var(--accent); font-weight: 600; flex-shrink: 0; }
.mention-sub {
  color: var(--muted);
  font-size: 11px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mention-footer {
  padding: 5px 12px;
  font-size: 10.5px;
  color: var(--muted);
  border-top: 1px solid var(--border-soft);
}
</style>
