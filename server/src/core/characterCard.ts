// 角色卡解析与转换内核
// 纯原生实现：支持本项目原生 JSON、SillyTavern V1/V2/V3 JSON 以及 PNG tEXt base64 角色卡

import type { Character } from './types';
import { filterExtraArgs } from './extraArgs';

/** PNG 签名: 89 50 4E 47 0D 0A 1A 0A */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 从 PNG Buffer 中提取所有 tEXt chunk 的 key-value 键值对
 * 纯 Buffer 扫描，零外部第三方依赖，毫秒级快速提取
 */
export function extractPngTextChunks(buffer: Buffer): Record<string, string> {
  const result: Record<string, string> = {};
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return result;
  }

  let offset = 8;
  const len = buffer.length;

  while (offset + 8 <= len) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;

    if (dataEnd > len) break; // 边界保护：文件截断或损坏

    if (chunkType === 'tEXt') {
      const chunkData = buffer.subarray(dataStart, dataEnd);
      const nullIndex = chunkData.indexOf(0x00);
      if (nullIndex > 0) {
        const keyword = chunkData.toString('latin1', 0, nullIndex);
        const text = chunkData.toString('latin1', nullIndex + 1);
        result[keyword.toLowerCase()] = text;
      }
    } else if (chunkType === 'IEND') {
      break;
    }

    offset = dataEnd + 4; // 跳过 4 字节 CRC
  }

  return result;
}

/**
 * 替换 SillyTavern 角色卡中常见的宏变量，防止 LLM 被生硬的模板变量干扰
 */
export function resolveMacros(text: string, charName: string): string {
  if (!text) return '';
  return text
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/<CHAR>/gi, charName)
    .replace(/<BOT>/gi, charName)
    .replace(/\{\{user\}\}/gi, '用户')
    .replace(/<USER>/gi, '用户');
}

export interface ParseCardOptions {
  /** 默认适配器(若卡片未指定或环境不匹配时兜底使用) */
  defaultAdapter?: string;
  /** 当前系统可用适配器 key 集合 */
  availableAdapters?: string[];
}

export type ParsedCharacterInput = Omit<Character, 'id' | 'createdAt'>;

/**
 * 解析任意格式的角色卡数据 (原生 JSON、SillyTavern V1/V2/V3 JSON、SillyTavern PNG)
 */
export function parseCharacterCard(
  content: Buffer | string,
  options: ParseCardOptions = {},
): ParsedCharacterInput {
  const defaultAdapter = options.defaultAdapter || 'claude';
  const available = options.availableAdapters || [defaultAdapter];

  let rawJsonStr = '';
  let avatarDataUrl: string | undefined = undefined;

  if (Buffer.isBuffer(content)) {
    // 1. 优先检查是否为 PNG 角色卡
    if (content.length >= 8 && content.subarray(0, 8).equals(PNG_SIGNATURE)) {
      const textChunks = extractPngTextChunks(content);
      // SillyTavern 规范: ccv3 优先级高于 chara
      const base64Payload = textChunks['ccv3'] || textChunks['chara'];
      if (!base64Payload) {
        throw new Error('未在 PNG 图片中检测到 SillyTavern 角色元数据 (缺少 ccv3 或 chara tEXt 数据块)');
      }
      try {
        rawJsonStr = Buffer.from(base64Payload, 'base64').toString('utf8');
      } catch {
        throw new Error('PNG 角色元数据 Base64 解码失败');
      }

      // 如果图片体积适中 (小于 2.5MB)，直接转为 avatar data URL 携带
      if (content.length <= 2.5 * 1024 * 1024) {
        avatarDataUrl = `data:image/png;base64,${content.toString('base64')}`;
      }
    } else {
      rawJsonStr = content.toString('utf8');
    }
  } else {
    rawJsonStr = content;
  }

  rawJsonStr = rawJsonStr.trim();
  if (!rawJsonStr) {
    throw new Error('角色卡内容为空');
  }

  let data: any;
  try {
    data = JSON.parse(rawJsonStr);
  } catch (err: any) {
    throw new Error(`角色卡 JSON 解析失败: ${err.message}`);
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('无效的角色卡数据结构');
  }

  // 分支 A: 本项目原生 Character 格式 (包含 persona 与 name)
  if (typeof data.name === 'string' && typeof data.persona === 'string') {
    const rawAdapter = typeof data.adapter === 'string' ? data.adapter : defaultAdapter;
    const adapter = available.includes(rawAdapter) ? rawAdapter : defaultAdapter;
    // extraArgs 白名单(ADR-0002):导入侧剥离子项(导入永不失败)
    const filteredArgs = filterExtraArgs(data.extraArgs);
    if (filteredArgs.removed.length > 0) {
      console.warn(`[character-card] "${data.name}" extraArgs 含非白名单参数,已剥离: ${filteredArgs.removed.join(' ')}`);
    }

    return {
      name: data.name.trim() || '未命名角色',
      avatar: avatarDataUrl || (typeof data.avatar === 'string' ? data.avatar : ''),
      adapter,
      model: typeof data.model === 'string' ? data.model : undefined,
      color: typeof data.color === 'string' ? data.color : undefined,
      persona: data.persona.trim() || '无设定',
      thinking: typeof data.thinking === 'boolean' ? data.thinking : undefined,
      extraArgs: filteredArgs.args.length > 0 ? filteredArgs.args : undefined,
      note: typeof data.note === 'string' ? data.note : undefined,
    };
  }

  // 分支 B: SillyTavern V2 / V3 规范 (包含 spec: 'chara_card_v2' | 'chara_card_v3' 或 data 对象)
  const isV2orV3 =
    data.spec === 'chara_card_v2' ||
    data.spec === 'chara_card_v3' ||
    (data.data && typeof data.data === 'object');

  if (isV2orV3) {
    const cData = data.data || {};
    const rawName = String(cData.name || data.name || '未命名角色').trim();
    const name = rawName || '未命名角色';

    const parts: string[] = [];

    // 1. 系统主提示词 (最高优先级指令)
    if (cData.system_prompt?.trim()) {
      parts.push(`【核心行动指令】\n${resolveMacros(cData.system_prompt.trim(), name)}`);
    }

    // 2. 基础描述 / 外貌 / 背景
    if (cData.description?.trim()) {
      parts.push(`【角色设定】\n${resolveMacros(cData.description.trim(), name)}`);
    }

    // 3. 性格特征与口吻
    if (cData.personality?.trim()) {
      parts.push(`【性格与口吻】\n${resolveMacros(cData.personality.trim(), name)}`);
    }

    // 4. 背景世界观 / 情景
    if (cData.scenario?.trim()) {
      parts.push(`【背景世界观】\n${resolveMacros(cData.scenario.trim(), name)}`);
    }

    // 5. 后置历史增强指令
    if (cData.post_history_instructions?.trim()) {
      parts.push(`【补充指令】\n${resolveMacros(cData.post_history_instructions.trim(), name)}`);
    }

    const persona = parts.join('\n\n').trim() || '无设定';

    const noteParts: string[] = [];
    if (cData.creator?.trim()) noteParts.push(`作者: ${cData.creator.trim()}`);
    if (Array.isArray(cData.tags) && cData.tags.length > 0) noteParts.push(`标签: ${cData.tags.join(', ')}`);
    if (cData.creator_notes?.trim()) noteParts.push(`说明: ${cData.creator_notes.trim()}`);

    return {
      name,
      avatar: avatarDataUrl || '',
      adapter: defaultAdapter,
      persona,
      note: noteParts.length > 0 ? noteParts.join(' | ') : undefined,
    };
  }

  // 分支 C: SillyTavern V1 / TextGen 格式 (顶层包含 description / personality)
  if (typeof data.name === 'string' && (data.description !== undefined || data.personality !== undefined)) {
    const name = data.name.trim() || '未命名角色';
    const parts: string[] = [];

    if (data.description?.trim()) {
      parts.push(`【角色设定】\n${resolveMacros(data.description.trim(), name)}`);
    }
    if (data.personality?.trim()) {
      parts.push(`【性格特征】\n${resolveMacros(data.personality.trim(), name)}`);
    }
    if (data.scenario?.trim()) {
      parts.push(`【背景设定】\n${resolveMacros(data.scenario.trim(), name)}`);
    }

    const persona = parts.join('\n\n').trim() || '无设定';

    return {
      name,
      avatar: avatarDataUrl || '',
      adapter: defaultAdapter,
      persona,
      note: typeof data.creator_notes === 'string' ? data.creator_notes.trim() : undefined,
    };
  }

  throw new Error('无法识别的角色卡格式 (既非本项目原生角色，亦非标准 SillyTavern 角色卡)');
}

export type DetectedImportType = 'character' | 'room' | 'unknown';

export interface DetectImportResult {
  type: DetectedImportType;
  rawJson?: any;
  error?: string;
}

/**
 * 自动嗅探导入文件类型 (角色卡 vs 房间配置)
 */
export function detectImportType(content: Buffer | string): DetectImportResult {
  if (Buffer.isBuffer(content)) {
    if (content.length >= 8 && content.subarray(0, 8).equals(PNG_SIGNATURE)) {
      const textChunks = extractPngTextChunks(content);
      if (textChunks['ccv3'] || textChunks['chara']) {
        return { type: 'character' };
      }
      return { type: 'unknown', error: 'PNG 图片中未包含 SillyTavern 角色元数据' };
    }
  }

  const rawStr = typeof content === 'string' ? content : content.toString('utf8');
  let data: any;
  try {
    data = JSON.parse(rawStr.trim());
  } catch (err: any) {
    return { type: 'unknown', error: `JSON 解析失败: ${err.message}` };
  }

  if (typeof data !== 'object' || data === null) {
    return { type: 'unknown', error: '无效的数据结构' };
  }

  // 1. 显式 Schema 强校验 (最高优先级)
  if (data.schema === 'ai-chatroom.character.v1') {
    return { type: 'character', rawJson: data };
  }
  if (data.schema === 'ai-chatroom.room.v1') {
    return { type: 'room', rawJson: data };
  }

  // 2. SillyTavern 特征识别 (spec 或 data 结构)
  if (
    data.spec === 'chara_card_v2' ||
    data.spec === 'chara_card_v3' ||
    (data.data && typeof data.data === 'object' && typeof data.data.name === 'string')
  ) {
    return { type: 'character', rawJson: data };
  }

  // 3. 房间卡结构特征 (包含 members 数组，且不含角色核心字段 persona)
  if (Array.isArray(data.members) && typeof data.persona !== 'string') {
    return { type: 'room', rawJson: data };
  }

  // 4. 角色卡结构特征 (包含 name，且包含 persona / description / personality 之一，且非房间)
  if (
    typeof data.name === 'string' &&
    !Array.isArray(data.members) &&
    (typeof data.persona === 'string' ||
      typeof data.description === 'string' ||
      typeof data.personality === 'string')
  ) {
    return { type: 'character', rawJson: data };
  }

  return { type: 'unknown', rawJson: data, error: '无法识别导入内容的数据类型 (既非角色卡亦非房间配置)' };
}

