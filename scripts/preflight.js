import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, paths } from '../src/db.js';

const checks = [];
const errors = [];
const warnings = [];

function check(name, ok, message, level = 'error') {
  checks.push({ name, ok, message });
  if (!ok) (level === 'error' ? errors : warnings).push(`${name}：${message}`);
}

const dbPath = join(paths.data, 'guobu.sqlite');
check('数据库文件', existsSync(dbPath), dbPath);
const db = openDatabase();

try {
  const users = db.prepare('SELECT COUNT(*) AS count FROM users WHERE status = ?').get('active').count;
  const admins = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'").get().count;
  const invites = db.prepare('SELECT COUNT(*) AS count FROM invites WHERE used_by IS NULL AND disabled = 0').get().count;
  const policies = db.prepare('SELECT COUNT(*) AS count FROM policies').get().count;
  const sources = db.prepare('SELECT COUNT(*) AS count FROM sources').get().count;
  check('管理员账号', admins >= 1, `当前 ${admins} 个管理员`);
  check('有效用户', users >= 1, `当前 ${users} 个用户`);
  check('政策数据', policies > 0, `当前 ${policies} 条政策`, 'warning');
  check('数据源', sources > 0, `当前 ${sources} 个来源`, 'warning');
  check('协作邀请码', invites >= 1, `当前 ${invites} 个未使用邀请码`, 'warning');
} finally {
  db.close();
}

check('生产 HTTPS Cookie', process.env.COOKIE_SECURE === '1', '生产环境应设置 COOKIE_SECURE=1', 'warning');
check('邀请注册', process.env.ALLOW_REGISTRATION !== '1', '生产环境建议设置 ALLOW_REGISTRATION=0', 'warning');
check('自动采集', process.env.AUTO_COLLECT === '1', '生产环境可设置 AUTO_COLLECT=1', 'warning');
check('原始文件目录', existsSync(join(paths.data, 'raw')), join(paths.data, 'raw'), 'warning');

for (const checkItem of checks) console.log(`${checkItem.ok ? '[OK]' : '[WARN]'} ${checkItem.name}：${checkItem.message}`);
if (errors.length) {
  console.error('\n上线前检查失败：');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('\n关键检查通过。警告项请在正式上线前确认。');
}
