import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('注册、提交、审核和发布主流程可运行', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'guobu-hub-test-'));
  process.env.DATA_DIR = dataDir;
  process.env.ALLOW_REGISTRATION = '1';
  const { openDatabase } = await import('../src/db.js');
  const { createServer } = await import('../src/server.js');
  const db = openDatabase();
  const server = createServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  let csrfToken = '';

  async function request(path, options = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrfToken && !['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase()) ? { 'X-CSRF-Token': csrfToken } : {}),
        ...(options.headers || {}),
      },
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const body = await response.json();
    return { response, body };
  }

  try {
    const registered = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'tester', displayName: '测试员', password: 'password123' }),
    });
    assert.equal(registered.response.status, 201);
    assert.equal(registered.body.user.role, 'admin');
    csrfToken = registered.body.csrfToken;
    assert.ok(csrfToken);

    const csrfFailure = await fetch(`${base}/api/contributions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ title: '缺少 CSRF 的请求' }),
    });
    assert.equal(csrfFailure.status, 403);

    const created = await request('/api/contributions', {
      method: 'POST',
      body: JSON.stringify({
        title: '测试家电以旧换新补贴政策',
        program: '家电以旧换新',
        policyLevel: 'province',
        issuer: '广东省商务厅',
        jurisdictionName: '广东省',
        jurisdictionCity: '广州市',
        jurisdictionDistrict: '天河区',
        fundingSource: '广东省财政',
        officialFileName: '广东省家电以旧换新实施细则',
        docNo: '粤商务〔2026〕1号',
        category: '家电',
        amountType: 'percent',
        rate: 15,
        capAmount: 1000,
        ruleText: '按销售价格的15%补贴',
        ruleType: 'percentage',
        effectiveFrom: '2026-04-01',
        effectiveTo: '2026-12-31',
        sourceUrl: 'https://example.com/policy.html',
        autoFetch: '0',
        notes: '测试记录',
      }),
    });
    assert.equal(created.response.status, 201);
    const id = created.body.contribution.id;

    const upload = new FormData();
    upload.set('title', '人工上传测试');
    upload.set('autoFetch', '0');
    upload.set('file', new Blob([readFileSync(join(__dirname, 'fixtures', 'sample-policy.html'))], { type: 'text/html' }), 'sample-policy.html');
    const uploaded = await request('/api/contributions', { method: 'POST', body: upload });
    assert.equal(uploaded.response.status, 201);
    assert.equal(uploaded.body.contribution.rate, 15);
    assert.equal(uploaded.body.contribution.capAmount, 1000);
    assert.equal(uploaded.body.contribution.jurisdictionName, '广东');

    const submitted = await request(`/api/contributions/${id}/submit`, { method: 'POST', body: '{}' });
    assert.equal(submitted.response.status, 200);
    assert.equal(submitted.body.contribution.status, 'submitted');

    const approved = await request(`/api/contributions/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ action: 'approve' }),
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body.contribution.status, 'approved');

    const policies = await request('/api/policies');
    assert.equal(policies.body.policies.length, 1);
    assert.equal(policies.body.policies[0].rate, 15);
    assert.equal(policies.body.policies[0].fundingSource, '广东省财政');
    assert.equal(policies.body.policies[0].officialFileName, '广东省家电以旧换新实施细则');
    assert.equal(policies.body.policies[0].ruleText, '按销售价格的15%补贴');

    const policyId = policies.body.policies[0].id;
    const editedPolicy = await request(`/api/policies/${policyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: '广东省2026年家电以旧换新实施细则（已编辑）', capAmount: 1200 }),
    });
    assert.equal(editedPolicy.response.status, 200);
    const editedRow = db.prepare('SELECT title, cap_amount FROM policies p LEFT JOIN subsidy_rules r ON r.policy_id = p.id WHERE p.id = ?').get(policyId);
    assert.equal(editedRow.title, '广东省2026年家电以旧换新实施细则（已编辑）');
    assert.equal(editedRow.cap_amount, 1200);

    const documentId = randomUUID();
    const parsed = {
      text: '2026年数码产品购新补贴通知，按最终销售价格的15%给予补贴，每件最高500元。',
      text_chars: 38,
      fields: {
        title: { value: '2026年数码产品购新补贴测试政策' },
        document_type: { value: 'policy' },
        issuer: { value: '商务部' },
        funding_source: { value: '中央财政' },
        jurisdiction_name: { value: '全国' },
        category: { value: '数码' },
        amount_type: { value: 'percent' },
        rate: { value: 15 },
        cap_amount: { value: 500 },
        effective_from: { value: '2026-01-01' },
      },
      evidence: [{ field_name: 'rate', quote: '按最终销售价格的15%给予补贴', confidence: 0.95 }],
      warnings: [],
      relevance: { score: 35, level: 'medium', isRelated: true, summary: '命中关键词：国补、补贴、数码' },
    };
    db.prepare(`
      INSERT INTO documents (id, url, canonical_url, title, mime_type, status, extracted_json, extracted_text, fetched_at, parsed_at, created_at)
      VALUES (?, ?, ?, ?, 'text/html', 'processed', ?, ?, ?, ?, ?)
    `).run(
      documentId,
      'https://www.gov.cn/test-digit.html',
      'https://www.gov.cn/test-digit.html',
      '2026年数码产品购新补贴测试政策',
      JSON.stringify(parsed),
      parsed.text,
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const importedDocument = await request(`/api/documents/${documentId}/import`, { method: 'POST', body: '{}' });
    assert.equal(importedDocument.response.status, 201);
    assert.equal(importedDocument.body.duplicate, false);
    assert.ok(importedDocument.body.policyId);

    const manualDocumentId = randomUUID();
    const manualParsed = {
      text: '上海宝山区家电专项消费券活动，满2000减300。',
      text_chars: 29,
      fields: {
        title: { value: '上海宝山区家电专项消费券' },
        document_type: { value: 'unknown' },
        jurisdiction_name: { value: '上海' },
      },
      evidence: [{ field_name: 'rule_text', quote: '满2000减300', confidence: 0.9 }],
      warnings: [],
      relevance: { score: 12, level: 'low', isRelated: false, importable: false, summary: '人工确认' },
    };
    db.prepare(`
      INSERT INTO documents (id, url, canonical_url, title, mime_type, status, extracted_json, extracted_text, fetched_at, parsed_at, created_at)
      VALUES (?, ?, ?, ?, 'text/html', 'processed', ?, ?, ?, ?, ?)
    `).run(
      manualDocumentId,
      'https://www.shanghai.gov.cn/test-manual.html',
      'https://www.shanghai.gov.cn/test-manual.html',
      '上海宝山区家电专项消费券',
      JSON.stringify(manualParsed),
      manualParsed.text,
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const manualForm = new FormData();
    manualForm.set('title', '上海宝山区家电专项消费券');
    manualForm.set('documentType', 'notice');
    manualForm.set('fundingSource', '区级财政');
    manualForm.set('category', '家电、数码');
    manualForm.set('jurisdictionName', '上海市');
    manualForm.set('jurisdictionCity', '上海市');
    manualForm.set('jurisdictionDistrict', '宝山区');
    manualForm.set('ruleText', '满2000减300');
    manualForm.set('capAmount', '300');
    manualForm.set('amountType', 'tiered');
    manualForm.set('officialFileName', '宝山区商务委公告');
    manualForm.set('force', '1');
    const manualImport = await request(`/api/documents/${manualDocumentId}/import`, { method: 'POST', body: manualForm });
    assert.equal(manualImport.response.status, 201);
    const manualPolicy = db.prepare('SELECT jurisdiction_name, jurisdiction_city, jurisdiction_district, verification_status FROM policies WHERE id = ?').get(manualImport.body.policyId);
    assert.equal(manualPolicy.jurisdiction_name, '上海市');
    assert.equal(manualPolicy.jurisdiction_city, '上海市');
    assert.equal(manualPolicy.jurisdiction_district, '宝山区');
    assert.equal(manualPolicy.verification_status, 'pending');

    const invite = await request('/api/invites', {
      method: 'POST',
      body: JSON.stringify({ role: 'reviewer', note: '测试审核员' }),
    });
    assert.equal(invite.response.status, 201);
    process.env.ALLOW_REGISTRATION = '0';
    const invitedResponse = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'reviewer1', displayName: '审核员一', password: 'password123', inviteCode: invite.body.invite.code }),
    });
    const invitedBody = await invitedResponse.json();
    assert.equal(invitedResponse.status, 201);
    assert.equal(invitedBody.user.role, 'reviewer');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
