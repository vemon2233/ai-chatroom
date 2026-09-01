// 按当前编排状态构造发给各 CLI 的 prompt:注入房间主题、人设、聊天历史、项目上下文。
// v2 变更:删 buildBatonFallbackPrompt(接棒回问兜底已砍——没写接棒行 = 停止,用户接管)。

import type { ChatMessage, MemberConfig, RoomConfig, ToolPermission } from './types';
import { collectProjectContext } from './projectContext';

/** 聊天历史 → 文本转录(带发言者名)。recent 限制条数以控制 token。 */
export function historyText(messages: ChatMessage[], recent = 40): string {
  const slice = messages.slice(-recent);
  return slice
    .map((m) => `[${m.fromName}] ${m.text}`)
    .join('\n\n');
}

/** 发言长度风格 → prompt 指令 */
export function lengthBrief(style: RoomConfig['speechLength']): string {
  switch (style) {
    case 'long':
      return '发言长度不限,把论证、证据、推理过程充分展开,像给同事写一份严肃的技术论述。';
    case 'normal':
      return '发言控制在 600 字以内,论证完整、有理有据,不空泛。';
    case 'short':
    default:
      return '发言控制在 300 字以内,观点鲜明。如果你不认同某人的说法,直接指出并说明理由。';
  }
}

/** 工具权限档位 → 各成员 prompt 里的能力说明(与适配器的 CLI 参数映射对应) */
export function permissionBrief(p: ToolPermission | undefined): string {
  switch (p) {
    case 'readwrite':
      return '你可以使用 Read / Grep / Glob 工具阅读项目,也可以用 Edit / Write 修改项目文件(谨慎,仅在讨论确有必要时)。';
    case 'full':
      return '你可以使用全部工具(读写项目文件、执行命令)围绕项目工作。';
    case 'readonly':
    default:
      return '你可以使用 Read / Grep / Glob 工具阅读和搜索项目文件,但不能修改任何文件。';
  }
}

/** 构造一次成员发言的完整 prompt。 */
export async function buildPrompt(
  room: RoomConfig,
  member: MemberConfig,
  history: ChatMessage[],
  opts: { trigger?: string; instruction?: string; batonMode?: boolean } = {},
): Promise<string> {
  const others = room.members
    .filter((m) => m.id !== member.id)
    .map((m) => `- ${m.name}: ${m.persona}`)
    .join('\n');

  const parts: string[] = [];

  parts.push(`# 你的角色\n${member.persona}`);

  parts.push(`# 房间:${room.name}\n讨论主题:${room.topic}`);

  if (others) {
    parts.push(`# 其他参与者\n${others}`);
  }

  // 项目上下文:目录树 + 工具探索引导;若已有侦察报告则注入报告并阻止重复探索
  if (room.projectPath) {
    const scoutReport = history.find(
      (m) => m.from === 'scout' && typeof m.text === 'string',
    );
    if (scoutReport) {
      parts.push(
        `# 讨论对象:本地项目(侦察报告已有,无需重复探索)\n` +
        `项目根目录:\`${room.projectPath}\`\n\n` +
        `下方是侦察员已完成的项目分析报告,直接基于它讨论即可——\n` +
        `**不要重复用工具浏览项目**,只有报告未覆盖且讨论确需某个具体文件细节时才单独去读。\n\n` +
        `---\n${scoutReport.text}\n---`,
      );
    } else {
      const ctx = await collectProjectContext(room.projectPath);
      parts.push(
        `# 讨论对象:本地项目\n` +
        `本次讨论围绕一个真实项目进行。项目根目录:\`${ctx.root}\`\n\n` +
        `目录结构概览:\n\`\`\`\n${ctx.tree}\n\`\`\`\n\n` +
        `${permissionBrief(room.toolPermission)}\n` +
        `需要深入了解某个文件时,直接用工具去读,不要凭目录名猜测内容。首次发言前建议先浏览关键文件再表态。`,
      );
    }
  }

  if (history.length > 0) {
    parts.push(`# 聊天记录(按时间顺序,最新在最后)\n${historyText(history)}`);
  }

  const instructions: string[] = [];
  if (opts.trigger) instructions.push(opts.trigger);
  if (opts.instruction) instructions.push(opts.instruction);
  instructions.push(
    '请直接以你的角色身份发言。不要复述设定,不要使用 markdown 标题,直接说出你的观点/回应。',
    lengthBrief(room.speechLength),
  );

  // 接棒模式:发言末尾指定下一位发言者(发言权传递,由发言者自己决定)
  if (opts.batonMode) {
    const otherNames = room.members.filter((m) => m.id !== member.id).map((m) => m.name);
    parts.push(
      `# 接棒规则(重要)\n` +
      `这是自由讨论模式,你发完言后由你决定下一位发言者。发言正文结束后,另起一行写接棒指令:\n` +
      `- 想让谁接话:最后一行写 \`【接棒】@名字\`(从:${otherNames.join(' / ')} 中选)\n` +
      `- 认为讨论已充分收敛、没有继续的必要:最后一行写 \`【接棒】结束\`\n` +
      `选择依据:谁的观点被你质疑了、谁还没说过话、谁的视角最适合回应你刚才的内容。不要把接棒给【接棒】自己。`,
    );
  }

  parts.push(`# 现在轮到你发言\n${instructions.join('\n')}`);

  return parts.join('\n\n---\n\n');
}

/** 接棒尾行解析:从发言全文中提取接棒指令。 */
export function parseBaton(
  text: string,
  members: Array<{ id: string; name: string }>,
  selfId: string,
): { nextMemberId?: string; endDiscussion?: boolean } {
  // 取最后 3 行内找【接棒】标记(容错:agent 可能在正文里换行后又补写)
  const tailLines = text.trim().split('\n').slice(-3);
  for (const line of tailLines.reverse()) {
    const m = line.match(/【接棒】\s*(.+)/);
    if (!m) continue;
    const directive = (m[1] ?? '').trim();
    if (/结束|收敛|无需|到此/.test(directive)) return { endDiscussion: true };
    // @名字 或 直接名字
    const nameMatch = directive.match(/@([^\s@,，。]+)/);
    const rawName = ((nameMatch?.[1]) ?? directive).trim();
    const hit = matchMemberByName(rawName, members);
    if (hit && hit.id !== selfId) return { nextMemberId: hit.id };
    if (hit && hit.id === selfId) return {}; // 传给自己:无效 → 停止(用户接管)
    return {}; // 名字对不上:无效 → 停止(用户接管)
  }
  return {}; // 没有接棒行:停止(用户接管)
}

/**
 * 成员名匹配:精确匹配绝对优先;包含匹配仅作模糊后备,且取"最长命中"
 * (防前缀名误匹配:@工程师3 不能命中排在成员表前面的"工程师"——
 *  v1 实测事故:工程师2 传棒@工程师3,find 顺序命中 1 号"工程师",1 号抢答)。
 */
export function matchMemberByName<T extends { id: string; name: string }>(
  rawName: string,
  members: T[],
): T | undefined {
  // 1) 精确相等
  const exact = members.find((mm) => mm.name === rawName);
  if (exact) return exact;
  // 2) 模糊:取命中名字最长的(工程师3 → "工程师3" 而非 "工程师")
  const fuzzy = members
    .filter((mm) => mm.name.includes(rawName) || rawName.includes(mm.name))
    .sort((a, b) => b.name.length - a.name.length);
  return fuzzy[0];
}

/** 侦察员 prompt:haiku 档、只读工具,产出结构化分析报告供全员共享。 */
export function buildScoutPrompt(projectRoot: string, tree: string): string {
  return [
    `你是项目侦察员。快速分析下面的项目并输出一份精炼的《项目侦察报告》,供一组 AI 讨论者直接使用(他们不会再重复读文件)。`,
    ``,
    `报告结构(纯文本,总共 400 字以内):`,
    `1. 项目是什么(一句话)`,
    `2. 技术栈与关键依赖`,
    `3. 目录结构与核心模块(各一行说明)`,
    `4. 数据存储现状(如有:现有数据库/文件存储/无)`,
    `5. 值得讨论者注意的 2-3 个特点/约束`,
    ``,
    `项目根目录:${projectRoot}`,
    `目录概览:`,
    tree,
    ``,
    `你可以使用 Read/Glob/Grep 工具查看必要文件(README、配置、入口代码),但控制在 10 次以内,快速完成。直接输出报告正文,不要客套。`,
  ].join('\n');
}
