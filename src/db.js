import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const envPath = join(rootDir, '.env');
if (existsSync(envPath)) loadEnvFile(envPath);

function dataDirectory() {
  const configured = process.env.DATA_DIR;
  if (!configured) return join(rootDir, 'data');
  return isAbsolute(configured) ? configured : resolve(rootDir, configured);
}

export const paths = {
  root: rootDir,
  public: join(rootDir, 'public'),
  schema: join(rootDir, 'schema.sql'),
  data: dataDirectory(),
};

export const nowIso = () => new Date().toISOString();
export const newId = () => randomUUID();

export function openDatabase() {
  mkdirSync(paths.data, { recursive: true });
  const dbPath = join(paths.data, 'guobu.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(paths.schema, 'utf8'));
  migrateDatabase(db);
  return db;
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrateDatabase(db) {
  ensureColumn(db, 'sessions', 'csrf_token', 'TEXT');
  ensureColumn(db, 'users', 'last_login_at', 'TEXT');
  ensureColumn(db, 'users', 'password_changed_at', 'TEXT');
  ensureColumn(db, 'sources', 'category', 'TEXT');
  ensureColumn(db, 'sources', 'keywords', 'TEXT');
  ensureColumn(db, 'sources', 'interval_minutes', 'INTEGER');
  ensureColumn(db, 'sources', 'last_run_status', 'TEXT');
  ensureColumn(db, 'sources', 'last_error', 'TEXT');
  ensureColumn(db, 'contributions', 'funding_source', 'TEXT');
  ensureColumn(db, 'contributions', 'cap_unit', 'TEXT');
  ensureColumn(db, 'contributions', 'official_file_name', 'TEXT');
  ensureColumn(db, 'contributions', 'doc_no', 'TEXT');
  ensureColumn(db, 'contributions', 'description', 'TEXT');
  ensureColumn(db, 'contributions', 'end_note', 'TEXT');
  ensureColumn(db, 'contributions', 'document_type', 'TEXT');
  ensureColumn(db, 'contributions', 'jurisdiction_city', 'TEXT');
  ensureColumn(db, 'contributions', 'jurisdiction_district', 'TEXT');
  ensureColumn(db, 'contributions', 'rule_text', 'TEXT');
  ensureColumn(db, 'contributions', 'rule_type', 'TEXT');
  ensureColumn(db, 'contributions', 'threshold_amount', 'REAL');
  ensureColumn(db, 'contributions', 'discount_amount', 'REAL');
  ensureColumn(db, 'contributions', 'per_user_limit', 'INTEGER');
  ensureColumn(db, 'contributions', 'stackable', 'INTEGER');
  ensureColumn(db, 'contributions', 'conditions_text', 'TEXT');
  ensureColumn(db, 'policies', 'funding_source', 'TEXT');
  ensureColumn(db, 'policies', 'official_file_name', 'TEXT');
  ensureColumn(db, 'policies', 'doc_no', 'TEXT');
  ensureColumn(db, 'policies', 'description', 'TEXT');
  ensureColumn(db, 'policies', 'end_note', 'TEXT');
  ensureColumn(db, 'policies', 'jurisdiction_city', 'TEXT');
  ensureColumn(db, 'policies', 'jurisdiction_district', 'TEXT');
  ensureColumn(db, 'policies', 'document_type', 'TEXT');
  ensureColumn(db, 'policies', 'verification_status', "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn(db, 'policies', 'verified_at', 'TEXT');
  ensureColumn(db, 'policies', 'verified_by', 'TEXT');
  ensureColumn(db, 'subsidy_rules', 'cap_unit', 'TEXT');
  ensureColumn(db, 'subsidy_rules', 'rule_text', 'TEXT');
  ensureColumn(db, 'subsidy_rules', 'rule_type', 'TEXT');
  ensureColumn(db, 'subsidy_rules', 'threshold_amount', 'REAL');
  ensureColumn(db, 'subsidy_rules', 'discount_amount', 'REAL');
  ensureColumn(db, 'subsidy_rules', 'per_user_limit', 'INTEGER');
  ensureColumn(db, 'subsidy_rules', 'stackable', 'INTEGER');
  ensureColumn(db, 'subsidy_rules', 'conditions_text', 'TEXT');
}

export function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function asUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    lastLoginAt: row.last_login_at || null,
    passwordChangedAt: row.password_changed_at || null,
    createdAt: row.created_at,
  };
}

export function addEvent(db, { entityType, entityId, actorId, action, detail = null }) {
  db.prepare(`
    INSERT INTO events (id, entity_type, entity_id, actor_id, action, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(newId(), entityType, entityId, actorId, action, detail ? JSON.stringify(detail) : null, nowIso());
}

export function getContribution(db, id) {
  return db.prepare('SELECT * FROM contributions WHERE id = ?').get(id);
}

export function getDocument(db, id) {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
}

export function getSource(db, id) {
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
}

export function contributionView(row, db) {
  if (!row) return null;
  const document = row.document_id ? getDocument(db, row.document_id) : null;
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    title: row.title,
    program: row.program,
    policyLevel: row.policy_level,
    issuer: row.issuer,
    fundingSource: row.funding_source,
    officialFileName: row.official_file_name,
    docNo: row.doc_no,
    description: row.description,
    endNote: row.end_note,
    documentType: row.document_type,
    jurisdictionCode: row.jurisdiction_code,
    jurisdictionName: row.jurisdiction_name,
    jurisdictionCity: row.jurisdiction_city,
    jurisdictionDistrict: row.jurisdiction_district,
    category: row.category,
    amountType: row.amount_type,
    amountValue: row.amount_value,
    rate: row.rate,
    capAmount: row.cap_amount,
    capUnit: row.cap_unit,
    ruleText: row.rule_text,
    ruleType: row.rule_type,
    thresholdAmount: row.threshold_amount,
    discountAmount: row.discount_amount,
    perUserLimit: row.per_user_limit,
    stackable: row.stackable,
    conditionsText: row.conditions_text,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    sourceUrl: row.source_url,
    notes: row.notes,
    extracted: parseJson(row.extracted_json, null),
    validation: parseJson(row.validation_json, null),
    dedupKey: row.dedup_key,
    duplicateOf: row.duplicate_of,
    documentId: row.document_id,
    document: document ? documentView(document) : null,
    reviewerId: row.reviewer_id,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function documentView(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    contributionId: row.contribution_id,
    url: row.url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    contentHash: row.content_hash,
    rawPath: row.raw_path,
    text: row.extracted_text,
    extracted: parseJson(row.extracted_json, null),
    status: row.status,
    error: row.error,
    fetchedBy: row.fetched_by,
    fetchedAt: row.fetched_at,
    parsedAt: row.parsed_at,
    createdAt: row.created_at,
  };
}

export function sourceView(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    level: row.level,
    jurisdictionCode: row.jurisdiction_code,
    jurisdictionName: row.jurisdiction_name,
    baseUrl: row.base_url,
    listingUrl: row.listing_url,
    sourceType: row.source_type,
    accessMethod: row.access_method,
    frequency: row.frequency,
    enabled: Boolean(row.enabled),
    complianceNote: row.compliance_note,
    intervalMinutes: row.interval_minutes,
    lastRunStatus: row.last_run_status,
    lastError: row.last_error,
    lastFetchedAt: row.last_fetched_at,
    nextFetchAt: row.next_fetch_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
