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
  /** 头像 emoji(已废弃:前端改 initials 头像不再渲染;字段保留做数据向后兼容) */
  emoji?: string;
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
  /** 头像 emoji(前端展示) */
  emoji?: string;
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
  };
  /** 系统事件(如成员加入、轮次开始)而非发言 */
  system?: boolean;
}

export interface RoomConfig {
  id: string;
  name: string;
  /** 房间背景颜色(CSS 颜色) */
  color?: string;
  /** 头像 emoji(侧栏卡片展示;建房可选,默认 💬;旧数据无此字段前端兜底) */
  emoji?: string;
  /** 房间主题/讨论题目(注入每个成员的 prompt) */
  topic: string;
  /** 连续自动接棒上限(防失控烧 token;默认 6,用户新消息重置;设置面板运行期可改) */
  chainBudget: number;
  /** 发言长度风格:short(300字内)/ normal(600字内)/ long(不限);运行期可改 */
  speechLength: 'short' | 'normal' | 'long';
  /** 主持人成员 id(可选;@allN 轮流时每轮末小结) */
  moderatorId?: string;
  /** 绑定的项目目录(成员可用工具在其中自主探索) */
  projectPath?: string;
  /** 工具权限档位(房间级) */
  toolPermission: ToolPermission;
  members: MemberConfig[];
  /** 若为与特定角色的一对一单聊房间，记录该角色 id */
  dmCharacterId?: string;
  createdAt: number;
}

/** 成员运行时状态 */
export type MemberStatus = 'idle' | 'thinking' | 'streaming' | 'error';

/**
 * 编排器显式状态(v2 核心):
 * - idle: 无自动编排,控制权在用户
 * - baton: 接棒自由讨论(常态;发言者尾行决定下一位)
 * - roundrobin: @allN 轮流发言执行中
 */
export type OrchestrationState = 'idle' | 'baton' | 'roundrobin';

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
export type RoomSettings = Pick<RoomConfig, 'speechLength' | 'chainBudget' | 'name' | 'color' | 'emoji' | 'topic'>
  & { moderatorId?: string };
