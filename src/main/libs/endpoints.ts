import { app } from 'electron';

import { branding } from '../../shared/branding';
import { HtmlSharePublicRoute } from '../../shared/htmlShare/constants';
import type { SqliteStore } from '../sqliteStore';

let cachedTestMode: boolean | null = null;

/**
 * Read testMode from store and cache it.
 * Call once at startup and again whenever app_config changes.
 */
export function refreshEndpointsTestMode(store: SqliteStore): void {
  const appConfig = store.get<any>('app_config');
  cachedTestMode = appConfig?.app?.testMode === true;
}

/**
 * Whether the app is in test mode.
 * Uses cached value after init; falls back to !app.isPackaged before init.
 */
export const isTestModeEnabled = (): boolean => {
  return cachedTestMode ?? !app.isPackaged;
};

/**
 * Fully-offline white-label switch. When true, every LobsterAI/Youdao cloud
 * endpoint getter returns an empty string so no cloud request is ever built or
 * sent. The model gateway (configured per provider) is unaffected.
 */
export const isCloudServicesDisabled = (): boolean => branding.disableCloudServices;

/**
 * Server API base URL — switches based on testMode.
 * Used for auth exchange/refresh, models, proxy, etc.
 */
export const getServerApiBaseUrl = (): string => {
  if (branding.disableCloudServices) return '';
  return isTestModeEnabled()
    ? 'https://lobsterai-server.inner.youdao.com'
    : 'https://lobsterai-server.youdao.com';
};

export const getHtmlSharePublicBaseUrl = (): string => {
  if (branding.disableCloudServices) return '';
  return `${getServerApiBaseUrl()}${HtmlSharePublicRoute.Root}`;
};

export const getUpdateCheckUrl = (): string => {
  if (branding.disableCloudServices) return '';
  return isTestModeEnabled()
    ? 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/test/update'
    : 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/prod/update';
};

export const getManualUpdateCheckUrl = (): string => {
  if (branding.disableCloudServices) return '';
  return isTestModeEnabled()
    ? 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/test/update-manual'
    : 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/prod/update-manual';
};

export const getFallbackDownloadUrl = (): string => {
  if (branding.disableCloudServices) return '';
  return isTestModeEnabled()
    ? 'https://lobsterai.inner.youdao.com/#/download-list'
    : 'https://lobsterai.youdao.com/#/download-list';
};

export const getSkillStoreUrl = (): string => {
  if (branding.disableCloudServices) return '';
  return isTestModeEnabled()
    ? 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/test/skill-store'
    : 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/prod/skill-store';
};

// Portal 页面
const PORTAL_BASE_TEST = 'https://lobsterai.inner.youdao.com/portal#';
const PORTAL_BASE_PROD = 'https://lobsterai.youdao.com/portal#';

const getPortalBase = (): string => {
  if (branding.disableCloudServices) return '';
  return isTestModeEnabled() ? PORTAL_BASE_TEST : PORTAL_BASE_PROD;
};

export const getPortalTasksUrl = (): string => {
  if (branding.disableCloudServices) return '';
  return `${getPortalBase()}/profile/detail?tab=tasks`;
};

export const getKitStoreUrl = (): string => {
  if (branding.disableCloudServices) return '';
  return isTestModeEnabled()
    ? 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/test/kit-store'
    : 'https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/prod/kit-store';
};
