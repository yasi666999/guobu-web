import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument, newId, nowIso, parseJson } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const parserPath = join(rootDir, 'python', 'parse_document.py');

export function findPython() {
  const runtimeRoot = resolve(dirname(process.execPath), '..', '..');
  const candidates = [
    process.env.PYTHON_BIN,
    join(runtimeRoot, 'python', 'python.exe'),
    'C:\\Users\\Lenovo\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe',
    'python',
    'python3',
    'py',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes('\\') || candidate.includes('/')) {
      if (existsSync(candidate)) return candidate;
    } else {
      const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
      if (!result.error && result.status === 0) return candidate;
    }
  }
  return null;
}

export function runDocumentParser(filePath, { originalName = '', mimeType = '', allowOcr = true, maxOcrPages = 8 } = {}) {
  const python = findPython();
  if (!python) {
    return { status: 'failed', error: '未找到 Python 运行时，无法解析文档' };
  }
  const args = [parserPath, filePath, '--original-name', originalName || '', '--mime', mimeType || '', '--max-ocr-pages', String(maxOcrPages)];
  if (!allowOcr) args.push('--no-ocr');
  const result = spawnSync(python, args, {
    encoding: 'utf8',
    timeout: 5 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (result.error) return { status: 'failed', error: result.error.message };
  const stdout = String(result.stdout || '').trim();
  if (!stdout) return { status: 'failed', error: String(result.stderr || '解析器没有返回结果').slice(0, 1000) };
  try {
    const parsed = JSON.parse(stdout);
    if (result.status !== 0 && !parsed.error) parsed.error = String(result.stderr || '解析失败').slice(0, 1000);
    return parsed;
  } catch (error) {
    return { status: 'failed', error: `解析器返回了无效 JSON：${error.message}` };
  }
}

function fieldValue(parsed, name) {
  const item = parsed?.fields?.[name];
  return item && typeof item === 'object' && 'value' in item ? item.value : item;
}

const RELEVANCE_KEYWORDS = [
  { word: '国补', weight: 12 },
  { word: '以旧换新', weight: 10 },
  { word: '消费品以旧换新', weight: 12 },
  { word: '大规模设备更新', weight: 9 },
  { word: '补贴', weight: 5 },
  { word: '补助', weight: 4 },
  { word: '实施细则', weight: 4 },
  { word: '申报', weight: 3 },
  { word: '汽车', weight: 3 },
  { word: '家电', weight: 3 },
  { word: '数码', weight: 3 },
  { word: '农机', weight: 3 },
  { word: '报废更新', weight: 4 },
  { word: '置换更新', weight: 4 },
];

const STRONG_KEYWORDS = ['国补', '消费品以旧换新', '以旧换新', '大规模设备更新'];
const CATEGORY_KEYWORDS = ['汽车', '家电', '数码', '手机', '平板', '智能手表', '农机', '电动自行车', '家装', '厨卫'];

export function analyzeGuobuRelevance(parsed) {
  const text = String(parsed?.text || '');
  const title = String(fieldValue(parsed, 'title') || '');
  const head = text.slice(0, 8000);
  let score = 0;
  const hits = [];
  for (const item of RELEVANCE_KEYWORDS) {
    const inText = text.includes(item.word);
    const inTitle = title.includes(item.word);
    if (!inText && !inTitle) continue;
    const weight = item.weight + (inTitle ? 5 : 0);
    score += weight;
    hits.push({ word: item.word, weight, inTitle });
  }
  const strongInTitle = STRONG_KEYWORDS.some((word) => title.includes(word)) || (CATEGORY_KEYWORDS.some((word) => title.includes(word)) && title.includes('补贴'));
  const strongInHead = STRONG_KEYWORDS.some((word) => head.includes(word)) || (CATEGORY_KEYWORDS.some((word) => head.includes(word)) && head.includes('补贴'));
  const level = score >= 40 ? 'high' : score >= 20 ? 'medium' : score >= 8 ? 'low' : 'none';
  const isRelated = strongInTitle || (strongInHead && score >= 30);
  return {
    score,
    level,
    hits,
    strongInTitle,
    strongInHead,
    isRelated,
    summary: hits.length ? `命中关键词：${hits.map((item) => item.word).join('、')}` : '未发现国补相关关键词',
  };
}

export function applyExtractionToDocument(db, documentId, parsed) {
  const document = getDocument(db, documentId);
  if (!document) throw new Error('文档不存在');
  const status = parsed.status === 'processed' ? 'processed' : parsed.status === 'ocr_required' ? 'ocr_required' : 'failed';
  db.prepare(`
    UPDATE documents
    SET title = COALESCE(NULLIF(?, ''), title),
        extracted_text = ?,
        extracted_json = ?,
        status = ?,
        error = ?,
        parsed_at = ?
    WHERE id = ?
  `).run(
    String(fieldValue(parsed, 'title') || ''),
    parsed.text || '',
    JSON.stringify(parsed),
    status,
    parsed.error || (parsed.warnings || []).join('；') || null,
    nowIso(),
    documentId,
  );
  return getDocument(db, documentId);
}

export function parseDocument(db, documentId, options = {}) {
  const document = getDocument(db, documentId);
  if (!document) throw new Error('文档不存在');
  if (!document.raw_path) throw new Error('文档没有原始快照，无法解析');
  const parsed = runDocumentParser(document.raw_path, {
    originalName: document.canonical_url || document.url || '',
    mimeType: document.mime_type || '',
    allowOcr: options.allowOcr !== false,
    maxOcrPages: options.maxOcrPages || 8,
  });
  parsed.relevance = analyzeGuobuRelevance(parsed);
  return applyExtractionToDocument(db, documentId, parsed);
}

export function mergeExtractedFields(base, parsed) {
  const merged = { ...base };
  const fields = parsed?.fields || {};
  const map = {
    title: 'title',
    program: 'program',
    issuer: 'issuer',
    jurisdiction_name: 'jurisdictionName',
    category: 'category',
    amount_type: 'amountType',
    amount_value: 'amountValue',
    rate: 'rate',
    cap_amount: 'capAmount',
    effective_from: 'effectiveFrom',
    effective_to: 'effectiveTo',
  };
  for (const [source, target] of Object.entries(map)) {
    const candidate = fields[source];
    const value = candidate && typeof candidate === 'object' && 'value' in candidate ? candidate.value : candidate;
    if ((merged[target] == null || merged[target] === '') && value != null && value !== '') merged[target] = value;
  }
  return merged;
}

const DISCOVERY_KEYWORDS = [
  '以旧换新', '补贴', '设备更新', '国补', '实施细则', '资金', '通知', '公告', '方案', '政策',
];

export function extractCandidateLinks(parsed, baseUrl) {
  const links = parsed?.links || [];
  const candidates = [];
  const seen = new Set();
  for (const item of links) {
    const href = String(item.href || '').trim();
    const text = String(item.text || '').trim();
    if (!href) continue;
    let absolute;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(absolute) || seen.has(absolute)) continue;
    if (!DISCOVERY_KEYWORDS.some((keyword) => text.includes(keyword) || absolute.includes(keyword))) continue;
    seen.add(absolute);
    candidates.push({ url: absolute, title: text || absolute, discoveredAt: nowIso() });
    if (candidates.length >= 50) break;
  }
  return candidates;
}

export function createDiscoveredDocuments(db, sourceId, contributionId, candidates) {
  const insert = db.prepare(`
    INSERT INTO documents (id, source_id, contribution_id, url, canonical_url, title, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'discovered', ?)
  `);
  let count = 0;
  for (const candidate of candidates) {
    const exists = db.prepare('SELECT id FROM documents WHERE canonical_url = ? LIMIT 1').get(candidate.url);
    if (exists) continue;
    insert.run(newId(), sourceId || null, contributionId || null, candidate.url, candidate.url, candidate.title, nowIso());
    count += 1;
  }
  return count;
}

export function extractedFieldSummary(parsed) {
  const fields = parsed?.fields || {};
  return {
    title: fieldValue(parsed, 'title') || '',
    officialFileName: fieldValue(parsed, 'title') || '',
    docNo: fieldValue(parsed, 'doc_no') || '',
    docNo: fieldValue(parsed, 'doc_no') || '',
    issuer: fieldValue(parsed, 'issuer') || '',
    fundingSource: fieldValue(parsed, 'funding_source') || '',
    jurisdictionName: fieldValue(parsed, 'jurisdiction_name') || '',
    jurisdictionCity: fieldValue(parsed, 'jurisdiction_city') || '',
    jurisdictionDistrict: fieldValue(parsed, 'jurisdiction_district') || '',
    category: fieldValue(parsed, 'category') || '',
    program: fieldValue(parsed, 'program') || '',
    amountType: fieldValue(parsed, 'amount_type') || 'unknown',
    amountValue: fieldValue(parsed, 'amount_value') ?? null,
    rate: fieldValue(parsed, 'rate') ?? null,
    capAmount: fieldValue(parsed, 'cap_amount') ?? null,
    capUnit: fieldValue(parsed, 'cap_unit') || '元',
    ruleText: fieldValue(parsed, 'rule_text') || '',
    description: Array.isArray(fieldValue(parsed, 'conditions'))
      ? fieldValue(parsed, 'conditions').join('；')
      : String(fieldValue(parsed, 'conditions') || ''),
    endNote: fieldValue(parsed, 'end_note') || '',
    effectiveFrom: fieldValue(parsed, 'effective_from') || '',
    effectiveTo: fieldValue(parsed, 'effective_to') || '',
  };
}

export function documentExtractionJson(document) {
  return parseJson(document?.extracted_json, null);
}
