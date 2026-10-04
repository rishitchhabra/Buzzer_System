const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const store = require('./lib/store');
const auth = require('./lib/auth');
const contest = require('./lib/contest');
const device = require('./lib/device');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filepath) => {
    // Always revalidate app code so UI updates are picked up immediately.
    if (/\.(js|css|html)$/.test(filepath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use('/uploads', express.static(store.UPLOAD_DIR));

fs.mkdirSync(store.UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, store.UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '';
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  },
});
const upload = multer({ storage });

// ------------------------- serialization helpers -------------------------
function questionPublic(q, reveal) {
  return {
    id: q.id, text: q.text, image: q.image, video: q.video,
    options: q.options.map((o, i) => (reveal ? { i, text: o.text, correct: o.correct } : { i, text: o.text })),
  };
}

function livePublic(c, round, reveal) {
  if (!round.live) return null;
  const teams = contest.teamsInOrder(c);
  const teamName = (id) => { const t = teams.find((x) => x.id === Number(id)); return t ? t.name : '?'; };
  const l = { ...round.live };

  if (l.schedule) {
    l.schedule = l.schedule.map((it) => ({
      ...it,
      teamName: teamName(it.teamId),
      question: it.questionId ? questionPublic(contest.currentQuestion(round, it.questionId), reveal) : null,
    }));
  }
  if (l.questionOrder) {
    const qid = l.questionOrder[l.qIndex];
    l.currentQuestion = qid ? questionPublic(contest.currentQuestion(round, qid), reveal) : null;
  }
  l.buzzerQueue = (l.buzzerQueue || []).map((b) => ({ ...b, teamName: teamName(b.teamId) }));
  if (l.lastScored) l.lastScored = { ...l.lastScored, teamName: teamName(l.lastScored.teamId) };
  return l;
}

function roundPublic(c, round, reveal) {
  const questions = round.questions.map((q) => questionPublic(q, reveal));
  return {
    id: round.id, name: round.name, order: round.order, type: round.type, isMcq: round.isMcq,
    marksPerQuestion: round.marksPerQuestion, negativeMarks: round.negativeMarks, evalBy: round.evalBy,
    activityCount: round.activityCount, maxMarksPerTeam: round.maxMarksPerTeam,
    status: round.status, results: round.results, live: livePublic(c, round, reveal), questions,
  };
}

function contestPublic(c, reveal) {
  return {
    id: c.id, name: c.name, status: c.status, testMode: !!c.testMode, teamIds: c.teamIds, scores: c.scores,
    currentRoundId: c.currentRoundId, createdAt: c.createdAt,
    rounds: c.rounds.map((r) => roundPublic(c, r, reveal)),
    teams: contest.teamsInOrder(c),
  };
}

function runningContext() {
  const st = store.get();
  for (const c of st.contests) {
    if (c.status === 'running' && c.currentRoundId) {
      const r = c.rounds.find((x) => x.id === c.currentRoundId);
      if (r && r.status === 'running') return { contest: c, round: r };
    }
  }
  return null;
}

// Auto-advance a rapid-fire countdown once its timer elapses (device heartbeat / any poll drives this).
let lastArmMs = 0;
function advanceRapidCountdown() {
  const ctx = runningContext();
  if (!ctx) return;
  const { contest: c, round: r } = ctx;
  if (r.type !== 'rapid') return;
  const l = r.live;

  if (l && l.phase === 'countdown' && l.countdownEndsAt && Date.now() >= l.countdownEndsAt) {
    contest.rapidShow(c, r);
    device.enqueue('rapid_start');
  }

  // Safety net: while a rapid question is open, make sure the device is actually armed
  // (unless every team has already buzzed).
  if (l && l.phase === 'question' && store.get().device.mode !== 'scan') {
    const teams = contest.teamsInOrder(c);
    const allBuzzed = (l.buzzerQueue || []).length >= teams.length;
    if (!allBuzzed && Date.now() - lastArmMs > 2000) {
      lastArmMs = Date.now();
      device.enqueue('rapid_start');
    }
  }
}

// ============================== AUTH ==============================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const result = auth.login(username, password);
  if (!result) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  res.json({ ok: true, token: result.token, user: result.user });
});

app.post('/api/auth/logout', auth.requireAuth, (req, res) => {
  auth.logout(req.token);
  res.json({ ok: true });
});

app.get('/api/auth/me', auth.requireAuth, (req, res) => {
  res.json({ ok: true, user: auth.publicUser(req.user) });
});

// ============================== USERS ==============================
app.get('/api/users', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.json({ ok: true, users: store.get().users.map(auth.publicUser) });
});

app.post('/api/users', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Username and password required' });
  if (store.get().users.some((u) => u.username === String(username).trim())) {
    return res.status(400).json({ ok: false, error: 'Username already taken' });
  }
  const st = store.get();
  const u = { id: store.next('user'), username: String(username).trim(), name: String(name || username), role: role === 'judge' ? 'judge' : 'admin', passwordHash: auth.hashPassword(password) };
  st.users.push(u);
  store.save();
  res.json({ ok: true, user: auth.publicUser(u) });
});

app.delete('/api/users/:id', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const st = store.get();
  const id = Number(req.params.id);
  if (req.user.id === id) return res.status(400).json({ ok: false, error: 'Cannot delete yourself' });
  st.users = st.users.filter((u) => u.id !== id);
  store.save();
  res.json({ ok: true });
});

// ============================== TEAMS ==============================
app.get('/api/teams', auth.requireAuth, (req, res) => {
  res.json({ ok: true, teams: store.get().teams, deviceOnline: device.deviceOnline(), device: store.get().device, test: store.get().test });
});

app.post('/api/teams', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.json(device.addTeam(req.body && req.body.name));
});

app.delete('/api/teams/:id', auth.requireAuth, auth.requireAdmin, (req, res) => {
  res.json(device.deleteTeam(req.params.id));
});

// ============================== DEVICE API ==============================
app.get('/api/esp/sync', (req, res) => {
  if (req.query.mode) store.get().device.mode = req.query.mode; // freshest reported mode
  advanceRapidCountdown();
  res.json(device.handleSync(req.query));
});

app.post('/api/esp/ack', (req, res) => {
  device.ackCommand((req.body || {}).commandId);
  res.json({ ok: true });
});

app.post('/api/esp/event', (req, res) => {
  const body = req.body || {};
  device.handleEvent(body);
  const ctx = runningContext();
  if (body.type === 'live_press') {
    const p = body.payload || {};
    if (ctx && ctx.round.type === 'rapid') {
      contest.rapidBuzz(ctx.contest, ctx.round, p.id, p.timeMs);
      const teams = contest.teamsInOrder(ctx.contest);
      const q = ctx.round.live.buzzerQueue || [];
      if (q.length >= teams.length) {
        device.enqueue('rapid_reset'); // every team has buzzed -> stop scanning
        console.log(`[buzz] team=${p.id} time=${p.timeMs}ms -> queued (all ${teams.length} teams buzzed, disarmed)`);
      } else {
        console.log(`[buzz] team=${p.id} time=${p.timeMs}ms -> queued (${q.length}/${teams.length})`);
      }
    } else {
      console.log(`[buzz] live_press team=${p.id} IGNORED (context=${ctx ? ctx.round.type + '/' + ctx.round.live.phase : 'none'})`);
    }
  }
  res.json({ ok: true });
});

app.post('/api/check', auth.requireAuth, auth.requireAdmin, (req, res) => {
  device.enqueue('ping');
  res.json({ ok: true, deviceOnline: device.deviceOnline() });
});

app.post('/api/test/start', auth.requireAuth, auth.requireAdmin, (req, res) => {
  store.get().test = { active: true, results: {} };
  device.enqueue('test_start');
  res.json({ ok: true });
});

app.post('/api/test/stop', auth.requireAuth, auth.requireAdmin, (req, res) => {
  store.get().test.active = false;
  device.enqueue('test_stop');
  store.save();
  res.json({ ok: true });
});

// ============================== UPLOAD ==============================
app.post('/api/upload', auth.requireAuth, auth.requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
  res.json({ ok: true, url: '/uploads/' + req.file.filename, name: req.file.originalname });
});

// ============================== CONTESTS ==============================
app.get('/api/contests', auth.requireAuth, (req, res) => {
  res.json({ ok: true, contests: store.get().contests.map((c) => ({ id: c.id, name: c.name, status: c.status, rounds: c.rounds.length, teams: c.teamIds.length, createdAt: c.createdAt })) });
});

app.post('/api/contests', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'Contest name required' });
  const c = contest.createContest(name);
  res.json({ ok: true, contest: contestPublic(c, true) });
});

app.get('/api/contests/:id', auth.requireAuth, (req, res) => {
  const c = contest.findContest(req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Not found' });
  advanceRapidCountdown();
  res.json({ ok: true, contest: contestPublic(c, true), rules: contest.generateRules(c) });
});

app.patch('/api/contests/:id', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Not found' });
  if (c.status === 'running' || c.status === 'finished') {
    return res.status(400).json({ ok: false, error: 'The contest can no longer be edited' });
  }
  const { name, teamIds } = req.body || {};
  if (name !== undefined) {
    const n = String(name).trim();
    if (!n) return res.status(400).json({ ok: false, error: 'Name required' });
    c.name = n;
  }
  if (Array.isArray(teamIds)) {
    const valid = teamIds
      .map(Number)
      .filter((id) => store.get().teams.some((t) => t.id === id))
      .sort((a, b) => a - b);
    if (valid.length === 0) return res.status(400).json({ ok: false, error: 'Select at least one team' });
    c.teamIds = valid;
  }
  store.save();
  res.json({ ok: true, contest: contestPublic(c, true) });
});

app.delete('/api/contests/:id', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const st = store.get();
  st.contests = st.contests.filter((c) => c.id !== Number(req.params.id));
  store.save();
  res.json({ ok: true });
});

app.post('/api/contests/:id/start', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Not found' });
  if (c.rounds.length === 0) return res.status(400).json({ ok: false, error: 'Add at least one round' });
  // include all current teams (in case teams were added after the contest was created)
  c.teamIds = store.get().teams.slice().sort((a, b) => a.id - b.id).map((t) => t.id);
  if (contest.teamsInOrder(c).length === 0) return res.status(400).json({ ok: false, error: 'No teams in contest' });
  c.status = 'rules';
  store.save();
  res.json({ ok: true, rules: contest.generateRules(c) });
});

app.post('/api/contests/:id/finish', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Not found' });
  c.status = 'finished';
  store.save();
  res.json({ ok: true });
});

// Return a contest to setup (clears round progress and scores).
app.post('/api/contests/:id/reset', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Not found' });
  if (c.status === 'running') return res.status(400).json({ ok: false, error: 'A round is running' });
  c.status = 'setup';
  c.scores = {};
  c.currentRoundId = null;
  c.rounds.forEach((r) => { r.status = 'setup'; r.live = null; r.results = {}; });
  store.save();
  res.json({ ok: true });
});

// Enable/disable testing mode for a contest.
app.post('/api/contests/:id/testmode', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Not found' });
  c.testMode = !!(req.body || {}).enabled;
  store.save();
  res.json({ ok: true, testMode: c.testMode });
});

// Testing mode only: reset a single round so it can be run again.
app.post('/api/contests/:id/rounds/:rid/reset', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  const r = c && contest.findRound(c, req.params.rid);
  if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
  if (!c.testMode) return res.status(400).json({ ok: false, error: 'Enable testing mode first' });
  contest.resetRound(c, r);
  res.json({ ok: true });
});

// ============================== ROUNDS ==============================
app.post('/api/contests/:id/rounds', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Not found' });
  const r = contest.addRound(c, req.body || {});
  res.json({ ok: true, round: roundPublic(c, r, true) });
});

app.patch('/api/contests/:id/rounds/:rid', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  const r = c && contest.findRound(c, req.params.rid);
  if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
  const out = contest.updateRound(r, req.body || {});
  if (out && out.ok === false) return res.status(400).json(out);
  res.json({ ok: true, round: roundPublic(c, r, true) });
});

app.delete('/api/contests/:id/rounds/:rid', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'Not found' });
  c.rounds = c.rounds.filter((r) => r.id !== Number(req.params.rid));
  c.rounds.forEach((r, i) => { r.order = i + 1; });
  store.save();
  res.json({ ok: true });
});

// ============================== QUESTIONS ==============================
app.post('/api/contests/:id/rounds/:rid/questions', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  const r = c && contest.findRound(c, req.params.rid);
  if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
  const q = contest.addQuestion(r, req.body || {});
  res.json({ ok: true, question: questionPublic(q, true) });
});

app.patch('/api/contests/:id/rounds/:rid/questions/:qid', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  const r = c && contest.findRound(c, req.params.rid);
  if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
  const q = r.questions.find((x) => x.id === Number(req.params.qid));
  if (!q) return res.status(404).json({ ok: false, error: 'Question not found' });
  contest.updateQuestion(r, q, req.body || {});
  res.json({ ok: true, question: questionPublic(q, true) });
});

app.delete('/api/contests/:id/rounds/:rid/questions/:qid', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  const r = c && contest.findRound(c, req.params.rid);
  if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
  r.questions = r.questions.filter((q) => q.id !== Number(req.params.qid));
  store.save();
  res.json({ ok: true });
});

// ============================== LIVE ==============================
app.post('/api/contests/:id/rounds/:rid/start', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  const r = c && contest.findRound(c, req.params.rid);
  if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
  const out = contest.startRound(c, r);
  if (!out.ok) return res.status(400).json(out);
  c.status = 'running';
  store.save();
  res.json({ ok: true });
});

app.post('/api/contests/:id/rounds/:rid/show', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  const r = c && contest.findRound(c, req.params.rid);
  if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
  if (r.type === 'rapid') {
    contest.rapidShow(c, r);
    device.enqueue('rapid_start');
    res.json({ ok: true });
  } else {
    res.json({ ok: true });
  }
});

app.post('/api/contests/:id/rounds/:rid/next', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  const r = c && contest.findRound(c, req.params.rid);
  if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
  let out;
  if (r.type === 'rapid') {
    out = contest.rapidNext(c, r);
    if (out.finished) device.enqueue('rapid_reset');
  } else {
    out = contest.normalNext(c, r);
  }
  res.json(out);
});

app.post('/api/contests/:id/rounds/:rid/answer', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  const r = c && contest.findRound(c, req.params.rid);
  if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
  const body = req.body || {};
  let out;
  if (r.type === 'rapid') {
    out = contest.rapidAnswer(c, r, body);
    if (out.ok) device.enqueue('rapid_reset');
  } else if (r.isMcq) {
    out = contest.normalScore(c, r, { optionId: body.optionId });
  } else {
    return res.status(400).json({ ok: false, error: 'Use /evaluate for manual rounds' });
  }
  if (!out.ok) return res.status(400).json(out);
  res.json(out);
});

app.post('/api/contests/:id/rounds/:rid/evaluate', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  const r = c && contest.findRound(c, req.params.rid);
  if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
  const body = req.body || {};
  if (r.type === 'rapid' || r.isMcq) {
    return res.status(400).json({ ok: false, error: 'Use /answer for MCQ rounds' });
  }
  if (r.evalBy === 'judge') {
    return res.status(400).json({ ok: false, error: 'This round is evaluated by a judge' });
  }
  // non-MCQ admin (correct/wrong) or activity (marks)
  const out = contest.normalScore(c, r, r.type === 'activity' ? { marks: body.marks } : { correct: body.correct });
  if (!out.ok) return res.status(400).json(out);
  res.json(out);
});

app.post('/api/contests/:id/rounds/:rid/end', auth.requireAuth, auth.requireAdmin, (req, res) => {
  const c = contest.findContest(req.params.id);
  const r = c && contest.findRound(c, req.params.rid);
  if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
  if (r.type === 'rapid') device.enqueue('rapid_reset');
  contest.endRound(c, r);
  res.json({ ok: true });
});

// ============================== JUDGE ==============================
app.get('/api/judge/current', auth.requireAuth, (req, res) => {
  advanceRapidCountdown();
  const ctx = runningContext();
  if (!ctx) return res.json({ ok: true, active: false });
  const { contest: c, round: r } = ctx;
  if (r.type === 'rapid') return res.json({ ok: true, active: false, reason: 'Rapid fire round in progress' });
  if (r.type === 'normal' && !r.isMcq && r.evalBy === 'judge' && r.live && r.live.phase === 'question') {
    const it = r.live.schedule[r.live.cursor];
    const q = it && it.questionId ? contest.currentQuestion(r, it.questionId) : null;
    const team = contest.teamsInOrder(c).find((t) => t.id === it.teamId);
    return res.json({
      ok: true, active: true,
      round: { id: r.id, name: r.name, marksPerQuestion: r.marksPerQuestion },
      contestName: c.name,
      item: {
        teamId: it.teamId, teamName: team ? team.name : '?',
        status: it.status,
        question: q ? questionPublic(q, false) : null,
      },
      index: r.live.cursor + 1,
      total: r.live.schedule.length,
    });
  }
  return res.json({ ok: true, active: false, reason: 'Nothing for the judge right now' });
});

app.post('/api/judge/evaluate', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'judge' && req.user.role !== 'admin') return res.status(403).json({ ok: false, error: 'Not allowed' });
  const ctx = runningContext();
  if (!ctx) return res.status(400).json({ ok: false, error: 'No round running' });
  const { contest: c, round: r } = ctx;
  if (r.type === 'rapid') return res.status(400).json({ ok: false, error: 'Not a manual round' });
  if (!(r.type === 'normal' && !r.isMcq && r.evalBy === 'judge')) {
    return res.status(400).json({ ok: false, error: 'Judge not assigned to this round' });
  }
  const marks = (req.body || {}).marks;
  const out = contest.normalScore(c, r, { marks });
  if (!out.ok) return res.status(400).json(out);
  res.json(out);
});

// ============================== DISPLAY (projector) ==============================
app.get('/api/display', (req, res) => {
  advanceRapidCountdown();
  const ctx = runningContext();
  if (!ctx) {
    const st = store.get();
    const running = st.contests.find((c) => c.status === 'running');
    return res.json({ active: false, scores: running ? running.scores : {}, teams: running ? contest.teamsInOrder(running) : [] });
  }
  const { contest: c, round: r } = ctx;
  const teams = contest.teamsInOrder(c).map((t) => ({ id: t.id, name: t.name }));
  const live = r.live || {};
  const curQ = r.type === 'rapid' && live.questionOrder ? contest.currentQuestion(r, live.questionOrder[live.qIndex]) : null;
  const scheduleItem = live.schedule ? live.schedule[live.cursor] : null;
  const normalQ = scheduleItem && scheduleItem.questionId ? contest.currentQuestion(r, scheduleItem.questionId) : null;
  const teamName = (id) => { const t = teams.find((x) => x.id === Number(id)); return t ? t.name : '?'; };

  res.json({
    active: true,
    contestName: c.name,
    round: { id: r.id, name: r.name, type: r.type, isMcq: r.isMcq, marksPerQuestion: r.marksPerQuestion },
    phase: live.phase || 'idle',
    countdownEndsAt: live.countdownEndsAt || null,
    question: r.type === 'rapid' ? (curQ ? questionPublic(curQ, false) : null)
              : (normalQ ? questionPublic(normalQ, false) : null),
    currentTeam: scheduleItem ? teamName(scheduleItem.teamId) : null,
    activityIndex: scheduleItem ? scheduleItem.activityIndex : null,
    buzzerQueue: (live.buzzerQueue || []).map((b) => ({ teamId: b.teamId, teamName: teamName(b.teamId), timeMs: b.timeMs })),
    lastScored: live.lastScored ? { ...live.lastScored, teamName: teamName(live.lastScored.teamId) } : null,
    scores: c.scores,
    teams,
  });
});

// ============================== SPA fallback ==============================
// Serve the front-end app for any non-API, non-asset route (client-side routing).
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================== START ==============================
store.load();
auth.createDefaultAdmin();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nBuzzer portal running on http://localhost:${PORT}`);
  console.log(`Devices point to:  http://<your-LAN-IP>:${PORT}`);
  console.log(`Data store:        ${store.usingSQLite() ? store.DB_FILE : store.JSON_FILE}`);
});
