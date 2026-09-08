// 接棒模式: 接棒规则 Prompt 提示词段落拼接。
// i18n:文案走 promptTexts 词典;接棒标签经 batonTagFor(lang) 注入(zh '<接棒>' / en '<pass>')。

import type { MemberConfig } from '../../types';
import type { Lang } from '../../i18n/lang';
import { pt } from '../../i18n/promptTexts';
import { batonTagFor } from '../../../protocolKeywords';

export function buildBatonPromptSection(
  member: MemberConfig,
  members: MemberConfig[],
  batonMode: 'chain' | 'callout',
  lang: Lang = 'zh',
): string {
  const otherNames = members.filter((m) => m.id !== member.id).map((m) => m.name);
  const rule = pt(lang, batonMode === 'chain' ? 'b.chainRule' : 'b.calloutRule');

  return pt(lang, 'b.section', {
    rule,
    tag: batonTagFor(lang),
    others: otherNames.join(' / '),
  });
}
