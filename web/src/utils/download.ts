// 前端文件下载通用辅助函数 (DRY 原语)

/**
 * 触发浏览器下载文件 (支持 Blob, JSON 文本 或 URL)
 */
export function downloadFile(content: Blob | string | object, filename: string, mimeType = 'application/json;charset=utf-8'): void {
  let url: string;
  let revokeNeeded = false;

  if (typeof content === 'string' && (content.startsWith('/') || content.startsWith('http://') || content.startsWith('https://'))) {
    url = content;
  } else if (content instanceof Blob) {
    url = URL.createObjectURL(content);
    revokeNeeded = true;
  } else {
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    const blob = new Blob([text], { type: mimeType });
    url = URL.createObjectURL(blob);
    revokeNeeded = true;
  }

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  if (revokeNeeded) {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
