import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { AppUpdateSource, AppUpdateStatus } from '../../shared/appUpdate/constants';
import type { SqliteStore } from '../sqliteStore';

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(),
  getVersion: vi.fn(),
  fetch: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  cancelActiveDownload: vi.fn(),
  getGsClientConfig: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: mocks.getPath,
    getVersion: mocks.getVersion,
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
  session: {
    defaultSession: {
      fetch: mocks.fetch,
    },
  },
}));

vi.mock('./appUpdateInstaller', () => ({
  cancelActiveDownload: mocks.cancelActiveDownload,
  downloadUpdate: mocks.downloadUpdate,
  installUpdate: mocks.installUpdate,
}));

vi.mock('./endpoints', () => ({
  getUpdateCheckUrl: () => 'https://updates.example.com/auto',
  getManualUpdateCheckUrl: () => 'https://updates.example.com/manual',
  getFallbackDownloadUrl: () => 'https://updates.example.com/download-list',
}));

vi.mock('./keyfromAttribution', () => ({
  getKeyfromAttribution: () => ({ firstKeyfrom: 'none', latestKeyfrom: 'none' }),
}));

vi.mock('./gsServerAuth', () => ({
  getGsClientConfig: mocks.getGsClientConfig,
}));

import {
  APP_UPDATE_READY_FILE_KEY_PREFIX,
  AppUpdateCoordinator,
  isWithinDownloadSchedule,
} from './appUpdateCoordinator';

const READY_VERSION = '2.0.0';

function createStoreStub(): SqliteStore {
  const map = new Map<string, unknown>();
  return {
    get: (key: string) => map.get(key),
    set: (key: string, value: unknown) => {
      map.set(key, value);
    },
    delete: (key: string) => {
      map.delete(key);
    },
  } as unknown as SqliteStore;
}

function readyFileStoreKey(source: AppUpdateSource): string {
  return `${APP_UPDATE_READY_FILE_KEY_PREFIX}:${source}`;
}

/** 模拟 GS 服务端下发的客户端配置，appUpdate 字段按需覆盖 */
function gsConfigWithAppUpdate(appUpdate: Record<string, unknown>): Record<string, unknown> {
  const version = typeof appUpdate.version === 'string' ? appUpdate.version : READY_VERSION;
  return {
    version: 1,
    features: { customModel: true },
    settingsPages: {},
    permissions: { allowSubmit: true },
    appUpdate: {
      downloads: {
        windowsX64: `https://updates.example.com/lobsterai-${version}.exe`,
        macArm: `https://updates.example.com/lobsterai-${version}-arm64.dmg`,
        macIntel: `https://updates.example.com/lobsterai-${version}-x64.dmg`,
      },
      ...appUpdate,
    },
  };
}

const pad2 = (value: number): string => String(value).padStart(2, '0');
const minutesToHHmm = (totalMinutes: number): string => {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
};

function seedReadyFile(store: SqliteStore, updatesDir: string, source: AppUpdateSource): string {
  fs.mkdirSync(updatesDir, { recursive: true });
  const filePath = path.join(updatesDir, `lobsterai-update-${source}-1.exe`);
  const bytes = 'installer-bytes';
  fs.writeFileSync(filePath, bytes);
  const fileHash = crypto.createHash('sha256').update(bytes).digest('hex');
  store.set(readyFileStoreKey(source), {
    version: READY_VERSION,
    filePath,
    fileHash,
    info: {
      latestVersion: READY_VERSION,
      date: '2026-06-10',
      changeLog: {
        zh: { title: '', content: [] },
        en: { title: '', content: [] },
      },
      url: `https://updates.example.com/lobsterai-${READY_VERSION}.exe`,
    },
  });
  return filePath;
}

describe('AppUpdateCoordinator', () => {
  let tmpDir: string;
  let updatesDir: string;

  beforeEach(() => {
    mocks.getPath.mockReset();
    mocks.getVersion.mockReset();
    mocks.fetch.mockReset();
    mocks.downloadUpdate.mockReset();
    mocks.installUpdate.mockReset();
    mocks.cancelActiveDownload.mockReset();
    mocks.getGsClientConfig.mockReset();
    mocks.getGsClientConfig.mockReturnValue(null);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-update-test-'));
    updatesDir = path.join(tmpDir, 'updates');
    mocks.getPath.mockReturnValue(tmpDir);
    mocks.getVersion.mockReturnValue('1.0.0');
    mocks.cancelActiveDownload.mockReturnValue(false);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns to Ready and keeps the verified installer when install fails', async () => {
    const store = createStoreStub();
    const filePath = seedReadyFile(store, updatesDir, AppUpdateSource.Auto);
    const coordinator = new AppUpdateCoordinator(store);
    expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready);

    mocks.installUpdate.mockRejectedValue(new Error('The operation was canceled by the user.'));

    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(false);
    expect(result.state.status).toBe(AppUpdateStatus.Ready);
    expect(result.state.readyFilePath).toBe(filePath);
    expect(result.state.errorMessage).toBe('The operation was canceled by the user.');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('falls back to Available when the installer is gone after a failed install', async () => {
    const store = createStoreStub();
    const filePath = seedReadyFile(store, updatesDir, AppUpdateSource.Auto);
    const coordinator = new AppUpdateCoordinator(store);

    mocks.installUpdate.mockImplementation(async () => {
      fs.unlinkSync(filePath);
      throw new Error('Update file not found');
    });

    const result = await coordinator.installReadyUpdate();

    expect(result.success).toBe(false);
    expect(result.state.status).toBe(AppUpdateStatus.Available);
    expect(result.state.readyFilePath).toBeNull();
    expect(result.state.errorMessage).toBe('Update file not found');
    expect(store.get(readyFileStoreKey(AppUpdateSource.Auto))).toBeUndefined();
  });

  test('manual check reuses an installer downloaded by the auto flow', async () => {
    const store = createStoreStub();
    const filePath = seedReadyFile(store, updatesDir, AppUpdateSource.Auto);
    const coordinator = new AppUpdateCoordinator(store);

    // 外网检查已禁用，更新信息走 GS 服务端配置
    mocks.getGsClientConfig.mockReturnValue(gsConfigWithAppUpdate({ version: READY_VERSION }));

    const result = await coordinator.checkNow({ manual: true });

    expect(result.success).toBe(true);
    expect(result.updateFound).toBe(true);
    expect(result.state.status).toBe(AppUpdateStatus.Ready);
    expect(result.state.source).toBe(AppUpdateSource.Manual);
    expect(result.state.readyFilePath).toBe(filePath);
    expect(mocks.downloadUpdate).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  test('restores installIncomplete after an install attempt that never completed', async () => {
    const store = createStoreStub();
    seedReadyFile(store, updatesDir, AppUpdateSource.Auto);
    const coordinator = new AppUpdateCoordinator(store);
    mocks.installUpdate.mockResolvedValue(undefined);

    const result = await coordinator.installReadyUpdate();
    expect(result.success).toBe(true);

    const restored = new AppUpdateCoordinator(store);
    const state = restored.getState();
    expect(state.status).toBe(AppUpdateStatus.Ready);
    expect(state.installIncomplete).toBe(true);
  });

  describe('GS server-driven updates', () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;

    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mocks.downloadUpdate.mockImplementation(async () => {
        fs.mkdirSync(updatesDir, { recursive: true });
        const filePath = path.join(updatesDir, `lobsterai-update-auto-${Date.now()}.exe`);
        fs.writeFileSync(filePath, 'downloaded-installer');
        return filePath;
      });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', platformDescriptor);
    });

    test('auto check downloads immediately when no schedule is configured', async () => {
      mocks.getGsClientConfig.mockReturnValue(gsConfigWithAppUpdate({
        version: '2.0.0',
        notes: ['新增功能 A', '修复问题 B'],
      }));
      const coordinator = new AppUpdateCoordinator(createStoreStub());

      const result = await coordinator.checkNow();

      expect(result.success).toBe(true);
      expect(result.updateFound).toBe(true);
      expect(result.state.status).toBe(AppUpdateStatus.Ready);
      expect(result.state.info?.latestVersion).toBe('2.0.0');
      expect(result.state.info?.changeLog.zh.content).toEqual(['新增功能 A', '修复问题 B']);
      expect(mocks.downloadUpdate).toHaveBeenCalledWith(
        'https://updates.example.com/lobsterai-2.0.0.exe',
        AppUpdateSource.Auto,
        expect.any(Function),
      );
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    test('reports Available but defers auto download outside the daily window', async () => {
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      mocks.getGsClientConfig.mockReturnValue(gsConfigWithAppUpdate({
        version: '2.0.0',
        // 从 2 小时后开始的 1 小时窗口，当前时间必然在窗口外
        downloadWindow: {
          start: minutesToHHmm(nowMinutes + 120),
          end: minutesToHHmm(nowMinutes + 180),
        },
      }));
      const coordinator = new AppUpdateCoordinator(createStoreStub());

      const result = await coordinator.checkNow();

      expect(result.updateFound).toBe(true);
      expect(result.state.status).toBe(AppUpdateStatus.Available);
      expect(mocks.downloadUpdate).not.toHaveBeenCalled();
    });

    test('reports Available but defers auto download before availableFrom', async () => {
      mocks.getGsClientConfig.mockReturnValue(gsConfigWithAppUpdate({
        version: '2.0.0',
        availableFrom: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }));
      const coordinator = new AppUpdateCoordinator(createStoreStub());

      const result = await coordinator.checkNow();

      expect(result.updateFound).toBe(true);
      expect(result.state.status).toBe(AppUpdateStatus.Available);
      expect(mocks.downloadUpdate).not.toHaveBeenCalled();
    });

    test('user-triggered retryDownload is not blocked by the schedule', async () => {
      mocks.getGsClientConfig.mockReturnValue(gsConfigWithAppUpdate({
        version: '2.0.0',
        availableFrom: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }));
      const coordinator = new AppUpdateCoordinator(createStoreStub());
      await coordinator.checkNow();
      expect(coordinator.getState().status).toBe(AppUpdateStatus.Available);

      await coordinator.retryDownload();
      await vi.waitFor(() => {
        expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready);
      });
      expect(mocks.downloadUpdate).toHaveBeenCalled();
    });

    test('reports no update when GS version is not newer than current', async () => {
      mocks.getGsClientConfig.mockReturnValue(gsConfigWithAppUpdate({ version: '1.0.0' }));
      const coordinator = new AppUpdateCoordinator(createStoreStub());

      const result = await coordinator.checkNow();

      expect(result.updateFound).toBe(false);
      expect(result.state.status).toBe(AppUpdateStatus.Idle);
      expect(mocks.downloadUpdate).not.toHaveBeenCalled();
    });

    test('checkFromGsConfigRefresh keeps a ready installer of the same version untouched', async () => {
      const store = createStoreStub();
      const filePath = seedReadyFile(store, updatesDir, AppUpdateSource.Auto);
      mocks.getGsClientConfig.mockReturnValue(gsConfigWithAppUpdate({ version: READY_VERSION }));
      const coordinator = new AppUpdateCoordinator(store);
      expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready);

      await coordinator.checkFromGsConfigRefresh();

      const state = coordinator.getState();
      expect(state.status).toBe(AppUpdateStatus.Ready);
      expect(state.readyFilePath).toBe(filePath);
      expect(mocks.downloadUpdate).not.toHaveBeenCalled();
    });

    test('checkFromGsConfigRefresh starts a new flow when the server publishes a newer version', async () => {
      const store = createStoreStub();
      seedReadyFile(store, updatesDir, AppUpdateSource.Auto);
      mocks.getGsClientConfig.mockReturnValue(gsConfigWithAppUpdate({ version: '3.0.0' }));
      const coordinator = new AppUpdateCoordinator(store);

      await coordinator.checkFromGsConfigRefresh();

      const state = coordinator.getState();
      expect(state.status).toBe(AppUpdateStatus.Ready);
      expect(state.info?.latestVersion).toBe('3.0.0');
      expect(mocks.downloadUpdate).toHaveBeenCalledWith(
        'https://updates.example.com/lobsterai-3.0.0.exe',
        AppUpdateSource.Auto,
        expect.any(Function),
      );
    });

    test('checkFromGsConfigRefresh clears leftover state after the server stops publishing', async () => {
      const store = createStoreStub();
      seedReadyFile(store, updatesDir, AppUpdateSource.Auto);
      const coordinator = new AppUpdateCoordinator(store);
      expect(coordinator.getState().status).toBe(AppUpdateStatus.Ready);

      mocks.getGsClientConfig.mockReturnValue(null);
      await coordinator.checkFromGsConfigRefresh();

      expect(coordinator.getState().status).toBe(AppUpdateStatus.Idle);
    });
  });

  describe('isWithinDownloadSchedule', () => {
    const at = (hhmm: string): Date => new Date(`2026-07-13T${hhmm}:00`);

    test('no schedule means always allowed', () => {
      expect(isWithinDownloadSchedule({}, at('12:00'))).toBe(true);
    });

    test('availableFrom blocks before and allows after', () => {
      const schedule = { availableFrom: '2026-07-14T00:00:00+08:00' };
      expect(isWithinDownloadSchedule(schedule, new Date('2026-07-13T12:00:00+08:00'))).toBe(false);
      expect(isWithinDownloadSchedule(schedule, new Date('2026-07-14T08:00:00+08:00'))).toBe(true);
    });

    test('same-day window', () => {
      const schedule = { downloadWindow: { start: '12:00', end: '14:00' } };
      expect(isWithinDownloadSchedule(schedule, at('11:59'))).toBe(false);
      expect(isWithinDownloadSchedule(schedule, at('12:00'))).toBe(true);
      expect(isWithinDownloadSchedule(schedule, at('13:30'))).toBe(true);
      expect(isWithinDownloadSchedule(schedule, at('14:00'))).toBe(false);
    });

    test('overnight window spanning midnight', () => {
      const schedule = { downloadWindow: { start: '20:00', end: '06:00' } };
      expect(isWithinDownloadSchedule(schedule, at('19:00'))).toBe(false);
      expect(isWithinDownloadSchedule(schedule, at('23:00'))).toBe(true);
      expect(isWithinDownloadSchedule(schedule, at('02:00'))).toBe(true);
      expect(isWithinDownloadSchedule(schedule, at('07:00'))).toBe(false);
    });

    test('invalid window format is treated as unrestricted', () => {
      const schedule = { downloadWindow: { start: 'abc', end: '25:99' } };
      expect(isWithinDownloadSchedule(schedule, at('12:00'))).toBe(true);
    });
  });
});
