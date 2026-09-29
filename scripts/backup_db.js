import { backup } from 'node:sqlite';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase, paths } from '../src/db.js';

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const backupDir = join(paths.data, 'backups', stamp);
mkdirSync(backupDir, { recursive: true });

const db = openDatabase();
try {
  const databaseBackup = join(backupDir, 'guobu.sqlite');
  await backup(db, databaseBackup);
  const rawSource = join(paths.data, 'raw');
  if (existsSync(rawSource)) cpSync(rawSource, join(backupDir, 'raw'), { recursive: true });
  writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify({
    createdAt: new Date().toISOString(),
    sourceDatabase: join(paths.data, 'guobu.sqlite'),
    backupDirectory: backupDir,
  }, null, 2), 'utf8');
  console.log(`备份完成：${backupDir}`);
} finally {
  db.close();
}
