// Markdown 渲染工具: 基于 markdown-it，配置 XSS 安全转义与代码块复制交互。

import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,        // 禁用直接 HTML 输入，严格防 XSS
  breaks: true,       // 保持自然换行
  linkify: true,      // 自动识别 URL 为超链接
  typographer: false,
});

// 自定义代码块渲染: 注入头部语言标签与一键复制代码属性
md.renderer.rules.fence = function (tokens, idx) {
  const token = tokens[idx]!;
  const info = token.info ? token.info.trim() : '';
  const lang = info ? info.split(/\s+/)[0] : 'text';
  const rawCode = token.content;
  const escapedCode = md.utils.escapeHtml(rawCode);

  return `
<div class="code-block-wrap">
  <div class="code-block-header">
    <span class="code-lang">${lang}</span>
    <button class="copy-code-btn" type="button" data-copied="已复制">复制</button>
  </div>
  <pre class="code-pre"><code class="language-${lang}">${escapedCode}</code></pre>
</div>`.trim();
};

/**
 * 将文本中的 @提及 转换为高亮 span(规避 pre/code 内的提及)
 */
function highlightMentions(html: string): string {
  // 按 pre/code 切片，只高亮代码块外部的 @token
  const parts = html.split(/(<div class="code-block-wrap"[\s\S]*?<\/pre>\s*<\/div>|<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/g);
  return parts.map((part) => {
    if (part.startsWith('<div class="code-block-wrap"') || part.startsWith('<pre') || part.startsWith('<code')) {
      return part;
    }
    return part.replace(/@([^\s@,，。<>]+)/g, '<span class="mention">@$1</span>');
  }).join('');
}

/**
 * 渲染 Markdown 消息正文
 */
export function renderMarkdown(content: string): string {
  if (!content) return '';
  const rawHtml = md.render(content).trim();
  return highlightMentions(rawHtml);
}

