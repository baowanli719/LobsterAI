/**
 * GS 企业服务端对接：账号密码登录 + 客户端配置下发。
 *
 * 服务端地址来源（优先级从高到低）：
 *  1. 用户在登录框"服务器设置"里手填的地址（sqliteStore 持久化；manifest 锁定时失效）
 *  2. enterprise-config/manifest.json 的 server.baseUrl（IT 按机器下发）
 *  3. 打包内置默认值 branding.gsServerBaseUrl
 *  4. 环境变量 GS_SERVER_URL（开发调试用）
 * manifest 里 server.lockBaseUrl=true 可锁定地址，禁止用户手改。
 * 所有来源都为空时整个模块处于禁用状态，客户端行为与从前完全一致。
 *
 * 配置刷新时机：登录成功时、窗口聚焦时（30 秒节流）、每 5 分钟定时。
 * 服务端不可达时保留最近一次成功拉取的配置（离线兜底），并置 online=false。
 */
import { app, ipcMain, webContents } from 'electron';

import { branding } from '../../shared/branding';
import type { SqliteStore } from '../sqliteStore';

export type GsSettingsPageMode = 'hidden' | 'readonly' | 'editable';

export interface GsClientConfig {
  version: number;
  features: { customModel: boolean };
  settingsPages: Record<string, GsSettingsPageMode>;
  permissions: { allowSubmit: boolean };
}

export interface GsUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
}

export interface GsAuthState {
  /** 是否启用 GS 服务端对接（配置了服务端地址） */
  enabled: boolean;
  /** 当前生效的服务端地址 */
  baseUrl: string;
  /** 地址被 enterprise-config 锁定，登录框不允许手改 */
  baseUrlLocked: boolean;
  isLoggedIn: boolean;
  user: GsUser | null;
  config: GsClientConfig | null;
  /** 服务端是否可达；未启用时恒为 true */
  online: boolean;
  lastSyncAt: number | null;
}

interface PersistedGsAuth {
  token: string;
  user: GsUser;
  config: GsClientConfig | null;
}

const STORE_KEY = 'gs_auth';
const URL_OVERRIDE_KEY = 'gs_server_url_override';
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const FOCUS_REFRESH_THROTTLE_MS = 30 * 1000;
const REQUEST_TIMEOUT_MS = 10 * 1000;

let store: SqliteStore | null = null;
let baseUrl = '';
let token: string | null = null;
let state: GsAuthState = {
  enabled: false,
  baseUrl: '',
  baseUrlLocked: false,
  isLoggedIn: false,
  user: null,
  config: null,
  online: true,
  lastSyncAt: null,
};
let lastRefreshAt = 0;
let refreshTimer: NodeJS.Timeout | null = null;

function broadcastState(): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) {
      wc.send('gsAuth:stateChanged', state);
    }
  }
}

function persist(): void {
  if (!store) return;
  if (token && state.user) {
    const payload: PersistedGsAuth = { token, user: state.user, config: state.config };
    store.set(STORE_KEY, payload);
  } else {
    store.delete(STORE_KEY);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error((body as { message?: string }).message || `HTTP ${response.status}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}

const isAuthError = (error: unknown): boolean => {
  const status = (error as { status?: number }).status;
  return status === 401 || status === 403;
};

/** 登录/刷新成功后触发（用于 skill 自动同步等）；main.ts 注册 */
let postSyncHook: (() => void) | null = null;
export function setGsPostSyncHook(fn: () => void): void {
  postSyncHook = fn;
}
const triggerPostSync = (): void => {
  try { postSyncHook?.(); } catch { /* 钩子异常不影响主流程 */ }
};

/** 供 skill 同步等模块读取当前登录上下文 */
export function getGsAuthContext(): { enabled: boolean; baseUrl: string; token: string | null; isLoggedIn: boolean } {
  return { enabled: state.enabled, baseUrl, token, isLoggedIn: state.isLoggedIn };
}

/** 拉取最新配置。鉴权失败 → 登出；网络失败 → online=false 并保留缓存配置。 */
async function refresh(): Promise<void> {
  if (!state.enabled || !token) return;
  lastRefreshAt = Date.now();
  try {
    const result = await request<{ user: GsUser; config: GsClientConfig }>('/api/client-config');
    state = {
      ...state,
      isLoggedIn: true,
      user: result.user,
      config: result.config,
      online: true,
      lastSyncAt: Date.now(),
    };
    persist();
    triggerPostSync();
  } catch (error) {
    if (isAuthError(error)) {
      console.warn('[GsAuth] token 失效，已登出:', (error as Error).message);
      token = null;
      state = { ...state, isLoggedIn: false, user: null, config: null, online: true };
      persist();
    } else {
      console.warn('[GsAuth] 服务端不可达，进入离线模式:', (error as Error).message);
      state = { ...state, online: false };
    }
  }
  broadcastState();
}

async function login(username: string, password: string): Promise<{ success: boolean; message?: string }> {
  if (!state.enabled) return { success: false, message: 'GS server not configured' };
  try {
    const result = await request<{ token: string; user: GsUser; config: GsClientConfig }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({
          username,
          password,
          client: { platform: process.platform, version: app.getVersion() },
        }),
      },
    );
    token = result.token;
    state = {
      ...state,
      isLoggedIn: true,
      user: result.user,
      config: result.config,
      online: true,
      lastSyncAt: Date.now(),
    };
    persist();
    broadcastState();
    triggerPostSync();
    return { success: true };
  } catch (error) {
    const message = (error as Error).message;
    // 网络不通时标记离线，凭证错误不影响在线状态
    if (!isAuthError(error) && (error as { status?: number }).status === undefined) {
      state = { ...state, online: false };
      broadcastState();
    }
    return { success: false, message };
  }
}

/** 上报对话日志（元数据 + 提问摘要）。fire-and-forget：未登录/失败静默，绝不阻塞对话。 */
function logChat(payload: { sessionId?: string; model?: string; promptSummary?: string }): void {
  if (!state.enabled || !token || !state.online) return;
  void request('/api/logs/chat', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: payload.sessionId ?? '',
      model: payload.model ?? '',
      promptSummary: (payload.promptSummary ?? '').slice(0, 200),
    }),
  }).catch(() => { /* 日志上报失败不影响使用 */ });
}

async function changePassword(
  oldPassword: string,
  newPassword: string,
): Promise<{ success: boolean; message?: string }> {
  if (!state.enabled || !token) return { success: false, message: 'not logged in' };
  try {
    await request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    return { success: true };
  } catch (error) {
    return { success: false, message: (error as Error).message };
  }
}

function logout(): void {
  token = null;
  state = { ...state, isLoggedIn: false, user: null, config: null };
  persist();
  broadcastState();
}

const normalizeUrl = (value: unknown): string =>
  (typeof value === 'string' ? value.trim() : '').replace(/\/+$/, '');

const isValidServerUrl = (url: string): boolean => /^https?:\/\/\S+$/.test(url);

/** 按优先级解析地址：用户手填 > manifest > 打包内置 > 环境变量；同时返回是否被锁定 */
function resolveBaseUrl(sqliteStore: SqliteStore): { url: string; locked: boolean } {
  const manifest = sqliteStore.get<{ server?: { baseUrl?: string; lockBaseUrl?: boolean } }>('enterprise_config');
  const locked = manifest?.server?.lockBaseUrl === true;
  const fromOverride = locked ? '' : normalizeUrl(sqliteStore.get<string>(URL_OVERRIDE_KEY));
  const fromManifest = normalizeUrl(manifest?.server?.baseUrl);
  const fromBranding = normalizeUrl(branding.gsServerBaseUrl);
  const fromEnv = normalizeUrl(process.env.GS_SERVER_URL);
  return { url: fromOverride || fromManifest || fromBranding || fromEnv, locked };
}

/**
 * 用户在登录框里改服务器地址：持久化覆盖值并重置登录态（不同服务器的 token 不通用）。
 * 传空串表示清除手填值、回落到 manifest/内置默认。
 */
function setServerUrl(rawUrl: string): { success: boolean; message?: string } {
  if (!store) return { success: false, message: 'not initialized' };
  if (state.baseUrlLocked) return { success: false, message: 'locked' };
  const url = normalizeUrl(rawUrl);
  if (url && !isValidServerUrl(url)) {
    return { success: false, message: 'invalid url' };
  }

  if (url) {
    store.set(URL_OVERRIDE_KEY, url);
  } else {
    store.delete(URL_OVERRIDE_KEY);
  }

  const resolved = resolveBaseUrl(store);
  if (resolved.url !== baseUrl) {
    // 换了服务器：清掉旧 token 和配置，回到未登录态
    token = null;
    baseUrl = resolved.url;
    state = {
      ...state,
      enabled: !!baseUrl,
      baseUrl,
      isLoggedIn: false,
      user: null,
      config: null,
      online: true,
      lastSyncAt: null,
    };
    persist();
    broadcastState();
  }
  return { success: true };
}

/**
 * 初始化：解析服务端地址、恢复持久化登录态、注册 IPC、启动定时/聚焦刷新。
 * 必须在 enterprise config sync 之后调用（依赖 store 里的 enterprise_config）。
 */
export function initGsServerAuth(sqliteStore: SqliteStore): void {
  store = sqliteStore;
  const resolved = resolveBaseUrl(sqliteStore);
  baseUrl = resolved.url;
  state.enabled = !!baseUrl;
  state.baseUrl = baseUrl;
  state.baseUrlLocked = resolved.locked;

  ipcMain.handle('gsAuth:getState', () => state);
  ipcMain.handle('gsAuth:login', (_event, args: { username?: string; password?: string }) =>
    login(String(args?.username ?? ''), String(args?.password ?? '')));
  ipcMain.handle('gsAuth:logout', () => { logout(); });
  ipcMain.handle('gsAuth:refresh', async () => { await refresh(); return state; });
  ipcMain.handle('gsAuth:setServerUrl', (_event, args: { url?: string }) =>
    setServerUrl(String(args?.url ?? '')));
  ipcMain.handle('gsAuth:logChat', (_event, payload: { sessionId?: string; model?: string; promptSummary?: string }) => {
    logChat(payload ?? {});
  });
  ipcMain.handle('gsAuth:changePassword', (_event, args: { oldPassword?: string; newPassword?: string }) =>
    changePassword(String(args?.oldPassword ?? ''), String(args?.newPassword ?? '')));

  // 定时/聚焦刷新常驻注册：即使启动时未配置地址，用户手填后也能生效
  refreshTimer = setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
  app.on('browser-window-focus', () => {
    if (Date.now() - lastRefreshAt >= FOCUS_REFRESH_THROTTLE_MS) {
      void refresh();
    }
  });

  if (!state.enabled) {
    console.log('[GsAuth] 未配置服务端地址，GS 登录/配置下发未启用');
    return;
  }
  console.log(`[GsAuth] enabled, server = ${baseUrl}${state.baseUrlLocked ? ' (locked)' : ''}`);

  const persisted = sqliteStore.get<PersistedGsAuth>(STORE_KEY);
  if (persisted?.token && persisted.user) {
    token = persisted.token;
    // 先用缓存恢复登录态，避免启动时界面闪烁；随后立即向服务端校验刷新
    state = {
      ...state,
      isLoggedIn: true,
      user: persisted.user,
      config: persisted.config ?? null,
    };
  }

  void refresh();
}
