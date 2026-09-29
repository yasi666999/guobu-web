import { openDatabase } from '../src/db.js';
import { computeDedupKey } from '../src/validation.js';

const PROVINCES = ['内蒙古', '黑龙江', '新疆', '西藏', '广西', '宁夏', '北京', '天津', '河北', '山西', '辽宁', '吉林', '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '海南', '重庆', '四川', '贵州', '云南', '陕西', '甘肃', '青海'];
const HOST_MAP = [
  ['beijing', '北京'], ['bj.gov.cn', '北京'], ['tj.gov.cn', '天津'], ['hebei', '河北'], ['shanxi', '山西'], ['nmg', '内蒙古'], ['liaoning', '辽宁'], ['jilin', '吉林'], ['hlj', '黑龙江'], ['shanghai', '上海'], ['jiangsu', '江苏'], ['zhejiang', '浙江'], ['zj.gov.cn', '浙江'], ['anhui', '安徽'], ['fujian', '福建'], ['jiangxi', '江西'], ['shandong', '山东'], ['henan', '河南'], ['hubei', '湖北'], ['hunan', '湖南'], ['guangdong', '广东'], ['guangxi', '广西'], ['hainan', '海南'], ['chongqing', '重庆'], ['sichuan', '四川'], ['guizhou', '贵州'], ['yunnan', '云南'], ['xizang', '西藏'], ['shaanxi', '陕西'], ['gansu', '甘肃'], ['qinghai', '青海'], ['ningxia', '宁夏'], ['nx.gov.cn', '宁夏'], ['xinjiang', '新疆'],
];

function inferJurisdiction(title, url) {
  const titleText = String(title || '').replace(/\s+/g, '');
  for (const province of PROVINCES) if (titleText.includes(province)) return province;
  const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } })();
  for (const [pattern, province] of HOST_MAP) if (host.includes(pattern)) return province;
  if (host.includes('gov.cn') && /全国|国务院|商务部|财政部|国家发展改革委|国家发改委/.test(titleText)) return '全国';
  return null;
}

const db = openDatabase();
const rows = db.prepare(`
  SELECT p.id, p.contribution_id, p.title, p.source_url, p.jurisdiction_name, p.issuer,
    p.effective_from, c.dedup_key
  FROM policies p JOIN contributions c ON c.id = p.contribution_id
`).all();
let changed = 0;
for (const row of rows) {
  const inferred = inferJurisdiction(row.title, row.source_url);
  if (!inferred || inferred === row.jurisdiction_name) continue;
  const dedupKey = computeDedupKey({
    title: row.title,
    issuer: row.issuer,
    effectiveFrom: row.effective_from,
    jurisdictionName: inferred,
  });
  db.prepare('UPDATE policies SET jurisdiction_name = ?, updated_at = ? WHERE id = ?').run(inferred, new Date().toISOString(), row.id);
  db.prepare('UPDATE contributions SET jurisdiction_name = ?, dedup_key = ?, updated_at = ? WHERE id = ?').run(inferred, dedupKey || null, new Date().toISOString(), row.contribution_id);
  changed += 1;
}
console.log(`已校正省市区记录：${changed} 条`);
db.close();
