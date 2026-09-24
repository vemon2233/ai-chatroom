// skills 目录扫描(server 端点用):~/.claude/skills + 项目 .claude/skills 的 skill 名单。
// 工单08:斜杠命令候选层的动态数据源——前端不可达文件系统,扫描必须在 server。
// 零依赖叶子:readdir + 目录存在性,不读 SKILL.md 内容(名字即候选)。

import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

export interface SkillSource {
  /** skill 目录名(= 命令名,如 /grilling) */
  name: string;
  /** 来源:user | project */
  from: 'user' | 'project';
}

/** 扫描单个 skills 目录下的 skill 目录名(无 skills/ 或不存在 → 空表)。 */
function scanDir(dir: string, from: SkillSource['from']): SkillSource[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, from }));
  } catch {
    return [];
  }
}

/**
 * 汇总当前可用的 skill 命令:用户级(~/.claude/skills) + 项目级(<projectPath>/.claude/skills)。
 * 同名时 user 在前(顺序即候选序);无 projectPath → 仅用户级。
 */
export function listSkills(projectPath?: string): SkillSource[] {
  const user = scanDir(path.join(homedir(), '.claude', 'skills'), 'user');
  const project = projectPath
    ? scanDir(path.join(projectPath, '.claude', 'skills'), 'project')
    : [];
  return [...user, ...project];
}
