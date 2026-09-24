// 适配器权限档位翻译测试:领域枚举 ToolPermission → 各 CLI 的硬闸参数。
// 翻译是纯函数,直接断言;实际拦截效果见各适配器头注与 ADR-0002 的实测记录:
//   - claude: --allowedTools 是预批准而非限制(全局 bypassPermissions 下单独使用不拦写);
//     硬闸 = --disallowedTools(实测有效,不受全局 bypass 影响)——readonly/readwrite 均带
//   - qwen: --approval-mode 三档 v0.15.10 实测(plan 拦写/auto-edit 与 yolo 放写)
//   - gemini: 同形 flag,本机配额受限未 e2e 实测,按 CLI 文档语义
//   - codex: --sandbox OS 级沙箱(适配器本机零实测)

import { describe, it, expect } from 'vitest';
import { claudePermissionArgs } from '../src/adapters/claude';
import { codexPermissionArgs } from '../src/adapters/codex';
import { geminiPermissionArgs } from '../src/adapters/gemini';
import { qwenPermissionArgs } from '../src/adapters/qwen';

describe('适配器权限档位翻译', () => {
  it('claude readonly:预批准只读 + 硬闸全拒写/命令/网络/子代理', () => {
    expect(claudePermissionArgs('readonly')).toEqual([
      '--allowedTools', 'Read Glob Grep',
      '--disallowedTools', 'Write Edit NotebookEdit Bash Task Agent KillShell WebFetch WebSearch',
    ]);
  });

  it('claude readwrite:预批准读写 + 硬闸拒命令/网络/子代理', () => {
    expect(claudePermissionArgs('readwrite')).toEqual([
      '--allowedTools', 'Read Write Edit Glob Grep',
      '--disallowedTools', 'Bash Task Agent KillShell WebFetch WebSearch',
    ]);
  });

  it('claude full:不限制(无任何闸) ; undefined 缺省按 readonly', () => {
    expect(claudePermissionArgs('full')).toEqual([]);
    expect(claudePermissionArgs(undefined)).toEqual(claudePermissionArgs('readonly'));
  });

  it('qwen:三档 --approval-mode(plan 拦写实测)', () => {
    expect(qwenPermissionArgs('readonly')).toEqual(['--approval-mode', 'plan']);
    expect(qwenPermissionArgs(undefined)).toEqual(['--approval-mode', 'plan']);
    expect(qwenPermissionArgs('readwrite')).toEqual(['--approval-mode', 'auto-edit']);
    expect(qwenPermissionArgs('full')).toEqual(['--approval-mode', 'yolo']);
  });

  it('gemini:三档 --approval-mode(下划线形,CLI 文档语义)', () => {
    expect(geminiPermissionArgs('readonly')).toEqual(['--approval-mode', 'plan']);
    expect(geminiPermissionArgs(undefined)).toEqual(['--approval-mode', 'plan']);
    expect(geminiPermissionArgs('readwrite')).toEqual(['--approval-mode', 'auto_edit']);
    expect(geminiPermissionArgs('full')).toEqual(['--approval-mode', 'yolo']);
  });

  it('codex:三档 --sandbox / bypass(本机零实测)', () => {
    expect(codexPermissionArgs('readonly')).toEqual(['--sandbox', 'read-only']);
    expect(codexPermissionArgs(undefined)).toEqual(['--sandbox', 'read-only']);
    expect(codexPermissionArgs('readwrite')).toEqual(['--sandbox', 'workspace-write']);
    expect(codexPermissionArgs('full')).toEqual(['--dangerously-bypass-approvals-and-sandbox']);
  });
});
