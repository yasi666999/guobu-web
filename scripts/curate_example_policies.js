import { getDocument, nowIso, openDatabase } from '../src/db.js';
import { fetchAndStore } from '../src/collector.js';
import { importDocumentAsPolicy } from '../src/server.js';

const db = openDatabase();
const actor = db.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get();
if (!actor) throw new Error('没有可用用户，请先注册账号');
const timestamp = nowIso();

function updatePolicyByTitle(titleLike, fields) {
  const policy = db.prepare('SELECT id FROM policies WHERE title LIKE ? AND jurisdiction_name = ? ORDER BY created_at LIMIT 1').get(`%${titleLike}%`, '全国');
  if (!policy) return 0;
  db.prepare(`
    UPDATE policies SET official_file_name = ?, doc_no = ?, funding_source = ?, description = ?,
      end_note = ?, effective_to = ?, updated_at = ? WHERE id = ?
  `).run(fields.officialFileName, fields.docNo, fields.fundingSource, fields.description, fields.endNote, fields.effectiveTo || null, timestamp, policy.id);
  db.prepare('UPDATE subsidy_rules SET cap_unit = ?, conditions_json = ? WHERE policy_id = ?')
    .run(fields.capUnit, JSON.stringify({ curated: true, description: fields.description }), policy.id);
  return 1;
}

let updated = 0;
updated += updatePolicyByTitle('2026年家电以旧换新补贴', {
  officialFileName: '商务部等5部门办公厅（室）关于做好2026年家电以旧换新、数码和智能产品购新补贴工作的通知',
  docNo: '商办流通函〔2025〕469号、发改环资〔2025〕1745号',
  fundingSource: '中央财政（超长期特别国债）',
  description: '冰箱、洗衣机、电视、空调、热水器、电脑；新机需一级能效/一级水效，必须旧机回收。',
  endNote: '额度用完提前截止',
  effectiveTo: '2026-12-31',
  capUnit: '元/件',
});
updated += updatePolicyByTitle('2026年数码和智能产品购新补贴', {
  officialFileName: '商务部等5部门办公厅（室）关于做好2026年家电以旧换新、数码和智能产品购新补贴工作的通知',
  docNo: '商办流通函〔2025〕469号、发改环资〔2025〕1745号',
  fundingSource: '中央财政（超长期特别国债）',
  description: '手机、平板、智能手表（手环）、智能眼镜；新机单品售价≤6000元，无需旧机回收。',
  endNote: '额度用完提前截止',
  effectiveTo: '2026-12-31',
  capUnit: '元/件',
});

const shanghaiUrl = 'https://sww.sh.gov.cn/zwgkgfqtzcwj/20260204/ae016541433f4cb9a60010d87d779e1f.html';
const fetched = await fetchAndStore(db, shanghaiUrl, { actorId: actor.id, title: '上海市2026年消费品以旧换新自主品类补贴政策实施细则', parse: true });
const document = getDocument(db, fetched.documentId);
const parsed = JSON.parse(document?.extracted_json || '{}');
const imported = importDocumentAsPolicy(db, fetched.documentId, actor.id, {
  title: '上海市消费品以旧换新自主品类补贴（智能家居）',
  officialFileName: '《上海市2026年消费品以旧换新自主品类补贴政策实施细则》',
  docNo: '上海市2026年消费品以旧换新自主品类补贴政策实施细则',
  fundingSource: '上海市级财政',
  description: '智能吸油烟机、智能家用燃气灶（含集成灶）、数码相机、智能净水器、智能洗碗机、智能马桶（含盖）、智能床/床垫、功能沙发/按摩椅、智能清洁机器人（扫地/擦窗）；需旧机回收。',
  endNote: '额度用完提前截止',
  jurisdictionName: '上海市',
  category: '智能家居',
  rate: 15,
  capAmount: 1500,
  capUnit: '元/件',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
});
if (!imported.duplicate) updated += 1;

console.log(JSON.stringify({ updated, shanghaiPolicyId: imported.policyId, shanghaiDocumentId: fetched.documentId, relevance: parsed.relevance || null }, null, 2));
db.close();
