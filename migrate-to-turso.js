import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  throw new Error('請先設定 TURSO_DATABASE_URL 與 TURSO_AUTH_TOKEN');
}
const source = process.env.SQLITE_SOURCE || join(import.meta.dirname, 'data', 'scheduler.sqlite');
if (!existsSync(source)) throw new Error('找不到本機 SQLite 資料庫');
const local = new Database(source, { readonly: true });
const remote = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const tables = ['students', 'rooms', 'seats', 'aisles', 'sessions', 'assignments', 'audit'];
try {
  const existing = await remote.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='students'");
  if (!existing.rows.length) throw new Error('Turso 資料庫尚未建立表格，請先啟動一次網站');
  for (const table of tables) {
    const count = await remote.execute(`SELECT COUNT(*) AS n FROM ${table}`);
    if (Number(count.rows[0].n) !== 0) throw new Error('Turso 已有資料，為避免覆蓋，停止匯入');
  }
  const statements = [];
  for (const table of tables) {
    for (const row of local.prepare(`SELECT * FROM ${table} ORDER BY id`).all()) {
      const columns = Object.keys(row);
      statements.push({
        sql: `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
        args: Object.values(row)
      });
    }
  }
  await remote.batch(statements, 'write');
  console.log(`已匯入 ${statements.length} 筆資料至 Turso。`);
} finally {
  local.close();
  remote.close();
}
