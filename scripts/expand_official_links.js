import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument, nowIso, openDatabase, paths } from '../src/db.js';
import { fetchAndStore } from '../src/collector.js';
import { importDocumentAsPolicy } from '../src/server.js';

const KEYWORDS = ['以旧换新', '补贴', '实施细则', '政策', '通知', '公告', '汽车', '家电', '数码', '农机', '电动自行车', '家装', '购新'];
const MAX_CANDIDATES = Number(process.env.MAX_EXPANSION_CANDIDATES || 80);
const MAX_PER_DOCUMENT = Number(process.env.MAX_EXPANSION_PER_DOCUMENT || 3);
const DELAY_MS = Number(process.env.EXPANSION_DELAY_MS || 1500);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOfficial(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith('.gov.cn');
  } catch {
    return false;
  }
}

function candidateScore(link) {
  const text = String(link.text || '');
  return KEYWORDS.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);
}

function isPolicyCandidate(link) {
  const text = String(link.text || '');
  if (/以旧换新|消费品以旧换新|国补|购新/.test(text)) return true;
  return /(汽车|家电|数码|手机|平板|农机|电动自行车|家装|厨卫)/.test(text) && /补贴|实施方案|实施细则|政策/.test(text);
}

async function main() {
  const db = openDatabase();
  const actor = db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get();
  if (!actor) throw new Error('没有可用用户，请先注册账号');

  const documents = db.prepare(`
    SELECT * FROM documents
    WHERE extracted_json IS NOT NULL AND COALESCE(canonical_url, url) IS NOT NULL
    ORDER BY created_at DESC
  `).all();
  const known = new Set(db.prepare('SELECT COALESCE(canonical_url, url) AS url FROM documents WHERE COALESCE(canonical_url, url) IS NOT NULL').all().map((row) => row.url));
  const candidates = new Map();

  for (const document of documents) {
    let parsed;
    try { parsed = JSON.parse(document.extracted_json || '{}'); } catch { continue; }
    const links = Array.isArray(parsed.links) ? parsed.links : [];
    const baseUrl = document.canonical_url || document.url;
    let addedForDocument = 0;
    for (const link of links.sort((a, b) => candidateScore(b) - candidateScore(a))) {
      if (addedForDocument >= MAX_PER_DOCUMENT) break;
      if (!isPolicyCandidate(link)) continue;
      let url;
      try { url = new URL(link.href, baseUrl).toString(); } catch { continue; }
      if (!isOfficial(url) || known.has(url) || candidates.has(url)) continue;
      candidates.set(url, { url, sourceId: document.source_id, seedTitle: document.title, linkText: link.text || '' });
      addedForDocument += 1;
    }
  }

  const selected = [...candidates.values()].slice(0, MAX_CANDIDATES);
  const results = [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of selected) {
    process.stdout.write(`[${results.length + 1}/${selected.length}] ${candidate.linkText || candidate.url} ... `);
    try {
      const fetched = await fetchAndStore(db, candidate.url, {
        sourceId: candidate.sourceId || null,
        actorId: actor.id,
        title: candidate.linkText || '官方政策页面',
        parse: true,
      });
      const document = getDocument(db, fetched.documentId);
      const parsed = JSON.parse(document?.extracted_json || '{}');
      const relevance = parsed.relevance || {};
      const end = parsed.fields?.effective_to?.value;
      if (!relevance.isRelated || (end && end < new Date().toISOString().slice(0, 10))) {
        skipped += 1;
        results.push({ status: 'skipped', url: candidate.url, relevance, end });
        console.log('跳过');
      } else {
        const importedResult = importDocumentAsPolicy(db, fetched.documentId, actor.id, {});
        if (importedResult.duplicate) {
          results.push({ status: 'duplicate', url: candidate.url, policyId: importedResult.policyId });
          console.log('重复');
        } else {
          imported += 1;
          results.push({ status: 'imported', url: candidate.url, policyId: importedResult.policyId });
          console.log('已导入');
        }
      }
    } catch (error) {
      failed += 1;
      results.push({ status: 'failed', url: candidate.url, error: error.message });
      console.log(`失败：${error.message}`);
    }
    await delay(DELAY_MS);
  }

  const output = join(paths.data, `official-link-expansion-${nowIso().slice(0, 10)}.json`);
  writeFileSync(output, JSON.stringify({ generatedAt: nowIso(), candidates: selected.length, imported, skipped, failed, results }, null, 2), 'utf8');
  console.log(JSON.stringify({ candidates: selected.length, imported, skipped, failed, output }, null, 2));
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
