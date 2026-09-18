// 接棒模式: 尾行解析与接棒决策纯函数。
// 协议正则/词表真源在 ../../protocolKeywords(根级零依赖叶子)——双语并集匹配。

import { matchMemberByName } from '../../naming';
import {
  BATON_LINE as BATON_LINE_SRC, BATON_STRIP, BATON_END_WORDS, AT_NAME, USER_NAME_ALIASES,
  stripBaton,
} from '../../../protocolKeywords';

/** 接棒行正则(真源 re-export,既有 import 不动) */
export { BATON_LINE_SRC as BATON_LINE };

export interface BatonOutcome {
  nextMemberId?: string;
  endDiscussion?: boolean;
  toUser?: boolean;
}

/**
 * 接棒尾行解析: 从发言全文末尾提取接棒指令(中英标签并集)。
 * @param text 完整发言文本
 * @param members 房间成员候选列表
 * @param selfId 当前发言者 ID (防传给自己)
 * @param userNames 用户或用户人设名称集合 (默认 USER_NAME_ALIASES)
 */
export function parseBaton(
  text: string,
  members: Array<{ id: string; name: string }>,
  selfId: string,
  userNames: string[] = USER_NAME_ALIASES,
): BatonOutcome {
  // 取最后 3 行内找接棒标记(容错: agent 可能在正文里换行后又补写)
  const tailLines = text.trim().split('\n').slice(-3);
  for (const line of tailLines.reverse()) {
    const m = line.match(BATON_LINE_SRC);
    if (!m) continue;
    const directive = (m[1] ?? '').trim();
    if (BATON_END_WORDS.test(directive)) return { endDiscussion: true };
    // @名字 或 直接名字
    const nameMatch = directive.match(AT_NAME);
    const rawName = ((nameMatch?.[1]) ?? directive).trim();

    // 检查是否明确接棒给用户/房主
    if (userNames.some((u) => u && rawName.toLowerCase() === u.toLowerCase())) {
      return { toUser: true };
    }

    const hit = matchMemberByName(rawName, members);
    if (hit && hit.id !== selfId) return { nextMemberId: hit.id };
    if (hit && hit.id === selfId) return {}; // 传给自己: 无效 -> 无指令
    return {}; // 名字对不上: 无效 -> 无指令
  }
  return {}; // 没有接棒行: 无指令
}

/** 剥除发言文本中的接棒尾行(在非接棒模式或非链上发言时使用;双语) */
export function stripBatonLine(text: string): string {
  return stripBaton(text);
}
