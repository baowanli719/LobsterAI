/**
 * GS 服务端 skill 自动同步：登录/刷新后拉取服务端 skill 列表，
 * 按版本号对比，服务端更新的下载 zip 解压覆盖到本地 SKILLs 目录并启用。
 *
 * 只同步服务端上传的 skill；内置 skill 走安装包，不受影响。
 * 全程 fire-and-forget，失败静默，离线用本地已有。
 */
import crypto from 'crypto';
import extract from 'extract-zip';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { getGsAuthContext } from './gsServerAuth';

interface ServerSkill {
  name: string;
  version: string;
  enabled: number;
}

interface SkillManagerLike {
  getSkillsRoot(): string;
  setSkillEnabled(id: string, enabled: boolean): unknown;
  listSkills(): Array<{ id: string; name: string; isBuiltIn: boolean; riskLevel?: string; skillPath?: string }>;
  recordServerSkillIds(ids: string[]): void;
  getServerSkillIds(): Set<string>;
}

/** SKILL.md 的 SHA-256 内容指纹；服务端据此发现"已确认的 skill 内容被改过"并重新标记待确认。读不到返回空串 */
function hashSkillMd(skillMdPath?: string): string {
  try {
    if (!skillMdPath) return '';
    return crypto.createHash('sha256').update(fs.readFileSync(skillMdPath)).digest('hex');
  } catch {
    return '';
  }
}

/**
 * 上报本机已安装的 skill（id/name/source/riskLevel/contentHash）给服务端，
 * 供管理端"Skill 管控"页做勾选项并展示扫描风险。
 * 附带当前登录用户（userId/username），服务端按用户记录安装明细供多用户展示；
 * 服务端以 token 里的身份为准，这里带上只为日志排查直观。
 * fire-and-forget：失败静默，不影响主流程。
 */
async function reportInstalledSkills(
  skillManager: SkillManagerLike,
  ctx: { baseUrl: string; token: string; user?: { id: number; username: string } | null },
): Promise<void> {
  try {
    const serverIds = skillManager.getServerSkillIds();
    const skills = skillManager.listSkills().map((s) => ({
      id: s.id,
      name: s.name,
      source: s.isBuiltIn ? 'builtin' : serverIds.has(s.id) ? 'server' : 'local',
      riskLevel: s.riskLevel ?? '',
      contentHash: hashSkillMd(s.skillPath),
    }));
    if (skills.length === 0) return;
    await fetch(`${ctx.baseUrl}/api/skills/report-installed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}` },
      body: JSON.stringify({
        userId: ctx.user?.id ?? null,
        username: ctx.user?.username ?? '',
        skills,
      }),
    });
  } catch (err) {
    console.warn('[gsSkillSync] 上报已安装 skill 失败:', (err as Error).message);
  }
}

const parseVersion = (v: string): number[] =>
  String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);

/** 语义化版本比较：a>b 返回 1，a<b 返回 -1，相等返回 0 */
function cmpVersion(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** 读本地 skill 的 version；目录不存在返回空串（表示需要下载） */
function readLocalVersion(skillDir: string): string {
  try {
    const raw = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const fm = /^---\s*([\s\S]*?)\s*---/.exec(raw);
    const body = fm ? fm[1] : raw;
    const m = /^version:\s*["']?(.+?)["']?\s*$/im.exec(body);
    return m ? m[1].trim() : '0.0.0';
  } catch {
    return '';
  }
}

let syncing = false;

export async function syncServerSkills(skillManager: SkillManagerLike): Promise<void> {
  const ctx = getGsAuthContext();
  if (!ctx.enabled || !ctx.token || !ctx.baseUrl || !ctx.isLoggedIn) return;
  if (syncing) return;
  syncing = true;
  try {
    const listRes = await fetch(`${ctx.baseUrl}/api/skills`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    });
    if (!listRes.ok) return;
    const body = (await listRes.json()) as { skills?: ServerSkill[] };
    const skills = Array.isArray(body.skills) ? body.skills : [];
    // 记录服务端下发清单：加载白名单据此区分"服务端 skill"和来路不明的野包
    try {
      skillManager.recordServerSkillIds(skills.map((s) => s.name).filter(Boolean));
    } catch (err) {
      console.warn('[gsSkillSync] 记录服务端 skill 清单失败:', (err as Error).message);
    }
    if (skills.length === 0) return;

    const root = skillManager.getSkillsRoot();
    fs.mkdirSync(root, { recursive: true });

    for (const s of skills) {
      if (!s?.name || s.enabled === 0) continue;
      const localVer = readLocalVersion(path.join(root, s.name));
      // 本地已存在且版本不低于服务端 → 跳过
      if (localVer && cmpVersion(s.version, localVer) <= 0) continue;

      try {
        const dlRes = await fetch(`${ctx.baseUrl}/api/skills/${encodeURIComponent(s.name)}/download`, {
          headers: { Authorization: `Bearer ${ctx.token}` },
        });
        if (!dlRes.ok) continue;
        const buf = Buffer.from(await dlRes.arrayBuffer());
        const tmpZip = path.join(os.tmpdir(), `gsskill-${s.name}-${process.pid}.zip`);
        fs.writeFileSync(tmpZip, buf);

        // 覆盖旧版：先删目录再解压（zip 内含 <name>/ 顶层目录）
        const dest = path.join(root, s.name);
        fs.rmSync(dest, { recursive: true, force: true });
        await extract(tmpZip, { dir: root });
        fs.rmSync(tmpZip, { force: true });

        skillManager.setSkillEnabled(s.name, true);
        console.log(`[gsSkillSync] 已更新 skill "${s.name}" -> ${s.version}`);
      } catch (err) {
        console.warn(`[gsSkillSync] 同步 skill "${s.name}" 失败:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.warn('[gsSkillSync] 拉取 skill 列表失败:', (err as Error).message);
  } finally {
    syncing = false;
    // 无论服务端有无上传 skill，都上报一次本机已安装列表（含内置 skill）
    await reportInstalledSkills(skillManager, { baseUrl: ctx.baseUrl, token: ctx.token, user: ctx.user });
  }
}
