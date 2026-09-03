<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { store } from '../store';
import { api } from '../api';
import { detectMention, type TextSegment } from '../mentions';

const text = ref('');
const inputEl = ref<HTMLTextAreaElement | null>(null);

const busy = computed(() => {
  const room = store.currentRoom;
  if (!room) return false;
  return Object.values(room.statuses).some((s) => s === 'thinking' || s === 'streaming');
});

// ---------- 微信式 @ 弹选 ----------

/** 弹层候选:成员名 + 全员指令(@all)。按 query 前缀过滤。 */
interface Candidate { label: string; sub: string; insert: string }

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
      list.push({ label: `@${m.name}`, sub: m.persona.slice(0, 24), insert: `@${m.name}` });
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
  // 检测到激活 @token 即弹(无候选也保持打开——用户正在输入过滤词;
  // token 终止/误触邮箱等情况由 detectMention 的行首/空白前置条件排除)
  popup.value = detectMention(text.value.slice(0, pos));
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
    <!-- @语法速记:常驻可见(原 placeholder 内容上移,不再随输入消失) -->
    <div class="syntax-hint">
      无@=接棒续聊 · @成员=点名(答完指定下一位并暂停) · 接棒@成员=TA直接起头 · @allN=轮流N轮
    </div>

    <div class="input-row">
      <button
        class="attach-btn"
        disabled
        title="附件功能即将支持"
        type="button"
      >添加文件</button>

      <div class="input-wrap">
        <textarea
          ref="inputEl"
          v-model="text"
          rows="1"
          placeholder="发消息…(Enter 发送)"
          @input="onInput"
          @click="refreshPopup"
          @keydown="onKeydown"
        ></textarea>

        <!-- 微信式 @ 弹选:锚定输入框上方 -->
        <div v-if="popup && candidates.length" class="mention-popup">
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
      <button v-else class="btn stop send" @click="onStop">停止</button>
    </div>
  </div>
</template>

<style scoped>
.composer {
  background: var(--panel);
  border-top: 1px solid var(--border-soft);
  padding: 10px 18px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

/* 语法速记:常驻小灰字 */
.syntax-hint {
  font-size: 11px;
  color: var(--faint);
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 微信三段:附件钮 | 输入框 | 发送/停止 */
.input-row { display: flex; gap: 10px; align-items: center; }

/* 附件按钮:仅 UI 壳(disabled + 即将支持),真功能后续立项 */
.attach-btn {
  height: 42px;
  padding: 0 14px;
  flex-shrink: 0;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--panel-softer);
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 500;
  cursor: not-allowed;
  opacity: 0.7;
}

.input-wrap { flex: 1; position: relative; min-width: 0; }
/* 单行 42px 精确分解:20px 行高 + 上下 10px padding + 上下 1px 边框。
 * padding 垂直对称 → placeholder/文字真正居中(textarea 的多余高度默认垫底,不能靠 min-height 撑)。 */
textarea {
  display: block; /* 关键:textarea 默认 inline,基线对齐会在容器内留下 descender 空隙 */
  width: 100%;
  resize: none;
  height: 42px;
  min-height: 42px;
  max-height: 140px;
  padding: 10px 12px;
  line-height: 20px;
  box-sizing: border-box;
  overflow-y: auto;
  border-radius: 10px;
  background: var(--panel-softer);
  border: 1px solid var(--border);
  color: var(--text);
}
/* 发送/停止按钮:与输入框同一排版坐标(font 13px / line 20px)——
 * 盒高逐像素 42px 一致,文字行参数也一致,视觉重心同线 */
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
  border-radius: 10px;
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
  color: var(--faint);
  border-top: 1px solid var(--border-soft);
}
</style>
