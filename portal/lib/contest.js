const { get, save, next } = require('./store');

// ---------------------------- helpers ----------------------------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function findContest(id) {
  return get().contests.find((c) => c.id === Number(id));
}

function findRound(contest, rid) {
  return contest.rounds.find((r) => r.id === Number(rid));
}

function teamsInOrder(contest) {
  const st = get();
  return (contest.teamIds || [])
    .map((id) => st.teams.find((t) => t.id === Number(id)))
    .filter(Boolean)
    .sort((a, b) => a.id - b.id);
}

function currentQuestion(round, qid) {
  return round.questions.find((q) => q.id === Number(qid));
}

// ---------------------------- CRUD ----------------------------
function createContest(name) {
  const st = get();
  const teams = st.teams.slice().sort((a, b) => a.id - b.id);
  const c = {
    id: next('contest'),
    name,
    status: 'setup', // setup | rules | running | finished
    testMode: false,
    teamIds: teams.map((t) => t.id),
    scores: {},
    currentRoundId: null,
    createdAt: Date.now(),
    rounds: [],
  };
  st.contests.push(c);
  save();
  return c;
}

function addRound(contest, fields) {
  const r = {
    id: next('round'),
    name: String(fields.name || 'Round ' + (contest.rounds.length + 1)),
    order: contest.rounds.length + 1,
    type: fields.type || 'normal', // rapid | normal | activity
    isMcq: fields.type === 'activity' ? false : !!fields.isMcq,
    marksPerQuestion: Number(fields.marksPerQuestion) || 0,
    negativeMarks: Number(fields.negativeMarks) || 0,
    evalBy: fields.evalBy || 'admin',
    activityCount: Number(fields.activityCount) || 0,
    maxMarksPerTeam: Number(fields.maxMarksPerTeam) || 0,
    questions: [],
    status: 'setup',
    live: null,
    results: {},
  };
  contest.rounds.push(r);
  save();
  return r;
}

function updateRound(round, fields) {
  if (fields.type !== undefined && fields.type !== round.type) {
    if (round.questions.length > 0) return { ok: false, error: 'Remove the questions before changing the round type' };
    round.type = fields.type;
    if (round.type === 'activity') round.isMcq = false;
  }
  if (fields.isMcq !== undefined && round.type !== 'activity' && !!fields.isMcq !== round.isMcq) {
    if (round.questions.length > 0) return { ok: false, error: 'Remove the questions before changing MCQ / non-MCQ' };
    round.isMcq = !!fields.isMcq;
  }
  if (fields.name !== undefined) round.name = String(fields.name).trim() || round.name;
  if (fields.marksPerQuestion !== undefined) round.marksPerQuestion = Number(fields.marksPerQuestion) || 0;
  if (fields.negativeMarks !== undefined) round.negativeMarks = Number(fields.negativeMarks) || 0;
  if (fields.evalBy !== undefined) round.evalBy = fields.evalBy;
  if (fields.activityCount !== undefined) round.activityCount = Number(fields.activityCount) || 0;
  if (fields.maxMarksPerTeam !== undefined) round.maxMarksPerTeam = Number(fields.maxMarksPerTeam) || 0;
  save();
  return { ok: true, round };
}

function updateQuestion(round, q, fields) {
  if (fields.text !== undefined) q.text = String(fields.text);
  if (fields.image !== undefined) q.image = fields.image || null;
  if (fields.video !== undefined) q.video = fields.video || null;
  if (round.isMcq && Array.isArray(fields.options)) {
    q.options = fields.options.map((o) => ({ text: String(o.text || ''), correct: !!o.correct }));
  }
  save();
  return q;
}

function addQuestion(round, fields) {
  const q = {
    id: next('question'),
    text: String(fields.text || ''),
    image: fields.image || null,
    video: fields.video || null,
    options: round.isMcq ? (fields.options || []).map((o) => ({ text: String(o.text || ''), correct: !!o.correct })) : [],
  };
  round.questions.push(q);
  save();
  return q;
}

// ---------------------------- rules ----------------------------
function typeLabel(round) {
  if (round.type === 'rapid') return 'Rapid Fire';
  if (round.type === 'activity') return 'Activity Based';
  return 'Normal';
}

function evalLabel(round) {
  if (round.type === 'activity') return 'Manual (marks entered by admin)';
  if (round.type === 'rapid') return round.isMcq ? 'Automatic (MCQ)' : 'Manual (correct/wrong)';
  if (round.isMcq) return 'Automatic (MCQ)';
  return round.evalBy === 'judge' ? 'Manual (evaluated by Judge)' : 'Manual (correct/wrong by admin)';
}

function generateRules(contest) {
  const teams = teamsInOrder(contest);
  const lines = [];
  lines.push(`Contest: ${contest.name}`);
  lines.push(`Teams (${teams.length}): ${teams.map((t) => t.name).join(', ')}`);

  contest.rounds
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((r, i) => {
      lines.push('');
      lines.push(`Round ${i + 1}: ${r.name} — ${typeLabel(r)}`);
      lines.push(`  Evaluation: ${evalLabel(r)}`);
      if (r.type === 'rapid') {
        lines.push(`  Marks per question: +${r.marksPerQuestion}`);
        if (r.negativeMarks) lines.push(`  Negative marking (wrong answer): ${r.negativeMarks}`);
        lines.push(`  Questions: ${r.questions.length}`);
        lines.push(`  Rule: the fastest team to press the buzzer answers. Wrong answers are not passed on.`);
      } else if (r.type === 'activity') {
        lines.push(`  Activities per team: ${r.activityCount}`);
        lines.push(`  Max marks per activity: ${r.maxMarksPerTeam}`);
      } else {
        lines.push(`  Marks per question: ${r.marksPerQuestion}`);
        lines.push(`  Questions: ${r.questions.length} (${teams.length ? Math.floor(r.questions.length / teams.length) : 0} per team)`);
        lines.push(`  Rule: questions are randomly allocated; each team answers in turn, in team order.`);
      }
    });

  lines.push('');
  lines.push('The team with the highest total score at the end wins.');
  return lines.join('\n');
}

// ---------------------------- schedule ----------------------------
function generateSchedule(contest, round) {
  const teams = teamsInOrder(contest);
  if (round.type === 'activity') {
    const s = [];
    for (let a = 1; a <= round.activityCount; a++) {
      for (const t of teams) s.push({ teamId: t.id, activityIndex: a, status: 'pending', awarded: 0 });
    }
    return s;
  }
  const qs = shuffle(round.questions);
  const s = [];
  let i = 0;
  const passes = Math.floor(qs.length / teams.length);
  for (let p = 0; p < passes; p++) {
    for (const t of teams) s.push({ teamId: t.id, questionId: qs[i++].id, status: 'pending', awarded: 0, correct: null });
  }
  return s;
}

// ---------------------------- start / end ----------------------------
function startRound(contest, round) {
  const teams = teamsInOrder(contest);
  if (teams.length === 0) return { ok: false, error: 'No teams in this contest' };
  if (round.type !== 'activity') {
    if (round.questions.length === 0) return { ok: false, error: 'Add questions first' };
    if (round.type === 'normal' && round.questions.length % teams.length !== 0) {
      return { ok: false, error: `Questions (${round.questions.length}) must be a multiple of the number of teams (${teams.length})` };
    }
  } else if (!round.activityCount) {
    return { ok: false, error: 'Set the number of activities per team' };
  }

  round.status = 'running';
  round.results = {};
  teams.forEach((t) => { round.results[t.id] = { score: 0, correct: 0, wrong: 0 }; });

  if (round.type === 'rapid') {
    round.live = {
      phase: 'countdown', // countdown | question | scored | done
      qIndex: 0,
      questionOrder: shuffle(round.questions.map((q) => q.id)),
      buzzerQueue: [],
      countdownEndsAt: Date.now() + 3000,
      lastScored: null,
    };
  } else {
    round.live = { phase: 'question', schedule: generateSchedule(contest, round), cursor: 0, lastScored: null };
  }
  contest.currentRoundId = round.id;
  save();
  return { ok: true };
}

function endRound(contest, round) {
  round.status = 'finished';
  const schedule = round.live && round.live.schedule ? round.live.schedule : [];
  round.live = { phase: 'done', schedule, buzzerQueue: [] };
  save();
}

// Testing helper: wipe a round's progress/results and remove its contribution
// from the cumulative scores, so the round can be run again.
function resetRound(contest, round) {
  Object.keys(round.results || {}).forEach((tid) => {
    const contribution = (round.results[tid] && round.results[tid].score) || 0;
    if (contest.scores[tid] !== undefined) {
      contest.scores[tid] -= contribution;
      if (contest.scores[tid] === 0) contest.scores[tid] = 0;
    }
  });
  round.status = 'setup';
  round.live = null;
  round.results = {};
  if (contest.currentRoundId === round.id) contest.currentRoundId = null;
  save();
  return { ok: true };
}

// ---------------------------- scoring ----------------------------
function addToScore(contest, teamId, delta) {
  if (contest.scores[teamId] === undefined) contest.scores[teamId] = 0;
  contest.scores[teamId] += delta;
}

function rapidShow(contest, round) {
  const l = round.live;
  if (l.phase === 'question') return { ok: true, already: true }; // idempotent
  l.phase = 'question';
  l.buzzerQueue = [];
  save();
  return { ok: true, questionId: l.questionOrder[l.qIndex] };
}

function rapidBuzz(contest, round, teamId, timeMs) {
  const l = round.live;
  if (!l || l.phase !== 'question') return;
  const t = Number(timeMs);
  if (!isFinite(t) || t < 0) return;              // pressed before the question was shown
  const teams = teamsInOrder(contest);
  if (!teams.some((x) => x.id === Number(teamId))) return;
  if (l.buzzerQueue.some((b) => b.teamId === Number(teamId))) return;
  l.buzzerQueue.push({ teamId: Number(teamId), timeMs: t });
  l.buzzerQueue.sort((a, b) => a.timeMs - b.timeMs);
  save();
}

function rapidAnswer(contest, round, { teamId, optionId, correct }) {
  const l = round.live;
  if (l.phase === 'countdown' || l.phase === 'done') return { ok: false, error: 'No question open' };
  const q = currentQuestion(round, l.questionOrder[l.qIndex]);
  const team = teamsInOrder(contest).find((t) => t.id === Number(teamId));
  if (!team) return { ok: false, error: 'Invalid team' };

  let isCorrect = false;
  if (round.isMcq) {
    const idx = Number(optionId);
    isCorrect = q.options[idx] ? !!q.options[idx].correct : false;
  } else {
    isCorrect = !!correct;
  }

  const awarded = isCorrect ? round.marksPerQuestion : -round.negativeMarks;
  round.results[team.id].score += awarded;
  if (isCorrect) round.results[team.id].correct++; else round.results[team.id].wrong++;
  addToScore(contest, team.id, awarded);

  l.lastScored = { teamId: team.id, teamName: team.name, correct: isCorrect, awarded, questionId: q.id };
  l.phase = 'scored';
  save();
  return { ok: true, lastScored: l.lastScored };
}

function rapidNext(contest, round) {
  const l = round.live;
  if (l.qIndex + 1 < l.questionOrder.length) {
    l.qIndex++;
    l.buzzerQueue = [];
    l.phase = 'countdown';
    l.countdownEndsAt = Date.now() + 3000;
    save();
    return { ok: true, finished: false };
  }
  endRound(contest, round);
  return { ok: true, finished: true };
}

function normalScore(contest, round, { optionId, correct, marks }) {
  const l = round.live;
  const item = l.schedule[l.cursor];
  if (!item) return { ok: false, error: 'No current item' };
  const teamId = item.teamId;
  let isCorrect = null;
  let awarded = 0;

  if (round.type === 'activity') {
    const m = Number(marks);
    if (isNaN(m)) return { ok: false, error: 'Marks required' };
    awarded = Math.max(0, Math.min(round.maxMarksPerTeam, m));
    item.awarded = awarded;
    item.marks = awarded;
  } else if (round.isMcq) {
    const q = currentQuestion(round, item.questionId);
    const idx = Number(optionId);
    isCorrect = q.options[idx] ? !!q.options[idx].correct : false;
    awarded = isCorrect ? round.marksPerQuestion : 0;
    item.awarded = awarded;
    item.correct = isCorrect;
    item.optionId = idx;
  } else {
    // non-MCQ manual
    if (marks !== undefined && marks !== null && marks !== '') {
      const m = Number(marks);
      awarded = Math.max(0, Math.min(round.marksPerQuestion, m));
      item.marks = awarded;
    } else {
      isCorrect = !!correct;
      awarded = isCorrect ? round.marksPerQuestion : 0;
      item.correct = isCorrect;
    }
    item.awarded = awarded;
  }

  item.status = 'scored';
  round.results[teamId].score += awarded;
  if (isCorrect === true) round.results[teamId].correct++;
  else if (isCorrect === false) round.results[teamId].wrong++;
  addToScore(contest, teamId, awarded);

  const team = teamsInOrder(contest).find((t) => t.id === teamId);
  l.lastScored = { teamId, teamName: team ? team.name : '', correct: isCorrect, awarded, marks: awarded };
  save();
  return { ok: true, lastScored: l.lastScored };
}

function normalNext(contest, round) {
  const l = round.live;
  if (l.cursor + 1 < l.schedule.length) {
    l.cursor++;
    save();
    return { ok: true, finished: false };
  }
  endRound(contest, round);
  return { ok: true, finished: true };
}

// ---------------------------- export ----------------------------
module.exports = {
  shuffle, findContest, findRound, teamsInOrder, currentQuestion,
  createContest, addRound, updateRound, addQuestion, updateQuestion,
  generateRules, typeLabel, evalLabel,
  startRound, endRound, resetRound,
  rapidShow, rapidBuzz, rapidAnswer, rapidNext,
  normalScore, normalNext,
};
