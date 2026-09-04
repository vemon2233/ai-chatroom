import type { StreamBuf } from '@/store';

/**
 * 流式占位文本:真实状态三阶——启动中(无输出) / 推理中(有 thinking 无正文) / 正文流出
 */
export function streamPlaceholder(buf: StreamBuf): string {
  if (buf.text) return buf.text;
  if (buf.thinking) return '推理中…';
  return '启动中…';
}
