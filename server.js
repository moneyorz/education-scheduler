import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import api from './api/handlers.js';
import { openDatabase } from './db.js';

const root = dirname(fileURLToPath(import.meta.url));
const { db: DB, description } = await openDatabase(root);
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
const host=process.env.HOST||(process.env.RENDER||process.env.RAILWAY_ENVIRONMENT?'0.0.0.0':'127.0.0.1');
app.listen(port,host,()=>console.log(`教育訓練排班：http://${host}:${port}，資料庫：${description}`));
