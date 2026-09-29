import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { newId, nowIso, openDatabase } from '../src/db.js';
import { computeDedupKey } from '../src/validation.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const packArg = args.find((arg) => !arg.startsWith('--')) || 'data-packs/consumer-tradein-2025-2026';
const packPath = isAbsolute(packArg) ? packArg : resolve(process.cwd(), packArg);

const VALID_LEVELS = new Set(['national', 'province', 'city', 'district', 'other']);
const VALID_AMOUNT_TYPES = new Set(['percent', 'fixed', 'tiered', 'other', 'unknown']);
const VALID_METRICS = new Set(['allocated_funds', 'disbursed_funds', 'driven_sales', 'beneficiary_count', 'other']);

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} 读取失败：${error.message}`);
  }
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function isOfficialUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'gov.cn' || host.endsWith('.gov.cn');
  } catch {
    return false;
  }
}

function validateManifest(manifest) {
  const errors = [];
  assert(manifest && typeof manifest === 'object', 'manifest 必须是对象', errors);
  assert(manifest.packId, 'manifest.packId 必填', errors);
  assert(manifest.version, 'manifest.version 必填', errors);
  assert(manifest.files?.sources, 'manifest.files.sources 必填', errors);
  assert(manifest.files?.policies, 'manifest.files.policies 必填', errors);
  assert(manifest.files?.aggregates, 'manifest.files.aggregates 必填', errors);
  return errors;
}

function validatePolicies(policies) {
  const errors = [];
  assert(Array.isArray(policies), 'policies 必须是数组', errors);
  for (const [index, item] of (policies || []).entries()) {
    const prefix = `policies[${index}]`;
    assert(item.externalId, `${prefix}.externalId 必填`, errors);
    assert(item.title, `${prefix}.title 必填`, errors);
    assert(item.program, `${prefix}.program 必填`, errors);
    assert(VALID_LEVELS.has(item.level), `${prefix}.level 不合法`, errors);
    assert(item.issuer, `${prefix}.issuer 必填`, errors);
    assert(item.jurisdictionName, `${prefix}.jurisdictionName 必填`, errors);
    assert(item.category, `${prefix}.category 必填`, errors);
    assert(VALID_AMOUNT_TYPES.has(item.amountType), `${prefix}.amountType 不合法`, errors);
    assert(isOfficialUrl(item.sourceUrl), `${prefix}.sourceUrl 必须是政府官网地址`, errors);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(item.effectiveFrom || ''), `${prefix}.effectiveFrom 格式错误`, errors);
    if (item.effectiveTo) assert(/^\d{4}-\d{2}-\d{2}$/.test(item.effectiveTo), `${prefix}.effectiveTo 格式错误`, errors);
    if (item.rate != null) assert(Number.isFinite(Number(item.rate)) && Number(item.rate) >= 0 && Number(item.rate) <= 100, `${prefix}.rate 必须在 0-100`, errors);
    if (item.capAmount != null) assert(Number.isFinite(Number(item.capAmount)) && Number(item.capAmount) >= 0, `${prefix}.capAmount 必须是非负数`, errors);
    assert(Array.isArray(item.evidence) && item.evidence.length > 0, `${prefix}.evidence 至少需要一条引文`, errors);
    for (const [evidenceIndex, evidence] of (item.evidence || []).entries()) {
      assert(evidence.fieldName, `${prefix}.evidence[${evidenceIndex}].fieldName 必填`, errors);
      assert(evidence.quote, `${prefix}.evidence[${evidenceIndex}].quote 必填`, errors);
    }
  }
  return errors;
}

function validateSources(sources) {
  const errors = [];
  assert(Array.isArray(sources), 'sources 必须是数组', errors);
  for (const [index, item] of (sources || []).entries()) {
    assert(item.name, `sources[${index}].name 必填`, errors);
    assert(VALID_LEVELS.has(item.level), `sources[${index}].level 不合法`, errors);
    if (item.baseUrl) assert(isOfficialUrl(item.baseUrl), `sources[${index}].baseUrl 必须是政府官网地址`, errors);
  }
  return errors;
}

function validateAggregates(aggregates) {
  const errors = [];
  assert(Array.isArray(aggregates), 'aggregates 必须是数组', errors);
  for (const [index, item] of (aggregates || []).entries()) {
    assert(item.jurisdictionName, `aggregates[${index}].jurisdictionName 必填`, errors);
    assert(VALID_METRICS.has(item.metricType), `aggregates[${index}].metricType 不合法`, errors);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(item.asOfDate || ''), `aggregates[${index}].asOfDate 格式错误`, errors);
    assert(isOfficialUrl(item.sourceUrl), `aggregates[${index}].sourceUrl 必须是政府官网地址`, errors);
    if (item.amountYuan != null) assert(Number.isFinite(Number(item.amountYuan)) && Number(item.amountYuan) >= 0, `aggregates[${index}].amountYuan 必须是非负数`, errors);
    if (item.countValue != null) assert(Number.isFinite(Number(item.countValue)) && Number(item.countValue) >= 0, `aggregates[${index}].countValue 必须是非负数`, errors);
  }
  return errors;
}

function dbValue(value) {
  return value == null || value === '' ? null : value;
}

function importSources(db, sources, summary) {
  const exists = db.prepare('SELECT id FROM sources WHERE name = ? LIMIT 1');
  const insert = db.prepare(`
    INSERT INTO sources (
      id, name, level, jurisdiction_name, base_url, source_type, access_method, frequency,
      enabled, compliance_note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `);
  for (const source of sources) {
    if (exists.get(source.name)) continue;
    if (dryRun) { summary.sources += 1; continue; }
    const timestamp = nowIso();
    insert.run(
      newId(), source.name, source.level, source.jurisdictionName, source.baseUrl,
      source.sourceType || 'html_listing', source.accessMethod || 'manual', source.frequency || 'weekly',
      source.complianceNote || null, timestamp, timestamp,
    );
    summary.sources += 1;
  }
}

function importPolicies(db, policies, summary) {
  const findContribution = db.prepare('SELECT id FROM contributions WHERE dedup_key = ? LIMIT 1');
  const insertContribution = db.prepare(`
    INSERT INTO contributions (
      id, user_id, status, title, program, policy_level, issuer, jurisdiction_name, category,
      amount_type, amount_value, rate, cap_amount, effective_from, effective_to, source_url,
      notes, validation_json, dedup_key, reviewer_id, reviewed_at, created_at, updated_at
    ) VALUES (?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPolicy = db.prepare(`
    INSERT INTO policies (
      id, contribution_id, title, program, policy_level, issuer, funding_source, jurisdiction_name,
      status, effective_from, effective_to, source_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRule = db.prepare(`
    INSERT INTO subsidy_rules (id, policy_id, category, amount_type, rate, fixed_amount, cap_amount, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEvidence = db.prepare(`
    INSERT INTO evidence (id, policy_id, field_name, quote, confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1").get();
  if (!admin) throw new Error('数据库中还没有管理员账号，请先注册管理员。');

  for (const policy of policies) {
    const dedupKey = computeDedupKey({
      title: policy.title,
      issuer: policy.issuer,
      effectiveFrom: policy.effectiveFrom,
      jurisdictionName: policy.jurisdictionName,
    });
    if (findContribution.get(dedupKey)) continue;
    summary.policies += 1;
    if (dryRun) continue;

    const timestamp = nowIso();
    const contributionId = newId();
    const policyId = newId();
    const validation = {
      errors: [],
      warnings: ['由独立数据包导入；已校验来源域名、金额、日期和原文引文。'],
      packExternalId: policy.externalId,
    };
    const status = policy.effectiveTo && policy.effectiveTo < timestamp.slice(0, 10) ? 'expired' : 'active';
    insertContribution.run(
      contributionId, admin.id, policy.title, policy.program, policy.level, policy.issuer,
      policy.jurisdictionName, policy.category, policy.amountType, policy.amountValue ?? null,
      policy.rate ?? null, policy.capAmount ?? null, policy.effectiveFrom, policy.effectiveTo || null,
      policy.sourceUrl, policy.notes || null, JSON.stringify(validation), dedupKey, admin.id, timestamp,
      timestamp, timestamp,
    );
    insertPolicy.run(
      policyId, contributionId, policy.title, policy.program, policy.level, policy.issuer,
      policy.fundingSource || null, policy.jurisdictionName, status, policy.effectiveFrom, policy.effectiveTo || null,
      policy.sourceUrl, timestamp, timestamp,
    );
    insertRule.run(
      newId(), policyId, policy.category, policy.amountType, policy.rate ?? null,
      policy.amountValue ?? null, policy.capAmount ?? null, timestamp,
    );
    for (const evidence of policy.evidence) {
      insertEvidence.run(
        newId(), policyId, evidence.fieldName, evidence.quote,
        evidence.confidence ?? null, timestamp,
      );
    }
  }
}

function importAggregates(db, aggregates, summary) {
  const find = db.prepare(`
    SELECT id FROM disbursement_aggregates
    WHERE metric_type = ? AND as_of_date = ? AND source_url = ? AND jurisdiction_name = ?
    LIMIT 1
  `);
  const insert = db.prepare(`
    INSERT INTO disbursement_aggregates (
      id, jurisdiction_name, program, metric_type, amount_yuan, count_value, unit,
      as_of_date, source_url, quote, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const aggregate of aggregates) {
    if (find.get(aggregate.metricType, aggregate.asOfDate, aggregate.sourceUrl, aggregate.jurisdictionName)) continue;
    summary.aggregates += 1;
    if (dryRun) continue;
    insert.run(
      newId(), aggregate.jurisdictionName, aggregate.program || null, aggregate.metricType,
      aggregate.amountYuan ?? null, aggregate.countValue ?? null, aggregate.unit || null,
      aggregate.asOfDate, aggregate.sourceUrl, aggregate.quote || null, nowIso(),
    );
  }
}

const manifest = readJson(join(packPath, 'manifest.json'), 'manifest.json');
const errors = validateManifest(manifest);
const sources = readJson(join(packPath, manifest.files?.sources || 'sources.json'), 'sources.json');
const policies = readJson(join(packPath, manifest.files?.policies || 'policies.json'), 'policies.json');
const aggregates = readJson(join(packPath, manifest.files?.aggregates || 'aggregates.json'), 'aggregates.json');
errors.push(...validateSources(sources), ...validatePolicies(policies), ...validateAggregates(aggregates));
if (errors.length) {
  console.error('数据包校验失败：');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(2);
}

const db = openDatabase();
const summary = { packId: manifest.packId, version: manifest.version, sources: 0, policies: 0, aggregates: 0, dryRun };
try {
  db.exec('BEGIN IMMEDIATE');
  importSources(db, sources, summary);
  importPolicies(db, policies, summary);
  importAggregates(db, aggregates, summary);
  if (!dryRun) {
    db.prepare(`
      INSERT INTO import_runs (id, pack_id, pack_version, pack_path, summary_json, dry_run, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(newId(), manifest.packId, manifest.version, packPath, JSON.stringify(summary), nowIso());
  }
  db.exec('COMMIT');
  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
} catch (error) {
  db.exec('ROLLBACK');
  console.error(`数据包导入失败：${error.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
