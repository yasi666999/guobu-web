import { openDatabase, nowIso } from '../src/db.js';
import { analyzeGuobuRelevance } from '../src/extract.js';
import { inferGeo } from '../src/geo.js';
import { computeDedupKey } from '../src/validation.js';

function classifyDocument(title, text = '') {
  const name = String(title || '').trim();
  if (/(新闻|发布会|吹风会|活动举行|视频解读|图解|一图读懂)/.test(name)) return 'news';
  if (/(政策解读|解读|问答|答记者问)/.test(name)) return 'interpretation';
  if (/(实施细则|实施方案|工作方案|管理办法)/.test(name)) return 'implementation';
  if (/(通知|公告|政策|办法|补贴标准)/.test(name)) return 'policy';
  if (/(栏目|专题|首页|政策文件|通知公告)\s*$/.test(name)) return 'listing';
  return 'unknown';
}

function valueOf(parsed, name) {
  const value = parsed?.fields?.[name];
  return value && typeof value === 'object' && 'value' in value ? value.value : value;
}

const db = openDatabase();
let documentsUpdated = 0;
const documents = db.prepare('SELECT id, extracted_json FROM documents WHERE extracted_json IS NOT NULL').all();
for (const document of documents) {
  let parsed;
  try { parsed = JSON.parse(document.extracted_json); } catch { continue; }
  const title = valueOf(parsed, 'title') || '';
  const type = valueOf(parsed, 'document_type') || classifyDocument(title, parsed.text || '');
  parsed.fields = parsed.fields || {};
  parsed.fields.document_type = { value: type, confidence: 0.85, quote: title };
  parsed.relevance = analyzeGuobuRelevance(parsed);
  db.prepare('UPDATE documents SET extracted_json = ? WHERE id = ?').run(JSON.stringify(parsed), document.id);
  documentsUpdated += 1;
}

let policiesUpdated = 0;
let contributionsUpdated = 0;
let rulesUpdated = 0;
const policies = db.prepare(`
  SELECT p.*, c.extracted_json AS contribution_extracted_json
  FROM policies p LEFT JOIN contributions c ON c.id = p.contribution_id
`).all();
for (const policy of policies) {
  let parsed = {};
  try { parsed = JSON.parse(policy.contribution_extracted_json || '{}'); } catch {}
  const documentType = valueOf(parsed, 'document_type') || policy.document_type || classifyDocument(policy.title, policy.description || '');
  const geo = inferGeo({
    jurisdictionName: policy.jurisdiction_name || valueOf(parsed, 'jurisdiction_name'),
    city: policy.jurisdiction_city || valueOf(parsed, 'jurisdiction_city'),
    district: policy.jurisdiction_district || valueOf(parsed, 'jurisdiction_district'),
    title: policy.title,
    sourceUrl: policy.source_url,
  });
  const timestamp = nowIso();
  db.prepare(`
    UPDATE policies SET document_type = ?, verification_status = COALESCE(NULLIF(verification_status, ''), 'pending'),
      jurisdiction_name = COALESCE(NULLIF(?, ''), jurisdiction_name),
      jurisdiction_city = ?, jurisdiction_district = ?, updated_at = ? WHERE id = ?
  `).run(documentType, geo.province, geo.city || null, geo.district || null, timestamp, policy.id);
  policiesUpdated += 1;

  if (policy.contribution_id) {
    const dedupKey = computeDedupKey({
      title: policy.title, issuer: policy.issuer, docNo: valueOf(parsed, 'doc_no'),
      effectiveFrom: policy.effective_from, jurisdictionName: geo.province || policy.jurisdiction_name,
    });
    db.prepare(`UPDATE contributions SET jurisdiction_name = COALESCE(NULLIF(?, ''), jurisdiction_name), dedup_key = ?, updated_at = ? WHERE id = ?`)
      .run(geo.province, dedupKey || null, timestamp, policy.contribution_id);
    contributionsUpdated += 1;
  }

  const rule = db.prepare('SELECT * FROM subsidy_rules WHERE policy_id = ?').get(policy.id);
  if (!rule) continue;
  let ruleType = valueOf(parsed, 'rule_type') || rule.rule_type || 'unknown';
  let thresholdAmount = valueOf(parsed, 'threshold_amount') ?? rule.threshold_amount ?? null;
  let discountAmount = valueOf(parsed, 'discount_amount') ?? rule.discount_amount ?? null;
  const ruleText = valueOf(parsed, 'rule_text') || rule.rule_text || '';
  if (ruleText && /满\s*\d+.*减\s*\d+/.test(ruleText)) {
    ruleType = 'full_reduction';
    thresholdAmount = Number(ruleText.match(/满\s*(\d+(?:\.\d+)?)/)?.[1] || thresholdAmount || 0) || null;
    discountAmount = Number(ruleText.match(/减\s*(\d+(?:\.\d+)?)/)?.[1] || discountAmount || 0) || null;
  } else if (valueOf(parsed, 'rate') != null || rule.rate != null) ruleType = 'percentage';
  else if (valueOf(parsed, 'amount_value') != null || rule.fixed_amount != null) ruleType = 'fixed';
  const conditionsText = valueOf(parsed, 'conditions_text') || policy.description || rule.conditions_text || '';
  const perUserLimit = valueOf(parsed, 'per_user_limit') ?? rule.per_user_limit ?? null;
  const stackable = valueOf(parsed, 'stackable') ?? rule.stackable ?? null;
  db.prepare(`
    UPDATE subsidy_rules SET rule_type = ?, threshold_amount = ?, discount_amount = ?, per_user_limit = ?, stackable = ?, conditions_text = ?
    WHERE id = ?
  `).run(ruleType, thresholdAmount, discountAmount, perUserLimit, stackable, conditionsText, rule.id);
  rulesUpdated += 1;
}

console.log(JSON.stringify({ documentsUpdated, policiesUpdated, contributionsUpdated, rulesUpdated }, null, 2));
db.close();
