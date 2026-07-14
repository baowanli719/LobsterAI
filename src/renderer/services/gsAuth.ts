import { store } from '../store';
import { setGsAuthState } from '../store/slices/gsAuthSlice';
import { i18nService } from './i18n';

/**
 * 把主进程标准化的连接错误码（gsServerAuth request 抛出的 TIMEOUT/NETWORK）
 * 翻译成明确的本地化提示（提醒用户检查网络）；业务错误原样展示，
 * 空 message 回落到调用方给的兜底文案。登录框、改密码框等所有 gsAuth 界面共用。
 */
export const resolveGsErrorText = (message: string | undefined, fallbackKey: string): string => {
  if (message === 'TIMEOUT') return i18nService.t('gsConnectTimeout');
  if (message === 'NETWORK') return i18nService.t('gsConnectFailed');
  return message || i18nService.t(fallbackKey);
};

/**
 * GS 服务端登录/配置的渲染进程侧：状态源在主进程（gsServerAuth.ts），
 * 这里只负责把主进程推送的状态同步进 Redux，并封装登录/登出调用。
 */
class GsAuthService {
  private unsubscribe: (() => void) | null = null;

  /** 服务器在线→离线转变时弹全局 toast 提醒检查网络（登录框开着时它自己会显示错误，不重复弹） */
  private notifyIfWentOffline(next: { enabled: boolean; online: boolean }): void {
    const prev = store.getState().gsAuth;
    if (next.enabled && prev.online && !next.online && !prev.loginDialogOpen) {
      window.dispatchEvent(
        new CustomEvent('app:showToast', { detail: i18nService.t('gsWentOffline') }),
      );
    }
  }

  async init(): Promise<void> {
    if (!window.electron?.gsAuth) return;
    this.unsubscribe?.();
    this.unsubscribe = window.electron.gsAuth.onStateChanged((state) => {
      this.notifyIfWentOffline(state);
      store.dispatch(setGsAuthState(state));
    });
    try {
      const state = await window.electron.gsAuth.getState();
      store.dispatch(setGsAuthState(state));
    } catch (error) {
      // 主进程 IPC 尚未注册时不阻塞 App 初始化；后续 stateChanged 广播会补上状态
      console.warn('[GsAuth] getState failed during init:', error);
    }
  }

  async login(username: string, password: string): Promise<{ success: boolean; message?: string }> {
    return window.electron.gsAuth.login(username, password);
  }

  async logout(): Promise<void> {
    await window.electron.gsAuth.logout();
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

export const gsAuthService = new GsAuthService();
