// 会话人设领域守卫 (方案 A 不变式: 开局定身份，中途不可换)

import type { UserPersonaSnapshot } from './types';

/**
 * 校验当前会话是否允许变更用户人设
 * 方案 A 铁律:
 *  - 会话历史消息数 <= 0 (开局或清空历史后): 允许自由设定与更换人设
 *  - 会话历史消息数 > 0 (会话进行中): 若尝试变更人设，抛出领域异常阻断
 */
export function assertSessionConfigMutable(
  messageCount: number,
  currentPersona?: UserPersonaSnapshot | null,
  nextPersona?: UserPersonaSnapshot | null,
): void {
  if (messageCount <= 0) return;

  // 提取标准化身份标识进行比较
  const curKey = currentPersona
    ? `${currentPersona.characterId || ''}:${currentPersona.name || ''}:${currentPersona.persona || ''}`
    : '';
  const nextKey = nextPersona
    ? `${nextPersona.characterId || ''}:${nextPersona.name || ''}:${nextPersona.persona || ''}`
    : '';

  if (curKey !== nextKey) {
    throw new Error('当前会话已有消息记录，身份设定已锁定。如需更换请先清空历史消息。');
  }
}
