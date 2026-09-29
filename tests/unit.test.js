import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDedupKey, validateContribution } from '../src/validation.js';
import { analyzeGuobuRelevance, runDocumentParser } from '../src/extract.js';
import { inferGeo } from '../src/geo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('政策字段校验拒绝非法比例和日期范围', () => {
  const result = validateContribution({
    title: '测试补贴政策',
    amountType: 'percent',
    rate: 150,
    effectiveFrom: '2026-12-31',
    effectiveTo: '2026-01-01',
  });
  assert.ok(result.errors.some((item) => item.includes('0-100')));
  assert.ok(result.errors.some((item) => item.includes('生效日期')));
});

test('去重键对同一政策的文本差异保持稳定', () => {
  const a = computeDedupKey({
    title: ' 广东省 2026 年家电以旧换新实施细则 ',
    issuer: '广东省商务厅',
    effectiveFrom: '2026-04-01',
  });
  const b = computeDedupKey({
    title: '广东省2026年家电以旧换新实施细则',
    issuer: '广东省商务厅',
    effectiveFrom: '2026-04-01',
  });
  assert.equal(a, b);
});

test('HTML 文档能够抽取比例、上限、地区和有效期', () => {
  const parsed = runDocumentParser(join(__dirname, 'fixtures', 'sample-policy.html'), {
    originalName: 'sample-policy.html',
    mimeType: 'text/html',
    allowOcr: false,
  });
  assert.equal(parsed.status, 'processed');
  assert.equal(parsed.fields.rate.value, 15);
  assert.equal(parsed.fields.cap_amount.value, 1000);
  assert.equal(parsed.fields.funding_source.value, '中央财政/超长期特别国债');
  assert.equal(parsed.fields.jurisdiction_name.value, '广东');
  assert.equal(parsed.fields.effective_from.value, '2026-04-01');
  assert.equal(parsed.fields.effective_to.value, '2026-12-31');
  assert.equal(parsed.links[0].text, '广东省汽车置换更新补贴通知');
});

test('国补相关度识别能区分国补政策和普通页面', () => {
  const related = analyzeGuobuRelevance({
    text: '消费品以旧换新补贴实施细则，对家电产品给予补贴。',
    fields: { title: { value: '2026年家电以旧换新补贴通知' } },
  });
  const unrelated = analyzeGuobuRelevance({ text: '本公司提供软件开发和技术咨询服务。', fields: {} });
  assert.equal(related.isRelated, true);
  assert.ok(related.score >= 20);
  assert.equal(unrelated.isRelated, false);
});


test('地区归一化能识别城市所属省份并防止省市串档', () => {
  const guangzhou = inferGeo({ jurisdictionName: '广州市广州市' });
  assert.deepEqual(guangzhou, { province: '广东省', city: '广州市', district: '' });
  const shanghai = inferGeo({ jurisdictionName: '上海', city: '上海市', district: '宝山区' });
  assert.deepEqual(shanghai, { province: '上海市', city: '上海市', district: '宝山区' });
  const anqing = inferGeo({ jurisdictionName: '安徽省', city: '安庆市' });
  assert.equal(anqing.province, '安徽省');
  assert.equal(anqing.city, '安庆市');
});
