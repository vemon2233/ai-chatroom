// 适配器层公共类型:把各 CLI 的输出归一化为统一事件流。
// v2 变更(相对 v1):done 结果改为 SpeakOutcome(cancelled 与 error 显式区分,
// durationMs 由 harness 统一计时);工具权限作为领域枚举传入,CLI 参数映射在适配器内。

import type { ToolPermission } from '../core/types';

/** 一次发言的生命周期阶段 */
export type AgentPhase =
  | 'thinking' // 已启动,尚未产出正文
  | 'streaming' // 正文增量输出中
  | 'done' // 完成,result 为最终全文
  | 'error'; // 失败,error 为原因

/** 适配器上报的统一事件 */
export interface AgentEvent {
  /** 成员实例 id(由编排层分配,透传回来) */
  member: string;
  phase: AgentPhase;
  /** streaming 阶段的正文增量 */
  textDelta?: string;
  /** done 阶段的最终全文 */
  result?: string;
  /** error 阶段的原因 */
  error?: string;
  /** 思考过程片段(如 Claude 的 thinking 块),用于气泡详情展开 */
  thinkingDelta?: string;
  /** 工具调用事件:工具名 + 输入原文 */
  toolUse?: { name: string; input: string };
  /** 工具结果事件:工具名 + 输出原文 */
  toolResult?: { name: string; output: string };
  /** token 用量(尽力解析,字段缺失则略) */
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
  /** 本次发言的 CLI session id(发现即上报,供下次 resume) */
  sessionId?: string;
}

/** 一次发言的启动参数 */
export interface SpeakRequest {
  /** 成员实例 id */
  member: string;
  /** 构造好的完整 prompt(含人设与聊天历史) */
  prompt: string;
  /** CLI 命令(来自 agents.yaml) */
  command: string;
  /** 命令参数模板 */
  args: string[];
  /** 可选附加环境变量 */
  env?: Record<string, string>;
  /** 工作目录:绑定项目的房间传项目根(agent 工具在其中执行);
   *  缺省用隔离临时目录,防止 spawn 的 CLI 污染用户项目状态 */
  cwd?: string;
  /** CLI session 复用:传入则 resume 该 session,否则新开 */
  resumeSessionId?: string;
  /** 工具权限档位(领域枚举;适配器负责翻译成 CLI 参数) */
  permission?: ToolPermission;
  /** 单次发言超时毫秒数(工单05:0/缺省=无限;超时走 cancelled 轨道+timedOut 标记) */
  timeoutMs?: number;
}

/** 一次发言的最终结果(outcome 三态,编排器据此分流) */
export interface SpeakOutcome {
  status: 'ok' | 'error' | 'cancelled';
  /** ok:最终全文;error:原因;cancelled:空 */
  result: string;
  /** 真实耗时 ms(harness 统一计时,谁都不许硬编码 0) */
  durationMs: number;
  /** error 时的原因 */
  error?: string;
  /** token 用量(尽力解析,字段缺失则略) */
  usage?: AgentEvent['usage'];
  /** 超时终止标记(工单05:仅 status='cancelled' 时可能为 true;区分用户主动停与超时停) */
  timedOut?: boolean;
}

/** 适配器:spawn 一次发言进程,把 CLI 原始输出解析为统一事件。
 *  返回 cancel 句柄;done resolve 后进程必然已退出。 */
export interface AgentAdapter {
  speak(
    req: SpeakRequest,
    onEvent: (ev: AgentEvent) => void,
  ): {
    /** 请求结束(正常/出错/被取消)后 resolve */
    done: Promise<SpeakOutcome>;
    /** 强制终止进程树 */
    cancel: () => void;
  };
}
