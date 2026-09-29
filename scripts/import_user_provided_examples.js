import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, nowIso, openDatabase, paths } from '../src/db.js';
import { computeDedupKey } from '../src/validation.js';

const inputPath = process.argv[2] || 'C:\\Users\\Lenovo\\.codex\\attachments\\ef3fd51d-68fd-4d57-bbfc-83caa9fed4f5\\已粘贴的文本.txt';
const raw = readFileSync(inputPath, 'utf8').replace(/\r/g, '').replace(/(\d{4}-\d{2})ID/g, '$1\nID');
const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
const secondHeader = lines.findIndex((line, index) => index > 0 && line === 'ID');
if (secondHeader === -1) throw new Error('未找到第二组表头');

function chunks(items, size) {
  const result = [];
  for (let index = 0; index + size <= items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function normalizeProvince(value) {
  const map = {
    '上海市': '上海市', '上海市': '上海市', '重庆市': '重庆市', '北京市': '北京市', '天津市': '天津市',
    '广西壮族自治区': '广西壮族自治区', '宁夏回族自治区': '宁夏回族自治区', '内蒙古自治区': '内蒙古自治区',
    '新疆维吾尔自治区': '新疆维吾尔自治区', '西藏自治区': '西藏自治区', '全国试点省份': '全国',
  };
  return map[value] || value;
}

function parseCap(value) {
  const match = String(value).match(/(\d+(?:\.\d+)?)/);
  return {
    capAmount: match ? Number(match[1]) : null,
    capUnit: /元\s*\/\s*单/.test(value) ? '元/单' : '元/件',
  };
}

function parseRate(value) {
  const matches = [...String(value).matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1]));
  return matches.length ? Math.max(...matches) : null;
}

function parseEffectiveFrom(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}$/.test(text) ? `${text}-01` : text;
}

function parseEffectiveTo(value) {
  const text = String(value || '');
  const date = text.match(/20\d{2}-\d{2}-\d{2}/)?.[0] || null;
  return { effectiveTo: date, endNote: text.includes('额度用完') ? (text.includes('提前') ? '额度用完提前截止' : '额度用完截止') : '' };
}

function cleanOfficialFile(value) {
  const text = String(value || '').replace(/有{3,}/g, '');
  if (text.includes('宝山区商务') && text.includes('云闪付公告')) return '宝山区商务委云闪付公告';
  return text;
}

function recordFromRow(values, type, externalId) {
  const isDistrict = type === 'district';
  const [id, title, fundingSource, category, province, city, districtOrRule, maybeRule, maybeCap, maybeStart, maybeEnd, maybeOfficial] = values;
  const district = isDistrict ? districtOrRule : '';
  const ruleText = isDistrict ? maybeRule : districtOrRule;
  const capText = isDistrict ? maybeCap : maybeRule;
  const start = isDistrict ? maybeStart : maybeCap;
  const end = isDistrict ? maybeEnd : maybeStart;
  const official = isDistrict ? maybeOfficial : maybeEnd;
  const parsedEnd = parseEffectiveTo(end);
  const officialFile = cleanOfficialFile(official);
  const cap = parseCap(capText);
  const normalizedProvince = normalizeProvince(province);
  const normalizedCity = city === '试点城市' ? city : (/[省市自治区]$/.test(city) && /(省|自治区)$/.test(city) ? '' : city);
  return {
    externalId: externalId || id,
    title,
    fundingSource,
    category,
    province: normalizedProvince,
    city: normalizedCity,
    district,
    ruleText,
    rate: parseRate(ruleText),
    capAmount: cap.capAmount,
    capUnit: cap.capUnit,
    effectiveFrom: parseEffectiveFrom(start),
    effectiveTo: parsedEnd.effectiveTo,
    endNote: parsedEnd.endNote,
    officialFileName: officialFile,
    docNo: /〔|\[|号\s*$/.test(officialFile) ? officialFile : '',
    notes: '用户提供示例数据，待官方原文核验',
  };
}

const districtRows = chunks(lines.slice(12, secondHeader), 12).map((values) => recordFromRow(values, 'district'));
const generalRows = chunks(lines.slice(secondHeader + 11), 11).map((values) => recordFromRow(values, 'general'));
const records = [...districtRows, ...generalRows];
if (!records.some((record) => record.externalId === 'Q10')) {
  records.splice(districtRows.length, 0, {
    externalId: 'Q10',
    title: '江苏苏州市工业园区家电换新券',
    fundingSource: '区级财政',
    category: '家电、数码',
    province: '江苏省',
    city: '苏州市',
    district: '工业园区',
    ruleText: '满 2000 减 300',
    rate: null,
    capAmount: 300,
    capUnit: '元/单',
    effectiveFrom: '2026-03-01',
    effectiveTo: null,
    endNote: '额度用完截止',
    officialFileName: '园区经发局公告',
    docNo: '',
    notes: '用户提供示例数据，待官方原文核验',
  });
}

const pack = {
  packId: 'user-provided-2026-examples',
  version: '1.0.0',
  sourceName: '用户提供示例数据（待核验）',
  generatedAt: nowIso(),
  records,
};
const packPath = join(paths.root, 'data-packs', 'user-provided-2026-examples.json');
writeFileSync(packPath, JSON.stringify(pack, null, 2), 'utf8');

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ packPath, parsed: records.length, sample: records.slice(0, 5) }, null, 2));
  process.exit(0);
}

const db = openDatabase();
const actor = db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get();
if (!actor) throw new Error('没有可用用户，请先注册账号');
let source = db.prepare('SELECT id FROM sources WHERE name = ?').get(pack.sourceName);
if (!source) {
  const timestamp = nowIso();
  const sourceId = newId();
  db.prepare(`
    INSERT INTO sources (id, name, level, jurisdiction_name, source_type, access_method, frequency, enabled, compliance_note, created_by, created_at, updated_at)
    VALUES (?, ?, 'other', '多地区', 'manual_upload', 'manual', 'manual', 0, ?, ?, ?, ?)
  `).run(sourceId, pack.sourceName, '用户提供示例文本，未附官方链接，使用前需核验。', actor.id, timestamp, timestamp);
  source = { id: sourceId };
}

const specialExisting = {
  '1': '2026年家电以旧换新补贴',
  '2': '2026年数码和智能产品购新补贴',
  '3': '上海市消费品以旧换新自主品类补贴（智能家居）',
};

let imported = 0;
let updated = 0;
let skipped = 0;
for (const record of records) {
  if (specialExisting[record.externalId]) {
    const existing = db.prepare('SELECT id FROM policies WHERE title = ? LIMIT 1').get(specialExisting[record.externalId]);
    if (existing) {
      db.prepare(`
        UPDATE policies SET funding_source = ?, description = ?, end_note = ?, updated_at = ?
        WHERE id = ?
      `).run(record.fundingSource, record.category, record.endNote, nowIso(), existing.id);
      db.prepare(`UPDATE subsidy_rules SET rule_text = ?, cap_unit = ? WHERE policy_id = ?`)
        .run(record.ruleText, record.capUnit, existing.id);
      updated += 1;
      continue;
    }
  }
  const dedupKey = computeDedupKey({ title: record.title, issuer: pack.sourceName, effectiveFrom: record.effectiveFrom, jurisdictionName: record.province });
  if (db.prepare('SELECT id FROM contributions WHERE dedup_key = ? LIMIT 1').get(dedupKey)) {
    skipped += 1;
    continue;
  }

  const timestamp = nowIso();
  const contributionId = newId();
  const policyId = newId();
  const policyLevel = record.province === '全国' ? 'national' : record.district ? 'district' : record.city && record.city !== record.province ? 'city' : 'province';
  const amountType = /满\s*\d+.*减\s*\d+/.test(record.ruleText) ? 'tiered' : record.rate != null ? 'percent' : 'unknown';
  const documentType = record.district || /满\s*\d+.*减\s*\d+/.test(record.ruleText) ? 'notice' : 'policy';
  const validation = { errors: [], warnings: ['用户提供示例数据，未附官方链接，使用前需核验。'], userProvided: true };

  db.prepare(`
    INSERT INTO contributions (
      id, user_id, status, title, program, policy_level, issuer, jurisdiction_name, category,
      amount_type, rate, cap_amount, effective_from, effective_to, source_url, notes,
      extracted_json, validation_json, dedup_key, reviewer_id, reviewed_at, created_at, updated_at
    ) VALUES (?, ?, 'approved', ?, '消费品以旧换新', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    contributionId, actor.id, record.title, policyLevel, pack.sourceName, record.province,
    record.category, amountType, record.rate, record.capAmount, record.effectiveFrom,
    record.effectiveTo, record.notes, JSON.stringify(record), JSON.stringify(validation),
    dedupKey, actor.id, timestamp, timestamp, timestamp,
  );
  db.prepare(`
    INSERT INTO policies (
      id, contribution_id, title, official_file_name, doc_no, program, policy_level, issuer,
      funding_source, description, end_note, document_type, jurisdiction_name, jurisdiction_city, jurisdiction_district,
      status, effective_from, effective_to, source_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, '消费品以旧换新', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?, ?)
  `).run(
    policyId, contributionId, record.title, record.officialFileName, record.docNo, policyLevel,
    pack.sourceName, record.fundingSource, record.category, record.endNote, documentType, record.province,
    record.city, record.district, record.effectiveFrom, record.effectiveTo, timestamp, timestamp,
  );
  db.prepare(`
    INSERT INTO subsidy_rules (id, policy_id, category, amount_type, rate, fixed_amount, cap_amount, cap_unit, rule_text, conditions_json, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
  `).run(newId(), policyId, record.category, amountType, record.rate, record.capAmount, record.capUnit, record.ruleText, JSON.stringify({ userProvided: true }), timestamp);
  db.prepare(`
    INSERT INTO evidence (id, policy_id, document_id, field_name, quote, page_number, confidence, created_at)
    VALUES (?, ?, NULL, 'user_provided', ?, NULL, NULL, ?)
  `).run(newId(), policyId, '用户提供示例数据，待官方原文核验', timestamp);
  imported += 1;
}

console.log(JSON.stringify({ packPath, parsed: records.length, imported, updated, skipped }, null, 2));
db.close();
