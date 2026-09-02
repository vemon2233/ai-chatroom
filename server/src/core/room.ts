// ChatRoom v2:薄门面(≤200 行,v1 是 905 行 God class)。
// 职责:持有 config/messages、成员管理、对编排器的依赖装配、持久化触发。
// 一切"谁在何时说"的决策在 orchestrator;"怎么调 CLI"在 adapters。

import { randomUUID } from 'node:crypto';
import type { MessageBus } from './bus';
import { Orchestrator } from './orchestrator';
import { Scout, type ScoutConfig } from './scout';
import { MEMBER_PALETTE } from './palette';
import type { ChatMessage, MemberConfig, RoomConfig, RoomSettings, RoomState } from './types';
import { getAdapter as getAdapterByKind } from '../adapters/index';

/** ChatRoom 的持久化接缝(构造注入,core 层不 import store——依赖保持单向:server→core→adapters)。 */
export interface RoomPersistence {
  /** rooms.json 写穿(config 全量替换该 entry) */
  persistRoom(cfg: RoomConfig): Promise<void>;
  /** JSONL 历史加载(重启复活) */
  loadMessages(roomId: string): Promise<ChatMessage[]>;
}

export interface CreateRoomInput {
  name: string;
  topic: string;
  projectPath?: string;
  toolPermission?: RoomConfig['toolPermission'];
  speechLength?: RoomConfig['speechLength'];
  chainBudget?: number;
  moderatorId?: string;
  members: Array<Omit<MemberConfig, 'id' | 'color'>>;
}

export class ChatRoom {
  readonly config: RoomConfig;
  private messages: ChatMessage[] = [];
  private orch: Orchestrator;
  private scout: Scout;

  constructor(
    cfg: RoomConfig,
    private bus: MessageBus,
    adapterConfigs: Record<string, { kind: string; command: string; args: string[] }>,
    scoutCfg: ScoutConfig,
    private persistence: RoomPersistence,
  ) {
    this.config = cfg;
    const scoutAdapterEntry = adapterConfigs[scoutCfg.adapter];
    if (!scoutAdapterEntry) {
      throw new Error(`侦察适配器未配置: ${scoutCfg.adapter}(检查 config/agents.yaml 的 scout.adapter 与 adapters 是否一致)`);
    }
    this.scout = new Scout(
      scoutCfg,
      (key) => {
        const entry = adapterConfigs[key];
        if (!entry) throw new Error(`侦察适配器未配置: ${key}`);
        return getAdapterByKind(entry.kind);
      },
      { command: scoutAdapterEntry.command, args: scoutAdapterEntry.args },
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
        const report = await this.scout.ensure(this.config.projectPath);
        if (report) {
          await this.pushMessage({ ...report, roomId: this.config.id });
        }
        return report;
      },
      getHistory: () => this.messages,
      pushAgentEvent: (ev) => this.bus.emitAgentEvent(this.config.id, ev),
    });
  }

  /** 从持久化恢复历史(服务重启后,listen 前 await)。 */
  async restore(): Promise<void> {
    this.messages = await this.persistence.loadMessages(this.config.id);
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
    inputs: Array<Omit<MemberConfig, 'id' | 'color'>>,
  ): Promise<MemberConfig[]> {
    const added: MemberConfig[] = [];
    for (const input of inputs) {
      const name = dedupeName(input.name, this.config.members.map((m) => m.name));
      const member: MemberConfig = {
        ...input,
        name,
        id: `m${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        color: MEMBER_PALETTE[this.config.members.length % MEMBER_PALETTE.length]!,
      };
      this.config.members.push(member);
      this.orch.memberAdded(member);
      added.push(member);
    }
    if (added.length > 0) {
      await this.sysMessage(
        `${added.map((m) => m.name).join('、')} 加入了房间,当前 ${this.config.members.length} 位成员`,
      );
      await this.persistence.persistRoom(this.config);
      this.bus.emitRoomState(this.getState());
    }
    return added;
  }

  async removeMember(memberId: string): Promise<void> {
    const idx = this.config.members.findIndex((m) => m.id === memberId);
    if (idx < 0) throw new Error(`成员不存在: ${memberId}`);
    const [removed] = this.config.members.splice(idx, 1);
    if (this.config.moderatorId === memberId) this.config.moderatorId = undefined;
    this.orch.memberRemoved(memberId);
    await this.sysMessage(`${removed!.name} 离开了房间`);
    await this.persistence.persistRoom(this.config);
    this.bus.emitRoomState(this.getState());
  }

  // ---------- 消息与用户入口 ----------

  private async pushMessage(msg: ChatMessage) {
    this.messages.push(msg);
    await this.bus.emitMessage(msg);
  }

  async sysMessage(text: string) {
    await this.pushMessage({
      id: randomUUID(),
      roomId: this.config.id,
      from: 'system',
      fromName: '系统',
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
      fromName: '用户',
      text,
      ts: Date.now(),
    });
    await this.orch.onUserMessage(text);
  }

  directInstruction(memberId: string, text: string): Promise<void> {
    const member = this.config.members.find((m) => m.id === memberId);
    if (!member) return Promise.reject(new Error(`成员不存在: ${memberId}`));
    this.orch.directInstruction(memberId, text);
    return Promise.resolve();
  }

  async start(): Promise<void> {
    if (this.config.members.length === 0) {
      await this.sysMessage('房间里还没有成员,请先添加成员再开始。');
      return;
    }
    await this.sysMessage('自由讨论开始(接棒模式):发言者自己决定下一位。');
    this.orch.startFreeDiscussion(); // 显式入口(v1 用 '@free' 文本触发,v2 parseUserCommand 已无该指令,曾是化石 bug)
  }

  async stop(): Promise<void> {
    await this.orch.stop();
  }

  // ---------- 运行期设置面板 ----------

  async updateSettings(patch: Partial<RoomSettings>): Promise<void> {
    if (patch.speechLength != null) this.config.speechLength = patch.speechLength;
    if (patch.chainBudget != null) {
      this.config.chainBudget = patch.chainBudget;
      this.orch.setBudget(patch.chainBudget);
    }
    if (patch.moderatorId !== undefined) {
      if (patch.moderatorId === '' || patch.moderatorId == null) {
        this.config.moderatorId = undefined;
      } else if (this.config.members.some((m) => m.id === patch.moderatorId)) {
        this.config.moderatorId = patch.moderatorId;
      }
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

export function makeRoomConfig(input: CreateRoomInput): RoomConfig {
  const members: MemberConfig[] = input.members.map((m, i) => ({
    ...m,
    id: `m${i + 1}_${Math.random().toString(36).slice(2, 6)}`,
    color: MEMBER_PALETTE[i % MEMBER_PALETTE.length]!,
  }));
  return {
    id: `room_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: input.name || '新房间',
    topic: input.topic || '自由聊天',
    chainBudget: input.chainBudget ?? 6,
    speechLength: input.speechLength ?? 'normal',
    moderatorId: input.moderatorId ? members.find((m) => m.id === input.moderatorId)?.id : undefined,
    projectPath: input.projectPath || undefined,
    toolPermission: input.toolPermission ?? 'readonly',
    members,
    createdAt: Date.now(),
  };
}
