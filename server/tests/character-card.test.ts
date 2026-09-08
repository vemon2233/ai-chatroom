import { describe, it, expect } from 'vitest';
import {
  extractPngTextChunks,
  resolveMacros,
  parseCharacterCard,
  detectImportType,
} from '../src/core/characterCard';

describe('characterCard parser', () => {
  it('resolveMacros 能够正确替换 {{char}}, <CHAR>, {{user}}, <USER>', () => {
    const raw = '{{char}} 是一名黑客。<BOT> 正在与 {{user}} 对话。<USER> 请保持警惕。';
    const resolved = resolveMacros(raw, '赛博朋克小艾');
    expect(resolved).toBe('赛博朋克小艾 是一名黑客。赛博朋克小艾 正在与 用户 对话。用户 请保持警惕。');
  });

  it('解析本项目原生 Character JSON', () => {
    const nativeJson = JSON.stringify({
      name: '架构师',
      avatar: 'emoji:robot',
      adapter: 'haiku',
      persona: '你是一名资深系统架构师。',
      color: '#e06c75',
      extraArgs: ['--temp', '0.2'],
      note: '核心成员',
    });

    const parsed = parseCharacterCard(nativeJson, {
      defaultAdapter: 'claude',
      availableAdapters: ['claude', 'haiku'],
    });

    expect(parsed.name).toBe('架构师');
    expect(parsed.avatar).toBe('emoji:robot');
    expect(parsed.adapter).toBe('haiku');
    expect(parsed.persona).toBe('你是一名资深系统架构师。');
    expect(parsed.extraArgs).toEqual(['--temp', '0.2']);
    expect(parsed.note).toBe('核心成员');
  });

  it('原生 Character 遇到不可用 adapter 时自动兜底为 defaultAdapter', () => {
    const nativeJson = JSON.stringify({
      name: '神秘助手',
      adapter: 'deepseek-unknown',
      persona: '设定...',
    });

    const parsed = parseCharacterCard(nativeJson, {
      defaultAdapter: 'claude',
      availableAdapters: ['claude', 'codex'],
    });

    expect(parsed.adapter).toBe('claude');
  });

  it('解析 SillyTavern V2 规范卡片 (chara_card_v2)', () => {
    const v2Card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '艾丽卡',
        description: '{{char}} 是一名来自未来的星际领航员。',
        personality: '冷静，果断，有些毒舌。',
        scenario: '在穿梭舰的驾驶舱内。',
        system_prompt: '请以第一人称扮演领航员回答 {{user}}。',
        creator: 'TavernMaster',
        tags: ['科幻', '领航员'],
        creator_notes: '测试卡片',
      },
    };

    const parsed = parseCharacterCard(JSON.stringify(v2Card), {
      defaultAdapter: 'claude',
    });

    expect(parsed.name).toBe('艾丽卡');
    expect(parsed.adapter).toBe('claude');
    expect(parsed.persona).toContain('【核心行动指令】\n请以第一人称扮演领航员回答 用户。');
    expect(parsed.persona).toContain('【角色设定】\n艾丽卡 是一名来自未来的星际领航员。');
    expect(parsed.persona).toContain('【性格与口吻】\n冷静，果断，有些毒舌。');
    expect(parsed.persona).toContain('【背景世界观】\n在穿梭舰的驾驶舱内。');
    expect(parsed.note).toContain('作者: TavernMaster');
    expect(parsed.note).toContain('标签: 科幻, 领航员');
  });

  it('解析 SillyTavern V1 规范卡片', () => {
    const v1Card = {
      name: '老法师',
      description: '隐居在森林深处的魔法学者。',
      personality: '慈祥但啰嗦。',
      scenario: '林中小屋。',
      creator_notes: 'V1 卡片测试',
    };

    const parsed = parseCharacterCard(JSON.stringify(v1Card), {
      defaultAdapter: 'claude',
    });

    expect(parsed.name).toBe('老法师');
    expect(parsed.persona).toContain('【角色设定】\n隐居在森林深处的魔法学者。');
    expect(parsed.persona).toContain('【性格特征】\n慈祥但啰嗦。');
    expect(parsed.persona).toContain('【背景设定】\n林中小屋。');
    expect(parsed.note).toBe('V1 卡片测试');
  });

  it('能够从合成的 PNG tEXt 数据中读取并解析角色卡', () => {
    const innerCard = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'PNG少女',
        description: '从 PNG 提取的角色',
        personality: '活泼',
      },
    };
    const b64 = Buffer.from(JSON.stringify(innerCard)).toString('base64');

    // 构造极简测试 PNG: 8 字节 header + tEXt chunk + IEND chunk
    const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // tEXt chunk
    const keyword = 'chara';
    const textData = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0x00]), Buffer.from(b64, 'latin1')]);
    const textChunkLen = Buffer.alloc(4);
    textChunkLen.writeUInt32BE(textData.length, 0);
    const textChunkType = Buffer.from('tEXt', 'ascii');
    const dummyCrc = Buffer.alloc(4);

    // IEND chunk
    const iendChunk = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

    const pngBuffer = Buffer.concat([header, textChunkLen, textChunkType, textData, dummyCrc, iendChunk]);

    const extracted = extractPngTextChunks(pngBuffer);
    expect(extracted['chara']).toBe(b64);

    const parsed = parseCharacterCard(pngBuffer, { defaultAdapter: 'claude' });
    expect(parsed.name).toBe('PNG少女');
    expect(parsed.persona).toContain('从 PNG 提取的角色');
    expect(parsed.avatar).toContain('data:image/png;base64,');
  });

  it('非法格式抛出清晰错误信息', () => {
    expect(() => parseCharacterCard('not a json')).toThrow(/JSON 解析失败/);
    expect(() => parseCharacterCard(JSON.stringify({ something: 'invalid' }))).toThrow(/无法识别的角色卡格式/);
  });

  describe('detectImportType', () => {
    it('准确识别原生带 schema 的角色卡与房间配置', () => {
      const charJson = JSON.stringify({ schema: 'ai-chatroom.character.v1', name: '助手' });
      const roomJson = JSON.stringify({ schema: 'ai-chatroom.room.v1', name: '项目室' });

      expect(detectImportType(charJson).type).toBe('character');
      expect(detectImportType(roomJson).type).toBe('room');
    });

    it('准确识别 SillyTavern JSON 角色卡', () => {
      const v2 = JSON.stringify({ spec: 'chara_card_v2', data: { name: '小爱' } });
      const v1 = JSON.stringify({ name: '老法师', description: '法师描述' });

      expect(detectImportType(v2).type).toBe('character');
      expect(detectImportType(v1).type).toBe('character');
    });

    it('准确识别房间配置 (包含 members 数组且无 persona)', () => {
      const room = JSON.stringify({ name: '研讨室', members: [{ name: 'A' }] });
      expect(detectImportType(room).type).toBe('room');
    });

    it('未知格式或损坏格式返回 unknown', () => {
      const random = JSON.stringify({ foo: 'bar' });
      expect(detectImportType(random).type).toBe('unknown');
      expect(detectImportType('not a json').type).toBe('unknown');
    });
  });
});
