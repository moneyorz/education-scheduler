import express from 'express';
import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import api from './api/handlers.js';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || join(root, 'data');
mkdirSync(dataDir, { recursive: true });
const database = new Database(join(dataDir, 'scheduler.sqlite'));
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='students'").get()) {
  database.exec(readFileSync(join(root,'migrations','0001_init.sql'),'utf8'));
}
database.exec('CREATE TABLE IF NOT EXISTS aisles (id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, x INTEGER NOT NULL, y INTEGER NOT NULL, UNIQUE(room_id,x,y))');
// Earlier local builds stored an aisle in a seat-sized cell. Convert it to one gap after its column.
database.exec(`INSERT OR IGNORE INTO aisles(room_id,x,y)
  SELECT DISTINCT a.room_id,a.x,0 FROM aisles a JOIN rooms r ON r.id=a.room_id
  WHERE a.y<>0 AND a.x>=1 AND a.x<r.cols`);
database.exec('DELETE FROM aisles WHERE y<>0');
const prepared = (sql, values=[]) => ({
  bind(...args) { return prepared(sql,args); },
  async first() { return database.prepare(sql).get(...values) || null; },
  async all() { return { results: database.prepare(sql).all(...values) }; },
  runSync() { const r=database.prepare(sql).run(...values); return { meta:{changes:r.changes}, success:true }; }
});
const DB = {
  prepare: sql => prepared(sql),
  async batch(statements) { return database.transaction(() => statements.map(s=>s.runSync()))(); }
};
const app=express();
app.use(express.json({limit:'5mb'}));
app.use('/api',async(req,res)=>{
  const request=new Request(`http://localhost${req.originalUrl}`,{method:req.method,headers:{'content-type':'application/json'},body:req.method==='GET'?undefined:JSON.stringify(req.body||{})});
  const response=await api.fetch(request,{DB});
  res.status(response.status);
  for(const [key,value] of response.headers)res.setHeader(key,value);
  res.send(await response.text());
});
const dist=join(root,'dist');
if(existsSync(dist)){
  app.use(express.static(dist));
  app.get('/{*path}',(_req,res)=>res.sendFile(join(dist,'index.html')));
}
const port=Number(process.env.PORT||3000);
const host=process.env.HOST||(process.env.RAILWAY_ENVIRONMENT?'0.0.0.0':'127.0.0.1');
app.listen(port,host,()=>console.log(`教育訓練排班：http://${host}:${port}，資料庫：${join(dataDir,'scheduler.sqlite')}`));
