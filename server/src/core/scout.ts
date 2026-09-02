// Scout 侦察:绑定项目的房间,首次成员发言前自动跑一次只读项目分析,全员共享。
// v2 修复(v1 实测 bug):
//  - oneShotSpeak:超时必 clearTimeout + cancel 进程(修定时器泄漏 + 孤儿进程)
//  - 熔断闩:连续失败 maxRetries 次后本房间生命周期内不再重试
//    (v1 里适配器配置错误时,每次发言都付完整侦察超时代价)

import { randomUUID } from 'node:crypto';
import type { AgentAdapter, SpeakOutcome, SpeakRequest } from '../adapters/base';
import type { ChatMessage } from './types';
import { collectProjectContext } from './projectContext';
import { buildScoutPrompt } from './prompt';

export interface ScoutConfig {
  adapter: string;        // 用哪个适配器 key(agents.yaml adapters.*)
  model: string;          // 便宜档模型参数(注入 --model)
  allowedTools: string;   // 只读工具白名单
  timeoutMs: number;      // 超时(超时即取消进程)
  maxRetries: number;     // 熔断:连续失败 N 次后不再重试
}

/**
 * 一次性轻量调用:超时必 clearTimeout + cancel 进程。
 * v1 的两处 Promise.race 超时一份忘了 cancel、两份都忘了 clear——统一收敛到这里。
 */
export async function oneShotSpeak(
  req: SpeakRequest,
  adapter: AgentAdapter,
  timeoutMs: number,
): Promise<SpeakOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const handle = adapter.speak(req, () => { /* 一次性调用不消费事件流 */ });
    const timeout = new Promise<SpeakOutcome>((resolve) => {
      timer = setTimeout(() => {
        handle.cancel(); // 超时必杀进程,不养孤儿
        resolve({ status: 'error', result: '', durationMs: timeoutMs, error: `超时(${timeoutMs}ms)` });
      }, timeoutMs);
    });
    const outcome = await Promise.race([handle.done, timeout]);
    return outcome;
  } finally {
    if (timer != null) clearTimeout(timer); // 无论谁赢,定时器必清
  }
}

/**
 * 跑一次项目侦察,产出侦察员消息(进聊天流,全员 prompt 注入)。
 * 返回 null = 无需/无法侦察(未绑项目、已熔断、超时/失败)。
 * 失败时 failureCount 累进,达到 maxRetries 熔断。
 */
export class Scout {
  private done = false;
  private failureCount = 0;
  private running: Promise<ChatMessage | null> | null = null;

  constructor(
    private cfg: ScoutConfig,
    private resolveAdapter: (adapterKey: string) => AgentAdapter,
    private adapterEntry: { command: string; args: string[] },
  ) {}

  /** 若该跑(绑项目、没跑过、没熔断),跑一次并返回侦察消息;并发调用共享同一次执行。 */
  ensure(projectPath: string | undefined): Promise<ChatMessage | null> {
    if (!projectPath || this.done || this.failureCount >= this.cfg.maxRetries) {
      return Promise.resolve(null);
    }
    if (this.running == null) {
      const p = this.run(projectPath);
      this.running = p.finally(() => { this.running = null; });
      // 保持返回类型 ChatMessage|null(finally 会把 rejection 传播,ok)
      return p;
    }
    return this.running;
  }

  private async run(projectPath: string): Promise<ChatMessage | null> {
    try {
      const ctx = await collectProjectContext(projectPath);
      const req: SpeakRequest = {
        member: 'scout',
        prompt: buildScoutPrompt(ctx.root, ctx.tree),
        command: this.adapterEntry.command,
        args: [
          ...this.adapterEntry.args,
          '--model', this.cfg.model,
          '--allowedTools', this.cfg.allowedTools,
        ],
        cwd: projectPath,
      };
      const outcome = await oneShotSpeak(req, this.resolveAdapter(this.cfg.adapter), this.cfg.timeoutMs);
      const text = outcome.result.trim();
      if (outcome.status !== 'ok' || !text) {
        this.failureCount++;
        return null;
      }
      this.done = true;
      return {
        id: randomUUID(),
        roomId: '', // 由调用方(ChatRoom)回填
        from: 'scout',
        fromName: '🔍 侦察员',
        text,
        ts: Date.now(),
        detail: {
          adapter: this.cfg.adapter,
          trigger: '开场侦察:分析项目并播报,供全员讨论使用',
          durationMs: outcome.durationMs,
        },
      };
    } catch {
      this.failureCount++;
      return null;
    }
  }
}
