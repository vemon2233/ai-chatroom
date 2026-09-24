// 工具参数呈现共享叶子:JSON 输入转一行可读(Bash 取 command、Read 取 file_path…)。
// store(实时流)与 traceToActivity(落库回放)共用,单一真源。

/** 工具参数呈现:JSON 输入转一行可读(全量不截断——与原始流一致) */
export function summarizeToolInput(input: string): string {
  try {
    const obj = JSON.parse(input);
    const pick = obj.command ?? obj.file_path ?? obj.pattern ?? obj.path ?? obj.url ?? obj.skill ?? obj.prompt;
    if (typeof pick === 'string') return pick;
    return JSON.stringify(obj);
  } catch {
    return input;
  }
}
