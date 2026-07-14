/**
 * GS 云端模型配置 → app_config 的应用。
 *
 * 数据流：服务端 /api/client-config 下发 models（结构与 openclaw.json 的
 * models.providers 对齐）→ gsServerAuth 刷新成功后经 postSyncHook 调这里 →
 * 转换成 app_config 片段写入 sqliteStore → 触发 openclaw 配置同步（必要时
 * 重启网关）→ 广播 gsAuth:modelsApplied 让渲染进程重载模型列表。
 *
 * 幂等：每次刷新（启动/5 分钟/窗口聚焦）都会走到这里，用"片段是否已包含在
 * app_config 里"的子集比较去重，配置没变时不写库、不触发引擎同步。
 * 子集比较（而非全等）是为了容忍渲染进程 configService 对 app_config
 * 做的规范化补字段。
 *
 * 服务端仍在下发 models 时，patch.providers 整体替换 app_config.providers，
 * 天然会丢弃服务端已移除的 provider —— 无残留。
 * 但服务端把 models 改回 null（云端不再管理）时，之前应用过的云端 provider
 * 不会被自动清理。为此额外持久化"最近一次云端下发的 provider id 清单"
 * （CLOUD_PROVIDER_IDS_KEY），每次刷新（含启动）都据此校验：清单里的 id
 * 如果不在服务端最新配置里，就从 app_config 删掉；只删清单内的 id，
 * 绝不动用户自己在设置页添加的自定义模型。
 */
import { webContents } from 'electron';

import { GS_CLOUD_PROVIDER_IDS_KEY as CLOUD_PROVIDER_IDS_KEY } from '../../shared/gsCloudModels';
import type { SqliteStore } from '../sqliteStore';
import { getGsClientConfig } from './gsServerAuth';
import { buildAppConfigModelPatch } from './modelConfigTransform';

interface AppConfigModelShape {
  providers?: Record<string, unknown>;
  model?: {
    availableModels?: Array<{ id: string; providerKey?: string }>;
    defaultModel?: string;
    defaultModelProvider?: string;
  };
  api?: { key?: string; baseUrl?: string };
}

/**
 * 从 app_config 里删掉一批 provider id（及其模型），用剩余 provider 里的第一个
 * 顶替被删的默认模型/api（若默认模型恰好在被删名单里）。导出仅为测试。
 */
export function pruneCloudProviders(
  existing: Record<string, unknown>,
  removedIds: string[],
): Record<string, unknown> {
  const config = existing as AppConfigModelShape;
  const providers = { ...(config.providers ?? {}) };
  for (const id of removedIds) delete providers[id];

  const availableModels = (config.model?.availableModels ?? []).filter(
    (m) => !removedIds.includes(m.providerKey ?? ''),
  );

  let defaultModel = config.model?.defaultModel ?? '';
  let defaultModelProvider = config.model?.defaultModelProvider ?? '';
  if (defaultModelProvider && removedIds.includes(defaultModelProvider)) {
    defaultModel = availableModels[0]?.id ?? '';
    defaultModelProvider = availableModels[0]?.providerKey ?? '';
  }

  const remainingDefaultProvider = providers[defaultModelProvider] as { apiKey?: string; baseUrl?: string } | undefined;
  const api = remainingDefaultProvider
    ? { key: remainingDefaultProvider.apiKey ?? '', baseUrl: remainingDefaultProvider.baseUrl ?? '' }
    : config.api;

  return {
    ...existing,
    providers,
    model: { ...config.model, availableModels, defaultModel, defaultModelProvider },
    ...(api ? { api } : {}),
  };
}

/** patch 的每个字段都在 target 中且值深相等（target 允许有多余字段）。导出仅为测试 */
export function isDeepSubset(patch: unknown, target: unknown): boolean {
  if (patch === target) return true;
  if (Array.isArray(patch)) {
    if (!Array.isArray(target) || target.length !== patch.length) return false;
    return patch.every((item, i) => isDeepSubset(item, target[i]));
  }
  if (typeof patch === 'object' && patch !== null) {
    if (typeof target !== 'object' || target === null || Array.isArray(target)) return false;
    return Object.entries(patch).every(([key, value]) =>
      isDeepSubset(value, (target as Record<string, unknown>)[key]));
  }
  return false;
}

let applying = false;

/** 通知渲染进程重载模型列表（不等引擎同步完成，界面先更新） */
function broadcastModelsApplied(): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) {
      wc.send('gsAuth:modelsApplied');
    }
  }
}

const sameIdSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * 把当前登录用户的云端模型配置应用到 app_config；服务端不再管理某些 provider
 * 时（收窄清单或整体停止下发）据此清理残留，客户端启动/刷新时自动校验。
 * syncConfig 由 main.ts 注入（syncOpenClawConfig 是 main.ts 内部函数）。
 */
export async function applyGsCloudModels(
  store: SqliteStore,
  syncConfig: (options: { reason: string; restartGatewayIfRunning?: boolean }) => Promise<{ success: boolean; error?: string }>,
): Promise<void> {
  if (applying) return; // 刷新可能密集触发，跳过并发调用
  applying = true;
  try {
    const config = getGsClientConfig();
    const models = config?.models;
    const previousIds = store.get<string[]>(CLOUD_PROVIDER_IDS_KEY) ?? [];

    if (!models?.providers || Object.keys(models.providers).length === 0) {
      // 云端不再管理模型：清理上次云端下发、现已不在服务端名单里的 provider；
      // 只删清单内记录过的 id，用户自己在设置页配置的模型不受影响。
      if (previousIds.length === 0) return;

      const existing = store.get<Record<string, unknown>>('app_config') ?? {};
      store.set('app_config', pruneCloudProviders(existing, previousIds));
      store.set(CLOUD_PROVIDER_IDS_KEY, []);
      console.log(`[GsModelSync] 云端已停止管理模型，清理了 ${previousIds.length} 个残留 provider`);
      broadcastModelsApplied();

      const result = await syncConfig({ reason: 'gs-cloud-models-cleared', restartGatewayIfRunning: true });
      if (!result.success) {
        console.error('[GsModelSync] openclaw config sync failed:', result.error);
      }
      return;
    }

    const patch = buildAppConfigModelPatch(models.providers, models.defaultPrimary);
    if (!patch) return;

    const newIds = Object.keys(patch.providers);
    const existing = store.get<Record<string, unknown>>('app_config') ?? {};
    // 幂等判定除了子集比较，还要求 providers 的键集合完全一致：
    // app_config 里多出服务端清单之外的 provider（历史残留/渲染进程合并回的预制模型）
    // 时也要触发整体重写，把多余的清掉——"不在服务端的删除"。
    const existingProviderIds = Object.keys((existing as { providers?: Record<string, unknown> }).providers ?? {});
    if (
      isDeepSubset(patch, existing)
      && sameIdSet(previousIds, newIds)
      && sameIdSet(existingProviderIds, newIds)
    ) return; // 已生效且无残留，无事可做

    store.set('app_config', { ...existing, ...patch });
    store.set(CLOUD_PROVIDER_IDS_KEY, newIds);
    console.log(`[GsModelSync] applied ${newIds.length} cloud provider(s) to app_config`);
    broadcastModelsApplied();

    const result = await syncConfig({ reason: 'gs-cloud-models', restartGatewayIfRunning: true });
    if (!result.success) {
      console.error('[GsModelSync] openclaw config sync failed:', result.error);
    }
  } catch (error) {
    console.error('[GsModelSync] failed to apply cloud models:', error);
  } finally {
    applying = false;
  }
}
