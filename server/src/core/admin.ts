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
import { filterValidPublic, splitHistoryByAnchor } from './summaryOps';
import { t } from './i18n/messages';
import type { Lang, LangGetter } from './i18n/lang';


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

  /** 语言注入(未注入 → zh,与改造前逐字节一致) */
  private getLang?: LangGetter;

  constructor(
    private cfg: AdminConfig,
    private resolveAdapter: (adapterKey: string) => AgentAdapter,
    private adapterEntry: { command: string; args: string[] },
    getLang?: LangGetter,
  ) {
    this.getLang = getLang;
  }

  /** 当前语言(发射时刻取值;未注入恒 zh——现状不变量) */
  private get lang(): Lang {
    return this.getLang?.() ?? 'zh';
  }

  /** 显式标记侦察已完成(如历史记录中已存在侦察消息时由 ChatRoom.restore 调用) */
  markScoutDone(): void {
    this.scoutDone = true;
  }

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
        prompt: buildScoutPrompt(ctx.root, ctx.tree, this.lang),
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
        fromName: t(this.lang, 'sys.scout'),
        text,
        ts: Date.now(),
        detail: {
          adapter: this.cfg.adapter,
          trigger: t(this.lang, 'admin.scoutTrigger'),
          durationMs: outcome.durationMs,
          usage: outcome.usage,
        },
      };
    } catch {
      this.scoutFailureCount++;
      return null;
    }
  }

  // ================= 任务二: 讨论摘要 (上下文压缩层公聊核心) =================

  /**
   * 生成讨论摘要: 并发调用共享同一次执行，支持熔断与链式滚动合并。
   */
  async generateSummary(input: {
    messages: readonly ChatMessage[];
    topic?: string;
    prevSummary?: DiscussionSummary | null;
  }): Promise<DiscussionSummary | null> {
    const { messages, topic, prevSummary } = input;

    // 过滤纯公聊消息(严格剔除私聊与系统消息)
    const validPublic = filterValidPublic(messages);
    if (validPublic.length === 0) {
      return null;
    }

    if (this.summaryFailureCount >= this.cfg.maxRetries) {
      return {
        text: t(this.lang, 'admin.summaryBreaker'),
        updatedAt: Date.now(),
        messageCount: validPublic.length,
        status: 'error',
        error: t(this.lang, 'admin.breakerError'),
      };
    }

    if (this.summaryRunning == null) {
      const p = this.doGenerateSummary(messages, validPublic, topic, prevSummary);
      this.summaryRunning = p.finally(() => {
        this.summaryRunning = null;
      });
      return p;
    }
    return this.summaryRunning;
  }

  private async doGenerateSummary(
    rawMessages: readonly ChatMessage[],
    validPublic: ChatMessage[],
    topic?: string,
    prevSummary?: DiscussionSummary | null,
  ): Promise<DiscussionSummary | null> {
    try {
      // 锚点切分判定
      const { anchorValid, after } = splitHistoryByAnchor(
        validPublic,
        prevSummary?.coveredMessageId,
      );

      // 若锚点失效(如历史被截断/清空导致锚点不在)，丢弃旧文全量重摘；否则链式继承
      const effectivePrev = anchorValid ? prevSummary : null;
      const targetMessages = effectivePrev ? after : validPublic;

      // 如果有有效旧摘要且没有新增公聊，无需重复调用大模型
      if (effectivePrev?.text && targetMessages.length === 0) {
        return effectivePrev;
      }

      const historyFormatted = targetMessages
        .map((m) => `[${m.fromName}]: ${m.text}`)
        .join('\n\n');

      const promptParts: string[] = [
        '你是本次多角色讨论的【管理员】。请根据对话记录，生成一份结构清晰、观点明确的 Markdown 格式【讨论摘要】。',
      ];

      if (topic) {
        promptParts.push(`【讨论主题】\n${topic}`);
      }

      if (effectivePrev?.text) {
        promptParts.push(
          `【既有讨论摘要(在其基础上滚动合并更新，800字以内)】\n${effectivePrev.text}`,
          `【自上次摘要以来的新增公聊发言(共 ${targetMessages.length} 条)】\n${historyFormatted}`,
        );
      } else {
        promptParts.push(
          `【对话记录(共 ${targetMessages.length} 条)】\n${historyFormatted}`,
        );
      }

      promptParts.push(
        '【输出要求】',
        '必须使用以下 Markdown 三级标题结构：',
        '### 1. 核心议题与讨论背景',
        '简要概括当前讨论围绕的核心问题及背景。',
        '### 2. 各方主要观点与分歧',
        '梳理各发言角色的鲜明立场、主要论据以及彼此的争议点。',
        '### 3. 已达成共识与下一步焦点',
        '总结目前各方认可的共识，以及待继续推进的下一步探讨焦点。',
        '直接输出上述 Markdown 正文，内容控制在 800 字以内，不要有任何多余的开场白或礼貌套话。',
      );

      const prompt = promptParts.filter(Boolean).join('\n\n');

      const req: SpeakRequest = {
        member: 'admin',
        prompt,
        command: this.adapterEntry.command,
        args: [...this.adapterEntry.args, '--model', this.cfg.model],
      };

      const outcome = await oneShotSpeak(
        req,
        this.resolveAdapter(this.cfg.adapter),
        this.cfg.timeoutMs,
      );
      const text = outcome.result.trim();

      if (outcome.status !== 'ok' || !text) {
        this.summaryFailureCount++;
        return {
          text: '',
          updatedAt: Date.now(),
          messageCount: validPublic.length,
          status: 'error',
          error: outcome.error ?? '生成摘要失败',
        };
      }

      // 重置连续失败计数
      this.summaryFailureCount = 0;

      // 纪要槽位(privateDigests)由纪要生成器各自负责(ChatRoom 串行链内槽位化合并),
      // 摘要只产出自己的槽位——绝不跨界捎带/清扫别人的纪要(旧行为:快照过期导致互吞)
      const lastPublic = validPublic[validPublic.length - 1];

      return {
        text,
        updatedAt: Date.now(),
        messageCount: validPublic.length,
        coveredMessageId: lastPublic?.id,
        status: 'idle',
        durationMs: outcome.durationMs,
        usage: outcome.usage,
      };
    } catch (err: any) {
      this.summaryFailureCount++;
      return {
        text: '',
        updatedAt: Date.now(),
        messageCount: validPublic.length,
        status: 'error',
        error: err?.message ?? '执行异常',
      };
    }
  }
}


// 保持对 Scout 命名的兼容导出
export { Admin as Scout };
