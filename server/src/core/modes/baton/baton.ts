// 接棒模式: 尾行解析与接棒决策纯函数。

import { matchMemberByName } from '../../prompt';

/** 接棒行正则: 新语法 <接棒>(用户/agent 统一) + 旧语法 【接棒】(兼容旧 session 的记忆惯性)。 */
export const BATON_LINE = /(?:<接棒>|【接棒】)\s*(.+)/;

export interface BatonOutcome {
  nextMemberId?: string;
  endDiscussion?: boolean;
}

/**
 * 接棒尾行解析: 从发言全文末尾提取接棒指令。
 * @param text 完整发言文本
 * @param members 房间成员候选列表
 * @param selfId 当前发言者 ID (防传给自己)
 */
export function parseBaton(
  text: string,
  members: Array<{ id: string; name: string }>,
  selfId: string,
): BatonOutcome {
  // 取最后 3 行内找接棒标记(容错: agent 可能在正文里换行后又补写)
  const tailLines = text.trim().split('\n').slice(-3);
  for (const line of tailLines.reverse()) {
    const m = line.match(BATON_LINE);
    if (!m) continue;
    const directive = (m[1] ?? '').trim();
    if (/结束|收敛|无需|到此/.test(directive)) return { endDiscussion: true };
    // @名字 或 直接名字
    const nameMatch = directive.match(/@([^\s@,，。]+)/);
    const rawName = ((nameMatch?.[1]) ?? directive).trim();
    const hit = matchMemberByName(rawName, members);
    if (hit && hit.id !== selfId) return { nextMemberId: hit.id };
    if (hit && hit.id === selfId) return {}; // 传给自己: 无效 -> 无指令
    return {}; // 名字对不上: 无效 -> 无指令
  }
  return {}; // 没有接棒行: 无指令
}

/** 剥除发言文本中的接棒尾行(在非接棒模式或非链上发言时使用) */
export function stripBatonLine(text: string): string {
  return text.replace(/(?:<接棒>|【接棒】)[^\n]*/g, '').trimEnd();
}
