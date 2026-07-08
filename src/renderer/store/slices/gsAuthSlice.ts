import { createSlice, PayloadAction } from '@reduxjs/toolkit';

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
  /** 是否启用 GS 服务端对接（未配置服务端地址时为 false，所有拦截逻辑失效） */
  enabled: boolean;
  /** 当前生效的服务端地址 */
  baseUrl: string;
  /** 地址被 enterprise-config 锁定，登录框不允许手改 */
  baseUrlLocked: boolean;
  isLoggedIn: boolean;
  user: GsUser | null;
  config: GsClientConfig | null;
  /** 服务端是否可达 */
  online: boolean;
  lastSyncAt: number | null;
}

interface GsAuthSliceState extends GsAuthState {
  loginDialogOpen: boolean;
}

const initialState: GsAuthSliceState = {
  enabled: false,
  baseUrl: '',
  baseUrlLocked: false,
  isLoggedIn: false,
  user: null,
  config: null,
  online: true,
  lastSyncAt: null,
  loginDialogOpen: false,
};

const gsAuthSlice = createSlice({
  name: 'gsAuth',
  initialState,
  reducers: {
    setGsAuthState(state, action: PayloadAction<GsAuthState>) {
      state.enabled = action.payload.enabled;
      state.baseUrl = action.payload.baseUrl;
      state.baseUrlLocked = action.payload.baseUrlLocked;
      state.isLoggedIn = action.payload.isLoggedIn;
      state.user = action.payload.user;
      state.config = action.payload.config;
      state.online = action.payload.online;
      state.lastSyncAt = action.payload.lastSyncAt;
    },
    openGsLoginDialog(state) {
      state.loginDialogOpen = true;
    },
    closeGsLoginDialog(state) {
      state.loginDialogOpen = false;
    },
  },
});

export const { setGsAuthState, openGsLoginDialog, closeGsLoginDialog } = gsAuthSlice.actions;
export default gsAuthSlice.reducer;

/** 未登录拦截：启用了 GS 对接且未登录 */
export const selectGsLoginRequired = (state: { gsAuth: GsAuthSliceState }): boolean =>
  state.gsAuth.enabled && !state.gsAuth.isLoggedIn;

/** 离线拦截：启用了 GS 对接、已登录但服务端不可达 */
export const selectGsOffline = (state: { gsAuth: GsAuthSliceState }): boolean =>
  state.gsAuth.enabled && !state.gsAuth.online;

/** 服务端明确禁止提交 */
export const selectGsSubmitDenied = (state: { gsAuth: GsAuthSliceState }): boolean =>
  state.gsAuth.enabled
  && state.gsAuth.isLoggedIn
  && state.gsAuth.config?.permissions.allowSubmit === false;
