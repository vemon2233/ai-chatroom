// useDialog:Promise 化的确认/输入对话框——替代原生 alert/confirm/prompt。
// 全工程唯一确认交互入口(渲染由 App.vue 挂载的 <DialogHost/> 承担)。

import { reactive, readonly } from 'vue';

interface DialogSpec {
  kind: 'confirm' | 'prompt' | 'alert';
  title: string;
  message: string;
  defaultValue?: string;
  confirmText?: string;
  danger?: boolean;
}

interface ActiveDialog extends DialogSpec {
  id: number;
  resolve: (value: string | boolean | null) => void;
}

const state = reactive({
  current: null as ActiveDialog | null,
});

let seq = 0;

function open(spec: DialogSpec): Promise<string | boolean | null> {
  // 同一时间只允许一个对话框:后到的顶掉先到的(先到的 resolve null = 取消)
  state.current?.resolve(null);
  return new Promise((resolve) => {
    state.current = { ...spec, id: ++seq, resolve };
  });
}

export const dialog = {
  /** 确认框:resolve true/false */
  confirm(title: string, message: string, opts?: { danger?: boolean; confirmText?: string }): Promise<boolean> {
    return open({ kind: 'confirm', title, message, ...opts }) as Promise<boolean>;
  },
  /** 输入框:resolve 用户输入;取消 resolve null */
  prompt(title: string, message: string, defaultValue = ''): Promise<string | null> {
    return open({ kind: 'prompt', title, message, defaultValue }) as Promise<string | null>;
  },
  /** 提示框(alert 语义):resolve true */
  alert(title: string, message: string): Promise<boolean> {
    return open({ kind: 'alert', title, message }) as Promise<boolean>;
  },
};

/** DialogHost 组件内部使用:完成当前对话框 */
export function settleDialog(value: string | boolean | null): void {
  const cur = state.current;
  state.current = null;
  cur?.resolve(value);
}

export const dialogState = readonly(state);
