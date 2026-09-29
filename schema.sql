PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'contributor'
    CHECK (role IN ('admin', 'reviewer', 'contributor', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  csrf_token TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'contributor'
    CHECK (role IN ('admin', 'reviewer', 'contributor', 'viewer')),
  note TEXT,
  expires_at TEXT,
  used_by TEXT REFERENCES users(id),
  used_at TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT NOT NULL
    CHECK (level IN ('national', 'province', 'city', 'district', 'other')),
  jurisdiction_code TEXT,
  jurisdiction_name TEXT,
  category TEXT,
  keywords TEXT,
  base_url TEXT,
  listing_url TEXT,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('html_listing', 'policy_page', 'open_api', 'manual_upload', 'other')),
  access_method TEXT NOT NULL DEFAULT 'manual'
    CHECK (access_method IN ('manual', 'scheduled', 'api')),
  frequency TEXT NOT NULL DEFAULT 'weekly'
    CHECK (frequency IN ('manual', 'daily', 'weekly', 'monthly')),
  enabled INTEGER NOT NULL DEFAULT 1,
  compliance_note TEXT,
  interval_minutes INTEGER,
  last_run_status TEXT,
  last_error TEXT,
  last_fetched_at TEXT,
  next_fetch_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contributions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'in_review', 'changes_requested', 'approved', 'rejected')),
  title TEXT NOT NULL,
  program TEXT,
  policy_level TEXT,
  issuer TEXT,
  funding_source TEXT,
  official_file_name TEXT,
  doc_no TEXT,
  description TEXT,
  end_note TEXT,
  document_type TEXT,
  jurisdiction_code TEXT,
  jurisdiction_name TEXT,
  jurisdiction_city TEXT,
  jurisdiction_district TEXT,
  category TEXT,
  amount_type TEXT DEFAULT 'unknown'
    CHECK (amount_type IN ('percent', 'fixed', 'tiered', 'other', 'unknown')),
  amount_value REAL,
  rate REAL,
  cap_amount REAL,
  cap_unit TEXT,
  rule_text TEXT,
  rule_type TEXT,
  threshold_amount REAL,
  discount_amount REAL,
  per_user_limit INTEGER,
  stackable INTEGER,
  conditions_text TEXT,
  effective_from TEXT,
  effective_to TEXT,
  source_url TEXT,
  notes TEXT,
  extracted_json TEXT,
  validation_json TEXT,
  dedup_key TEXT,
  duplicate_of TEXT REFERENCES contributions(id),
  document_id TEXT REFERENCES documents(id),
  reviewer_id TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES sources(id),
  contribution_id TEXT REFERENCES contributions(id),
  url TEXT,
  canonical_url TEXT,
  title TEXT,
  mime_type TEXT,
  byte_size INTEGER,
  content_hash TEXT,
  raw_path TEXT,
  extracted_text TEXT,
  extracted_json TEXT,
  status TEXT NOT NULL DEFAULT 'fetched'
    CHECK (status IN ('discovered', 'fetched', 'parsed', 'ocr_required', 'processed', 'failed')),
  error TEXT,
  fetched_by TEXT REFERENCES users(id),
  fetched_at TEXT,
  parsed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  contribution_id TEXT NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  contribution_id TEXT NOT NULL UNIQUE REFERENCES contributions(id),
  title TEXT NOT NULL,
  official_file_name TEXT,
  doc_no TEXT,
  program TEXT,
  policy_level TEXT,
  issuer TEXT,
  funding_source TEXT,
  description TEXT,
  end_note TEXT,
  document_type TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  verified_at TEXT,
  verified_by TEXT REFERENCES users(id),
  jurisdiction_code TEXT,
  jurisdiction_name TEXT,
  jurisdiction_city TEXT,
  jurisdiction_district TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'superseded', 'unknown')),
  effective_from TEXT,
  effective_to TEXT,
  source_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subsidy_rules (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  category TEXT,
  amount_type TEXT NOT NULL DEFAULT 'unknown',
  rate REAL,
  fixed_amount REAL,
  cap_amount REAL,
  cap_unit TEXT,
  rule_text TEXT,
  rule_type TEXT,
  threshold_amount REAL,
  discount_amount REAL,
  per_user_limit INTEGER,
  stackable INTEGER,
  conditions_text TEXT,
  conditions_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES documents(id),
  field_name TEXT NOT NULL,
  quote TEXT,
  page_number INTEGER,
  confidence REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disbursement_aggregates (
  id TEXT PRIMARY KEY,
  jurisdiction_code TEXT,
  jurisdiction_name TEXT NOT NULL,
  program TEXT,
  metric_type TEXT NOT NULL
    CHECK (metric_type IN ('allocated_funds', 'disbursed_funds', 'driven_sales', 'beneficiary_count', 'other')),
  amount_yuan REAL,
  count_value REAL,
  unit TEXT,
  period_start TEXT,
  period_end TEXT,
  as_of_date TEXT,
  source_url TEXT NOT NULL,
  quote TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_runs (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  pack_version TEXT NOT NULL,
  pack_path TEXT NOT NULL,
  summary_json TEXT,
  dry_run INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contributions_status ON contributions(status);
CREATE INDEX IF NOT EXISTS idx_contributions_dedup_key ON contributions(dedup_key);
CREATE INDEX IF NOT EXISTS idx_contributions_jurisdiction ON contributions(jurisdiction_name, category);
CREATE INDEX IF NOT EXISTS idx_documents_contribution ON documents(contribution_id);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_sources_enabled ON sources(enabled, next_fetch_at);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_aggregates_scope ON disbursement_aggregates(jurisdiction_name, metric_type, as_of_date);
CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
