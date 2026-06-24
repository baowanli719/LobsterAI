'use strict';

const fs = require('fs');
const path = require('path');

const config = require('../electron-builder.json');

// White-label: pull product identity from the shared branding config so the
// installer/app name matches the in-app branding (src/shared/branding).
let branding = {};
try {
  branding = require('../src/shared/branding/branding.config.json');
} catch (error) {
  console.warn('[Branding] failed to read branding.config.json, using electron-builder.json defaults:', error);
}
const brandAppName = typeof branding.appName === 'string' && branding.appName.trim()
  ? branding.appName.trim()
  : config.productName;
const brandAppId = typeof branding.appId === 'string' && branding.appId.trim()
  ? branding.appId.trim()
  : config.appId;
// Executable + artifact filenames must be ASCII (productName may be non-ASCII,
// e.g. Chinese). Prefer branding.fileName; fall back to ASCII-stripped appName.
const brandFileNameSource = (typeof branding.fileName === 'string' && branding.fileName.trim())
  ? branding.fileName.trim()
  : brandAppName;
const brandFileName = brandFileNameSource.replace(/[^\x00-\x7F]/g, '').replace(/\s+/g, '') || 'App';

config.appId = brandAppId;
config.productName = brandAppName;
config.executableName = brandFileName;

const DEFAULT_KEYFROM = 'official';
const KEYFROM_PATTERN = /^[a-z0-9_-]{1,64}$/;

function normalizeKeyfrom(value) {
  if (typeof value !== 'string') return DEFAULT_KEYFROM;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return DEFAULT_KEYFROM;
  if (!KEYFROM_PATTERN.test(normalized)) return DEFAULT_KEYFROM;
  return normalized;
}

function readBuildKeyfrom() {
  if (process.env.KEYFROM !== undefined) {
    return normalizeKeyfrom(process.env.KEYFROM);
  }

  const buildInfoPath = path.join(__dirname, '..', '.keyfrom-build', 'keyfrom.json');
  try {
    if (!fs.existsSync(buildInfoPath)) {
      return DEFAULT_KEYFROM;
    }
    const parsed = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    return normalizeKeyfrom(parsed?.keyfrom);
  } catch (error) {
    console.warn('[Keyfrom] failed to read build keyfrom for artifact names, using official:', error);
    return DEFAULT_KEYFROM;
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function resourceKey(resource) {
  if (typeof resource === 'string') return `string:${resource}`;
  return `${resource?.from || ''}->${resource?.to || ''}`;
}

function mergeExtraResources(platformName) {
  const baseResources = asArray(config.extraResources);
  const platformConfig = config[platformName] || {};
  const platformResources = asArray(platformConfig.extraResources);
  const merged = [];
  const seen = new Set();

  for (const resource of [...baseResources, ...platformResources]) {
    const key = resourceKey(resource);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(resource);
  }

  config[platformName] = {
    ...platformConfig,
    extraResources: merged,
  };
}

const keyfrom = readBuildKeyfrom();

for (const platformName of ['mac', 'win', 'linux']) {
  mergeExtraResources(platformName);
}

delete config.extraResources;

config.dmg = {
  ...(config.dmg || {}),
  artifactName: `${brandFileName}-darwin-\${arch}-\${version}-${keyfrom}.\${ext}`,
};

config.nsis = {
  ...(config.nsis || {}),
  artifactName: `${brandFileName}-Setup-\${arch}-\${version}-${keyfrom}.\${ext}`,
};

console.log(`[Keyfrom] configured artifact keyfrom as ${keyfrom}`);

module.exports = config;
