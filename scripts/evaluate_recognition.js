import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, paths, nowIso } from '../src/db.js';

const db = openDatabase();
const documents = db.prepare('SELECT id, extracted_json, status FROM documents').all();
const documentTypes = {};
let relatedDocuments = 0;
let withEvidence = 0;
let importableDocuments = 0;
let riskyButRelated = 0;
for (const document of documents) {
  let parsed = {};
  try { parsed = JSON.parse(document.extracted_json || '{}'); } catch {}
  const type = parsed.fields?.document_type?.value || 'unknown';
  documentTypes[type] = (documentTypes[type] || 0) + 1;
  if (parsed.relevance?.isRelated) relatedDocuments += 1;
  if (parsed.relevance?.importable) importableDocuments += 1;
  if ((parsed.evidence || []).length) withEvidence += 1;
  if (parsed.relevance?.isRelated && ['news', 'interpretation', 'listing'].includes(type)) riskyButRelated += 1;
}

const policyRows = db.prepare(`
  SELECT p.id, p.status, p.verification_status, p.document_type, p.title, p.effective_from, p.effective_to,
    p.jurisdiction_name, p.jurisdiction_city, p.jurisdiction_district,
    r.category, r.rate, r.fixed_amount, r.cap_amount, r.rule_text,
    (SELECT COUNT(*) FROM evidence e WHERE e.policy_id = p.id) AS evidence_count
  FROM policies p LEFT JOIN subsidy_rules r ON r.policy_id = p.id
`).all();
const statuses = {};
const verification = {};
const policyTypes = {};
const activePolicyTypes = {};
const supersededPolicyTypes = {};
const missing = { evidence: 0, amountRule: 0, dates: 0, province: 0, category: 0, officialUrl: 0 };
let active = 0;
let superseded = 0;
let verified = 0;
let pending = 0;
for (const row of policyRows) {
  const type = row.document_type || 'unknown';
  statuses[row.status || 'unknown'] = (statuses[row.status || 'unknown'] || 0) + 1;
  verification[row.verification_status || 'pending'] = (verification[row.verification_status || 'pending'] || 0) + 1;
  policyTypes[type] = (policyTypes[type] || 0) + 1;
  if (row.status === 'active') {
    active += 1;
    activePolicyTypes[type] = (activePolicyTypes[type] || 0) + 1;
  }
  if (row.status === 'superseded') {
    superseded += 1;
    supersededPolicyTypes[type] = (supersededPolicyTypes[type] || 0) + 1;
  }
  if ((row.verification_status || 'pending') === 'verified') verified += 1;
  else pending += 1;
  if (!row.evidence_count) missing.evidence += 1;
  if (row.rate == null && row.fixed_amount == null && row.cap_amount == null && !row.rule_text) missing.amountRule += 1;
  if (!row.effective_from || !row.effective_to) missing.dates += 1;
  if (!row.jurisdiction_name) missing.province += 1;
  if (!row.category) missing.category += 1;
}
for (const row of db.prepare('SELECT source_url FROM policies').all()) {
  if (!row.source_url) missing.officialUrl += 1;
}

const report = {
  generatedAt: nowIso(),
  documents: {
    total: documents.length,
    related: relatedDocuments,
    importable: importableDocuments,
    withEvidence,
    evidenceCoverage: documents.length ? Number((withEvidence / documents.length).toFixed(4)) : 0,
    riskyButRelated,
    documentTypes,
  },
  policies: {
    total: policyRows.length,
    active,
    superseded,
    statuses,
    verification,
    verified,
    pending,
    policyTypes,
    activePolicyTypes,
    supersededPolicyTypes,
    missing,
  },
  notes: [
    'active 表示主表状态为 active 的政策，superseded 表示已被后续文件替代或不应再作为主记录展示。',
    'news/interpretation/listing 页面不计入可直接入库政策；如被识别为 related，会在 riskyButRelated 中单独统计。',
    'missing.amountRule 表示没有抽取到比例、固定金额、上限或规则文本。',
  ],
};
const output = join(paths.data, `recognition-report-${nowIso().slice(0, 10)}.json`);
writeFileSync(output, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ output, ...report }, null, 2));
db.close();
