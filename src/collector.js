import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { newId, nowIso, getSource } from './db.js';
import { saveSnapshot } from './storage.js';
import { extractCandidateLinks, createDiscoveredDocuments, parseDocument } from './extract.js';

const hostLastFetch = new Map();

function ipv4ToInt(ip) {
  return ip.split('.').reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;
}

function isPrivateIpv4(ip) {
  const value = ipv4ToInt(ip);
  const checks = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  return checks.some(([network, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(network) & mask);
  });
}

function isPrivateIp(ip) {
  if (isIP(ip) === 4) return isPrivateIpv4(ip);
  const normalized = ip.toLowerCase();
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
}

export async function assertPublicUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许 http 或 https 地址');
  if (url.username || url.password) throw new Error('URL 不能包含用户名或密码');
  if (url.hostname === 'localhost') throw new Error('不允许访问本机地址');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length) throw new Error('域名无法解析');
  if (addresses.some((item) => isPrivateIp(item.address))) throw new Error('不允许访问内网或保留地址');
  return url;
}

export async function fetchWithLimit(rawUrl, options = {}) {
  const url = await assertPublicUrl(rawUrl);
  const minInterval = Math.max(1, Number(process.env.FETCH_MIN_INTERVAL_SECONDS || 5)) * 1000;
  const host = url.hostname.toLowerCase();
  const last = hostLastFetch.get(host) || 0;
  const wait = Math.max(0, minInterval - (Date.now() - last));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  hostLastFetch.set(host, Date.now());

  const timeoutMs = Math.max(5000, Number(process.env.FETCH_TIMEOUT_SECONDS || 25) * 1000);
  const maxBytes = Math.max(1024 * 1024, Number(process.env.MAX_DOWNLOAD_MB || 25) * 1024 * 1024);
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'GuobuHub/0.1 (+public-policy-collaboration; low-frequency)',
      'Accept': 'text/html,application/xhtml+xml,application/pdf,application/json,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`抓取失败：HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new Error(`文件超过限制（${process.env.MAX_DOWNLOAD_MB || 25} MB）`);

  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new Error(`文件超过限制（${process.env.MAX_DOWNLOAD_MB || 25} MB）`);
    chunks.push(Buffer.from(value));
  }
  const buffer = Buffer.concat(chunks, total);
  const mimeType = String(response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
  return { url: url.toString(), buffer, mimeType, finalUrl: response.url || url.toString() };
}

function insertDocument(db, payload) {
  const id = payload.id || newId();
  db.prepare(`
    INSERT INTO documents (
      id, source_id, contribution_id, url, canonical_url, title, mime_type, byte_size, content_hash,
      raw_path, status, fetched_by, fetched_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    payload.sourceId || null,
    payload.contributionId || null,
    payload.url || null,
    payload.canonicalUrl || payload.url || null,
    payload.title || null,
    payload.mimeType || null,
    payload.byteSize || null,
    payload.contentHash || null,
    payload.rawPath || null,
    payload.status || 'fetched',
    payload.fetchedBy || null,
    payload.fetchedAt || nowIso(),
    nowIso(),
  );
  return id;
}

export async function fetchAndStore(db, rawUrl, { sourceId = null, contributionId = null, actorId = null, title = null, parse = true } = {}) {
  const fetched = await fetchWithLimit(rawUrl);
  const snapshot = saveSnapshot(fetched.buffer, {
    mimeType: fetched.mimeType,
    originalName: new URL(fetched.finalUrl).pathname,
    url: fetched.finalUrl,
  });
  const duplicate = db.prepare('SELECT id FROM documents WHERE content_hash = ? LIMIT 1').get(snapshot.hash);
  if (duplicate) return { documentId: duplicate.id, duplicate: true, snapshot };
  const documentId = insertDocument(db, {
    sourceId,
    contributionId,
    url: fetched.url,
    canonicalUrl: fetched.finalUrl,
    title,
    mimeType: snapshot.mimeType,
    byteSize: snapshot.byteSize,
    contentHash: snapshot.hash,
    rawPath: snapshot.filePath,
    status: 'fetched',
    fetchedBy: actorId,
  });
  if (parse) {
    try {
      parseDocument(db, documentId, { allowOcr: true });
    } catch (error) {
      db.prepare('UPDATE documents SET status = ?, error = ? WHERE id = ?').run('failed', error.message, documentId);
    }
  }
  return { documentId, duplicate: false, snapshot };
}

export async function pollSource(db, sourceId, actorId = null) {
  const source = getSource(db, sourceId);
  if (!source) throw new Error('数据源不存在');
  if (!source.listing_url) throw new Error('该数据源没有配置栏目或 API 地址');
  if (!source.enabled) throw new Error('该数据源已停用');
  try {
    const result = await fetchAndStore(db, source.listing_url, {
      sourceId,
      actorId,
      title: source.name,
      parse: true,
    });
    const document = db.prepare('SELECT * FROM documents WHERE id = ?').get(result.documentId);
    let discovered = 0;
    if (document?.extracted_json) {
      try {
        const parsed = JSON.parse(document.extracted_json);
        const candidates = extractCandidateLinks(parsed, source.listing_url);
        discovered = createDiscoveredDocuments(db, sourceId, null, candidates);
      } catch {
        discovered = 0;
      }
    }
    const timestamp = nowIso();
    const next = nextFetchDate(source);
    db.prepare(`
      UPDATE sources SET last_fetched_at = ?, next_fetch_at = ?, last_run_status = 'success', last_error = NULL, updated_at = ? WHERE id = ?
    `).run(timestamp, next, timestamp, sourceId);
    return { documentId: result.documentId, duplicate: result.duplicate, discovered, nextFetchAt: next };
  } catch (error) {
    const timestamp = nowIso();
    const next = nextFetchDate(source);
    db.prepare(`
      UPDATE sources SET next_fetch_at = ?, last_run_status = 'failed', last_error = ?, updated_at = ? WHERE id = ?
    `).run(next, error.message, timestamp, sourceId);
    throw error;
  }
}

export function nextFetchDate(sourceOrFrequency) {
  const source = typeof sourceOrFrequency === 'object' ? sourceOrFrequency : null;
  const frequency = source ? source.frequency : sourceOrFrequency;
  const intervalMs = source?.interval_minutes
    ? Number(source.interval_minutes) * 60_000
    : {
    daily: 86400_000,
    weekly: 7 * 86400_000,
    monthly: 30 * 86400_000,
  }[frequency] || 7 * 86400_000;
  return new Date(Date.now() + intervalMs).toISOString();
}

export async function runDueCollections(db, limit = 3) {
  const due = db.prepare(`
    SELECT * FROM sources
    WHERE enabled = 1
      AND access_method = 'scheduled'
      AND frequency <> 'manual'
      AND listing_url IS NOT NULL
      AND (next_fetch_at IS NULL OR next_fetch_at <= ?)
    ORDER BY COALESCE(next_fetch_at, created_at) ASC
    LIMIT ?
  `).all(nowIso(), limit);
  const results = [];
  for (const source of due) {
    try {
      results.push({ sourceId: source.id, ok: true, result: await pollSource(db, source.id, null) });
    } catch (error) {
      const timestamp = nowIso();
      db.prepare('UPDATE sources SET next_fetch_at = ?, last_run_status = ?, last_error = ?, updated_at = ? WHERE id = ?')
        .run(nextFetchDate(source), 'failed', error.message, timestamp, source.id);
      results.push({ sourceId: source.id, ok: false, error: error.message });
    }
  }
  return results;
}
