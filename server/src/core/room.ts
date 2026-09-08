// ChatRoom v2:薄门面(≤200 行,v1 是 905 行 God class)。
// 职责:持有 config/messages、成员管理、对编排器的依赖装配、持久化触发。
// 一切"谁在何时说"的决策在 orchestrator;"怎么调 CLI"在 adapters。

import { randomUUID } from 'node:crypto';
import type { MessageBus } from './bus';
import { Orchestrator } from './orchestrator';
import { Admin, type AdminConfig } from './admin';
import { MEMBER_PALETTE } from './palette';
import type { ChatMessage, DiscussionSummary, MemberConfig, RoomConfig, RoomSettings, RoomState, SummaryConfig } from './types';
import { assertSessionConfigMutable } from './sessionGuard';
import type { LangGetter } from './i18n/lang';
import { t } from './i18n/messages';
import type { Lang } from './i18n/lang';
import { getAdapter as getAdapterByKind } from '../adapters/index';
import { truncateMessages, prepareReroll, prepareEdit, backfillHandshake } from './historyOps';
import type { AgentTraceLog } from './types';
import {
  countUncoveredPublic,
  countUncoveredPrivateFor,
  uncoveredPrivateMessages,
  executePrivateDigest,
} from './summaryOps';

/**
 * 持久化/落库窄接口(构造注入,server 层装配;core 不 import store——依赖单向)。
 * 按"谁消费谁声明"切窄:房间需要消息接缝 + 摘要接缝 + trace 接缝。
 */
export interface RoomPersistence {
  /** rooms.json 写穿(config 全量替换该 entry) */
  persistRoom(cfg: RoomConfig): Promise<void>;
  /** JSONL 历史加载(重启复活) */
  loadMessages(roomId: string): Promise<ChatMessage[]>;
  /** JSONL 历史全量重写(截断/编辑/回溯) */
  rewriteMessages(roomId: string, messages: ChatMessage[]): Promise<void>;
  /** JSONL 消息追加(单条落库) */
  appendMessage(msg: ChatMessage): Promise<void>;
}

/** 摘要快照存取接缝(公聊摘要与私聊纪要共用落盘通道) */
export interface SummaryStorePort {
  getSummary(scope: 'room' | 'direct', id: string): Promise<DiscussionSummary | null>;
  saveSummarySnapshot(
    scope: 'room' | 'direct',
    id: string,
    summary: DiscussionSummary,
    trigger: 'auto' | 'manual',
  ): Promise<{ id: string }>;
}

/** Trace 落库接缝(完整调用日志) */
export interface TraceStorePort {
  saveTrace(scope: 'room' | 'direct', id: string, trace: AgentTraceLog): Promise<void>;
}

export interface CreateRoomInput {
  name: string;
  color?: string;
  topic: string;
  projectPath?: string;
  toolPermission?: RoomConfig['toolPermission'];
  speechLength?: RoomConfig['speechLength'];
  chainBudget?: number;
  mode?: RoomConfig['mode'];
  subscribeConfig?: RoomConfig['subscribeConfig'];
  contextMode?: RoomConfig['contextMode'];
  userPersona?: RoomConfig['userPersona'];
  members: Array<Omit<MemberConfig, 'id' | 'color'> & { color?: string }>;
}

export class ChatRoom {
  readonly config: RoomConfig;
  private messages: ChatMessage[] = [];
  private orch: Orchestrator;
  private admin: Admin;
  private adminCfg: AdminConfig;
  private currentSummary: DiscussionSummary | null = null;
  private summaryCfg: SummaryConfig;
  private adapterConfigs: Record<string, { kind: string; command: string; args: string[] }>;
  private privateDigestRunning = new Set<string>();
  /** store 窄接口(摘要快照/trace;server 装配注入) */
  private ports: { summaryStore?: SummaryStorePort; traceStore?: TraceStorePort; getLang?: LangGetter };
  /** 语言注入(未注入 → zh) */
  private getLangFn?: LangGetter;
  /** 当前语言(发射时刻取值;未注入恒 zh——现状不变量) */
  protected get lang(): Lang {
    return this.getLangFn?.() ?? 'zh';
  }

  private get summaryStore(): SummaryStorePort {
    // 未注入时降级为空实现(trace/快照落盘跳过,消息链路不受影响——纯内存运行/测试场景)
    return this.ports.summaryStore ?? {
      getSummary: async () => null,
      saveSummarySnapshot: async () => ({ id: `noop_${Date.now()}` }),
    };
  }

  private get traceStore(): TraceStorePort {
    return this.ports.traceStore ?? {
      saveTrace: async () => {},
    };
  }

  constructor(
    cfg: RoomConfig,
    private bus: MessageBus,
    adapterConfigs: Record<string, { kind: string; command: string; args: string[] }>,
    adminCfg: AdminConfig,
    private persistence: RoomPersistence,
    summaryCfg?: SummaryConfig,
    ports?: {
      summaryStore?: SummaryStorePort;
      traceStore?: TraceStorePort;
      /** 语言注入(未注入 → zh,与改造前逐字节一致) */
      getLang?: LangGetter;
    },
  ) {
    this.config = cfg;
    this.adapterConfigs = adapterConfigs;
    this.adminCfg = adminCfg;
    this.ports = ports ?? {};
    this.getLangFn = ports?.getLang;
    this.summaryCfg = summaryCfg ?? {
      model: 'haiku',
      autoThreshold: 30,
      privateThreshold: 20,
      compactThreshold: 40,
    };

    const adminAdapterEntry = adapterConfigs[adminCfg.adapter];
    if (!adminAdapterEntry) {
      throw new Error(t(this.lang, 'room.adminAdapterMissing', { key: adminCfg.adapter }));
    }
    this.admin = new Admin(
      adminCfg,
      (key) => {
        const entry = adapterConfigs[key];
        if (!entry) throw new Error(t(this.lang, 'room.adminAdapterMissing', { key }));
        return getAdapterByKind(entry.kind);
      },
      { command: adminAdapterEntry.command, args: adminAdapterEntry.args },
      () => this.lang,
    );
    this.orch = new Orchestrator({
      room: cfg,
      adapterConfigs, // command/args 视图
      resolveAdapter: (key) => {
        const kind = adapterConfigs[key]?.kind ?? key;
        return getAdapterByKind(kind);
      },
      pushMessage: (msg) => this.pushMessage(msg),
      sysMessage: (text) => this.sysMessage(text),
      onStatuses: () => this.bus.emitRoomState(this.getState()),
      persistRoom: () => this.persistence.persistRoom(this.config),
      runScout: async () => {
        const report = await this.admin.ensureScout(this.config.projectPath);
        if (report) {
          await this.pushMessage({ ...report, roomId: this.config.id });
          const traceLog: AgentTraceLog = {
            messageId: report.id,
            roomId: this.config.id,
            memberId: 'system',
            memberName: t(this.lang, 'sys.speaker'),
            adapter: report.detail?.adapter || this.adminCfg.adapter || 'admin',
            ts: report.ts,
            durationMs: report.detail?.durationMs ?? 0,
            status: 'ok',
            trigger: t(this.lang, 'trace.scoutExplore'),
            input: {
              prompt: report.detail?.trigger || t(this.lang, 'trace.scoutExplore'),
              cwd: this.config.projectPath,
            },
            output: {
              result: report.text,
              usage: (report.detail as any)?.usage,
            },
          };
          void this.traceStore.saveTrace('room', this.config.id, traceLog);
        }
        return report;
      },
      getHistory: () => this.messages,
      pushAgentEvent: (ev) => this.bus.emitAgentEvent(this.config.id, ev),
      getSummary: () => this.currentSummary,
      saveTrace: (scope, id, traceLog) => this.traceStore.saveTrace(scope, id, traceLog),
      summaryCfg: this.summaryCfg,
      getLang: () => this.lang,
    });
  }

  /** 从持久化恢复历史和摘要(服务重启后,listen 前 await)。 */
  async restore(): Promise<void> {
    this.messages = backfillHandshake(await this.persistence.loadMessages(this.config.id));
    this.currentSummary = await this.summaryStore.getSummary('room', this.config.id);
    // 私聊协议从事实源派生重建(订阅房间重启后线程/硬闸计数恢复;同步纯内存微秒级)
    this.orch.rebuildPrivateProtocolFromHistory();
    // 若历史中已有侦察员报告，同步标记侦察已完成，杜绝重启后首条消息重复勘探
    if (this.messages.some((m) => m.from === 'scout')) {
      this.admin.markScoutDone();
    }
  }

  /** 获取当前讨论摘要 */
  async getSummary(): Promise<DiscussionSummary | null> {
    if (!this.currentSummary) {
      this.currentSummary = await this.summaryStore.getSummary('room', this.config.id);
    }
    return this.currentSummary;
  }

  /**
   * 摘要串行链(与 store/rooms 的 writeChain 同构纪律):
   * 生成(30~120s 大模型调用)照常并发,但"合并+落盘+广播"必须经此链排队,
   * 链内基于最新 currentSummary 做槽位化合并——物理上消灭多写者整体覆盖互吞
   * (旧缺陷:双成员纪要并发 / 摘要生成窗口内新写入的纪要被旧快照覆盖)。
   */
  private summaryChain: Promise<unknown> = Promise.resolve();

  /** 进链排队执行(泛型保留 job 返回值;失败不断链) */
  private enqueueSummaryWrite<T>(job: () => Promise<T>): Promise<T> {
    const run = this.summaryChain.then(job);
    this.summaryChain = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  /** 应用并持久化广播最新摘要(槽位化合并:只覆写 sum 自身产出的槽位,纪要槽位不动);返回链内合并后的完整对象 */
  private applySummary(sum: DiscussionSummary, trigger: 'auto' | 'manual' = 'auto'): Promise<DiscussionSummary> {
    return this.enqueueSummaryWrite(async () => {
      // 链内读最新:纪要槽位保留此刻已有的全部成员纪要
      const base = this.currentSummary;
      const merged: DiscussionSummary = base
        ? { ...base, ...sum, privateDigests: base.privateDigests }
        : sum;
      this.currentSummary = merged;
      const snap = await this.summaryStore.saveSummarySnapshot('room', this.config.id, merged, trigger);
      this.bus.emitRoomSummary(this.config.id, merged);

      if (sum.usage) {
        const traceLog: AgentTraceLog = {
          messageId: snap.id,
          roomId: this.config.id,
          memberId: 'system',
          memberName: t(this.lang, 'sys.speaker'),
          adapter: this.adminCfg.adapter || 'admin',
          ts: sum.updatedAt || Date.now(),
          durationMs: sum.durationMs ?? 0,
          status: sum.status === 'error' ? 'error' : 'ok',
          trigger: t(this.lang, 'trace.summaryDistill'),
          input: {
            prompt: t(this.lang, 'trace.summaryDistill'),
          },
          output: {
            result: sum.text,
            usage: sum.usage,
          },
        };
        void this.traceStore.saveTrace('room', this.config.id, traceLog);
      }
      return merged;
    });
  }

  /** 手动触发管理员刷新生成讨论摘要 */
  async refreshSummary(): Promise<DiscussionSummary | null> {
    const uncovered = countUncoveredPublic(this.messages, this.currentSummary);
    if (this.currentSummary?.text && uncovered === 0) {
      return this.currentSummary;
    }
    const res = await this.admin.generateSummary({
      messages: this.messages,
      topic: this.config.topic,
      prevSummary: this.currentSummary,
    });
    if (res && res.text) {
      return await this.applySummary(res, 'manual'); // 返回链内合并后的完整对象(含纪要)
    }
    return res;
  }


  get id() {
    return this.config.id;
  }

  get history(): readonly ChatMessage[] {
    return this.messages;
  }

  getState(): RoomState {
    return {
      config: this.config,
      statuses: { ...this.orch.statuses },
      orchestration: this.orch.state,
      currentSpeaker: this.orch.currentSpeaker,
    };
  }

  // ---------- 成员管理 ----------

  /** 添加成员;同名去重用"精确命中 + 最小空闲后缀"(修 v1 startsWith 前缀碰撞)。 */
  async addMembers(
    inputs: Array<Omit<MemberConfig, 'id' | 'color'> & { color?: string }>,
  ): Promise<MemberConfig[]> {
    const added: MemberConfig[] = [];
    for (const input of inputs) {
      const name = dedupeName(input.name, this.config.members.map((m) => m.name));
      const member: MemberConfig = {
        ...input,
        name,
        id: `m${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        color: input.color || MEMBER_PALETTE[this.config.members.length % MEMBER_PALETTE.length]!,
      };
      this.config.members.push(member);
      this.orch.memberAdded(member);
      added.push(member);
    }
    if (added.length > 0) {
      await this.sysMessage(
        t(this.lang, 'room.memberJoined', { names: added.map((m) => m.name).join('、'), count: this.config.members.length }),
      );
      await this.persistence.persistRoom(this.config);
      this.bus.emitRoomState(this.getState());
    }
    return added;
  }

  async removeMember(memberId: string): Promise<void> {
    const idx = this.config.members.findIndex((m) => m.id === memberId);
    if (idx < 0) throw new Error(t(this.lang, 'room.memberMissing', { id: memberId }));
    const [removed] = this.config.members.splice(idx, 1);
    this.orch.memberRemoved(memberId);
    await this.sysMessage(t(this.lang, 'room.memberLeft', { name: removed!.name }));
    await this.persistence.persistRoom(this.config);
    this.bus.emitRoomState(this.getState());
  }

  // ---------- 消息与用户入口 ----------

  private async pushMessage(msg: ChatMessage) {
    this.messages.push(msg);
    this.orch.noteMessageForCompact(msg); // stateful compact 计数唯一收口(用户/agent/心跳消息全覆盖)
    // 先落库后广播;落库失败不拦广播(实时体验优先——重启少一条历史 < 用户当场丢消息)
    await this.persistence
      .appendMessage(msg)
      .catch((e) => console.error(`[room] 消息落库失败 room=${msg.roomId}:`, e));
    this.bus.broadcastMessage(msg);
    void this.maybeAutoSummarize(msg);
  }

  /**
   * 自动上下文压缩触发器 (公聊自动摘要 + 私聊自总结)
   * 必须 fire-and-forget (void), 绝不阻塞消息正常落库与广播
   */
  private async maybeAutoSummarize(msg: ChatMessage): Promise<void> {
    if (msg.system || !msg.text.trim()) return;

    const isPrivate = Array.isArray(msg.audience) && msg.audience.length > 0;

    // 1. 公聊消息且开启了自动公聊摘要 (autoThreshold > 0)
    if (!isPrivate && this.summaryCfg.autoThreshold > 0) {
      const uncovered = countUncoveredPublic(this.messages, this.currentSummary);
      if (uncovered > this.summaryCfg.autoThreshold) {
        try {
          const res = await this.admin.generateSummary({
            messages: this.messages,
            topic: this.config.topic,
            prevSummary: this.currentSummary,
          });
          if (res && res.text) {
            await this.applySummary(res);
          }
        } catch (err) {
          console.error('[room] 自动生成公聊摘要失败:', err);
        }
      }
    }

    // 2. 私聊消息且房间处于 stateless 模式, 检查相关成员的未覆盖私聊
    const isStateless = (this.config.contextMode ?? 'stateless') !== 'stateful';
    if (isPrivate && isStateless && this.summaryCfg.privateThreshold > 0) {
      const candidates = Array.from(new Set([msg.from, ...(msg.audience ?? [])]));
      for (const mid of candidates) {
        const member = this.config.members.find((m) => m.id === mid);
        if (!member) continue;
        const currentDigest = this.currentSummary?.privateDigests?.[mid];
        const uncovered = countUncoveredPrivateFor(this.messages, mid, currentDigest);
        if (uncovered > this.summaryCfg.privateThreshold) {
          void this.generatePrivateDigestFor(member);
        }
      }
    }
  }

  /**
   * 为指定成员生成第一人称私聊纪要 (使用成员自身 adapter 与 persona)
   */
  private async generatePrivateDigestFor(member: MemberConfig): Promise<void> {
    if (this.privateDigestRunning.has(member.id)) return;
    const entry = this.adapterConfigs[member.adapter];
    if (!entry) return;

    this.privateDigestRunning.add(member.id);
    try {
      const adapter = getAdapterByKind(entry.kind);
      const prevDigest = this.currentSummary?.privateDigests?.[member.id];
      // 增量喂入:只给纪要锚点后的新私聊(防 prompt 线性膨胀);
      // 锚点失效(截断/清空)→ 丢弃旧纪要链(旧文含已删除信息,不得继承)
      const { anchorValid, delta } = uncoveredPrivateMessages(this.messages, member.id, prevDigest);
      if (delta.length === 0) return;

      const digest = await executePrivateDigest({
        member,
        privateMessages: delta,
        prevDigest: anchorValid ? prevDigest : null,
        adapter,
        command: entry.command,
        args: entry.args,
      });

      if (digest) {
        if (digest.usage) {
          const traceLog: AgentTraceLog = {
            messageId: `digest_${member.id}_${Date.now()}`,
            roomId: this.config.id,
            memberId: member.id,
            memberName: member.name,
            adapter: member.adapter,
            ts: digest.updatedAt || Date.now(),
            durationMs: digest.durationMs ?? 0,
            status: 'ok',
            trigger: t(this.lang, 'trace.privateDigest'),
            input: {
              prompt: t(this.lang, 'trace.privateDigest'),
            },
            output: {
              result: digest.text,
              usage: digest.usage,
            },
          };
          void this.traceStore.saveTrace('room', this.config.id, traceLog);
        }

        // 合并进链:只覆写该成员的纪要槽位,其余槽位(公聊摘要 text/他人纪要)保留最新
        await this.enqueueSummaryWrite(async () => {
          const base = this.currentSummary ?? {
            text: '',
            updatedAt: Date.now(),
            messageCount: 0,
          };
          const merged: DiscussionSummary = {
            ...base,
            privateDigests: {
              ...base.privateDigests,
              [member.id]: digest,
            },
          };
          this.currentSummary = merged;
          await this.summaryStore.saveSummarySnapshot('room', this.config.id, merged, 'auto');
          this.bus.emitRoomSummary(this.config.id, merged);
        });
      }
    } catch (err) {
      console.error(`[room] 成员 ${member.name} 生成私聊纪要失败:`, err);
    } finally {
      this.privateDigestRunning.delete(member.id);
    }
  }


  async sysMessage(text: string) {
    await this.pushMessage({
      id: randomUUID(),
      roomId: this.config.id,
      from: 'system',
      fromName: t(this.lang, 'sys.speaker'),
      text,
      ts: Date.now(),
      system: true,
    });
  }

  async systemNotice(text: string): Promise<void> {
    await this.sysMessage(text);
  }

  /** 用户发言:消息入库 + 编排器驱动。 */
  async userSpeak(text: string): Promise<void> {
    await this.pushMessage({
      id: randomUUID(),
      roomId: this.config.id,
      from: 'user',
      fromName: this.config.userPersona?.name || t(this.lang, 'sys.user'),
      text,
      ts: Date.now(),
    });
    await this.orch.onUserMessage(text);
  }

  directInstruction(memberId: string, text: string): Promise<void> {
    const member = this.config.members.find((m) => m.id === memberId);
    if (!member) return Promise.reject(new Error(t(this.lang, 'room.memberMissing', { id: memberId })));
    this.orch.directInstruction(memberId, text);
    return Promise.resolve();
  }

  async start(): Promise<void> {
    if (this.config.members.length === 0) {
      await this.sysMessage(t(this.lang, 'room.needMembersFirst'));
      return;
    }
    if (this.config.mode === 'subscribe') {
      await this.sysMessage(t(this.lang, 'room.startSubscribe'));
    } else {
      await this.sysMessage(t(this.lang, 'room.startBaton'));
    }
    this.orch.startDiscussion();
  }

  async stop(): Promise<void> {
    await this.orch.stop();
  }

  /** 截断指定消息之后的所有后续消息(点击编辑时截断) */
  async truncateAfter(messageId: string): Promise<void> {
    if (this.orch.state !== 'idle' || this.orch.currentSpeaker != null) {
      await this.stop();
    }
    this.messages = truncateMessages(this.messages, messageId, this.lang);
    await this.persistence.rewriteMessages(this.config.id, this.messages);
    this.bus.emitRoomMessages(this.config.id, this.messages);
  }

  /** 重roll:停止进行中任务,清除该条及后续消息,重新调度该 Agent 发言(发完进入 idle) */
  async reroll(messageId: string): Promise<void> {
    if (this.orch.state !== 'idle' || this.orch.currentSpeaker != null) {
      await this.stop();
    }
    const { remaining, targetSpeaker } = prepareReroll(this.messages, messageId, this.lang);
    this.messages = remaining;
    await this.persistence.rewriteMessages(this.config.id, this.messages);
    this.bus.emitRoomMessages(this.config.id, this.messages);
    this.orch.rerollAgent(targetSpeaker);
  }

  /** 保存编辑:更新该消息文本,若是 Agent 保持原身份且留于 idle;若是用户则驱动后续讨论 */
  async saveEdit(messageId: string, newText: string): Promise<void> {
    if (this.orch.state !== 'idle' || this.orch.currentSpeaker != null) {
      await this.stop();
    }
    const { remaining, isUser } = prepareEdit(this.messages, messageId, newText, this.lang);
    this.messages = remaining;
    await this.persistence.rewriteMessages(this.config.id, this.messages);
    this.bus.emitRoomMessages(this.config.id, this.messages);
    if (isUser) {
      await this.orch.onUserMessage(newText);
    }
  }

  /** 清空房间内全部聊天记录并重置所有成员的会话状态 */
  async clearMessages(): Promise<void> {
    if (this.orch.state !== 'idle' || this.orch.currentSpeaker != null) {
      await this.stop();
    }
    this.messages = [];
    await this.persistence.rewriteMessages(this.config.id, []);
    this.bus.emitRoomMessages(this.config.id, []);
    this.orch.clearPrivateProtocol(); // 历史都没了,私聊线程自然作废(硬闸计数一并归零)

    // 彻底清除所有成员绑定的底层 CLI 会话记忆 (sessionIds) 并写穿持久化
    for (const m of this.config.members) {
      m.sessionIds = undefined;
    }
    await this.persistence.persistRoom(this.config);
    this.bus.emitRoomState(this.getState());
  }


  // ---------- 运行期设置面板 ----------

  async updateSettings(patch: Partial<RoomSettings>): Promise<void> {
    if (patch.name != null && patch.name.trim()) this.config.name = patch.name.trim();
    if (patch.color !== undefined) this.config.color = patch.color;
    if (patch.topic != null && patch.topic.trim()) this.config.topic = patch.topic.trim();
    if (patch.speechLength != null) this.config.speechLength = patch.speechLength;
    if (patch.chainBudget != null) {
      this.config.chainBudget = patch.chainBudget;
      this.orch.setBudget(patch.chainBudget);
    }
    if (patch.subscribeConfig !== undefined) {
      this.config.subscribeConfig = {
        ...this.config.subscribeConfig,
        ...patch.subscribeConfig,
      };
    }
    if (patch.userPersona !== undefined) {
      assertSessionConfigMutable(this.messages.length, this.config.userPersona, patch.userPersona, this.lang);
      this.config.userPersona = patch.userPersona || undefined;
    }
    await this.persistence.persistRoom(this.config);
    this.bus.emitRoomState(this.getState());
  }
}

/** 同名去重:精确命中占用 → 找最小空闲后缀 N≥2(修 v1 startsWith 碰撞 bug)。 */
export function dedupeName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!existing.includes(candidate)) return candidate;
  }
}

export function makeRoomConfig(input: CreateRoomInput, lang: Lang = 'zh'): RoomConfig {
  const members: MemberConfig[] = input.members.map((m, i) => ({
    ...m,
    id: `m${i + 1}_${Math.random().toString(36).slice(2, 6)}`,
    color: m.color || MEMBER_PALETTE[i % MEMBER_PALETTE.length]!,
  }));
  return {
    id: `room_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: input.name || t(lang, 'room.defaultName'),
    color: input.color,
    topic: input.topic || t(lang, 'room.defaultTopic'),
    chainBudget: input.chainBudget ?? 6,
    speechLength: input.speechLength ?? 'normal',
    projectPath: input.projectPath || undefined,
    toolPermission: input.toolPermission ?? 'readonly',
    mode: input.mode ?? 'baton',
    subscribeConfig: input.subscribeConfig,
    contextMode: input.contextMode ?? 'stateless',
    userPersona: input.userPersona,
    members,
    createdAt: Date.now(),
  };
}
