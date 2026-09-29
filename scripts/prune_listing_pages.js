import { newId, nowIso, openDatabase } from '../src/db.js';

const db = openDatabase();
const rows = db.prepare(`
  SELECT p.id AS policy_id, p.title, c.id AS contribution_id
  FROM policies p JOIN contributions c ON c.id = p.contribution_id
  WHERE p.status = 'active'
`).all();
const listingPattern = /(门户网站|网站$|政策文件$|政策_|通知公告$|国家级政策$|国家政策信息$|国家政策$|政策传递$|专题专栏$|政策专区$|政策解读$|大规模设备更新和消费品以旧换新$|商务局网站$|发展和改革委员会 - .*政策$)/;
let marked = 0;
let expired = 0;
for (const row of rows) {
  const title = String(row.title || '').trim();
  const isOldYear = /(2024|2025)/.test(title) && !/2026/.test(title);
  if (!listingPattern.test(title) && !isOldYear) continue;
  const timestamp = nowIso();
  const nextStatus = isOldYear && !listingPattern.test(title) ? 'expired' : 'superseded';
  db.prepare('UPDATE policies SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, timestamp, row.policy_id);
  db.prepare('UPDATE contributions SET status = ?, updated_at = ? WHERE id = ?').run('rejected', timestamp, row.contribution_id);
  db.prepare('INSERT INTO events (id, entity_type, entity_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId(), 'policy', row.policy_id, nextStatus === 'expired' ? 'filtered_as_old' : 'filtered_as_listing_page', JSON.stringify({ title: row.title }), timestamp);
  if (nextStatus === 'expired') expired += 1; else marked += 1;
}
console.log(`已标记栏目/首页：${marked} 条，已标记旧通知：${expired} 条`);
db.close();
