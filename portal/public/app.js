/* ================= Buzzer Portal — frontend ================= */
const S = {
  token: localStorage.getItem('token') || null,
  user: null,
  view: 'teams',
  contestId: null,
  roundId: null,
  contests: [],
  teams: [],
  device: {},
  test: {},
  contest: null,
  judge: { active: false },
  selOption: null,
  marksValue: '',
  liveKey: null,
  adminLiveKey: null,
};

function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ================= icons (inline SVG, stroke = currentColor) ================= */
const ICONS = {
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  trophy: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
};

function icon(name, size=18){
  const inner = ICONS[name] || '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function roundTypeIcon(r){
  return icon(r.type==='rapid'?'zap':r.type==='activity'?'target':'list', 15);
}

// True while the user is typing in any field - prevents polling from stealing focus.
function isEditing(){
  const ae = document.activeElement;
  if (!ae) return false;
  const tag = ae.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable;
}

async function api(method, url, body){
  const opt = { method, headers:{} };
  if (S.token) opt.headers['Authorization'] = 'Bearer ' + S.token;
  if (body !== undefined){ opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  const d = await r.json().catch(()=>({ok:false,error:'Bad response'}));
  if (r.status === 401 && S.token){ logout(); }
  return d;
}

/* ================= routing ================= */
function navigate(url){
  if (location.pathname !== url) history.pushState(null, '', url);
  handleRoute();
}

function handleRoute(){
  const p = location.pathname;
  if (!S.user){
    renderLogin();
    return;
  }
  if (S.user.role === 'judge'){
    if (p !== '/judge') history.replaceState(null, '', '/judge');
    renderJudgeShell();
    renderJudge();
    startJudgePoll();
    return;
  }
  const parts = p.split('/').filter(Boolean);
  const seg = parts[0] || 'teams';
  let view = seg;
  let contestId = null;
  if (seg === 'contests' && parts[1]) { view = 'contest'; contestId = Number(parts[1]); }
  if (!['teams','contests','contest','users'].includes(view)) view = 'teams';

  S.view = view;
  S.contestId = (view === 'contest') ? contestId : null;
  if (view !== 'contest') stopPoll();
  renderAppShell();
  refresh();
}

function renderLogin(){
  stopPoll();
  document.getElementById('root').innerHTML = loginHTML();
  applyTheme();
}

function loginHTML(){
  return `<div class="login-wrap">
    <button class="btn ghost sm iconbtn" data-theme-toggle onclick="toggleTheme()" style="position:fixed;top:16px;right:16px"></button>
    <form class="login" onsubmit="doLogin(event)">
    <h1>Buzzer <span style="color:var(--acc)">Portal</span></h1>
    <div class="sub">Sign in to manage contests and evaluation</div>
    <div class="field"><label>Username</label><input id="loginUser" class="input" autocomplete="username"></div>
    <div class="field"><label>Password</label><input id="loginPass" class="input" type="password" autocomplete="current-password"></div>
    <button class="btn" style="width:100%">Sign in</button>
    <div id="loginMsg"></div>
  </form></div>`;
}

async function doLogin(e){
  e.preventDefault();
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const d = await api('POST','/api/auth/login',{username,password});
  if (!d.ok){ const m=document.getElementById('loginMsg'); m.innerHTML='<div class="msg err">'+esc(d.error||'Invalid credentials')+'</div>'; return; }
  S.token = d.token; S.user = d.user;
  localStorage.setItem('token', d.token);
  history.replaceState(null,'', S.user.role==='judge' ? '/judge' : '/teams');
  handleRoute();
  if (!badgeTimer) badgeTimer = setInterval(refreshDeviceBadge, 4000);
}

function logout(){
  api('POST','/api/auth/logout').catch(()=>{});
  S.token = null; S.user = null; localStorage.removeItem('token');
  stopPoll();
  if (badgeTimer){ clearInterval(badgeTimer); badgeTimer = null; }
  navigate('/login');
}

/* ================= app shell ================= */
function renderAppShell(){
  const root = document.getElementById('root');
  const active = S.view;
  const isAdmin = S.user.role === 'admin';
  const title = S.view==='contest' ? 'Contest' : S.view.charAt(0).toUpperCase()+S.view.slice(1);
  root.innerHTML = `<div class="app">
    <aside class="sidebar">
      <div class="brand"><span class="logo">${icon('zap',16)}</span>Buzzer <span>Portal</span></div>
      <a class="nav-item ${active==='teams'?'active':''}" href="/teams" data-nav>${icon('users')}<span>Teams</span></a>
      <a class="nav-item ${active==='contests'||active==='contest'?'active':''}" href="/contests" data-nav>${icon('trophy')}<span>Contests</span></a>
      ${isAdmin?'<a class="nav-item '+(active==='users'?'active':'')+'" href="/users" data-nav>'+icon('shield')+'<span>Users</span></a>':''}
      <div class="foot">
        <div class="user-tag"><span class="mut small">Signed in as</span><br>${esc(S.user.name)}</div>
        <a class="nav-item" href="/login" data-nav>${icon('logout')}<span>Logout</span></a>
      </div>
    </aside>
    <div class="main">
      <div class="topbar">
        <div class="title">${title}</div>
        <div class="spacer"></div>
        <span id="devBadge" class="badge">Device</span>
        <button class="btn ghost sm iconbtn" data-theme-toggle onclick="toggleTheme()"></button>
      </div>
      <div class="content" id="content"></div>
    </div>
  </div>`;
  bindNav();
  applyTheme();
}

function bindNav(){
  document.querySelectorAll('a[data-nav]').forEach(a=>{
    a.addEventListener('click', e=>{
      e.preventDefault();
      if (a.getAttribute('href') === '/login'){ logout(); return; }
      navigate(a.getAttribute('href'));
    });
  });
}

function renderJudgeShell(){
  document.getElementById('root').innerHTML = `<div class="app"><div class="main">
    <div class="topbar"><div class="title">Judge Panel</div><div class="sub">${esc(S.user.name)}</div><div class="spacer"></div>
    <button class="btn ghost sm iconbtn" data-theme-toggle onclick="toggleTheme()"></button>
    <a class="btn ghost sm" href="/login" data-nav>${icon('logout',16)}<span>Logout</span></a></div>
    <div class="content" id="content" style="max-width:720px"></div>
  </div></div>`;
  bindNav();
  applyTheme();
}

/* ================= data refresh ================= */
async function refresh(){
  if (S.view === 'teams') await renderTeams();
  else if (S.view === 'contests') await renderContests();
  else if (S.view === 'contest') await renderContest();
  else if (S.view === 'users') renderUsers();
  refreshDeviceBadge();
}

async function refreshDeviceBadge(){
  if (!S.token) return;
  try{
    const d = await api('GET','/api/teams');
    S.device = d.device || {}; S.test = d.test || {}; S.teams = d.teams || [];
    const b = document.getElementById('devBadge');
    if (!b) return;
    const on = d.deviceOnline;
    b.innerHTML = '<span class="dot '+(on?'on':'off')+'"></span>'+(on?'Device online':'Device offline');
    b.className = 'badge '+(on?'live':'bad');
  }catch(e){}
}

function stopPoll(){ if (S.pollTimer){ clearInterval(S.pollTimer); S.pollTimer = null; } }
function startJudgePoll(){ stopPoll(); S.pollTimer = setInterval(tickJudge, 1200); }

/* ================= teams ================= */
async function renderTeams(){
  const d = await api('GET','/api/teams');
  S.teams = d.teams || []; S.device = d.device||{}; S.test = d.test||{};
  let rows = S.teams.map(t=>`
    <tr><td><b>${esc(t.name)}</b></td><td class="mono">GPIO ${t.pin}</td>
    <td>${testStatus(t)}</td>
    <td style="text-align:right"><button class="btn danger sm" onclick="delTeam(${t.id})">${icon('trash',14)}<span>Remove</span></button></td></tr>`).join('');
  if (!rows) rows = '<tr><td colspan="4" class="mut">No teams yet.</td></tr>';

  document.getElementById('content').innerHTML = `
    <div class="grid c2">
      <div>
        <div class="card">
          <h3>Add Team</h3>
          <div class="row">
            <input id="teamName" class="input grow" placeholder="Team name" maxlength="24" onkeydown="if(event.key==='Enter')addTeam()">
            <button class="btn" onclick="addTeam()">${icon('plus',16)}<span>Add Team</span></button>
          </div>
          <div id="teamMsg"></div>
          <p class="mut small" style="margin-top:10px">A free GPIO pin is assigned automatically and pushed to the device. Wire the button between that pin and <b>GND</b>.</p>
        </div>
        <div class="card">
          <h3>Device</h3>
          <div class="row">
            <button class="btn ghost" onclick="checkConn()">${icon('wifi',16)}<span>Check connection</span></button>
            <button class="btn ghost" onclick="startTest()">${icon('play',16)}<span>Test buzzers</span></button>
            ${S.test.active?'<button class="btn ghost" onclick="stopTest()">Finish test</button>':''}
          </div>
          <div id="testMsg" class="mut small" style="margin-top:10px"></div>
        </div>
      </div>
      <div>
        <div class="card">
          <h3>Teams <span class="badge">${S.teams.length}</span></h3>
          <table class="t"><thead><tr><th>Name</th><th>Pin</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        </div>
      </div>
    </div>`;
  if (S.test.active){ stopPoll(); S.pollTimer = setInterval(()=>{ if(!isEditing()) renderTeams(); }, 1500); }
}

function testStatus(t){
  if (S.test.active){
    return S.test.results && S.test.results[t.id] ? '<span class="dot on"></span>Online' : '<span class="dot off"></span>Offline';
  }
  return '<span class="dot idle"></span>—';
}

async function addTeam(){
  const inp = document.getElementById('teamName');
  const name = inp.value.trim();
  if (!name){ flash(document.getElementById('teamMsg'),'Enter a name','err'); return; }
  const d = await api('POST','/api/teams',{name});
  if (!d.ok){ flash(document.getElementById('teamMsg'),d.error,'err'); return; }
  inp.value='';
  flash(document.getElementById('teamMsg'),'Added "'+name+'" — wire to GPIO '+d.team.pin,'ok');
  renderTeams();
}
async function delTeam(id){ await api('DELETE','/api/teams/'+id); renderTeams(); }
async function checkConn(){ await api('POST','/api/check'); }
async function startTest(){ await api('POST','/api/test/start'); renderTeams(); }
async function stopTest(){ await api('POST','/api/test/stop'); renderTeams(); }

/* ================= contests ================= */
async function renderContests(){
  const d = await api('GET','/api/contests');
  S.contests = d.contests || [];
  let list = S.contests.map(c=>`
    <tr style="cursor:pointer" onclick="navigate('/contests/${c.id}')">
      <td><b>${esc(c.name)}</b></td>
      <td>${c.rounds} rounds</td><td>${c.teams} teams</td>
      <td>${statusBadge(c.status)}</td>
      <td class="mut small">${new Date(c.createdAt).toLocaleString()}</td>
    </tr>`).join('');
  if (!list) list = '<tr><td colspan="5" class="mut">No contests yet.</td></tr>';
  document.getElementById('content').innerHTML = `
    <div class="card">
      <h3>Contests</h3>
      <div class="row" style="margin-bottom:14px">
        <input id="contestName" class="input grow" placeholder="New contest name" onkeydown="if(event.key==='Enter')createContest()">
        <button class="btn" onclick="createContest()">${icon('plus',16)}<span>New Contest</span></button>
      </div>
      <div id="contestMsg"></div>
      <table class="t"><thead><tr><th>Name</th><th>Rounds</th><th>Teams</th><th>Status</th><th>Created</th></tr></thead><tbody>${list}</tbody></table>
    </div>`;
}

function statusBadge(s){
  if (s==='running') return '<span class="badge live">Running</span>';
  if (s==='rules') return '<span class="badge purple">Rules</span>';
  if (s==='finished') return '<span class="badge">Finished</span>';
  return '<span class="badge">Setup</span>';
}

async function createContest(){
  const inp = document.getElementById('contestName');
  const name = inp.value.trim();
  if (!name) return;
  const d = await api('POST','/api/contests',{name});
  if (!d.ok){ flash(document.getElementById('contestMsg'),d.error,'err'); return; }
  navigate('/contests/'+d.contest.id);
}

/* ================= contest detail ================= */
async function renderContest(){
  if (!S.contestId){ renderContests(); return; }
  const d = await api('GET','/api/contests/'+S.contestId);
  S.contest = d.contest;
  const c = S.contest;
  const running = c.rounds.find(r=>r.id===c.currentRoundId && r.status==='running');
  const selId = S.roundId || c.currentRoundId || (c.rounds[0] && c.rounds[0].id);
  S.roundId = selId;

  const roundsNav = c.rounds.map(r=>`
    <a class="round-item ${r.id===selId?'active':''}" href="/contests/${c.id}" data-round="${r.id}">
      <span class="rtic">${roundTypeIcon(r)}</span>
      <span>${esc(r.name)}</span>
      <span class="st">${roundBadge(r)}</span>
    </a>`).join('');

  document.getElementById('content').innerHTML = `
    <div class="row" style="margin-bottom:16px">
      <button class="btn ghost sm" onclick="navigate('/contests')">${icon('arrowLeft',15)}<span>Back</span></button>
      <div class="grow"><h2 style="font-size:19px">${esc(c.name)}</h2>
      <div class="mut small">${c.teams.length} teams · ${c.rounds.length} rounds</div></div>
      ${(c.status!=='running'&&c.status!=='finished')?`<button class="btn ghost sm" onclick="showEditContestModal()">${icon('edit',15)}<span>Edit Contest</span></button>`:''}
      ${(c.status==='rules'||c.status==='finished')?`<button class="btn ghost sm" onclick="resetContest()">${icon('arrowLeft',15)}<span>Back to setup</span></button>`:''}
      <button class="btn ${c.testMode?'warn':'ghost'} sm" onclick="toggleTestMode()">${c.testMode?'Testing Mode: On':'Testing Mode: Off'}</button>
      ${statusBadge(c.status)}
    </div>
    ${c.testMode?`<div class="card" style="border-color:var(--warn);background:rgba(245,166,35,.08);padding:12px 16px;margin-bottom:16px;color:var(--txt)">
      <b style="color:var(--warn)">Testing mode is on.</b> Start/stop rounds anytime and use <b>Reset Round</b> to clear its responses and score so you can test again. Everything behaves normally otherwise.
    </div>`:''}
    <div style="display:grid;grid-template-columns:230px 1fr;gap:18px" class="contest-grid">
      <div>
        <div class="card"><h3>Rounds</h3><div class="roundnav">${roundsNav||'<div class="mut small">No rounds</div>'}</div>
        <button class="btn sm" style="width:100%;margin-top:10px" onclick="showRoundModal()">${icon('plus',15)}<span>Add Round</span></button></div>
        <div class="card"><h3>Actions</h3>
          ${c.status==='setup'?`<button class="btn" style="width:100%" onclick="startContest()">${icon('play',16)}<span>Start Contest</span></button>`:''}
          ${c.status==='finished'?'<span class="badge">Finished</span>':''}
        </div>
      </div>
      <div id="roundPane"></div>
    </div>`;

  document.querySelectorAll('a[data-round]').forEach(a=>{
    a.addEventListener('click', e=>{ e.preventDefault(); S.roundId = Number(a.getAttribute('data-round')); renderContest(); });
  });

  const pane = document.getElementById('roundPane');
  const selRound = c.rounds.find(r=>r.id===selId);
  if (running){
    S.adminLiveKey = liveLayoutKey(running);
    pane.innerHTML = liveHTML(c, running);
  } else if (selRound && selRound.status==='finished'){
    pane.innerHTML = resultsHTML(c, selRound);
  } else if (selRound){
    pane.innerHTML = roundSetupHTML(c, selRound);
  } else {
    pane.innerHTML = '<div class="card"><div class="empty">Select or add a round.</div></div>';
  }
  if (running){ stopPoll(); S.pollTimer = setInterval(tickContest, 700); }
  else { stopPoll(); }
}

function roundBadge(r){
  if (r.status==='running') return '<span class="badge live">Live</span>';
  if (r.status==='finished') return '<span class="badge">Done</span>';
  return '<span class="badge">Setup</span>';
}

/* ----- round setup ----- */
function roundSetupHTML(c, r){
  const editable = c.status !== 'running' && c.status !== 'finished';
  const qs = r.questions.map((q,i)=>`
    <div class="card" style="padding:12px;margin-bottom:8px">
      <div class="row">
        <div class="grow"><b>Q${i+1}.</b> ${esc(q.text||'(no text)')}</div>
        ${q.image?'<span class="badge purple">image</span>':''}${q.video?'<span class="badge purple">video</span>':''}
        ${editable?`<button class="btn ghost sm" onclick="showQuestionModal(${r.id},${q.id})">${icon('edit',14)}<span>Edit</span></button>`:''}
        ${editable?`<button class="btn danger sm" onclick="delQuestion(${r.id},${q.id})">${icon('trash',14)}<span>Remove</span></button>`:''}
      </div>
      ${r.isMcq?`<div class="small mut" style="margin-top:6px">${q.options.map(o=>esc(o.text)+(o.correct?' (correct)':'')).join(' · ')}</div>`:''}
    </div>`).join('');

  const teamCount = c.teams.length;
  const qCount = r.questions.length;
  const multOk = r.type==='normal' ? (teamCount && qCount%teamCount===0) : true;
  const multNote = r.type==='normal'
    ? (' · need multiple of '+teamCount+' teams '+(multOk ? 'OK' : ('(off by '+ (teamCount ? qCount%teamCount : '?') +')')))
    : '';

  return `<div class="card">
    <div class="row" style="margin-bottom:12px">
      <h3 style="margin:0">${esc(r.name)}</h3>
      <div class="spacer"></div>
      ${editable?`<button class="btn ghost sm" onclick="showEditRoundModal(${r.id})">${icon('edit',14)}<span>Edit Round</span></button>`:''}
      ${r.status==='setup'?`<button class="btn warn sm" onclick="startRound(${r.id})">${icon('play',15)}<span>Start Round</span></button>`:''}
    </div>
    <div class="mut small" style="margin-bottom:12px">
      ${typeDesc(r)} · ${r.isMcq?'MCQ':(r.type==='activity'?'':(r.evalBy==='judge'?'Judge evaluation':'Admin evaluation'))}
      ${r.type==='rapid'?' · -'+r.negativeMarks+' negative':''}
    </div>
    ${r.type!=='activity'?`
      <div class="small mut" style="margin-bottom:12px">Questions: <b>${qCount}</b>${multNote}
        ${multOk?'':'<span style="color:var(--bad)"> (not a multiple of teams)</span>'}
      </div>
      ${qs||'<div class="empty">No questions yet.</div>'}
      <button class="btn sm" onclick="showQuestionModal(${r.id})">${icon('plus',15)}<span>Add Question</span></button>`
    :`<div class="mut small">${r.activityCount} activit${r.activityCount===1?'y':'ies'} per team · max ${r.maxMarksPerTeam} marks each</div>`}
  </div>`;
}

function typeDesc(r){
  if (r.type==='rapid') return 'Rapid Fire';
  if (r.type==='activity') return 'Activity Based';
  return 'Normal';
}

/* ----- modals ----- */
function showRoundModal(){
  openModal(`<h3>New Round</h3>
    <div class="field"><label>Round name</label><input id="rName" class="input"></div>
    <div class="field"><label>Round type</label><select id="rType" class="input" onchange="roundTypeChange()">
      <option value="normal">Normal</option><option value="rapid">Rapid Fire</option><option value="activity">Activity Based</option></select></div>
    <div id="rMcqWrap" class="field"><label>Question format</label><select id="rMcq" class="input" onchange="roundTypeChange()">
      <option value="mcq">MCQ (automatic evaluation)</option><option value="open">Non-MCQ (manual evaluation)</option></select></div>
    <div id="rMarksWrap" class="field"><label>Marks per question</label><input id="rMarks" class="input" type="number" value="10"></div>
    <div id="rNegWrap" class="field" style="display:none"><label>Negative marks (wrong answer)</label><input id="rNeg" class="input" type="number" value="5"></div>
    <div id="rEvalWrap" class="field" style="display:none"><label>Evaluated by</label><select id="rEval" class="input"><option value="judge">Judge</option><option value="admin">Admin</option></select></div>
    <div id="rActFields" style="display:none">
      <div class="field"><label>Activities per team</label><input id="rActCount" class="input" type="number" value="1"></div>
      <div class="field"><label>Max marks per activity</label><input id="rMaxMarks" class="input" type="number" value="20"></div>
    </div>
    <div class="row"><button class="btn" onclick="createRound()">Create</button><button class="btn ghost" onclick="closeModal()">${icon('x',16)}<span>Cancel</span></button></div>`);
  roundTypeChange();
}

function roundTypeChange(){
  const t = document.getElementById('rType').value;
  const mcq = document.getElementById('rMcq').value==='mcq';
  document.getElementById('rNegWrap').style.display = t==='rapid'?'block':'none';
  document.getElementById('rActFields').style.display = t==='activity'?'block':'none';
  document.getElementById('rMcqWrap').style.display = t==='activity'?'none':'block';
  document.getElementById('rMarksWrap').style.display = t==='activity'?'none':'block';
  document.getElementById('rEvalWrap').style.display = (t!=='activity' && !mcq)?'block':'none';
}

async function createRound(){
  const type = document.getElementById('rType').value;
  const isMcq = type==='activity'?false:document.getElementById('rMcq').value==='mcq';
  const body = {
    name: document.getElementById('rName').value.trim()||('Round '+((S.contest.rounds.length)+1)),
    type, isMcq,
    marksPerQuestion: Number(document.getElementById('rMarks').value)||0,
    negativeMarks: Number(document.getElementById('rNeg').value)||0,
    evalBy: (type!=='activity' && !isMcq) ? document.getElementById('rEval').value : 'admin',
    activityCount: Number(document.getElementById('rActCount').value)||0,
    maxMarksPerTeam: Number(document.getElementById('rMaxMarks').value)||0,
  };
  const d = await api('POST','/api/contests/'+S.contestId+'/rounds', body);
  closeModal();
  await reloadContest();
}

function showEditRoundModal(rid){
  const r = S.contest.rounds.find(x=>x.id===rid);
  const lockStruct = r.questions.length > 0;
  openModal(`<h3>Edit Round</h3>
    <div class="field"><label>Round name</label><input id="rName" class="input" value="${esc(r.name)}"></div>
    <div class="field"><label>Round type</label><select id="rType" class="input" onchange="roundTypeChange()" ${lockStruct?'disabled':''}>
      <option value="normal" ${r.type==='normal'?'selected':''}>Normal</option>
      <option value="rapid" ${r.type==='rapid'?'selected':''}>Rapid Fire</option>
      <option value="activity" ${r.type==='activity'?'selected':''}>Activity Based</option></select></div>
    <div id="rMcqWrap" class="field"><label>Question format</label><select id="rMcq" class="input" onchange="roundTypeChange()" ${lockStruct?'disabled':''}>
      <option value="mcq" ${r.isMcq?'selected':''}>MCQ (automatic evaluation)</option>
      <option value="open" ${!r.isMcq?'selected':''}>Non-MCQ (manual evaluation)</option></select></div>
    <div id="rMarksWrap" class="field"><label>Marks per question</label><input id="rMarks" class="input" type="number" value="${r.marksPerQuestion}"></div>
    <div id="rNegWrap" class="field"><label>Negative marks (wrong answer)</label><input id="rNeg" class="input" type="number" value="${r.negativeMarks}"></div>
    <div id="rEvalWrap" class="field"><label>Evaluated by</label><select id="rEval" class="input">
      <option value="judge" ${r.evalBy==='judge'?'selected':''}>Judge</option>
      <option value="admin" ${r.evalBy==='admin'?'selected':''}>Admin</option></select></div>
    <div id="rActFields">
      <div class="field"><label>Activities per team</label><input id="rActCount" class="input" type="number" value="${r.activityCount}"></div>
      <div class="field"><label>Max marks per activity</label><input id="rMaxMarks" class="input" type="number" value="${r.maxMarksPerTeam}"></div>
    </div>
    ${lockStruct?'<div class="mut small" style="margin-bottom:10px">Type and format are locked because this round already has questions.</div>':''}
    <div class="row"><button class="btn" onclick="saveEditRound(${rid})">${icon('check',16)}<span>Save</span></button><button class="btn ghost" onclick="closeModal()">${icon('x',16)}<span>Cancel</span></button></div>`);
  roundTypeChange();
}

async function saveEditRound(rid){
  const type = document.getElementById('rType').value;
  const isMcq = type==='activity'?false:document.getElementById('rMcq').value==='mcq';
  const body = {
    name: document.getElementById('rName').value.trim(),
    type, isMcq,
    marksPerQuestion: Number(document.getElementById('rMarks').value)||0,
    negativeMarks: Number(document.getElementById('rNeg').value)||0,
    evalBy: (type!=='activity' && !isMcq) ? document.getElementById('rEval').value : 'admin',
    activityCount: Number(document.getElementById('rActCount').value)||0,
    maxMarksPerTeam: Number(document.getElementById('rMaxMarks').value)||0,
  };
  const d = await api('PATCH','/api/contests/'+S.contestId+'/rounds/'+rid, body);
  if (!d.ok){ alert(d.error); return; }
  closeModal();
  await reloadContest();
}

let qOptionCount = 4;
function showQuestionModal(rid, qid){
  const r = S.contest.rounds.find(x=>x.id===rid);
  const q = qid ? r.questions.find(x=>x.id===qid) : null;
  qOptionCount = 4;
  const mediaNote = q && (q.image||q.video)
    ? '<div class="mut small" style="margin-bottom:10px">Current media is kept unless you upload a replacement.</div>' : '';
  openModal(`<h3>${q?'Edit':'Add'} Question — ${esc(r.name)}</h3>
    <div class="field"><label>Question text</label><textarea id="qText" class="input" placeholder="Question text (required)">${q?esc(q.text):''}</textarea></div>
    ${mediaNote}
    <div class="field"><label>Image ${q&&q.image?'(replace)':'(optional)'}</label><input id="qImage" class="input" type="file" accept="image/*"></div>
    <div class="field"><label>Video ${q&&q.video?'(replace)':'(optional)'}</label><input id="qVideo" class="input" type="file" accept="video/*"></div>
    ${r.isMcq?`<div class="field"><label>Options (mark the correct one)</label><div id="qOpts"></div>
      <button class="btn sm ghost" onclick="addOption()">${icon('plus',15)}<span>Add option</span></button></div>`:''}
    <div class="row" style="margin-top:14px"><button class="btn" onclick="saveQuestion(${rid}${qid?','+qid:''})">${icon('check',16)}<span>Save</span></button><button class="btn ghost" onclick="closeModal()">${icon('x',16)}<span>Cancel</span></button></div>`);
  if (r.isMcq){
    if (q && q.options.length) q.options.forEach(o=>addOption(o.text, o.correct));
    else for (let i=0;i<qOptionCount;i++) addOption();
  }
}

function addOption(text, correct){
  const d = document.getElementById('qOpts');
  const i = d.children.length;
  const div = document.createElement('div');
  div.className='row'; div.style.marginBottom='6px';
  div.innerHTML = `<input class="input grow" placeholder="Option ${i+1}" value="${esc(text||'')}">
    <label class="opt" style="padding:0 10px;margin:0;align-self:stretch"><input type="radio" name="qcorrect" value="${i}" ${correct?'checked':''}> correct</label>`;
  d.appendChild(div);
}

async function saveQuestion(rid, qid){
  const r = S.contest.rounds.find(x=>x.id===rid);
  const q = qid ? r.questions.find(x=>x.id===qid) : null;
  const text = document.getElementById('qText').value.trim();
  if (!text){ return; }
  let image = q ? q.image : null, video = q ? q.video : null;
  const imgFile = document.getElementById('qImage').files[0];
  const vidFile = document.getElementById('qVideo').files[0];
  if (imgFile) image = (await uploadFile(imgFile)).url;
  if (vidFile) video = (await uploadFile(vidFile)).url;
  let options = q ? q.options : [];
  if (r.isMcq){
    options = [];
    const inputs = document.querySelectorAll('#qOpts input.input');
    const correct = document.querySelector('#qOpts input[name="qcorrect"]:checked');
    if (!correct){ alert('Mark the correct option'); return; }
    const correctIdx = Number(correct.value);
    inputs.forEach((inp,i)=>{ const t=inp.value.trim(); if(t) options.push({text:t, correct:i===correctIdx}); });
    if (options.length<2){ alert('At least 2 options'); return; }
  }
  const url = '/api/contests/'+S.contestId+'/rounds/'+rid+'/questions' + (qid?('/'+qid):'');
  const d = await api(qid?'PATCH':'POST', url, {text,image,video,options});
  if (!d.ok){ alert(d.error); return; }
  closeModal();
  await reloadContest();
}

async function uploadFile(file){
  const fd = new FormData(); fd.append('file', file);
  const r = await fetch('/api/upload', { method:'POST', headers:{'Authorization':'Bearer '+S.token}, body: fd });
  return r.json();
}

async function delQuestion(rid,qid){
  await api('DELETE','/api/contests/'+S.contestId+'/rounds/'+rid+'/questions/'+qid);
  await reloadContest();
}

/* ----- contest start / rules ----- */
async function showEditContestModal(){
  const d = await api('GET','/api/teams');
  const all = d.teams || [];
  const selected = new Set(S.contest.teamIds);
  const list = all.map(t=>`<label class="opt" style="margin-bottom:6px"><input type="checkbox" data-team="${t.id}" ${selected.has(t.id)?'checked':''}><span>${esc(t.name)}</span><span class="mut small" style="margin-left:auto">GPIO ${t.pin}</span></label>`).join('');
  openModal(`<h3>Edit Contest</h3>
    <div class="field"><label>Contest name</label><input id="ecName" class="input" value="${esc(S.contest.name)}"></div>
    <div class="field"><label>Participating teams</label>${list||'<div class="mut small">No teams yet. Add teams first.</div>'}</div>
    <div class="row"><button class="btn" onclick="saveEditContest()">${icon('check',16)}<span>Save</span></button><button class="btn ghost" onclick="closeModal()">${icon('x',16)}<span>Cancel</span></button></div>`);
}

async function saveEditContest(){
  const name = document.getElementById('ecName').value.trim();
  const teamIds = [...document.querySelectorAll('#modal input[data-team]:checked')].map(i=>Number(i.getAttribute('data-team')));
  const d = await api('PATCH','/api/contests/'+S.contestId, {name, teamIds});
  if (!d.ok){ alert(d.error); return; }
  closeModal();
  await reloadContest();
}

async function startContest(){
  const d = await api('POST','/api/contests/'+S.contestId+'/start');
  if (!d.ok){ alert(d.error); return; }
  openModal(`<h3>Contest Rules</h3>
    <div style="white-space:pre-wrap;font-size:13.5px;line-height:1.6;background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:16px">${esc(d.rules)}</div>
    <div class="row" style="margin-top:16px"><button class="btn" onclick="closeModal();reloadContest()">OK</button></div>`, true);
}

async function startRound(rid){
  const d = await api('POST','/api/contests/'+S.contestId+'/rounds/'+rid+'/start');
  if (!d.ok){ alert(d.error); return; }
  await reloadContest();
}

async function reloadContest(){
  const d = await api('GET','/api/contests/'+S.contestId);
  S.contest = d.contest;
  await renderContest();
}

/* ================= LIVE CONTROL ================= */
function liveLayoutKey(r){
  const l = r.live || {};
  const scored = l.lastScored ? (l.lastScored.teamId + ':' + l.lastScored.awarded) : '';
  if (r.type === 'rapid') return 'rapid|' + l.phase + '|' + (l.qIndex||0) + '|' + scored;
  return r.type + '|' + l.phase + '|' + (l.cursor||0) + '|' + scored;
}

async function tickContest(){
  if (isEditing()) return; // don't re-render while the admin is typing
  const d = await api('GET','/api/contests/'+S.contestId);
  if (!d.ok) return;
  if (isEditing()) return;
  S.contest = d.contest;
  const running = S.contest.rounds.find(r=>r.id===S.contest.currentRoundId && r.status==='running');
  if (!running){ renderContest(); refreshDeviceBadge(); return; }
  if (liveLayoutKey(running) === S.adminLiveKey){
    // Layout unchanged: update dynamic bits in place so nothing flickers.
    if (running.type === 'rapid') applyAdminQueue(running);
    await refreshDeviceBadge();
    if (running.type === 'rapid') updateArmBadge();
    return;
  }
  renderContest();
  refreshDeviceBadge();
}

function liveHTML(c, r){
  return r.type==='rapid' ? rapidLiveHTML(c, r, r.live) : normalLiveHTML(c, r, r.live);
}

/* ---- rapid fire ---- */
function rapidLiveHTML(c, r, l){
  const key = 'r'+r.id+'-'+(l.qIndex||0)+'-'+l.phase;
  const q = l.currentQuestion;
  const answered = l.lastScored;

  let body = '';
  if (l.phase === 'countdown'){
    body = '<div class="empty">Prepare — countdown…</div>';
    triggerCountdown(key, ()=> api('POST','/api/contests/'+S.contestId+'/rounds/'+r.id+'/show').then(reloadContest));
  } else if (l.phase === 'question'){
    body = questionBox(c, r, q) + rapidQueueHTML(c, r, l) + rapidAnswerHTML(c, r, l, q);
  } else if (l.phase === 'scored' && answered){
    body = `
      <div class="card" style="border-color:${answered.correct?'var(--ok)':'var(--bad)'}">
        <h3>Result</h3>
        <div style="font-size:22px;font-weight:700;margin:8px 0">${esc(answered.teamName)} — ${answered.correct?'Correct':'Wrong'} (${answered.awarded>=0?'+':''}${answered.awarded})</div>
        <button class="btn" onclick="rapidNext()">Next Question</button>
      </div>`;
  }
  const armed = S.device && S.device.mode === 'scan';
  let armBadge = '';
  if (l.phase === 'question'){
    armBadge = `<span id="armBadge" class="badge ${armed?'live':'bad'}">${armed?'Buzzers armed':'Buzzers NOT armed'}</span><button id="rearmBtn" class="btn ghost sm" onclick="rearmBuzzers()" style="${armed?'display:none':''}">Re-arm</button>`;
  }
  return `<div class="card"><div class="row" style="margin-bottom:10px"><h3 style="margin:0">${esc(r.name)} — Rapid Fire</h3><div class="spacer"></div>${armBadge}${c.testMode?`<button class="btn ghost sm" onclick="resetRound(${r.id})">Reset Round</button>`:""}<button class="btn ghost sm" onclick="endRoundNow()">End Round</button><span class="badge live">Q ${(l.qIndex||0)+1} / ${r.questions.length}</span></div></div>${body}` + scoreboardHTML(c);
}

async function rearmBuzzers(){
  const d = await api('POST','/api/contests/'+S.contestId+'/rounds/'+S.contest.currentRoundId+'/show');
  if (!d.ok){ alert(d.error); return; }
  await refreshDeviceBadge();
  await reloadContest();
}

function triggerCountdown(key, onDone){
  if (S.liveKey === key) return;
  S.liveKey = key;
  const ov = document.createElement('div');
  ov.className='countdown';
  ov.innerHTML = '<div class="n" id="cdN">3</div><div class="lbl">Get ready</div>';
  document.body.appendChild(ov);
  let n = 3;
  const tick = ()=>{
    if (n<=0){ document.body.removeChild(ov); S.liveKey=null; onDone(); return; }
    const el = document.getElementById('cdN');
    el.textContent = n;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = 'cd 1s ease forwards';
    n--;
    setTimeout(tick, 1000);
  };
  tick();
}

function queueItemsHTML(l){
  const q = l.buzzerQueue || [];
  if (!q.length) return '<div class="queue-hint mut small">Waiting for a team to buzz…</div>';
  return q.map((b,i)=>`<div class="buzz ${i===0?'first':''}" data-id="${b.teamId}" style="order:${i}"><div class="pos">${i+1}</div><div class="nm">${esc(b.teamName)}</div><div class="tm">${(b.timeMs||0).toFixed(1)} ms</div></div>`).join('');
}

function rapidQueueHTML(c, r, l){
  return `<div class="card"><h3>Buzzer Queue</h3><div id="buzzQueueList">${queueItemsHTML(l)}</div></div>`;
}

// Update only the queue, in place (no full re-render => no flicker).
function applyAdminQueue(r){
  const list = document.getElementById('buzzQueueList');
  if (!list) return;
  const q = (r.live && r.live.buzzerQueue) || [];
  [...list.querySelectorAll('.buzz')].forEach(n=>{ if(!q.some(b=>String(b.teamId)===n.dataset.id)) n.remove(); });
  if (q.length){ const h = list.querySelector('.queue-hint'); if (h) h.remove(); }
  else if (!list.querySelector('.queue-hint')) list.innerHTML = '<div class="queue-hint mut small">Waiting for a team to buzz…</div>';
  q.forEach((b,i)=>{
    let node = list.querySelector('[data-id="'+b.teamId+'"]');
    if (!node){ node = document.createElement('div'); node.dataset.id = b.teamId; list.appendChild(node); node.classList.add('enter'); setTimeout(()=>node.classList.remove('enter'), 350); }
    node.style.order = i;
    node.className = 'buzz' + (i===0?' first':'') + (node.classList.contains('enter')?' enter':'');
    node.innerHTML = `<div class="pos">${i+1}</div><div class="nm">${esc(b.teamName)}</div><div class="tm">${(b.timeMs||0).toFixed(1)} ms</div>`;
  });
}

function updateArmBadge(){
  const el = document.getElementById('armBadge');
  if (!el) return;
  const armed = S.device && S.device.mode === 'scan';
  el.className = 'badge ' + (armed?'live':'bad');
  el.textContent = armed ? 'Buzzers armed' : 'Buzzers NOT armed';
  const rb = document.getElementById('rearmBtn');
  if (rb) rb.style.display = armed ? 'none' : 'inline-flex';
}

function rapidAnswerHTML(c, r, l, q){
  const top = (l.buzzerQueue||[])[0];
  if (!top) return '<div class="card"><div class="mut">First buzz to unlock answering.</div></div>';
  S.selOption = S.selOption==null ? null : S.selOption;
  let inner;
  if (r.isMcq){
    inner = `<div class="mut small" style="margin-bottom:10px">Top team: <b>${esc(top.teamName)}</b> — select the option they gave:</div>` +
      q.options.map((o,i)=>`<div class="opt ${S.selOption===i?'sel':''}" onclick="S.selOption=${i};renderContest()"><span class="k">${String.fromCharCode(65+i)}</span><span>${esc(o.text)}</span></div>`).join('') +
      `<button class="btn" style="margin-top:10px" onclick="rapidAnswer(${top.teamId})">${icon('check',16)}<span>Submit Answer</span></button>`;
  } else {
    inner = `<div class="mut small" style="margin-bottom:10px">Top team: <b>${esc(top.teamName)}</b></div>
      <div class="row"><button class="btn ok" onclick="rapidAnswerCorrect(${top.teamId},true)">${icon('check',16)}<span>Correct</span></button><button class="btn danger" onclick="rapidAnswerCorrect(${top.teamId},false)">${icon('x',16)}<span>Wrong</span></button></div>`;
  }
  return `<div class="card"><h3>Answer</h3>${inner}</div>`;
}

async function rapidAnswer(teamId){
  await api('POST','/api/contests/'+S.contestId+'/rounds/'+S.contest.currentRoundId+'/answer',{teamId, optionId:S.selOption});
  S.selOption = null;
  await reloadContest();
}
async function rapidAnswerCorrect(teamId, correct){
  await api('POST','/api/contests/'+S.contestId+'/rounds/'+S.contest.currentRoundId+'/answer',{teamId, correct});
  await reloadContest();
}
async function rapidNext(){
  await api('POST','/api/contests/'+S.contestId+'/rounds/'+S.contest.currentRoundId+'/next');
  S.liveKey = null;
  await reloadContest();
}

/* ---- normal / activity ---- */
function normalLiveHTML(c, r, l){
  const it = l.schedule && l.schedule[l.cursor];
  if (!it) return resultsHTML(c, r);
  const isActivity = r.type==='activity';
  const isMcq = r.isMcq;
  const judge = (!isMcq && !isActivity && r.evalBy==='judge');
  const q = it.question;
  const progress = `<div class="mut small" style="margin-bottom:10px">Item ${l.cursor+1} of ${l.schedule.length}</div>`;

  if (it.status === 'scored'){
    const award = it.awarded||0;
    const correct = it.correct;
    const verdict = correct===null ? 'Scored' : (correct?'Correct':'Wrong');
    const detail = correct===null ? ('+'+award+' marks') : ('('+(award>=0?'+':'')+award+')');
    return `<div class="card"><div class="row"><h3 style="margin:0">${esc(r.name)}</h3><div class="spacer"></div>${c.testMode?`<button class="btn ghost sm" onclick="resetRound(${r.id})">Reset Round</button>`:""}<button class="btn ghost sm" onclick="endRoundNow()">End Round</button><span class="badge live">live</span></div>${progress}</div>
      <div class="card" style="border-color:${correct===false?'var(--bad)':'var(--ok)'}">
        <h3>${isActivity?'Marks':'Result'}</h3>
        <div style="font-size:22px;font-weight:700;margin:8px 0">${esc(it.teamName)} — ${verdict} ${detail}</div>
        <button class="btn" onclick="normalNext()">Next</button>
      </div>` + scoreboardHTML(c);
  }

  let card = '';
  if (isActivity){
    card = `<div class="card">
      <span class="team-tag">${esc(it.teamName)}</span>
      <h3 style="margin-top:12px">Activity ${it.activityIndex} of ${r.activityCount}</h3>
      <div class="field" style="margin-top:10px"><label>Marks (max ${r.maxMarksPerTeam})</label>
      <input id="actMarks" class="input" type="number" min="0" max="${r.maxMarksPerTeam}" value="${S.marksValue}" oninput="S.marksValue=this.value"></div>
      <button class="btn" onclick="submitMarks()">${icon('check',16)}<span>Submit Marks</span></button>
    </div>`;
  } else {
    card = questionBox(c, r, q, it.teamName);
    if (isMcq){
      card += `<div class="card"><h3>Answer for ${esc(it.teamName)}</h3>
        ${q.options.map((o,i)=>`<div class="opt ${S.selOption===i?'sel':''}" onclick="S.selOption=${i};renderContest()"><span class="k">${String.fromCharCode(65+i)}</span><span>${esc(o.text)}</span></div>`).join('')}
        <button class="btn" style="margin-top:10px" onclick="submitMcq()">${icon('check',16)}<span>Submit Answer</span></button></div>`;
    } else if (judge){
      card += `<div class="card"><div class="mut" style="margin-bottom:8px">Waiting for the judge to enter marks for <b>${esc(it.teamName)}</b>…</div></div>`;
    } else {
      card += `<div class="card"><h3>Evaluate ${esc(it.teamName)}</h3>
        <div class="row"><button class="btn ok" onclick="submitCorrect(true)">${icon('check',16)}<span>Correct</span></button><button class="btn danger" onclick="submitCorrect(false)">${icon('x',16)}<span>Wrong</span></button></div></div>`;
    }
  }

  return `<div class="card"><div class="row"><h3 style="margin:0">${esc(r.name)}</h3><div class="spacer"></div>${c.testMode?`<button class="btn ghost sm" onclick="resetRound(${r.id})">Reset Round</button>`:""}<button class="btn ghost sm" onclick="endRoundNow()">End Round</button><span class="badge live">live</span></div>${progress}</div>${card}` + scoreboardHTML(c);
}

function questionBox(c, r, q, teamName){
  const media = (q.image?`<div class="media"><img src="${esc(q.image)}"></div>`:'') + (q.video?`<div class="media"><video src="${esc(q.video)}" controls></video></div>`:'');
  return `<div class="qbox">
    ${teamName?'<span class="team-tag">'+esc(teamName)+'</span>':''}
    <div class="qtext">${esc(q.text)}</div>${media}</div>`;
}

async function submitMcq(){
  const c = S.contest;
  await api('POST','/api/contests/'+S.contestId+'/rounds/'+c.currentRoundId+'/answer',{optionId:S.selOption});
  S.selOption=null; await reloadContest();
}
async function submitCorrect(correct){
  const c = S.contest;
  await api('POST','/api/contests/'+S.contestId+'/rounds/'+c.currentRoundId+'/evaluate',{correct});
  await reloadContest();
}
async function submitMarks(){
  const c = S.contest;
  const m = document.getElementById('actMarks').value;
  S.marksValue = '';
  await api('POST','/api/contests/'+S.contestId+'/rounds/'+c.currentRoundId+'/evaluate',{marks:Number(m)});
  await reloadContest();
}
async function normalNext(){
  const c = S.contest;
  await api('POST','/api/contests/'+S.contestId+'/rounds/'+c.currentRoundId+'/next');
  S.selOption=null; await reloadContest();
}

/* ---- results ---- */
function resultsHTML(c, r){
  const teams = c.teams.slice().sort((a,b)=>((c.scores[b.id]||0)-(c.scores[a.id]||0)));
  const top = teams.length ? (c.scores[teams[0].id]||0) : 0;
  const second = teams.length > 1 ? (c.scores[teams[1].id]||0) : -1;
  const hasLeader = teams.length > 0 && top > second;
  const rows = teams.map((t,i)=>`
    <div class="score-row ${(i===0&&hasLeader)?'top':''}">
      <span style="width:26px;height:26px;border-radius:50%;background:var(--line);display:flex;align-items:center;justify-content:center;font-weight:700">${i+1}</span>
      <span class="nm">${esc(t.name)}</span>
      <span class="mut small">${roundStats(r, t.id)}</span>
      <span class="sc">${c.scores[t.id]||0}</span>
    </div>`).join('');

  const nextRound = c.rounds.find(x=>x.status==='setup');
  return `<div class="card"><h3>${esc(r.name)} — Results</h3>${rows||'<div class="mut">No teams</div>'}
    <div class="row" style="margin-top:14px">
      ${nextRound?`<button class="btn" onclick="startRound(${nextRound.id})">Start ${esc(nextRound.name)}</button>`:''}
      ${c.testMode?`<button class="btn ghost" onclick="replayRound(${r.id})">${icon('play',16)}<span>Replay Round</span></button><button class="btn ghost" onclick="resetRound(${r.id})">${icon('trash',15)}<span>Reset Round</span></button>`:''}
      <button class="btn ghost" onclick="finishContest()">End Contest</button>
    </div></div>`;
}

function roundStats(r, teamId){
  const res = (r.results||{})[teamId];
  return res ? (res.score+' pts') : '';
}

async function finishContest(){
  if (!confirm('End the contest?')) return;
  await api('POST','/api/contests/'+S.contestId+'/finish');
  await reloadContest();
}

async function resetContest(){
  if (!confirm('Return this contest to setup? Round progress and scores will be cleared.')) return;
  const d = await api('POST','/api/contests/'+S.contestId+'/reset');
  if (!d.ok){ alert(d.error); return; }
  S.roundId = null;
  await reloadContest();
}

async function endRoundNow(){
  if (!confirm('End this round now? Remaining items will be skipped.')) return;
  await api('POST','/api/contests/'+S.contestId+'/rounds/'+S.contest.currentRoundId+'/end');
  S.liveKey = null;
  await reloadContest();
}

async function toggleTestMode(){
  const d = await api('POST','/api/contests/'+S.contestId+'/testmode', {enabled: !S.contest.testMode});
  if (!d.ok){ alert(d.error); return; }
  await reloadContest();
}

async function resetRound(rid){
  if (!confirm('Reset this round? Its responses and score will be cleared so you can test again.')) return;
  const d = await api('POST','/api/contests/'+S.contestId+'/rounds/'+rid+'/reset');
  if (!d.ok){ alert(d.error); return; }
  S.liveKey = null;
  await reloadContest();
}

async function replayRound(rid){
  const d = await api('POST','/api/contests/'+S.contestId+'/rounds/'+rid+'/reset');
  if (!d.ok){ alert(d.error); return; }
  S.liveKey = null;
  await startRound(rid);
}

function scoreboardHTML(c){
  const teams = c.teams.slice().sort((a,b)=>((c.scores[b.id]||0)-(c.scores[a.id]||0)));
  const top = teams.length ? (c.scores[teams[0].id]||0) : 0;
  const second = teams.length > 1 ? (c.scores[teams[1].id]||0) : -1;
  const hasLeader = teams.length > 0 && top > second;
  const rows = teams.map((t,i)=>`
    <div class="score-row ${(i===0&&hasLeader)?'top':''}"><span class="mut small" style="width:20px">${i+1}</span><span class="nm">${esc(t.name)}</span><span class="sc">${c.scores[t.id]||0}</span></div>`).join('');
  return `<div class="card"><h3>Scoreboard</h3>${rows||'<div class="mut">No teams</div>'}</div>`;
}

/* ================= users ================= */
async function renderUsers(){
  const d = await api('GET','/api/users');
  const users = d.users || [];
  const rows = users.map(u=>`
    <tr><td><b>${esc(u.name)}</b></td><td class="mono">${esc(u.username)}</td><td>${u.role}</td>
    <td style="text-align:right">${u.role!=='admin'?`<button class="btn danger sm" onclick="delUser(${u.id})">${icon('trash',14)}<span>Remove</span></button>`:'—'}</td></tr>`).join('');
  document.getElementById('content').innerHTML = `
    <div class="grid c2">
      <div class="card"><h3>Add User</h3>
        <div class="field"><label>Name</label><input id="uName" class="input"></div>
        <div class="field"><label>Username</label><input id="uUser" class="input"></div>
        <div class="field"><label>Password</label><input id="uPass" class="input" type="password"></div>
        <button class="btn" onclick="addUser()">${icon('plus',16)}<span>Create Judge</span></button><div id="uMsg"></div>
      </div>
      <div class="card"><h3>Users</h3><table class="t"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}
async function addUser(){
  const d = await api('POST','/api/users',{name:document.getElementById('uName').value,username:document.getElementById('uUser').value,password:document.getElementById('uPass').value,role:'judge'});
  if (!d.ok){ flash(document.getElementById('uMsg'),d.error,'err'); return; }
  renderUsers();
}
async function delUser(id){ await api('DELETE','/api/users/'+id); renderUsers(); }

/* ================= judge ================= */
function renderJudge(){
  const c = document.getElementById('content');
  if (!c) return;
  const j = S.judge;
  if (!j.active){
    c.innerHTML = `<div class="card"><div class="empty" style="font-size:18px;padding:50px">
      ${j.reason||'No round is currently being evaluated.'}<br><br><span class="mut small">Waiting for the admin to start a manual round…</span></div></div>`;
    return;
  }
  const q = j.item.question;
  const media = (q.image?`<div class="media"><img src="${esc(q.image)}"></div>`:'') + (q.video?`<div class="media"><video src="${esc(q.video)}" controls></video></div>`:'');
  const scored = j.item.status==='scored';
  c.innerHTML = `<div class="card">
    <div class="row"><h3>${esc(j.contestName)} — ${esc(j.round.name)}</h3><div class="spacer"></div><span class="badge">${j.index}/${j.total}</span></div>
    <div class="qbox" style="margin-top:14px">
      <span class="team-tag" style="font-size:16px;padding:6px 16px">${esc(j.item.teamName)}</span>
      <div class="qtext" style="font-size:22px">${esc(q.text)}</div>${media}
    </div>
    <div class="card" style="background:var(--card2)">
      <div class="row"><label style="font-size:15px;font-weight:700">Marks</label><span class="mut">out of <b>${j.round.marksPerQuestion}</b></span></div>
      <div class="row" style="margin-top:10px">
        <input id="jmarks" class="input grow" type="number" inputmode="decimal" min="0" max="${j.round.marksPerQuestion}" style="font-size:24px;padding:14px" ${scored?'disabled':''} value="${S.judgeMarks||''}" oninput="S.judgeMarks=this.value">
        <button class="btn" style="font-size:18px;padding:14px 22px" ${scored?'disabled':''} onclick="submitJudgeMarks()">${icon('check',16)}<span>Save</span></button>
      </div>
      ${scored?'<div class="msg ok">Submitted — awaiting next team.</div>':''}
    </div>
  </div>`;
}

async function tickJudge(){
  if (isEditing()) return; // don't re-render while the judge is entering marks
  const d = await api('GET','/api/judge/current');
  if (!d.ok) return;
  if (isEditing()) return;
  const changed = JSON.stringify(S.judge) !== JSON.stringify(d);
  S.judge = d;
  if (changed) renderJudge();
}

async function submitJudgeMarks(){
  const m = Number(document.getElementById('jmarks').value);
  if (isNaN(m)){ return; }
  const d = await api('POST','/api/judge/evaluate',{marks:m});
  if (d.ok){ S.judgeMarks = ''; }
  tickJudge();
}

/* ================= modal / msg ================= */
function openModal(inner, wide){
  let m = document.getElementById('modal');
  if (!m){ m = document.createElement('div'); m.id='modal'; m.className='modal'; document.body.appendChild(m); }
  m.innerHTML = '<div class="box '+(wide?'wide':'')+'">'+inner+'</div>';
  m.classList.add('open');
}
function closeModal(){ const m=document.getElementById('modal'); if(m) m.classList.remove('open'); }

function flash(el, text, type){
  el.innerHTML = text ? '<div class="msg '+(type||'ok')+'">'+esc(text)+'</div>' : '';
}

/* ================= theme ================= */
function applyTheme(){
  const t = localStorage.getItem('theme') || 'dark';
  document.body.classList.toggle('light', t === 'light');
  document.querySelectorAll('[data-theme-toggle]').forEach(b=>{
    b.innerHTML = (t === 'light' ? icon('moon',16)+'<span>Dark</span>' : icon('sun',16)+'<span>Light</span>');
  });
}
function toggleTheme(){
  const t = document.body.classList.contains('light') ? 'dark' : 'light';
  localStorage.setItem('theme', t);
  applyTheme();
}

/* ================= boot ================= */
window.addEventListener('popstate', handleRoute);

let badgeTimer = null;

(async function boot(){
  applyTheme();
  if (S.token){
    const d = await api('GET','/api/auth/me').catch(()=>null);
    if (d && d.ok){ S.user = d.user; }
    else { S.token = null; localStorage.removeItem('token'); }
  }
  if (S.user && S.user.role === 'judge') history.replaceState(null,'','/judge');
  else if (S.user && S.user.role === 'admin' && (location.pathname==='/' || location.pathname==='/login')) history.replaceState(null,'','/teams');
  handleRoute();
  if (S.token){ badgeTimer = setInterval(refreshDeviceBadge, 4000); }
})();
