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
        category: '家电',
        amountType: 'percent',
        rate: 15,
        capAmount: 1000,
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

    const documentId = randomUUID();
    const parsed = {
      text: '2026年数码产品购新补贴通知，按最终销售价格的15%给予补贴，每件最高500元。',
      text_chars: 38,
      fields: {
        title: { value: '2026年数码产品购新补贴测试政策' },
        issuer: { value: '商务部' },
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
