// fetch API 客户端:薄封装,错误统一抛 Error(message 来自后端 {error})。

import { t } from '@/i18n';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any).error ?? t('api.requestFailed', { status: r.status }));
  return j as T;
}

import type { Character, RoomSettings, RoomState, DiscussionMode, SubscribeConfig, ContextMode, UserPersonaSnapshot, DirectChatMeta } from '@server/core/types';
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
  contextMode?: ContextMode;
  userPersona?: UserPersonaSnapshot;
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

  settings: () => req<{ lang: string }>('/api/settings'),
  setLanguage: (lang: 'zh' | 'en') =>
    req<{ lang: string }>('/api/settings/language', { method: 'PUT', body: JSON.stringify({ lang }) }),

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

  // 房间 Trace & 讨论摘要
  roomTraces: (roomId: string) => req<import('@server/store/trace').TraceSummaryItem[]>(`/api/rooms/${roomId}/traces`),
  roomTraceDetail: (roomId: string, messageId: string) => req<import('@server/core/types').AgentTraceLog>(`/api/rooms/${roomId}/traces/${messageId}`),
  roomSummary: (roomId: string) => req<import('@server/core/types').DiscussionSummary>(`/api/rooms/${roomId}/summary`),
  refreshRoomSummary: (roomId: string) => req<import('@server/core/types').DiscussionSummary>(`/api/rooms/${roomId}/summary/refresh`, { method: 'POST' }),
  roomSummaries: (roomId: string) => req<import('@server/core/types').SummarySnapshotItem[]>(`/api/rooms/${roomId}/summaries`),
  roomSummaryDetail: (roomId: string, summaryId: string) => req<import('@server/core/types').DiscussionSummarySnapshot>(`/api/rooms/${roomId}/summaries/${summaryId}`),

  // 1v1 私聊 Trace & 讨论摘要
  directTraces: (characterId: string) => req<import('@server/store/trace').TraceSummaryItem[]>(`/api/characters/${characterId}/traces`),
  directTraceDetail: (characterId: string, messageId: string) => req<import('@server/core/types').AgentTraceLog>(`/api/characters/${characterId}/traces/${messageId}`),
  directSummary: (characterId: string) => req<import('@server/core/types').DiscussionSummary>(`/api/characters/${characterId}/summary`),
  refreshDirectSummary: (characterId: string) => req<import('@server/core/types').DiscussionSummary>(`/api/characters/${characterId}/summary/refresh`, { method: 'POST' }),
  directSummaries: (characterId: string) => req<import('@server/core/types').SummarySnapshotItem[]>(`/api/characters/${characterId}/summaries`),
  directSummaryDetail: (characterId: string, summaryId: string) => req<import('@server/core/types').DiscussionSummarySnapshot>(`/api/characters/${characterId}/summaries/${summaryId}`),

  // 会话用量与开销度量统计
  roomStats: (roomId: string) => req<import('@server/core/types').SessionStats>(`/api/rooms/${roomId}/stats`),
  directStats: (characterId: string) => req<import('@server/core/types').SessionStats>(`/api/characters/${characterId}/stats`),

  // 导入导出 API
  exportCharacterUrl: (id: string) => `/api/characters/${encodeURIComponent(id)}/export`,
  exportRoomUrl: (id: string) => `/api/rooms/${encodeURIComponent(id)}/export`,
  importCharacter: async (file: File): Promise<Character> => {
    const res = await fetch('/api/characters/import', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as any).error ?? t('api.requestFailed', { status: res.status }));
    return j as Character;
  },
  importRoom: async (file: File): Promise<{ id: string; state: RoomState }> => {
    const res = await fetch('/api/rooms/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: file,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as any).error ?? t('api.requestFailed', { status: res.status }));
    return j as { id: string; state: RoomState };
  },
  smartImport: async (
    file: File,
  ): Promise<
    | { type: 'character'; character: Character; id: string }
    | { type: 'room'; id: string; state: RoomState }
  > => {
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as any).error ?? t('api.requestFailed', { status: res.status }));
    return j;
  },

  getDirectMeta: (characterId: string) =>
    req<import('@server/core/types').DirectChatMeta>(`/api/characters/${encodeURIComponent(characterId)}/direct-meta`),
  updateDirectMeta: (characterId: string, meta: import('@server/core/types').DirectChatMeta) =>
    req<{ ok: true; meta: import('@server/core/types').DirectChatMeta }>(
      `/api/characters/${encodeURIComponent(characterId)}/direct-meta`,
      { method: 'PUT', body: JSON.stringify(meta) },
    ),
};
