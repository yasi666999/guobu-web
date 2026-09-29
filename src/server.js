import http from 'node:http';
import { basename, extname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  addEvent,
  asUser,
  contributionView,
  documentView,
  getContribution,
  getDocument,
  getSource,
  newId,
  nowIso,
  openDatabase,
  parseJson,
  paths,
  sourceView,
} from './db.js';
import {
  changePassword,
  clearSessionCookie,
  getCurrentUser,
  getSessionAuth,
  loginUser,
  logoutUser,
  createInvite,
  registerUser,
  requireCsrf,
  requireRole,
  requireUser,
  resetPassword,
  sessionCookie,
} from './auth.js';
import { mergeExtractedFields, parseDocument, documentExtractionJson, extractedFieldSummary } from './extract.js';
import { fetchAndStore, pollSource, runDueCollections } from './collector.js';
import { parseMultipart } from './multipart.js';
import { resolvePublicFile, saveSnapshot } from './storage.js';
import { computeDedupKey, findDuplicate, normalizeUrl, validateContribution } from './validation.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const CONTRIBUTION_COLUMNS = {
  title: 'title',
  program: 'program',
  policyLevel: 'policy_level',
  issuer: 'issuer',
  jurisdictionCode: 'jurisdiction_code',
  jurisdictionName: 'jurisdiction_name',
  category: 'category',
  amountType: 'amount_type',
  amountValue: 'amount_value',
  rate: 'rate',
  capAmount: 'cap_amount',
  effectiveFrom: 'effective_from',
  effectiveTo: 'effective_to',
  sourceUrl: 'source_url',
  notes: 'notes',
};

const rateBuckets = new Map();

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function enforceRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const error = httpError('操作过于频繁，请稍后再试', 429);
    error.retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    throw error;
  }
}

function jsonResponse(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function textResponse(res, status, body, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': contentType, ...extraHeaders });
  res.end(body);
}

function httpError(message, status = 400, details = null) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

async function readBody(req, maxBytes = 50 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw httpError('请求体过大', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function parsePayload(req) {
  const contentType = String(req.headers['content-type'] || '');
  const buffer = await readBody(req);
  if (!buffer.length) return { fields: {}, files: [] };
  if (contentType.includes('multipart/form-data')) {
    const parsed = parseMultipart(buffer, contentType);
    return { fields: parsed.fields, files: parsed.files };
  }
  if (contentType.includes('application/json')) {
    try {
      return { fields: JSON.parse(buffer.toString('utf8')), files: [] };
    } catch {
      throw httpError('JSON 格式不正确');
    }
  }
  return { fields: Object.fromEntries(new URLSearchParams(buffer.toString('utf8'))), files: [] };
}

function sendError(res, error) {
  const status = error.status || 500;
  jsonResponse(res, status, {
    error: error.message || '服务器内部错误',
    details: error.details || undefined,
  }, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
}

function requireContributionAccess(db, req, row) {
  const user = requireUser(db, req);
  if (['admin', 'reviewer'].includes(user.role)) return user;
  if (row.user_id === user.id) return user;
  if (['submitted', 'in_review', 'changes_requested', 'approved'].includes(row.status)) return user;
  throw httpError('无权查看该草稿', 403);
}

function contributionInput(fields = {}) {
  return {
    title: fields.title,
    program: fields.program,
    policyLevel: fields.policyLevel || fields.policy_level,
    issuer: fields.issuer,
    jurisdictionCode: fields.jurisdictionCode || fields.jurisdiction_code,
    jurisdictionName: fields.jurisdictionName || fields.jurisdiction_name,
    category: fields.category,
    amountType: fields.amountType || fields.amount_type,
    amountValue: fields.amountValue ?? fields.amount_value,
    rate: fields.rate,
    capAmount: fields.capAmount ?? fields.cap_amount,
    effectiveFrom: fields.effectiveFrom || fields.effective_from,
    effectiveTo: fields.effectiveTo || fields.effective_to,
    sourceUrl: fields.sourceUrl || fields.source_url,
    notes: fields.notes,
  };
}

function dbValue(value) {
  return value == null || value === '' ? null : value;
}

function insertContribution(db, user, fields) {
  const input = contributionInput(fields);
  const validation = validateContribution(input);
  if (validation.errors.length) throw httpError('贡献数据校验失败', 400, validation.errors);
  const id = newId();
  const timestamp = nowIso();
  const value = validation.value;
  db.prepare(`
    INSERT INTO contributions (
      id, user_id, status, title, program, policy_level, issuer, jurisdiction_code, jurisdiction_name,
      category, amount_type, amount_value, rate, cap_amount, effective_from, effective_to,
      source_url, notes, validation_json, created_at, updated_at
    ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    user.id,
    value.title,
    dbValue(value.program),
    dbValue(value.policyLevel),
    dbValue(value.issuer),
    dbValue(value.jurisdictionCode),
    dbValue(value.jurisdictionName),
    dbValue(value.category),
    value.amountType || 'unknown',
    value.amountValue,
    value.rate,
    value.capAmount,
    dbValue(value.effectiveFrom),
    dbValue(value.effectiveTo),
    dbValue(value.sourceUrl),
    dbValue(value.notes),
    JSON.stringify(validation),
    timestamp,
    timestamp,
  );
  addEvent(db, { entityType: 'contribution', entityId: id, actorId: user.id, action: 'created', detail: { title: value.title } });
  return getContribution(db, id);
}

function refreshContributionFromDocument(db, contributionId, documentId, actorId) {
  const document = getDocument(db, documentId);
  if (!document) return getContribution(db, contributionId);
  const parsed = documentExtractionJson(document);
  const current = getContribution(db, contributionId);
  const merged = mergeExtractedFields(contributionView(current, db), parsed);
  updateContributionFields(db, contributionId, actorId, merged, { mergeOnly: true });
  return getContribution(db, contributionId);
}

function updateContributionFields(db, contributionId, actorId, fields, { mergeOnly = false } = {}) {
  const current = getContribution(db, contributionId);
  if (!current) throw httpError('贡献记录不存在', 404);
  if (!mergeOnly && !['draft', 'changes_requested'].includes(current.status) && actorId) {
    const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorId);
    if (!actor || !['admin', 'reviewer'].includes(actor.role)) throw httpError('该状态下的记录只能由审核员修改', 403);
  }
  const input = contributionInput({ ...contributionView(current, db), ...fields });
  const validation = validateContribution(input);
  if (validation.errors.length) throw httpError('贡献数据校验失败', 400, validation.errors);
  const value = validation.value;
  const assignments = [];
  const values = [];
  for (const [key, column] of Object.entries(CONTRIBUTION_COLUMNS)) {
    if (!(key in fields) && mergeOnly) continue;
    assignments.push(`${column} = ?`);
    values.push(dbValue(value[key]));
  }
  if (assignments.length) {
    assignments.push('updated_at = ?');
    values.push(nowIso(), contributionId);
    db.prepare(`UPDATE contributions SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
  }
  const updated = getContribution(db, contributionId);
  const dedupKey = computeDedupKey({
    title: updated.title,
    issuer: updated.issuer,
    docNo: value.docNo || '',
    effectiveFrom: updated.effective_from,
    jurisdictionName: updated.jurisdiction_name,
  });
  const duplicate = findDuplicate(db, dedupKey, contributionId);
  db.prepare('UPDATE contributions SET validation_json = ?, dedup_key = ?, duplicate_of = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(validation), dedupKey || null, duplicate?.id || null, nowIso(), contributionId);
  addEvent(db, { entityType: 'contribution', entityId: contributionId, actorId, action: 'fields_updated' });
  return getContribution(db, contributionId);
}

async function attachUploadedFile(db, contributionId, user, file) {
  if (!file) return null;
  const snapshot = saveSnapshot(file.buffer, { mimeType: file.contentType, originalName: file.filename });
  const documentId = newId();
  db.prepare(`
    INSERT INTO documents (
      id, contribution_id, url, canonical_url, title, mime_type, byte_size, content_hash,
      raw_path, status, fetched_by, fetched_at, created_at
    ) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, 'fetched', ?, ?, ?)
  `).run(documentId, contributionId, file.filename, snapshot.mimeType, snapshot.byteSize, snapshot.hash, snapshot.filePath, user.id, nowIso(), nowIso());
  db.prepare('UPDATE contributions SET document_id = ?, updated_at = ? WHERE id = ?').run(documentId, nowIso(), contributionId);
  try {
    parseDocument(db, documentId, { allowOcr: true });
    refreshContributionFromDocument(db, contributionId, documentId, user.id);
  } catch (error) {
    db.prepare('UPDATE documents SET status = ?, error = ? WHERE id = ?').run('failed', error.message, documentId);
  }
  addEvent(db, { entityType: 'contribution', entityId: contributionId, actorId: user.id, action: 'file_uploaded', detail: { filename: file.filename } });
  return documentId;
}

async function attachSourceUrl(db, contributionId, user, sourceUrl) {
  if (!sourceUrl) return null;
  try {
    const result = await fetchAndStore(db, sourceUrl, { contributionId, actorId: user.id, parse: true });
    db.prepare('UPDATE contributions SET document_id = COALESCE(document_id, ?), updated_at = ? WHERE id = ?')
      .run(result.documentId, nowIso(), contributionId);
    refreshContributionFromDocument(db, contributionId, result.documentId, user.id);
    return result.documentId;
  } catch (error) {
    const current = getContribution(db, contributionId);
    const validation = parseJson(current?.validation_json, { errors: [], warnings: [] });
    validation.warnings = [...(validation.warnings || []), `来源链接抓取失败：${error.message}`];
    db.prepare('UPDATE contributions SET validation_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(validation), nowIso(), contributionId);
    return null;
  }
}

function submitContribution(db, contributionId, user) {
  const row = getContribution(db, contributionId);
  if (!row) throw httpError('贡献记录不存在', 404);
  if (row.user_id !== user.id && !['admin', 'reviewer'].includes(user.role)) throw httpError('无权提交该记录', 403);
  if (!['draft', 'changes_requested', 'submitted', 'in_review'].includes(row.status)) throw httpError('当前状态不能提交', 409);
  const input = contributionView(row, db);
  const validation = validateContribution(input, { requireEvidence: true });
  if (validation.errors.length) throw httpError('提交前校验失败', 400, validation.errors);
  const updatedValidation = { ...validation, submittedAt: nowIso() };
  db.prepare('UPDATE contributions SET status = ?, validation_json = ?, updated_at = ? WHERE id = ?')
    .run('submitted', JSON.stringify(updatedValidation), nowIso(), contributionId);
  addEvent(db, { entityType: 'contribution', entityId: contributionId, actorId: user.id, action: 'submitted' });
  return getContribution(db, contributionId);
}

function publishContribution(db, row, reviewer) {
  if (row.duplicate_of) {
    const duplicate = getContribution(db, row.duplicate_of);
    if (duplicate?.status === 'approved') throw httpError('发现已发布的重复政策，请先处理重复项', 409, { duplicateId: duplicate.id });
  }
  const timestamp = nowIso();
  const policyId = newId();
  const status = row.effective_to && row.effective_to < timestamp.slice(0, 10) ? 'expired' : 'active';
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO policies (
        id, contribution_id, title, program, policy_level, issuer, jurisdiction_code, jurisdiction_name,
        status, effective_from, effective_to, source_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(contribution_id) DO UPDATE SET
        title = excluded.title, program = excluded.program, policy_level = excluded.policy_level,
        issuer = excluded.issuer, jurisdiction_code = excluded.jurisdiction_code,
        jurisdiction_name = excluded.jurisdiction_name, status = excluded.status,
        effective_from = excluded.effective_from, effective_to = excluded.effective_to,
        source_url = excluded.source_url, updated_at = excluded.updated_at
    `).run(
      policyId, row.id, row.title, row.program, row.policy_level, row.issuer, row.jurisdiction_code,
      row.jurisdiction_name, status, row.effective_from, row.effective_to, row.source_url, timestamp, timestamp,
    );
    const existingPolicy = db.prepare('SELECT id FROM policies WHERE contribution_id = ?').get(row.id);
    const effectivePolicyId = existingPolicy?.id || policyId;
    db.prepare('DELETE FROM subsidy_rules WHERE policy_id = ?').run(effectivePolicyId);
    db.prepare(`
      INSERT INTO subsidy_rules (id, policy_id, category, amount_type, rate, fixed_amount, cap_amount, conditions_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(newId(), effectivePolicyId, row.category, row.amount_type, row.rate, row.amount_value, row.cap_amount, null, timestamp);
    db.prepare('DELETE FROM evidence WHERE policy_id = ?').run(effectivePolicyId);
    const parsed = parseJson(row.extracted_json, null) || (row.document_id ? documentExtractionJson(getDocument(db, row.document_id)) : null);
    const evidence = parsed?.evidence || [];
    if (evidence.length) {
      const insertEvidence = db.prepare(`
        INSERT INTO evidence (id, policy_id, document_id, field_name, quote, page_number, confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of evidence) {
        insertEvidence.run(newId(), effectivePolicyId, row.document_id || null, item.field_name, item.quote || null, item.page_number || null, item.confidence ?? null, timestamp);
      }
    } else if (row.source_url) {
      db.prepare(`
        INSERT INTO evidence (id, policy_id, document_id, field_name, quote, page_number, confidence, created_at)
        VALUES (?, ?, ?, 'source_url', ?, NULL, NULL, ?)
      `).run(newId(), effectivePolicyId, row.document_id || null, row.source_url, timestamp);
    }
    db.prepare('UPDATE contributions SET status = ?, reviewer_id = ?, reviewed_at = ?, updated_at = ? WHERE id = ?')
      .run('approved', reviewer.id, timestamp, timestamp, row.id);
    addEvent(db, { entityType: 'contribution', entityId: row.id, actorId: reviewer.id, action: 'approved', detail: { policyId: effectivePolicyId } });
    db.exec('COMMIT');
    return effectivePolicyId;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function importDocumentAsPolicy(db, documentId, actorId, overrides = {}) {
  const document = getDocument(db, documentId);
  if (!document) throw httpError('文档不存在', 404);
  const parsed = documentExtractionJson(document);
  if (!parsed) throw httpError('文档尚未解析，不能导入', 409);
  const relevance = parsed.relevance || { score: 0, level: 'none', isRelated: false, summary: '' };
  if (!relevance.isRelated && overrides.force !== true) {
    throw httpError('该页面未识别为国补相关内容，不能自动导入', 409, relevance);
  }

  const summary = extractedFieldSummary(parsed);
  const jurisdictionName = overrides.jurisdictionName || summary.jurisdictionName || '全国';
  const title = overrides.title || summary.title || document.title || '未命名国补政策';
  const issuer = overrides.issuer || summary.issuer || '';
  const fundingSource = overrides.fundingSource || summary.fundingSource || '';
  const amountType = overrides.amountType || summary.amountType || 'unknown';
  const rate = overrides.rate ?? summary.rate ?? null;
  const amountValue = overrides.amountValue ?? summary.amountValue ?? null;
  const capAmount = overrides.capAmount ?? summary.capAmount ?? null;
  const effectiveFrom = overrides.effectiveFrom || summary.effectiveFrom || null;
  const effectiveTo = overrides.effectiveTo || summary.effectiveTo || null;
  const sourceUrl = document.canonical_url || document.url || null;
  const dedupKey = computeDedupKey({ title, issuer, effectiveFrom, jurisdictionName });
  const existing = findDuplicate(db, dedupKey);
  if (existing) {
    return { duplicate: true, contributionId: existing.id, policyId: db.prepare('SELECT id FROM policies WHERE contribution_id = ?').get(existing.id)?.id || null };
  }

  const policyLevel = overrides.policyLevel || (jurisdictionName === '全国' ? 'national' : 'other');
  const timestamp = nowIso();
  const contributionId = newId();
  const policyId = newId();
  const validation = {
    errors: [],
    warnings: ['由采集页自动识别并导入；请核对原始来源。'],
    relevance,
    importedFromDocument: documentId,
  };
  const status = effectiveTo && effectiveTo < timestamp.slice(0, 10) ? 'expired' : 'active';

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO contributions (
        id, user_id, status, title, program, policy_level, issuer, jurisdiction_name, category,
        amount_type, amount_value, rate, cap_amount, effective_from, effective_to, source_url,
        notes, extracted_json, validation_json, dedup_key, document_id, reviewer_id, reviewed_at, created_at, updated_at
      ) VALUES (?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      contributionId, actorId, title, overrides.program || summary.program || '消费品以旧换新',
      policyLevel, issuer, jurisdictionName, overrides.category || summary.category || '其他', amountType,
      amountValue, rate, capAmount, effectiveFrom, effectiveTo, sourceUrl,
      `由网址自动采集；${relevance.summary || ''}`.trim(), JSON.stringify(parsed), JSON.stringify(validation),
      dedupKey || null, documentId, actorId, timestamp, timestamp, timestamp,
    );
    db.prepare(`
      INSERT INTO policies (
        id, contribution_id, title, program, policy_level, issuer, funding_source, jurisdiction_code, jurisdiction_name,
        status, effective_from, effective_to, source_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      policyId, contributionId, title, overrides.program || summary.program || '消费品以旧换新', policyLevel,
      issuer, fundingSource, jurisdictionName, status, effectiveFrom, effectiveTo, sourceUrl, timestamp, timestamp,
    );
    db.prepare(`
      INSERT INTO subsidy_rules (id, policy_id, category, amount_type, rate, fixed_amount, cap_amount, conditions_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId(), policyId, overrides.category || summary.category || '其他', amountType, rate,
      amountValue, capAmount, JSON.stringify({ relevance, notes: '采集页自动导入' }), timestamp,
    );
    const evidenceRows = (parsed.evidence || []).length
      ? parsed.evidence
      : [{ field_name: 'relevance', quote: relevance.summary, page_number: null, confidence: relevance.score / 100 }];
    for (const evidence of evidenceRows) {
      db.prepare(`
        INSERT INTO evidence (id, policy_id, document_id, field_name, quote, page_number, confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newId(), policyId, documentId, evidence.field_name || 'source', evidence.quote || '', evidence.page_number || null, evidence.confidence ?? null, timestamp);
    }
    addEvent(db, { entityType: 'document', entityId: documentId, actorId, action: 'imported_as_policy', detail: { contributionId, policyId, relevance } });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { duplicate: false, contributionId, policyId };
}

function reviewContribution(db, contributionId, reviewer, action, comment) {
  const row = getContribution(db, contributionId);
  if (!row) throw httpError('贡献记录不存在', 404);
  const allowed = ['start_review', 'request_changes', 'approve', 'reject'];
  if (!allowed.includes(action)) throw httpError('审核动作不合法');
  if (action === 'request_changes' && !String(comment || '').trim()) throw httpError('要求修改时必须填写说明');
  let status = row.status;
  if (action === 'start_review') status = 'in_review';
  if (action === 'request_changes') status = 'changes_requested';
  if (action === 'reject') status = 'rejected';
  if (action === 'approve') {
    const updated = submitContribution(db, contributionId, reviewer);
    publishContribution(db, updated, reviewer);
    return getContribution(db, contributionId);
  }
  db.prepare('UPDATE contributions SET status = ?, reviewer_id = ?, reviewed_at = ?, updated_at = ? WHERE id = ?')
    .run(status, reviewer.id, nowIso(), nowIso(), contributionId);
  if (comment) {
    db.prepare('INSERT INTO comments (id, contribution_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(newId(), contributionId, reviewer.id, String(comment).trim(), nowIso());
  }
  addEvent(db, { entityType: 'contribution', entityId: contributionId, actorId: reviewer.id, action, detail: comment ? { comment } : null });
  return getContribution(db, contributionId);
}

function contributionDetail(db, row) {
  const view = contributionView(row, db);
  if (!view) return null;
  const comments = db.prepare(`
    SELECT c.*, u.display_name
    FROM comments c JOIN users u ON u.id = c.user_id
    WHERE c.contribution_id = ? ORDER BY c.created_at ASC
  `).all(row.id).map((item) => ({ id: item.id, body: item.body, userName: item.display_name, createdAt: item.created_at }));
  const events = db.prepare(`
    SELECT e.*, u.display_name
    FROM events e LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.entity_type = 'contribution' AND e.entity_id = ?
    ORDER BY e.created_at DESC LIMIT 100
  `).all(row.id).map((item) => ({ id: item.id, action: item.action, detail: parseJson(item.detail, null), userName: item.display_name, createdAt: item.created_at }));
  return { ...view, comments, events };
}

function listContributions(db, user, url) {
  const filters = [];
  const values = [];
  const status = url.searchParams.get('status');
  const query = url.searchParams.get('q');
  if (!['admin', 'reviewer'].includes(user.role)) {
    filters.push("(user_id = ? OR status IN ('submitted', 'in_review', 'approved'))");
    values.push(user.id);
  }
  if (status) {
    filters.push('status = ?');
    values.push(status);
  }
  if (query) {
    filters.push('(title LIKE ? OR jurisdiction_name LIKE ? OR category LIKE ? OR issuer LIKE ?)');
    const like = `%${query}%`;
    values.push(like, like, like, like);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM contributions ${where} ORDER BY updated_at DESC LIMIT 300`).all(...values);
  return rows.map((row) => contributionView(row, db));
}

function statsFor(db) {
  const counts = {};
  for (const row of db.prepare('SELECT status, COUNT(*) AS count FROM contributions GROUP BY status').all()) counts[row.status] = row.count;
  return {
    contributions: db.prepare('SELECT COUNT(*) AS count FROM contributions').get().count,
    sources: db.prepare('SELECT COUNT(*) AS count FROM sources').get().count,
    documents: db.prepare('SELECT COUNT(*) AS count FROM documents').get().count,
    policies: db.prepare('SELECT COUNT(*) AS count FROM policies').get().count,
    users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
    byStatus: counts,
    recent: db.prepare(`
      SELECT c.id, c.title, c.status, c.jurisdiction_name, c.category, c.updated_at, u.display_name
      FROM contributions c JOIN users u ON u.id = c.user_id
      ORDER BY c.updated_at DESC LIMIT 8
    `).all().map((row) => ({
      id: row.id, title: row.title, status: row.status, jurisdictionName: row.jurisdiction_name,
      category: row.category, updatedAt: row.updated_at, userName: row.display_name,
    })),
  };
}

function geoParts(name) {
  const text = String(name || '').replace(/\s+/g, '').replace(/[／]/g, '/');
  const provinceMatch = text.match(/([^/]+?(?:省|自治区|特别行政区|北京市|上海市|天津市|重庆市))/);
  const cityMatch = text.match(/([^/]+?市)/);
  const districtMatch = text.match(/([^/]+?(?:区|县|旗))/);
  return {
    province: provinceMatch?.[1] || (text.includes('全国') ? '全国' : ''),
    city: cityMatch?.[1] || '',
    district: districtMatch?.[1] || '',
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

async function handleApi(db, req, res, url) {
  const { pathname } = url;
  if (pathname === '/api/health' && req.method === 'GET') return jsonResponse(res, 200, { ok: true, time: nowIso() });
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    enforceRateLimit(`auth:${clientIp(req)}`, 20, 10 * 60 * 1000);
    const { fields } = await parsePayload(req);
    const user = registerUser(db, fields);
    const { createSession } = await import('./auth.js');
    const session = createSession(db, user.id);
    return jsonResponse(res, 201, { user, csrfToken: session.csrfToken }, { 'Set-Cookie': sessionCookie(session.id, session.expiresAt) });
  }
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    enforceRateLimit(`auth:${clientIp(req)}`, 20, 10 * 60 * 1000);
    const { fields } = await parsePayload(req);
    const result = loginUser(db, fields);
    return jsonResponse(res, 200, { user: result.user, csrfToken: result.session.csrfToken }, { 'Set-Cookie': sessionCookie(result.session.id, result.session.expiresAt) });
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    requireCsrf(db, req);
    logoutUser(db, req);
    return jsonResponse(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
  }
  if (pathname === '/api/me' && req.method === 'GET') {
    const auth = getSessionAuth(db, req);
    return jsonResponse(res, 200, { user: auth?.user || null, csrfToken: auth?.csrfToken || null });
  }

  const user = requireUser(db, req);
  if (!['GET', 'HEAD'].includes(req.method)) requireCsrf(db, req);
  if (pathname === '/api/collect' || pathname.endsWith('/poll')) enforceRateLimit(`collect:${user.id}`, 30, 10 * 60 * 1000);

  if (pathname === '/api/auth/change-password' && req.method === 'POST') {
    const { fields } = await parsePayload(req);
    changePassword(db, user.id, fields.currentPassword, fields.newPassword);
    return jsonResponse(res, 200, { ok: true, message: '密码已修改，请重新登录' }, { 'Set-Cookie': clearSessionCookie() });
  }

  if (pathname === '/api/stats' && req.method === 'GET') return jsonResponse(res, 200, statsFor(db));
  if (pathname === '/api/users' && req.method === 'GET') {
    requireRole(db, req, ['admin']);
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
    return jsonResponse(res, 200, { users: rows.map(asUser) });
  }
  const userMatch = /^\/api\/users\/([^/]+)$/.exec(pathname);
  if (userMatch && req.method === 'PATCH') {
    const admin = requireRole(db, req, ['admin']);
    const { fields } = await parsePayload(req);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(userMatch[1]);
    if (!target) throw httpError('用户不存在', 404);
    const role = ['admin', 'reviewer', 'contributor', 'viewer'].includes(fields.role) ? fields.role : target.role;
    const status = ['active', 'disabled'].includes(fields.status) ? fields.status : target.status;
    const activeAdmins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'").get().count;
    if (target.role === 'admin' && target.status === 'active' && activeAdmins <= 1 && (role !== 'admin' || status !== 'active')) {
      throw httpError('不能停用或降级最后一个管理员', 409);
    }
    if (target.id === admin.id && status === 'disabled') throw httpError('不能停用当前登录账号', 409);
    db.prepare('UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?').run(role, status, nowIso(), target.id);
    addEvent(db, { entityType: 'user', entityId: target.id, actorId: admin.id, action: 'role_updated', detail: { role, status } });
    return jsonResponse(res, 200, { user: asUser(db.prepare('SELECT * FROM users WHERE id = ?').get(target.id)) });
  }
  const resetPasswordMatch = /^\/api\/users\/([^/]+)\/reset-password$/.exec(pathname);
  if (resetPasswordMatch && req.method === 'POST') {
    const admin = requireRole(db, req, ['admin']);
    const { fields } = await parsePayload(req);
    const result = resetPassword(db, resetPasswordMatch[1], admin.id, fields.newPassword || '');
    return jsonResponse(res, 200, result);
  }

  if (pathname === '/api/invites' && req.method === 'GET') {
    requireRole(db, req, ['admin']);
    const rows = db.prepare(`
      SELECT i.*, u.username AS used_username, c.username AS creator_username
      FROM invites i
      LEFT JOIN users u ON u.id = i.used_by
      LEFT JOIN users c ON c.id = i.created_by
      ORDER BY i.created_at DESC LIMIT 200
    `).all();
    return jsonResponse(res, 200, { invites: rows.map((row) => ({
      id: row.id,
      code: row.code,
      role: row.role,
      note: row.note,
      expiresAt: row.expires_at,
      usedBy: row.used_username,
      usedAt: row.used_at,
      disabled: Boolean(row.disabled),
      createdAt: row.created_at,
    })) });
  }
  if (pathname === '/api/invites' && req.method === 'POST') {
    const admin = requireRole(db, req, ['admin']);
    const { fields } = await parsePayload(req);
    const invite = createInvite(db, admin.id, {
      role: fields.role || 'contributor',
      note: fields.note || '',
      expiresAt: fields.expiresAt || null,
    });
    return jsonResponse(res, 201, { invite: {
      id: invite.id,
      code: invite.code,
      role: invite.role,
      note: invite.note,
      expiresAt: invite.expires_at,
      disabled: Boolean(invite.disabled),
      createdAt: invite.created_at,
    } });
  }

  if (pathname === '/api/sources' && req.method === 'GET') {
    const rows = db.prepare('SELECT * FROM sources ORDER BY updated_at DESC').all();
    return jsonResponse(res, 200, { sources: rows.map(sourceView) });
  }
  if (pathname === '/api/sources' && req.method === 'POST') {
    const writer = requireRole(db, req, ['admin', 'reviewer', 'contributor']);
    const { fields } = await parsePayload(req);
    const required = ['name', 'level', 'sourceType'];
    const missing = required.filter((key) => !String(fields[key] || '').trim());
    if (missing.length) throw httpError('缺少字段', 400, missing);
    const id = newId();
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO sources (
        id, name, level, jurisdiction_code, jurisdiction_name, category, keywords, base_url, listing_url, source_type,
        access_method, frequency, interval_minutes, enabled, compliance_note, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, String(fields.name).trim(), fields.level, dbValue(fields.jurisdictionCode), dbValue(fields.jurisdictionName),
      dbValue(fields.category), dbValue(fields.keywords), dbValue(normalizeUrl(fields.baseUrl)), dbValue(normalizeUrl(fields.listingUrl)), fields.sourceType,
      fields.accessMethod || 'scheduled', fields.frequency || 'daily', dbValue(fields.intervalMinutes),
      fields.enabled === '0' || fields.enabled === false ? 0 : 1,
      dbValue(fields.complianceNote), writer.id, timestamp, timestamp,
    );
    addEvent(db, { entityType: 'source', entityId: id, actorId: writer.id, action: 'created' });
    return jsonResponse(res, 201, { source: sourceView(getSource(db, id)) });
  }
  const sourceMatch = /^\/api\/sources\/([^/]+)$/.exec(pathname);
  if (sourceMatch && req.method === 'PATCH') {
    const writer = requireRole(db, req, ['admin', 'reviewer']);
    const source = getSource(db, sourceMatch[1]);
    if (!source) throw httpError('数据源不存在', 404);
    const { fields } = await parsePayload(req);
    const next = {
      name: fields.name ?? source.name,
      level: fields.level ?? source.level,
      jurisdictionCode: fields.jurisdictionCode ?? source.jurisdiction_code,
      jurisdictionName: fields.jurisdictionName ?? source.jurisdiction_name,
      category: fields.category ?? source.category,
      keywords: fields.keywords ?? source.keywords,
      baseUrl: fields.baseUrl ?? source.base_url,
      listingUrl: fields.listingUrl ?? source.listing_url,
      sourceType: fields.sourceType ?? source.source_type,
      accessMethod: fields.accessMethod ?? source.access_method,
      frequency: fields.frequency ?? source.frequency,
      intervalMinutes: fields.intervalMinutes ?? source.interval_minutes,
      enabled: fields.enabled == null ? source.enabled : (fields.enabled === '0' || fields.enabled === false ? 0 : 1),
      complianceNote: fields.complianceNote ?? source.compliance_note,
    };
    db.prepare(`
      UPDATE sources SET name = ?, level = ?, jurisdiction_code = ?, jurisdiction_name = ?, category = ?, keywords = ?,
        base_url = ?, listing_url = ?, source_type = ?, access_method = ?, frequency = ?, interval_minutes = ?,
        enabled = ?, compliance_note = ?, updated_at = ?
      WHERE id = ?
    `).run(next.name, next.level, dbValue(next.jurisdictionCode), dbValue(next.jurisdictionName), dbValue(next.category), dbValue(next.keywords), dbValue(normalizeUrl(next.baseUrl)), dbValue(normalizeUrl(next.listingUrl)), next.sourceType, next.accessMethod, next.frequency, dbValue(next.intervalMinutes), next.enabled, dbValue(next.complianceNote), nowIso(), source.id);
    addEvent(db, { entityType: 'source', entityId: source.id, actorId: writer.id, action: 'updated' });
    return jsonResponse(res, 200, { source: sourceView(getSource(db, source.id)) });
  }
  const pollMatch = /^\/api\/sources\/([^/]+)\/poll$/.exec(pathname);
  if (pollMatch && req.method === 'POST') {
    const writer = requireRole(db, req, ['admin', 'reviewer', 'contributor']);
    const result = await pollSource(db, pollMatch[1], writer.id);
    return jsonResponse(res, 200, result);
  }

  if (pathname === '/api/contributions' && req.method === 'GET') return jsonResponse(res, 200, { contributions: listContributions(db, user, url) });
  if (pathname === '/api/contributions' && req.method === 'POST') {
    const writer = requireRole(db, req, ['admin', 'reviewer', 'contributor']);
    const payload = await parsePayload(req);
    const fields = { ...payload.fields };
    let row = insertContribution(db, writer, fields);
    const file = payload.files.find((item) => item.field === 'file');
    if (file) await attachUploadedFile(db, row.id, writer, file);
    const autoFetch = String(fields.autoFetch || fields.auto_fetch || '1') !== '0';
    if (!file && autoFetch && row.source_url) await attachSourceUrl(db, row.id, writer, row.source_url);
    if (String(fields.submit || '') === '1' || fields.submit === true) row = submitContribution(db, row.id, writer);
    return jsonResponse(res, 201, { contribution: contributionDetail(db, getContribution(db, row.id)) });
  }
  const contributionMatch = /^\/api\/contributions\/([^/]+)$/.exec(pathname);
  if (contributionMatch && req.method === 'GET') {
    const row = getContribution(db, contributionMatch[1]);
    if (!row) throw httpError('贡献记录不存在', 404);
    requireContributionAccess(db, req, row);
    return jsonResponse(res, 200, { contribution: contributionDetail(db, row) });
  }
  if (contributionMatch && req.method === 'PATCH') {
    const row = getContribution(db, contributionMatch[1]);
    if (!row) throw httpError('贡献记录不存在', 404);
    const actor = requireContributionAccess(db, req, row);
    const { fields } = await parsePayload(req);
    const updated = updateContributionFields(db, row.id, actor.id, fields);
    return jsonResponse(res, 200, { contribution: contributionDetail(db, updated) });
  }
  const submitMatch = /^\/api\/contributions\/([^/]+)\/submit$/.exec(pathname);
  if (submitMatch && req.method === 'POST') {
    const actor = requireUser(db, req);
    const updated = submitContribution(db, submitMatch[1], actor);
    return jsonResponse(res, 200, { contribution: contributionDetail(db, updated) });
  }
  const reviewMatch = /^\/api\/contributions\/([^/]+)\/review$/.exec(pathname);
  if (reviewMatch && req.method === 'POST') {
    const reviewer = requireRole(db, req, ['admin', 'reviewer']);
    const { fields } = await parsePayload(req);
    const updated = reviewContribution(db, reviewMatch[1], reviewer, fields.action, fields.comment);
    return jsonResponse(res, 200, { contribution: contributionDetail(db, updated) });
  }
  const parseMatch = /^\/api\/contributions\/([^/]+)\/parse$/.exec(pathname);
  if (parseMatch && req.method === 'POST') {
    const actor = requireUser(db, req);
    const row = getContribution(db, parseMatch[1]);
    if (!row) throw httpError('贡献记录不存在', 404);
    if (!row.document_id) throw httpError('该记录还没有关联文档', 409);
    parseDocument(db, row.document_id, { allowOcr: true });
    const updated = refreshContributionFromDocument(db, row.id, row.document_id, actor.id);
    return jsonResponse(res, 200, { contribution: contributionDetail(db, updated) });
  }
  const commentMatch = /^\/api\/contributions\/([^/]+)\/comments$/.exec(pathname);
  if (commentMatch && req.method === 'POST') {
    const row = getContribution(db, commentMatch[1]);
    if (!row) throw httpError('贡献记录不存在', 404);
    const actor = requireContributionAccess(db, req, row);
    const { fields } = await parsePayload(req);
    const body = String(fields.body || '').trim();
    if (!body) throw httpError('评论不能为空');
    db.prepare('INSERT INTO comments (id, contribution_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(newId(), row.id, actor.id, body, nowIso());
    addEvent(db, { entityType: 'contribution', entityId: row.id, actorId: actor.id, action: 'commented' });
    return jsonResponse(res, 201, { contribution: contributionDetail(db, getContribution(db, row.id)) });
  }

  if (pathname === '/api/documents' && req.method === 'GET') {
    const rows = db.prepare('SELECT * FROM documents ORDER BY created_at DESC LIMIT 300').all();
    return jsonResponse(res, 200, { documents: rows.map(documentView) });
  }
  const documentMatch = /^\/api\/documents\/([^/]+)$/.exec(pathname);
  if (documentMatch && req.method === 'GET') {
    const row = getDocument(db, documentMatch[1]);
    if (!row) throw httpError('文档不存在', 404);
    return jsonResponse(res, 200, { document: documentView(row) });
  }
  const documentParseMatch = /^\/api\/documents\/([^/]+)\/parse$/.exec(pathname);
  if (documentParseMatch && req.method === 'POST') {
    const actor = requireRole(db, req, ['admin', 'reviewer', 'contributor']);
    const document = getDocument(db, documentParseMatch[1]);
    if (!document) throw httpError('文档不存在', 404);
    parseDocument(db, document.id, { allowOcr: true });
    if (document.contribution_id) refreshContributionFromDocument(db, document.contribution_id, document.id, actor.id);
    return jsonResponse(res, 200, { document: documentView(getDocument(db, document.id)) });
  }
  const documentFetchMatch = /^\/api\/documents\/([^/]+)\/fetch$/.exec(pathname);
  if (documentFetchMatch && req.method === 'POST') {
    const actor = requireRole(db, req, ['admin', 'reviewer', 'contributor']);
    const target = getDocument(db, documentFetchMatch[1]);
    if (!target?.url) throw httpError('文档不存在或没有链接', 404);
    const result = await fetchAndStore(db, target.url, {
      sourceId: target.source_id,
      contributionId: target.contribution_id,
      actorId: actor.id,
      title: target.title,
      parse: true,
    });
    const fetched = getDocument(db, result.documentId);
    db.prepare(`
      UPDATE documents SET url = ?, canonical_url = ?, title = ?, mime_type = ?, byte_size = ?, content_hash = ?,
        raw_path = ?, extracted_text = ?, extracted_json = ?, status = ?, error = ?, fetched_by = ?, fetched_at = ?,
        parsed_at = ?, created_at = ? WHERE id = ?
    `).run(fetched.url, fetched.canonical_url, fetched.title, fetched.mime_type, fetched.byte_size, fetched.content_hash,
      fetched.raw_path, fetched.extracted_text, fetched.extracted_json, fetched.status, fetched.error, actor.id,
      fetched.fetched_at, fetched.parsed_at, fetched.created_at, target.id);
    if (result.documentId !== target.id) db.prepare('DELETE FROM documents WHERE id = ?').run(result.documentId);
    if (target.contribution_id) refreshContributionFromDocument(db, target.contribution_id, target.id, actor.id);
    return jsonResponse(res, 200, { document: documentView(getDocument(db, target.id)) });
  }

  const documentImportMatch = /^\/api\/documents\/([^/]+)\/import$/.exec(pathname);
  if (documentImportMatch && req.method === 'POST') {
    const actor = requireUser(db, req);
    const { fields } = await parsePayload(req);
    const result = importDocumentAsPolicy(db, documentImportMatch[1], actor.id, fields || {});
    return jsonResponse(res, result.duplicate ? 200 : 201, result);
  }

  if (pathname === '/api/collect' && req.method === 'POST') {
    const actor = requireRole(db, req, ['admin', 'reviewer', 'contributor']);
    const { fields } = await parsePayload(req);
    if (!fields.url) throw httpError('缺少 url');
    const result = await fetchAndStore(db, fields.url, {
      sourceId: fields.sourceId || null,
      contributionId: fields.contributionId || null,
      actorId: actor.id,
      parse: true,
    });
    return jsonResponse(res, 201, { ...result, document: documentView(getDocument(db, result.documentId)) });
  }

  if (pathname === '/api/source-dashboard' && req.method === 'GET') {
    const province = String(url.searchParams.get('province') || '').trim();
    const city = String(url.searchParams.get('city') || '').trim();
    const district = String(url.searchParams.get('district') || '').trim();
    const category = String(url.searchParams.get('category') || '').trim();
    const q = String(url.searchParams.get('q') || '').trim();
    const sourceFilters = [];
    const sourceValues = [];
    for (const [field, value] of [['province', province], ['city', city], ['district', district]]) {
      if (!value) continue;
      sourceFilters.push('s.jurisdiction_name LIKE ?');
      sourceValues.push(`%${value}%`);
    }
    if (category) {
      sourceFilters.push('s.category LIKE ?');
      sourceValues.push(`%${category}%`);
    }
    if (q) {
      sourceFilters.push('(s.name LIKE ? OR s.keywords LIKE ? OR s.listing_url LIKE ?)');
      sourceValues.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const sourceWhere = sourceFilters.length ? `WHERE ${sourceFilters.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT s.*,
        COUNT(DISTINCT d.id) AS document_count,
        COUNT(DISTINCT c.id) AS imported_count,
        MAX(d.created_at) AS last_document_at
      FROM sources s
      LEFT JOIN documents d ON d.source_id = s.id
      LEFT JOIN contributions c ON c.document_id = d.id AND c.status = 'approved'
      ${sourceWhere}
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `).all(...sourceValues);

    const policyFilters = [];
    const policyValues = [];
    for (const value of [province, city, district]) {
      if (value) {
        policyFilters.push('p.jurisdiction_name LIKE ?');
        policyValues.push(`%${value}%`);
      }
    }
    if (category) {
      policyFilters.push('r.category LIKE ?');
      policyValues.push(`%${category}%`);
    }
    if (q) {
      policyFilters.push(`(p.title LIKE ? OR p.issuer LIKE ? OR p.program LIKE ? OR p.source_url LIKE ? OR EXISTS (
        SELECT 1 FROM evidence e WHERE e.policy_id = p.id AND e.quote LIKE ?
      ))`);
      policyValues.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const policyWhere = policyFilters.length ? `WHERE ${policyFilters.join(' AND ')}` : '';
    const policies = db.prepare(`
      SELECT p.*, r.category, r.amount_type, r.rate, r.fixed_amount, r.cap_amount,
        (SELECT e.quote FROM evidence e WHERE e.policy_id = p.id LIMIT 1) AS content_snippet
      FROM policies p LEFT JOIN subsidy_rules r ON r.policy_id = p.id
      ${policyWhere}
      ORDER BY p.updated_at DESC LIMIT 500
    `).all(...policyValues).map((row) => ({
      id: row.id,
      title: row.title,
      program: row.program,
      level: row.policy_level,
      issuer: row.issuer,
      fundingSource: row.funding_source,
      jurisdictionName: row.jurisdiction_name,
      geo: geoParts(row.jurisdiction_name),
      geo: geoParts(row.jurisdiction_name),
      status: row.status,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      sourceUrl: row.source_url,
      category: row.category,
      amountType: row.amount_type,
      rate: row.rate,
      fixedAmount: row.fixed_amount,
      capAmount: row.cap_amount,
      contentSnippet: row.content_snippet,
    }));

    const allPolicies = db.prepare('SELECT jurisdiction_name, category FROM policies p LEFT JOIN subsidy_rules r ON r.policy_id = p.id').all();
    const facets = {
      provinces: unique(allPolicies.map((item) => geoParts(item.jurisdiction_name).province)),
      cities: unique(allPolicies.map((item) => geoParts(item.jurisdiction_name).city)),
      districts: unique(allPolicies.map((item) => geoParts(item.jurisdiction_name).district)),
      categories: unique(allPolicies.map((item) => item.category)),
    };

    return jsonResponse(res, 200, { sources: rows.map((row) => ({
      ...sourceView(row),
      documentCount: row.document_count,
      importedCount: row.imported_count,
      lastDocumentAt: row.last_document_at,
    })), policies, facets, filters: { province, city, district, category, q } });
  }

  if (pathname === '/api/import' && req.method === 'POST') {
    const actor = requireRole(db, req, ['admin', 'reviewer', 'contributor']);
    const payload = await parsePayload(req);
    const file = payload.files.find((item) => item.field === 'file');
    if (!file) throw httpError('请上传 JSON 或 CSV 文件');
    const text = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    let rows = [];
    if (file.filename.toLowerCase().endsWith('.json')) {
      const data = JSON.parse(text);
      rows = Array.isArray(data) ? data : [data];
    } else if (file.filename.toLowerCase().endsWith('.csv')) {
      const lines = text.split(/\r?\n/).filter(Boolean);
      const headers = lines.shift().split(',').map((value) => value.trim());
      rows = lines.map((line) => Object.fromEntries(line.split(',').map((value, index) => [headers[index], value.trim()])));
    } else {
      throw httpError('只支持 JSON 或 CSV');
    }
    if (rows.length > 1000) throw httpError('单次最多导入 1000 条');
    const imported = [];
    for (const row of rows) {
      const created = insertContribution(db, actor, row);
      imported.push(created.id);
    }
    return jsonResponse(res, 201, { imported: imported.length, ids: imported });
  }

  if (pathname === '/api/policies' && req.method === 'GET') {
    const filters = [];
    const values = [];
    const q = String(url.searchParams.get('q') || '').trim();
    const category = String(url.searchParams.get('category') || '').trim();
    const jurisdiction = String(url.searchParams.get('jurisdiction') || '').trim();
    if (q) {
      filters.push('(p.title LIKE ? OR p.issuer LIKE ? OR p.source_url LIKE ?)');
      values.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (category) {
      filters.push('r.category LIKE ?');
      values.push(`%${category}%`);
    }
    if (jurisdiction) {
      filters.push('p.jurisdiction_name LIKE ?');
      values.push(`%${jurisdiction}%`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT p.*, r.category, r.amount_type, r.rate, r.fixed_amount, r.cap_amount
      FROM policies p LEFT JOIN subsidy_rules r ON r.policy_id = p.id
      ${where}
      ORDER BY p.updated_at DESC LIMIT 500
    `).all(...values);
    return jsonResponse(res, 200, { policies: rows.map((row) => ({
      id: row.id, title: row.title, program: row.program, level: row.policy_level, issuer: row.issuer,
      fundingSource: row.funding_source,
      jurisdictionName: row.jurisdiction_name, status: row.status, effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to, sourceUrl: row.source_url, category: row.category,
      amountType: row.amount_type, rate: row.rate, fixedAmount: row.fixed_amount, capAmount: row.cap_amount,
    })) });
  }

  if (pathname === '/api/aggregates' && req.method === 'GET') {
    const rows = db.prepare('SELECT * FROM disbursement_aggregates ORDER BY as_of_date DESC, metric_type ASC').all();
    return jsonResponse(res, 200, { aggregates: rows.map((row) => ({
      id: row.id,
      jurisdictionName: row.jurisdiction_name,
      program: row.program,
      metricType: row.metric_type,
      amountYuan: row.amount_yuan,
      countValue: row.count_value,
      unit: row.unit,
      asOfDate: row.as_of_date,
      sourceUrl: row.source_url,
      quote: row.quote,
    })) });
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    const rows = db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 200').all();
    return jsonResponse(res, 200, { events: rows.map((row) => ({ ...row, detail: parseJson(row.detail, null) })) });
  }

  if (pathname === '/api/import-runs' && req.method === 'GET') {
    requireRole(db, req, ['admin']);
    const rows = db.prepare('SELECT * FROM import_runs ORDER BY created_at DESC LIMIT 100').all();
    return jsonResponse(res, 200, { importRuns: rows.map((row) => ({
      id: row.id,
      packId: row.pack_id,
      version: row.pack_version,
      packPath: row.pack_path,
      summary: parseJson(row.summary_json, null),
      dryRun: Boolean(row.dry_run),
      createdAt: row.created_at,
    })) });
  }
  throw httpError('接口不存在', 404);
}

async function handleRequest(db, req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(db, req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError('不支持的方法', 405);
    const filePath = resolvePublicFile(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!filePath) throw httpError('文件不存在', 404);
    let data = await readFile(filePath);
    if (basename(filePath) === 'index.html') {
      const basePath = String(process.env.APP_BASE_PATH || '').replace(/\/$/, '');
      data = Buffer.from(data.toString('utf8').replaceAll('__APP_BASE_PATH__', basePath), 'utf8');
    }
    const type = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
    const extension = extname(filePath).toLowerCase();
    const cacheControl = ['.html', '.js', '.css'].includes(extension) ? 'no-cache' : 'public, max-age=300';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cacheControl });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (res.headersSent) return res.end();
    if (error.code === 'ENOENT') return sendError(res, httpError('页面不存在', 404));
    sendError(res, error);
  }
}

export function createServer(db = openDatabase()) {
  return http.createServer((req, res) => handleRequest(db, req, res));
}

export function startServer({ port = Number(process.env.PORT || 8787), host = process.env.HOST || '127.0.0.1' } = {}) {
  const db = openDatabase();
  const server = createServer(db);
  server.listen(port, host, () => {
    console.log(`国补协作平台已启动：http://${host}:${port}`);
  });
  if (process.env.AUTO_COLLECT === '1') {
    setInterval(() => {
      runDueCollections(db, 3).then((results) => {
        if (results.length) console.log('定时采集完成', JSON.stringify(results));
      }).catch((error) => console.error('定时采集失败', error));
    }, 10 * 60 * 1000).unref();
  }
  return { server, db };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) startServer();
