// 语言类型与注入契约(core/i18n 叶子;零运行时依赖)。
// 服务层(orchestrator/room/direct/admin/routes)经 LangGetter 构造注入读取;
// 纯函数层(prompt/render 组装器)显式 lang 参数——不引入 provider 依赖。

export type Lang = 'zh' | 'en';

export type LangGetter = () => Lang;

/** 未注入时的缺省(全局不变量:与改造前行为逐字节一致) */
export const DEFAULT_LANG: Lang = 'zh';
