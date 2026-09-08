<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { setEditingMessage, sessionActions, store } from '@/store';
import { dialog } from '@/composables/useDialog';
import { renderMarkdown } from '@/utils/markdown';
import { initialsFor, colorForName } from '@/utils/avatar';
import type { ChatMessage } from '@server/core/types';
import { BATON_STRIP, BATON_LINE, BATON_END_WORDS, USER_NAME_ALIASES } from '@server/protocolKeywords';
import TraceDetail from './TraceDetail.vue';

const { t } = useI18n();

const props = defineProps<{ msg: ChatMessage & { streaming?: true } }>();
const showDetail = ref(false);
const textEl = ref<HTMLElement | null>(null);
const isMultiLine = ref(false);

const cleanText = computed(() => {
  const raw = props.msg.text || '';
  return raw.replace(BATON_STRIP, '').trimEnd();
});

function checkMultiLine() {
  const raw = cleanText.value;
  // 1. 若含有显式换行符，必定是多行
  if (raw.includes('\n')) {
    isMultiLine.value = true;
    return;
  }
  if (!raw.trim()) {
    isMultiLine.value = false;
    return;
  }
  // 2. 测量 DOM 真实高度(单行约 20.8px, >26px 视为多行折行)
  const el = textEl.value;
  if (el) {
    if (el.children.length > 1 || el.querySelector('pre, blockquote, ul, ol, h1, h2, h3, h4')) {
      isMultiLine.value = true;
      return;
    }
    const target = el.querySelector('p') ?? el;
    isMultiLine.value = target.clientHeight > 26;
  } else {
    isMultiLine.value = raw.length > 50;
  }
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  void nextTick(() => {
    checkMultiLine();
    if (textEl.value && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => checkMultiLine());
      resizeObserver.observe(textEl.value);
    }
  });
});

const isCopied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

onUnmounted(() => {
  resizeObserver?.disconnect();
  if (copyTimer) clearTimeout(copyTimer);
});

watch(
  () => [props.msg.text, props.msg.streaming],
  () => {
    void nextTick(() => checkMultiLine());
  },
);

const room = computed(() => store.currentRoom);
const member = computed(() => room.value?.config.members.find((m) => m.id === props.msg.from));
const directChar = computed(() => {
  if (store.currentDirectChar && store.currentDirectChar.id === props.msg.from) {
    return store.currentDirectChar;
  }
  return store.characters.find((c) => c.id === props.msg.from);
});
const isMe = computed(() => props.msg.from === 'user');
const isScout = computed(() => props.msg.from === 'scout');
const isSystem = computed(() => props.msg.system === true);

const canCopy = computed(() => !isSystem.value && !props.msg.streaming && !!cleanText.value.trim());
const canReroll = computed(() =>
  !isMe.value && !isSystem.value && !isScout.value && !props.msg.streaming,
);
const canEdit = computed(() =>
  !isSystem.value && !isScout.value && !props.msg.streaming,
);

async function onCopy() {
  const text = cleanText.value;
  if (!text) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      textArea.remove();
    }
    isCopied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      isCopied.value = false;
    }, 1500);
  } catch (err) {
    console.error('复制失败:', err);
  }
}

const activeMessages = computed(() =>
  store.activeSession?.type === 'direct' ? store.directMessages : store.messages,
);
const msgIndex = computed(() => activeMessages.value.findIndex((m) => m.id === props.msg.id));
const trailingCount = computed(() => {
  if (msgIndex.value === -1) return 0;
  return activeMessages.value.length - 1 - msgIndex.value;
});

const isBusy = computed(() => {
  if (store.activeSession?.type === 'direct') {
    return store.directStatus === 'thinking' || store.directStatus === 'streaming';
  }
  const r = store.currentRoom;
  if (!r) return false;
  if (r.orchestration !== 'idle') return true;
  return Object.values(r.statuses).some((s) => s === 'thinking' || s === 'streaming');
});

async function checkConfirm(actionName: string): Promise<boolean> {
  const busy = isBusy.value;
  const count = trailingCount.value;

  if (!busy && count <= 0) {
    return true; // 空闲且本身是最后一条消息，直接执行
  }

  let tip = '';
  if (busy && count > 0) {
    tip = t('chat.confirmBusyCount', { count });
  } else if (busy) {
    tip = t('chat.confirmBusy');
  } else {
    tip = t('chat.confirmCount', { count });
  }

  return await dialog.confirm(t('chat.actionConfirm', { action: actionName }), tip, {
    danger: true,
    confirmText: t('chat.confirmProceed'),
  });
}

async function onReroll() {
  if (!store.activeSession) return;
  const ok = await checkConfirm(t('chat.actionReroll'));
  if (!ok) return;
  try {
    await sessionActions.reroll(props.msg.id);
  } catch (err: any) {
    await dialog.alert(t('chat.opFailed'), err.message || t('chat.rerollFailed'));
  }
}

async function onEdit() {
  if (!store.activeSession) return;
  const ok = await checkConfirm(t('chat.actionEdit'));
  if (!ok) return;
  try {
    await sessionActions.truncateAfter(props.msg.id);
    setEditingMessage({
      messageId: props.msg.id,
      from: props.msg.from,
      fromName: senderName.value,
      text: cleanText.value,
    });
  } catch (err: any) {
    await dialog.alert(t('chat.opFailed'), err.message || t('chat.truncateFailed'));
  }
}

const hasCustomUserPersona = computed(() =>
  isMe.value && !!props.msg.fromName && !USER_NAME_ALIASES.includes(props.msg.fromName.toLowerCase())
);

const avatarBg = computed(() => {
  if (isMe.value) {
    if (hasCustomUserPersona.value) {
      return colorForName(props.msg.fromName!);
    }
    return '#6B7280';
  }
  if (isScout.value) return '#0EA5E9';
  return member.value?.color ?? directChar.value?.color ?? '#9CA3AF';
});
const avatarText = computed(() => {
  if (isMe.value) {
    if (hasCustomUserPersona.value) {
      return initialsFor(props.msg.fromName!);
    }
    return t('chat.me');
  }
  if (isScout.value) return t('chat.scoutInitial');
  return initialsFor(member.value?.name ?? directChar.value?.name ?? props.msg.fromName ?? '?');
});

/** 名字行「名字 · adapter · HH:MM」(截图样式;时间超淡) */
const senderName = computed(() => {
  if (isMe.value) {
    if (hasCustomUserPersona.value) {
      return t('chat.meWithName', { name: props.msg.fromName! });
    }
    return t('chat.me');
  }
  return member.value?.name ?? directChar.value?.name ?? props.msg.fromName ?? props.msg.from;
});
const senderRole = computed(() => {
  if (isMe.value) {
    if (hasCustomUserPersona.value) {
      return t('chat.rolePersona');
    }
    return t('chat.roleUser');
  }
  if (isScout.value) return t('chat.roleScout');
  return member.value?.adapter ?? directChar.value?.adapter ?? '';
});
const timeLabel = computed(() => {
  const d = new Date(props.msg.ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
});

const meta = computed(() => {
  const d = props.msg.detail;
  if (!d) return isMe.value ? timeLabel.value : '';
  const parts: string[] = [];
  if (d.durationMs != null && d.durationMs > 0) parts.push(`${(d.durationMs / 1000).toFixed(1)}s`);
  if (d.usage?.outputTokens != null) parts.push(`${d.usage.outputTokens} tok`);
  if (d.usage?.costUsd != null) parts.push(`$${d.usage.costUsd.toFixed(3)}`);
  return parts.join(' · ');
});

const audienceNames = computed(() => {
  if (!props.msg.audience || props.msg.audience.length === 0) return '';
  const names = props.msg.audience.map((id) => {
    const hit = room.value?.config.members.find((m) => m.id === id);
    return hit ? hit.name : id;
  });
  return names.join('、');
});

const privateActionBadge = computed(() => {
  const act = props.msg.privateAction || props.msg.handshake;
  if (!act) return null;
  if (act === 'start') {
    return { type: 'start', label: t('chat.hsStart') };
  }
  if (act === 'agree') {
    return { type: 'agree', label: t('chat.hsAgree') };
  }
  if (act === 'reject') {
    return { type: 'reject', label: t('chat.hsReject') };
  }
  if (act === 'idea') {
    return { type: 'idea', label: t('chat.hsIdea') };
  }
  if (act === 'reply') {
    return { type: 'reply', label: t('chat.hsReply') };
  }
  return null;
});

const batonBadge = computed(() => {
  if (props.msg.batonToUser) {
    return { type: 'to-user', label: t('chat.batonToUser') };
  }
  if (props.msg.batonTarget) {
    return { type: 'baton', label: t('chat.batonPass', { name: props.msg.batonTarget }) };
  }
  // 兜底历史消息兼容：从文本或 detail 中动态解析(中英标签并集真源)
  const raw = props.msg.text || '';
  const m = raw.match(BATON_LINE);
  if (m) {
    const target = m[1]!.replace(/^@/, '').trim();
    if (BATON_END_WORDS.test(target)) {
      return { type: 'end', label: t('chat.batonEnd') };
    }
    if (USER_NAME_ALIASES.includes(target.toLowerCase())) {
      return { type: 'to-user', label: t('chat.batonToUser') };
    }
    return { type: 'baton', label: t('chat.batonPass', { name: target }) };
  }
  return null;
});

const clickable = computed(() => !isMe.value && !isSystem.value && !props.msg.streaming && !!props.msg.detail);

/** Markdown 格式化 HTML (隐藏结尾接棒控制行，保证正文纯粹) */
const renderedHtml = computed(() => {
  return renderMarkdown(cleanText.value);
});

/** 气泡点击事件: 拦截代码块复制按钮与操作按钮，其余区域展开工作过程 */
function onBubbleClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (target && (target.classList.contains('copy-code-btn') || target.closest('.msg-act-btn'))) {
    e.stopPropagation();
    if (target.classList.contains('copy-code-btn')) {
      const codeEl = target.closest('.code-block-wrap')?.querySelector('code');
      if (codeEl) {
        const code = codeEl.textContent || '';
        void navigator.clipboard.writeText(code).then(() => {
          const orig = target.textContent;
          target.textContent = t('chat.copiedText');
          target.classList.add('copied');
          setTimeout(() => {
            target.textContent = orig;
            target.classList.remove('copied');
          }, 1500);
        });
      }
    }
    return;
  }
  if (clickable.value) {
    showDetail.value = !showDetail.value;
  }
}
</script>

<template>
  <!-- 系统消息:居中白底药丸 -->
  <div v-if="isSystem" class="sysrow">{{ msg.text }}</div>

  <!-- 用户/成员/侦察员气泡 -->
  <div v-else class="row" :class="{ me: isMe, multiline: isMultiLine }">
    <div class="avatar" :style="{ background: avatarBg }">{{ avatarText }}</div>
    <div class="wrap">
      <div class="sender">
        <span class="sender-name">{{ senderName }}</span>
        <span v-if="senderRole" class="sender-role">· {{ senderRole }}</span>
        <span v-if="audienceNames" class="sender-audience">{{ t('chat.privateVisible', { names: audienceNames }) }}</span>
        <span v-if="audienceNames" class="private-round-pill">{{ t('chat.privateRound', { n: msg.privateRound || 1 }) }}</span>
        <span v-if="privateActionBadge" class="handshake-pill" :class="privateActionBadge.type">{{ privateActionBadge.label }}</span>
        <span v-if="batonBadge" class="baton-pill" :class="batonBadge.type">{{ batonBadge.label }}</span>
        <span class="sender-time">· {{ timeLabel }}</span>
      </div>
      <div
        class="bubble"
        :class="{ clickable, streaming: msg.streaming }"
        @click="onBubbleClick"
        :title="clickable ? t('chat.bubbleTitle') : undefined"
      >
        <div ref="textEl" class="text markdown-body" v-html="renderedHtml"></div>
        <div class="bubble-footer">
          <div class="meta-left">{{ meta }}</div>
          <div v-if="!msg.streaming" class="meta-actions">
            <button
              v-if="canCopy"
              class="msg-act-btn"
              :class="{ copied: isCopied }"
              :title="isCopied ? t('chat.copiedTitle') : t('chat.copyTitle')"
              type="button"
              @click.stop="onCopy"
            >
              <svg v-if="isCopied" class="act-icon text-success" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <svg v-else class="act-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
            <button
              v-if="canReroll"
              class="msg-act-btn"
              :title="t('chat.rerollTitle')"
              type="button"
              @click.stop="onReroll"
            >
              <svg class="act-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
              </svg>
            </button>
            <button
              v-if="canEdit"
              class="msg-act-btn"
              :title="t('chat.editTitle')"
              type="button"
              @click.stop="onEdit"
            >
              <svg class="act-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
              </svg>
            </button>
          </div>
        </div>
        <TraceDetail v-if="showDetail && msg.detail" :detail="msg.detail" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sysrow {
  align-self: center;
  max-width: min(780px, 92%);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  background: var(--panel);
  border: 1px solid var(--border-soft);
  padding: 3px 12px;
  border-radius: 14px;
}

.row { display: flex; gap: 10px; max-width: min(860px, 88%); }
.row.me { align-self: flex-end; flex-direction: row-reverse; }

/* 只要发言多于一行(不论是 AI 还是用户)，统一等宽展开；不满一行则保持紧凑包裹 */
.row.multiline {
  width: min(860px, 88%);
}
.row.multiline .wrap {
  width: 100%;
}
.row.multiline .bubble {
  width: 100%;
}

/* initials 正圆头像(颜色 = 成员色;用户灰;侦察青) */
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}
.wrap { display: flex; flex-direction: column; gap: 4px; min-width: 0; }

/* 名字行:粗体名字 · 灰角色 · 超淡时间(截图样式) */
.sender { font-size: 11.5px; display: flex; align-items: baseline; gap: 5px; }
.row.me .sender { flex-direction: row-reverse; }
.sender-name { color: var(--text-muted); font-weight: 600; }
.sender-role { color: var(--muted); }
.sender-audience {
  font-size: 10.5px;
  color: var(--accent);
  background: var(--accent-soft);
  padding: 1px 6px;
  border-radius: 6px;
  font-weight: 550;
}
.sender-time { color: var(--faint); }

/* 气泡:agent = 白底描边四角等圆;我 = 淡靛底无边框深靛字 */
.bubble {
  background: var(--panel);
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  padding: 9px 12px;
  font-size: 13px;
  line-height: 1.6;
  position: relative;
  cursor: default;
}
.row.me .bubble {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent-deep);
}
.bubble.clickable { cursor: pointer; }
.bubble.clickable:hover { border-color: var(--accent-border); }
.bubble.streaming .text :last-child::after,
.bubble.streaming .text:empty::after {
  content: '▍';
  animation: caret 0.8s infinite;
  color: var(--accent);
  display: inline;
  margin-left: 2px;
}
.text { word-break: break-word; }
.mention { color: var(--accent); font-weight: 600; }
.row.me .bubble .mention { color: var(--accent-deep); }
.bubble-footer {
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 11px;
}
.meta-left {
  color: var(--muted);
  font-size: 11px;
}
.row.me .meta-left {
  color: var(--accent-deep);
  opacity: 0.65;
}

.meta-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  opacity: 0.55;
  transition: opacity 0.15s ease;
}
.bubble:hover .meta-actions,
.meta-actions:hover {
  opacity: 1;
}

.msg-act-btn {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: color 0.15s ease;
}
.msg-act-btn:hover {
  color: var(--text);
  background: none;
  border: none;
}
.msg-act-btn.copied {
  color: #10b981;
}
.row.me .msg-act-btn {
  color: var(--accent-deep);
  opacity: 0.6;
}
.row.me .msg-act-btn.copied {
  color: #10b981;
  opacity: 1;
}

.row.me .msg-act-btn:hover {
  opacity: 1;
}
.act-icon {
  display: block;
}

.private-round-pill {
  font-size: 10.5px;
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.1);
  padding: 1px 6px;
  border-radius: 6px;
  font-weight: 550;
  line-height: normal;
}

.handshake-pill {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 6px;
  font-weight: 550;
  line-height: normal;
}
.handshake-pill.start {
  color: #4f46e5;
  background: rgba(79, 70, 229, 0.1);
}
.handshake-pill.agree {
  color: #059669;
  background: rgba(5, 150, 105, 0.1);
}
.handshake-pill.reject {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.1);
}
.handshake-pill.idea {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.1);
}
.handshake-pill.reply {
  color: var(--muted);
  background: rgba(107, 114, 128, 0.1);
}

.baton-pill {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 6px;
  font-weight: 550;
  line-height: normal;
}
.baton-pill.baton {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.1);
}
.baton-pill.to-user {
  color: #059669;
  background: rgba(5, 150, 105, 0.1);
}
.baton-pill.end {
  color: var(--muted);
  background: rgba(107, 114, 128, 0.1);
}

@keyframes caret { 50% { opacity: 0.25; } }
</style>
