// 角色库:全局一等实体,持久化到 data/characters.json,跨重启存活。
// 首次启动种子 6 个预设角色。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Character } from '../core/types';
import { REPO_ROOT } from '../paths';

const DATA_DIR = path.join(REPO_ROOT, 'data');
const FILE = path.join(DATA_DIR, 'characters.json');

/** 首启种子预设(仅当文件不存在时写入) */
const SEEDS: Array<Omit<Character, 'id' | 'createdAt'>> = [
  {
    name: '正方',
    adapter: 'claude',
    persona: '你是辩论正方。坚定主张讨论题目中的前者,提供论据,直接反驳反方。',
  },
  {
    name: '反方',
    adapter: 'claude',
    persona: '你是辩论反方。坚定主张讨论题目中的后者,提供论据,直接反驳正方。',
  },
  {
    name: '产品经理',
    adapter: 'claude',
    persona: '你是产品经理。从用户价值、产品定位和商业角度发言。',
  },
  {
    name: '工程师',
    adapter: 'claude',
    persona: '你是资深工程师。从技术可行性、实现成本和风险角度发言。',
  },
  {
    name: '自由人',
    adapter: 'claude',
    persona: '你是一般讨论者。观点中立,就事论事,哪里有价值就支持哪里。',
  },
];

export class CharacterStore {
  private characters: Character[] = [];
  private loaded = false;

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!existsSync(FILE)) {
      // 首启:种子预设
      this.characters = SEEDS.map((s) => ({
        ...s,
        id: randomUUID(),
        createdAt: Date.now(),
      }));
      await this.persist();
    } else {
      try {
        const raw = await readFile(FILE, 'utf8');
        this.characters = JSON.parse(raw) as Character[];
      } catch (e) {
        console.error('[characters] 读取失败,重建:', e);
        this.characters = [];
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(FILE, JSON.stringify(this.characters, null, 2), 'utf8');
  }

  list(): Character[] {
    return [...this.characters];
  }

  get(id: string): Character | undefined {
    return this.characters.find((c) => c.id === id);
  }

  async create(input: Omit<Character, 'id' | 'createdAt'>): Promise<Character> {
    await this.ensureLoaded();
    const c: Character = { ...input, id: randomUUID(), createdAt: Date.now() };
    this.characters.push(c);
    await this.persist();
    return c;
  }

  async update(id: string, patch: Partial<Omit<Character, 'id' | 'createdAt'>>): Promise<Character | undefined> {
    await this.ensureLoaded();
    const idx = this.characters.findIndex((c) => c.id === id);
    if (idx < 0) return undefined;
    this.characters[idx] = { ...this.characters[idx]!, ...patch, id, createdAt: this.characters[idx]!.createdAt };
    await this.persist();
    return this.characters[idx]!;
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const before = this.characters.length;
    this.characters = this.characters.filter((c) => c.id !== id);
    if (this.characters.length === before) return false;
    await this.persist();
    return true;
  }
}
