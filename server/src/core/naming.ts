// 成员名匹配叶子模块(零依赖):@点名/接棒/私聊受众解析共用的唯一真源。
// 从 prompt.ts 抽出——modes/* 需要 matchMemberByName 而 prompt.ts 又 import modes/*,
// 曾构成三组 ESM 环(靠函数体内调用侥幸无 TDZ);下沉为叶子后环全解。

/**
 * 成员名匹配:精确匹配绝对优先;包含匹配仅作模糊后备,且取"最长命中"
 * (防前缀名误匹配:@工程师3 不能命中排在成员表前面的"工程师"——
 *  v1 实测事故:工程师2 传棒@工程师3,find 顺序命中 1 号"工程师",1 号抢答)。
 */
export function matchMemberByName<T extends { id: string; name: string }>(
  rawName: string,
  members: T[],
): T | undefined {
  const trimmed = rawName.trim();
  if (!trimmed) return undefined;

  // 1) 精确相等 (最高优先级)
  const exact = members.find((mm) => mm.name === trimmed);
  if (exact) return exact;

  // 2) 数字/中文序号后缀纠偏:如 @吕布1，若不存在名为"吕布1"的成员，但存在"吕布"，则纠偏匹配"吕布"
  const numSuffixMatch = trimmed.match(/^(.+?)[1一]$/);
  if (numSuffixMatch) {
    const baseName = numSuffixMatch[1]!;
    const baseExact = members.find((mm) => mm.name === baseName);
    if (baseExact) return baseExact;
  }

  // 3) 称呼扩展包含:如输入了"吕布将军"包含"吕布" (trimmed.includes(mm.name))
  const contained = members
    .filter((mm) => trimmed.includes(mm.name))
    .sort((a, b) => b.name.length - a.name.length);
  if (contained[0]) return contained[0];

  // 4) 成员名包含输入，但排除数字序号后缀区分(如输入"吕布"，绝不能模糊匹配到"吕布2"或"吕布3")
  const prefixMatched = members
    .filter((mm) => {
      if (!mm.name.includes(trimmed)) return false;
      // 若 mm.name 去除 trimmed 之后仅剩数字编号，说明是不同角色，不能当作别名命中
      const remainder = mm.name.replace(trimmed, '');
      if (/^[0-9一二三四五六七八九十]+$/.test(remainder)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.name.length - a.name.length);
  return prefixMatched[0];
}
