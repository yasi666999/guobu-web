import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, paths } from '../src/db.js';

const outputDir = join(paths.root, 'exports', 'latest');
mkdirSync(outputDir, { recursive: true });

function csvValue(value) {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(filename, headers, rows) {
  const lines = [headers.map(csvValue).join(','), ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(','))];
  writeFileSync(join(outputDir, filename), `\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

const db = openDatabase();

writeCsv('01_数据源.csv', ['来源名称', '层级', '地区', '首页', '栏目地址', '类型', '频率', '最近采集时间'], db.prepare(`
  SELECT name AS '来源名称', level AS '层级', jurisdiction_name AS '地区', base_url AS '首页',
    listing_url AS '栏目地址', source_type AS '类型', frequency AS '频率', last_fetched_at AS '最近采集时间'
  FROM sources ORDER BY level, name
`).all());

writeCsv('02_政策明细.csv', ['政策标题', '主题', '层级', '发布机关', '适用地区', '品类', '补贴方式', '比例%', '固定金额元', '最高金额元', '生效日期', '截止日期', '状态', '官方来源'], db.prepare(`
  SELECT p.title AS '政策标题', p.program AS '主题', p.policy_level AS '层级', p.issuer AS '发布机关',
    p.jurisdiction_name AS '适用地区', r.category AS '品类', r.amount_type AS '补贴方式',
    r.rate AS '比例%', r.fixed_amount AS '固定金额元', r.cap_amount AS '最高金额元',
    p.effective_from AS '生效日期', p.effective_to AS '截止日期', p.status AS '状态', p.source_url AS '官方来源'
  FROM policies p LEFT JOIN subsidy_rules r ON r.policy_id = p.id
  ORDER BY p.effective_from DESC, p.title
`).all());

writeCsv('03_原文证据.csv', ['政策标题', '字段', '原文引文', '页码', '置信度'], db.prepare(`
  SELECT p.title AS '政策标题', e.field_name AS '字段', e.quote AS '原文引文',
    e.page_number AS '页码', e.confidence AS '置信度'
  FROM evidence e JOIN policies p ON p.id = e.policy_id
  ORDER BY p.title, e.field_name
`).all());

writeCsv('04_官方执行统计.csv', ['地区', '主题', '统计类型', '金额元', '数量', '单位', '截止日期', '官方来源', '原文引文'], db.prepare(`
  SELECT jurisdiction_name AS '地区', program AS '主题', metric_type AS '统计类型', amount_yuan AS '金额元',
    count_value AS '数量', unit AS '单位', as_of_date AS '截止日期', source_url AS '官方来源', quote AS '原文引文'
  FROM disbursement_aggregates ORDER BY as_of_date DESC, metric_type
`).all());

writeCsv('05_贡献与审核.csv', ['标题', '提交人ID', '状态', '地区', '品类', '审核人ID', '审核时间', '更新时间'], db.prepare(`
  SELECT title AS '标题', user_id AS '提交人ID', status AS '状态', jurisdiction_name AS '地区',
    category AS '品类', reviewer_id AS '审核人ID', reviewed_at AS '审核时间', updated_at AS '更新时间'
  FROM contributions ORDER BY updated_at DESC
`).all());

writeCsv('06_原始文档.csv', ['标题', '网址', '文件类型', '哈希', '状态', '错误', '采集时间', '解析时间'], db.prepare(`
  SELECT title AS '标题', url AS '网址', mime_type AS '文件类型', content_hash AS '哈希',
    status AS '状态', error AS '错误', fetched_at AS '采集时间', parsed_at AS '解析时间'
  FROM documents ORDER BY created_at DESC
`).all());

writeCsv('07_数据包导入记录.csv', ['数据包', '版本', '路径', '摘要', '是否预演', '导入时间'], db.prepare(`
  SELECT pack_id AS '数据包', pack_version AS '版本', pack_path AS '路径', summary_json AS '摘要',
    dry_run AS '是否预演', created_at AS '导入时间'
  FROM import_runs ORDER BY created_at DESC
`).all());

writeCsv('08_用户.csv', ['用户名', '显示名称', '角色', '状态', '创建时间'], db.prepare(`
  SELECT username AS '用户名', display_name AS '显示名称', role AS '角色', status AS '状态', created_at AS '创建时间'
  FROM users ORDER BY created_at
`).all());

writeCsv('09_邀请码.csv', ['邀请码', '角色', '备注', '有效期', '使用者', '使用时间', '创建时间'], db.prepare(`
  SELECT i.code AS '邀请码', i.role AS '角色', i.note AS '备注', i.expires_at AS '有效期',
    u.username AS '使用者', i.used_at AS '使用时间', i.created_at AS '创建时间'
  FROM invites i LEFT JOIN users u ON u.id = i.used_by
  ORDER BY i.created_at DESC
`).all());

writeFileSync(join(outputDir, '查看说明.txt'), [
  '这些 CSV 文件由当前 SQLite 数据库导出，可用 Excel 或 WPS 直接打开。',
  `导出时间：${new Date().toLocaleString('zh-CN')}`,
  `数据库文件：${join(paths.data, 'guobu.sqlite')}`,
  '',
  '专业查看方式：安装 DB Browser for SQLite，然后打开上面的数据库文件。',
].join('\r\n'), 'utf8');

db.close();
console.log(`数据库已导出到：${outputDir}`);
