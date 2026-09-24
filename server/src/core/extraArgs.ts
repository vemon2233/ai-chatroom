// extraArgs 白名单校验叶子(ADR-0002):角色/成员的 CLI 附加参数唯一收口。
// 背景:extraArgs 从角色卡导入/建房/拉角色等多入口进入,未经校验直拼 spawn 命令行——
// 恶意或失误的角色卡可夹带 --dangerously-bypass-approvals-and-sandbox 等参数,
// 绕过任何工具权限档位(注入面)。白名单只放行无害的模型参数:
//   --model <value>            模型档位(非空值)
//   --thinking-budget <number> 思考预算(正整数)
// 其余参数一律剥离。零依赖纯函数,所有入口(routes/characterCard)共用,
// 勿在任何入口内联重写(入口清单见 tests 白名单测试)。

/** 白名单校验结果 */
export interface ExtraArgsFilterResult {
  /** 过滤后的安全参数(全通过时与输入引用无关的新数组) */
  args: string[];
  /** 被剥离的参数(诊断/警告用,如 ["--dangerously-bypass"] ) */
  removed: string[];
}

/**
 * 过滤 extraArgs:只保留白名单参数。
 * 规则:
 *  - "--model <v>" / "--model=<v>":v 非空且不以 "-" 开头
 *  - "--thinking-budget <n>" / "--thinking-budget=<n>":n 为正整数
 *  - 其余 token(含未知 flag、位置参数、截断的孤 flag)一律剥离
 *  - 非字符串元素(String() 后再判)剥离
 */
export function filterExtraArgs(input: unknown): ExtraArgsFilterResult {
  if (!Array.isArray(input)) return { args: [], removed: [] };
  const args: string[] = [];
  const removed: string[] = [];
  let i = 0;
  while (i < input.length) {
    const raw = input[i];
    const tok = typeof raw === 'string' ? raw : String(raw);
    if (typeof raw !== 'string') {
      removed.push(`<non-string:${tok}>`);
      i += 1;
      continue;
    }
    if (tok === '--model') {
      const val = input[i + 1];
      if (typeof val === 'string' && val && !val.startsWith('-')) {
        args.push('--model', val);
        i += 2;
        continue;
      }
      removed.push(tok);
      i += 1;
      continue;
    }
    if (tok.startsWith('--model=')) {
      const val = tok.slice('--model='.length);
      if (val && !val.startsWith('-')) {
        args.push('--model', val);
      } else {
        removed.push('--model');
      }
      i += 1;
      continue;
    }
    if (tok === '--thinking-budget') {
      const val = input[i + 1];
      if (typeof val === 'string' && /^\d+$/.test(val) && parseInt(val, 10) > 0) {
        args.push('--thinking-budget', val);
        i += 2;
        continue;
      }
      removed.push(tok);
      i += 1;
      continue;
    }
    if (tok.startsWith('--thinking-budget=')) {
      const val = tok.slice('--thinking-budget='.length);
      if (/^\d+$/.test(val) && parseInt(val, 10) > 0) {
        args.push('--thinking-budget', val);
      } else {
        removed.push('--thinking-budget');
      }
      i += 1;
      continue;
    }
    // 未知 flag / 位置参数:剥离(flag 报名,其余 token 报字面)
    removed.push(tok.startsWith('-') ? tok : `<positional:${tok}>`);
    i += 1;
  }
  return { args, removed };
}
