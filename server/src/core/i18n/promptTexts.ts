// B 类 prompt 段落词典(zh/en)。zh = 现状源文逐字节拷贝(测试断言的锁);
// en 翻译。组装逻辑(prompt.ts 的顺序/拼接/分支)不动——本文件只放"句子"。
// 标签纪律:zh 侧内嵌标签保持原字面量(逐字节);en 侧标签一律经参数注入
// (silentTag/dmTag/agreeTag/rejectTag/ideaTag/batonTag,调用点传 protocolKeywords 的 *For(lang))。
import type { Lang } from './lang';

type P = Record<string, string | number>;
type PromptTextDict = Record<string, (p?: P) => string>;

export const PROMPT_TEXTS: { zh: PromptTextDict; en: PromptTextDict } = {
  zh: {
    // render.ts 转录标签
    'r.privateFromYou': (p) => `> 🔒 **【私聊密信 ── 你 发送给对方】：**\n> ${p?.text ?? ''}`,
    'r.privateToYou': (p) => `> 🔒 **【私聊密信 ── ${p?.name ?? ''} 对 你 悄悄说】：**\n> ${p?.text ?? ''}`,
    'r.privateOther': (p) => `> 🔒 **【私聊密信 ── 来自 ${p?.name ?? ''}】：**\n> ${p?.text ?? ''}`,
    'r.mentioned': (p) => `**🎯【@提及了你】[${p?.name ?? ''}] (全员公聊)：**\n${p?.text ?? ''}`,
    'r.publicMsg': (p) => `**[${p?.name ?? ''}] (全员公聊)：**\n${p?.text ?? ''}`,
    // render.ts 长度指令
    'r.lengthLong': () => '发言长度不限,把论证、证据、推理过程充分展开,像给同事写一份严肃的技术论述。',
    'r.lengthNormal': () => '发言控制在 600 字以内,论证完整、有理有据,不空泛。',
    'r.lengthShort': () => '发言控制在 300 字以内,观点鲜明。如果你不认同某人的说法,直接指出并说明理由。',
    // render.ts 权限说明
    'r.permReadwrite': () => '你可以使用 Read / Grep / Glob 工具阅读项目,也可以用 Edit / Write 修改项目文件(谨慎,仅在讨论确有必要时)。',
    'r.permFull': () => '你可以使用全部工具(读写项目文件、执行命令)围绕项目工作。',
    'r.permReadonly': () => '你可以使用 Read / Grep / Glob 工具阅读和搜索项目文件,但不能修改任何文件。',

    // prompt.ts 段落头
    'p.roleHeader': (p) => `# 你的角色\n你是 **【${p?.name ?? ''}】**。\n${p?.persona ?? ''}`,
    'p.roomHeader': (p) => `# 房间:${p?.name ?? ''}\n讨论主题:${p?.topic ?? ''}`,
    'p.othersHeader': (p) => `# 其他参与者\n${p?.list ?? ''}`,
    'p.ownerSection': (p) => `# 对话者/房主设定\n当前在房间中与你们交流探讨的用户身份为 **【${p?.name ?? ''}】**。\n其背景设定与立场如下:\n${p?.persona ?? ''}`,
    // prompt.ts 项目段
    'p.projectScoutSection': (p) => `# 讨论对象:本地项目(侦察报告已有,无需重复探索)\n项目根目录:\`${p?.root ?? ''}\`\n\n下方是侦察员已完成的项目分析报告,直接基于它讨论即可——\n**不要重复用工具浏览项目**,只有报告未覆盖且讨论确需某个具体文件细节时才单独去读。\n\n---\n${p?.report ?? ''}\n---`,
    'p.projectFreshSection': (p) => `# 讨论对象:本地项目\n本次讨论围绕一个真实项目进行。项目根目录:\`${p?.root ?? ''}\`\n\n目录结构概览:\n\`\`\`\n${p?.tree ?? ''}\n\`\`\`\n\n${p?.perm ?? ''}\n需要深入了解某个文件时,直接用工具去读,不要凭目录名猜测内容。首次发言前建议先浏览关键文件再表态。`,
    // prompt.ts 历史段标签
    'p.publicSummaryLabel': () => '【前期讨论摘要】',
    'p.privateDigestLabel': () => '【你的私聊往来纪要(仅你可见)】',
    'p.recentHistoryLabel': () => '【近期讨论发言(按时间顺序,最新在后)】',
    'p.historySectionHeader': () => '# 聊天记录与讨论背景',
    // prompt.ts 行动指令
    'p.speakDirectly': () => '请直接以你的角色身份发言。不要复述设定,不要使用 markdown 标题,直接说出你的观点/回应。',
    'p.nowTurn': (p) => `# 现在轮到你发言\n${p?.instructions ?? ''}`,
    'p.topicFallback': () => '自由讨论',

    // prompt.ts delta 段
    'd.identityAnchor': (p) => `你是 **【${p?.name ?? ''}】**。请始终保持你的 **既有人设与核心立场**。`,
    'd.unreadHeader': () => '# 自你上次发言以来的最新未读动态:',
    'd.noNewMsg': () => '# 自你上次发言以来暂无新增动态。',
    'd.taskHeader': (p) => `# 你的行动任务:\n${p?.brief ?? ''}`,
    'd.extraInstruction': (p) => `# 额外指令:\n${p?.text ?? ''}`,

    // prompt.ts 侦察(整段单 key)
    's.scoutPrompt': (p) => `你是项目侦察员。快速分析下面的项目并输出一份精炼的《项目侦察报告》,供一组 AI 讨论者直接使用(他们不会再重复读文件)。\n\n报告结构(纯文本,总共 400 字以内):\n1. 项目是什么(一句话)\n2. 技术栈与关键依赖\n3. 目录结构与核心模块(各一行说明)\n4. 数据存储现状(如有:现有数据库/文件存储/无)\n5. 值得讨论者注意的 2-3 个特点/约束\n\n项目根目录:${p?.root ?? ''}\n目录概览:\n${p?.tree ?? ''}\n\n你可以使用 Read/Glob/Grep 工具查看必要文件(README、配置、入口代码),但控制在 10 次以内,快速完成。直接输出报告正文,不要客套。`,

    // baton/prompt.ts(标签经 batonTag 参数)
    'b.chainRule': () => '这是接棒链讨论,你发完言后由你决定下一位发言者,TA 会立即接着发言。',
    'b.calloutRule': () => '你在回应用户的点名。回应完毕后,由你指定下一位发言者——讨论将暂停,等用户发话后 TA 才开始。',
    'b.section': (p) => `# 接棒规则 (重要)\n${p?.rule ?? ''}\n发言正文结束后,另起一行写接棒指令(与用户输入语法一致):\n- 想让谁接话:最后一行写 **${p?.tag ?? '<接棒>'}@名字** (从: ${p?.others ?? ''} 中选)\n- 认为讨论已充分收敛、没有继续的必要:最后一行写 **${p?.tag ?? '<接棒>'}结束**\n选择依据:谁的观点被你质疑了、谁还没说过话、谁的视角最适合回应你刚才的内容。**严禁接棒给自己**。`,

    // subscribe/prompt.ts 心跳
    'h.identity': (p) => `# 你的身份\n你是 **【${p?.name ?? ''}】**。\n立场/人设: ${p?.persona ?? ''}`,
    'h.whitelistHeader': () => '# 可互动同事白名单 (本名单已排除你自己;**严禁给自己发私聊**;**严禁脑补数字后缀如 @名字1**)',
    'h.topic': (p) => `# 讨论主题: ${p?.topic ?? ''}`,
    'h.summaryLabel': () => '# 前期讨论摘要',
    'h.digestLabel': () => '# 你的私聊往来纪要 (仅你可见)',
    'h.unreadHeader': () => '# 自上次查看以来的最新未读消息',
    'h.noNewMsg': () => '(自上次查看以来暂无新消息)',
    'h.twoPhase': (p) => `# 你的行动决策 (两阶段自决法则)\n阅读上述最新讨论，你有完全的自主决定权。请务必按以下两阶段推进你的思考：\n\n【第一阶段：意向自评 (先评估意图，再构思内容)】\n请在心中自评两件事：\n1. **公聊意愿 (0 ~ 100 分)**：你此时在大群公开发言的迫切度。\n   - < 60分：观点刚才已表达清楚、或话题与你关系不大、或想先看别人怎么吵、保持沉默更有利。\n   - ≥ 60分：被他人直接质问、面临重大危机、或有不可不发的新立场/新反驳必须公开宣布。\n2. **私聊意向 (有 / 无)**：审视上方同事白名单，你此刻是否想私下给某人单独通个气、对个暗号、商量对策、提醒兄弟、或暗中结盟？\n   - 若有，明确私聊对象是谁，核心想私下沟通什么 (支持单人如 @名字，也支持同时找多个人如 @名字A @名字B)。\n\n【第二阶段：按自评结果执行输出】\n- 若【公聊意愿 < 60 且 无私聊意向】：**严格直接输出 <跳过>** (保持潜水观望局势，绝不多言)。\n- 若【公聊意愿 ≥ 60 且 无私聊意向】：**直接输出公开发言正文** (纯公聊，无需附带私聊)。\n- 若【公聊意愿 < 60 但 有私聊意向】：**直接输出: <私聊>@同事名字 私信内容** (纯私聊，不发大群公聊)。\n- 若【公聊意愿 ≥ 60 且 有私聊意向】：**先写公开发言，并在结尾另起一行附带: <私聊>@同事名字 私信内容** (系统会自动拆分为公聊与私聊两个独立气泡)。`,
    'h.dmChannel': (p) => `# 当前私聊通道\n你与 **${p?.name ?? ''}** 此前开启过私聊 (第 **${p?.count ?? 1}/3** 轮)。\n若你认为私聊话题已达成共识或已破裂，可直接发公聊；若仍需在私信中回复对方，可按需在私聊末尾附带态度标签:\n- **<同意>** (认同对方意见，终结私聊)\n- **<拒绝>** (拒绝对方方案，终结私聊)\n- **<想法> @${p?.name ?? ''}** (提出补充条件继续私聊)`,
    'h.noBatonRule': (p) => `【重要规则】**禁止输出 ${p?.batonTag ?? '<接棒>'} 标签**。若公聊意愿低于60分且无私聊意向，**严格仅输出 ${p?.silentTag ?? '<跳过>'} 四个字符**，不要输出多余废话。`,

    // subscribe/prompt.ts 通用段(zh 内嵌标签为原字面量)
    'sb.mustRespond': (p) => `# 讨论模式说明(订阅模式 · 你被直接点名)\n用户或同事直接点名要你回应——这是强制发言,你没有跳过权。\n**禁止输出 <跳过> 或 <沉默>**,必须就当前话题做出实质性回应(观点/反驳/补充均可)。\n若想私下沟通,可在发言中附带: <私聊>@名字 悄悄话内容 (系统会自动拆分为独立气泡发布)。\n不要在文末输出 <接棒> 标签。\n可互动同事白名单(严禁给自己发私聊,严禁脑补数字后缀):\n\`\`\`json\n${p?.whitelist ?? ''}\n\`\`\``,
    'sb.auto': (p) => `# 讨论模式说明(订阅模式 · 自主在线群聊)\n本次讨论由心跳自主驱动，无需指定接棒人，不要在文末输出 <接棒> 标签。\n【两阶段自决】发言前请先自省：1. 公聊意愿是否≥60分？ 2. 是否有必要私下找人通气？\n- 若公聊意愿不足60分且无需私聊，直接输出 <跳过> 潜水观望；\n- 若需公开发言，直接阐述你的观点；\n- 若想私下找某位或多位同事单聊/通气/结盟，可在发言中(或独立)附带: <私聊>@名字 悄悄话内容 (系统会自动将公开发言与私信拆分为独立气泡发布)；\n可互动同事白名单(严禁给自己发私聊，严禁脑补数字后缀):\n\`\`\`json\n${p?.whitelist ?? ''}\n\`\`\``,

    // direct 1v1 私聊 prompt 段
    'dv.greetingNamed': (p) => `现在你正在与 **【${p?.name ?? ''}】** 进行一对一的专属私聊。`,
    'dv.greetingAnon': () => `现在你正在与用户进行一对一的专属私聊。`,
    'dv.identity': (p) => `你是 **【${p?.name ?? ''}】**。`,
    'dv.personaIntro': (p) => `你的人设与立场如下:\n${p?.persona ?? ''}`,
    'dv.userPersonaIntro': (p) => `对方（用户）的身份设定与背景如下:\n${p?.persona ?? ''}`,
    'dv.replyGuide': () => `请完全符合你的人设特点，自然、真诚地回复对方的提问或探讨。`,
    'dv.prevSummaryLabel': () => `【前期对话摘要】`,
    'dv.historyLabel': () => `以下是你们此前的对话记录:`,
    'dv.replyPrompt': () => `请回复对方:`,
    'dv.keepPersona': (p) => `你是 **【${p?.name ?? ''}】**。请保持你的 **既有人设与核心立场**。`,
    'dv.deltaIntro': () => `以下是用户发来的新增消息:`,

    // summaryOps 私聊纪要自总结 prompt
    'dp.identity': (p) => `你是 **【${p?.name ?? ''}】**。`,
    'dp.personaIntro': (p) => `你的人设立场如下:\n${p?.persona ?? ''}`,
    'dp.task': () => `【任务指引】\n请以第一人称视角，梳理并总结你在本房间中的所有私聊密信往来。`,
    'dp.focus': () => `重点包括：你与谁沟通过、核心谈了什么、达成了什么共识或密谋、有哪些未决事项或对他人隐瞒的策略信息。`,
    'dp.prevLabel': () => `【你此前记录的既有私聊纪要(请在此基础上滚动更新合并)】`,
    'dp.newRecordsLabel': (p) => `【自上次记录以来的新增私聊记录(共 ${p?.n ?? 0} 条)】`,
    'dp.recordsLabel': (p) => `【你在本房间中的私聊往来记录(共 ${p?.n ?? 0} 条)】`,
    'dp.outputReq': () => `【输出要求】`,
    'dp.outputBody': () => `直接输出你的第一人称私密回忆纪要，内容精炼控制在 500 字以内，不要使用任何开场白或无意义套话。`,
    'dp.whisper': () => `密信`,

    // admin 讨论摘要 prompt
    'a.sysrole': () => `你是本次多角色讨论的【管理员】。请根据对话记录，生成一份结构清晰、观点明确的 Markdown 格式【讨论摘要】。`,
    'a.topicLabel': () => `【讨论主题】`,
    'a.prevLabel': () => `【既有讨论摘要(在其基础上滚动合并更新，800字以内)】`,
    'a.newMsgsLabel': (p) => `【自上次摘要以来的新增公聊发言(共 ${p?.n ?? 0} 条)】`,
    'a.recordsLabel': (p) => `【对话记录(共 ${p?.n ?? 0} 条)】`,
    'a.outputReq': () => `【输出要求】`,
    'a.mdMust': () => `必须使用以下 Markdown 三级标题结构：`,
    'a.h1': () => `### 1. 核心议题与讨论背景`,
    'a.h1body': () => `简要概括当前讨论围绕的核心问题及背景。`,
    'a.h2': () => `### 2. 各方主要观点与分歧`,
    'a.h2body': () => `梳理各发言角色的鲜明立场、主要论据以及彼此的争议点。`,
    'a.h3': () => `### 3. 已达成共识与下一步焦点`,
    'a.h3body': () => `总结目前各方认可的共识，以及待继续推进的下一步探讨焦点。`,
    'a.outputTail': () => `直接输出上述 Markdown 正文，内容控制在 800 字以内，不要有任何多余的开场白或礼貌套话。`,
  },
  en: {
    'r.privateFromYou': (p) => `> 🔒 **[Private DM — you sent to the other side]:**\n> ${p?.text ?? ''}`,
    'r.privateToYou': (p) => `> 🔒 **[Private DM — ${p?.name ?? ''} whispers to you]:**\n> ${p?.text ?? ''}`,
    'r.privateOther': (p) => `> 🔒 **[Private DM — from ${p?.name ?? ''}]:**\n> ${p?.text ?? ''}`,
    'r.mentioned': (p) => `**🎯[@mentioned you] [${p?.name ?? ''}] (public to all):**\n${p?.text ?? ''}`,
    'r.publicMsg': (p) => `**[${p?.name ?? ''}] (public to all):**\n${p?.text ?? ''}`,
    'r.lengthLong': () => 'No length limit. Fully develop your arguments, evidence and reasoning, like a serious technical essay for colleagues.',
    'r.lengthNormal': () => 'Keep each speech under 600 words: complete reasoning, well-grounded, not vague.',
    'r.lengthShort': () => 'Keep each speech under 300 words with a sharp position. If you disagree with someone, say so directly and explain why.',
    'r.permReadwrite': () => 'You may use Read / Grep / Glob tools to read the project, and Edit / Write to modify project files (cautiously, only when the discussion truly requires it).',
    'r.permFull': () => 'You may use all tools (read/write project files, run commands) to work on the project.',
    'r.permReadonly': () => 'You may use Read / Grep / Glob tools to read and search project files, but must not modify any file.',

    'p.roleHeader': (p) => `# Your Role\nYou are **[${p?.name ?? ''}]**.\n${p?.persona ?? ''}`,
    'p.roomHeader': (p) => `# Room: ${p?.name ?? ''}\nDiscussion topic: ${p?.topic ?? ''}`,
    'p.othersHeader': (p) => `# Other Participants\n${p?.list ?? ''}`,
    'p.ownerSection': (p) => `# The User / Room Owner\nThe user talking with you in this room is **[${p?.name ?? ''}]**.\nTheir background and stance:\n${p?.persona ?? ''}`,
    'p.projectScoutSection': (p) => `# Subject: local project (scout report already exists — do not re-explore)\nProject root: \`${p?.root ?? ''}\`\n\nBelow is the scout's project analysis report. Discuss based on it directly —\n**do NOT browse the project with tools again**; only read a specific file if the report misses it and the discussion truly needs the detail.\n\n---\n${p?.report ?? ''}\n---`,
    'p.projectFreshSection': (p) => `# Subject: local project\nThis discussion revolves around a real project. Project root: \`${p?.root ?? ''}\`\n\nDirectory overview:\n\`\`\`\n${p?.tree ?? ''}\n\`\`\`\n\n${p?.perm ?? ''}\nWhen you need to understand a file, read it with tools directly instead of guessing from directory names. Before your first speech, skim key files before taking a stance.`,
    'p.publicSummaryLabel': () => '[Earlier discussion summary]',
    'p.privateDigestLabel': () => '[Your private DM history digest (visible only to you)]',
    'p.recentHistoryLabel': () => '[Recent speeches (chronological, newest last)]',
    'p.historySectionHeader': () => '# Chat History & Context',
    'p.speakDirectly': () => 'Speak directly in character. Do not restate your setup, do not use markdown headings — just state your view/response.',
    'p.nowTurn': (p) => `# It Is Your Turn to Speak\n${p?.instructions ?? ''}`,
    'p.topicFallback': () => 'free discussion',

    'd.identityAnchor': (p) => `You are **[${p?.name ?? ''}]**. Always keep your **established persona and core stance**.`,
    'd.unreadHeader': () => '# New messages since your last speech:',
    'd.noNewMsg': () => '# No new activity since your last speech.',
    'd.taskHeader': (p) => `# Your Task:\n${p?.brief ?? ''}`,
    'd.extraInstruction': (p) => `# Extra Instruction:\n${p?.text ?? ''}`,

    's.scoutPrompt': (p) => `You are a project scout. Quickly analyze the project below and produce a concise "Project Scout Report" for a group of AI discussants to use directly (they will not re-read files).\n\nReport structure (plain text, within 400 words total):\n1. What the project is (one sentence)\n2. Tech stack and key dependencies\n3. Directory structure and core modules (one line each)\n4. Data storage status (if any: existing DB / file storage / none)\n5. 2-3 notable traits/constraints for discussants\n\nProject root: ${p?.root ?? ''}\nDirectory overview:\n${p?.tree ?? ''}\n\nYou may use Read/Glob/Grep tools to inspect necessary files (README, configs, entry code), but keep it within 10 calls and finish fast. Output the report body directly, no pleasantries.`,

    'b.chainRule': () => 'This is a baton-chain discussion. After you finish speaking, you decide the next speaker — they will speak immediately after you.',
    'b.calloutRule': () => 'You are responding to the user\'s call-out. After responding, you pick the next speaker — the discussion pauses, and they only start after the user sends another message.',
    'b.section': (p) => `# Baton Rules (Important)\n${p?.rule ?? ''}\nAfter your speech body, start a new line with the baton directive (same syntax the user uses):\n- To pass to someone: on the last line write **${p?.tag ?? '<pass>'}@name** (choose from: ${p?.others ?? ''})\n- If the discussion has sufficiently converged and need not continue: on the last line write **${p?.tag ?? '<pass>'}end**\nHow to choose: whose view did you challenge, who hasn't spoken yet, whose perspective best responds to what you just said. **Never pass the baton to yourself**.`,

    'h.identity': (p) => `# Your Identity\nYou are **[${p?.name ?? ''}]**.\nStance/persona: ${p?.persona ?? ''}`,
    'h.whitelistHeader': () => '# Interactable Colleague Whitelist (yourself excluded; **never DM yourself**; **never invent numeric suffixes like @name1**)',
    'h.topic': (p) => `# Discussion Topic: ${p?.topic ?? ''}`,
    'h.summaryLabel': () => '# Earlier Discussion Summary',
    'h.digestLabel': () => '# Your Private DM Digest (visible only to you)',
    'h.unreadHeader': () => '# Unread Messages Since You Last Checked',
    'h.noNewMsg': () => '(no new messages since you last checked)',
    'h.twoPhase': (p) => `# Your Action Decision (Two-Phase Self-Determination)\nRead the latest discussion above. You have full autonomy. Proceed in two phases:\n\n[Phase 1: Intent Self-Assessment (assess intent before composing)]\nPrivately evaluate two things:\n1. **Public-speech willingness (0-100)**: how urgently you want to speak publicly in the group right now.\n   - < 60: your view was already made clear, the topic has little to do with you, you want to watch the argument unfold first, or staying silent is safer.\n   - ≥ 60: you were directly challenged, face a major crisis, or have a new position/rebuttal that must be declared publicly.\n2. **DM intent (yes/no)**: review the colleague whitelist above — do you want to privately message someone right now: align, exchange signals, scheme, warn an ally, or form a covert alliance?\n   - If yes, decide who, and what you want to communicate privately (single target like @name, or multiple like @nameA @nameB).\n\n[Phase 2: Execute According to Your Self-Assessment]\n- If [public willingness < 60 AND no DM intent]: **output exactly ${p?.silentTag ?? '<skip>'}** (stay lurking; say nothing more).\n- If [public willingness ≥ 60 AND no DM intent]: **output your public speech directly** (pure public, no DM attached).\n- If [public willingness < 60 BUT DM intent]: **output exactly: ${p?.dmTag ?? '<dm>'}@colleague private message** (pure DM, no group speech).\n- If [public willingness ≥ 60 AND DM intent]: **write your public speech first, then append on a new line at the end: ${p?.dmTag ?? '<dm>'}@colleague private message** (the system splits it into a public bubble and a private bubble).`,
    'h.dmChannel': (p) => `# Active DM Channel\nYou previously opened a DM with **${p?.name ?? ''}** (round **${p?.count ?? 1}/3**).\nIf you believe the topic has reached consensus or broken down, you may simply speak publicly; if you still need to reply in the DM, you may append a stance tag at the end:\n- **${p?.agreeTag ?? '<agree>'}** (endorse the other side, closing the DM)\n- **${p?.rejectTag ?? '<decline>'}** (reject the proposal, closing the DM)\n- **${p?.ideaTag ?? '<idea>'} @${p?.name ?? ''}** (raise a supplementary condition to continue the DM)`,
    'h.noBatonRule': (p) => `【Important】**Do NOT output the ${p?.batonTag ?? '<pass>'} tag.** If public willingness is below 60 and there is no DM intent, **output exactly ${p?.silentTag ?? '<skip>'} and nothing else** — no extra words.`,

    'sb.mustRespond': (p) => `# Discussion Mode (Subscribe · You Were Directly Called Out)\nThe user or a colleague directly called you out — this is a mandatory speech; you have no right to skip.\n**Do NOT output ${p?.silentTag ?? '<skip>'} or ${p?.silentTag2 ?? '<silent>'}**, you must respond substantively to the topic (view/rebuttal/supplement all fine).\nTo communicate privately, append to your speech: ${p?.dmTag ?? '<dm>'}@name secret message (the system splits it into a separate bubble).\nDo not output a ${p?.batonTag ?? '<pass>'} tag at the end.\nInteractable colleague whitelist (never DM yourself, never invent numeric suffixes):\n\`\`\`json\n${p?.whitelist ?? ''}\n\`\`\``,
    'sb.auto': (p) => `# Discussion Mode (Subscribe · Autonomous Group Chat)\nThis discussion is heartbeat-driven; no baton-passing needed — do not output a ${p?.batonTag ?? '<pass>'} tag at the end.\n[Two-phase self-determination] Before speaking, ask yourself: 1. Is public willingness ≥ 60? 2. Is a private DM necessary?\n- If below 60 and no DM needed, output ${p?.silentTag ?? '<skip>'} and lurk;\n- If public speech is due, state your view directly;\n- To privately reach one or more colleagues (align/scheme/ally), append to your speech (or standalone): ${p?.dmTag ?? '<dm>'}@name secret message (the system splits public speech and DM into separate bubbles);\nInteractable colleague whitelist (never DM yourself, never invent numeric suffixes):\n\`\`\`json\n${p?.whitelist ?? ''}\n\`\`\``,

    // direct 1v1 私聊 prompt 段
    'dv.greetingNamed': (p) => `You are now in an exclusive one-on-one private chat with **[${p?.name ?? ''}]**.`,
    'dv.greetingAnon': () => `You are now in an exclusive one-on-one private chat with the user.`,
    'dv.identity': (p) => `You are **[${p?.name ?? ''}]**.`,
    'dv.personaIntro': (p) => `Your persona and stance:\n${p?.persona ?? ''}`,
    'dv.userPersonaIntro': (p) => `The other side's (user's) identity and background:\n${p?.persona ?? ''}`,
    'dv.replyGuide': () => `Reply to the other side naturally and sincerely, fully in character.`,
    'dv.prevSummaryLabel': () => `[Earlier conversation summary]`,
    'dv.historyLabel': () => `Here is your previous conversation:`,
    'dv.replyPrompt': () => `Now reply to the other side:`,
    'dv.keepPersona': (p) => `You are **[${p?.name ?? ''}]**. Always keep your **established persona and core stance**.`,
    'dv.deltaIntro': () => `Here are the new messages from the user:`,

    // summaryOps 私聊纪要自总结 prompt
    'dp.identity': (p) => `You are **[${p?.name ?? ''}]**.`,
    'dp.personaIntro': (p) => `Your persona and stance:\n${p?.persona ?? ''}`,
    'dp.task': () => `[Task Guidance]\nFrom a first-person perspective, sort out and summarize all your private DM exchanges in this room.`,
    'dp.focus': () => `Focus on: who you talked with, what was discussed, what consensus or schemes were reached, what remains open, and what strategic information you are hiding from others.`,
    'dp.prevLabel': () => `[Your previous private digest (roll-update and merge on this basis)]`,
    'dp.newRecordsLabel': (p) => `[New private records since your last digest (${p?.n ?? 0} total)]`,
    'dp.recordsLabel': (p) => `[Your private DM records in this room (${p?.n ?? 0} total)]`,
    'dp.outputReq': () => `[Output Requirements]`,
    'dp.outputBody': () => `Directly output your first-person private memoir, concise and within 500 words, without any opening pleasantries or filler.`,
    'dp.whisper': () => `DM`,

    // admin 讨论摘要 prompt
    'a.sysrole': () => `You are the [Admin] of this multi-role discussion. Based on the conversation, produce a clearly structured Markdown [Discussion Summary] with explicit positions.`,
    'a.topicLabel': () => `[Discussion Topic]`,
    'a.prevLabel': () => `[Existing summary (roll-merge and update on this basis, within 800 words)]`,
    'a.newMsgsLabel': (p) => `[New public speeches since last summary (${p?.n ?? 0} total)]`,
    'a.recordsLabel': (p) => `[Conversation record (${p?.n ?? 0} total)]`,
    'a.outputReq': () => `[Output Requirements]`,
    'a.mdMust': () => `You must use the following level-3 Markdown headings:`,
    'a.h1': () => `### 1. Core Topic & Background`,
    'a.h1body': () => `Briefly summarize the core question and background of the discussion.`,
    'a.h2': () => `### 2. Positions & Disagreements`,
    'a.h2body': () => `Sort out each speaker's stance, key arguments, and points of contention.`,
    'a.h3': () => `### 3. Consensus & Next Focus`,
    'a.h3body': () => `Summarize the consensus reached and the next focus to advance.`,
    'a.outputTail': () => `Output the Markdown above directly, within 800 words, with no opening pleasantries or filler.`,
  },
};

/** 渲染一个 prompt 段落:lang → zh 兜底 */
export function pt(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const fn = PROMPT_TEXTS[lang]?.[key] ?? PROMPT_TEXTS.zh[key];
  if (!fn) return key;
  return fn(params);
}
