import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const source=join(process.env.DATA_DIR||join(root,'data'),'scheduler.sqlite');
if(!existsSync(source)){console.error('尚未找到資料庫，請先啟動網站。');process.exit(1)}
const backups=join(root,'backups');mkdirSync(backups,{recursive:true});
const dest=join(backups,`scheduler-${new Date().toISOString().replaceAll(':','-').slice(0,19)}.sqlite`);
const db=new Database(source,{readonly:true});
await db.backup(dest);db.close();console.log(`已備份到 ${dest}`);
