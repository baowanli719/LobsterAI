/**
 * GS 云端模型配置 → app_config 的应用。
 *
 * 数据流：服务端 /api/client-config 下发 models（结构与 openclaw.json 的
 * models.providers 对齐）→ gsServerAuth 刷新成功后经 postSyncHook 调这里 →
 * 转换成 app_config 片段写入 sqliteStore → 触发 openclaw 配置同步（必要时
 * 重启网关）→ 广播 gsAuth:modelsApplied 让渲染进程重载模型列表。
 *
 * 幂等：每次刷新（5 分钟/窗口聚焦）都会走到这里，用"片段是否已包含在
 * app_config 里"的子集比较去重，配置没变时不写库、不触发引擎同步。
 * 子集比较（而非全等）是为了容忍渲染进程 configService 对 app_config
 * 做的规范化补字段。
 *
 * 服务端未下发 models（null/缺省）时不做任何事，客户端保留现状。
 */
import { webContents } from 'electron';

import type { SqliteStore } from '../sqliteStore';
import { getGsClientConfig } from './gsServerAuth';
import { buildAppConfigModelPatch } from './modelConfigTransform';

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

/**
 * 把当前登录用户的云端模型配置应用到 app_config。
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
    if (!models?.providers || Object.keys(models.providers).length === 0) return;

    const patch = buildAppConfigModelPatch(models.providers, models.defaultPrimary);
    if (!patch) return;

    const existing = store.get<Record<string, unknown>>('app_config') ?? {};
    if (isDeepSubset(patch, existing)) return; // 已生效，无事可做

    store.set('app_config', { ...existing, ...patch });
    console.log(`[GsModelSync] applied ${Object.keys(patch.providers).length} cloud provider(s) to app_config`);

    // 通知渲染进程重载模型列表（不等引擎同步完成，界面先更新）
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.isDestroyed()) {
        wc.send('gsAuth:modelsApplied');
      }
    }

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
