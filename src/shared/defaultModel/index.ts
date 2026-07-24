/**
 * Default model provider — pre-seeds a custom model provider on first run so the
 * white-label app works out of the box without manual configuration.
 *
 * Edit `defaultModel.config.json` to change the bundled default (base URL, API
 * key, model id, context window, ...). Set `enabled: false` to disable seeding.
 *
 * The values are seeded into `app_config.providers[providerKey]` (and optionally
 * set as the default model) by the main process at startup — see
 * `src/main/libs/defaultModelSeed.ts`. A provider slot the user has already
 * configured is never overwritten.
 */
import rawConfig from './defaultModel.config.json';

export interface DefaultModelConfig {
  /** Provider slot key, e.g. "custom_0". */
  providerKey: string;
  /** Friendly name shown in the model picker. */
  displayName: string;
  /** OpenAI-/Anthropic-compatible gateway base URL. */
  baseUrl: string;
  apiKey: string;
  apiFormat: 'openai' | 'anthropic';
  modelId: string;
  modelName: string;
  /** Context window in tokens (0 = unset). */
  contextWindow: number;
  supportsImage: boolean;
  /** Make this the default model on first run. */
  setAsDefault: boolean;
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function resolveDefaultModelConfig(): DefaultModelConfig | null {
  const c = (rawConfig ?? {}) as Record<string, unknown>;
  if (c.enabled !== true) return null;

  const baseUrl = str(c.baseUrl);
  const modelId = str(c.modelId) || str(c.modelName);
  // Not enough to produce a usable provider — skip seeding.
  if (!baseUrl || !modelId) return null;

  return {
    providerKey: str(c.providerKey) || 'custom_0',
    displayName: str(c.displayName) || modelId,
    baseUrl,
    apiKey: str(c.apiKey),
    apiFormat: c.apiFormat === 'anthropic' ? 'anthropic' : 'openai',
    modelId,
    modelName: str(c.modelName) || modelId,
    contextWindow:
      typeof c.contextWindow === 'number' && c.contextWindow > 0 ? c.contextWindow : 0,
    supportsImage: c.supportsImage === true,
    setAsDefault: c.setAsDefault !== false,
  };
}

export const defaultModelConfig: DefaultModelConfig | null = resolveDefaultModelConfig();
