import { store } from '../store';
import { setGsAuthState } from '../store/slices/gsAuthSlice';

/**
 * GS 服务端登录/配置的渲染进程侧：状态源在主进程（gsServerAuth.ts），
 * 这里只负责把主进程推送的状态同步进 Redux，并封装登录/登出调用。
 */
class GsAuthService {
  private unsubscribe: (() => void) | null = null;

  async init(): Promise<void> {
    if (!window.electron?.gsAuth) return;
    this.unsubscribe?.();
    this.unsubscribe = window.electron.gsAuth.onStateChanged((state) => {
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
