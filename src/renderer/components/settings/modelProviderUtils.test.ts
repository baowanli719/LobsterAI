import { expect, test } from 'vitest';

import { ProviderAuthType, ProviderName } from '../../../shared/providers';
import {
  CUSTOM_PROVIDER_KEYS,
  hasProviderAuthConfigured,
  type ProviderConfig,
  providerKeys,
  providerRequiresApiKey,
} from './modelProviderUtils';

const providerConfig = (overrides: Partial<ProviderConfig> = {}): ProviderConfig => ({
  enabled: true,
  apiKey: '',
  baseUrl: 'https://api.example.com',
  models: [],
  ...overrides,
});

test('GitHub Copilot does not require a persisted API key', () => {
  expect(providerRequiresApiKey(ProviderName.Copilot)).toBe(false);
});

test('model settings only list DeepSeek plus custom providers', () => {
  expect(providerKeys).toEqual([
    ProviderName.DeepSeek,
    ...CUSTOM_PROVIDER_KEYS,
  ]);
});

test('GitHub Copilot OAuth auth is tracked by authType instead of apiKey', () => {
  expect(hasProviderAuthConfigured(
    ProviderName.Copilot,
    providerConfig({ authType: ProviderAuthType.OAuth }),
  )).toBe(true);

  expect(hasProviderAuthConfigured(
    ProviderName.Copilot,
    providerConfig({ apiKey: 'legacy-short-token' }),
  )).toBe(false);
});
