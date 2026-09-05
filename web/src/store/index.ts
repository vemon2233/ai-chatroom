// 全局响应式状态:消息列表为权威源;roomState 整快照替换(不 merge)。
// 设计原则(v1 教训):agentEvent 只更新流式缓冲与状态 chip,
// 消息本体只在 'message' 事件到来时进入列表——不会出现半截消息与最终消息并存。

import { reactive } from 'vue';
import type { Character, ChatMessage, RoomState } from '@server/core/types';
import type { AgentEvent } from '@server/adapters/base';
import type { AdapterInfo, RoomListItem } from '@/services/api';
import { api } from '@/services/api';
import { connectWs } from '@/services/ws';
export interface StreamBuf { text: string; thinking: string }

export interface EditingContext {
  messageId: string;
  from: string;
  fromName: string;
  text: string;
}

export type Session =
  | { type: 'room'; id: string }
  | { type: 'direct'; characterId: string };

// 刷新时重置会话，清理既有缓存
try {
  localStorage.removeItem('ai-chatroom:open-rooms');
} catch {}

export const store = reactive({
  adapters: [] as AdapterInfo[],
  rooms: [] as RoomListItem[],
  characters: [] as Character[],
  
  /** 当前激活会话类型与标识 */
  activeSession: null as Session | null,

  // 群聊房间相关状态
  currentRoom: null as RoomState | null,
  messages: [] as ChatMessage[],
  editingContext: null as EditingContext | null,
  memberStream: {} as Record<string, StreamBuf>,

  // 讨论摘要状态(群聊或私聊通用)
  currentSummary: null as import('@server/core/types').DiscussionSummary | null,

  // 角色专属 1v1 私聊状态
  currentDirectChar: null as Character | null,
  directMessages: [] as ChatMessage[],
  directStream: null as StreamBuf | null,
  directStatus: 'idle' as 'idle' | 'thinking' | 'streaming' | 'error',

  sidebarTab: 'rooms' as 'rooms' | 'chars',
  openSessions: [] as Session[],

  // 右侧边栏 Inspector 统一激活 Tab ('summary' | 'logs' | 'manage' | null)
  activeInspectorTab: null as 'summary' | 'logs' | 'manage' | null,
});

export type InspectorTab = 'summary' | 'logs' | 'manage';

export function toggleInspector(tab: InspectorTab): void {
  if (store.activeInspectorTab === tab) {
    store.activeInspectorTab = null;
  } else {
    store.activeInspectorTab = tab;
  }
}

export function openInspector(tab: InspectorTab): void {
  store.activeInspectorTab = tab;
}

export function closeInspector(): void {
  store.activeInspectorTab = null;
}

export function setEditingMessage(ctx: EditingContext | null): void {
  store.editingContext = ctx;
}

export function currentRoomId(): string | null {
  return store.currentRoom?.config.id ?? null;
}

/** 进入房间:拉 state+历史,整快照替换。 */
export async function enterRoom(roomId: string): Promise<void> {
  const [state, msgs] = await Promise.all([
    api.roomState(roomId),
    api.messages(roomId),
  ]);
  store.activeSession = { type: 'room', id: roomId };
  store.currentRoom = state;
  store.messages = msgs;
  store.editingContext = null;
  store.memberStream = {};
  store.currentDirectChar = null;
  store.currentSummary = null;

  void api.roomSummary(roomId).then((s) => {
    if (store.activeSession?.type === 'room' && store.activeSession.id === roomId) {
      store.currentSummary = s;
    }
  }).catch(() => {});
}

/** 打开并聚焦房间（若未在 Tab 中则追加） */
export async function openRoom(roomId: string): Promise<void> {
  const exists = store.openSessions.some((s) => s.type === 'room' && s.id === roomId);
  if (!exists) {
    store.openSessions.push({ type: 'room', id: roomId });
  }
  await enterRoom(roomId);
}

/** 打开与指定角色的 1v1 纯粹私聊（独立历史，绝不污染群聊房间） */
export async function openDirectChat(c: Character): Promise<void> {
  const exists = store.openSessions.some((s) => s.type === 'direct' && s.characterId === c.id);
  if (!exists) {
    store.openSessions.push({ type: 'direct', characterId: c.id });
  }
  store.activeSession = { type: 'direct', characterId: c.id };
  store.currentDirectChar = c;
  store.currentRoom = null;
  store.directStream = null;
  store.directStatus = 'idle';
  store.currentSummary = null;
  store.directMessages = await api.directMessages(c.id);

  void api.directSummary(c.id).then((s) => {
    if (store.activeSession?.type === 'direct' && store.activeSession.characterId === c.id) {
      store.currentSummary = s;
    }
  }).catch(() => {});
}

/** 1v1 私聊用户发言 */
export async function sayDirect(text: string): Promise<void> {
  if (!store.currentDirectChar || !text.trim()) return;
  await api.sayDirect(store.currentDirectChar.id, text.trim());
}

/** 1v1 私聊停止输出 */
export async function stopDirect(): Promise<void> {
  if (!store.currentDirectChar) return;
  await api.stopDirect(store.currentDirectChar.id);
  store.directStatus = 'idle';
}

/** 1v1 私聊清空重置对话 */
export async function resetDirect(): Promise<void> {
  if (!store.currentDirectChar) return;
  await api.resetDirect(store.currentDirectChar.id);
  store.directMessages = [];
  store.directStream = null;
  store.directStatus = 'idle';
}

/** 清空指定群聊房间的全部聊天消息 */
export async function clearRoomMessages(roomId: string): Promise<void> {
  await api.clearRoomMessages(roomId);
  if (store.currentRoom?.config.id === roomId) {
    store.messages = [];
    store.memberStream = {};
  }
}

/**
 * 统一会话操作门面 (Session Actions Facade)
 * 让 UI 组件(MessageBubble/Composer)与具体的会话模型彻底解耦，统一处理重roll、截断与编辑。
 */
export const sessionActions = {
  /** 统一重roll指定发言 */
  async reroll(messageId: string): Promise<void> {
    const s = store.activeSession;
    if (!s) return;
    if (s.type === 'room') {
      await api.rerollMessage(s.id, messageId);
    } else {
      await api.rerollDirectMessage(s.characterId, messageId);
    }
  },

  /** 统一截断指定消息之后的对话记录 */
  async truncateAfter(messageId: string): Promise<void> {
    const s = store.activeSession;
    if (!s) return;
    if (s.type === 'room') {
      await api.truncateAfterMessage(s.id, messageId);
    } else {
      const res = await api.truncateAfterDirectMessage(s.characterId, messageId);
      store.directMessages = res.messages;
      store.directStream = null;
    }
  },

  /** 统一保存编辑文本 */
  async saveEdit(messageId: string, text: string): Promise<void> {
    const s = store.activeSession;
    if (!s) return;
    if (s.type === 'room') {
      await api.saveEditMessage(s.id, messageId, text);
    } else {
      await api.saveEditDirectMessage(s.characterId, messageId, text);
    }
  },
};


/** 关闭某个会话 Tab */
export async function closeSession(session: Session): Promise<void> {
  const idx = store.openSessions.findIndex((s) => {
    if (s.type !== session.type) return false;
    if (s.type === 'room' && session.type === 'room') return s.id === session.id;
    if (s.type === 'direct' && session.type === 'direct') return s.characterId === session.characterId;
    return false;
  });
  if (idx === -1) return;

  let isCurrent = false;
  if (store.activeSession && store.activeSession.type === session.type) {
    if (store.activeSession.type === 'room' && session.type === 'room') {
      isCurrent = store.activeSession.id === session.id;
    } else if (store.activeSession.type === 'direct' && session.type === 'direct') {
      isCurrent = store.activeSession.characterId === session.characterId;
    }
  }

  store.openSessions.splice(idx, 1);

  if (!isCurrent) return;

  if (store.openSessions.length > 0) {
    const nextIdx = Math.min(idx, store.openSessions.length - 1);
    const nextSession = store.openSessions[nextIdx];
    if (nextSession) {
      if (nextSession.type === 'room') {
        await enterRoom(nextSession.id);
      } else {
        const char = store.characters.find((c) => c.id === nextSession.characterId);
        if (char) {
          await openDirectChat(char);
        } else {
          store.activeSession = null;
          store.currentDirectChar = null;
        }
      }
    }
  } else {
    store.activeSession = null;
    store.currentRoom = null;
    store.messages = [];
    store.memberStream = {};
    store.currentDirectChar = null;
    store.directMessages = [];
    store.directStream = null;
  }
}

/** 向后兼容老调用的 closeRoom */
export async function closeRoom(roomId: string): Promise<void> {
  await closeSession({ type: 'room', id: roomId });
}

export async function refreshRooms(): Promise<void> {
  store.rooms = await api.rooms();
  const validRoomIds = new Set(store.rooms.map((r) => r.config.id));
  const removed = store.openSessions.filter((s) => s.type === 'room' && !validRoomIds.has(s.id));
  if (removed.length > 0) {
    store.openSessions = store.openSessions.filter((s) => s.type !== 'room' || validRoomIds.has(s.id));
    if (store.activeSession?.type === 'room' && !validRoomIds.has(store.activeSession.id)) {
      const first = store.openSessions[0];
      if (first) {
        if (first.type === 'room') await enterRoom(first.id);
        else {
          const c = store.characters.find((char) => char.id === first.characterId);
          if (c) await openDirectChat(c);
        }
      } else {
        store.activeSession = null;
        store.currentRoom = null;
        store.messages = [];
        store.memberStream = {};
      }
    }
  }
}

export async function refreshCharacters(): Promise<void> {
  store.characters = await api.characters();
  if (store.currentDirectChar) {
    const updated = store.characters.find((c) => c.id === store.currentDirectChar?.id);
    if (updated) {
      store.currentDirectChar = updated;
    }
  }
}

export async function refreshAdapters(): Promise<void> {
  const j = await api.adapters().catch(() => ({ adapters: [] as AdapterInfo[] }));
  store.adapters = j.adapters;
}

// ---------- WS 事件分发 ----------

function onWsEvent(ev: import('@server/core/bus').WsEvent): void {
  switch (ev.type) {
    case 'message': {
      const rid = currentRoomId();
      if (rid != null && ev.message.roomId === rid) {
        store.messages.push(ev.message);
        delete store.memberStream[ev.message.from]; // 流式缓冲清空(最终消息已到)
        refreshRooms(); // 侧栏预览更新
      } else if (ev.message.from === 'system') {
        refreshRooms();
      }
      return;
    }
    case 'roomMessages': {
      const rid = currentRoomId();
      if (rid != null && ev.roomId === rid) {
        store.messages = ev.messages;
      }
      return;
    }
    case 'agentEvent': {
      const rid = currentRoomId();
      if (rid === ev.roomId) onAgentEvent(ev.event);
      return;
    }
    case 'roomState': {
      const rid = currentRoomId();
      if (rid === ev.roomId) {
        store.currentRoom = ev.state; // 整快照替换,不 merge
        // 状态归位的成员清理流式缓冲
        for (const [mid, status] of Object.entries(ev.state.statuses)) {
          if (status === 'idle' || status === 'error') delete store.memberStream[mid];
        }
      }
      return;
    }
    case 'roomSummary': {
      const rid = currentRoomId();
      if (rid != null && ev.roomId === rid) {
        store.currentSummary = ev.summary;
      }
      return;
    }
    case 'rooms': {
      void refreshRooms();
      return;
    }
    case 'characters': {
      void refreshCharacters();
      return;
    }
    case 'directSummary': {
      if (store.currentDirectChar && store.currentDirectChar.id === ev.characterId) {
        store.currentSummary = ev.summary;
      }
      return;
    }
    case 'directMessage': {
      if (store.currentDirectChar && store.currentDirectChar.id === ev.characterId) {
        store.directMessages.push(ev.message);
        store.directStream = null;
        store.directStatus = 'idle';
      }
      return;
    }
    case 'directEvent': {
      if (store.currentDirectChar && store.currentDirectChar.id === ev.characterId) {
        if (ev.event.phase === 'thinking') {
          store.directStatus = 'thinking';
          store.directStream ??= { text: '', thinking: '' };
          if (ev.event.thinkingDelta) store.directStream.thinking += ev.event.thinkingDelta;
        } else if (ev.event.phase === 'streaming') {
          store.directStatus = 'streaming';
          store.directStream ??= { text: '', thinking: '' };
          if (ev.event.textDelta) store.directStream.text += ev.event.textDelta;
        } else if (ev.event.phase === 'done' || ev.event.phase === 'error') {
          store.directStatus = 'idle';
          if (ev.event.phase === 'error') store.directStream = null;
        }
      }
      return;
    }
    case 'directMessages': {
      if (store.currentDirectChar && store.currentDirectChar.id === ev.characterId) {
        store.directMessages = ev.messages;
        store.directStream = null;
      }
      return;
    }
    case 'directReset': {
      if (store.currentDirectChar && store.currentDirectChar.id === ev.characterId) {
        store.directMessages = [];
        store.directStream = null;
        store.directStatus = 'idle';
      }
      return;
    }
    case 'error': {
      console.error('服务器错误:', ev.message);
      return;
    }
  }
}

function onAgentEvent(ev: AgentEvent): void {
  const room = store.currentRoom;
  if (!room) return;
  const member = room.config.members.find((m) => m.id === ev.member);
  if (!member) return; // 侦察员等非成员事件不渲染流式

  if (ev.phase === 'thinking') {
    store.memberStream[ev.member] ??= { text: '', thinking: '' };
    if (ev.thinkingDelta) store.memberStream[ev.member]!.thinking += ev.thinkingDelta;
    room.statuses[ev.member] = 'thinking';
  } else if (ev.phase === 'streaming' && ev.textDelta) {
    const buf = (store.memberStream[ev.member] ??= { text: '', thinking: '' });
    buf.text += ev.textDelta;
    room.statuses[ev.member] = 'streaming';
  } else if (ev.phase === 'done' || ev.phase === 'error') {
    // 状态归位由 roomState 快照负责;这里不动(避免与后端竞态)
  }
}

export async function initStore(): Promise<void> {
  void refreshAdapters();
  await refreshRooms();
  void refreshCharacters();
  connectWs(onWsEvent);
}
