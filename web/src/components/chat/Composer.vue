<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { setEditingMessage, sessionActions, store, sayDirect, stopDirect } from '@/store';
import { api } from '@/services/api';
import { detectMention, detectSlashCommand, type TextSegment } from '@/utils/mentions';
import HudPanel from './HudPanel.vue';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    mode?: 'room' | 'direct';
  }>(),
  { mode: 'room' },
);

const text = ref('');
const inputEl = ref<HTMLTextAreaElement | null>(null);

const busy = computed(() => {
  if (props.mode === 'direct') {
    return store.directStatus === 'thinking' || store.directStatus === 'streaming';
  }
  const room = store.currentRoom;
  if (!room) return false;
  return Object.values(room.statuses).some((s) => s === 'thinking' || s === 'streaming');
});

// 监听编辑态进入，填充文本并自动聚焦
watch(
  () => store.editingContext,
  (ctx) => {
    if (ctx) {
      text.value = ctx.text;
      nextTick(() => {
        autoGrow();
        if (inputEl.value) {
          inputEl.value.focus();
          const len = text.value.length;
          inputEl.value.setSelectionRange(len, len);
        }
      });
    }
  },
  { immediate: true },
);

function cancelEdit() {
  setEditingMessage(null);
  text.value = '';
  nextTick(() => autoGrow());
}

// ---------- 微信式 @ 弹选 + 行首 / 命令弹层(工单08) ----------

/** 弹层候选:成员名 + 全员指令(@all)。按 query 前缀过滤。 */
interface Candidate { label: string; sub: string; insert: string }

const popup = ref<{ start: number; query: string } | null>(null);
const activeIdx = ref(0);
/** 斜杠命令弹层(与 @ 弹层互斥:行首 / 优先) */
const slashPopup = ref<{ query: string } | null>(null);
/** 房间可用 skills(server 扫描;房间切换/弹层打开时刷新) */
const roomSkills = ref<Array<{ name: string; from: 'user' | 'project' }>>([]);

const candidates = computed<Candidate[]>(() => {
  if (props.mode !== 'room' || !popup.value) return [];
  const q = popup.value.query.toLowerCase();
  const list: Candidate[] = [];
  if ('all'.startsWith(q) || q === '') {
    list.push({ label: '@all', sub: t('chat.mentionAllSub'), insert: '@all' });
  }
  for (const m of store.currentRoom?.config.members ?? []) {
    if (m.name.toLowerCase().includes(q)) {
      list.push({ label: `@${m.name}`, sub: m.persona.slice(0, 24), insert: `@${m.name}` });
    }
  }
  return list;
});

/** 命令候选:内置(/compact /model) + 动态 skills,按 query 前缀过滤 */
const slashCandidates = computed<Candidate[]>(() => {
  if (!slashPopup.value) return [];
  const q = slashPopup.value.query.toLowerCase();
  const list: Candidate[] = [
    { label: '/compact', sub: t('slash.compactSub'), insert: '/compact' },
    { label: '/model', sub: t('slash.modelSub'), insert: '/model' },
  ];
  for (const s of roomSkills.value) {
    const name = s.name.toLowerCase();
    if (q === '' || name.startsWith(q)) {
      list.push({
        label: `/${s.name}`,
        sub: s.from === 'project' ? t('slash.skillProject') : t('slash.skillUser'),
        insert: `/${s.name}`,
      });
    }
  }
  return q === '' ? list : list.filter((c) => c.label.toLowerCase().startsWith(q));
});

watch(candidates, (list) => {
  if (activeIdx.value >= list.length) activeIdx.value = 0;
});
watch(slashCandidates, (list) => {
  if (activeIdx.value >= list.length) activeIdx.value = 0;
});

function refreshPopup() {
  if (props.mode !== 'room') return;
  const el = inputEl.value;
  if (!el) return;
  const pos = el.selectionStart ?? text.value.length;
  const before = text.value.slice(0, pos);
  // 行首 / 命令弹层优先(与 @ 弹层互斥:命令是行级指令)
  if (before.startsWith('/')) {
    const slash = detectSlashCommand(before);
    if (slash) {
      if (!slashPopup.value) void loadRoomSkills(); // 首次进入命令模式拉一次候选
      slashPopup.value = { query: slash.query };
      popup.value = null;
      return;
    }
    // / 后含空格(如 skill 补充说明中)→ 不再弹
    slashPopup.value = null;
    popup.value = null;
    return;
  }
  slashPopup.value = null;
  popup.value = detectMention(before);
}

async function loadRoomSkills() {
  if (props.mode !== 'room' || !store.currentRoom) return;
  try {
    const r = await api.roomSkills(store.currentRoom.config.id);
    roomSkills.value = r.skills ?? [];
  } catch {
    roomSkills.value = [];
  }
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

/** 当前激活的弹层候选(@ 或 /;渲染与键盘导航统一走它) */
const activeCandidates = computed<Candidate[]>(() =>
  slashPopup.value ? slashCandidates.value : candidates.value,
);

function onKeydown(e: KeyboardEvent) {
  // 弹层激活时接管导航键(@ 与 / 共用)
  if ((popup.value || slashPopup.value) && activeCandidates.value.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx.value = (activeIdx.value + 1) % activeCandidates.value.length;
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx.value = (activeIdx.value - 1 + activeCandidates.value.length) % activeCandidates.value.length;
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      if (slashPopup.value) pickSlashCandidate(activeIdx.value);
      else pickCandidate(activeIdx.value);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      popup.value = null;
      slashPopup.value = null;
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

/** 选中命令候选:整行替换为命令 + 尾随空格,继续输入参数或补充说明。 */
function pickSlashCandidate(idx: number) {
  const c = slashCandidates.value[idx];
  const el = inputEl.value;
  if (!c || !el) return;
  text.value = `${c.insert} `;
  slashPopup.value = null;
  nextTick(() => {
    el.focus();
    const pos = text.value.length;
    el.setSelectionRange(pos, pos);
  });
}

// ---------- 斜杠命令执行(工单08:行首 / 开头才拦截) ----------

/** 首个成员 id(单成员任务房即唯一执行者;多成员房命令作用于首位) */
function firstMemberId(): string | undefined {
  return store.currentRoom?.config.members[0]?.id;
}

/** 解析行首命令:返回 {name, rest} 或 null(非命令文本) */
function parseCommand(input: string): { name: string; rest: string } | null {
  const m = input.match(/^\/([a-zA-Z0-9_-]+)\s*([\s\S]*)$/);
  if (!m) return null;
  return { name: m[1]!, rest: (m[2] ?? '').trim() };
}

/** 执行内置命令;返回 true 表示已拦截(不发消息)。skill 命令返回 false 走消息组装。 */
async function execBuiltinCommand(cmd: { name: string; rest: string }): Promise<boolean> {
  if (!store.currentRoom) return false;
  const roomId = store.currentRoom.config.id;
  if (cmd.name === 'compact') {
    await api.roomCompact(roomId, firstMemberId()).catch((e) => console.error('/compact 失败:', e));
    return true;
  }
  if (cmd.name === 'model') {
    const model = cmd.rest.split(/\s+/)[0] ?? '';
    const mid = firstMemberId();
    if (model && mid) {
      await api.roomModel(roomId, mid, model).catch((e) => console.error('/model 失败:', e));
    }
    return true;
  }
  return false; // 未知/内置以外 → skill 候选匹配或普通文本
}

/** skill 触发组装:命令名命中 skills 候选 → "使用 X skill 执行:<补充说明>"自然语言消息。 */
function buildSkillPrompt(cmd: { name: string; rest: string }): string | null {
  const hit = roomSkills.value.find((s) => s.name.toLowerCase() === cmd.name.toLowerCase());
  if (!hit) return null;
  const extra = cmd.rest ? `:${cmd.rest}` : '';
  return `使用 ${hit.name} skill 执行${extra}`;
}

// ---------- 发送 ----------

async function send() {
  const t = text.value.trim();
  if (!t) return;

  // 行首 / 命令拦截(工单08):内置命令本地执行;skill 命令组装自然语言;未知 /xxx 当普通文本
  const cmd = parseCommand(t);
  if (cmd && props.mode === 'room' && store.currentRoom) {
    if (await execBuiltinCommand(cmd)) {
      text.value = '';
      nextTick(() => autoGrow());
      slashPopup.value = null;
      popup.value = null;
      return;
    }
    const skillPrompt = buildSkillPrompt(cmd);
    if (skillPrompt) {
      text.value = '';
      nextTick(() => autoGrow());
      slashPopup.value = null;
      popup.value = null;
      await api.say(store.currentRoom.config.id, skillPrompt);
      return;
    }
    // 未知命令:不拦截,按用户语义当普通聊天文本发出
  }

  text.value = '';
  nextTick(() => autoGrow()); // 清空后回缩到单行高
  popup.value = null;
  slashPopup.value = null;

  const editCtx = store.editingContext;
  if (editCtx) {
    setEditingMessage(null);
    try {
      await sessionActions.saveEdit(editCtx.messageId, t);
    } catch (err: any) {
      console.error('保存编辑失败:', err);
    }
    return;
  }

  if (props.mode === 'direct') {
    await sayDirect(t);
    return;
  }

  if (!store.currentRoom) return;
  const roomId = store.currentRoom.config.id;
  await api.say(roomId, t);
}

async function onStop() {
  if (props.mode === 'direct') {
    await stopDirect();
    return;
  }
  if (!store.currentRoom) return;
  await api.stop(store.currentRoom.config.id);
}
</script>

<template>
  <div class="composer">
    <!-- 编辑模式提示条 -->
    <div v-if="store.editingContext" class="editing-banner">
      <div class="editing-info">
        <span class="editing-badge">{{ t('chat.editingBadge') }}</span>
        <span class="editing-desc">
          {{ t('chat.editingDescPrefix') }} <strong>{{ store.editingContext.fromName }}</strong> {{ t('chat.editingDescSuffix') }}
        </span>
      </div>
      <button class="cancel-edit-btn" type="button" @click="cancelEdit">{{ t('chat.cancelEdit') }}</button>
    </div>

    <!-- 语法提示(左) + HUD 迷你条(右,工单14:输入框上方右缘,点击上弹仪表) -->
    <div v-else class="syntax-hint hud-row-flex">
      <template v-if="mode === 'direct'">
        <span>{{ t('chat.hintDirect', { name: store.currentDirectChar?.name || t('chat.charFallback') }) }}</span>
      </template>
      <template v-else>
        <span>{{ t('chat.hintRoom') }}</span>
      </template>
      <HudPanel :mode="mode" />
    </div>

    <div class="input-row">
      <button
        class="attach-btn"
        disabled
        :title="t('chat.attachTitle')"
        type="button"
      >{{ t('chat.attachBtn') }}</button>

      <div class="input-wrap">
        <textarea
          ref="inputEl"
          v-model="text"
          rows="1"
          :placeholder="t('chat.inputPlaceholder')"
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
          <div class="mention-footer">{{ t('chat.mentionFooter') }}</div>
        </div>

        <!-- 斜杠命令弹层(工单08:内置命令 + skills;与 @ 弹层同款式) -->
        <div v-if="slashPopup && slashCandidates.length" class="mention-popup">
          <div
            v-for="(c, i) in slashCandidates"
            :key="c.insert"
            class="mention-item"
            :class="{ active: i === activeIdx }"
            @mousedown.prevent="pickSlashCandidate(i)"
            @mousemove="activeIdx = i"
          >
            <span class="mention-label">{{ c.label }}</span>
            <span class="mention-sub">{{ c.sub }}</span>
          </div>
          <div class="mention-footer">{{ t('slash.footer') }}</div>
        </div>
      </div>

      <button v-if="!busy" class="btn btn-primary send" @click="send">
        {{ store.editingContext ? t('chat.updateBtn') : t('chat.sendBtn') }}
      </button>
      <button v-else class="btn stop send" @click="onStop">{{ t('chat.stopBtn') }}</button>
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

/* 编辑模式提示条 */
.editing-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-border);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--accent-deep);
}
.editing-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.editing-badge {
  font-weight: 700;
  font-size: 11.5px;
  flex-shrink: 0;
}
.editing-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cancel-edit-btn {
  background: transparent;
  border: none;
  color: var(--accent-deep);
  font-size: 11.5px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  opacity: 0.8;
  flex-shrink: 0;
  transition: all 0.15s ease;
}
.cancel-edit-btn:hover {
  opacity: 1;
  background: var(--hover);
}

/* 语法速记:常驻小灰字(左) + HUD 迷你条(右)同行 */
.syntax-hint {
  font-size: 11px;
  color: var(--faint);
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hud-row-flex {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  overflow: visible; /* HUD 上弹面板不能被裁 */
}

.hud-row-flex > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
