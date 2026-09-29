import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDocument, nowIso, openDatabase, paths } from '../src/db.js';
import { createSession } from '../src/auth.js';
import { fetchAndStore } from '../src/collector.js';
import { importDocumentAsPolicy } from '../src/server.js';

const PROVINCES = process.argv.slice(2);
if (process.env.ALLOW_SEARCH_ENGINE_DISCOVERY !== '1') {
  console.error('此脚本会访问搜索引擎，仅限人工发现官网入口时使用。');
  console.error('如确认目标网站条款允许，先设置 ALLOW_SEARCH_ENGINE_DISCOVERY=1 再执行。');
  process.exit(1);
}
const ALL_PROVINCES = ['北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆'];
const targets = PROVINCES.length ? PROVINCES : ALL_PROVINCES;
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8787';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchBaidu(query) {
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
  const html = await response.text();
  return [...html.matchAll(/href="(https?:\/\/www\.baidu\.com\/link\?url=[^"]+)"/g)]
    .map((match) => match[1].replaceAll('&amp;', '&'))
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 8);
}

async function resolveBaiduLink(link) {
  const response = await fetch(link, { headers: { 'User-Agent': USER_AGENT }, redirect: 'manual' });
  const location = response.headers.get('location');
  if (!location) return null;
  try {
    const url = new URL(location);
    if (!url.hostname.endsWith('.gov.cn')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function main() {
  const db = openDatabase();
  const actor = db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get();
  if (!actor) throw new Error('没有可用用户，请先注册账号');
  const session = createSession(db, actor.id);
  const results = [];

  try {
    for (const province of targets) {
      process.stdout.write(`\n[${province}] 搜索...`);
      const query = `${province} 2026年消费品以旧换新实施细则 补贴 商务厅`;
      let links = [];
      try {
        links = await searchBaidu(query);
      } catch (error) {
        results.push({ province, status: 'search_failed', error: error.message });
        continue;
      }

      const officialUrls = [];
      for (const link of links) {
        try {
          const official = await resolveBaiduLink(link);
          if (official && !officialUrls.includes(official)) officialUrls.push(official);
        } catch {
          // skip failed redirect
        }
        if (officialUrls.length >= 3) break;
      }

      if (!officialUrls.length) {
        results.push({ province, status: 'no_official_url', links });
        console.log(' 未找到政府官网原文');
        continue;
      }

      const source = db.prepare('SELECT id FROM sources WHERE jurisdiction_name LIKE ? ORDER BY enabled DESC, created_at LIMIT 1').get(`%${province}%`);
      let imported = 0;
      let skipped = 0;
      for (const url of officialUrls) {
        try {
          const fetched = await fetchAndStore(db, url, {
            sourceId: source?.id || null,
            actorId: actor.id,
            title: `${province}国补政策`,
            parse: true,
          });
          const document = getDocument(db, fetched.documentId);
          const parsed = JSON.parse(document?.extracted_json || '{}');
          const relevance = parsed.relevance || {};
          const end = parsed.fields?.effective_to?.value;
          if (!relevance.isRelated || (end && end < new Date().toISOString().slice(0, 10))) {
            skipped += 1;
            results.push({ province, status: 'skipped', url, relevance, end });
            continue;
          }
          const importedResult = importDocumentAsPolicy(db, fetched.documentId, actor.id, {});
          if (!importedResult.duplicate) imported += 1;
          results.push({ province, status: importedResult.duplicate ? 'duplicate' : 'imported', url, documentId: fetched.documentId, policyId: importedResult.policyId });
        } catch (error) {
          results.push({ province, status: 'failed', url, error: error.message });
        }
        await delay(1500);
      }
      console.log(` 官网原文 ${officialUrls.length} 个，导入 ${imported} 条，跳过 ${skipped} 条`);
      await delay(1200);
    }
  } finally {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    const output = join(paths.data, `provincial-discovery-${nowIso().slice(0, 10)}.json`);
    writeFileSync(output, JSON.stringify({ generatedAt: nowIso(), targets, results }, null, 2), 'utf8');
    console.log(`\n发现结果已保存：${output}`);
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
