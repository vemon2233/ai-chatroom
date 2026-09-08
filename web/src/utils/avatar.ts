// 头像 initials/颜色纯函数(展示关注点):
// - initialsFor:中文/单字名取 1 字,英文名取前 2 字母大写(agent-room initials 语义的中文明确化)
// - colorForName:名称哈希取色,供侧栏角色卡等无后端 color 字段的场景;
//   房间内成员/消息头像一律用后端分配的 member.color,不用本函数。

/** 前端展示色板(与 server/src/core/palette.ts 的 MEMBER_PALETTE 同值复制——
 * 纯展示用途,后端才是成员颜色分配真源;两侧改动需同步) */
export const AVATAR_PALETTE = [
  '#5B6AFF', '#EC4899', '#F59E0B', '#8B5CF6',
  '#10B981', '#F43F5E', '#0EA5E9', '#D946EF',
] as const;

export interface ColorOption {
  key: 'indigo' | 'pink' | 'amber' | 'purple' | 'emerald' | 'rose' | 'sky' | 'magenta';
  label: string;
  value: string;
}

export const COLOR_OPTIONS: ColorOption[] = [
  { key: 'indigo', label: '靛蓝', value: '#5B6AFF' },
  { key: 'pink', label: '亮粉', value: '#EC4899' },
  { key: 'amber', label: '琥珀', value: '#F59E0B' },
  { key: 'purple', label: '紫罗兰', value: '#8B5CF6' },
  { key: 'emerald', label: '翠绿', value: '#10B981' },
  { key: 'rose', label: '玫瑰红', value: '#F43F5E' },
  { key: 'sky', label: '天蓝', value: '#0EA5E9' },
  { key: 'magenta', label: '洋红', value: '#D946EF' },
];

export function initialsFor(name: string): string {
  if (!name) return '?';
  const trimmed = name.trim();
  // 含 CJK/非 ASCII 字符 → 取首 1 字(「正方」→「正」)
  if (/[^\x00-\x7F]/.test(trimmed)) return trimmed.slice(0, 1).toUpperCase();
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return parts[0]!.slice(0, 2).toUpperCase();
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function colorForName(name: string): string {
  return AVATAR_PALETTE[hash(name) % AVATAR_PALETTE.length]!;
}
