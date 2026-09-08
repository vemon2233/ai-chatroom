// 核心领域类型:角色、房间、成员、消息。
// v2 变更(相对 v1):删 RoomMode(模式不再锁死,由消息驱动状态机)、
// 删 cooldownSeconds(功能已砍)、MemberStatus 增加 'cancelled'。

/**
 * 角色:全局一等实体(角色库),独立于房间存在,持久化到 data/characters.json。
 * 拉进房间时复制快照为 MemberConfig;此后改角色库不影响已拉入的成员。
 */
export interface Character {
  id: string;
  /** 显示名 */
  name: string;
  /** 头像背景颜色(CSS 颜色) */
  color?: string;
  /** 适配器 key(agents.yaml 中 adapters.*) */
  adapter: string;
  /** 人设/立场 */
  persona: string;
  /** 可选 CLI 附加参数(如 claude 的 --model sonnet) */
  extraArgs?: string[];
  /** 备注(用户自己看) */
  note?: string;
  createdAt: number;
}

/** 成员实例:角色快照(或临时定义),房间内存在 */
export interface MemberConfig {
  /** 房间内唯一 id */
  id: string;
  /** 显示名 */
  name: string;
  /** 适配器 key(agents.yaml 中 adapters.* ) */
  adapter: string;
  /** 人设/立场 system prompt(拼进每次发言的 prompt 开头) */
  persona: string;
  /** 可选 CLI 附加参数(如 claude 的 --model sonnet) */
  extraArgs?: string[];
  /** 头像色(CSS 颜色,前端展示;后端随机分配) */
  color: string;
  /** 来源角色 id(若从角色库拉入;临时成员为空) */
  characterId?: string;
  /** CLI session 复用:适配器 → 最近 session id(首次发言后填充;持久化到 rooms.json) */
  sessionIds?: Record<string, string>;
}

/** 工具权限档位(房间级,成员继承;映射到 CLI 参数的职责在适配器层) */
export type ToolPermission = 'readonly' | 'readwrite' | 'full';

/** 工作过程时间线中的单条记录(消息 detail.trace 的元素) */
export interface TraceEntry {
  kind: 'thinking' | 'tool_use' | 'tool_result' | 'text';
  ts: number;
  /** thinking: 思考片段;tool_use: 工具名;tool_result: 工具名; */
  label?: string;
  /** tool_use: 命令/输入原文(JSON 字符串);tool_result: 执行输出;thinking/text: 内容 */
  content: string;
}

/** 聊天流中的一条消息 */
export interface ChatMessage {
  id: string;
  roomId: string;
  /** 发送者:成员 id、'user'、'system' 或 'scout'(侦察员) */
  from: string;
  /** 发送者显示名 */
  fromName: string;
  /** 正文(成员的最终发言全文,或用户输入) */
  text: string;
  ts: number;
  /** 该轮详情(成员发言才有;点击气泡展开) */
  detail?: {
    /** 思考过程全文(旧字段,保留兼容既有 JSONL) */
    thinking?: string;
    /** 工作过程时间线:思考/工具调用/结果按发生顺序 */
    trace?: TraceEntry[];
    usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
    /** 真实耗时 ms(由 harness 计时,适配器不得硬编码) */
    durationMs?: number;
    adapter: string;
    /** 点名/触发原因(如"轮到你了"/"被 @点名"/"用户指令") */
    trigger?: string;
    /** 是否存在独立持久化的完整输入输出 Trace 日志 */
    hasTrace?: boolean;
  };
  /** 系统事件(如成员加入、轮次开始)而非发言 */
  system?: boolean;
  /** 私聊受众: 仅该列表内的成员及发送者/用户可见(空表示全员公聊) */
  audience?: string[];
  /** 私聊会话链 ID(同一话题握手共用, 用于 3 条硬闸限制) */
  threadId?: string;
  /** 私聊握手态度: 同意 / 拒绝 / 提出想法 */
  handshake?: 'agree' | 'reject' | 'idea';
  /** 私聊会话轮次 (1 / 2 / 3) */
  privateRound?: number;
  /** 私聊行为: 发起新私聊 / 同意 / 拒绝 / 提出想法 / 回复 */
  privateAction?: 'start' | 'agree' | 'reject' | 'idea' | 'reply';
}

/** 成员私聊纪要(第一人称,只注入该成员本人) */
export interface PrivateDigest {
  text: string;
  coveredMessageId: string;   // 锚点:最后一条被纪要覆盖的私聊消息 id
  updatedAt: number;
  durationMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
}

/** 讨论摘要数据模型 */
export interface DiscussionSummary {
  text: string;
  updatedAt: number;
  messageCount: number;
  status?: 'idle' | 'generating' | 'error';
  error?: string;
  /** 公聊锚点:最后一条被摘要覆盖的公聊消息 id(旧存量无此字段 = 降级照旧注入) */
  coveredMessageId?: string;
  /** stateless 成员的私聊纪要(memberId -> digest;随 summary 文件持久化) */
  privateDigests?: Record<string, PrivateDigest>;
  /** 本次大模型生成的耗时与用量(用于 Trace 与账单统计归集) */
  durationMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
}

/** 摘要历史快照(单个独立文件存储) */
export interface DiscussionSummarySnapshot extends DiscussionSummary {
  id: string;                      // 快照唯一 ID, 例如 sum_1788801234_k8x1
  scope: 'room' | 'direct';
  targetId: string;                // roomId 或 direct characterId / threadId
  createdAt: number;               // 产生时间戳
  trigger?: 'auto' | 'manual';     // 触发方式
}

/** 摘要历史列表条目元数据 */
export interface SummarySnapshotItem {
  id: string;
  scope: 'room' | 'direct';
  targetId: string;
  createdAt: number;
  messageCount: number;
  coveredMessageId?: string;
  trigger?: 'auto' | 'manual';
  status?: 'idle' | 'generating' | 'error';
  error?: string;
}

/** agents.yaml summary 段;0=关 */
export interface SummaryConfig {
  model: string;             // 摘要/compact 用模型,默认 'haiku'
  autoThreshold: number;     // 公聊自动触发,默认 30
  privateThreshold: number;  // 私聊纪要阈值,默认 20
  compactThreshold: number;  // stateful compact 阈值,默认 40
}


/** 完整的 Agent 调用输入输出 Trace 日志 */
export interface AgentTraceLog {
  messageId: string;
  roomId: string;
  memberId: string;
  memberName: string;
  adapter: string;
  ts: number;
  durationMs: number;
  status: 'ok' | 'error' | 'cancelled';
  error?: string;
  trigger?: string;
  input: {
    prompt: string;
    command?: string;
    args?: string[];
    cwd?: string;
    resumeSessionId?: string;
    contextMode?: ContextMode;
  };
  output: {
    result: string;
    thinking?: string;
    trace?: TraceEntry[];
    usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  };
}

/** 房间基础讨论模式:接棒模式(默认) vs 订阅模式(心跳去中心群聊) */
export type DiscussionMode = 'baton' | 'subscribe';

/** 上下文编排模式: stateless(无状态全量注入, 默认) vs stateful(有状态增量追加 --resume) */
export type ContextMode = 'stateless' | 'stateful';

/** 订阅模式配置(心跳周期可配, 默认15s错峰) */
export interface SubscribeConfig {
  /** 基础心跳间隔毫秒数(默认 15000ms) */
  heartbeatIntervalMs?: number;
}

/** 会话级用户人设快照契约(群聊与私聊统一) */
export interface UserPersonaSnapshot {
  characterId?: string;
  name: string;
  avatar?: string;
  color?: string;
  persona?: string;
}

/** 1v1 私聊会话元数据契约 */
export interface DirectChatMeta {
  userPersona?: UserPersonaSnapshot | null;
}

export interface RoomConfig {
  id: string;
  name: string;
  /** 房间背景颜色(CSS 颜色) */
  color?: string;
  /** 房间主题/讨论题目(注入每个成员的 prompt) */
  topic: string;
  /** 连续自动接棒上限(防失控烧 token;默认 6,用户新消息重置;设置面板运行期可改) */
  chainBudget: number;
  /** 发言长度风格:short(300字内)/ normal(600字内)/ long(不限);运行期可改 */
  speechLength: 'short' | 'normal' | 'long';
  /** 绑定的项目目录(成员可用工具在其中自主探索) */
  projectPath?: string;
  /** 工具权限档位(房间级) */
  toolPermission: ToolPermission;
  members: MemberConfig[];
  createdAt: number;
  /** 讨论模式(默认 'baton') */
  mode?: DiscussionMode;
  /** 订阅模式配置 */
  subscribeConfig?: SubscribeConfig;
  /** 上下文模式(默认 'stateless') */
  contextMode?: ContextMode;
  /** 当前房间绑定的用户人设(方案 A: 会话有历史则锁定只读) */
  userPersona?: UserPersonaSnapshot;
}

/** 成员运行时状态 */
export type MemberStatus = 'idle' | 'thinking' | 'streaming' | 'error';

/**
 * 编排器显式状态(v2 核心):
 * - idle: 无自动编排,控制权在用户
 * - baton: 接棒自由讨论(常态;发言者尾行决定下一位)
 * - roundrobin: @allN 轮流发言执行中
 * - subscribe: 订阅模式意愿自评与波次执行中
 */
export type OrchestrationState = 'idle' | 'baton' | 'roundrobin' | 'subscribe';

export interface RoomState {
  config: RoomConfig;
  /** 成员实时状态 */
  statuses: Record<string, MemberStatus>;
  /** 编排器状态 */
  orchestration: OrchestrationState;
  /** 当前正在发言的成员 id(空闲时 undefined) */
  currentSpeaker?: string;
}

/** 运行期设置面板可改的字段(其余 RoomConfig 字段不可变) */
export type RoomSettings = Pick<
  RoomConfig,
  'speechLength' | 'chainBudget' | 'name' | 'color' | 'topic' | 'subscribeConfig' | 'userPersona'
>;

/** 单个角色/用户的度量统计项 */
export interface MemberStats {
  id: string;
  name: string;
  color: string;
  adapter: string;
  isUser: boolean;
  messageCount: number;
  charCount: number;
  sharePct: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  avgDurationMs: number;
  skips: number;
  errors: number;
}

/** 会话级(房间或私聊)用量与开销聚合统计数据 */
export interface SessionStats {
  totalMessages: number;
  totalChars: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  members: MemberStats[];
}
