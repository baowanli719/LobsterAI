/**
 * 把预览文件分享到企业微信 / 个人微信（Windows）。
 *
 * PC 端微信/企微没有开放"带文件拉起分享面板"的 API，业界通行做法是剪贴板中转：
 * 1. 把文件以资源管理器文件对象（CF_HDROP）形式放进剪贴板（PowerShell Set-Clipboard）；
 * 2. 通过注册的 URL 协议拉起客户端（wxwork:// / weixin://）；
 * 3. 界面 toast 引导用户在聊天窗口 Ctrl+V 粘贴发送。
 *
 * 协议是否注册（= 是否安装）用 reg query HKCR\<scheme> 检测，未安装返回
 * NOT_INSTALLED，渲染进程给出"请先安装"的本地化提示。
 */
import { execFile } from 'child_process';
import { ipcMain, shell } from 'electron';
import fs from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type WechatShareTarget = 'wecom' | 'wechat';

export type WechatShareErrorCode =
  | 'FILE_NOT_FOUND'
  | 'NOT_INSTALLED'
  | 'CLIPBOARD_FAILED'
  | 'LAUNCH_FAILED'
  | 'UNSUPPORTED_PLATFORM';

export interface WechatShareResult {
  success: boolean;
  code?: WechatShareErrorCode;
}

const PROTOCOL_BY_TARGET: Record<WechatShareTarget, string> = {
  wecom: 'wxwork',
  wechat: 'weixin',
};

/** file:///C:/... → C:\...；已是本地路径的原样返回 */
export function normalizeLocalFilePath(filePath: string): string {
  if (!filePath.startsWith('file://')) return filePath;
  try {
    return decodeURIComponent(new URL(filePath).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  } catch {
    return filePath.replace(/^file:\/\/\/?/, '');
  }
}

/** URL 协议是否在注册表注册（即客户端是否安装） */
async function isProtocolRegistered(scheme: string): Promise<boolean> {
  try {
    await execFileAsync('reg', ['query', `HKCR\\${scheme}`, '/ve'], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** 把文件以 CF_HDROP（资源管理器文件对象）放进剪贴板，聊天窗口可直接粘贴发送 */
async function copyFileToClipboard(filePath: string): Promise<boolean> {
  // 单引号字符串里把内部单引号翻倍即可安全传参
  const quoted = filePath.replace(/'/g, "''");
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -LiteralPath '${quoted}'`],
      { windowsHide: true, timeout: 10000 },
    );
    return true;
  } catch (error) {
    console.error('[WechatShare] Set-Clipboard failed:', error);
    return false;
  }
}

/**
 * 分享入口：文件放剪贴板 + 拉起客户端。
 * 只在 Windows 支持（企业办公环境）；其余平台返回 UNSUPPORTED_PLATFORM。
 */
export async function shareFileToWechat(
  rawFilePath: string,
  target: WechatShareTarget,
): Promise<WechatShareResult> {
  if (process.platform !== 'win32') {
    return { success: false, code: 'UNSUPPORTED_PLATFORM' };
  }

  const filePath = normalizeLocalFilePath(String(rawFilePath ?? ''));
  if (!filePath || !fs.existsSync(filePath)) {
    return { success: false, code: 'FILE_NOT_FOUND' };
  }

  const scheme = PROTOCOL_BY_TARGET[target];
  if (!scheme) {
    return { success: false, code: 'LAUNCH_FAILED' };
  }
  if (!(await isProtocolRegistered(scheme))) {
    return { success: false, code: 'NOT_INSTALLED' };
  }

  if (!(await copyFileToClipboard(filePath))) {
    return { success: false, code: 'CLIPBOARD_FAILED' };
  }

  try {
    await shell.openExternal(`${scheme}://`);
  } catch (error) {
    console.error(`[WechatShare] failed to launch ${scheme}://`, error);
    return { success: false, code: 'LAUNCH_FAILED' };
  }
  return { success: true };
}

/** 注册渲染进程调用入口（main.ts 启动时调一次） */
export function registerWechatShareIpc(): void {
  ipcMain.handle('wechatShare:send', async (_event, payload: { filePath?: string; target?: string }) => {
    const target = payload?.target === 'wechat' ? 'wechat' : 'wecom';
    return shareFileToWechat(String(payload?.filePath ?? ''), target);
  });
}
