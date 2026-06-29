/**
 * Branding — single source of truth for all user-visible product identity.
 *
 * Edit `branding.config.json` to white-label the app (display name, company,
 * agent name, app id, logo). All values fall back to the original LobsterAI
 * defaults when a field is missing, so a partial config never breaks the build.
 *
 * What this controls:
 *  - APP_NAME / window title / tray / data dir            (src/main/appConstants.ts)
 *  - {appName} / {agentName} / {company} tokens in i18n   (renderer & main t())
 *  - Agent self-introduction                              (openclawMemoryFile.ts)
 *  - Copyright + packaging product name                   (Settings.tsx, electron-builder)
 *
 * What this intentionally does NOT control (internal identifiers — changing them
 * breaks deep links, stored data and the OpenClaw integration): the `lobsterai://`
 * protocol, APP_ID, DB filename, LOBSTER_* env vars, IPC channel names.
 */
import rawConfig from './branding.config.json';

export interface BrandingConfig {
  /** Display name + window title + data directory name. ASCII recommended. */
  appName: string;
  /** How the agent refers to itself in conversation. Defaults to appName. */
  agentName: string;
  /** Company name for copyright / service agreement, localized. */
  company: { zh: string; en: string };
  /** Application id (electron appId + AppUserModelID). */
  appId: string;
  /** Logo asset filename under public/. */
  logo: string;
  /** Hide the in-app login entry (no-login / internal-gateway deployments). */
  hideLogin: boolean;
  /** Show the image/video generation model picker in the prompt input. */
  showMediaGeneration: boolean;
  /** Show IM bot channels (DingTalk/Feishu/Wecom/QQ/...) and auto-start their gateways. */
  showImChannels: boolean;
  /** Show the voice-input (speech-to-text) button in the prompt input. */
  showVoiceInput: boolean;
}

const DEFAULTS: BrandingConfig = {
  appName: 'LobsterAI',
  agentName: 'LobsterAI',
  company: { zh: '网易有道', en: 'NetEase Youdao' },
  appId: 'com.lobsterai.app',
  logo: 'logo.png',
  hideLogin: false,
  showMediaGeneration: true,
  showImChannels: true,
  showVoiceInput: true,
};

type RawBranding = {
  appName?: unknown;
  agentName?: unknown;
  company?: { zh?: unknown; en?: unknown };
  appId?: unknown;
  logo?: unknown;
  hideLogin?: unknown;
  showMediaGeneration?: unknown;
  showImChannels?: unknown;
  showVoiceInput?: unknown;
};

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

function resolveBranding(): BrandingConfig {
  const c = (rawConfig ?? {}) as RawBranding;
  const appName = str(c.appName) ?? DEFAULTS.appName;
  return {
    appName,
    agentName: str(c.agentName) ?? appName,
    company: {
      zh: str(c.company?.zh) ?? DEFAULTS.company.zh,
      en: str(c.company?.en) ?? DEFAULTS.company.en,
    },
    appId: str(c.appId) ?? DEFAULTS.appId,
    logo: str(c.logo) ?? DEFAULTS.logo,
    hideLogin: typeof c.hideLogin === 'boolean' ? c.hideLogin : DEFAULTS.hideLogin,
    showMediaGeneration: typeof c.showMediaGeneration === 'boolean'
      ? c.showMediaGeneration
      : DEFAULTS.showMediaGeneration,
    showImChannels: typeof c.showImChannels === 'boolean'
      ? c.showImChannels
      : DEFAULTS.showImChannels,
    showVoiceInput: typeof c.showVoiceInput === 'boolean'
      ? c.showVoiceInput
      : DEFAULTS.showVoiceInput,
  };
}

export const branding: BrandingConfig = resolveBranding();

/**
 * Substitute brand tokens in an i18n string. Called by both `t()` functions.
 * Supported tokens: {appName}, {agentName}, {company} (localized).
 * No-op for strings without a `{` so the hot path stays cheap.
 */
export function applyBrandTokens(text: string, lang: 'zh' | 'en'): string {
  if (!text || text.indexOf('{') === -1) return text;
  return text
    .replace(/\{appName\}/g, branding.appName)
    .replace(/\{agentName\}/g, branding.agentName)
    .replace(/\{company\}/g, lang === 'zh' ? branding.company.zh : branding.company.en);
}
