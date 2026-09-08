// A 类消息词典契约测试:zh/en 同 key 集、zh 渲染与现状逐字节一致、en 渲染、兜底链。
import { describe, it, expect } from 'vitest';
import { MESSAGES, t } from '../src/core/i18n/messages';

describe('messages 词典契约', () => {
  it('zh/en 同 key 集(漏译即失败)', () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES.zh).sort());
  });
  it('t() zh 渲染与现状逐字节一致(样例)', () => {
    expect(t('zh', 'sys.stoppedThinking')).toBe('(已停止思考)');
    expect(t('zh', 'sys.noOutput')).toBe('(无输出)');
    expect(t('zh', 'sys.speaker')).toBe('系统');
    expect(t('zh', 'sys.user')).toBe('用户');
    expect(t('zh', 'room.memberLeft', { name: '甲' })).toBe('甲 离开了房间');
    expect(t('zh', 'room.memberJoined', { names: '甲、乙', count: 2 })).toBe('甲、乙 加入了房间,当前 2 位成员');
    expect(t('zh', 'orch.batonPass', { name: '甲', next: '乙' })).toBe('🎯 甲 把接棒交给 乙');
    expect(t('zh', 'orch.discussionEnd', { name: '甲' })).toBe('🏁 甲 宣布讨论结束。');
    expect(t('zh', 'orch.handBack', { name: '甲' })).toBe('🤝 甲 把话题交还给了你。');
    expect(t('zh', 'orch.autoBudgetReached')).toBe('讨论已达自动发言上限,发条新消息可继续。');
    expect(t('zh', 'sub.silentSkip', { name: '甲' })).toBe('甲 评估暂无发言与私聊意向，选择跳过。');
    expect(t('zh', 'ws.hello')).toBe('AI 聊天室已连接');
  });
  it('t() en 渲染', () => {
    expect(t('en', 'sys.stoppedThinking')).toBe('(stopped thinking)');
    expect(t('en', 'room.memberLeft', { name: 'A' })).toBe('A left the room');
    expect(t('en', 'orch.batonPass', { name: 'A', next: 'B' })).toBe('🎯 A passed the baton to B');
  });
  it('未知 key 回退 zh 再回退 key 本身', () => {
    expect(t('en', 'no.such.key')).toBe('no.such.key');
  });
});
