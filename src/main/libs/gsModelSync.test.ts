import { describe, expect, test } from 'vitest';

import { isDeepSubset } from './gsModelSync';
import { buildAppConfigModelPatch } from './modelConfigTransform';

describe('buildAppConfigModelPatch', () => {
  const providers = {
    deepseek: {
      baseUrl: 'https://api.deepseek.com',
      api: 'openai-completions',
      apiKey: 'sk-test',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat', input: ['text'] },
        { id: 'deepseek-vl', input: ['text', 'image'] },
      ],
    },
    anthropic: {
      baseUrl: 'https://api.anthropic.com',
      api: 'anthropic-messages',
      apiKey: '${LOBSTER_PLACEHOLDER}',
      models: [{ id: 'claude-sonnet-5' }],
    },
  };

  test('converts providers and resolves default from primary ref', () => {
    const patch = buildAppConfigModelPatch(providers, 'anthropic/claude-sonnet-5');
    expect(patch).not.toBeNull();
    expect(patch!.model.defaultModel).toBe('claude-sonnet-5');
    expect(patch!.model.defaultModelProvider).toBe('anthropic');
    // api 取默认 provider 的配置；占位符 apiKey 被跳过
    expect(patch!.api).toEqual({ key: '', baseUrl: 'https://api.anthropic.com' });
    expect(patch!.providers.deepseek.apiFormat).toBe('openai');
    expect(patch!.providers.deepseek.apiKey).toBe('sk-test');
    expect(patch!.providers.anthropic.apiFormat).toBe('anthropic');
    expect(patch!.model.availableModels).toHaveLength(3);
    // name 缺省回落到 id；input 含 image → supportsImage
    const vl = patch!.model.availableModels.find((m) => m.id === 'deepseek-vl');
    expect(vl).toMatchObject({ name: 'deepseek-vl', supportsImage: true, providerKey: 'deepseek' });
  });

  test('falls back to first provider/model when primary is missing or invalid', () => {
    const patch = buildAppConfigModelPatch(providers, undefined);
    expect(patch!.model.defaultModel).toBe('deepseek-chat');
    expect(patch!.model.defaultModelProvider).toBe('deepseek');
  });

  test('returns null for empty providers', () => {
    expect(buildAppConfigModelPatch({}, 'a/b')).toBeNull();
  });

  test('drops models without id', () => {
    const patch = buildAppConfigModelPatch({
      p: { baseUrl: 'https://x', api: 'openai-completions', models: [{ id: '' }, { id: 'ok' }] },
    });
    expect(patch!.providers.p.models).toHaveLength(1);
  });
});

describe('isDeepSubset', () => {
  test('matches when target has extra fields', () => {
    const patch = { a: 1, nested: { b: [1, 2] } };
    const target = { a: 1, nested: { b: [1, 2], extra: true }, other: 'x' };
    expect(isDeepSubset(patch, target)).toBe(true);
  });

  test('fails on value mismatch, missing key, or array length mismatch', () => {
    expect(isDeepSubset({ a: 1 }, { a: 2 })).toBe(false);
    expect(isDeepSubset({ a: 1 }, {})).toBe(false);
    expect(isDeepSubset({ a: [1, 2] }, { a: [1, 2, 3] })).toBe(false);
    expect(isDeepSubset({ a: [{ x: 1 }] }, { a: [{ x: 2 }] })).toBe(false);
  });

  test('applied patch is a subset of merged app_config (dedup scenario)', () => {
    const patch = buildAppConfigModelPatch(
      { p: { baseUrl: 'https://x', api: 'anthropic-messages', apiKey: 'k', models: [{ id: 'm' }] } },
      'p/m',
    )!;
    const appConfig = { theme: 'dark', ...JSON.parse(JSON.stringify(patch)) };
    expect(isDeepSubset(patch, appConfig)).toBe(true);
    // 云端改了默认模型 → 不再是子集 → 会触发重新应用
    const changed = buildAppConfigModelPatch(
      { p: { baseUrl: 'https://x', api: 'anthropic-messages', apiKey: 'k2', models: [{ id: 'm' }] } },
      'p/m',
    )!;
    expect(isDeepSubset(changed, appConfig)).toBe(false);
  });
});
