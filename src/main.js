import ExcelJS from 'exceljs';
import './style.css';
import './aisle.css';
import './schedule.css';

const root=document.querySelector('#app');
let state={students:[],rooms:[],seats:[],aisles:[],sessions:[],assignments:[],audit:[],serverNow:''};
let tab='overview', chosenSession=null, assessmentSessionId=null, chosenRoom=null, layoutDraft=null, layoutMode='seat', modal=null, importPreview=null, lastToast=null;
let filterAgency='', filterStatus='all', filterText='', selectedStudentId=null, draggingStudentId=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const h=(strings,...args)=>strings.reduce((a,s,i)=>a+s+(args[i]??''),'');
const col=x=>{let out='';while(x>0){x--;out=String.fromCharCode(65+x%26)+out;x=Math.floor(x/26)}return out};
const seatLabel=s=>`${col(s.x)}${s.y}`;
const fullStudent=s=>`${s.agency} / ${s.name} / ${s.position}`;
const student=id=>state.students.find(x=>x.id===id);
const room=id=>state.rooms.find(x=>x.id===id);
const session=id=>state.sessions.find(x=>x.id===id);
const assignmentFor=id=>state.assignments.find(x=>x.student_id===id);
const seatsFor=id=>state.seats.filter(x=>x.room_id===id);
const aislesFor=id=>state.aisles.filter(x=>x.room_id===id);
const assignmentsFor=id=>state.assignments.filter(x=>x.session_id===id);
const dateLock=date=>{const today=state.serverNow.slice(0,10);if(date<=today)return true;const next=new Date(Date.parse(`${today}T00:00:00Z`)+86400000).toISOString().slice(0,10);return date===next&&state.serverNow.slice(11,16)>='15:00'};
async function api(path,method='GET',body){const res=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await res.json();if(!res.ok)throw Error(data.error||'操作失敗');return data}
async function refresh(){state=await api('/state');if(!state.sessions.some(s=>s.id===chosenSession))chosenSession=state.sessions[0]?.id??null;if(!state.sessions.some(s=>s.id===assessmentSessionId))assessmentSessionId=state.sessions[0]?.id??null;if(!state.rooms.some(r=>r.id===chosenRoom))chosenRoom=state.rooms[0]?.id??null;render()}
function toast(msg,error=false){lastToast={msg,error};renderToast();setTimeout(()=>{lastToast=null;renderToast()},4500)}
function renderToast(){document.querySelector('.toast')?.remove();if(lastToast){const el=document.createElement('div');el.className='toast'+(lastToast.error?' error':'');el.textContent=lastToast.msg;document.body.append(el)}}
async function mutate(path,body){try{const result=await api(path,'POST',body);modal=null;await refresh();toast(result.added!==undefined?`匯入完成：新增 ${result.added} 筆、略過 ${result.skipped} 筆`:'已儲存');return true}catch(e){await refresh();toast(e.message,true);return false}}
function button(text,action,kind='secondary',extra=''){return `<button class="action ${kind} ${extra}" data-action="${action}">${text}</button>`}
function header(){return `<header><div><h1>教育訓練排班系統</h1><small>學員、場次、座位、考核與簽到集中管理</small></div><div>${esc(state.serverNow?.replace('T',' '))} 台灣時間</div></header>`}
function navigation(){return `<nav class="tabs">${[['overview','總覽'],['students','學員名冊'],['rooms','教室座位圖'],['sessions','場次排班'],['assessment','教育訓練考核'],['reports','列印與匯出'],['audit','異動紀錄']].map(([id,label])=>`<button class="tab ${tab===id?'active':''}" data-tab="${id}">${label}</button>`).join('')}</nav>`}
function overview(){const active=state.students.filter(s=>s.status==='active').length,planned=state.assignments.length;return `<div class="stats"><div class="stat"><strong>${active}</strong><span>有效學員</span></div><div class="stat"><strong>${planned}</strong><span>已安排座位</span></div><div class="stat"><strong>${active-planned}</strong><span>待排班學員</span></div><div class="stat"><strong>${state.sessions.length}</strong><span>已建立場次</span></div></div><section class="panel"><h2>開始使用</h2><div class="stack"><div>1. 在「學員名冊」新增或匯入學員。</div><div>2. 在「教室座位圖」建立教室，點選格子設置座位。</div><div>3. 在「場次排班」建立日期與教室，將學員拖入空位。</div><div>4. 在「列印與匯出」取得最新座位圖、考核表與簽到表。</div></div></section><div class="note">每人只會有一個有效座位。明天場次在今天 15:00 起鎖定所有排班異動；考核註記仍可修改。</div>`}
function studentsView(){return `<section class="panel"><div class="row between"><div><h2>學員名冊</h2><div class="sub">單位＋姓名＋普查職位用來辨識重複匯入</div></div><div class="row">${button('下載範例','template')}${button('匯入 Excel / CSV','import')}${button('新增學員','newStudent','primary')}</div></div><div class="tablewrap"><table><thead><tr><th>單位／機關</th><th>姓名</th><th>普查職位</th><th>其他欄位</th><th>狀態</th><th>安排</th><th>操作</th></tr></thead><tbody>${state.students.map(s=>{const a=assignmentFor(s.id),ss=a&&session(a.session_id),seat=a&&state.seats.find(x=>x.id===a.seat_id);return `<tr><td>${esc(s.agency)}</td><td>${esc(s.name)}</td><td>${esc(s.position)}</td><td>${esc(Object.entries(JSON.parse(s.extras||'{}')).map(([k,v])=>`${k}: ${v}`).join('；'))}</td><td><span class="pill ${s.status==='active'?'':'gray'}">${s.status==='active'?'有效':'退訓'}</span></td><td>${ss?`${ss.date} ${esc(ss.room_name)} ${seatLabel(seat)}`:'—'}</td><td>${button('編輯',`editStudent:${s.id}`,'muted','small')} ${s.status==='active'?button('退訓',`withdraw:${s.id}`,'danger','small'):button('恢復',`restore:${s.id}`,'secondary','small')} ${button('刪除',`deleteStudent:${s.id}`,'danger','small')}</td></tr>`}).join('')||'<tr><td colspan="7" class="empty">尚無學員</td></tr>'}</tbody></table></div></section>`}
function roomView(){
  const r=room(chosenRoom);
  const cards=state.rooms.map(x=>`<div class="card"><h3>${esc(x.name)}</h3><div class="sub">${x.cols} 欄 × ${x.rows} 列 · ${seatsFor(x.id).length} 個座位</div><div class="toolbar">${button('編輯位置圖',`room:${x.id}`,'secondary','small')}${button('刪除教室',`deleteRoom:${x.id}`,'danger','small')}</div></div>`).join('')||'<div class="empty">請先新增教室</div>';
  let html=`<section class="panel"><div class="row between"><div><h2>教室與座位圖</h2><div class="sub">座號依 X 軸英文字母與 Y 軸數字編排</div></div>${button('新增教室','newRoom','primary')}</div><div class="roomcards">${cards}</div></section>`;
  if(!r)return html;
  const seats=layoutDraft?.seats.length??seatsFor(r.id).length;
  const gaps=layoutDraft?.aisles.length??aislesFor(r.id).length;
  html+=`<section class="panel"><div class="row between"><h2>${esc(r.name)} 位置圖</h2><span class="sub">走道是在兩欄之間留白，不占座號</span></div><div class="row"><label class="field">講台 X 座標<input id="podiumX" type="number" min="1" max="${r.cols}" value="${layoutDraft?.podium_x??r.podium_x}"></label><label class="field">講台 Y 座標（0 代表最前方）<input id="podiumY" type="number" min="0" max="${r.rows}" value="${layoutDraft?.podium_y??r.podium_y}"></label>${button('儲存座位圖','saveLayout','primary')}</div><div class="toolbar">${button('畫座位','mode:seat',layoutMode==='seat'?'primary':'secondary','small')}${button('留走道空白','mode:aisle',layoutMode==='aisle'?'primary':'secondary','small')}${button('放講台','mode:podium',layoutMode==='podium'?'primary':'secondary','small')}<span class="pill">${seats} 個座位 · ${gaps} 條空白走道</span></div><p class="sub">選「留走道空白」後，點選兩欄之間的窄條；再點一次可移除空白。</p>${map(r,null,true)}</section>`;
  return html;
}
function map(r,s,editable=false,mode='schedule'){
  const seats=editable?(layoutDraft?.seats||seatsFor(r.id)):seatsFor(r.id);
  const aisleXs=new Set((editable?(layoutDraft?.aisles||aislesFor(r.id)):aislesFor(r.id)).map(a=>a.x));
  const lookup=new Map(seats.map(x=>[`${x.x}:${x.y}`,x]));
  const occupied=new Map((s?assignmentsFor(s.id):[]).map(a=>[a.seat_id,a]));
  const px=editable?(layoutDraft?.podium_x??r.podium_x):r.podium_x;
  const py=editable?(layoutDraft?.podium_y??r.podium_y):r.podium_y;
  const widths=['32px'];
  for(let x=1;x<=r.cols;x++){
    widths.push('var(--cell-width)');
    if(x<r.cols&&(editable||aisleXs.has(x)))widths.push(aisleXs.has(x)?'30px':'12px');
  }
  let html=`<div class="seatmap"><div class="mapgrid" style="grid-template-columns:${widths.join(' ')}"><div></div>`;
  const gap=x=>{
    if(x>=r.cols||!editable&&!aisleXs.has(x))return '';
    return editable?`<button class="gap-toggle ${aisleXs.has(x)?'active':''}" data-action="toggleAisle:${x}" title="切換 ${col(x)} 與 ${col(x+1)} 之間的空白" aria-label="切換 ${col(x)} 與 ${col(x+1)} 之間的空白"></button>`:'<div class="gap-space"></div>';
  };
  for(let x=1;x<=r.cols;x++)html+=`<div class="axis">${col(x)}</div>${gap(x)}`;
  for(let y=0;y<=r.rows;y++){
    html+=`<div class="axis">${y||'前'}</div>`;
    for(let x=1;x<=r.cols;x++){
      const podium=x===px&&y===py,seat=lookup.get(`${x}:${y}`),a=seat&&occupied.get(seat.id),st=a&&student(a.student_id);
      const className=podium?'podiumcell':seat?(a?'taken':'seat'):'';
      const action=editable?(layoutMode==='podium'?`setPodium:${x}:${y}`:layoutMode==='seat'&&y?`toggleSeat:${x}:${y}`:''):mode==='assessment'&&a?`assess:${a.id}`:mode==='schedule'&&a&&!dateLock(s.date)?`unassign:${a.id}`:mode==='schedule'&&seat&&!a&&!dateLock(s.date)?`chooseSeat:${s.id}:${seat.id}`:'';
      const drop=mode==='schedule'&&seat&&!a&&s&&!dateLock(s.date)?`data-drop-session="${s.id}" data-drop-seat="${seat.id}"`:'';
      const hint=!editable&&mode==='schedule'&&a?'title="點一下取消配置，回到未配置名單"':'';
      html+=`<button class="cell ${className} ${s&&dateLock(s.date)?'locked':''}" ${action?`data-action="${action}"`:''} ${drop} ${hint} ${!action?'disabled':''}>${podium?'講台':seat?`<b>${col(x)}${y}</b>${st?`<span>${esc(st.agency)}<br>${esc(st.name)}<br>${esc(st.position)}</span>`:''}`:''}</button>${gap(x)}`;
    }
  }
  return html+'</div></div>';
}
function movableStudent(s){
  const a=assignmentFor(s.id);
  return !a||!dateLock(session(a.session_id).date);
}
function filteredStudents(){
  const query=filterText.trim().toLocaleLowerCase();
  return state.students.filter(s=>s.status==='active').filter(s=>{
    const assigned=!!assignmentFor(s.id);
    return (!filterAgency||s.agency===filterAgency)
      &&(filterStatus==='all'||filterStatus==='assigned'&&assigned||filterStatus==='unassigned'&&!assigned)
      &&(!query||`${s.agency} ${s.name} ${s.position}`.toLocaleLowerCase().includes(query));
  });
}
function studentList(){
  const rows=filteredStudents();
  return `<div class="roster-count">符合條件 ${rows.length} 人</div><div class="roster-list">${rows.map(s=>{
    const a=assignmentFor(s.id),ss=a&&session(a.session_id),seat=a&&state.seats.find(x=>x.id===a.seat_id),movable=movableStudent(s);
    return `<button class="student-card ${selectedStudentId===s.id?'selected':''} ${movable?'':'immovable'}" data-action="selectStudent:${s.id}" data-student-id="${s.id}" aria-pressed="${selectedStudentId===s.id}"><strong>${esc(s.name)}</strong><span>${esc(s.agency)} · ${esc(s.position)}</span><small>${a?`已配置：${esc(ss.date)} ${esc(ss.room_name)} ${seat?seatLabel(seat):''}`:'尚未配置'}${movable?'':' · 原場次已鎖定'}</small></button>`;
  }).join('')||'<div class="empty">沒有符合條件的學員</div>'}</div>`;
}
function sessionsView(){
  const s=session(chosenSession),r=s&&room(s.room_id),used=s?assignmentsFor(s.id).length:0,total=r?seatsFor(r.id).length:0;
  let html=`<section class="panel"><div class="row between"><div><h2>場次排班</h2><div class="sub">同一天可使用 1–3 間教室；每人限安排一場</div></div>${button('新增場次','newSession','primary')}</div><div class="form"><label class="field">選擇場次<select id="sessionSelect">${state.sessions.map(x=>`<option value="${x.id}" ${x.id===chosenSession?'selected':''}>${x.date}　${esc(x.room_name)}</option>`).join('')}</select></label></div>${s?`<div class="toolbar"><button class="action secondary" data-action="editSession" ${dateLock(s.date)?'disabled':''}>修改日期</button><button class="action muted" data-action="deleteSession" ${dateLock(s.date)?'disabled':''}>刪除場次</button></div>`:''}</section>`;
  if(!s||!r)return html+'<section class="panel empty">請先建立場次與座位圖</section>';
  const agencies=[...new Set(state.students.filter(x=>x.status==='active').map(x=>x.agency))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
  const locked=dateLock(s.date);
  html+=`<div class="schedule-layout"><aside class="panel roster-panel"><h2>學員名單</h2><p class="sub">拖曳學員到右側空位；也可先點學員，再點空位。</p><div class="roster-filters"><label class="field">機關<select id="agencyFilter"><option value="">全部機關</option>${agencies.map(a=>`<option value="${esc(a)}" ${filterAgency===a?'selected':''}>${esc(a)}</option>`).join('')}</select></label><label class="field">配置狀態<select id="statusFilter"><option value="all" ${filterStatus==='all'?'selected':''}>全部</option><option value="unassigned" ${filterStatus==='unassigned'?'selected':''}>未配置</option><option value="assigned" ${filterStatus==='assigned'?'selected':''}>已配置</option></select></label><label class="field">搜尋<input id="studentSearch" value="${esc(filterText)}" placeholder="姓名、機關或職位"></label></div><div id="studentList">${studentList()}</div></aside><section class="panel schedule-map-panel"><div class="row between"><div><h2>${esc(s.date)} · ${esc(s.room_name)}</h2><div class="sub">已排 ${used} / ${total}，空位 ${total-used}</div></div><span class="pill ${locked?'warn':''}">${locked?'排班已鎖定':'可排班'}</span></div><div class="seat-legend"><span><i class="legend-swatch empty-seat"></i>可安排</span><span><i class="legend-swatch occupied-seat"></i>已安排</span><span><i class="legend-swatch podium-seat"></i>講台</span></div><p class="sub">拖入空位即完成配置；點已配置座位可取消配置。考核請到「教育訓練考核」頁。</p>`;
  if(!total)html+='<div class="note">這間教室還沒有設置座位。請先到「教室座位圖」點選格子並儲存，才能排班。</div>';
  if(!state.students.some(x=>x.status==='active'))html+='<div class="note">尚無有效學員。請先到「學員名冊」新增或匯入人員。</div>';
  if(locked)html+='<div class="note">此場次已過排班異動期限。考核註記請到「教育訓練考核」頁；若要試用排班，請建立後天或更晚的場次。</div>';
  html+=map(r,s)+'</section></div>';
  return html;
}
function assessmentView(){
  const s=session(assessmentSessionId),r=s&&room(s.room_id);
  let html=`<section class="panel"><h2>教育訓練考核</h2><p class="sub">選擇場次後，點選已安排學員的座位填寫考核狀態與註記。本頁只能考核，不能安排或更換座位。</p><div class="form"><label class="field">選擇場次<select id="assessmentSessionSelect">${state.sessions.map(x=>`<option value="${x.id}" ${x.id===assessmentSessionId?'selected':''}>${x.date}　${esc(x.room_name)}</option>`).join('')}</select></label></div></section>`;
  if(!s||!r)return html+'<section class="panel empty">尚無場次可供考核</section>';
  const assigned=assignmentsFor(s.id);
  const counts=Object.fromEntries(['待考核','通過','未通過','缺席'].map(x=>[x,assigned.filter(a=>a.assessment_status===x).length]));
  const rows=assigned.map(a=>({a,st:student(a.student_id),seat:state.seats.find(x=>x.id===a.seat_id)})).sort((a,b)=>a.st.agency.localeCompare(b.st.agency,'zh-Hant')||a.st.name.localeCompare(b.st.name,'zh-Hant'));
  html+=`<section class="panel"><div class="row between"><div><h2>${esc(s.date)} · ${esc(s.room_name)}</h2><div class="sub">已安排 ${assigned.length} 人</div></div></div><div class="assessment-counts">${Object.entries(counts).map(([label,count])=>`<span class="assessment-count">${label} <strong>${count}</strong></span>`).join('')}</div>${assigned.length?'':'<div class="note">這個場次尚未安排學員。請先到「場次排班」完成座位安排。</div>'}<p class="sub">點選有學員的綠色座位即可註記；空位不提供排班操作。</p>${map(r,s,false,'assessment')}</section>`;
  html+=`<section class="panel"><h2>本場考核清單</h2><div class="tablewrap"><table><thead><tr><th>機關</th><th>姓名</th><th>普查職位</th><th>座號</th><th>狀態</th><th>註記</th></tr></thead><tbody>${rows.map(({a,st,seat})=>`<tr><td>${esc(st.agency)}</td><td>${esc(st.name)}</td><td>${esc(st.position)}</td><td>${seat?seatLabel(seat):'—'}</td><td>${esc(a.assessment_status)}</td><td>${esc(a.note)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">尚無學員</td></tr>'}</tbody></table></div></section>`;
  return html;
}
function reportsView(){return `<section class="panel"><h2>列印與匯出</h2><p class="sub">報表會使用此刻的最新資料。簽到表先依機關排序，同機關內依姓名排序。</p><div class="form"><label class="field">場次<select id="reportSession">${state.sessions.map(x=>`<option value="${x.id}">${x.date}　${esc(x.room_name)}</option>`).join('')}</select></label></div><div class="toolbar">${button('列印座位圖','report:seat:print')}${button('下載座位圖','report:seat:download')}${button('列印考核表','report:assessment:print')}${button('下載考核表 CSV','report:assessment:csv')}${button('列印簽到表','report:signin:print')}${button('下載簽到表 CSV','report:signin:csv')}</div></section><section class="panel"><h2>其他資料</h2><div class="toolbar">${button('列印學員名冊','report:students:print')}${button('下載學員名冊 CSV','report:students:csv')}${button('列印場次清單','report:sessions:print')}${button('下載場次清單 CSV','report:sessions:csv')}</div></section>`}
function auditView(){return `<section class="panel"><h2>最近異動</h2><div class="tablewrap"><table><thead><tr><th>時間</th><th>動作</th><th>內容</th></tr></thead><tbody>${state.audit.map(x=>`<tr><td>${esc(x.at)}</td><td>${esc(x.action)}</td><td>${esc(x.detail)}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">尚無異動</td></tr>'}</tbody></table></div></section>`}
function render(){root.innerHTML=header()+`<main class="shell">${navigation()}${({overview,students:studentsView,rooms:roomView,sessions:sessionsView,assessment:assessmentView,reports:reportsView,audit:auditView})[tab]()}<div class="footer">資料由伺服器保存 · 畫面每 15 秒更新</div></main>`+(modal?modalHtml():'');renderToast()}
function modalHtml(){if(modal.type==='student'){const s=modal.student||{};return `<div class="modalback"><div class="modal"><h2>${s.id?'編輯':'新增'}學員</h2><form id="studentForm" class="stack"><div class="form"><label class="field">單位／機關<input name="agency" required value="${esc(s.agency)}"></label><label class="field">姓名<input name="name" required value="${esc(s.name)}"></label><label class="field">普查職位<input name="position" required value="${esc(s.position)}"></label></div><label class="field">其他欄位（每行：欄位名稱：內容）<textarea name="extras">${esc(Object.entries(JSON.parse(s.extras||'{}')).map(([k,v])=>`${k}：${v}`).join('\n'))}</textarea></label><div class="row between">${button('取消','close','muted')}<button class="action primary">儲存</button></div></form></div></div>`}
if(modal.type==='room')return `<div class="modalback"><div class="modal"><h2>新增教室</h2><form id="roomForm" class="stack"><label class="field">教室名稱<input name="name" required></label><div class="form"><label class="field">X 軸欄數（1–52）<input name="cols" type="number" min="1" max="52" value="8" required></label><label class="field">Y 軸列數（1–30）<input name="rows" type="number" min="1" max="30" value="6" required></label></div><div class="row between">${button('取消','close','muted')}<button class="action primary">建立</button></div></form></div></div>`;
if(modal.type==='session')return `<div class="modalback"><div class="modal"><h2>新增場次</h2><form id="sessionForm" class="stack"><label class="field">上課日期<input name="date" type="date" required></label><label class="field">教室<select name="roomId">${state.rooms.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></label><div class="row between">${button('取消','close','muted')}<button class="action primary">建立</button></div></form></div></div>`;
if(modal.type==='editSession'){const s=session(modal.id),count=assignmentsFor(s.id).length;return `<div class="modalback"><div class="modal"><h2>修改場次日期</h2><p class="sub">${esc(s.room_name)} · 目前已配置 ${count} 人</p><form id="editSessionForm" class="stack"><label class="field">新上課日期<input name="date" type="date" value="${s.date}" required></label><label class="field">原配置如何處理<select name="assignmentMode"><option value="keep">保留配置，學員隨場次改期</option><option value="reset">全部取消配置，學員回到未配置</option></select></label><p class="note">若選擇全部取消配置，原有座位和考核註記也會移除。</p><div class="row between">${button('取消','close','muted')}<button class="action primary">確認修改</button></div></form></div></div>`}
if(modal.type==='seat'){const s=session(modal.sessionId),r=room(s.room_id),seat=state.seats.find(x=>x.id===modal.seatId),available=state.students.filter(x=>x.status==='active').filter(x=>{const a=assignmentFor(x.id);return !a||!dateLock(session(a.session_id).date)});return `<div class="modalback"><div class="modal"><h2>安排 ${esc(s.date)} · ${esc(r.name)} ${seatLabel(seat)}</h2><p class="sub">已排班學員選入此座位會自動搬移原座位。</p><form id="assignForm" class="stack"><label class="field">選擇學員<select name="studentId" required>${available.map(x=>`<option value="${x.id}">${esc(fullStudent(x))}${assignmentFor(x.id)?'（改期／換位）':''}</option>`).join('')}</select></label><div class="row between">${button('取消','close','muted')}<button class="action primary" ${available.length?'':'disabled'}>確認安排</button></div></form></div></div>`}
if(modal.type==='assessment'){const a=state.assignments.find(x=>x.id===modal.id),s=student(a.student_id);return `<div class="modalback"><div class="modal"><h2>教育訓練考核</h2><p>${esc(fullStudent(s))}</p><form id="assessmentForm" class="stack"><label class="field">考核狀態<select name="status">${['待考核','通過','未通過','缺席'].map(x=>`<option ${a.assessment_status===x?'selected':''}>${x}</option>`).join('')}</select></label><label class="field">註記<textarea name="note">${esc(a.note)}</textarea></label><div class="row between">${button('取消','close','muted')}<button class="action primary">儲存註記</button></div></form></div></div>`}
if(modal.type==='import'){return `<div class="modalback"><div class="modal"><h2>匯入學員</h2><p class="sub">支援 .xlsx、.csv；欄名需有「單位、姓名、普查職位」。其他欄位會一併保存。</p><input id="importFile" type="file" accept=".xlsx,.csv">${importPreview?`<div class="note good">預覽：${importPreview.length} 筆。匯入時會略過既有學員。</div><div class="tablewrap"><table><thead><tr><th>單位</th><th>姓名</th><th>普查職位</th></tr></thead><tbody>${importPreview.slice(0,8).map(x=>`<tr><td>${esc(x.agency)}</td><td>${esc(x.name)}</td><td>${esc(x.position)}</td></tr>`).join('')}</tbody></table></div>`:''}<div class="toolbar">${button('取消','close','muted')}${button('確認匯入','confirmImport','primary')}</div></div></div>`}return ''}
function download(name,content,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function csv(rows){return '\ufeff'+rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n')}
function reportData(kind,id){const s=session(id),r=s&&room(s.room_id),sorted=s?assignmentsFor(s.id).map(a=>({a,st:student(a.student_id),seat:state.seats.find(x=>x.id===a.seat_id)})).sort((x,y)=>x.st.agency.localeCompare(y.st.agency,'zh-Hant')||x.st.name.localeCompare(y.st.name,'zh-Hant')):[];
if(kind==='students')return {title:'學員名冊',heads:['機關','姓名','普查職位','狀態'],rows:state.students.map(x=>[x.agency,x.name,x.position,x.status==='active'?'有效':'退訓'])};
if(kind==='sessions')return {title:'場次清單',heads:['日期','教室','座位數','已安排'],rows:state.sessions.map(x=>[x.date,x.room_name,seatsFor(x.room_id).length,assignmentsFor(x.id).length])};
if(kind==='assessment')return {title:`${s.date} ${r.name} 考核表`,heads:['機關','姓名','普查職位','座號','考核狀態','註記'],rows:sorted.map(x=>[x.st.agency,x.st.name,x.st.position,seatLabel(x.seat),x.a.assessment_status,x.a.note])};
if(kind==='signin')return {title:`${s.date} ${r.name} 簽到表`,heads:['機關','姓名','普查職位','座號','簽名'],rows:sorted.map(x=>[x.st.agency,x.st.name,x.st.position,seatLabel(x.seat),''])};return null}
function printHtml(title,body,save=false){const doc=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:'Noto Sans TC',sans-serif;color:#17314d;padding:28px}h1{font-size:23px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #789;padding:9px;text-align:left;font-size:12px}th{background:#edf3f7}.seatmap{overflow:visible}.mapgrid{--cell-width:76px;display:grid;gap:5px;grid-template-columns:28px repeat(var(--cols),76px);width:max-content}.axis{text-align:center;font-size:11px}.cell{width:76px;height:67px;border:1px dashed #bbb;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px;text-align:center}.cell.seat{border:2px solid #1674be;background:#d5eaff;color:#103f70}.cell.taken{border:2px solid #18845a;background:#c5eddc;color:#174e3a}.cell.podiumcell{border:2px solid #35205c;background:#4a2c83;color:#fff;font-weight:700}.cell b{font-size:12px}.podium{background:#17314d;color:white;text-align:center;padding:10px;margin:0 auto 15px;max-width:260px}@page{size:A4 landscape;margin:12mm}</style></head><body><h1>${esc(title)}</h1><div>產生時間：${esc(state.serverNow.replace('T',' '))}（台灣時間）</div><hr>${body}</body></html>`;if(save)download(`${title}.html`,doc,'text/html;charset=utf-8');else{const w=window.open('','_blank');if(!w){toast('請允許瀏覽器開啟列印視窗',true);return}w.document.write(doc);w.document.close();setTimeout(()=>w.print(),350)}}
async function runReport(parts){const selectedId=Number(document.querySelector('#reportSession')?.value);await refresh();tab='reports';render();const [kind,format]=parts;const id=selectedId||state.sessions[0]?.id;if(kind==='seat'){const s=session(id),r=s&&room(s.room_id);if(!s||!r)return toast('尚無場次',true);return printHtml(`${s.date} ${r.name} 座位圖`,map(r,s,false,'print'),format==='download')};const data=reportData(kind,id);if(!data)return toast('尚無場次',true);if(format==='csv')download(`${data.title}.csv`,csv([data.heads,...data.rows]),'text/csv;charset=utf-8');else printHtml(data.title,`<table><thead><tr>${data.heads.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${data.rows.map(row=>`<tr>${row.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)}
root.addEventListener('click',async e=>{
  const target=e.target.closest('[data-action]');
  if(!target||tab!=='sessions')return;
  const action=target.dataset.action;
  if(action==='editSession'){
    e.stopImmediatePropagation();
    const s=session(chosenSession);
    if(!s||dateLock(s.date))return toast('該場次已鎖定',true);
    modal={type:'editSession',id:s.id};render();
  }
  if(action==='deleteSession'){
    e.stopImmediatePropagation();
    const s=session(chosenSession);
    if(!s||dateLock(s.date))return toast('該場次已鎖定',true);
    const count=assignmentsFor(s.id).length;
    if(confirm(`確定刪除 ${s.date} ${s.room_name}？已配置的 ${count} 位學員會回到未配置。`))await mutate('/sessions/delete',{sessionId:s.id});
  }
},true);
root.addEventListener('submit',async e=>{
  if(e.target.id!=='editSessionForm')return;
  e.preventDefault();e.stopImmediatePropagation();
  const form=Object.fromEntries(new FormData(e.target));
  await mutate('/sessions/update',{sessionId:modal.id,date:form.date,resetAssignments:form.assignmentMode==='reset'});
},true);
root.addEventListener('click',async e=>{
  const target=e.target.closest('[data-action]');if(!target)return;
  const [action,idText]=target.dataset.action.split(':'),id=Number(idText);
  if(action==='deleteStudent'&&tab==='students'){
    e.stopImmediatePropagation();
    const st=student(id);if(!st)return;
    const a=assignmentFor(id),ss=a&&session(a.session_id);
    if(confirm(`確定永久刪除「${st.agency}／${st.name}」？${ss?`此人目前在 ${ss.date} ${ss.room_name}，座位會一併釋出。`:''}此操作無法復原。`))await mutate('/students/delete',{studentId:id});
  }
  if(action==='deleteRoom'&&tab==='rooms'){
    e.stopImmediatePropagation();
    const r=room(id);if(!r)return;
    const sessions=state.sessions.filter(s=>s.room_id===id);
    const count=sessions.reduce((n,s)=>n+assignmentsFor(s.id).length,0);
    if(confirm(`確定永久刪除「${r.name}」及其座位圖？將一併刪除 ${sessions.length} 個場次，並讓 ${count} 位學員回到未配置。此操作無法復原。`)){
      const ok=await mutate('/rooms/delete',{roomId:id});
      if(ok){layoutDraft=null;render()}
    }
  }
},true);
root.addEventListener('click',async e=>{const t=e.target.closest('[data-tab],[data-action]');if(!t)return;if(t.dataset.tab){tab=t.dataset.tab;render();return}const action=t.dataset.action,[verb,...parts]=action.split(':');if(verb==='close'){modal=null;importPreview=null;render();return}if(verb==='newStudent'||verb==='editStudent'){modal={type:'student',student:verb==='editStudent'?student(Number(parts[0])):null};render();return}if(verb==='newRoom'){modal={type:'room'};render();return}if(verb==='newSession'){modal={type:'session'};render();return}if(verb==='room'){chosenRoom=Number(parts[0]);const r=room(chosenRoom);layoutDraft={seats:seatsFor(r.id).map(s=>({x:s.x,y:s.y})),podium_x:r.podium_x,podium_y:r.podium_y};render();return}if(verb==='toggleSeat'){if(!layoutDraft)return;const x=Number(parts[0]),y=Number(parts[1]),i=layoutDraft.seats.findIndex(s=>s.x===x&&s.y===y);if(i>=0)layoutDraft.seats.splice(i,1);else layoutDraft.seats.push({x,y});render();return}if(verb==='saveLayout'){const r=room(chosenRoom);const ok=await mutate('/rooms/layout',{roomId:r.id,seats:layoutDraft?.seats||seatsFor(r.id),podium_x:Number(document.querySelector('#podiumX').value),podium_y:Number(document.querySelector('#podiumY').value)});if(ok)layoutDraft=null;return}if(verb==='chooseSeat'){const s=session(Number(parts[0]));if(dateLock(s.date)){toast('該場次已鎖定',true);return}modal={type:'seat',sessionId:s.id,seatId:Number(parts[1])};render();return}if(verb==='assess'){modal={type:'assessment',id:Number(parts[0])};render();return}if(verb==='withdraw'){if(confirm('確定標記退訓並釋出座位？'))await mutate('/students/withdraw',{studentId:Number(parts[0])});return}if(verb==='restore'){await mutate('/students/restore',{studentId:Number(parts[0])});return}if(verb==='template'){download('學員匯入範例.csv',csv([['單位','姓名','普查職位','備註'],['範例機關','王小明','組長','範例資料，匯入前請刪除']]),'text/csv;charset=utf-8');return}if(verb==='import'){modal={type:'import'};importPreview=null;render();return}if(verb==='confirmImport'){if(!importPreview?.length)return toast('請先選擇檔案',true);await mutate('/students/import',{rows:importPreview});return}if(verb==='report'){await runReport(parts);return}});
function parseCsv(text){const rows=[],row=[];let value='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(value);value=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);rows.push([...row]);row.length=0;value=''}else value+=c}if(value||row.length){row.push(value);rows.push(row)}const heads=(rows.shift()||[]).map((x,i)=>i===0?x.replace(/^\ufeff/,''):x);return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(heads.map((k,i)=>[k,r[i]??''])))}
root.addEventListener('change',async e=>{if(e.target.id==='sessionSelect'){chosenSession=Number(e.target.value);render()}if(e.target.id==='importFile'){try{const file=e.target.files[0];if(!file)return;let records;if(file.name.toLowerCase().endsWith('.csv'))records=parseCsv(await file.text());else if(file.name.toLowerCase().endsWith('.xlsx')){const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await file.arrayBuffer());const sheet=workbook.worksheets[0],heads=[];sheet.getRow(1).eachCell((cell,n)=>heads[n]=String(cell.text).trim());records=[];sheet.eachRow((row,n)=>{if(n===1)return;const object={};heads.forEach((key,i)=>{if(key)object[key]=String(row.getCell(i).text||'').trim()});if(Object.values(object).some(Boolean))records.push(object)})}else throw Error('只支援 .xlsx 或 .csv 檔案');importPreview=records.map(row=>{const agency=String(row['單位']??row['機關']??'').trim(),name=String(row['姓名']??'').trim(),position=String(row['普查職位']??'').trim(),extras={};for(const [k,v] of Object.entries(row))if(!['單位','機關','姓名','普查職位'].includes(k)&&String(v).trim())extras[k]=String(v);return{agency,name,position,extras}});if(importPreview.some(r=>!r.agency||!r.name||!r.position))throw Error('有資料缺少單位、姓名或普查職位');render()}catch(err){importPreview=null;toast(err.message,true)}}});
root.addEventListener('submit',async e=>{e.preventDefault();const f=e.target,form=Object.fromEntries(new FormData(f));if(f.id==='studentForm'){const extras={};String(form.extras||'').split('\n').forEach(line=>{const p=line.indexOf('：');if(p>0)extras[line.slice(0,p).trim()]=line.slice(p+1).trim()});await mutate('/students',{id:modal.student?.id,agency:form.agency,name:form.name,position:form.position,extras})}if(f.id==='roomForm')await mutate('/rooms',{name:form.name,cols:Number(form.cols),rows:Number(form.rows)});if(f.id==='sessionForm')await mutate('/sessions',{date:form.date,roomId:Number(form.roomId)});if(f.id==='assignForm')await mutate('/assign',{studentId:Number(form.studentId),sessionId:modal.sessionId,seatId:modal.seatId});if(f.id==='assessmentForm')await mutate('/assessment',{assignmentId:modal.id,status:form.status,note:form.note})});
refresh().catch(e=>{root.innerHTML=`<main class="shell"><div class="note">無法連接本機伺服器：${esc(e.message)}</div></main>`});
setInterval(()=>{if(!modal&&!layoutDraft&&!draggingStudentId)refresh().catch(()=>{})},15000);

// Layout editor actions run in capture phase so the general action handler cannot save a partial map.
root.addEventListener('click',async e=>{
  const target=e.target.closest('[data-action]');
  if(!target)return;
  const [verb,...parts]=target.dataset.action.split(':');
  if(!['room','mode','toggleAisle','setPodium','toggleSeat','saveLayout'].includes(verb))return;
  e.stopImmediatePropagation();
  if(verb==='room'){
    chosenRoom=Number(parts[0]);const r=room(chosenRoom);
    layoutDraft={seats:seatsFor(r.id).map(x=>({x:x.x,y:x.y})),aisles:aislesFor(r.id).map(x=>({x:x.x,y:x.y})),podium_x:r.podium_x,podium_y:r.podium_y};
    layoutMode='seat';render();return;
  }
  if(!layoutDraft)return;
  if(verb==='mode'){layoutMode=parts[0];render();return}
  if(verb==='saveLayout'){
    const r=room(chosenRoom);
    const ok=await mutate('/rooms/layout',{roomId:r.id,seats:layoutDraft.seats,aisles:layoutDraft.aisles,podium_x:Number(document.querySelector('#podiumX').value),podium_y:Number(document.querySelector('#podiumY').value)});
    if(ok)layoutDraft=null;return;
  }
  if(verb==='toggleAisle'){
    const x=Number(parts[0]);
    const index=layoutDraft.aisles.findIndex(p=>p.x===x);
    if(index>=0)layoutDraft.aisles.splice(index,1);else layoutDraft.aisles.push({x,y:0});
    render();return;
  }
  const x=Number(parts[0]),y=Number(parts[1]);
  if(verb==='setPodium'){
    if(layoutDraft.seats.some(p=>p.x===x&&p.y===y)){toast('請先清除此格的座位',true);return}
    layoutDraft.podium_x=x;layoutDraft.podium_y=y;render();return;
  }
  if(x===layoutDraft.podium_x&&y===layoutDraft.podium_y){toast('講台不能與座位重疊',true);return}
  const targetList=layoutDraft.seats;
  const index=targetList.findIndex(p=>p.x===x&&p.y===y);
  if(index>=0)targetList.splice(index,1);else targetList.push({x,y});
  render();
},true);
root.addEventListener('input',e=>{
  if(!layoutDraft)return;
  if(e.target.id==='podiumX')layoutDraft.podium_x=Number(e.target.value);
  if(e.target.id==='podiumY')layoutDraft.podium_y=Number(e.target.value);
});

// Keep assessment and scheduling controls on their own pages.
root.addEventListener('click',async e=>{
  const tabButton=e.target.closest('[data-tab]');
  if(tabButton){modal=null;selectedStudentId=null;return}
  const target=e.target.closest('[data-action]');if(!target)return;
  const [verb,...parts]=target.dataset.action.split(':');
  if(verb==='unassign'){
    e.stopImmediatePropagation();
    if(tab!=='sessions')return;
    const ok=await mutate('/unassign',{assignmentId:Number(parts[0])});
    if(ok){selectedStudentId=null;render()}
    return;
  }
  if(verb==='assess'&&tab!=='assessment'||verb==='chooseSeat'&&tab!=='sessions')e.stopImmediatePropagation();
},true);
root.addEventListener('change',e=>{
  if(e.target.id==='assessmentSessionSelect'){
    assessmentSessionId=Number(e.target.value);render();
  }
});

// Roster selection and native drag-and-drop share the same atomic assignment endpoint.
root.addEventListener('click',async e=>{
  const target=e.target.closest('[data-action]');if(!target)return;
  const [verb,...parts]=target.dataset.action.split(':');
  if(verb==='selectStudent'){
    if(suppressCardClick){e.stopImmediatePropagation();suppressCardClick=false;return}
    e.stopImmediatePropagation();
    const st=student(Number(parts[0]));
    if(!st||!movableStudent(st)){toast('原場次已鎖定，無法移動此學員',true);return}
    selectedStudentId=selectedStudentId===st.id?null:st.id;render();return;
  }
  if(verb==='chooseSeat'&&selectedStudentId){
    e.stopImmediatePropagation();
    const st=student(selectedStudentId);
    if(!st||!movableStudent(st)){toast('原場次已鎖定，無法移動此學員',true);return}
    const ok=await mutate('/assign',{studentId:st.id,sessionId:Number(parts[0]),seatId:Number(parts[1])});
    if(ok){selectedStudentId=null;render()}
  }
},true);
root.addEventListener('change',e=>{
  if(e.target.id==='agencyFilter'){filterAgency=e.target.value;render()}
  if(e.target.id==='statusFilter'){filterStatus=e.target.value;render()}
});
root.addEventListener('input',e=>{
  if(e.target.id==='studentSearch'){
    filterText=e.target.value;
    const list=document.querySelector('#studentList');if(list)list.innerHTML=studentList();
  }
});
let pointerDrag=null, suppressCardClick=false;
function clearPointerDrag(){
  pointerDrag?.ghost?.remove();
  document.querySelectorAll('.drop-over').forEach(x=>x.classList.remove('drop-over'));
  pointerDrag=null;draggingStudentId=null;
}
root.addEventListener('pointerdown',e=>{
  const card=e.target.closest('[data-student-id]');if(!card||e.button!==0)return;
  const st=student(Number(card.dataset.studentId));if(!st||!movableStudent(st))return;
  pointerDrag={id:st.id,startX:e.clientX,startY:e.clientY,moved:false,card,ghost:null};
  card.setPointerCapture?.(e.pointerId);
});
root.addEventListener('pointermove',e=>{
  if(!pointerDrag)return;
  const drag=pointerDrag;
  if(!drag.moved&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<8)return;
  if(!drag.moved){
    drag.moved=true;draggingStudentId=drag.id;
    const st=student(drag.id);drag.ghost=document.createElement('div');drag.ghost.className='drag-ghost';drag.ghost.textContent=`${st.name} · ${st.agency}`;document.body.append(drag.ghost);
  }
  e.preventDefault();
  drag.ghost.style.left=`${e.clientX+14}px`;drag.ghost.style.top=`${e.clientY+14}px`;
  document.querySelectorAll('.drop-over').forEach(x=>x.classList.remove('drop-over'));
  document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-drop-seat]')?.classList.add('drop-over');
});
root.addEventListener('pointerup',async e=>{
  if(!pointerDrag)return;
  const drag=pointerDrag,seat=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-drop-seat]');
  clearPointerDrag();
  if(!drag.moved)return;
  suppressCardClick=true;setTimeout(()=>{suppressCardClick=false},250);
  if(!seat){toast('請將學員放到藍色空位',true);return}
  const ok=await mutate('/assign',{studentId:drag.id,sessionId:Number(seat.dataset.dropSession),seatId:Number(seat.dataset.dropSeat)});
  if(ok){selectedStudentId=null;render()}
});
root.addEventListener('pointercancel',clearPointerDrag);
root.addEventListener('click',e=>{
  if(suppressCardClick&&e.target.closest('[data-student-id]')){e.stopImmediatePropagation();suppressCardClick=false}
},true);
root.addEventListener('dragstart',e=>{
  const card=e.target.closest('[data-student-id]');if(!card)return;
  const st=student(Number(card.dataset.studentId));
  if(!st||!movableStudent(st)){e.preventDefault();return}
  draggingStudentId=st.id;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',String(st.id));
  card.classList.add('dragging');
});
root.addEventListener('dragend',()=>{
  draggingStudentId=null;
  document.querySelectorAll('.dragging,.drop-over').forEach(x=>x.classList.remove('dragging','drop-over'));
});
root.addEventListener('dragover',e=>{
  const seat=e.target.closest('[data-drop-seat]');if(!seat||!draggingStudentId)return;
  e.preventDefault();e.dataTransfer.dropEffect='move';seat.classList.add('drop-over');
});
root.addEventListener('dragleave',e=>{
  const seat=e.target.closest('[data-drop-seat]');if(seat&&!seat.contains(e.relatedTarget))seat.classList.remove('drop-over');
});
root.addEventListener('drop',async e=>{
  const seat=e.target.closest('[data-drop-seat]');if(!seat)return;
  e.preventDefault();seat.classList.remove('drop-over');
  const id=Number(e.dataTransfer.getData('text/plain')||draggingStudentId);
  draggingStudentId=null;
  const st=student(id);
  if(!st||!movableStudent(st)){toast('該學員目前無法改期或換位',true);return}
  const ok=await mutate('/assign',{studentId:id,sessionId:Number(seat.dataset.dropSession),seatId:Number(seat.dataset.dropSeat)});
  if(ok){selectedStudentId=null;render()}
});

