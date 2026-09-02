// 全局响应式状态:消息列表为权威源;roomState 整快照替换(不 merge)。
// 设计原则(v1 教训):agentEvent 只更新流式缓冲与状态 chip,
// 消息本体只在 'message' 事件到来时进入列表——不会出现半截消息与最终消息并存。

import { reactive } from 'vue';
import type { Character, ChatMessage, RoomState } from '@server/core/types';
import type { AgentEvent } from '@server/adapters/base';
import type { AdapterInfo, RoomListItem } from './api';
import { api } from './api';
import { connectWs } from './ws';

export interface StreamBuf { text: string; thinking: string }

export const store = reactive({
  adapters: [] as AdapterInfo[],
  rooms: [] as RoomListItem[],
  characters: [] as Character[],
  currentRoom: null as RoomState | null,
  messages: [] as ChatMessage[],
  /** memberId → 流式缓冲(进行中发言的占位渲染) */
  memberStream: {} as Record<string, StreamBuf>,
  sidebarTab: 'rooms' as 'rooms' | 'chars',
});

export function currentRoomId(): string | null {
  return store.currentRoom?.config.id ?? null;
}

/** 进入房间:拉 state+历史,整快照替换。 */
export async function enterRoom(roomId: string): Promise<void> {
  const [state, msgs] = await Promise.all([
    api.roomState(roomId),
    api.messages(roomId),
  ]);
  store.currentRoom = state;
  store.messages = msgs;
  store.memberStream = {};
}

export async function refreshRooms(): Promise<void> {
  store.rooms = await api.rooms();
}

export async function refreshCharacters(): Promise<void> {
  store.characters = await api.characters();
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
    case 'agentEvent': {
      const rid = currentRoomId();
      if (rid === ev.roomId) onAgentEvent(ev.event);
      return;
    }
    case 'roomState': {
      const rid = currentRoomId();
      if (rid === ev.roomId) {
        store.currentRoom = ev.state; // 整快照替换,不 merge
        // 状态归位的成员清理流式缓冲(正常完成由 message 事件清;stop/error 等
        // 无最终消息的路径在此兜底,防止"正在思考…"占位气泡永久悬挂)
        for (const [mid, status] of Object.entries(ev.state.statuses)) {
          if (status === 'idle' || status === 'error') delete store.memberStream[mid];
        }
      }
      return;
    }
    case 'rooms': {
      void refreshRooms();
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

export function initStore(): void {
  void refreshAdapters();
  void refreshRooms();
  void refreshCharacters();
  connectWs(onWsEvent);
}
