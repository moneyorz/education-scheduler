import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const aisleSchema = 'CREATE TABLE IF NOT EXISTS aisles (id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, x INTEGER NOT NULL, y INTEGER NOT NULL, UNIQUE(room_id,x,y))';
const aisleMigration = `INSERT OR IGNORE INTO aisles(room_id,x,y)
  SELECT DISTINCT a.room_id,a.x,0 FROM aisles a JOIN rooms r ON r.id=a.room_id
  WHERE a.y<>0 AND a.x>=1 AND a.x<r.cols`;

export async function openDatabase(root) {
  const remoteUrl = process.env.TURSO_DATABASE_URL;
  if (remoteUrl) {
    if (remoteUrl.startsWith('libsql:') && !process.env.TURSO_AUTH_TOKEN) throw new Error('缺少 TURSO_AUTH_TOKEN');
    const client = createClient({ url: remoteUrl, authToken: process.env.TURSO_AUTH_TOKEN });
    await client.execute('PRAGMA foreign_keys = ON');
    const schema = readFileSync(join(root, 'migrations', '0001_init.sql'), 'utf8');
    for (const sql of schema.split(';').map(s => s.trim()).filter(Boolean)) {
      await client.execute(sql.replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS '));
    }
    await client.execute(aisleSchema);
    await client.execute(aisleMigration);
    await client.execute('DELETE FROM aisles WHERE y<>0');
    const prepared = (sql, values = []) => ({
      sql, values,
      bind(...args) { return prepared(sql, args); },
      async first() { const result = await client.execute({ sql, args: values }); return result.rows[0] || null; },
      async all() { const result = await client.execute({ sql, args: values }); return { results: result.rows }; }
    });
    return {
      db: {
        prepare: sql => prepared(sql),
        async batch(statements) {
          const results = await client.batch(statements.map(({ sql, values }) => ({ sql, args: values })), 'write');
          return results.map(result => ({ meta: { changes: result.rowsAffected }, success: true }));
        }
      },
      description: 'Turso'
    };
  }

  const dataDir = process.env.DATA_DIR || join(root, 'data');
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'scheduler.sqlite');
  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='students'").get()) {
    database.exec(readFileSync(join(root, 'migrations', '0001_init.sql'), 'utf8'));
  }
  database.exec(aisleSchema);
  database.exec(aisleMigration);
  database.exec('DELETE FROM aisles WHERE y<>0');
  const prepared = (sql, values = []) => ({
    bind(...args) { return prepared(sql, args); },
    async first() { return database.prepare(sql).get(...values) || null; },
    async all() { return { results: database.prepare(sql).all(...values) }; },
    runSync() { const result = database.prepare(sql).run(...values); return { meta: { changes: result.changes }, success: true }; }
  });
  return {
    db: {
      prepare: sql => prepared(sql),
      async batch(statements) { return database.transaction(() => statements.map(s => s.runSync()))(); }
    },
    description: dbPath
  };
}
