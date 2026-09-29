import { newId, nowIso, openDatabase } from '../src/db.js';
import { computeDedupKey } from '../src/validation.js';

const APPLIANCE_URL = 'https://www.gov.cn/zhengce/zhengceku/202512/content_7053369.htm';
const AUTO_URL = 'https://www.gov.cn/zhengce/zhengceku/202512/content_7053324.htm';
const ALLOCATION_URL = 'https://www.gov.cn/lianbo/202608/content_7078928.htm';
const SALES_URL = 'https://www.gov.cn/yaowen/liebiao/202609/content_7079762.htm';

const ITEMS = [
  {
    title: '2026年家电以旧换新补贴',
    issuer: '商务部办公厅等5部门',
    category: '家电',
    rate: 15,
    capAmount: 1500,
    sourceUrl: APPLIANCE_URL,
    notes: '全国统一标准。对1级能效或水效标准的冰箱、洗衣机、电视、空调、热水器、电脑6类家电产品，按扣除优惠后最终销售价格的15%补贴；每人每类可补贴1件，每件不超过1500元。',
    quote: '补贴标准为上述产品扣除各环节优惠后最终销售价格的15%，每人每类可补贴1件，其中，家电产品每件补贴不超过1500元',
  },
  {
    title: '2026年数码和智能产品购新补贴',
    issuer: '商务部办公厅等5部门',
    category: '数码',
    rate: 15,
    capAmount: 500,
    sourceUrl: APPLIANCE_URL,
    notes: '适用于单价不超过6000元的手机、平板、智能手表（手环）、智能眼镜。按最终销售价格的15%补贴，每人每类可补贴1件，每件不超过500元。',
    quote: '单件销售价格不超过6000元的手机、平板、智能手表（手环）、智能眼镜4类数码和智能产品给予补贴……数码和智能产品每件补贴不超过500元',
  },
  {
    title: '2026年汽车报废更新补贴·新能源乘用车',
    issuer: '商务部办公厅等8部门',
    category: '汽车',
    rate: 12,
    capAmount: 20000,
    sourceUrl: AUTO_URL,
    notes: '报废符合条件的旧车并购买纳入目录的新能源乘用车，按新车销售价格（价税合计）的12%补贴，最高2万元。每位消费者只能享受一次汽车报废更新或置换更新补贴。',
    quote: '对报废上述符合条件旧车并购买新能源乘用车的，按新车销售价格的12%给予补贴，补贴金额最高2万元',
  },
  {
    title: '2026年汽车报废更新补贴·2.0升及以下燃油乘用车',
    issuer: '商务部办公厅等8部门',
    category: '汽车',
    rate: 10,
    capAmount: 15000,
    sourceUrl: AUTO_URL,
    notes: '报废符合条件的燃油乘用车并购买2.0升及以下排量燃油乘用车，按新车销售价格的10%补贴，最高1.5万元。',
    quote: '对报废上述符合条件燃油乘用车并购买2.0升及以下排量燃油乘用车的，按新车销售价格的10%给予补贴，补贴金额最高1.5万元',
  },
  {
    title: '2026年汽车置换更新补贴·新能源乘用车',
    issuer: '商务部办公厅等8部门',
    category: '汽车',
    rate: 8,
    capAmount: 15000,
    sourceUrl: AUTO_URL,
    notes: '转让本人名下乘用车并购买纳入目录的新能源乘用车，按新车销售价格的8%补贴，最高1.5万元。',
    quote: '对换购符合上述条件新能源乘用车的，按新车销售价格的8%给予补贴，补贴金额最高1.5万元',
  },
  {
    title: '2026年汽车置换更新补贴·2.0升及以下燃油乘用车',
    issuer: '商务部办公厅等8部门',
    category: '汽车',
    rate: 6,
    capAmount: 13000,
    sourceUrl: AUTO_URL,
    notes: '转让本人名下乘用车并购买2.0升及以下排量燃油乘用车，按新车销售价格的6%补贴，最高1.3万元。',
    quote: '对换购符合上述条件燃油乘用车的，按新车销售价格的6%给予补贴，补贴金额最高1.3万元',
  },
];

const AGGREGATES = [
  {
    jurisdictionName: '全国', program: '消费品以旧换新', metricType: 'allocated_funds', amountYuan: 187_500_000_000,
    asOfDate: '2026-08-23', sourceUrl: ALLOCATION_URL,
    quote: '财政部多措并举继续支持鼓励消费，下达消费品以旧换新资金1875亿元',
  },
  {
    jurisdictionName: '全国', program: '消费品以旧换新', metricType: 'driven_sales', amountYuan: 1_320_000_000_000,
    asOfDate: '2026-08-23', sourceUrl: ALLOCATION_URL,
    quote: '下达消费品以旧换新资金1875亿元，带动相关商品销售额约1.32万亿元',
  },
  {
    jurisdictionName: '全国', program: '消费品以旧换新', metricType: 'beneficiary_count', countValue: 178_000_000, unit: '人次',
    asOfDate: '2026-08-23', sourceUrl: ALLOCATION_URL,
    quote: '下达消费品以旧换新资金1875亿元，带动相关商品销售额约1.32万亿元，惠及1.78亿人次',
  },
  {
    jurisdictionName: '全国', program: '消费品以旧换新', metricType: 'driven_sales', amountYuan: 1_540_000_000_000,
    asOfDate: '2026-08-30', sourceUrl: SALES_URL,
    quote: '截至8月30日，2026年消费品以旧换新累计带动相关商品销售超1.54万亿元',
  },
  {
    jurisdictionName: '全国', program: '消费品以旧换新', metricType: 'beneficiary_count', countValue: 206_000_000, unit: '人次',
    asOfDate: '2026-08-30', sourceUrl: SALES_URL,
    quote: '2026年消费品以旧换新累计带动相关商品销售超1.54万亿元，惠及超2.06亿人次',
  },
];

const db = openDatabase();
const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1").get();
if (!admin) {
  console.error('请先注册一个管理员账号，再运行此脚本。');
  process.exit(1);
}

const findContribution = db.prepare('SELECT * FROM contributions WHERE dedup_key = ? LIMIT 1');
const findPolicy = db.prepare('SELECT * FROM policies WHERE contribution_id = ?');
const insertContribution = db.prepare(`
  INSERT INTO contributions (
    id, user_id, status, title, program, policy_level, issuer, jurisdiction_name, category,
    amount_type, rate, cap_amount, effective_from, source_url, notes, validation_json,
    dedup_key, reviewer_id, reviewed_at, created_at, updated_at
  ) VALUES (?, ?, 'approved', ?, '消费品以旧换新', 'national', ?, '全国', ?, 'percent', ?, ?, '2026-01-01', ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertPolicy = db.prepare(`
  INSERT INTO policies (
    id, contribution_id, title, program, policy_level, issuer, jurisdiction_name,
    status, effective_from, source_url, created_at, updated_at
  ) VALUES (?, ?, ?, '消费品以旧换新', 'national', ?, '全国', 'active', '2026-01-01', ?, ?, ?)
`);
const insertRule = db.prepare(`
  INSERT INTO subsidy_rules (id, policy_id, category, amount_type, rate, cap_amount, created_at)
  VALUES (?, ?, ?, 'percent', ?, ?, ?)
`);
const insertEvidence = db.prepare(`
  INSERT INTO evidence (id, policy_id, field_name, quote, confidence, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

let policyCount = 0;
for (const item of ITEMS) {
  const dedupKey = computeDedupKey({
    title: item.title,
    issuer: item.issuer,
    effectiveFrom: '2026-01-01',
    jurisdictionName: '全国',
  });
  if (findContribution.get(dedupKey)) continue;
  const timestamp = nowIso();
  const contributionId = newId();
  const validation = {
    errors: [],
    warnings: ['由官方政策种子脚本导入；已绑定原文引文。'],
    value: { title: item.title, issuer: item.issuer, category: item.category, rate: item.rate, capAmount: item.capAmount },
  };
  insertContribution.run(
    contributionId, admin.id, item.title, item.issuer, item.category, item.rate, item.capAmount,
    item.sourceUrl, item.notes, JSON.stringify(validation), dedupKey, admin.id, timestamp, timestamp, timestamp,
  );
  const policyId = newId();
  insertPolicy.run(policyId, contributionId, item.title, item.issuer, item.sourceUrl, timestamp, timestamp);
  insertRule.run(newId(), policyId, item.category, item.rate, item.capAmount, timestamp);
  insertEvidence.run(newId(), policyId, 'rate', item.quote, 0.98, timestamp);
  insertEvidence.run(newId(), policyId, 'cap_amount', item.quote, 0.98, timestamp);
  policyCount += 1;
}

const findAggregate = db.prepare('SELECT id FROM disbursement_aggregates WHERE metric_type = ? AND as_of_date = ? AND source_url = ? LIMIT 1');
const insertAggregate = db.prepare(`
  INSERT INTO disbursement_aggregates (
    id, jurisdiction_name, program, metric_type, amount_yuan, count_value, unit,
    as_of_date, source_url, quote, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
let aggregateCount = 0;
for (const item of AGGREGATES) {
  if (findAggregate.get(item.metricType, item.asOfDate, item.sourceUrl)) continue;
  insertAggregate.run(
    newId(), item.jurisdictionName, item.program, item.metricType, item.amountYuan ?? null,
    item.countValue ?? null, item.unit || null, item.asOfDate, item.sourceUrl, item.quote, nowIso(),
  );
  aggregateCount += 1;
}

console.log(`官方数据补充完成：新增政策 ${policyCount} 条，新增执行统计 ${aggregateCount} 条。`);
db.close();
