import { newId, nowIso, openDatabase } from '../src/db.js';
import { analyzeGuobuRelevance } from '../src/extract.js';

const db = openDatabase();
const rows = db.prepare(`
  SELECT p.id AS policy_id, p.title, p.status, c.id AS contribution_id, c.extracted_json
  FROM policies p JOIN contributions c ON c.id = p.contribution_id
  WHERE c.extracted_json IS NOT NULL
`).all();

let marked = 0;
for (const row of rows) {
  let parsed;
  try { parsed = JSON.parse(row.extracted_json); } catch { continue; }
  const relevance = analyzeGuobuRelevance({ text: parsed.text || '', fields: parsed.fields || {} });
  if (relevance.isRelated) continue;
  const timestamp = nowIso();
  db.prepare('UPDATE policies SET status = ?, updated_at = ? WHERE id = ?').run('superseded', timestamp, row.policy_id);
  db.prepare('UPDATE contributions SET status = ?, updated_at = ? WHERE id = ?').run('rejected', timestamp, row.contribution_id);
  db.prepare('INSERT INTO events (id, entity_type, entity_id, actor_id, action, detail, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)')
    .run(newId(), 'policy', row.policy_id, 'filtered_as_irrelevant', JSON.stringify({ title: row.title, relevance }), timestamp);
  marked += 1;
}

console.log(`已标记无效政策：${marked} 条`);
db.close();
