const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message, status = 400) => json({ error: message }, status);
const nowTaipei = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei', hour12: false }).replace(' ', 'T');
const locked = (date, now = nowTaipei()) => {
  const today = now.slice(0, 10);
  if (date <= today) return true;
  const next = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return date === next && now.slice(11, 16) >= '15:00';
};
const clean = x => String(x ?? '').trim();
const read = async request => { try { return await request.json(); } catch { return {}; } };
const audit = (db, action, detail) => db.prepare('INSERT INTO audit(action,detail) VALUES (?,?)').bind(action, JSON.stringify(detail));
async function session(db, id) { return db.prepare('SELECT s.*,r.name room_name FROM sessions s JOIN rooms r ON r.id=s.room_id WHERE s.id=?').bind(id).first(); }
async function assignment(db, studentId) { return db.prepare('SELECT a.*,s.date FROM assignments a JOIN sessions s ON s.id=a.session_id WHERE a.student_id=?').bind(studentId).first(); }
function validStatus(v) { return ['待考核','通過','未通過','缺席'].includes(v); }

export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  const db = env.DB, path = url.pathname, method = request.method;
  try {
    if (path === '/api/state' && method === 'GET') {
      const [students, rooms, seats, aisles, sessions, assignments, recent] = await Promise.all([
        db.prepare('SELECT * FROM students ORDER BY agency,name,position').all(),
        db.prepare('SELECT * FROM rooms ORDER BY name').all(),
        db.prepare('SELECT * FROM seats ORDER BY room_id,y,x').all(),
        db.prepare('SELECT * FROM aisles ORDER BY room_id,y,x').all(),
        db.prepare('SELECT s.*,r.name room_name FROM sessions s JOIN rooms r ON r.id=s.room_id ORDER BY s.date,r.name').all(),
        db.prepare('SELECT * FROM assignments').all(),
        db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 30').all()
      ]);
      return json({ students: students.results, rooms: rooms.results, seats: seats.results, aisles: aisles.results, sessions: sessions.results, assignments: assignments.results, audit: recent.results, serverNow: nowTaipei() });
    }
    if (path === '/api/students' && method === 'POST') {
      const b = await read(request), agency = clean(b.agency), name = clean(b.name), position = clean(b.position);
      if (!agency || !name || !position) return fail('單位、姓名及普查職位不可空白');
      const extras = JSON.stringify(b.extras && typeof b.extras === 'object' && !Array.isArray(b.extras) ? b.extras : {});
      if (b.id) {
        const old = await db.prepare('SELECT * FROM students WHERE id=?').bind(b.id).first();
        if (!old) return fail('找不到學員',404);
        await db.batch([db.prepare("UPDATE students SET agency=?,name=?,position=?,extras=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(agency,name,position,extras,b.id),audit(db,'編輯學員',{id:b.id,agency,name,position})]);
      } else {
        await db.batch([db.prepare('INSERT INTO students(agency,name,position,extras) VALUES (?,?,?,?)').bind(agency,name,position,extras),audit(db,'新增學員',{agency,name,position})]);
      }
      return json({ ok:true });
    }
    if (path === '/api/students/import' && method === 'POST') {
      const b = await read(request), rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length || rows.length > 2000) return fail('一次可匯入 1 至 2000 筆');
      const seen = new Set(), statements = [], errors = [];
      for (let i=0;i<rows.length;i++) {
        const r=rows[i], agency=clean(r.agency), name=clean(r.name), position=clean(r.position), key=JSON.stringify([agency,name,position]);
        if (!agency || !name || !position) { errors.push(i+1); continue; }
        if (seen.has(key)) continue;
        seen.add(key);
        const extras=JSON.stringify(r.extras && typeof r.extras==='object' ? r.extras : {});
        statements.push(db.prepare('INSERT INTO students(agency,name,position,extras) VALUES (?,?,?,?) ON CONFLICT(agency,name,position) DO NOTHING').bind(agency,name,position,extras));
      }
      if (errors.length) return fail(`第 ${errors.join('、')} 筆缺少必填欄位`);
      statements.push(audit(db,'匯入學員',{submitted:rows.length,unique:seen.size}));
      const result=await db.batch(statements);
      return json({ ok:true, added:result.slice(0,-1).reduce((n,x)=>n+(x.meta?.changes||0),0), skipped:rows.length-result.slice(0,-1).reduce((n,x)=>n+(x.meta?.changes||0),0) });
    }
    if (path === '/api/students/withdraw' && method === 'POST') {
      const b=await read(request), st=await db.prepare('SELECT * FROM students WHERE id=?').bind(b.studentId).first();
      if (!st) return fail('找不到學員',404);
      const a=await assignment(db,b.studentId);
      if (a && locked(a.date)) return fail('該場次已鎖定，無法退訓釋位',409);
      await db.batch([db.prepare('DELETE FROM assignments WHERE student_id=?').bind(b.studentId),db.prepare("UPDATE students SET status='withdrawn',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(b.studentId),audit(db,'退訓',{studentId:b.studentId,oldAssignment:a})]);
      return json({ok:true});
    }
    if (path === '/api/students/restore' && method === 'POST') {
      const b=await read(request);
      await db.batch([db.prepare("UPDATE students SET status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(b.studentId),audit(db,'恢復學員',{studentId:b.studentId})]);
      return json({ok:true});
    }
    if (path === '/api/students/delete' && method === 'POST') {
      const b=await read(request), id=Number(b.studentId);
      const st=await db.prepare('SELECT * FROM students WHERE id=?').bind(id).first();
      if(!st)return fail('找不到學員',404);
      const a=await assignment(db,id);
      if(a&&locked(a.date))return fail('該學員的場次已鎖定，無法刪除',409);
      await db.batch([
        db.prepare('DELETE FROM assignments WHERE student_id=?').bind(id),
        db.prepare('DELETE FROM students WHERE id=?').bind(id),
        audit(db,'刪除學員',{studentId:id,agency:st.agency,name:st.name,position:st.position,oldAssignment:a})
      ]);return json({ok:true});
    }
    if (path === '/api/rooms' && method === 'POST') {
      const b=await read(request), name=clean(b.name), cols=Number(b.cols), rows=Number(b.rows);
      if (!name || !Number.isInteger(cols) || cols<1 || cols>52 || !Number.isInteger(rows) || rows<1 || rows>30) return fail('請輸入教室名稱，以及 1–52 欄、1–30 列');
      await db.batch([db.prepare('INSERT INTO rooms(name,cols,rows,podium_x,podium_y) VALUES (?,?,?,?,?)').bind(name,cols,rows,Math.ceil(cols/2),0),audit(db,'新增教室',{name,cols,rows})]);
      return json({ok:true});
    }
    if (path === '/api/rooms/delete' && method === 'POST') {
      const b=await read(request), id=Number(b.roomId);
      const room=await db.prepare('SELECT * FROM rooms WHERE id=?').bind(id).first();
      if(!room)return fail('找不到教室',404);
      const sessions=(await db.prepare('SELECT * FROM sessions WHERE room_id=?').bind(id).all()).results;
      if(sessions.some(s=>locked(s.date)))return fail('此教室有已鎖定場次，無法刪除',409);
      const assigned=await db.prepare('SELECT COUNT(*) n FROM assignments a JOIN sessions s ON s.id=a.session_id WHERE s.room_id=?').bind(id).first();
      await db.batch([
        db.prepare('DELETE FROM assignments WHERE session_id IN (SELECT id FROM sessions WHERE room_id=?)').bind(id),
        db.prepare('DELETE FROM sessions WHERE room_id=?').bind(id),
        db.prepare('DELETE FROM rooms WHERE id=?').bind(id),
        audit(db,'刪除教室',{roomId:id,name:room.name,deletedSessions:sessions.map(s=>({id:s.id,date:s.date})),releasedStudents:assigned.n})
      ]);return json({ok:true});
    }
    if (path === '/api/rooms/layout' && method === 'POST') {
      const b=await read(request), room=await db.prepare('SELECT * FROM rooms WHERE id=?').bind(b.roomId).first();
      if (!room) return fail('找不到教室',404);
      const roomSessions=(await db.prepare('SELECT s.date FROM sessions s WHERE s.room_id=? AND EXISTS (SELECT 1 FROM assignments a WHERE a.session_id=s.id)').bind(room.id).all()).results;
      if(roomSessions.some(x=>x.date>=nowTaipei().slice(0,10)&&locked(x.date)))return fail('教室有已鎖定的近期場次，暫時不能修改共用座位圖',409);
      const positions=Array.isArray(b.seats)?b.seats:[], keys=new Set();
      for(const p of positions){const x=Number(p.x),y=Number(p.y),key=`${x}:${y}`;if(!Number.isInteger(x)||!Number.isInteger(y)||x<1||x>room.cols||y<1||y>room.rows||keys.has(key))return fail('座位座標無效或重複');keys.add(key);}
      const aislePositions=Array.isArray(b.aisles)?b.aisles:[],aisleKeys=new Set();
      for(const p of aislePositions){const x=Number(p.x),y=Number(p.y);if(!Number.isInteger(x)||x<1||x>=room.cols||y!==0||aisleKeys.has(x))return fail('走道須位於兩欄座位之間，且不可重複');aisleKeys.add(x);}
      const existing=(await db.prepare('SELECT * FROM seats WHERE room_id=?').bind(room.id).all()).results;
      const removed=existing.filter(s=>!keys.has(`${s.x}:${s.y}`));
      for(const s of removed){const used=await db.prepare('SELECT 1 FROM assignments WHERE seat_id=? LIMIT 1').bind(s.id).first();if(used)return fail('已有學員使用的座位不能移除',409);}
      const statements=[];
      for(const s of removed)statements.push(db.prepare('DELETE FROM seats WHERE id=? AND NOT EXISTS(SELECT 1 FROM assignments WHERE seat_id=?)').bind(s.id,s.id));
      for(const p of positions)statements.push(db.prepare('INSERT INTO seats(room_id,x,y) VALUES (?,?,?) ON CONFLICT(room_id,x,y) DO NOTHING').bind(room.id,p.x,p.y));
      statements.push(db.prepare('DELETE FROM aisles WHERE room_id=?').bind(room.id));
      for(const p of aislePositions)statements.push(db.prepare('INSERT INTO aisles(room_id,x,y) VALUES (?,?,?)').bind(room.id,p.x,p.y));
      const px=Number(b.podium_x),py=Number(b.podium_y);
      if(!Number.isInteger(px)||px<1||px>room.cols||!Number.isInteger(py)||py<0||py>room.rows)return fail('講台位置無效');
      if(keys.has(`${px}:${py}`))return fail('講台不能與座位重疊');
      statements.push(db.prepare('UPDATE rooms SET podium_x=?,podium_y=? WHERE id=?').bind(px,py,room.id));
      statements.push(audit(db,'修改座位圖',{roomId:room.id,seatCount:positions.length}));
      await db.batch(statements);return json({ok:true});
    }
    if (path === '/api/sessions' && method === 'POST') {
      const b=await read(request), date=clean(b.date),roomId=Number(b.roomId);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||!roomId)return fail('日期或教室無效');
      if(locked(date))return fail('該日期已鎖定，無法新增場次',409);
      const count=await db.prepare('SELECT COUNT(*) n FROM sessions WHERE date=?').bind(date).first();
      if(count.n>=3)return fail('同一天最多三個教室');
      await db.batch([db.prepare('INSERT INTO sessions(date,room_id) VALUES (?,?)').bind(date,roomId),audit(db,'新增場次',{date,roomId})]);return json({ok:true});
    }
    if (path === '/api/sessions/update' && method === 'POST') {
      const b=await read(request), id=Number(b.sessionId), date=clean(b.date), reset=b.resetAssignments===true;
      const current=await session(db,id);
      if(!current)return fail('找不到場次',404);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date)))return fail('日期無效');
      if(locked(current.date)||locked(date))return fail('來源或目標日期已鎖定，無法修改場次',409);
      if(date!==current.date){
        const count=await db.prepare('SELECT COUNT(*) n FROM sessions WHERE date=?').bind(date).first();
        if(count.n>=3)return fail('同一天最多三個教室');
      }
      const assigned=await db.prepare('SELECT COUNT(*) n FROM assignments WHERE session_id=?').bind(id).first();
      const statements=[];
      if(reset)statements.push(db.prepare('DELETE FROM assignments WHERE session_id=?').bind(id));
      statements.push(db.prepare('UPDATE sessions SET date=? WHERE id=?').bind(date,id));
      statements.push(audit(db,'修改場次',{sessionId:id,oldDate:current.date,newDate:date,resetAssignments:reset,affectedStudents:assigned.n}));
      await db.batch(statements);return json({ok:true});
    }
    if (path === '/api/sessions/delete' && method === 'POST') {
      const b=await read(request), id=Number(b.sessionId), current=await session(db,id);
      if(!current)return fail('找不到場次',404);
      if(locked(current.date))return fail('該場次已鎖定，無法刪除',409);
      const assigned=await db.prepare('SELECT COUNT(*) n FROM assignments WHERE session_id=?').bind(id).first();
      await db.batch([
        db.prepare('DELETE FROM assignments WHERE session_id=?').bind(id),
        db.prepare('DELETE FROM sessions WHERE id=?').bind(id),
        audit(db,'刪除場次',{sessionId:id,date:current.date,roomId:current.room_id,releasedStudents:assigned.n})
      ]);return json({ok:true});
    }
    if (path === '/api/assign' && method === 'POST') {
      const b=await read(request), studentId=Number(b.studentId),sessionId=Number(b.sessionId),seatId=Number(b.seatId);
      const [st,target,seat,old]=await Promise.all([db.prepare('SELECT * FROM students WHERE id=?').bind(studentId).first(),session(db,sessionId),db.prepare('SELECT * FROM seats WHERE id=?').bind(seatId).first(),assignment(db,studentId)]);
      if(!st||st.status!=='active')return fail('學員不存在或已退訓');
      if(!target||!seat||seat.room_id!==target.room_id)return fail('場次與座位不相符');
      if(locked(target.date)||old&&locked(old.date))return fail('來源或目標場次已鎖定',409);
      if(old?.session_id===sessionId&&old?.seat_id===seatId)return json({ok:true});
      const statements=[];
      if(old)statements.push(db.prepare('DELETE FROM assignments WHERE student_id=?').bind(studentId));
      statements.push(db.prepare('INSERT INTO assignments(student_id,session_id,seat_id,assessment_status,note) VALUES (?,?,?,?,?)').bind(studentId,sessionId,seatId,old?.assessment_status||'待考核',old?.note||''));
      statements.push(audit(db,old?'改期或換位':'安排座位',{studentId,from:old?{sessionId:old.session_id,seatId:old.seat_id}:null,to:{sessionId,seatId}}));
      await db.batch(statements);return json({ok:true});
    }
    if (path === '/api/unassign' && method === 'POST') {
      const b=await read(request), id=Number(b.assignmentId);
      const current=await db.prepare('SELECT a.*,s.date FROM assignments a JOIN sessions s ON s.id=a.session_id WHERE a.id=?').bind(id).first();
      if(!current)return fail('這個座位已變更，請重新整理',409);
      if(locked(current.date))return fail('該場次已鎖定，無法取消配置',409);
      const detail=JSON.stringify({assignmentId:id,studentId:current.student_id,sessionId:current.session_id,seatId:current.seat_id});
      const result=await db.batch([
        db.prepare('INSERT INTO audit(action,detail) SELECT ?,? FROM assignments WHERE id=?').bind('取消配置',detail,id),
        db.prepare('DELETE FROM assignments WHERE id=?').bind(id)
      ]);
      if(!result[1].meta.changes)return fail('這個座位已變更，請重新整理',409);
      return json({ok:true});
    }
    if (path === '/api/assessment' && method === 'POST') {
      const b=await read(request),status=clean(b.status),note=clean(b.note);
      if(!validStatus(status)||note.length>2000)return fail('考核狀態或註記無效');
      const current=await db.prepare('SELECT * FROM assignments WHERE id=?').bind(b.assignmentId).first();if(!current)return fail('找不到排班',404);
      await db.batch([db.prepare('UPDATE assignments SET assessment_status=?,note=? WHERE id=?').bind(status,note,b.assignmentId),audit(db,'考核註記',{assignmentId:b.assignmentId,status,note})]);return json({ok:true});
    }
    return fail('找不到功能',404);
  } catch(e) {
    const msg=String(e?.message||e);
    if(msg.includes('UNIQUE constraint failed'))return fail('資料已存在或座位剛被其他人選走，請重新整理',409);
    return fail(msg,500);
  }
}};
export { locked };
