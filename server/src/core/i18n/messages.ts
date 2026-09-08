// A 类文案词典:会广播给前端/REST 响应展示的系统消息、错误、显示名、trace 标签。
// zh 侧为现状源文逐字节拷贝(既有测试断言的锁);en 侧翻译。
// t() 兜底链:lang → zh → key 本身。
// trigger 类文案中内嵌的接棒标签经参数 batonTag 注入(调用点传 batonTagFor(lang),
// zh 侧渲染结果与现状逐字节一致)。
import type { Lang } from './lang';

type MsgParams = Record<string, string | number>;
type MessageDict = Record<string, (p?: MsgParams) => string>;

export const MESSAGES: { zh: MessageDict; en: MessageDict } = {
  zh: {
    // ---- 通用系统名/占位 ----
    'sys.speaker': () => '系统',
    'sys.user': () => '用户',
    'sys.scout': () => '🔍 侦察员',
    'sys.stoppedThinking': () => '(已停止思考)',
    'sys.noOutput': () => '(无输出)',
    'sys.unknownError': () => '未知错误',
    'sys.adapterMissing': (p) => `适配器未配置: ${p?.key ?? ''}`,

    // ---- orchestrator 系统消息(sysNotice/sysMessage) ----
    'orch.wokeQueued': (p) => `已唤醒 ${p?.names ?? ''}，将依次排队回应`,
    'orch.mentionNotFound': () => '没有找到 @ 的成员,控制权回到你手里',
    'orch.mentionReplaced': (p) => `已取消之前的指令,@${p?.name ?? ''} 将回应你并指定下一位`,
    'orch.continueRandom': (p) => `讨论继续, 随机唤醒 ${p?.name ?? ''} 起头回应`,
    'orch.startRandom': (p) => `讨论开始, 随机唤醒 ${p?.name ?? ''} 起头发言`,
    'orch.starterOrigin': (p) => `${p?.origin ?? ''},${p?.name ?? ''} 起头`,
    'orch.rerollNotFound': (p) => `找不到重roll成员: ${p?.id ?? ''}`,
    'orch.roundsStart': (p) => `开始轮流发言 ${p?.rounds ?? 1} 轮`,
    'orch.speakFailed': (p) => `${p?.name ?? ''} 发言失败: ${p?.error ?? ''}`,
    'orch.autoBudgetReached': () => '讨论已达自动发言上限,发条新消息可继续。',
    'orch.discussionEnd': (p) => `🏁 ${p?.name ?? ''} 宣布讨论结束。`,
    'orch.handBack': (p) => `🤝 ${p?.name ?? ''} 把话题交还给了你。`,
    'orch.noNext': (p) => `${p?.name ?? ''} 没有指定下一位,控制权回到你手中。发消息将从随机成员继续。`,
    'orch.pendingStandby': (p) => `⏸ ${p?.name ?? ''} 指定 ${p?.next ?? ''} 接棒。你发消息后 TA 开始发言。`,
    'orch.batonBudgetReached': () => '自由讨论已达接棒上限,发条新消息可继续。',
    'orch.batonPass': (p) => `🎯 ${p?.name ?? ''} 把接棒交给 ${p?.next ?? ''}`,
    'orch.roundsEnd': () => '轮流发言结束。可继续 @成员 追问或发消息自由讨论。',

    // ---- orchestrator trigger(只发给 agent,trace 面板展示;zh 逐字节自源码) ----
    'orch.trigger.designatedStart': (p) => `${p?.fromName ?? ''} 指定你起头,请就主题开个头或回应该消息。`,
    'orch.trigger.atMentionedSubscribe': () => '用户在聊天中 @了你,请针对用户的最新发言发表你的回应与看法。',
    'orch.trigger.atMentionedBaton': (p) => `用户在聊天中 @了你,请回应用户。回应完在结尾用 ${p?.batonTag ?? '<接棒>'}@名字 指定下一位(讨论将暂停等待用户)。`,
    'orch.trigger.userNewViewpoint': () => '用户刚发表了新观点，请针对用户的最新消息发表你的看法。',
    'orch.trigger.discussionOpen': () => '讨论开始，请你先就房间讨论主题开个头。',
    'orch.trigger.discussionContinue': () => '讨论继续,请你先就主题开个头。',
    'orch.trigger.deadAir': () => '刚才有人发言了,轮到你接着说。可以回应、反驳或补充。',
    'orch.trigger.reroll': () => '请重新生成你的发言。针对上述讨论发表你的观点。',
    'orch.trigger.userDirect': (p) => `用户(房间主人)直接对你说:${p?.text ?? ''}\n回应完在结尾用 ${p?.batonTag ?? '<接棒>'}@名字 指定下一位(讨论将暂停等待用户)。`,
    'orch.trigger.roundsMid': (p) => `这是第 ${p?.round ?? 1} 轮发言。${p?.tail ?? ''}`,
    'orch.trigger.roundsFirst': () => '请先亮明你的立场。',
    'orch.trigger.roundsRespond': () => '针对前面发言者的观点进行回应、反驳或补充。',
    'orch.trigger.roundsLast': (p) => `这是第 ${p?.round ?? 1} 轮的收尾发言。针对前面发言者的观点进行回应、反驳或补充。`,
    'orch.trigger.batonToYou': (p) => `${p?.name ?? ''} 指定你接棒。请针对 TA 刚才的发言回应、反驳或补充。`,

    // ---- room ----
    'room.memberJoined': (p) => `${p?.names ?? ''} 加入了房间,当前 ${p?.count ?? 0} 位成员`,
    'room.memberLeft': (p) => `${p?.name ?? ''} 离开了房间`,
    'room.memberMissing': (p) => `成员不存在: ${p?.id ?? ''}`,
    'room.needMembersFirst': () => '房间里还没有成员,请先添加成员再开始。',
    'room.startSubscribe': () => '自由讨论开始(订阅模式): 依据全员发言意愿驱动讨论。',
    'room.startBaton': () => '自由讨论开始(接棒模式):有待命接棒者由 TA 起头,否则随机。',
    'room.defaultName': () => '新房间',
    'room.defaultTopic': () => '自由聊天',
    'room.adminAdapterMissing': (p) => `管理员/侦察适配器未配置: ${p?.key ?? ''}(检查 config/agents.yaml 的 admin.adapter 与 adapters 是否一致)`,

    // ---- room/direct trace 标签 ----
    'trace.scoutExplore': () => '项目目录勘探',
    'trace.summaryDistill': () => '讨论大纲提炼',
    'trace.privateDigest': () => '私聊纪要自总结',
    'trace.heartbeat': () => '心跳自主发言',
    'trace.directChat': () => '1v1用户对话',
    'trace.pendingReason': (p) => `${p?.name ?? ''} 是之前被指定的接棒对象`,
    'trace.coldStartPicked': () => '冷启动随机选中',

    // ---- subscribe engine/publish ----
    'sub.silentSkip': (p) => `${p?.name ?? ''} 评估暂无发言与私聊意向，选择跳过。`,
    'sub.skipViolated': (p) => `${p?.name ?? ''} 尝试跳过发言(点名场景不允许跳过),本次发言已忽略。`,
    'sub.dmMention': (p) => `同事 ${p?.name ?? ''} 在私聊中对你提出了新想法，请回应。`,
    'sub.atMention': (p) => `同事 ${p?.name ?? ''} 在发言中点名提及了你。`,

    // ---- direct ----
    'direct.replyFailed': (p) => `${p?.name ?? ''} 回复失败: ${p?.error ?? ''}`,

    // ---- admin ----
    'admin.scoutTrigger': () => '开场侦察:分析项目并播报,供全员讨论使用',
    'admin.summaryBreaker': () => '管理员摘要服务暂时不可用(连续失败已熔断)。',
    'admin.breakerError': () => '熔断保护中',
    'admin.directTopic': (p) => `与 ${p?.name ?? ''} 的一对一私聊探讨`,

    // ---- ws ----
    'ws.hello': () => 'AI 聊天室已连接',

    // ---- REST/routes(错误消息) ----
    'api.requestFailed': (p) => `请求失败(${p?.status ?? 0})`,
    'api.uploadTooLarge': () => '上传文件超出最大限制 (15MB)',
    'api.roomFileNotCharacter': () => '该文件为房间配置文件，无法作为角色卡导入',
    'api.characterFileNotRoom': () => '该文件为角色卡，无法作为房间配置导入',
    'api.roomJsonInvalid': () => '房间配置文件必须是合法的 JSON 格式',
    'api.roomStructInvalid': () => '无效的房间配置结构',
    'api.unnamedRoom': () => '未命名房间',
    'api.memberN': (p) => `成员${p?.n ?? 1}`,
    'api.member': () => '成员',
    'api.charNeedNamePersona': () => '角色需要名字和人设',
    'api.unknownAdapter': (p) => `未知适配器: ${p?.key ?? ''}`,
    'api.unknownAdapterCfg': (p) => `未知适配器配置: ${p?.key ?? ''}`,
    'api.emptyUpload': () => '上传内容为空',
    'api.unrecognizedFile': () => '无法识别的文件类型，既非角色卡亦非房间配置',
    'api.importFailed': () => '导入失败',
    'api.charCardParseFailed': () => '角色卡解析失败',
    'api.charNotFound': () => '角色不存在',
    'api.emptyMessage': () => '空消息',
    'api.editTextEmpty': () => '编辑文本不能为空',
    'api.traceNotFound': () => '未找到调用日志',
    'api.summaryNotFound': () => '未找到摘要快照',
    'api.roomNotFound': (p) => `房间不存在: ${p?.id ?? ''}`,
    'api.noValidCharacters': () => '没有有效角色',
    'api.projectDirMissing': (p) => `项目目录不存在: ${p?.path ?? ''}`,
    'api.needMemberAndText': () => '缺 memberId 或 text',
    'api.needMembersArray': () => '缺 members 数组',
    'api.instructionFailed': (p) => `指令执行失败: ${p?.msg ?? ''}`,
    'api.orchStartFailed': (p) => `编排启动失败: ${p?.msg ?? ''}`,
    'api.updateSettingsFailed': () => '更新房间设置失败',
    'api.noSuchRoute': (p) => `无此路由: ${p?.method ?? ''} ${p?.path ?? ''}`,
    'api.badLang': () => 'lang 只能是 zh 或 en',

    // ---- historyOps / sessionGuard(core 抛错→REST 展示) ----
    'ho.msgNotFound': (p) => `未找到指定消息: ${p?.id ?? ''}`,
    'ho.aiOnly': () => '只能对 AI 成员的发言执行重roll',
    'sg.personaLocked': () => '当前会话已有消息记录，身份设定已锁定。如需更换请先清空历史消息。',
  },
  en: {
    'sys.speaker': () => 'System',
    'sys.user': () => 'User',
    'sys.scout': () => '🔍 Scout',
    'sys.stoppedThinking': () => '(stopped thinking)',
    'sys.noOutput': () => '(no output)',
    'sys.unknownError': () => 'unknown error',
    'sys.adapterMissing': (p) => `Adapter not configured: ${p?.key ?? ''}`,

    'orch.wokeQueued': (p) => `Woke up ${p?.names ?? ''}; they will respond in turn`,
    'orch.mentionNotFound': () => 'No matching @ member; control returns to you',
    'orch.mentionReplaced': (p) => `Previous instructions cancelled. @${p?.name ?? ''} will respond to you and pick the next speaker`,
    'orch.continueRandom': (p) => `Discussion continues — ${p?.name ?? ''} randomly woken to open the response`,
    'orch.startRandom': (p) => `Discussion starts — ${p?.name ?? ''} randomly woken to open`,
    'orch.starterOrigin': (p) => `${p?.origin ?? ''}, ${p?.name ?? ''} opens`,
    'orch.rerollNotFound': (p) => `Cannot re-roll member: ${p?.id ?? ''}`,
    'orch.roundsStart': (p) => `Round-robin begins: ${p?.rounds ?? 1} round(s)`,
    'orch.speakFailed': (p) => `${p?.name ?? ''} failed to speak: ${p?.error ?? ''}`,
    'orch.autoBudgetReached': () => 'Auto-speech budget reached. Send a new message to continue.',
    'orch.discussionEnd': (p) => `🏁 ${p?.name ?? ''} declared the discussion closed.`,
    'orch.handBack': (p) => `🤝 ${p?.name ?? ''} handed the topic back to you.`,
    'orch.noNext': (p) => `${p?.name ?? ''} did not pick a next speaker; control returns to you. Send a message to continue with a random member.`,
    'orch.pendingStandby': (p) => `⏸ ${p?.name ?? ''} passed the baton to ${p?.next ?? ''}. TA speaks after your next message.`,
    'orch.batonBudgetReached': () => 'Baton chain budget reached. Send a new message to continue.',
    'orch.batonPass': (p) => `🎯 ${p?.name ?? ''} passed the baton to ${p?.next ?? ''}`,
    'orch.roundsEnd': () => 'Round-robin finished. Keep @-mentioning members or send messages for free discussion.',

    'orch.trigger.designatedStart': (p) => `${p?.fromName ?? ''} designated you to open. Please kick off the topic or respond to the message.`,
    'orch.trigger.atMentionedSubscribe': () => 'The user @-mentioned you in chat. Please give your response and view on the user\'s latest message.',
    'orch.trigger.atMentionedBaton': (p) => `The user @-mentioned you in chat. Respond to the user, then pick the next speaker with ${p?.batonTag ?? '<pass>'}@name at the end (discussion pauses until the user speaks).`,
    'orch.trigger.userNewViewpoint': () => 'The user just shared a new viewpoint. Please give your take on the user\'s latest message.',
    'orch.trigger.discussionOpen': () => 'The discussion begins. Please open with the room topic.',
    'orch.trigger.discussionContinue': () => 'The discussion continues. Please open with the topic.',
    'orch.trigger.deadAir': () => 'Someone just spoke; now it is your turn. Respond, rebut, or supplement.',
    'orch.trigger.reroll': () => 'Please regenerate your speech. State your view on the discussion above.',
    'orch.trigger.userDirect': (p) => `The user (room owner) says directly to you: ${p?.text ?? ''}\nAfter responding, pick the next speaker with ${p?.batonTag ?? '<pass>'}@name at the end (discussion pauses until the user speaks).`,
    'orch.trigger.roundsMid': (p) => `This is round ${p?.round ?? 1}. ${p?.tail ?? ''}`,
    'orch.trigger.roundsFirst': () => 'Please state your position first.',
    'orch.trigger.roundsRespond': () => 'Respond to, rebut, or build on the previous speakers\' views.',
    'orch.trigger.roundsLast': (p) => `This is the closing speech of round ${p?.round ?? 1}. Respond to, rebut, or build on the previous speakers' views.`,
    'orch.trigger.batonToYou': (p) => `${p?.name ?? ''} passed the baton to you. Please respond to, rebut, or build on TA's last speech.`,

    'room.memberJoined': (p) => `${p?.names ?? ''} joined the room — ${p?.count ?? 0} members now`,
    'room.memberLeft': (p) => `${p?.name ?? ''} left the room`,
    'room.memberMissing': (p) => `Member not found: ${p?.id ?? ''}`,
    'room.needMembersFirst': () => 'The room has no members yet. Add members before starting.',
    'room.startSubscribe': () => 'Free discussion starts (subscribe mode): driven by everyone\'s willingness to speak.',
    'room.startBaton': () => 'Free discussion starts (baton mode): the pending baton holder opens; otherwise random.',
    'room.defaultName': () => 'New Room',
    'room.defaultTopic': () => 'Free chat',
    'room.adminAdapterMissing': (p) => `Admin/scout adapter not configured: ${p?.key ?? ''} (check admin.adapter vs adapters in config/agents.yaml)`,

    'trace.scoutExplore': () => 'Project directory scouting',
    'trace.summaryDistill': () => 'Discussion outline distillation',
    'trace.privateDigest': () => 'Private DM self-digest',
    'trace.heartbeat': () => 'Heartbeat self-initiated speech',
    'trace.directChat': () => '1v1 user chat',
    'trace.pendingReason': (p) => `${p?.name ?? ''} was the previously designated baton holder`,
    'trace.coldStartPicked': () => 'randomly picked at cold start',

    'sub.silentSkip': (p) => `${p?.name ?? ''} assessed no intent to speak or DM — skipping.`,
    'sub.skipViolated': (p) => `${p?.name ?? ''} tried to skip (not allowed when called out); this speech was ignored.`,
    'sub.dmMention': (p) => `Colleague ${p?.name ?? ''} raised a new idea with you in a DM — please respond.`,
    'sub.atMention': (p) => `Colleague ${p?.name ?? ''} @-mentioned you in their speech.`,

    'direct.replyFailed': (p) => `${p?.name ?? ''} failed to reply: ${p?.error ?? ''}`,

    'admin.scoutTrigger': () => 'Opening scout: analyze the project and broadcast for the discussion',
    'admin.summaryBreaker': () => 'Admin summary service unavailable (breaker tripped after repeated failures).',
    'admin.breakerError': () => 'breaker open',
    'admin.directTopic': (p) => `One-on-one private discussion with ${p?.name ?? ''}`,

    'ws.hello': () => 'AI Chatroom connected',

    'api.requestFailed': (p) => `Request failed (${p?.status ?? 0})`,
    'api.uploadTooLarge': () => 'Upload exceeds the 15MB limit',
    'api.roomFileNotCharacter': () => 'This is a room config file and cannot be imported as a character card',
    'api.characterFileNotRoom': () => 'This is a character card and cannot be imported as a room config',
    'api.roomJsonInvalid': () => 'Room config must be valid JSON',
    'api.roomStructInvalid': () => 'Invalid room config structure',
    'api.unnamedRoom': () => 'Unnamed Room',
    'api.memberN': (p) => `Member ${p?.n ?? 1}`,
    'api.member': () => 'Member',
    'api.charNeedNamePersona': () => 'Character needs a name and a persona',
    'api.unknownAdapter': (p) => `Unknown adapter: ${p?.key ?? ''}`,
    'api.unknownAdapterCfg': (p) => `Unknown adapter config: ${p?.key ?? ''}`,
    'api.emptyUpload': () => 'Upload is empty',
    'api.unrecognizedFile': () => 'Unrecognized file type: neither a character card nor a room config',
    'api.importFailed': () => 'Import failed',
    'api.charCardParseFailed': () => 'Failed to parse character card',
    'api.charNotFound': () => 'Character not found',
    'api.emptyMessage': () => 'Empty message',
    'api.editTextEmpty': () => 'Edit text cannot be empty',
    'api.traceNotFound': () => 'Trace log not found',
    'api.summaryNotFound': () => 'Summary snapshot not found',
    'api.roomNotFound': (p) => `Room not found: ${p?.id ?? ''}`,
    'api.noValidCharacters': () => 'No valid characters',
    'api.projectDirMissing': (p) => `Project directory does not exist: ${p?.path ?? ''}`,
    'api.needMemberAndText': () => 'Missing memberId or text',
    'api.needMembersArray': () => 'Missing members array',
    'api.instructionFailed': (p) => `Instruction failed: ${p?.msg ?? ''}`,
    'api.orchStartFailed': (p) => `Orchestration failed to start: ${p?.msg ?? ''}`,
    'api.updateSettingsFailed': () => 'Failed to update room settings',
    'api.noSuchRoute': (p) => `No such route: ${p?.method ?? ''} ${p?.path ?? ''}`,
    'api.badLang': () => 'lang must be zh or en',

    'ho.msgNotFound': (p) => `Message not found: ${p?.id ?? ''}`,
    'ho.aiOnly': () => 'Re-roll is only allowed on AI member speeches',
    'sg.personaLocked': () => 'This session already has messages; the persona is locked. Clear history to change it.',
  },
};

/** 渲染一条消息:lang → zh → key 本身兜底 */
export function t(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const fn = MESSAGES[lang]?.[key] ?? MESSAGES.zh[key];
  if (!fn) return key;
  return fn(params);
}
