import { describe, it, expect } from 'vitest';
import {
  sanitizeFileName,
  stripControlTags,
  formatFullTime,
  formatFileTimestamp,
  buildChatHistoryMarkdown,
  buildSummaryMarkdown,
} from '../../web/src/utils/exportMarkdown';
import type { ChatMessage, DiscussionSummarySnapshot } from '../src/core/types';

describe('Markdown 导出模块 (exportMarkdown)', () => {
  it('sanitizeFileName: 正确清洗跨平台非法字符', () => {
    expect(sanitizeFileName('讨论: 方案A/B*测试? "quotes" <tag> | pipe')).toBe('讨论_ 方案A_B_测试_ _quotes_ _tag_ _ pipe');
    expect(sanitizeFileName('', '默认房间')).toBe('默认房间');
    expect(sanitizeFileName('   正常房间名   ')).toBe('正常房间名');
  });

  it('stripControlTags: 彻底剥除各类控制标签', () => {
    const raw = '大家好，我的观点如下：\n- 第一点\n- 第二点\n<接棒>@诸葛亮';
    expect(stripControlTags(raw)).toBe('大家好，我的观点如下：\n- 第一点\n- 第二点');

    const rawPrivate = '我认为需要注意细节<私聊>@刘备';
    expect(stripControlTags(rawPrivate)).toBe('我认为需要注意细节');

    const rawHandshake = '我同意这个方案<同意>';
    expect(stripControlTags(rawHandshake)).toBe('我同意这个方案');
  });

  it('buildChatHistoryMarkdown: 过滤流式假消息与系统调度噪点，正确排版正文', () => {
    const fixedNow = new Date('2026-09-08T18:00:00Z').getTime();
    const messages: Array<ChatMessage | (ChatMessage & { streaming: boolean })> = [
      {
        id: 'm1',
        roomId: 'r1',
        from: 'user',
        fromName: '主公',
        text: '诸位以为如何？',
        ts: fixedNow - 60000,
      },
      {
        id: 'sys1',
        roomId: 'r1',
        from: 'system',
        fromName: '系统',
        text: '🎯 诸葛亮 把接棒交给 曹操', // 调度流水，应被过滤
        system: true,
        ts: fixedNow - 50000,
      },
      {
        id: 'sys2',
        roomId: 'r1',
        from: 'system',
        fromName: '系统',
        text: '轮流发言结束。可继续 @成员 追问。', // 关键通知，应保留
        system: true,
        ts: fixedNow - 40000,
      },
      {
        id: 'm2',
        roomId: 'r1',
        from: 'c1',
        fromName: '诸葛亮',
        text: '臣以为宜据汉中。<接棒>@曹操',
        batonTarget: '曹操',
        ts: fixedNow - 30000,
      },
      {
        id: 'm3_private',
        roomId: 'r1',
        from: 'c2',
        fromName: '曹操',
        text: '孔明所言差矣。<私聊>@刘备',
        audience: ['刘备'],
        privateRound: 1,
        ts: fixedNow - 20000,
      },
      {
        id: 'stream_temp',
        roomId: 'r1',
        from: 'c3',
        fromName: '关羽',
        text: '推理中…',
        streaming: true,
        ts: fixedNow,
      },
    ];

    const { markdown, filename } = buildChatHistoryMarkdown({
      title: '汉中之战/讨论',
      sessionType: 'room',
      members: ['主公', '诸葛亮', '曹操', '关羽'],
      messages: messages as ChatMessage[],
      now: fixedNow,
    });

    expect(filename).toContain('[聊天记录] 汉中之战_讨论_');
    // 包含标题与元数据
    expect(markdown).toContain('# 💬 对话纪要：汉中之战_讨论');
    expect(markdown).toContain('- **会话类型**：群聊房间');
    expect(markdown).toContain('- **参与成员**：主公、诸葛亮、曹操、关羽');
    // 记录总数应为 4 (过滤掉 1 个流式消息，但计入有效消息)
    expect(markdown).toContain('- **记录总数**：4 条');

    // 验证用户与 AI 格式
    expect(markdown).toContain('### 👤 主公 ·');
    expect(markdown).toContain('诸位以为如何？');

    // 验证调度流水已过滤，关键通知已保留
    expect(markdown).not.toContain('🎯 诸葛亮 把接棒交给 曹操');
    expect(markdown).toContain('> 📢 **系统通知**');
    expect(markdown).toContain('轮流发言结束。可继续 @成员 追问。');

    // 验证接棒与私聊徽章及控制尾行清理
    expect(markdown).toContain('### 🤖 诸葛亮 ·');
    expect(markdown).toContain('> *🎯 接棒给 @曹操*');
    expect(markdown).toContain('臣以为宜据汉中。');
    expect(markdown).not.toContain('<接棒>@曹操');

    // 验证私聊受众格式化
    expect(markdown).toContain('### 🤖 曹操 ·');
    expect(markdown).toContain('> 🔒 *仅 @刘备 可见 (第 1 轮)*');
    expect(markdown).toContain('孔明所言差矣。');
    expect(markdown).not.toContain('<私聊>@刘备');

    // 验证临时流式消息未被导出
    expect(markdown).not.toContain('stream_temp');
    expect(markdown).not.toContain('推理中…');
  });

  it('buildSummaryMarkdown: 正确输出大纲及各成员私聊纪要', () => {
    const fixedNow = new Date('2026-09-08T18:00:00Z').getTime();
    const summarySnapshot: DiscussionSummarySnapshot = {
      id: 'sum_178886_test',
      scope: 'room',
      targetId: 'r1',
      createdAt: fixedNow - 10000,
      trigger: 'manual',
      updatedAt: fixedNow - 10000,
      messageCount: 35,
      text: '1. 各方就汉中要地展开了激烈陈词。\n2. 孔明提议进军定军山。',
      privateDigests: {
        m_zhuge: {
          text: '与刘备沟通了军粮储备方案。',
          coveredMessageId: 'msg_99',
          updatedAt: fixedNow - 5000,
        },
      },
    };

    const { markdown, filename } = buildSummaryMarkdown({
      title: '三国研讨: 汉中策',
      sessionType: 'room',
      summary: summarySnapshot,
      memberNames: {
        m_zhuge: '诸葛亮',
      },
      now: fixedNow,
    });

    expect(filename).toContain('[讨论摘要] 三国研讨_ 汉中策_');
    expect(markdown).toContain('# 📋 讨论摘要：三国研讨_ 汉中策');
    expect(markdown).toContain('- **快照标识**：`sum_178886_test`');
    expect(markdown).toContain('- **触发方式**：手动即时生成');
    expect(markdown).toContain('- **覆盖对话量**：约 35 条');

    // 公聊大纲
    expect(markdown).toContain('## 一、公聊讨论大纲');
    expect(markdown).toContain('1. 各方就汉中要地展开了激烈陈词。');

    // 成员私聊纪要
    expect(markdown).toContain('## 二、成员专属私聊纪要 (1 位成员)');
    expect(markdown).toContain('### 📌 诸葛亮 的私聊备忘');
    expect(markdown).toContain('与刘备沟通了军粮储备方案。');
  });

  it('buildSummaryMarkdown: 多个历史快照分别导出时文件名与内容严格对应各自快照', () => {
    const exportTime = new Date('2026-09-08T18:30:00Z').getTime();
    const t1 = exportTime - 3600000; // 1 小时前的快照
    const t2 = exportTime - 600000;  // 10 分钟前的新快照

    const snapshot1: DiscussionSummarySnapshot = {
      id: 'sum_1001_aaa',
      scope: 'room',
      targetId: 'room_1',
      createdAt: t1,
      updatedAt: t1,
      messageCount: 10,
      text: '第一阶段：初步讨论确定目标',
    };

    const snapshot2: DiscussionSummarySnapshot = {
      id: 'sum_1002_bbb',
      scope: 'room',
      targetId: 'room_1',
      createdAt: t2,
      updatedAt: t2,
      messageCount: 25,
      text: '第二阶段：方案落地并达成共识',
    };

    const export1 = buildSummaryMarkdown({
      title: '产品研讨会',
      sessionType: 'room',
      summary: snapshot1,
      now: exportTime,
    });

    const export2 = buildSummaryMarkdown({
      title: '产品研讨会',
      sessionType: 'room',
      summary: snapshot2,
      now: exportTime,
    });

    // 1. 验证文件名严格携带各自快照的历史生成时间戳和快照 ID，而不是系统导出时刻
    expect(export1.filename).toBe(`[讨论摘要] 产品研讨会_${formatFileTimestamp(t1)}_sum_1001_aaa.md`);
    expect(export2.filename).toBe(`[讨论摘要] 产品研讨会_${formatFileTimestamp(t2)}_sum_1002_bbb.md`);
    expect(export1.filename).not.toBe(export2.filename);

    // 2. 验证导出的文档内容与各自快照严格对应
    expect(export1.markdown).toContain('- **快照标识**：`sum_1001_aaa`');
    expect(export1.markdown).toContain(`- **生成时间**：${formatFullTime(t1)}`);
    expect(export1.markdown).toContain('第一阶段：初步讨论确定目标');
    expect(export1.markdown).not.toContain('第二阶段：方案落地并达成共识');

    expect(export2.markdown).toContain('- **快照标识**：`sum_1002_bbb`');
    expect(export2.markdown).toContain(`- **生成时间**：${formatFullTime(t2)}`);
    expect(export2.markdown).toContain('第二阶段：方案落地并达成共识');
    expect(export2.markdown).not.toContain('第一阶段：初步讨论确定目标');
  });
});

