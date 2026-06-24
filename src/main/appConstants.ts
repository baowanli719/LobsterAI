import { branding } from '../shared/branding';

// User-visible identity comes from the branding config (white-label).
export const APP_NAME = branding.appName;
export const APP_USER_MODEL_ID = branding.appId;

// Internal identifiers — keep stable. Changing these breaks deep links,
// stored data, and the OpenClaw integration.
export const APP_ID = 'lobsterai';
export const APP_ATTENTION_BADGE_COLOR = '#FF3B30';
export const DB_FILENAME = 'lobsterai.sqlite';
