// 接棒模式: 接棒规则 Prompt 提示词段落拼接。

import type { MemberConfig } from '../../types';

export function buildBatonPromptSection(
  member: MemberConfig,
  members: MemberConfig[],
  batonMode: 'chain' | 'callout',
): string {
  const otherNames = members.filter((m) => m.id !== member.id).map((m) => m.name);
  const rule =
    batonMode === 'chain'
      ? '这是接棒链讨论,你发完言后由你决定下一位发言者,TA 会立即接着发言。'
      : '你在回应用户的点名。回应完毕后,由你指定下一位发言者——讨论将暂停,等用户发话后 TA 才开始。';

  return (
    `# 接棒规则 (重要)\n` +
    `${rule}\n` +
    `发言正文结束后,另起一行写接棒指令(与用户输入语法一致):\n` +
    `- 想让谁接话:最后一行写 **<接棒>@名字** (从: ${otherNames.join(' / ')} 中选)\n` +
    `- 认为讨论已充分收敛、没有继续的必要:最后一行写 **<接棒>结束**\n` +
    `选择依据:谁的观点被你质疑了、谁还没说过话、谁的视角最适合回应你刚才的内容。**严禁接棒给自己**。`
  );
}
