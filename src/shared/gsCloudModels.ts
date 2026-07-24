/**
 * sqliteStore key：最近一次 GS 云端下发的模型 provider id 清单。
 * 主进程（gsModelSync）在每次成功应用云端模型配置后写入；
 * 渲染进程（configService）读它判断"云端是否在托管模型"——
 * 托管期间不把出厂预制 provider 合并回配置，避免模型选择框残留旧模型。
 * 空数组/缺省 = 云端未托管，走本地默认行为。
 */
export const GS_CLOUD_PROVIDER_IDS_KEY = 'gs_cloud_provider_ids';
