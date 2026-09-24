// 进程 spawn 公共工具:适配器共用。
// 继承 v1 全部 Windows 生存法则(实测教训,见各注释),新增:
// - harness 统一计时 durationMs(修 v1 durationMs 恒 0.0s bug)
// - cancelled 三态(cancel 后不再伪装成 done/error,编排器可区分)

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { AgentEvent, SpeakOutcome, SpeakRequest } from './base';

/** 发言进程的工作目录:系统临时目录。
 *  不能用项目目录——否则 spawn 出的 claude 实例会加载本项目配置/状态,
 *  和用户正在运行的交互式 Claude Code 会话产生上下文与文件冲突。 */
const SPEAK_CWD = path.join(tmpdir(), 'ai-chatroom-speak');
let speakCwdReady = false;
function ensureSpeakCwd(): string {
  if (!speakCwdReady) {
    mkdirSync(SPEAK_CWD, { recursive: true }); // spawn 到不存在的 cwd 会 ENOENT,必须先建
    speakCwdReady = true;
  }
  return SPEAK_CWD;
}

/**
 * spawn 一次 CLI 发言。
 *
 * 关键设计:prompt 一律走 stdin 管道,不进命令行参数。
 *  - 避免 Windows shell:true 下多行 prompt 被换行符截断(v1 实测根因);
 *  - 避免超长 prompt 撞 Windows 32k 命令行上限。
 *
 * cwd 语义:req.cwd 优先(绑定项目的房间 → 项目根,agent 工具在其中执行);
 * 缺省用隔离临时目录,防止 spawn 的 CLI 加载用户项目状态(避免与用户交互会话冲突)。
 */
export function spawnCli(req: SpeakRequest, resumeArgs?: string[]) {
  const args = [...(resumeArgs ?? []), ...req.args];
  const child = spawn(req.command, args, {
    shell: process.platform === 'win32',
    env: { ...process.env, ...req.env },
    windowsHide: true,
    cwd: req.cwd || ensureSpeakCwd(),
  });

  // prompt 写入 stdin 后立即关闭,CLI 从管道读取。
  // EPIPE 必须吞掉:CLI 秒退(命令错/二进制缺失)时大 prompt 的异步 flush 落在已关管道上,
  // 无监听器的流 error = uncaughtException = 整个 server 崩溃;
  // 真正的失败信号由 close(code) → finish(false) 权威判定,EPIPE 只是冗余回声
  child.stdin?.on('error', () => {});
  if (req.prompt && req.prompt.length > 0) {
    child.stdin?.write(req.prompt);
  }
  child.stdin?.end();
  return child;
}

/** 逐行分割 stdout/stderr(处理跨 chunk 截断)。 */
export function createLineSplitter(onLine: (line: string) => void) {
  let buf = '';
  return (chunk: Buffer | string) => {
    buf += chunk.toString('utf8');
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) onLine(line);
    }
  };
}

/** 尝试把一行解析为 JSON;失败返回 null。 */
export function tryParseJson(line: string): any | null {
  if (!line.startsWith('{') && !line.startsWith('[')) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Windows 下安全终止 spawn 的进程树。
 * shell:true 时 child.kill() 只杀 cmd.exe 外壳,CLI 真身会残留成孤儿
 * (v1 实测出现过多个 claude 孤儿进程)。taskkill /T 杀整棵树。
 */
export function killTree(child: { pid?: number; kill?: (sig?: NodeJS.Signals) => void }) {
  if (child.pid == null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill?.('SIGKILL');
    }
  }
}

/**
 * CLI 进程 harness(v1 P1 提炼的六件套,v2 增强):
 * 适配器只需提供 onLine(逐行解析该 CLI 的事件 schema——适配器间唯一真差异)
 * 与可选 onStdoutEnd(整段 JSON 型 CLI 的兜底解析)。
 *
 * v2 新增职责:
 *  - durationMs 由本层统一计时(适配器不再自报,杜绝 v1 硬编码 0 的遮蔽 bug)
 *  - cancelled 状态:主动 cancel() 后进程退出 → outcome.status='cancelled',
 *    编排器据此跳过落库与接棒解析(修 v1 stop 后垃圾消息入库 bug)
 */
export interface CliHarness {
  /** 主动结束(成功/失败);幂等 */
  finish: (ok: boolean, errMsg?: string) => void;
  /** 仅标记已结束(事件流里已发过 done/error 时用),随后杀进程 */
  settle: () => void;
  /** 强制终止进程树(标记后续 outcome 为 cancelled) */
  cancel: () => void;
  /** 进程退出后 resolve(outcome 三态) */
  done: Promise<SpeakOutcome>;
}

export function runCliHarness(
  req: SpeakRequest,
  resumeArgs: string[],
  hooks: {
    onLine: (line: string) => void;
    onStdoutEnd?: () => void;
  },
  onEvent: (ev: AgentEvent) => void,
): CliHarness {
  const child = spawnCli(req, resumeArgs);
  const started = Date.now();
  let settled = false;
  let errorText: string | undefined;
  // stderr 尾部环形缓冲:失败时拼进错误消息(如 cmd 的"'xxx' 不是内部或外部命令"),
  // 成功时丢弃——把"进程退出(code=1)"变成可直接读出原因的诊断信息
  const stderrTail: string[] = [];
  const STDERR_TAIL_MAX = 5;
  // 外部主动终止(编排器 stop/点名打断):此时尚未 settled → cancelled;
  // 适配器拿到 result 后自行杀进程(settle 已置位)属正常完成,不算 cancelled。
  let externallyCancelled = false;
  // 超时终止(工单05/ADR-0002):与用户主动 stop 同走 cancelled 轨道,
  // 但标记 timedOut 供编排器区分占位文案;不清 session、不触发重试
  let timedOut = false;
  // done 的 resolve 句柄:close 事件与 cancel 兜底定时器谁先到谁结案(Promise resolve 幂等)
  let resolveDone: ((o: SpeakOutcome) => void) | null = null;

  const finish = (ok: boolean, errMsg?: string) => {
    if (settled) return;
    settled = true;
    if (!ok) {
      onEvent({ member: req.member, phase: 'error', error: errMsg ?? '未知错误' });
      errorText = errMsg;
    }
  };
  const settle = () => {
    settled = true;
  };

  child.stdout?.on('data', createLineSplitter((line) => {
    hooks.onLine(line);
  }));
  child.stderr?.on('data', createLineSplitter((line) => {
    // stderr 仅诊断用:留尾部几行,失败时随错误消息透出
    stderrTail.push(line);
    if (stderrTail.length > STDERR_TAIL_MAX) stderrTail.shift();
  }));
  child.on('error', (err) => finish(false, `进程启动失败: ${err.message}`));
  child.on('close', (code) => {
    hooks.onStdoutEnd?.();
    if (!settled) {
      const base = code === 0 ? undefined : `进程退出(code=${code})`;
      // code≠0 且 stderr 有内容 → 拼尾部(截断防超长错误消息)
      if (base && stderrTail.length > 0) {
        const tail = stderrTail.join(' | ').slice(0, 500);
        finish(false, `${base}: ${tail}`);
      } else {
        finish(code === 0, base);
      }
    }
  });

  const harness: CliHarness = {
    finish,
    settle,
    cancel: () => {
      if (!settled) externallyCancelled = true; // settled 后的 cancel = 适配器收尾杀进程
      killTree(child);
      // Windows 实测:shell:true 下 taskkill /T 杀掉 claude.exe 后,cmd 壳的 close 事件
      // 可能永不到达(管道悬挂)→ done 永不 resolve → 编排器卡死(用户须按两次停止的直接根因)。
      // 兜底:cancel 后 2s 仍无 close 则主动以 cancelled 结案。resolve 幂等,先到先得。
      const timer = setTimeout(() => {
        resolveDone?.({ status: 'cancelled', result: '', durationMs: Date.now() - started, timedOut });
      }, 2000);
      timer.unref?.(); // 不阻止进程退出
    },
    done: new Promise<SpeakOutcome>((resolve) => {
      resolveDone = resolve; // 闭包内,每 harness 一份
      child.on('close', () => {
        resolve({
          status: externallyCancelled ? 'cancelled'
            : errorText != null ? 'error'
              : 'ok',
          result: errorText ?? '',
          durationMs: Date.now() - started,
          error: errorText,
          timedOut,
        });
      });
    }),
  };

  // 超时计时(工单05):req.timeoutMs > 0 时挂载;到点走 cancel 路径(cancelled 轨道)
  // 并置 timedOut 标记——不清 sessionIds、编排器不重试(ADR-0002 实现约束:
  // 严禁 error 轨道,其自愈会清 session + 自动重跑,与超时语义相反)
  if (req.timeoutMs && req.timeoutMs > 0) {
    const t = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        externallyCancelled = true; // 超时本质是系统主动终止 → cancelled 三态
        harness.cancel();
      }
    }, req.timeoutMs);
    t.unref?.();
    // 进程正常结束后清计时器(防泄漏;unref 已保退出,双保险)
    child.on('close', () => clearTimeout(t));
  }
  return harness;
}
