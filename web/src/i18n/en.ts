// 前端英文词典:key 集与 zh.ts 严格一致(缺 key 由 missingWarn 开发期告警)。

export const en = {
  app: {
    title: 'AI Chatroom',
  },
  sidebar: {
    rooms: 'Rooms',
    chars: 'Characters',
    newRoom: '＋ New Room',
    newChar: '＋ New Character',
    import: 'Import',
    noRooms: 'No rooms yet',
    noChars: 'No characters yet',
    export: 'Export',
    exportCfg: 'Export config',
    exportChar: 'Export character',
    edit: 'Edit',
    delete: 'Delete',
    memberUnit: ' members',
    resizeHint: 'Drag left/right to resize the sidebar',
    deleteRoomTitle: 'Delete Room',
    deleteRoomBody: 'Delete room "{name}"? Chat history files will be kept (rooms will not revive after restart).',
    deleteCharTitle: 'Delete Character',
    deleteCharBody: 'Delete character "{name}"? Members already in rooms are unaffected; the 1v1 chat history will be cleaned up.',
    importFailedTitle: 'Import Failed',
    importFailedBody: 'File "{file}" failed to import: {reason}',
    langZh: '中',
    langEn: 'EN',
  },
  common: {
    cancel: 'Cancel',
    confirm: 'OK',
    close: 'Close',
    save: 'Save',
    copy: 'Copy',
    copied: 'Copied!',
  },
  api: {
    requestFailed: 'Request failed ({status})',
  },
};

export default en;
