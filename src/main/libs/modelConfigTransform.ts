/**
 * openclaw 风格的模型 provider 配置 → app_config 片段的共享转换。
 * 两个调用方：
 *  - enterpriseConfigSync：本机 IT 下发的 openclaw.json（启动时一次性）
 *  - gsModelSync：GS 服务端云端下发的 models 配置（登录/刷新时）
 */

/** openclaw.json models.providers 的单项（云端下发结构与其对齐） */
export interface OpenclawStyleProvider {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  models?: Array<{ id: string; name?: string; input?: string[] }>;
}

/** 写入 app_config 的模型相关片段 */
export interface AppConfigModelPatch {
  api: { key: string; baseUrl: string };
  model: {
    availableModels: Array<{
      id: string;
      name: string;
      provider?: string;
      providerKey?: string;
      supportsImage?: boolean;
    }>;
    defaultModel: string;
    defaultModelProvider: string;
  };
  providers: Record<string, {
    enabled: boolean;
    apiKey: string;
    baseUrl: string;
    apiFormat: 'anthropic' | 'openai';
    models: Array<{ id: string; name: string; supportsImage: boolean }>;
  }>;
}

const API_FORMAT_MAP: Record<string, 'anthropic' | 'openai'> = {
  'anthropic-messages': 'anthropic',
  'openai-completions': 'openai',
};

/**
 * 把 openclaw 风格的 providers + 默认模型（"provider/modelId"）转换成 app_config 片段。
 * providers 为空返回 null（调用方跳过写入）。
 */
export function buildAppConfigModelPatch(
  providersInput: Record<string, OpenclawStyleProvider>,
  primary?: string,
): AppConfigModelPatch | null {
  const entries = Object.entries(providersInput ?? {});
  if (entries.length === 0) return null;

  const appProviders: AppConfigModelPatch['providers'] = {};
  const allModels: AppConfigModelPatch['model']['availableModels'] = [];

  for (const [providerId, providerConfig] of entries) {
    const apiFormat = API_FORMAT_MAP[providerConfig.api ?? ''] ?? 'anthropic';
    const providerModels = (providerConfig.models ?? [])
      .filter((m) => typeof m?.id === 'string' && m.id)
      .map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        supportsImage: Array.isArray(m.input) && m.input.includes('image'),
      }));

    // apiKey：用明文值，跳过 ${LOBSTER_...} 这类占位符
    const apiKey = typeof providerConfig.apiKey === 'string' && !providerConfig.apiKey.startsWith('${')
      ? providerConfig.apiKey
      : '';

    appProviders[providerId] = {
      enabled: true,
      apiKey,
      baseUrl: providerConfig.baseUrl ?? '',
      apiFormat,
      models: providerModels,
    };

    for (const m of providerModels) {
      allModels.push({ ...m, provider: providerId, providerKey: providerId });
    }
  }

  // 默认模型："provider/modelId"，不合法时回落到第一个
  let defaultModel = allModels[0]?.id ?? '';
  let defaultModelProvider = Object.keys(appProviders)[0] ?? '';
  if (primary && primary.includes('/')) {
    const slashIdx = primary.indexOf('/');
    defaultModelProvider = primary.slice(0, slashIdx);
    defaultModel = primary.slice(slashIdx + 1);
  }

  const defaultProvider = appProviders[defaultModelProvider];

  return {
    api: {
      key: defaultProvider?.apiKey ?? '',
      baseUrl: defaultProvider?.baseUrl ?? '',
    },
    model: {
      availableModels: allModels,
      defaultModel,
      defaultModelProvider,
    },
    providers: appProviders,
  };
}
