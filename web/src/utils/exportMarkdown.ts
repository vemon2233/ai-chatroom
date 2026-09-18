// Markdown 导出工具层 (纯前端零侵入，支持聊天记录与讨论摘要的结构化导出)
// i18n:文档标题/字段名随 UI 语言(t());协议剥除/意图解析正则引 @server/protocolKeywords 真源。

import type { ChatMessage, DiscussionSummary, DiscussionSummarySnapshot } from '@server/core/types';
import {
  BATON_LINE, BATON_END_WORDS, BATON_STRIP, DM_STRIP, HANDSHAKE_STRIP, USER_NAME_ALIASES,
  extractBatonTarget, stripBaton,
} from '@server/protocolKeywords';
import { downloadFile } from './download';
import { t } from '@/i18n';

/** 调度流水消息识别(历史系统消息文本,中英并集——落库已是烘焙后文本) */
const SCHEDULER_MSG_RE = /把接棒交给|指定.*接棒|宣布讨论结束|把话题交还给了你|passed the baton|declared the discussion closed|handed the topic back|designated .* to pass baton/i;

/** 清洗跨平台非法文件名字符 (Windows/macOS/Linux: \\ / : * ? " < > |) */
export function sanitizeFileName(name: string, fallback = ''): string {
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

/**
 * 剥除聊天正文中的控制标签 (与 MessageBubble 渲染端纪律严格一致:
 * 剥除接棒指令、私聊标签、握手标签,保证导出的正文纯粹)。
 */
export function stripControlTags(text: string): string {
  if (!text) return '';
  return stripBaton(text)
    .replace(DM_STRIP, '')
    .replace(HANDSHAKE_STRIP, '')
    .trimEnd();
}

/** 提取文本中的接棒意图 (用于在导出的消息头下展示引用徽章;中英并集真源) */
function resolveBatonBadge(msg: ChatMessage): { type: string; label: string } | null {
  if (msg.batonToUser) {
    return { type: 'to-user', label: t('export.batonToUser') };
  }
  if (msg.batonTarget) {
    return { type: 'baton', label: t('export.batonGive', { name: msg.batonTarget }) };
  }
  const raw = msg.text || '';
  const info = extractBatonTarget(raw);
  if (info) {
    if (info.type === 'end') {
      return { type: 'end', label: t('export.batonEnd') };
    }
    if (info.type === 'to-user') {
      return { type: 'to-user', label: t('export.batonToUser') };
    }
    if (info.type === 'baton' && info.target) {
      return { type: 'baton', label: t('export.batonGive', { name: info.target }) };
    }
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
  const safeTitle = sanitizeFileName(title, t(sessionType === 'room' ? 'export.roomFallbackTitle' : 'export.directFallbackTitle'));
  const sessionLabel = t(sessionType === 'room' ? 'export.sessionRoom' : 'export.sessionDirect');

  // 1. 过滤流式临时消息、空消息以及高频接棒调度流水 (保持有效条数统计与正文渲染绝对一致)
  const isSchedulerMessage = (m: any) => m.system && SCHEDULER_MSG_RE.test(m.text || '');

  const validMessages = messages.filter(
    (m: any) => !m.streaming && !!m.text?.trim() && !isSchedulerMessage(m),
  );

  // 2. 构造 Markdown 文档头部信息
  const lines: string[] = [];
  lines.push(t('export.docTitle', { title: safeTitle }));
  lines.push('');
  lines.push(`- **${t('export.sessionType')}**：${sessionLabel}`);
  if (members.length > 0) {
    lines.push(`- **${t('export.members')}**：${members.join('、')}`);
  }
  lines.push(`- **${t('export.exportTime')}**：${formatFullTime(now)}`);
  lines.push(`- **${t('export.recordCountLabel')}**：${t('export.recordCountValue', { n: validMessages.length })}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 3. 遍历格式化每条消息
  for (const msg of validMessages) {
    const timeStr = formatFullTime(msg.ts);
    const cleanBody = stripControlTags(msg.text);

    if (msg.system) {
      lines.push(`> 📢 **${t('export.sysNotice')}** · ${timeStr}`);
      lines.push(`> ${msg.text.trim()}`);
      lines.push('');
      continue;
    }

    const isMe = msg.from === 'user';
    const isScout = msg.from === 'scout';
    const sender = msg.fromName || (isMe ? t('export.userFallback') : t('export.unknownMember'));
    const prefix = isMe ? '👤' : isScout ? '🔍' : '🤖';

    lines.push(`### ${prefix} ${sender} · ${timeStr}`);
    lines.push('');

    // 私聊受众标注
    if (Array.isArray(msg.audience) && msg.audience.length > 0) {
      const audienceList = msg.audience.map((a) => `@${a}`).join(' ');
      const roundInfo = msg.privateRound ? t('export.roundInfo', { n: msg.privateRound }) : '';
      lines.push(`> 🔒 *${t('export.privateVisible', { list: audienceList })}${roundInfo}*`);
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
  const filename = `${t('export.fileChatPrefix')} ${safeTitle}_${formatFileTimestamp(now)}.md`;
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
  const safeTitle = sanitizeFileName(title, t(sessionType === 'room' ? 'export.roomSummaryFallback' : 'export.directSummaryFallback'));
  const snapshot = summary as Partial<DiscussionSummarySnapshot>;

  const lines: string[] = [];
  lines.push(t('export.summaryTitle', { title: safeTitle }));
  lines.push('');
  if (snapshot.id) {
    lines.push(`- **${t('export.snapshotId')}**：\`${snapshot.id}\``);
  }
  const summaryTime = snapshot.createdAt || summary.updatedAt || now;
  lines.push(`- **${t('export.genTime')}**：${formatFullTime(summaryTime)}`);
  if (snapshot.trigger) {
    lines.push(`- **${t('export.triggerLabel')}**：${t(snapshot.trigger === 'auto' ? 'export.triggerAuto' : 'export.triggerManual')}`);
  }
  if (typeof summary.messageCount === 'number') {
    lines.push(`- **${t('export.coverCountLabel')}**：${t('export.coverCountValue', { n: summary.messageCount })}`);
  }
  lines.push(`- **${t('export.exportTime')}**：${formatFullTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 一、公聊讨论大纲
  lines.push(t('export.outlineSection'));
  lines.push('');
  if (summary.text && summary.text.trim()) {
    lines.push(summary.text.trim());
  } else {
    lines.push(`*${t('export.noOutlineText')}*`);
  }
  lines.push('');

  // 二、成员专属私聊纪要 (若有)
  const digests = summary.privateDigests || {};
  const memberIds = Object.keys(digests);
  if (memberIds.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(t('export.digestSection', { n: memberIds.length }));
    lines.push('');
    for (const mId of memberIds) {
      const digestItem = digests[mId];
      if (!digestItem) continue;
      const mName = (memberNames && memberNames[mId]) || mId;
      const updateTime = digestItem.updatedAt ? ` · ${formatFullTime(digestItem.updatedAt)}` : '';
      lines.push(t('export.digestItem', { name: mName, time: updateTime }));
      lines.push('');
      if (digestItem.text && digestItem.text.trim()) {
        lines.push(digestItem.text.trim());
      } else {
        lines.push(`*${t('export.noDigestText')}*`);
      }
      lines.push('');
    }
  }

  const markdown = lines.join('\n');
  const snapIdPart = snapshot.id ? `_${snapshot.id}` : '';
  const filename = `${t('export.fileSummaryPrefix')} ${safeTitle}_${formatFileTimestamp(summaryTime)}${snapIdPart}.md`;
  return { markdown, filename };
}

/**
 * 导出讨论摘要与私聊纪要为 Markdown 文档并触发浏览器下载
 */
export function exportSummaryMarkdown(options: ExportSummaryOptions): void {
  const { markdown, filename } = buildSummaryMarkdown(options);
  downloadFile(markdown, filename, 'text/markdown;charset=utf-8');
}
