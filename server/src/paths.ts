// 路径锚定(全工程唯一):零依赖纯常量模块。
// server/config、store/* 共用——严禁在此 import 任何其他模块
// (分层纪律:该文件是依赖图的最底层叶子)。

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根:从本文件(src/server/)向上两级——路径解析与 process.cwd() 无关
 *  (npm run dev -w server 的 cwd 是 server/,直接跑则在仓库根,都必须工作)。 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
