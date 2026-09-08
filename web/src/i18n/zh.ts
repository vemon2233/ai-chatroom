// 前端中文词典(唯一真源):文案按域分组,key 命名 域.语义名(camelCase)。
// zh 为现状原文;en 侧 key 集与 zh 严格一致(vue-i18n schema + missingWarn 兜底)。

export const zh = {
  app: {
    title: 'AI 聊天室',
  },
  sidebar: {
    rooms: '房间',
    chars: '角色',
    newRoom: '＋ 新房间',
    newChar: '＋ 新角色',
    import: '导入',
    noRooms: '还没有房间',
    noChars: '还没有角色',
    export: '导出',
    exportCfg: '导出配置',
    exportChar: '导出角色',
    edit: '编辑',
    delete: '删除',
    memberUnit: '人',
    resizeHint: '按住左右拖动调节侧边栏宽度',
    deleteRoomTitle: '删除房间',
    deleteRoomBody: '删除房间「{name}」?聊天历史文件将保留(重启后不再复活)。',
    deleteCharTitle: '删除角色',
    deleteCharBody: '删除角色「{name}」?已拉进房间的成员不受影响，专属私聊记录将被清理。',
    importFailedTitle: '导入失败',
    importFailedBody: '文件「{file}」导入失败: {reason}',
    langZh: '中',
    langEn: 'EN',
  },
  common: {
    cancel: '取消',
    confirm: '确认',
    close: '关闭',
    save: '保存',
    copy: '复制',
    copied: '已复制!',
  },
  api: {
    requestFailed: '请求失败({status})',
  },
} as const;

export default zh;
