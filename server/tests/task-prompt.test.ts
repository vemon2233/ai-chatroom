// 任务 prompt 契约测试(工单04 / ADR-0001):
// kind=task → 任务工作区段+行动契约,无目录树/接棒教学/长度约束/参与者列表;
// chat 房 → 与改造前逐字节一致(既有 prompt-i18n 断言即行为锁,此处只测任务分支)。
// 接缝:prompt 组装层(prompt-i18n.test.ts 同范式)。

import { describe, it, expect } from 'vitest';
import { buildPrompt, buildDeltaPrompt } from '../src/core/prompt';
import type { ChatMessage, MemberConfig, RoomConfig } from '../src/core/types';

const taskMember: MemberConfig = {
  id: 'm1', name: '工程师', adapter: 'claude', persona: '你是工程师', color: '#fff',
};
const otherMember: MemberConfig = {
  id: 'm2', name: '审查员', adapter: 'claude', persona: '你是审查员', color: '#eee',
};

function taskRoom(overrides: Partial<RoomConfig> = {}): RoomConfig {
  return {
    id: 'r1', name: '任务房', kind: 'task', topic: '修 bug', chainBudget: 6,
    speechLength: 'normal', toolPermission: 'full', contextMode: 'stateful',
    mode: 'baton', projectPath: 'D:\\proj\\demo',
    members: [taskMember], createdAt: 0, ...overrides,
  };
}

const history: ChatMessage[] = [
  { id: 'msg1', roomId: 'r1', from: 'user', fromName: '用户', text: '修复登录 bug', ts: 1 },
];

describe('buildPrompt 任务房段族', () => {
  it('zh:工作区段含项目路径/权限说明/范围约定,无目录树', async () => {
    const p = await buildPrompt(taskRoom(), taskMember, history, { lang: 'zh' });
    expect(p).toContain('# 任务工作区');
    expect(p).toContain('D:\\proj\\demo');
    expect(p).toContain('完全权限'); // full 档真实权限文案(ADR-0002)
    expect(p).toContain('仅限此项目目录');
    expect(p).not.toContain('目录结构概览'); // 无目录树(工单04)
    expect(p).not.toContain('```'); // 树的代码块不存在
  });

  it('zh:行动契约在,讨论指令/长度约束/接棒教学不在', async () => {
    const p = await buildPrompt(taskRoom(), taskMember, history, { batonMode: 'chain', lang: 'zh' });
    expect(p).toContain('# 任务行动契约');
    expect(p).toContain('遇阻先问');
    expect(p).not.toContain('直接以你的角色身份发言'); // 讨论式指令
    expect(p).not.toContain('字以内'); // 长度约束
    expect(p).not.toContain('接棒规则'); // 接棒教学
    expect(p).not.toContain('<接棒>@'); // 接棒语法示例
  });

  it('多成员任务房:无参与者列表/房主段/接棒段(协作走 @ 点名)', async () => {
    const room = taskRoom({ members: [taskMember, otherMember] });
    const p = await buildPrompt(room, taskMember, history, { batonMode: 'chain', lang: 'zh' });
    expect(p).not.toContain('其他参与者');
    expect(p).not.toContain('接棒规则');
  });

  it('persona 照常注入(角色头部)', async () => {
    const p = await buildPrompt(taskRoom(), taskMember, history, { lang: 'zh' });
    expect(p).toContain('# 你的角色');
    expect(p).toContain('你是工程师');
  });

  it('readonly 任务房权限文案如实', async () => {
    const p = await buildPrompt(taskRoom({ toolPermission: 'readonly' }), taskMember, history, { lang: 'zh' });
    expect(p).toContain('只能阅读和搜索');
    expect(p).toContain('已被禁用');
  });

  it('en:workspace/contract 双语齐', async () => {
    const p = await buildPrompt(taskRoom(), taskMember, history, { lang: 'en' });
    expect(p).toContain('# Task Workspace');
    expect(p).toContain('# Task Contract');
    expect(p).toContain('inside this project directory');
    expect(p).not.toContain('任务工作区'); // en 侧无 zh 残留
  });
});

describe('buildDeltaPrompt 任务房增量', () => {
  it('zh:增量指引为任务契约,无接棒教学/长度指令', () => {
    const delta: ChatMessage[] = [
      { id: 'm2', roomId: 'r1', from: 'user', fromName: '用户', text: '继续,跑下测试', ts: 2 },
    ];
    const p = buildDeltaPrompt(taskRoom(), taskMember, delta, { batonMode: 'chain', lang: 'zh' });
    expect(p).toContain('# 任务行动契约');
    expect(p).not.toContain('接棒规则');
    expect(p).not.toContain('字以内');
    expect(p).toContain('继续,跑下测试'); // 增量消息本体在
  });

  it('身份锚点保留(防长程人设漂移机制不因 kind 改变)', () => {
    const p = buildDeltaPrompt(taskRoom(), taskMember, [], { lang: 'zh' });
    expect(p).toContain('工程师');
  });
});

describe('chat 房不受任务分支影响', () => {
  it('chat 房(绑项目)照旧注入目录树+讨论教学', async () => {
    const chatRoom = taskRoom({ kind: undefined, contextMode: 'stateless', toolPermission: 'readonly', members: [taskMember, otherMember] });
    const p = await buildPrompt(chatRoom, taskMember, history, { lang: 'zh' });
    expect(p).toContain('讨论对象'); // 讨论框架段
    expect(p).toContain('其他参与者'); // 参与者列表照旧
    expect(p).toContain('直接以你的角色身份发言');
  });

  it('chat 房接棒模式照旧有接棒教学', async () => {
    const chatRoom = taskRoom({ kind: undefined, contextMode: 'stateless', toolPermission: 'readonly', members: [taskMember, otherMember] });
    const p = await buildPrompt(chatRoom, taskMember, history, { batonMode: 'chain', lang: 'zh' });
    expect(p).toContain('接棒规则');
  });
});
