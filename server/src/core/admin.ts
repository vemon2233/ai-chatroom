// Admin 管理员: 承担房间级后台轻量治理任务(项目侦察预分析 + 讨论摘要生成)。
// 继承 v2 Scout 的全部鲁棒基建:
//  - oneShotSpeak: 超时必 clearTimeout + cancel 进程(彻底杜绝定时器泄漏与孤儿进程)
//  - 熔断闩: 连续失败 maxRetries 次后本房间生命周期内不再反复重试
//  - 非阻塞与纯展示: 摘要落盘与状态广播，主聊天区不插入伪装消息

import { randomUUID } from 'node:crypto';
import type { AgentAdapter, SpeakRequest } from '../adapters/base';
import type { ChatMessage, DiscussionSummary } from './types';
import { collectProjectContext } from './projectContext';
import { buildScoutPrompt } from './prompt';
import { oneShotSpeak } from './exec';

export interface AdminConfig {
  adapter: string;        // 用哪个适配器 key(agents.yaml adapters.*)
  model: string;          // 便宜档模型参数(注入 --model)
  allowedTools: string;   // 工具白名单
  timeoutMs: number;      // 超时(超时即取消进程)
  maxRetries: number;     // 熔断: 连续失败 N 次后本房间生命周期内不再重试
}

export type ScoutConfig = AdminConfig;

export class Admin {
  private scoutDone = false;
  private scoutFailureCount = 0;
  private scoutRunning: Promise<ChatMessage | null> | null = null;

  private summaryRunning: Promise<DiscussionSummary | null> | null = null;
  private summaryFailureCount = 0;

  constructor(
    private cfg: AdminConfig,
    private resolveAdapter: (adapterKey: string) => AgentAdapter,
    private adapterEntry: { command: string; args: string[] },
  ) {}

  // ================= 任务一: 项目侦察 (原 Scout 职责) =================

  /** 若绑定项目且未跑过侦察，则跑一次并返回侦察消息 */
  ensureScout(projectPath: string | undefined): Promise<ChatMessage | null> {
    if (!projectPath || this.scoutDone || this.scoutFailureCount >= this.cfg.maxRetries) {
      return Promise.resolve(null);
    }
    if (this.scoutRunning == null) {
      const p = this.runScout(projectPath);
      this.scoutRunning = p.finally(() => { this.scoutRunning = null; });
      return p;
    }
    return this.scoutRunning;
  }

  private async runScout(projectPath: string): Promise<ChatMessage | null> {
    try {
      const ctx = await collectProjectContext(projectPath);
      const req: SpeakRequest = {
        member: 'admin',
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
        this.scoutFailureCount++;
        return null;
      }
      this.scoutDone = true;
      return {
        id: randomUUID(),
        roomId: '', // 由调用方回填
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
      this.scoutFailureCount++;
      return null;
    }
  }

  // ================= 任务二: 讨论摘要 (B2 核心功能) =================

  /**
   * 生成讨论摘要: 并发调用共享同一次执行，支持熔断。
   */
  async generateSummary(
    messages: ChatMessage[],
    topic?: string,
  ): Promise<DiscussionSummary | null> {
    // 过滤系统消息与空消息
    const validMessages = messages.filter((m) => !m.system && m.text.trim().length > 0);
    if (validMessages.length === 0) {
      return null;
    }

    if (this.summaryFailureCount >= this.cfg.maxRetries) {
      return {
        text: '管理员摘要服务暂时不可用(连续失败已熔断)。',
        updatedAt: Date.now(),
        messageCount: validMessages.length,
        status: 'error',
        error: '熔断保护中',
      };
    }

    if (this.summaryRunning == null) {
      const p = this.doGenerateSummary(validMessages, topic);
      this.summaryRunning = p.finally(() => { this.summaryRunning = null; });
      return p;
    }
    return this.summaryRunning;
  }

  private async doGenerateSummary(
    messages: ChatMessage[],
    topic?: string,
  ): Promise<DiscussionSummary | null> {
    try {
      // 截取最近至多 60 条有效消息供摘要
      const slice = messages.slice(-60);
      const historyFormatted = slice
        .map((m) => `[${m.fromName}]: ${m.text}`)
        .join('\n\n');

      const prompt = [
        '你是本次多角色讨论的【管理员】。请根据以下对话记录，生成一份结构清晰、观点明确的 Markdown 格式【讨论摘要】。',
        topic ? `【讨论主题】\n${topic}` : '',
        `【对话记录(共 ${slice.length} 条)】\n${historyFormatted}`,
        '【输出要求】',
        '必须使用以下 Markdown 三级标题结构：',
        '### 1. 核心议题与讨论背景',
        '简要概括当前讨论围绕的核心问题及背景。',
        '### 2. 各方主要观点与分歧',
        '梳理各发言角色的鲜明立场、主要论据以及彼此的争议点。',
        '### 3. 已达成共识与下一步焦点',
        '总结目前各方认可的共识，以及待继续推进的下一步探讨焦点。',
        '直接输出上述 Markdown 正文，不要有任何多余的开场白或礼貌套话。',
      ].filter(Boolean).join('\n\n');

      const req: SpeakRequest = {
        member: 'admin',
        prompt,
        command: this.adapterEntry.command,
        args: [
          ...this.adapterEntry.args,
          '--model', this.cfg.model,
        ],
      };

      const outcome = await oneShotSpeak(req, this.resolveAdapter(this.cfg.adapter), this.cfg.timeoutMs);
      const text = outcome.result.trim();

      if (outcome.status !== 'ok' || !text) {
        this.summaryFailureCount++;
        return {
          text: '',
          updatedAt: Date.now(),
          messageCount: messages.length,
          status: 'error',
          error: outcome.error ?? '生成摘要失败',
        };
      }

      // 重置连续失败计数
      this.summaryFailureCount = 0;
      return {
        text,
        updatedAt: Date.now(),
        messageCount: messages.length,
        status: 'idle',
      };
    } catch (err: any) {
      this.summaryFailureCount++;
      return {
        text: '',
        updatedAt: Date.now(),
        messageCount: messages.length,
        status: 'error',
        error: err?.message ?? '执行异常',
      };
    }
  }
}

// 保持对 Scout 命名的兼容导出
export { Admin as Scout };
