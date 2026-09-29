import { createHash } from 'node:crypto';

const VALID_LEVELS = new Set(['national', 'province', 'city', 'district', 'other']);
const VALID_AMOUNT_TYPES = new Set(['percent', 'fixed', 'tiered', 'other', 'unknown']);

export function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

export function normalizeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|spm|from|source|ref)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return text;
  }
}

export function computeDedupKey(input) {
  const parts = [
    normalizeText(input.title).replace(/\s+/g, '').toLowerCase(),
    normalizeText(input.issuer).replace(/\s+/g, '').toLowerCase(),
    normalizeText(input.docNo).replace(/\s+/g, '').toLowerCase(),
    normalizeText(input.effectiveFrom).replace(/\s+/g, '').toLowerCase(),
    normalizeText(input.jurisdictionName).replace(/\s+/g, '').toLowerCase(),
  ].filter(Boolean);
  if (parts.length < 2) return '';
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export function validateContribution(input, { requireEvidence = false } = {}) {
  const errors = [];
  const warnings = [];
  const value = {
    title: normalizeText(input.title),
    program: normalizeText(input.program),
    policyLevel: normalizeText(input.policyLevel),
    issuer: normalizeText(input.issuer),
    jurisdictionCode: normalizeText(input.jurisdictionCode),
    jurisdictionName: normalizeText(input.jurisdictionName),
    category: normalizeText(input.category),
    amountType: normalizeText(input.amountType) || 'unknown',
    amountValue: input.amountValue === '' || input.amountValue == null ? null : Number(input.amountValue),
    rate: input.rate === '' || input.rate == null ? null : Number(input.rate),
    capAmount: input.capAmount === '' || input.capAmount == null ? null : Number(input.capAmount),
    effectiveFrom: normalizeText(input.effectiveFrom),
    effectiveTo: normalizeText(input.effectiveTo),
    sourceUrl: normalizeUrl(input.sourceUrl),
    notes: normalizeText(input.notes),
  };

  if (value.title.length < 4) errors.push('政策标题至少 4 个字符');
  if (value.title.length > 200) errors.push('政策标题不能超过 200 个字符');
  if (value.policyLevel && !VALID_LEVELS.has(value.policyLevel)) errors.push('政策层级不合法');
  if (!VALID_AMOUNT_TYPES.has(value.amountType)) errors.push('金额类型不合法');
  for (const [key, label] of [['amountValue', '金额'], ['capAmount', '上限金额']]) {
    if (value[key] != null && (!Number.isFinite(value[key]) || value[key] < 0)) errors.push(`${label}必须是非负数`);
  }
  if (value.rate != null && (!Number.isFinite(value.rate) || value.rate < 0 || value.rate > 100)) errors.push('补贴比例需在 0-100 之间');
  if (value.effectiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(value.effectiveFrom)) errors.push('生效日期格式应为 YYYY-MM-DD');
  if (value.effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(value.effectiveTo)) errors.push('截止日期格式应为 YYYY-MM-DD');
  if (value.effectiveFrom && value.effectiveTo && value.effectiveFrom > value.effectiveTo) errors.push('生效日期不能晚于截止日期');
  if (value.sourceUrl && !/^https?:\/\//i.test(value.sourceUrl)) errors.push('来源链接必须是 http 或 https 地址');
  if (!value.sourceUrl) warnings.push('尚未填写官方来源链接');
  if (!value.jurisdictionName) warnings.push('尚未填写适用地区');
  if (value.amountType === 'percent' && value.rate == null) warnings.push('比例型补贴建议填写补贴比例');
  if (value.amountType === 'fixed' && value.amountValue == null) warnings.push('固定金额补贴建议填写补贴金额');
  if (requireEvidence && !value.sourceUrl) errors.push('提交审核前必须填写官方来源链接');
  if (requireEvidence && !input.documentId && !input.extracted) warnings.push('建议附上原始文件或完成解析');

  return { errors, warnings, value };
}

export function findDuplicate(db, dedupKey, excludeId = null) {
  if (!dedupKey) return null;
  const sql = excludeId
    ? 'SELECT * FROM contributions WHERE dedup_key = ? AND id <> ? ORDER BY created_at LIMIT 1'
    : 'SELECT * FROM contributions WHERE dedup_key = ? ORDER BY created_at LIMIT 1';
  return excludeId ? db.prepare(sql).get(dedupKey, excludeId) : db.prepare(sql).get(dedupKey);
}
