// Markdown 导出工具层 (纯前端零侵入，支持聊天记录与讨论摘要的结构化导出)

import type { ChatMessage, DiscussionSummary, DiscussionSummarySnapshot } from '@server/core/types';
import { downloadFile } from './download';

/** 清洗跨平台非法文件名字符 (Windows/macOS/Linux: \\ / : * ? " < > |) */
export function sanitizeFileName(name: string, fallback = '导出文档'): string {
  const cleaned = (name || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

/** 格式化日期时间为 YYYY-MM-DD HH:mm:ss */
export function formatFullTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const minute = pad(d.getMinutes());
  const second = pad(d.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/** 格式化紧凑时间戳用于文件名 YYYYMMDD_HHmmss */
export function formatFileTimestamp(ts = Date.now()): string {
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const minute = pad(d.getMinutes());
  const second = pad(d.getSeconds());
  return `${year}${month}${day}_${hour}${minute}${second}`;
}

/** 彻底剥除所有的控制指令标签 (保证 Markdown 阅读排版的纯粹自然) */
export function stripControlTags(text: string): string {
  if (!text) return '';
  return text
    .replace(/(?:<接棒>|【接棒】)[^\n]*/g, '')
    .replace(/<私聊>[^\n]*/g, '')
    .replace(/<同意>[^\n]*/g, '')
    .replace(/<拒绝>[^\n]*/g, '')
    .replace(/<想法>[^\n]*/g, '')
    .trimEnd();
}

/** 提取文本中的接棒意图 (用于在导出的消息头下展示引用徽章) */
function resolveBatonBadge(msg: ChatMessage): { type: string; label: string } | null {
  if (msg.batonToUser) {
    return { type: 'to-user', label: '🤝 话题交还给用户' };
  }
  if (msg.batonTarget) {
    return { type: 'baton', label: `🎯 接棒给 @${msg.batonTarget}` };
  }
  const raw = msg.text || '';
  const m = raw.match(/(?:<接棒>|【接棒】)\s*(.+)/);
  if (m) {
    const target = m[1]!.replace(/^@/, '').trim();
    if (/结束|收敛|无需|到此/.test(target)) {
      return { type: 'end', label: '🏁 宣布讨论结束' };
    }
    if (['用户', 'user'].includes(target.toLowerCase())) {
      return { type: 'to-user', label: '🤝 话题交还给用户' };
    }
    return { type: 'baton', label: `🎯 接棒给 @${target}` };
  }
  return null;
}

export interface ExportChatHistoryOptions {
  title: string;
  sessionType: 'room' | 'direct';
  members?: string[];
  messages: ChatMessage[];
  now?: number;
}

/**
 * 纯函数：构造结构清晰的聊天记录 Markdown 文本
 */
export function buildChatHistoryMarkdown(options: ExportChatHistoryOptions): { markdown: string; filename: string } {
  const { title, sessionType, members = [], messages, now = Date.now() } = options;
  const safeTitle = sanitizeFileName(title, sessionType === 'room' ? '房间聊天记录' : '专属私聊记录');
  const sessionLabel = sessionType === 'room' ? '群聊房间' : '1v1 专属私聊';

  // 1. 过滤流式临时消息、空消息以及高频接棒调度流水 (保持有效条数统计与正文渲染绝对一致)
  const isSchedulerMessage = (m: any) =>
    m.system && /把接棒交给|指定.*接棒|宣布讨论结束|把话题交还给了你/.test(m.text || '');

  const validMessages = messages.filter(
    (m: any) => !m.streaming && !!m.text?.trim() && !isSchedulerMessage(m),
  );

  // 2. 构造 Markdown 文档头部信息
  const lines: string[] = [];
  lines.push(`# 💬 对话纪要：${safeTitle}`);
  lines.push('');
  lines.push(`- **会话类型**：${sessionLabel}`);
  if (members.length > 0) {
    lines.push(`- **参与成员**：${members.join('、')}`);
  }
  lines.push(`- **导出时间**：${formatFullTime(now)}`);
  lines.push(`- **记录总数**：${validMessages.length} 条`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 3. 遍历格式化每条消息
  for (const msg of validMessages) {
    const timeStr = formatFullTime(msg.ts);
    const cleanBody = stripControlTags(msg.text);

    if (msg.system) {
      lines.push(`> 📢 **系统通知** · ${timeStr}`);
      lines.push(`> ${msg.text.trim()}`);
      lines.push('');
      continue;
    }

    const isMe = msg.from === 'user';
    const isScout = msg.from === 'scout';
    const sender = msg.fromName || (isMe ? '用户' : '未知成员');
    const prefix = isMe ? '👤' : isScout ? '🔍' : '🤖';

    lines.push(`### ${prefix} ${sender} · ${timeStr}`);
    lines.push('');

    // 私聊受众标注
    if (Array.isArray(msg.audience) && msg.audience.length > 0) {
      const audienceList = msg.audience.map((a) => `@${a}`).join(' ');
      const roundInfo = msg.privateRound ? ` (第 ${msg.privateRound} 轮)` : '';
      lines.push(`> 🔒 *仅 ${audienceList} 可见${roundInfo}*`);
    }

    // 接棒走向标注
    const baton = resolveBatonBadge(msg);
    if (baton) {
      lines.push(`> *${baton.label}*`);
    }

    if (lines[lines.length - 1]?.startsWith('>')) {
      lines.push('');
    }

    // 消息正文
    lines.push(cleanBody);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  const markdown = lines.join('\n');
  const filename = `[聊天记录] ${safeTitle}_${formatFileTimestamp(now)}.md`;
  return { markdown, filename };
}

/**
 * 导出完整聊天记录为结构清晰的 Markdown 文档并触发浏览器下载
 */
export function exportChatHistoryMarkdown(options: ExportChatHistoryOptions): void {
  const { markdown, filename } = buildChatHistoryMarkdown(options);
  downloadFile(markdown, filename, 'text/markdown;charset=utf-8');
}

export interface ExportSummaryOptions {
  title: string;
  sessionType: 'room' | 'direct';
  summary: DiscussionSummary | DiscussionSummarySnapshot;
  memberNames?: Record<string, string>;
  now?: number;
}

/**
 * 纯函数：构造结构清晰的讨论摘要 Markdown 文本
 */
export function buildSummaryMarkdown(options: ExportSummaryOptions): { markdown: string; filename: string } {
  const { title, sessionType, summary, memberNames, now = Date.now() } = options;
  const safeTitle = sanitizeFileName(title, sessionType === 'room' ? '房间讨论摘要' : '私聊讨论摘要');
  const snapshot = summary as Partial<DiscussionSummarySnapshot>;

  const lines: string[] = [];
  lines.push(`# 📋 讨论摘要：${safeTitle}`);
  lines.push('');
  if (snapshot.id) {
    lines.push(`- **快照标识**：\`${snapshot.id}\``);
  }
  const summaryTime = snapshot.createdAt || summary.updatedAt || now;
  lines.push(`- **生成时间**：${formatFullTime(summaryTime)}`);
  if (snapshot.trigger) {
    lines.push(`- **触发方式**：${snapshot.trigger === 'auto' ? '自动滚动提炼' : '手动即时生成'}`);
  }
  if (typeof summary.messageCount === 'number') {
    lines.push(`- **覆盖对话量**：约 ${summary.messageCount} 条`);
  }
  lines.push(`- **导出时间**：${formatFullTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 一、公聊讨论大纲
  lines.push('## 一、公聊讨论大纲');
  lines.push('');
  if (summary.text && summary.text.trim()) {
    lines.push(summary.text.trim());
  } else {
    lines.push('*（暂无公聊讨论大纲文本）*');
  }
  lines.push('');

  // 二、成员专属私聊纪要 (若有)
  const digests = summary.privateDigests || {};
  const memberIds = Object.keys(digests);
  if (memberIds.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`## 二、成员专属私聊纪要 (${memberIds.length} 位成员)`);
    lines.push('');
    for (const mId of memberIds) {
      const digestItem = digests[mId];
      if (!digestItem) continue;
      const mName = (memberNames && memberNames[mId]) || mId;
      const updateTime = digestItem.updatedAt ? ` · ${formatFullTime(digestItem.updatedAt)}` : '';
      lines.push(`### 📌 ${mName} 的私聊备忘${updateTime}`);
      lines.push('');
      if (digestItem.text && digestItem.text.trim()) {
        lines.push(digestItem.text.trim());
      } else {
        lines.push('*（暂无纪要条目）*');
      }
      lines.push('');
    }
  }

  const markdown = lines.join('\n');
  const snapIdPart = snapshot.id ? `_${snapshot.id}` : '';
  const filename = `[讨论摘要] ${safeTitle}_${formatFileTimestamp(summaryTime)}${snapIdPart}.md`;
  return { markdown, filename };
}

/**
 * 导出讨论摘要与私聊纪要为 Markdown 文档并触发浏览器下载
 */
export function exportSummaryMarkdown(options: ExportSummaryOptions): void {
  const { markdown, filename } = buildSummaryMarkdown(options);
  downloadFile(markdown, filename, 'text/markdown;charset=utf-8');
}

