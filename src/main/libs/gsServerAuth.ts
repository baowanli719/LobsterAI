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
import { app, BrowserWindow, ipcMain, webContents } from 'electron';

import { branding } from '../../shared/branding';
import type { SqliteStore } from '../sqliteStore';

export type GsSettingsPageMode = 'hidden' | 'readonly' | 'editable';

/** 云端对某个 skill 的强制管控：on 强制开启、off 强制关闭；未列出的 skill 不受管控 */
export type GsSkillControl = 'on' | 'off';

/** 云端下发的模型配置，结构与 openclaw.json 的 models.providers 对齐 */
export interface GsModelsConfig {
  providers: Record<string, {
    baseUrl: string;
    api: string;
    apiKey?: string;
    models: Array<{ id: string; name?: string; input?: string[] }>;
  }>;
  /** 默认模型 "providerId/modelId" */
  defaultPrimary?: string;
}

/**
 * 云端下发的应用更新配置。发现比本机新的版本时客户端立即提醒；
 * 自动下载受 availableFrom / downloadWindow 管控，手动下载不受限。
 */
export interface GsAppUpdateConfig {
  /** 最新版本号，如 "1.2.3" */
  version: string;
  /** 更新说明（按行，更新弹窗展示） */
  notes?: string[];
  /** 各平台安装包下载地址 */
  downloads?: {
    windowsX64?: string;
    macArm?: string;
    macIntel?: string;
  };
  /** 可下载开始时间（ISO 8601）；此时间之前只提醒不自动下载 */
  availableFrom?: string;
  /** 每日允许自动下载的时段（HH:mm 本地时间，支持跨零点如 20:00-06:00） */
  downloadWindow?: { start: string; end: string } | null;
}

export interface GsClientConfig {
  version: number;
  features: { customModel: boolean };
  settingsPages: Record<string, GsSettingsPageMode>;
  permissions: {
    allowSubmit: boolean;
    /** 是否允许安装外部 skill；false 时封锁安装通道并对野包做加载扫描拦截。老服务端可能不下发 */
    allowExternalSkillInstall?: boolean;
  };
  /** 云端 skill 管控表（按 skill id）；老服务端可能不下发，消费方需容错 */
  skills?: Record<string, GsSkillControl>;
  /** 云端模型配置；null/缺省 = 不下发，客户端保留本地模型配置。老服务端不下发 */
  models?: GsModelsConfig | null;
  /** 应用更新配置；null/缺省 = 不下发，客户端不提示更新。老服务端不下发 */
  appUpdate?: GsAppUpdateConfig | null;
  /** 通知公告；null/缺省 = 不下发。渲染进程消费，底部滚动横幅展示。老服务端不下发 */
  notice?: GsNoticeConfig | null;
}

/** 服务端下发的通知公告（客户端底部滚动横幅） */
export interface GsNoticeConfig {
  text: string;
  /** 展示开始时间（ISO 8601）；缺省 = 立即展示 */
  startAt?: string;
  /** 展示结束时间（ISO 8601）；缺省 = 一直展示 */
  endAt?: string;
  /** 是否允许用户手动关闭；默认 true */
  dismissible?: boolean;
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

/**
 * 连接类失败的标准化错误码（渲染进程据此显示本地化提示）：
 * TIMEOUT = 请求超时；NETWORK = 连接失败（DNS/拒绝/断网）。带 HTTP status 的业务错误不改写。
 */
export type GsConnectErrorCode = 'TIMEOUT' | 'NETWORK';

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
  } catch (error) {
    // fetch 的原始报错（AbortError/"fetch failed"）对用户没有意义，统一换成错误码
    if ((error as { status?: number }).status === undefined) {
      throw new Error((error as Error).name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
    }
    throw error;
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
export function getGsAuthContext(): { enabled: boolean; baseUrl: string; token: string | null; isLoggedIn: boolean; user: GsUser | null } {
  return { enabled: state.enabled, baseUrl, token, isLoggedIn: state.isLoggedIn, user: state.user };
}

/**
 * 供主进程（如 skillManager）读取当前生效的云端配置。
 * 未启用 GS 对接或未登录时返回 null，调用方据此判断是否套用 skill 管控。
 */
export function getGsClientConfig(): GsClientConfig | null {
  if (!state.enabled || !state.isLoggedIn) return null;
  return state.config;
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

/** 各种登录方式成功后的统一落地：存 token、置登录态、持久化并广播 */
function applyLoginSuccess(result: { token: string; user: GsUser; config: GsClientConfig | null }): void {
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
}

/** 登录类请求失败的统一处理：网络不通时标记离线，凭证错误不影响在线状态 */
function handleLoginError(error: unknown): { success: false; message?: string } {
  if (!isAuthError(error) && (error as { status?: number }).status === undefined) {
    state = { ...state, online: false };
    broadcastState();
  }
  return { success: false, message: (error as Error).message };
}

const clientInfo = () => ({ platform: process.platform, version: app.getVersion() });

async function login(username: string, password: string): Promise<{ success: boolean; message?: string }> {
  if (!state.enabled) return { success: false, message: 'GS server not configured' };
  try {
    const result = await request<{ token: string; user: GsUser; config: GsClientConfig }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password, client: clientInfo() }),
      },
    );
    applyLoginSuccess(result);
    return { success: true };
  } catch (error) {
    return handleLoginError(error);
  }
}

export interface GsLoginMethods {
  password: boolean;
  wecom: boolean;
  email: boolean;
}

/**
 * 探测服务端开放了哪些登录方式（登录框据此渲染）。
 * 老服务端没有 /api/auth/methods：回退到企微单独探测 + 密码登录恒可用。
 */
async function getLoginMethods(): Promise<GsLoginMethods> {
  if (!state.enabled) return { password: true, wecom: false, email: false };
  try {
    const result = await request<{ methods?: Partial<GsLoginMethods> }>('/api/auth/methods');
    return {
      password: result.methods?.password !== false,
      wecom: result.methods?.wecom === true,
      email: result.methods?.email === true,
    };
  } catch {
    return { password: true, wecom: await wecomAvailable(), email: false };
  }
}

/** 请求邮箱验证码：服务端查公司通讯录拿邮箱并发码，返回脱敏邮箱用于界面提示 */
async function emailSendCode(
  account: string,
): Promise<{ success: boolean; maskedEmail?: string; resendIn?: number; message?: string }> {
  if (!state.enabled) return { success: false, message: 'GS server not configured' };
  try {
    const result = await request<{ maskedEmail?: string; resendIn?: number }>('/api/auth/email/send-code', {
      method: 'POST',
      body: JSON.stringify({ account }),
    });
    return { success: true, maskedEmail: result.maskedEmail, resendIn: result.resendIn };
  } catch (error) {
    return handleLoginError(error);
  }
}

/** 邮箱验证码登录：成功后的状态落地与账号密码登录完全一致 */
async function emailLogin(account: string, code: string): Promise<{ success: boolean; message?: string }> {
  if (!state.enabled) return { success: false, message: 'GS server not configured' };
  try {
    const result = await request<{ token: string; user: GsUser; config: GsClientConfig }>(
      '/api/auth/email/verify',
      {
        method: 'POST',
        body: JSON.stringify({ account, code, client: clientInfo() }),
      },
    );
    applyLoginSuccess(result);
    return { success: true };
  } catch (error) {
    return handleLoginError(error);
  }
}

/** 探测服务端是否启用了企业微信扫码登录（登录框据此决定按钮显隐） */
async function wecomAvailable(): Promise<boolean> {
  if (!state.enabled) return false;
  try {
    const result = await request<{ enabled?: boolean }>('/api/auth/wecom/config');
    return result.enabled === true;
  } catch {
    return false;
  }
}

const WECOM_POLL_INTERVAL_MS = 2000;

let wecomWindow: BrowserWindow | null = null;

/**
 * 企业微信扫码登录：向服务端申请一次性 state → 弹窗展示企微二维码页 →
 * 轮询服务端取登录结果。用户关窗即取消（message='CANCELLED'，界面不当作错误）。
 * 成功后的状态落地与账号密码登录完全一致。
 */
async function wecomLogin(): Promise<{ success: boolean; message?: string }> {
  if (!state.enabled) return { success: false, message: 'GS server not configured' };
  if (wecomWindow && !wecomWindow.isDestroyed()) {
    wecomWindow.focus();
    return { success: false, message: 'CANCELLED' };
  }
  let start: { state: string; qrUrl: string; expiresIn?: number };
  try {
    start = await request<{ state: string; qrUrl: string; expiresIn?: number }>('/api/auth/wecom/start', {
      method: 'POST',
      body: JSON.stringify({ client: { platform: process.platform, version: app.getVersion() } }),
    });
  } catch (error) {
    if (!isAuthError(error) && (error as { status?: number }).status === undefined) {
      state = { ...state, online: false };
      broadcastState();
    }
    return { success: false, message: (error as Error).message };
  }

  const qrWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: '企业微信登录',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  wecomWindow = qrWindow;
  qrWindow.removeMenu();
  void qrWindow.loadURL(start.qrUrl);

  const deadline = Date.now() + (start.expiresIn ?? 5 * 60 * 1000);
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, WECOM_POLL_INTERVAL_MS));
      if (qrWindow.isDestroyed()) return { success: false, message: 'CANCELLED' };
      let poll: { status: string; token?: string; user?: GsUser; config?: GsClientConfig; message?: string };
      try {
        poll = await request(`/api/auth/wecom/poll?state=${encodeURIComponent(start.state)}`);
      } catch {
        continue; // 单次轮询失败不终止，网络抖动下一轮再试
      }
      if (poll.status === 'pending') continue;
      if (poll.status === 'ok' && poll.token && poll.user) {
        applyLoginSuccess({ token: poll.token, user: poll.user, config: poll.config ?? null });
        return { success: true };
      }
      return { success: false, message: poll.message || (poll.status === 'expired' ? '二维码已过期，请重试' : '登录失败') };
    }
    return { success: false, message: '二维码已过期，请重试' };
  } finally {
    wecomWindow = null;
    if (!qrWindow.isDestroyed()) qrWindow.close();
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
  ipcMain.handle('gsAuth:wecomAvailable', () => wecomAvailable());
  ipcMain.handle('gsAuth:wecomLogin', () => wecomLogin());
  ipcMain.handle('gsAuth:getLoginMethods', () => getLoginMethods());
  ipcMain.handle('gsAuth:emailSendCode', (_event, args: { account?: string }) =>
    emailSendCode(String(args?.account ?? '').trim()));
  ipcMain.handle('gsAuth:emailLogin', (_event, args: { account?: string; code?: string }) =>
    emailLogin(String(args?.account ?? '').trim(), String(args?.code ?? '').trim()));

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
