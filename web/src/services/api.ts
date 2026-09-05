// fetch API 客户端:薄封装,错误统一抛 Error(message 来自后端 {error})。

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any).error ?? `请求失败(${r.status})`);
  return j as T;
}

import type { Character, RoomSettings, RoomState, DiscussionMode, SubscribeConfig } from '@server/core/types';
import type { ChatMessage } from '@server/core/types';

export interface AdapterInfo { key: string; displayName: string; kind: string }
export interface RoomListItem {
  config: RoomState['config'];
  statuses: RoomState['statuses'];
  orchestration: RoomState['orchestration'];
  currentSpeaker?: string;
  lastMessage: { fromName: string; text: string; ts: number } | null;
  messageCount: number;
}
export interface CreateRoomBody {
  name: string;
  color?: string;
  topic: string;
  speechLength?: 'short' | 'normal' | 'long';
  projectPath?: string;
  toolPermission?: 'readonly' | 'readwrite' | 'full';
  chainBudget?: number;
  mode?: DiscussionMode;
  subscribeConfig?: SubscribeConfig;
  members: Array<{
    name: string;
    adapter: string;
    persona: string;
    color?: string;
    characterId?: string;
    extraArgs?: string[];
  }>;
}

export const api = {
  adapters: () => req<{ adapters: AdapterInfo[] }>('/api/adapters'),

  characters: () => req<Character[]>('/api/characters'),
  createCharacter: (body: Omit<Character, 'id' | 'createdAt'>) =>
    req<Character>('/api/characters', { method: 'POST', body: JSON.stringify(body) }),
  updateCharacter: (id: string, body: Partial<Omit<Character, 'id' | 'createdAt'>>) =>
    req<Character>(`/api/characters/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteCharacter: (id: string) => req<{ ok: true }>(`/api/characters/${id}`, { method: 'DELETE' }),

  directMessages: (characterId: string) => req<ChatMessage[]>(`/api/characters/${characterId}/messages`),
  sayDirect: (characterId: string, text: string) =>
    req<{ ok: true }>(`/api/characters/${characterId}/say`, { method: 'POST', body: JSON.stringify({ text }) }),
  stopDirect: (characterId: string) =>
    req<{ ok: true }>(`/api/characters/${characterId}/stop`, { method: 'POST' }),
  resetDirect: (characterId: string) =>
    req<{ ok: true }>(`/api/characters/${characterId}/reset`, { method: 'POST' }),
  rerollDirectMessage: (characterId: string, messageId: string) =>
    req<{ ok: true }>(`/api/characters/${characterId}/messages/${messageId}/reroll`, { method: 'POST' }),
  truncateAfterDirectMessage: (characterId: string, messageId: string) =>
    req<{ ok: true; messages: ChatMessage[] }>(`/api/characters/${characterId}/messages/${messageId}/truncate`, { method: 'POST' }),
  saveEditDirectMessage: (characterId: string, messageId: string, text: string) =>
    req<{ ok: true }>(`/api/characters/${characterId}/messages/${messageId}/edit`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  rooms: () => req<RoomListItem[]>('/api/rooms'),
  createRoom: (body: CreateRoomBody) =>
    req<{ id: string; state: RoomState }>('/api/rooms', { method: 'POST', body: JSON.stringify(body) }),
  deleteRoom: (id: string) => req<{ ok: true }>(`/api/rooms/${id}`, { method: 'DELETE' }),
  roomState: (id: string) => req<RoomState>(`/api/rooms/${id}`),
  messages: (id: string) => req<ChatMessage[]>(`/api/rooms/${id}/messages`),
  clearRoomMessages: (roomId: string) =>
    req<{ ok: true }>(`/api/rooms/${roomId}/clear`, { method: 'POST' }),

  say: (roomId: string, text: string) =>
    req<{ ok: true }>(`/api/rooms/${roomId}/say`, { method: 'POST', body: JSON.stringify({ text }) }),
  instruct: (roomId: string, memberId: string, text: string) =>
    req<{ ok: true }>(`/api/rooms/${roomId}/instruct`, { method: 'POST', body: JSON.stringify({ memberId, text }) }),
  start: (roomId: string) => req<{ ok: true }>(`/api/rooms/${roomId}/start`, { method: 'POST' }),
  stop: (roomId: string) => req<{ ok: true }>(`/api/rooms/${roomId}/stop`, { method: 'POST' }),
  updateSettings: (roomId: string, patch: Partial<RoomSettings>) =>
    req<RoomState>(`/api/rooms/${roomId}/settings`, { method: 'PATCH', body: JSON.stringify(patch) }),

  addMembers: (roomId: string, members: CreateRoomBody['members']) =>
    req<{ added: unknown; state: RoomState }>(`/api/rooms/${roomId}/members`, {
      method: 'POST',
      body: JSON.stringify({ members }),
    }),
  pullCharacters: (roomId: string, characterIds: string[]) =>
    req<{ added: unknown; state: RoomState }>(`/api/rooms/${roomId}/pull-character`, {
      method: 'POST',
      body: JSON.stringify({ characterIds }),
    }),
  removeMember: (roomId: string, memberId: string) =>
    req<{ ok: true }>(`/api/rooms/${roomId}/members/${memberId}`, { method: 'DELETE' }),

  rerollMessage: (roomId: string, messageId: string) =>
    req<{ ok: true; state: RoomState }>(`/api/rooms/${roomId}/messages/${messageId}/reroll`, { method: 'POST' }),
  truncateAfterMessage: (roomId: string, messageId: string) =>
    req<{ ok: true; state: RoomState }>(`/api/rooms/${roomId}/messages/${messageId}/truncate`, { method: 'POST' }),
  saveEditMessage: (roomId: string, messageId: string, text: string) =>
    req<{ ok: true; state: RoomState }>(`/api/rooms/${roomId}/messages/${messageId}/edit`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
};
