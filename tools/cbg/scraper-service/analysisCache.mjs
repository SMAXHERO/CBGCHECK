/**
 * analysisCache.mjs — 模块二「账号评分」结果的落盘缓存（A5）。
 *
 * 为什么需要：
 *   一次完整分析 = 1 次详情（约 2.6MB）+ 1 次方案清单 + 每个方案最多 2 次算分。
 *   反复点「重新分析」既慢，又容易把藏宝阁的接口打出风控（CAPTCHA_AUTH / SESSION_TIMEOUT）。
 *   把结果按 eid 落盘缓存一小段时间，页面重新打开/刷新时可以直接秒回；
 *   需要新数据时显式传 `refresh=1` 绕过缓存。
 *
 * 位置：<仓库根>/cache/analysis/<eid>.json（已加入 .gitignore，不提交）。
 * TTL ：默认 10 分钟，可用 `--analysis-ttl <ms>` 或环境变量 `CBG_ANALYSIS_TTL_MS` 覆盖。
 *
 * 设计约定：
 *   - 缓存写失败（磁盘只读等）不影响分析结果，只记日志由调用方决定；
 *   - 读取时校验 version，结构升级后旧缓存自动失效；
 *   - 写文件用「临时文件 + rename」，避免进程中断留下半截 JSON。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 当前缓存结构版本；字段结构变化时 +1，旧缓存自动作废 */
export const CACHE_VERSION = 1;

/** 默认缓存有效期：10 分钟 */
export const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** 缓存目录：仓库根 /cache/analysis */
export const CACHE_DIR = path.resolve(__dirname, '../../../cache/analysis');

/** eid 只保留安全字符，避免路径穿越 */
const cacheKey = (eid) => String(eid || '').replace(/[^0-9A-Za-z-]/g, '_');

const cacheFile = (eid) => path.join(CACHE_DIR, `${cacheKey(eid)}.json`);

/**
 * 读取缓存。
 * @returns {{ data: object, generatedAt: string, ageMs: number } | null}
 *          未命中 / 过期 / 结构版本不符 都返回 null。
 */
export function readAnalysisCache(eid, { ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!eid) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(eid), 'utf8'));
    if (!raw || raw.version !== CACHE_VERSION || !raw.data || !raw.generatedAt) return null;
    const generatedMs = Date.parse(raw.generatedAt);
    const ageMs = Date.now() - generatedMs;
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > ttlMs) return null;
    return { data: raw.data, generatedAt: raw.generatedAt, ageMs };
  } catch {
    return null;
  }
}

/**
 * 写入缓存。失败时返回 null（不抛错，不影响本次分析结果）。
 * @returns {{ file: string, generatedAt: string } | null}
 */
export function writeAnalysisCache(eid, data) {
  if (!eid || !data) return null;
  const generatedAt = new Date().toISOString();
  const file = cacheFile(eid);
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, eid, generatedAt, data }), 'utf8');
    fs.renameSync(tmp, file);
    return { file, generatedAt };
  } catch {
    try {
      fs.rmSync(`${file}.${process.pid}.tmp`, { force: true });
    } catch {}
    return null;
  }
}

/** 删除某个账号的缓存（测试/手动清理用） */
export function clearAnalysisCache(eid) {
  try {
    fs.rmSync(cacheFile(eid), { force: true });
    return true;
  } catch {
    return false;
  }
}
