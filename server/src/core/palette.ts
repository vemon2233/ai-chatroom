// 成员头像色板(展示关注点;room.ts 分配用,前端经 config 透传展示)。
// 视觉重设计:对齐 agent-room 的 AVATAR_PALETTE 饱和色板;
// web/src/lib/avatar.ts 有同值复制(纯展示哈希取色),两侧改动需同步。

export const MEMBER_PALETTE = [
  '#5B6AFF', '#EC4899', '#F59E0B', '#8B5CF6',
  '#10B981', '#F43F5E', '#0EA5E9', '#D946EF',
] as const;
