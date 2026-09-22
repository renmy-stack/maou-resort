/* 魔王城リゾート ゲーム本体
   構成: 状態(state) / マップと経路 / 客のAI / 時間と月末処理 / 描画 / UI(パネル) / セーブ */
'use strict';

const VERSION = '0.1.0';
const TILE = 32, COLS = 12, ROWS = 16;
const KEEP_ROWS = 2;                       // 上2段は城本体（建てられない）
const GATE_TILES = [{ x: 5, y: ROWS - 1 }, { x: 6, y: ROWS - 1 }];
const SAVE_KEY = 'maou-resort-save';
const DEBUG = location.search.includes('debug'); // ?debug で裏タブでも進める（自動テスト用）

const $ = (s) => document.querySelector(s);
const rnd = (a, b) => a + Math.random() * (b - a);
const irnd = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtG = (n) => Math.round(n).toLocaleString('ja-JP') + 'G';
const uidGen = () => Math.random().toString(36).slice(2, 9);

/* ============ 状態 ============ */
let state = null;
let guests = [];          // 客（セーブしない）
let particles = [];       // 「+120G」などの浮き文字
let spawnTimer = 0, spawnInterval = 0, spawnLeft = 0;
let gameTime = 0;         // ゲーム内経過秒（等速換算）
let dayClock = 0;         // 今日の経過秒
let occ = [];             // タイル → 施設uid（なければ null）
let mode = 'normal';      // normal | build
let ghost = null;         // 建設中のゴースト { id, x, y, ok }
let selectedFac = null;   // 選択中の施設 uid
let lastTs = 0;
let toastTimer = null;

function newState() {
  return {
    version: VERSION,
    money: START_MONEY, day: 1, month: 1, year: 1,
    rep: 50, rp: 0, speed: 1, sound: true,
    facilities: [],            // { uid, id, x, y, price, staff, visits, income }
    staff: [],                 // { uid, id, facility }
    unlocked: FACILITIES.filter(f => f.rp === 0).map(f => f.id),
    candidates: rollCandidates([]),
    monthly: freshMonthly(),
    history: [],
    event: { id: 'none', daysLeft: 0, heroes: [] },
    log: [],
    totalVisitors: 0, bestRep: 50,
    intro: true,
  };
}
function freshMonthly() { return { income: 0, expense: 0, visitors: 0, satSum: 0, satN: 0, fines: 0 }; }
function rollCandidates(hired) {
  const pool = STAFF_POOL.filter(s => !hired.includes(s.id));
  const out = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
  return out;
}

/* ============ マップ・経路 ============ */
function rebuildOcc() {
  occ = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (const f of state.facilities) {
    const d = FAC[f.id];
    for (let dy = 0; dy < d.h; dy++) for (let dx = 0; dx < d.w; dx++) occ[f.y + dy][f.x + dx] = f.uid;
  }
}
function isGate(x, y) { return GATE_TILES.some(g => g.x === x && g.y === y); }
function inBounds(x, y) { return x >= 0 && y >= 0 && x < COLS && y < ROWS; }
function walkable(x, y, occMap = occ) {
  if (!inBounds(x, y)) return false;
  if (y < KEEP_ROWS) return false;
  if (y === ROWS - 1) return isGate(x, y);
  return occMap[y][x] === null;
}
function buildable(x, y) { return inBounds(x, y) && y >= KEEP_ROWS && y < ROWS - 1; }
function entranceOf(f) { const d = FAC[f.id]; return { x: f.x + Math.floor(d.w / 2), y: f.y + d.h }; }
function facAt(x, y) { const uid = inBounds(x, y) ? occ[y][x] : null; return uid ? state.facilities.find(f => f.uid === uid) : null; }

// 幅優先探索。到達できなければ null
function findPath(from, to, occMap = occ) {
  if (from.x === to.x && from.y === to.y) return [];
  const key = (x, y) => y * COLS + x;
  const prev = new Map(); prev.set(key(from.x, from.y), -1);
  const q = [from];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (q.length) {
    const c = q.shift();
    for (const [dx, dy] of dirs) {
      const nx = c.x + dx, ny = c.y + dy, k = key(nx, ny);
      if (prev.has(k)) continue;
      if (!(nx === to.x && ny === to.y) && !walkable(nx, ny, occMap)) continue;
      if (nx === to.x && ny === to.y && !walkable(nx, ny, occMap)) continue;
      prev.set(k, key(c.x, c.y));
      if (nx === to.x && ny === to.y) {
        const path = []; let cur = k;
        while (cur !== key(from.x, from.y)) { path.push({ x: cur % COLS, y: Math.floor(cur / COLS) }); cur = prev.get(cur); }
        return path.reverse();
      }
      q.push({ x: nx, y: ny });
    }
  }
  return null;
}
function reachableSet(occMap = occ) {
  const seen = new Set(); const q = [];
  for (const g of GATE_TILES) { seen.add(g.y * COLS + g.x); q.push(g); }
  while (q.length) {
    const c = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, ny = c.y + dy, k = ny * COLS + nx;
      if (seen.has(k) || !walkable(nx, ny, occMap)) continue;
      seen.add(k); q.push({ x: nx, y: ny });
    }
  }
  return seen;
}
// 建てられるか（範囲・重なり・入口・既存施設の入口がふさがらないか）
function canPlace(id, x, y) {
  const d = FAC[id];
  for (let dy = 0; dy < d.h; dy++) for (let dx = 0; dx < d.w; dx++) {
    if (!buildable(x + dx, y + dy) || occ[y + dy][x + dx] !== null) return { ok: false, why: 'そこには建てられない' };
  }
  const test = occ.map(r => r.slice());
  for (let dy = 0; dy < d.h; dy++) for (let dx = 0; dx < d.w; dx++) test[y + dy][x + dx] = 'ghost';
  const reach = reachableSet(test);
  if (d.cap > 0 || d.tags.includes('need')) {
    const e = { x: x + Math.floor(d.w / 2), y: y + d.h };
    if (!walkable(e.x, e.y, test) || !reach.has(e.y * COLS + e.x)) return { ok: false, why: '入口（下側）が城門から届かない' };
  }
  for (const f of state.facilities) {
    if (FAC[f.id].cap === 0) continue;
    const e = entranceOf(f);
    if (!reach.has(e.y * COLS + e.x)) return { ok: false, why: `${FAC[f.id].name}の入口がふさがる` };
  }
  return { ok: true };
}

/* ============ 施設・従業員の実効値 ============ */
function staffOf(f) { return f.staff ? state.staff.find(s => s.uid === f.staff) : null; }
function facEff(f) {
  const d = FAC[f.id]; const st = staffOf(f); const b = st ? STAFF[st.id].bonus : null;
  let appeal = d.appeal, sat = d.sat, dur = d.dur;
  if (b) { appeal += b.appeal || 0; sat += b.sat || 0; if (b.tag && d.tags.includes(b.tag)) { appeal += 4; sat += 5; } }
  // 料金を上げると満足度と魅力が下がる。下げると上がる
  if (d.price > 0) { const r = (f.price - d.price) / d.price; sat -= r * 15; appeal -= r * 4; }
  return { appeal: Math.max(0, appeal), sat, dur, price: f.price };
}
function facUpkeep(f) { const d = FAC[f.id]; const st = staffOf(f); return d.upkeep * (st && STAFF[st.id].bonus.upkeep ? STAFF[st.id].bonus.upkeep : 1); }
function insideCount(f) { return guests.filter(g => g.state === 'inside' && g.target === f.uid).length; }
function waitingCount(f) { return guests.filter(g => g.state === 'wait' && g.target === f.uid).length; }
function researchMul() { return 1 + state.staff.reduce((a, s) => a + (STAFF[s.id].bonus.research || 0), 0); }

/* ============ 客 ============ */
function visitorsPerDay() {
  const appealSum = state.facilities.reduce((a, f) => a + facEff(f).appeal, 0);
  let n = 1.2 + state.rep / 40 + appealSum / 40;
  const ev = state.event;
  if (ev.id === 'storm' && ev.daysLeft > 0) n = 0;
  if (ev.id === 'tv') n *= 1.5;
  if (ev.id === 'festival') n *= 1.3;
  return Math.min(20, Math.round(n * rnd(0.8, 1.2)));
}
function pickGuestType() {
  const list = GUEST_TYPES.filter(g => g.rate > 0 && state.rep >= g.minRep)
    .map(g => ({ g, w: g.rate * (state.event.id === 'festival' && g.id === 'monster_family' ? 4 : 1) }));
  let r = Math.random() * list.reduce((a, x) => a + x.w, 0);
  for (const x of list) { r -= x.w; if (r <= 0) return x.g; }
  return list[0].g;
}
const MAX_GUESTS = 18;
function spawnGuest(typeId, special = false) {
  if (guests.length >= MAX_GUESTS && !special) return null;   // 混みすぎ → 入場制限
  const t = GUEST[typeId] || pickGuestType();
  const gate = pick(GATE_TILES);
  const g = {
    uid: uidGen(), type: t.id, x: gate.x, y: gate.y, path: [], target: null, state: 'idle',
    money: t.money * rnd(0.8, 1.2), sat: 50, needs: { toilet: rnd(0, 30), hunger: rnd(0, 30), tired: rnd(0, 20) },
    visited: 0, visitedSet: new Set(), waitTimer: 0, insideTimer: 0, bubble: null, bob: Math.random() * 10,
    thinkTimer: 0, special, waitedTotal: 0, treeBonus: 0, leaving: false, age: 0, fails: 0,
  };
  guests.push(g);
  state.monthly.visitors++; state.totalVisitors++;
  return g;
}
function prefMatch(t, d) {
  const tags = d.tags.filter(x => x !== 'need' && x !== 'deco');
  if (!tags.length) return 0.6;
  return tags.reduce((a, x) => a + (t.pref[x] || 0.5), 0) / tags.length;
}
function chooseTarget(g) {
  const t = GUEST[g.type];
  const reach = reachableSet();
  const cands = state.facilities.filter(f => FAC[f.id].cap > 0).filter(f => { const e = entranceOf(f); return reach.has(e.y * COLS + e.x); });
  const byTag = (tag) => cands.filter(f => FAC[f.id].tags.includes(tag));
  // 生理的欲求が高いときは最優先
  if (g.needs.toilet > 70) { const c = cands.filter(f => f.id === 'toilet'); if (c.length) return { f: pick(c), why: 'toilet' }; }
  if (g.needs.hunger > 75) { const c = byTag('food').filter(f => g.money >= f.price); if (c.length) return { f: pick(c), why: 'hungry' }; }
  if (g.needs.tired > 75) { const c = cands.filter(f => f.id === 'bench' || FAC[f.id].tags.includes('heal')).filter(f => g.money >= f.price); if (c.length) return { f: pick(c), why: 'tired' }; }
  if (g.visited >= t.visits) return null;
  let best = null, bestScore = 0;
  for (const f of cands) {
    const d = FAC[f.id];
    if (d.tags.includes('need') && !d.tags.includes('heal')) continue;
    if (g.money < f.price) continue;
    const e = facEff(f);
    let s = (e.appeal + 2) * prefMatch(t, d) * (g.visitedSet.has(f.uid) ? 0.3 : 1) * rnd(0.6, 1.4);
    if (waitingCount(f) >= d.cap) s *= 0.5;
    if (s > bestScore) { bestScore = s; best = f; }
  }
  return best ? { f: best, why: 'fun' } : null;
}
function setPath(g, to) {
  const p = findPath({ x: Math.round(g.x), y: Math.round(g.y) }, to);
  if (!p) return false;
  g.path = p; return true;
}
function say(g, text, kind = 'ok') { g.bubble = { text, t: 2.2, kind }; }
function moodText(g) {
  if (g.needs.toilet > 70) return pick(MOODS.need_toilet);
  if (g.needs.hunger > 75) return pick(MOODS.hungry);
  if (g.needs.tired > 75) return pick(MOODS.tired);
  if (g.sat >= 70) return pick(MOODS.happy);
  if (g.sat <= 35) return pick(MOODS.angry);
  return pick(MOODS.ok);
}
function guestTick(g, dt) {
  // 欲求はじわじわ上がる
  g.needs.toilet += dt * 2.2; g.needs.hunger += dt * 1.6; g.needs.tired += dt * 1.3;
  g.age += dt;
  if (g.needs.toilet > 90 || g.needs.hunger > 95) g.sat -= dt * 2;   // 我慢させると不満がたまる
  if (g.age > 30 && !g.leaving && g.state !== 'inside') { g.leaving = true; if (g.state !== 'leave') { g.state = 'idle'; g.target = null; g.thinkTimer = 0; } }
  if (g.bubble) { g.bubble.t -= dt; if (g.bubble.t <= 0) g.bubble = null; }
  if (g.needs.toilet > 110 && !g.leaving) {
    g.sat -= 25; say(g, 'もう帰る！', 'angry'); startLeave(g); return;
  }
  switch (g.state) {
    case 'idle': {
      g.thinkTimer -= dt;
      if (g.thinkTimer > 0) return;
      g.thinkTimer = rnd(0.3, 0.8);
      if (g.leaving) { startLeave(g); return; }
      const c = chooseTarget(g);
      if (!c) { startLeave(g); return; }
      g.target = c.f.uid;
      if (!setPath(g, entranceOf(c.f))) { g.target = null; startLeave(g); return; }
      g.state = 'walk';
      break;
    }
    case 'walk': case 'leave': {
      if (!moveAlong(g, dt)) return;
      if (g.state === 'leave') { g.state = 'gone'; onGuestGone(g); return; }
      const f = state.facilities.find(x => x.uid === g.target);
      if (!f) { g.state = 'idle'; return; }
      tryEnter(g, f, true);
      break;
    }
    case 'wait': {
      const f = state.facilities.find(x => x.uid === g.target);
      if (!f) { g.state = 'idle'; return; }
      g.waitTimer += dt; g.waitedTotal += dt;
      if (tryEnter(g, f, false)) return;
      const patience = GUEST[g.type].id === 'noble' ? 4 : 7;
      if (g.waitTimer > patience) { g.sat -= 8; g.fails++; say(g, pick(['待ちすぎ', 'もういい']), 'angry'); g.state = 'idle'; g.target = null; if (g.fails >= 2) g.leaving = true; }
      break;
    }
    case 'inside': {
      g.insideTimer -= dt;
      if (g.insideTimer <= 0) finishVisit(g);
      break;
    }
  }
}
function moveAlong(g, dt) {
  if (!g.path.length) return true;
  const speed = 2.6 * dt;
  const n = g.path[0];
  const dx = n.x - g.x, dy = n.y - g.y, dist = Math.hypot(dx, dy);
  if (dist <= speed) {
    g.x = n.x; g.y = n.y; g.path.shift();
    // 木のそばを通ると気分がよくなる（1人あたり上限あり）
    if (g.treeBonus < 6) for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const f = facAt(n.x + ax, n.y + ay); if (f && f.id === 'tree') { g.sat += 1; g.treeBonus += 1; break; } }
    return g.path.length === 0;
  }
  g.x += dx / dist * speed; g.y += dy / dist * speed;
  return false;
}
function tryEnter(g, f, first) {
  const d = FAC[f.id];
  if (insideCount(f) < d.cap) {
    g.state = 'inside'; g.insideTimer = facEff(f).dur; g.waitTimer = 0;
    return true;
  }
  if (first) { g.state = 'wait'; g.waitTimer = 0; }
  return false;
}
function finishVisit(g) {
  const f = state.facilities.find(x => x.uid === g.target);
  if (f) {
    const d = FAC[f.id], e = facEff(f), t = GUEST[g.type];
    const price = Math.min(f.price, g.money);
    g.money -= price; state.money += price; f.income += price; f.visits++; state.monthly.income += price;
    if (price > 0) { const p = worldPos(entranceOf(f)); particles.push({ x: p.x, y: p.y - 10, text: `+${Math.round(price)}G`, t: 1.2, color: '#ffe066' }); sound('coin'); }
    let gain = e.sat * 0.55 + (prefMatch(t, d) - 1.0) * 12 - Math.min(10, g.waitTimer * 1.5);
    g.sat = clamp(g.sat + gain, 0, 100);
    if (f.id === 'toilet') g.needs.toilet = 0;
    if (d.tags.includes('food')) g.needs.hunger = 0;
    if (f.id === 'bench' || d.tags.includes('heal')) g.needs.tired = Math.max(0, g.needs.tired - 60);
    if (!d.tags.includes('need')) { g.visited++; g.visitedSet.add(f.uid); }
    if (Math.random() < 0.5) say(g, moodText(g), g.sat >= 70 ? 'happy' : g.sat <= 35 ? 'angry' : 'ok');
    const ent = entranceOf(f); g.x = ent.x; g.y = ent.y;
  }
  g.target = null; g.state = 'idle'; g.thinkTimer = 0.4;
}
function startLeave(g) {
  g.leaving = true;
  const gate = GATE_TILES.slice().sort((a, b) => Math.hypot(a.x - g.x, a.y - g.y) - Math.hypot(b.x - g.x, b.y - g.y))[0];
  if (!setPath(g, gate)) { g.state = 'gone'; onGuestGone(g); return; }
  g.state = 'leave'; g.target = null;
}
function onGuestGone(g) {
  const delta = clamp((g.sat - 65) / 20, -3, 3);   // 満足度65が損益分岐。並の施設だけでは人気300前後で頭打ち
  state.rep = clamp(state.rep + delta, 0, 1000);
  state.bestRep = Math.max(state.bestRep, state.rep);
  state.rp += 1 * researchMul();
  state.monthly.satSum += g.sat; state.monthly.satN++;
  if (g.special) { state.event.heroes.push(g.sat); }
  guests = guests.filter(x => x !== g);
}

/* ============ 時間・月末 ============ */
function startDay() {
  dayClock = 0;
  spawnLeft = visitorsPerDay();
  spawnInterval = spawnLeft > 0 ? DAY_SEC / spawnLeft : 999;
  spawnTimer = 0.2;
  if (state.event.id === 'storm' && state.event.daysLeft > 0) state.event.daysLeft--;
  if (state.event.id === 'hero_party' && state.day === 5) { for (let i = 0; i < 3; i++) setTimeout(() => spawnGuest('hero', true), i * 400); toast('🦸 勇者パーティが来た！'); }
}
function tick(dt) {
  gameTime += dt; dayClock += dt;
  spawnTimer -= dt;
  if (spawnLeft > 0 && spawnTimer <= 0) { spawnGuest(); spawnLeft--; spawnTimer = spawnInterval; }
  for (const g of guests.slice()) guestTick(g, dt);
  for (const p of particles) { p.t -= dt; p.y -= dt * 18; }
  particles = particles.filter(p => p.t > 0);
  if (dayClock >= DAY_SEC) {
    state.day++;
    if (state.day > DAYS_PER_MONTH) endMonth(); else startDay();
    updateHud();
  }
}
function endMonth() {
  const m = state.monthly;
  let upkeep = state.facilities.reduce((a, f) => a + facUpkeep(f), 0);
  let salary = state.staff.reduce((a, s) => a + STAFF[s.id].salary, 0);
  const lines = [];
  // 立入検査
  if (state.event.id === 'inspection') {
    const need = Math.max(1, Math.ceil(state.facilities.filter(f => FAC[f.id].cap > 0).length / 5));
    const toilets = state.facilities.filter(f => f.id === 'toilet').length, benches = state.facilities.filter(f => f.id === 'bench').length;
    if (toilets < need || benches < 1) { m.fines += 1000; lines.push(`📋 閻魔庁の検査で罰金 1,000G（トイレ${need}個・ベンチ1個が必要）`); }
    else lines.push('📋 閻魔庁の検査は合格！人気 +10'), state.rep += 10;
  }
  if (state.event.id === 'hero_party') {
    const h = state.event.heroes;
    if (h.length >= 3 && h.every(s => s >= 60)) { state.rep += 30; state.money += 3000; lines.push('🦸 勇者パーティ全員が満足！推薦状をもらった（人気 +30、報奨金 3,000G）'); }
    else if (h.length) { state.rep -= 10; lines.push('🦸 勇者パーティは不満そうに帰った……（人気 -10）'); }
    else lines.push('🦸 勇者パーティは来なかった');
  }
  const expense = upkeep + salary + m.fines;
  state.money -= expense; m.expense = expense;
  const avgSat = m.satN ? m.satSum / m.satN : 0;
  state.rep = clamp(state.rep * 0.95, 0, 1000);
  const rec = { year: state.year, month: state.month, visitors: m.visitors, income: Math.round(m.income), expense: Math.round(expense), avgSat: Math.round(avgSat), rep: Math.round(state.rep) };
  state.history.push(rec); if (state.history.length > 24) state.history.shift();
  const profit = rec.income - rec.expense;
  const maou = pick(profit >= 0 && avgSat >= 55 ? MAOU_LINES.good : MAOU_LINES.bad);
  // 次の月へ
  state.month++; if (state.month > 12) { state.month = 1; state.year++; }
  state.day = 1; state.monthly = freshMonthly();
  state.candidates = rollCandidates(state.staff.map(s => s.id));
  const ev = rollEvent();
  state.event = { id: ev.id, daysLeft: ev.id === 'storm' ? 3 : 0, heroes: [] };
  startDay();
  save();
  showModal(`${rec.year}年目 ${rec.month}月の決算`, `
    <table class="rep">
      <tr><th>来場者</th><td>${rec.visitors}人</td></tr>
      <tr><th>収入</th><td>${fmtG(rec.income)}</td></tr>
      <tr><th>支出</th><td>${fmtG(rec.expense)} <small>(維持費 ${fmtG(upkeep)} / 給料 ${fmtG(salary)}${m.fines ? ' / 罰金 ' + fmtG(m.fines) : ''})</small></td></tr>
      <tr><th>収支</th><td class="${profit >= 0 ? 'plus' : 'minus'}">${profit >= 0 ? '+' : ''}${fmtG(profit)}</td></tr>
      <tr><th>平均満足度</th><td>${rec.avgSat}</td></tr>
      <tr><th>人気</th><td>${rec.rep} <small>${rankOf(rec.rep).name}</small></td></tr>
    </table>
    ${lines.map(l => `<p class="evline">${l}</p>`).join('')}
    <div class="maou-say">😈「${maou}」</div>
    ${ev.effect !== 'none' ? `<div class="event-card"><b>${ev.icon} 今月のできごと: ${ev.name}</b><br>${ev.text}</div>` : ''}
    ${state.money < 0 ? '<p class="warn">⚠ 所持金がマイナス！魔界銀行の取り立てが来る前に黒字にしよう（3か月連続で赤字残高だと……）</p>' : ''}
  `);
  checkBankrupt();
}
function rollEvent() {
  const list = EVENTS.filter(e => state.rep >= e.minRep);
  let r = Math.random() * list.reduce((a, e) => a + e.weight, 0);
  for (const e of list) { r -= e.weight; if (r <= 0) return e; }
  return EVENTS[EVENTS.length - 1];
}
let negMonths = 0;
function checkBankrupt() {
  if (state.money < 0) negMonths++; else negMonths = 0;
  if (negMonths >= 3) {
    const bail = 3000;
    state.money = bail; negMonths = 0;
    const victim = state.facilities.filter(f => FAC[f.id].cost >= 1500).sort((a, b) => FAC[b.id].cost - FAC[a.id].cost)[0];
    if (victim) { removeFacility(victim.uid, false); }
    showModal('魔界銀行の取り立て', `<p>3か月連続で借金のため、${victim ? FAC[victim.id].name + 'が差し押さえられた。' : '魔王の私物が売られた。'}</p><p>手元に ${fmtG(bail)} だけ残った。ここから立て直そう。</p><div class="maou-say">😈「……勇者に負けた日より辛い。」</div>`);
  }
}
function rankOf(rep) { let r = RANKS[0]; for (const x of RANKS) if (rep >= x.min) r = x; return r; }

/* ============ 操作: 建てる・撤去・雇う ============ */
function placeFacility(id, x, y) {
  const d = FAC[id]; const chk = canPlace(id, x, y);
  if (!chk.ok) { toast('✖ ' + chk.why); sound('error'); return false; }
  if (state.money < d.cost) { toast('✖ お金が足りない'); sound('error'); return false; }
  state.money -= d.cost;
  state.facilities.push({ uid: uidGen(), id, x, y, price: d.price, staff: null, visits: 0, income: 0 });
  rebuildOcc(); sound('build');
  const p = worldPos({ x: x + d.w / 2 - 0.5, y: y + d.h / 2 - 0.5 }); particles.push({ x: p.x, y: p.y, text: `-${d.cost}G`, t: 1.2, color: '#ff8a80' });
  // 通れなくなった客は目的地を考え直す
  for (const g of guests) if (g.state === 'walk' || g.state === 'leave') {
    const tf = g.target ? state.facilities.find(f => f.uid === g.target) : null;
    const to = g.state === 'leave' ? g.path[g.path.length - 1] : (tf ? entranceOf(tf) : null);
    if (!to || !setPath(g, to)) { g.state = 'idle'; g.target = null; g.path = []; }
  }
  updateHud(); return true;
}
function removeFacility(uid, refund = true) {
  const f = state.facilities.find(x => x.uid === uid); if (!f) return;
  const d = FAC[f.id];
  if (refund) state.money += Math.floor(d.cost / 2);
  if (f.staff) { const s = state.staff.find(x => x.uid === f.staff); if (s) s.facility = null; }
  state.facilities = state.facilities.filter(x => x.uid !== uid);
  for (const g of guests) if (g.target === uid) { if (g.state === 'inside') { const e = entranceOf(f); g.x = e.x; g.y = e.y; } g.state = 'idle'; g.target = null; g.path = []; }
  rebuildOcc(); updateHud();
}
function hireStaff(id) {
  const s = STAFF[id];
  if (state.money < s.hire) { toast('✖ 契約金が足りない'); sound('error'); return; }
  state.money -= s.hire;
  state.staff.push({ uid: uidGen(), id, facility: null });
  state.candidates = state.candidates.filter(c => c !== id);
  sound('build'); toast(`${s.icon} ${s.name}を雇った！施設に配属しよう`); updateHud();
}
function fireStaff(uid) {
  const s = state.staff.find(x => x.uid === uid); if (!s) return;
  if (s.facility) { const f = state.facilities.find(x => x.uid === s.facility); if (f) f.staff = null; }
  state.staff = state.staff.filter(x => x.uid !== uid); updateHud();
}
function assignStaff(facUid, staffUid) {
  const f = state.facilities.find(x => x.uid === facUid); if (!f) return;
  if (f.staff) { const old = state.staff.find(x => x.uid === f.staff); if (old) old.facility = null; }
  f.staff = staffUid || null;
  if (staffUid) { const s = state.staff.find(x => x.uid === staffUid); if (s) { if (s.facility) { const of = state.facilities.find(x => x.uid === s.facility); if (of) of.staff = null; } s.facility = facUid; } }
}
function unlockFacility(id) {
  const d = FAC[id];
  if (state.rp < d.rp) { toast('✖ 研究ポイントが足りない'); sound('error'); return; }
  state.rp -= d.rp; state.unlocked.push(id); sound('levelup');
  toast(`${d.icon} ${d.name}を研究した！建てられるようになった`); updateHud();
}

/* ============ 描画 ============ */
const canvas = $('#map'); const ctx = canvas.getContext('2d');
const SCALE = 2;   // 内部解像度を2倍にして絵文字を鮮明に
canvas.width = COLS * TILE * SCALE; canvas.height = ROWS * TILE * SCALE;
function worldPos(t) { return { x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2 }; }
function drawEmoji(ch, x, y, size) { ctx.fillStyle = '#000'; /* 半透明の fillStyle が残っていると絵文字まで薄くなる */ ctx.font = `${size}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, x, y + size * 0.06); }
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function render() {
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  const W = COLS * TILE, H = ROWS * TILE;
  // 地面
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (y < KEEP_ROWS) ctx.fillStyle = '#2a2438';
    else if (y === ROWS - 1) ctx.fillStyle = isGate(x, y) ? '#1a1524' : '#4a4460';
    else ctx.fillStyle = (x + y) % 2 ? '#3d2f52' : '#43345a';
    ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    if (y >= KEEP_ROWS && y < ROWS - 1 && (x * 7 + y * 13) % 5 === 0) { ctx.fillStyle = '#4e3f66'; ctx.fillRect(x * TILE + 8, y * TILE + 20, 4, 3); ctx.fillRect(x * TILE + 22, y * TILE + 8, 3, 4); }
  }
  // 城本体（上2段）
  ctx.fillStyle = '#4a4460'; for (let x = 0; x < COLS; x++) ctx.fillRect(x * TILE + (x % 2 ? 0 : 8), 4, 16, 10);
  ctx.fillStyle = '#5a5378'; ctx.fillRect(0, TILE * KEEP_ROWS - 6, W, 6);
  drawEmoji('🏰', TILE * 2.5, TILE * 1.1, 34); drawEmoji('🏰', W - TILE * 2.5, TILE * 1.1, 34);
  ctx.fillStyle = '#6b1e3a'; roundRect(W / 2 - 40, 14, 80, 40, 6); ctx.fill();
  drawEmoji('😈', W / 2, 34 + Math.sin(gameTime * 2) * 1.5, 26);
  ctx.fillStyle = '#e8d8ff'; ctx.font = '10px "DotGothic16", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('魔王の間', W / 2, 62);
  // 城壁と門
  ctx.fillStyle = '#5a5378'; for (let x = 0; x < COLS; x++) if (!isGate(x, ROWS - 1)) ctx.fillRect(x * TILE + (x % 2 ? 0 : 8), (ROWS - 1) * TILE + 2, 16, 8);
  ctx.fillStyle = '#7a5a30'; ctx.fillRect(GATE_TILES[0].x * TILE + 2, (ROWS - 1) * TILE + 6, TILE * 2 - 4, TILE - 6);
  ctx.fillStyle = '#e8d8ff'; ctx.font = '10px "DotGothic16", sans-serif'; ctx.fillText('城門', (GATE_TILES[0].x + 1) * TILE, (ROWS - 1) * TILE + 22);
  // 施設
  for (const f of state.facilities) drawFacility(f);
  // ゴースト
  if (mode === 'build' && ghost) {
    const d = FAC[ghost.id];
    ctx.fillStyle = ghost.ok ? 'rgba(80,255,120,0.35)' : 'rgba(255,80,80,0.4)';
    ctx.fillRect(ghost.x * TILE, ghost.y * TILE, d.w * TILE, d.h * TILE);
    ctx.strokeStyle = ghost.ok ? '#6f6' : '#f66'; ctx.lineWidth = 2; ctx.strokeRect(ghost.x * TILE + 1, ghost.y * TILE + 1, d.w * TILE - 2, d.h * TILE - 2);
    drawEmoji(d.icon, ghost.x * TILE + d.w * TILE / 2, ghost.y * TILE + d.h * TILE / 2, Math.min(d.w, d.h) * 16 + 6);
    if (d.cap > 0) { const e = { x: ghost.x + Math.floor(d.w / 2), y: ghost.y + d.h }; ctx.fillStyle = ghost.ok ? 'rgba(80,255,120,0.5)' : 'rgba(255,80,80,0.5)'; ctx.beginPath(); ctx.moveTo(e.x * TILE + 10, e.y * TILE + 4); ctx.lineTo(e.x * TILE + 22, e.y * TILE + 4); ctx.lineTo(e.x * TILE + 16, e.y * TILE + 14); ctx.fill(); }
  }
  // 客（y順で描いて手前が上に来るように）
  const vis = guests.filter(g => g.state !== 'inside' && g.state !== 'gone').sort((a, b) => a.y - b.y);
  for (const g of vis) {
    const px = g.x * TILE + TILE / 2, py = g.y * TILE + TILE / 2;
    const bob = (g.state === 'walk' || g.state === 'leave') ? Math.abs(Math.sin(gameTime * 10 + g.bob)) * 3 : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(px, py + 10, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
    drawEmoji(GUEST[g.type].icon, px, py - 2 - bob, 20);
    if (g.special) { ctx.fillStyle = '#ffd54f'; ctx.font = '9px sans-serif'; ctx.fillText('★', px + 10, py - 14); }
  }
  for (const g of vis) if (g.bubble) drawBubble(g.x * TILE + TILE / 2, g.y * TILE - 8, g.bubble.text, g.bubble.kind);
  // 浮き文字
  for (const p of particles) { ctx.globalAlpha = Math.min(1, p.t); ctx.fillStyle = p.color; ctx.font = 'bold 12px "DotGothic16", sans-serif'; ctx.textAlign = 'center'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText(p.text, p.x, p.y); ctx.fillText(p.text, p.x, p.y); ctx.globalAlpha = 1; }
  // 嵐
  if (state.event.id === 'storm' && state.event.daysLeft > 0) { ctx.fillStyle = 'rgba(20,20,60,0.45)'; ctx.fillRect(0, 0, W, H); if (Math.random() < 0.02) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(0, 0, W, H); } drawEmoji('🌩️', W - 30, TILE * 2.6, 24); }
  if (state.speed === 0) { ctx.fillStyle = 'rgba(0,0,0,0.7)'; roundRect(W / 2 - 50, TILE * KEEP_ROWS + 6, 100, 22, 6); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '13px "DotGothic16", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⏸ 一時停止', W / 2, TILE * KEEP_ROWS + 17); }
}
function drawFacility(f) {
  const d = FAC[f.id]; const x = f.x * TILE, y = f.y * TILE, w = d.w * TILE, h = d.h * TILE;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(x + 3, y + 5, w - 4, h - 4, 5); ctx.fill();
  ctx.fillStyle = d.color; roundRect(x + 2, y + 2, w - 4, h - 4, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; roundRect(x + 4, y + 4, w - 8, h * 0.4, 4); ctx.fill();
  ctx.strokeStyle = selectedFac === f.uid ? '#fff' : 'rgba(0,0,0,0.5)'; ctx.lineWidth = selectedFac === f.uid ? 3 : 2; roundRect(x + 2, y + 2, w - 4, h - 4, 5); ctx.stroke();
  const size = d.w === 1 ? 18 : d.w === 2 ? 30 : 42;
  drawEmoji(d.icon, x + w / 2, y + h / 2 - (d.h > 1 ? 6 : 2), size);
  if (d.w > 1) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x + 4, y + h - 16, w - 8, 12); ctx.fillStyle = '#fff'; ctx.font = '10px "DotGothic16", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(d.name, x + w / 2, y + h - 10); }
  const n = insideCount(f);
  if (n > 0) { ctx.fillStyle = '#222'; roundRect(x + w - 22, y + 2, 20, 12, 3); ctx.fill(); ctx.fillStyle = '#ffe066'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`👤${n}`, x + w - 12, y + 8); }
  const st = staffOf(f); if (st) drawEmoji(STAFF[st.id].icon, x + 10, y + 10, 12);
  if (d.cap > 0) { const e = entranceOf(f); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.moveTo(e.x * TILE + 11, e.y * TILE + 3); ctx.lineTo(e.x * TILE + 21, e.y * TILE + 3); ctx.lineTo(e.x * TILE + 16, e.y * TILE + 10); ctx.fill(); }
}
function drawBubble(x, y, text, kind) {
  ctx.font = '10px "DotGothic16", sans-serif'; const w = ctx.measureText(text).width + 10;
  const bx = clamp(x - w / 2, 2, COLS * TILE - w - 2), by = y - 16;
  ctx.fillStyle = kind === 'angry' ? '#ffcdd2' : kind === 'happy' ? '#fff9c4' : '#fff';
  roundRect(bx, by, w, 15, 4); ctx.fill(); ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 3, by + 15); ctx.lineTo(x + 3, by + 15); ctx.lineTo(x, by + 19); ctx.fillStyle = kind === 'angry' ? '#ffcdd2' : kind === 'happy' ? '#fff9c4' : '#fff'; ctx.fill();
  ctx.fillStyle = '#222'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + w / 2, by + 8);
}

/* ============ ループ ============ */
function loop(ts) {
  const raw = Math.min(0.1, (ts - lastTs) / 1000 || 0); lastTs = ts;
  if (!$('#modal').classList.contains('open') && (!document.hidden || DEBUG)) {
    const dt = raw * state.speed;
    if (dt > 0) tick(dt);
  }
  render();
  if (!DEBUG) requestAnimationFrame(loop);
}

/* ============ UI ============ */
function updateHud() {
  $('#money').textContent = fmtG(state.money); $('#money').classList.toggle('minus', state.money < 0);
  $('#date').textContent = `${state.year}年目 ${state.month}月 ${state.day}日`;
  const r = rankOf(state.rep);
  $('#rep').textContent = `♥${Math.round(state.rep)}`; $('#rank').textContent = r.name;
  $('#rp').textContent = `🔬${Math.floor(state.rp)}`;
  $('#visitors').textContent = `👥${state.monthly.visitors}`;
  document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('on', +b.dataset.s === state.speed));
  const ev = state.event; const evEl = $('#event');
  const e = EVENTS.find(x => x.id === ev.id);
  if (e && e.effect !== 'none') { evEl.textContent = `${e.icon} ${e.name}${ev.id === 'storm' ? `（あと${ev.daysLeft}日）` : ''}`; evEl.hidden = false; } else evEl.hidden = true;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }
function showModal(title, html, onClose) {
  $('#modal-title').textContent = title; $('#modal-body').innerHTML = html; $('#modal').classList.add('open');
  $('#modal-close').onclick = () => { $('#modal').classList.remove('open'); if (onClose) onClose(); };
}
function openPanel(title, html) { $('#panel-title').textContent = title; $('#panel-body').innerHTML = html; $('#panel').classList.add('open'); }
function closePanel() { $('#panel').classList.remove('open'); selectedFac = null; }
function setBuildMode(id) {
  mode = 'build'; ghost = null; closePanel();
  $('#buildbar').hidden = false; $('#buildbar-name').textContent = `${FAC[id].icon} ${FAC[id].name}（${fmtG(FAC[id].cost)}）— 建てる場所をタップ`;
  $('#buildbar-ok').hidden = true; $('#buildbar').dataset.id = id;
}
function exitBuildMode() { mode = 'normal'; ghost = null; $('#buildbar').hidden = true; }

function panelBuild() {
  const rows = FACILITIES.filter(f => state.unlocked.includes(f.id)).map(f => `
    <div class="row ${state.money < f.cost ? 'dim' : ''}" data-build="${f.id}">
      <div class="ic">${f.icon}</div>
      <div class="tx"><b>${f.name}</b> <small>${f.w}×${f.h} ${f.tags.map(t => TAG_NAME[t]).join('・')}</small><br><small>${f.desc}</small></div>
      <div class="num">${fmtG(f.cost)}<br><small>料金 ${f.price}G / 維持 ${f.upkeep}G</small></div>
    </div>`).join('');
  openPanel('🔨 建てる', rows + '<p class="hint">施設の下側が入口。城門から歩いて届く場所に建てよう。</p>');
  $('#panel-body').querySelectorAll('[data-build]').forEach(el => el.onclick = () => setBuildMode(el.dataset.build));
}
function panelFacility(uid) {
  const f = state.facilities.find(x => x.uid === uid); if (!f) return;
  selectedFac = uid;
  const d = FAC[f.id], e = facEff(f), st = staffOf(f);
  const opts = ['<option value="">（なし）</option>'].concat(state.staff.map(s => `<option value="${s.uid}" ${f.staff === s.uid ? 'selected' : ''}>${STAFF[s.id].icon} ${STAFF[s.id].name}${s.facility && s.facility !== uid ? '（他で勤務中）' : ''}</option>`)).join('');
  openPanel(`${d.icon} ${d.name}`, `
    <p><small>${d.desc}</small></p>
    <table class="rep">
      <tr><th>魅力</th><td>${Math.round(e.appeal)}</td><th>満足度</th><td>${Math.round(e.sat) > 0 ? '+' : ''}${Math.round(e.sat)}</td></tr>
      <tr><th>定員</th><td>${d.cap}人</td><th>維持費</th><td>${fmtG(facUpkeep(f))}/月</td></tr>
      <tr><th>利用者</th><td>${f.visits}人</td><th>売上</th><td>${fmtG(f.income)}</td></tr>
    </table>
    ${d.price > 0 ? `<div class="price"><span>料金</span><button data-p="-10">−</button><b id="price-v">${f.price}G</b><button data-p="10">＋</button><small>（標準 ${d.price}G。高いと不満、安いと満足）</small></div>` : ''}
    ${d.cap > 0 ? `<div class="price"><span>担当</span><select id="staff-sel">${opts}</select></div>` : ''}
    <div class="btns"><button class="danger" id="fac-remove">撤去（${fmtG(Math.floor(d.cost / 2))}戻る）</button></div>
  `);
  const body = $('#panel-body');
  body.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { f.price = clamp(f.price + +b.dataset.p, 0, d.price * 2); $('#price-v').textContent = f.price + 'G'; });
  const sel = body.querySelector('#staff-sel'); if (sel) sel.onchange = () => { assignStaff(uid, sel.value); panelFacility(uid); };
  body.querySelector('#fac-remove').onclick = () => { removeFacility(uid); closePanel(); toast(`${d.name}を撤去した`); };
}
function panelStaff() {
  const hired = state.staff.map(s => { const d = STAFF[s.id]; const f = s.facility ? state.facilities.find(x => x.uid === s.facility) : null; return `
    <div class="row"><div class="ic">${d.icon}</div><div class="tx"><b>${d.name}</b><br><small>${f ? '📍' + FAC[f.id].name : '未配属（施設をタップして配属）'}</small></div><div class="num">${fmtG(d.salary)}/月<br><button class="mini danger" data-fire="${s.uid}">解雇</button></div></div>`; }).join('') || '<p class="hint">まだ誰も雇っていない</p>';
  const cands = state.candidates.map(id => { const d = STAFF[id]; const b = d.bonus; return `
    <div class="row ${state.money < d.hire ? 'dim' : ''}"><div class="ic">${d.icon}</div><div class="tx"><b>${d.name}</b> <small>魅力+${b.appeal || 0} 満足+${b.sat || 0}${b.tag ? ' ' + TAG_NAME[b.tag] + '施設が得意' : ''}${b.research ? ' 研究×' + (1 + b.research) : ''}${b.upkeep ? ' 維持費半額' : ''}</small><br><small>「${d.line}」</small></div><div class="num">契約 ${fmtG(d.hire)}<br><small>${fmtG(d.salary)}/月</small><br><button class="mini" data-hire="${id}">雇う</button></div></div>`; }).join('') || '<p class="hint">今月の応募者はもういない（来月また来る）</p>';
  openPanel('👥 従業員（元ボス）', `<h4>在籍</h4>${hired}<h4>今月の応募者</h4>${cands}`);
  const body = $('#panel-body');
  body.querySelectorAll('[data-hire]').forEach(b => b.onclick = () => { hireStaff(b.dataset.hire); panelStaff(); });
  body.querySelectorAll('[data-fire]').forEach(b => b.onclick = () => { fireStaff(b.dataset.fire); panelStaff(); });
}
function panelResearch() {
  const locked = FACILITIES.filter(f => !state.unlocked.includes(f.id)).map(f => `
    <div class="row ${state.rp < f.rp ? 'dim' : ''}"><div class="ic">${f.icon}</div><div class="tx"><b>${f.name}</b> <small>${f.tags.map(t => TAG_NAME[t]).join('・')}</small><br><small>${f.desc}</small></div><div class="num">🔬${f.rp}<br><button class="mini" data-unlock="${f.id}">研究</button></div></div>`).join('') || '<p class="hint">すべて研究ずみ！</p>';
  openPanel(`🔬 研究（${Math.floor(state.rp)}pt）`, `<p class="hint">客が1人帰るごとに研究ポイント+1。リッチを雇うと増える。</p>${locked}`);
  $('#panel-body').querySelectorAll('[data-unlock]').forEach(b => b.onclick = () => { unlockFacility(b.dataset.unlock); panelResearch(); });
}
function panelReport() {
  const h = state.history.slice(-8).reverse();
  const rows = h.map(r => `<tr><td>${r.year}年${r.month}月</td><td>${r.visitors}</td><td>${fmtG(r.income)}</td><td>${fmtG(r.expense)}</td><td class="${r.income - r.expense >= 0 ? 'plus' : 'minus'}">${fmtG(r.income - r.expense)}</td><td>${r.rep}</td></tr>`).join('');
  const m = state.monthly;
  openPanel('📊 レポート', `
    <h4>今月（${state.month}月 ${state.day}日まで）</h4>
    <table class="rep"><tr><th>来場者</th><td>${m.visitors}人</td><th>収入</th><td>${fmtG(m.income)}</td></tr>
    <tr><th>平均満足度</th><td>${m.satN ? Math.round(m.satSum / m.satN) : '-'}</td><th>累計来場</th><td>${state.totalVisitors}人</td></tr></table>
    <h4>ランキング</h4>
    <p>人気 ${Math.round(state.rep)} → <b>${rankOf(state.rep).name}</b>「${rankOf(state.rep).title}」<br><small>次の段階: ${(RANKS.find(r => r.min > state.rep) || {}).min ? '人気 ' + RANKS.find(r => r.min > state.rep).min : '最高位！'}</small></p>
    <h4>過去の決算</h4>
    ${rows ? `<table class="rep small"><tr><th>月</th><th>客</th><th>収入</th><th>支出</th><th>収支</th><th>人気</th></tr>${rows}</table>` : '<p class="hint">まだ決算がない</p>'}
  `);
}
function panelSettings() {
  openPanel('⚙ 設定', `
    <div class="btns">
      <button id="snd">${state.sound ? '🔊 音: オン' : '🔇 音: オフ'}</button>
      <button id="save-now">💾 セーブ</button>
      <button class="danger" id="reset1">🗑 はじめから</button>
    </div>
    <p class="hint">セーブは自動でも行われます（10秒ごと・月末）。</p>
    <p class="hint">魔王城リゾート v${VERSION}<br>フォント: DotGothic16（フォントワークス）</p>
  `);
  $('#snd').onclick = () => { state.sound = !state.sound; panelSettings(); };
  $('#save-now').onclick = () => { save(); toast('セーブした'); };
  $('#reset1').onclick = () => { $('#reset1').textContent = '本当に消す？（もう一度タップ）'; $('#reset1').onclick = () => { localStorage.removeItem(SAVE_KEY); location.reload(); }; };
}

/* ============ 入力 ============ */
function tileFromEvent(ev) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((ev.clientX - r.left) / r.width * COLS), y = Math.floor((ev.clientY - r.top) / r.height * ROWS);
  return { x, y };
}
canvas.addEventListener('pointerdown', (ev) => {
  ev.preventDefault();
  const t = tileFromEvent(ev);
  if (mode === 'build') {
    const id = $('#buildbar').dataset.id; const d = FAC[id];
    const x = clamp(t.x - Math.floor((d.w - 1) / 2), 0, COLS - d.w), y = clamp(t.y - Math.floor((d.h - 1) / 2), KEEP_ROWS, ROWS - 1 - d.h);
    const chk = canPlace(id, x, y);
    ghost = { id, x, y, ok: chk.ok };
    $('#buildbar-ok').hidden = !chk.ok;
    $('#buildbar-name').textContent = chk.ok ? `${d.icon} ${d.name} ここに建てる？（${fmtG(d.cost)}）` : `✖ ${chk.why}`;
    return;
  }
  const f = facAt(t.x, t.y);
  if (f) { panelFacility(f.uid); return; }
  // 客をタップ → 気分を言う
  const g = guests.filter(x => x.state !== 'inside' && x.state !== 'gone').find(x => Math.abs(x.x - t.x) < 0.7 && Math.abs(x.y - t.y) < 0.7);
  if (g) { say(g, `${GUEST[g.type].name}: ${moodText(g)}`, g.sat >= 70 ? 'happy' : g.sat <= 35 ? 'angry' : 'ok'); return; }
  closePanel();
});
$('#buildbar-ok').onclick = () => { if (ghost && placeFacility(ghost.id, ghost.x, ghost.y)) { const d = FAC[ghost.id]; toast(`${d.icon} ${d.name}を建てた！`); ghost = null; $('#buildbar-ok').hidden = true; $('#buildbar-name').textContent = `${d.icon} ${d.name} — 続けて建てる場所をタップ（終わるときは ✕）`; } };
$('#buildbar-cancel').onclick = exitBuildMode;
$('#panel-close').onclick = closePanel;
$('#btn-build').onclick = () => { exitBuildMode(); panelBuild(); };
$('#btn-staff').onclick = () => { exitBuildMode(); panelStaff(); };
$('#btn-research').onclick = () => { exitBuildMode(); panelResearch(); };
$('#btn-report').onclick = () => { exitBuildMode(); panelReport(); };
$('#btn-settings').onclick = () => { exitBuildMode(); panelSettings(); };
document.querySelectorAll('#speed button').forEach(b => b.onclick = () => { state.speed = +b.dataset.s; updateHud(); });

/* ============ 音（簡易8bit） ============ */
let actx = null;
function sound(kind) {
  if (!state || !state.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(actx.destination);
    const t = actx.currentTime; o.type = 'square'; g.gain.value = 0.05;
    const seq = { coin: [[880, 0], [1320, 0.06]], build: [[440, 0], [660, 0.08], [880, 0.16]], error: [[220, 0], [180, 0.1]], levelup: [[523, 0], [659, 0.1], [784, 0.2], [1046, 0.3]] }[kind];
    seq.forEach(([f, dt]) => o.frequency.setValueAtTime(f, t + dt));
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12 * seq.length);
    o.start(t); o.stop(t + 0.12 * seq.length + 0.05);
  } catch (e) { /* 音が出なくてもゲームは続ける */ }
}

/* ============ セーブ ============ */
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...state, savedAt: Date.now() })); } catch (e) { /* 容量不足などは無視 */ }
}
function load() {
  try { const s = localStorage.getItem(SAVE_KEY); if (!s) return null; const o = JSON.parse(s); if (!o || !o.facilities) return null; return { ...newState(), ...o, monthly: { ...freshMonthly(), ...(o.monthly || {}) }, event: { ...{ id: 'none', daysLeft: 0, heroes: [] }, ...(o.event || {}) } }; } catch (e) { return null; }
}
setInterval(() => { if (state && state.speed > 0) save(); }, 10000);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else lastTs = performance.now(); });

/* ============ 開始 ============ */
function init() {
  state = load() || newState();
  rebuildOcc(); startDay(); updateHud();
  if (state.intro) {
    state.intro = false;
    showModal('魔王城リゾート', `
      <div class="maou-say">😈「${MAOU_LINES.start[0]}」</div>
      <div class="maou-say">😈「${MAOU_LINES.start[1]}」</div>
      <p>勇者に負けて無職になった魔王が、魔王城をテーマパークにして再起を図る経営ゲーム。</p>
      <ol class="hint">
        <li><b>建てる</b> から施設を置く。まずは <b>ゴーレム焼き</b>・<b>トイレ</b>・<b>スライム風呂</b> あたり</li>
        <li>客が城門から入って、好みの施設にお金を落とす</li>
        <li>満足した客が口コミで <b>人気</b> を上げ、客が増える</li>
        <li>研究ポイントで新しい施設を解放、元ボスを雇って配属</li>
      </ol>
      <p class="hint">所持金 ${fmtG(START_MONEY)}。目指せ魔界観光地ランキング1位！</p>
    `);
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (DEBUG) { setInterval(() => loop(performance.now()), 50); window.ff = (sec) => { for (let i = 0; i < sec / 0.05; i++) tick(0.05); render(); }; } // 裏タブでは rAF が止まるため。ff(秒) で早送り
  else requestAnimationFrame(loop);
}
init();
