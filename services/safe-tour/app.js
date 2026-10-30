// 서울 안심 도보길 – walking routes that prefer CCTV-covered streets, for all of Seoul.
// Map data is split into 2 km tiles (data/tiles); only the tiles around the start are loaded.
(function () {
"use strict";

const DATA = 'data/';
const REACH = 4000;          // walking distance shown as "within an hour"
const PACE = 70;             // metres per minute (≈ 4.2 km/h)
const LOAD_R = 4800;         // load tiles this far around the start
const JONGNO = { lat: 37.57003, lon: 126.98320, name: '종로(종각·보신각)' };
const STEP = 8;              // CCTV coverage sample spacing (m)

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtD = m => m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
const mins = m => Math.max(1, Math.round(m / PACE));

let IDX, PLACES = [], LARGE = [], TILESET;
let toXY, inBounds;

// ---------- graph (grows as tiles load) ----------
const VX = [], VY = [], adj = [], gid2v = new Map();
const E = [];       // {a,b,len,cls,name,pts,cov,bb}
const AREAS = [];   // {k, rings, bb}
let BASE_CAMS = [];
const loaded = new Set(), pending = new Map();
let vgrid = new Map(); const VCELL = 100;

function addVertex(g, x, y) {
  let v = gid2v.get(g);
  if (v === undefined) {
    v = VX.length; gid2v.set(g, v); VX.push(x); VY.push(y); adj.push([]);
    const k = Math.floor(x / VCELL) + ',' + Math.floor(y / VCELL);
    if (!vgrid.has(k)) vgrid.set(k, []);
    vgrid.get(k).push(v);
  }
  return v;
}
function bbox(flat, extra) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  const f = (x, y) => { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; };
  for (let i = 0; i < flat.length; i += 2) f(flat[i], flat[i + 1]);
  if (extra) extra.forEach(([x, y]) => f(x, y));
  return [a, b, c, d];
}
function addTile(t) {
  const map = new Map();
  for (let i = 0; i < t.v.length; i += 3) map.set(t.v[i], addVertex(t.v[i], t.v[i + 1], t.v[i + 2]));
  for (const [ga, gb, len, cls, ni, pts] of t.e) {
    const a = map.get(ga), b = map.get(gb);
    const e = { a, b, len: Math.max(len, 0.5), cls, name: t.names[ni] || '', pts, cov: 0 };
    e.bb = bbox(pts, [[VX[a], VY[a]], [VX[b], VY[b]]]);
    e.samp = samples(e);
    const i = E.push(e) - 1;
    adj[a].push(i); adj[b].push(i);
  }
  for (const [k, rings] of t.a) AREAS.push({ k, rings, bb: bbox(rings.flat()) });
  for (const c of t.c) BASE_CAMS.push(c);
}
function edgePts(e, rev) {
  const p = [[VX[e.a], VY[e.a]]];
  for (let k = 0; k < e.pts.length; k += 2) p.push([e.pts[k], e.pts[k + 1]]);
  p.push([VX[e.b], VY[e.b]]);
  return rev ? p.reverse() : p;
}
function samples(e) {
  const p = edgePts(e), out = [];
  for (let k = 0; k < p.length - 1; k++) {
    const [x1, y1] = p[k], [x2, y2] = p[k + 1], L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(L / STEP));
    for (let s = 0; s < n; s++) { const t = (s + .5) / n; out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, L / n]); }
  }
  return out;
}
function nearestVertex(x, y, maxR) {
  maxR = maxR || 600;
  let best = -1, bd = maxR * maxR;
  const gx = Math.floor(x / VCELL), gy = Math.floor(y / VCELL), n = Math.ceil(maxR / VCELL);
  for (let r = 0; r <= n; r++) {
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const l = vgrid.get((gx + i) + ',' + (gy + j)); if (!l) continue;
      for (const v of l) { if (!adj[v].length) continue; const d = (VX[v] - x) ** 2 + (VY[v] - y) ** 2; if (d < bd) { bd = d; best = v; } }
    }
    if (best >= 0 && (r * VCELL) ** 2 > bd) break;
  }
  return best;
}

async function ensureTiles(x, y) {
  const T = IDX.tile, keys = [];
  for (let i = Math.floor((x - LOAD_R) / T); i <= Math.floor((x + LOAD_R) / T); i++)
    for (let j = Math.floor((y - LOAD_R) / T); j <= Math.floor((y + LOAD_R) / T); j++) {
      const k = i + '_' + j;
      if (TILESET.has(k) && !loaded.has(k)) keys.push(k);
    }
  if (!keys.length) return;
  let done = 0;
  busy('주변 지도를 불러오는 중… (0/' + keys.length + ')');
  await Promise.all(keys.map(k => {
    if (!pending.has(k)) pending.set(k, fetch(DATA + 'tiles/' + k + '.json').then(r => {
      if (!r.ok) throw new Error('지도 조각 ' + k + ' (HTTP ' + r.status + ')');
      return r.json();
    }).then(t => { if (!loaded.has(k)) { addTile(t); loaded.add(k); } }).catch(err => { pending.delete(k); throw err; }));
    return pending.get(k).then(() => busy('주변 지도를 불러오는 중… (' + (++done) + '/' + keys.length + ')'));
  }));
}

// ---------- CCTV ----------
let PURP = [], enabled = new Set(), source = 'base', IMPORTED = null, cams = [];
const CELL = 40; let grid = new Map();
let R = 40, W = 3;
try { const s = localStorage.getItem('seoul-safe-walk:cams3'); if (s) IMPORTED = JSON.parse(s); } catch (_) { }
const allCams = () => source === 'import' && IMPORTED ? IMPORTED : BASE_CAMS;
function buildGrid() {
  grid = new Map();
  cams.forEach((c, i) => { const k = Math.floor(c[0] / CELL) + ',' + Math.floor(c[1] / CELL); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
}
function camsNear(x, y, r) {
  const out = [], r2 = r * r, gx = Math.floor(x / CELL), gy = Math.floor(y / CELL), n = Math.ceil(r / CELL);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const l = grid.get((gx + i) + ',' + (gy + j));
    if (l) for (const ci of l) { const c = cams[ci]; if ((c[0] - x) ** 2 + (c[1] - y) ** 2 <= r2) out.push(ci); }
  }
  return out;
}
function anyCamNear(x, y, r) {
  const r2 = r * r, gx = Math.floor(x / CELL), gy = Math.floor(y / CELL), n = Math.ceil(r / CELL);
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const l = grid.get((gx + i) + ',' + (gy + j));
    if (l) for (const ci of l) { const c = cams[ci]; if ((c[0] - x) ** 2 + (c[1] - y) ** 2 <= r2) return true; }
  }
  return false;
}
function computeCoverage() {
  for (const e of E) { let cov = 0, tot = 0; for (const [x, y, l] of e.samp) { tot += l; if (anyCamNear(x, y, R)) cov += l; } e.cov = tot ? cov / tot : 0; }
}
function applyCams() {
  cams = allCams().filter(c => enabled.has(PURP[c[3]]));
  buildGrid(); computeCoverage(); updateNotice(); buildChips();
}
const nearStart = l => start ? l.filter(c => Math.abs(c[0] - start.x) < 5000 && Math.abs(c[1] - start.y) < 5000) : l;
function updateNotice() {
  const all = nearStart(allCams()), used = nearStart(cams);
  const sum = all.reduce((a, c) => a + c[2], 0);
  $('notice').innerHTML = '<strong>' + (source === 'import' ? '불러온 파일' : '서울시 CCTV 공공데이터') + '</strong>로 안내 중이에요. 출발지 주변 5km 안 ' +
    all.length.toLocaleString() + '곳(카메라 ' + sum.toLocaleString() + '대) 중 선택한 종류 <strong>' + used.length.toLocaleString() +
    '곳</strong>을 경로 계산에 씁니다. 구청이 관리하는 CCTV만 들어 있어 경찰·궁궐·상가 CCTV는 빠져 있어요.';
}
function buildChips() {
  const box = $('purposes'); box.innerHTML = '';
  const cnt = {}; nearStart(allCams()).forEach(c => { const p = PURP[c[3]]; cnt[p] = (cnt[p] || 0) + 1; });
  PURP.forEach((p, i) => {
    if (!cnt[p]) return;
    const l = document.createElement('label'); l.className = 'chip';
    l.innerHTML = '<input type="checkbox" id="pp-' + i + '"' + (enabled.has(p) ? ' checked' : '') + '>' + esc(p) + ' <em>' + cnt[p].toLocaleString() + '</em>';
    l.querySelector('input').onchange = e => { e.target.checked ? enabled.add(p) : enabled.delete(p); applyCams(); route(false); };
    box.appendChild(l);
  });
}
function refreshImportUI() {
  const has = !!(IMPORTED && IMPORTED.length);
  $('src-import').disabled = !has; $('clear-import').hidden = !has;
  $('import-hint').textContent = has ? '서울 안 ' + IMPORTED.length.toLocaleString() + '곳을 불러왔어요.' : '아직 불러온 파일이 없어요.';
}

// ---------- routing ----------
function dijkstra(s, t, w, limit) {
  const n = VX.length, dist = new Float64Array(n).fill(Infinity), prevE = new Int32Array(n).fill(-1);
  dist[s] = 0;
  const heap = [[0, s]];
  const push = it => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break;[heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break;[heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    if (u === t) break;
    if (limit && d > limit) break;
    for (const ei of adj[u]) {
      const e = E[ei], v = e.a === u ? e.b : e.a;
      const c = e.len * (1 + w * (1 - e.cov)) * (e.cls === 1 ? 1.15 : 1);
      const nd = d + c;
      if (nd < dist[v]) { dist[v] = nd; prevE[v] = ei; push([nd, v]); }
    }
  }
  if (t < 0) return { dist };
  if (!isFinite(dist[t])) return null;
  const seq = []; let v = t;
  while (v !== s) { const ei = prevE[v], e = E[ei], u = e.a === v ? e.b : e.a; seq.push({ ei, rev: e.a !== u }); v = u; }
  return seq.reverse();
}
const CLS_NAME = { 0: '보행로', 1: '계단', 2: '골목길', 3: '도로변 보도', 4: '큰길 보도' };
function analyse(seq) {
  let len = 0, cov = 0, gap = 0, cur = 0, gapRun = null;
  const gaps = [], line = [], seen = new Set();
  for (const { ei, rev } of seq) {
    const e = E[ei]; len += e.len;
    const pts = edgePts(e, rev); if (line.length) pts.shift(); line.push(...pts);
    const ss = rev ? [...e.samp].reverse() : e.samp;
    for (const [x, y, l] of ss) {
      const near = camsNear(x, y, R); near.forEach(c => seen.add(c));
      if (near.length) { cov += l; if (cur > 0) { if (cur >= 60) gaps.push(gapRun.concat([[x, y]])); gap = Math.max(gap, cur); } cur = 0; gapRun = null; }
      else { if (!gapRun) gapRun = [[x, y]]; else gapRun.push([x, y]); cur += l; }
    }
  }
  if (cur > 0) { gap = Math.max(gap, cur); if (cur >= 60 && gapRun) gaps.push(gapRun); }
  const steps = [];
  for (const { ei } of seq) {
    const e = E[ei], nm = e.name || CLS_NAME[e.cls] || '길', last = steps[steps.length - 1];
    if (last && last.n === nm) last.d += e.len; else steps.push({ n: nm, d: e.len, named: !!e.name });
  }
  const merged = []; steps.forEach(s => { if (s.d < 25 && merged.length) merged[merged.length - 1].d += s.d; else merged.push(s); });
  return { len, covPct: len ? cov / len : 0, cams: seen.size, gap, gaps, line, steps: merged };
}

// ---------- state ----------
let start = null;          // {x, y, v, name, note}
let reach = [];            // [{place, d}] sorted by walking distance
let dest = null;           // reach item
let safe = null, short = null;
let userMovedStart = false;

async function setStart(x, y, name, note, fit) {
  if (!inBounds(x, y)) { toast('서울 지도 범위 밖이에요. 서울 안을 눌러 주세요.'); return; }
  try { await ensureTiles(x, y); } catch (err) { busy(null); toast('지도를 불러오지 못했어요: ' + err.message, 5000); return; }
  busy('걸어서 갈 수 있는 곳을 찾는 중…');
  await new Promise(r => setTimeout(r, 20));
  applyCams();
  const v = nearestVertex(x, y, 800);
  if (v < 0) { busy(null); toast('근처에 걸을 수 있는 길이 없어요. 다른 곳을 눌러 주세요.'); return; }
  start = { x, y, v, name, note };
  $('start-name').textContent = name; $('start-note').textContent = note || '';
  updateNotice(); buildChips();
  findReach();
  dest = null; safe = short = null;
  renderPlaces();
  const first = reach.find(r => r.d >= 600) || reach[0];
  if (first) selectDest(first, false); else clearResult('걸어서 1시간 안에 등록된 관광지가 없어요. 출발지를 옮겨 보세요.');
  busy(null);
  if (fit) fitReach(); else render();
}
function findReach() {
  const { dist } = dijkstra(start.v, -1, 0, REACH + 300);
  reach = [];
  for (const p of PLACES) {
    if (Math.hypot(p.x - start.x, p.y - start.y) > REACH) continue;
    if (p.v === undefined || p.v < 0 || p.vAt !== VX.length) { p.v = nearestVertex(p.x, p.y, 300); p.vAt = VX.length; }
    if (p.v < 0) continue;
    const d = dist[p.v] + Math.hypot(VX[p.v] - p.x, VY[p.v] - p.y);
    if (d <= REACH) reach.push({ p, d });
  }
  reach.sort((a, b) => a.d - b.d);
}
function renderPlaces() {
  const q = $('q').value.trim(), ul = $('places');
  $('places-title').textContent = '걸어서 1시간 안의 관광지 ' + reach.length + '곳';
  const list = q ? reach.filter(r => r.p.n.includes(q) || r.p.k.includes(q) || (r.p.en || '').toLowerCase().includes(q.toLowerCase())) : reach;
  ul.innerHTML = '';
  if (!list.length) {
    const li = document.createElement('li'); li.className = 'empty';
    li.textContent = reach.length ? '“' + q + '”에 맞는 곳이 없어요.' : '걸어서 1시간 안에 등록된 관광지가 없어요. 출발지를 옮겨 보세요.';
    ul.appendChild(li); return;
  }
  for (const r of list) {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button'; b.setAttribute('aria-pressed', dest === r ? 'true' : 'false');
    b.innerHTML = '<span class="nm">' + esc(r.p.n) + '</span><span class="ds">' + fmtD(r.d) + '</span><span class="kd">' + esc(r.p.k) + '</span><span class="mn">도보 ' + mins(r.d) + '분</span>';
    b.onclick = () => selectDest(r, true);
    li.appendChild(b); ul.appendChild(li);
  }
}
function selectDest(r, fit) {
  dest = r;
  renderPlacesKeepScroll();
  route(fit);
}
function renderPlacesKeepScroll() { const ul = $('places'), s = ul.scrollTop; renderPlaces(); ul.scrollTop = s; }
function clearResult(msg) {
  safe = short = null;
  ['s', 'o'].forEach(p => { $(p + '-dist').textContent = '–'; $(p + '-cov').textContent = '–'; $(p + '-bar').style.width = '0'; $(p + '-cams').textContent = '–'; $(p + '-gap').textContent = '–'; });
  $('verdict').textContent = msg; $('steps').innerHTML = ''; render();
}
function route(fit) {
  if (!start || !dest) return;
  const t = dest.p.v;
  if (t === start.v) { clearResult('출발지와 같은 곳이에요. 다른 곳을 골라 주세요.'); return; }
  const s1 = dijkstra(start.v, t, 0), s2 = dijkstra(start.v, t, W);
  if (!s1 || !s2) { clearResult('두 지점을 잇는 보행 경로를 찾지 못했어요.'); return; }
  short = analyse(s1); safe = analyse(s2);
  const put = (p, a) => {
    $(p + '-dist').innerHTML = fmtD(a.len) + ' <small>· 도보 ' + mins(a.len) + '분</small>';
    $(p + '-cov').textContent = Math.round(a.covPct * 100) + '%';
    $(p + '-bar').style.width = (a.covPct * 100).toFixed(1) + '%';
    $(p + '-cams').textContent = a.cams + '대'; $(p + '-gap').textContent = fmtD(a.gap);
  };
  put('s', safe); put('o', short);
  const extra = safe.len - short.len, dc = Math.round((safe.covPct - short.covPct) * 100);
  let v;
  if (Math.abs(extra) < 5 && Math.abs(dc) < 1) v = safe.covPct >= 0.6 ? '최단 경로가 이미 CCTV가 비추는 길이에요. 그대로 가시면 됩니다.' : '이 구간은 돌아가도 CCTV가 더 많은 길이 없어요(CCTV 구간 ' + Math.round(safe.covPct * 100) + '%). 사람이 많고 밝은 큰길로 걸어 주세요.';
  else v = '안심 경로는 ' + (extra > 0 ? Math.round(extra) + ' m(약 ' + Math.max(1, Math.round(extra / PACE)) + '분) 더 걷는 대신 ' : '') + 'CCTV 구간이 ' + (dc >= 0 ? dc + '%p 늘고' : Math.abs(dc) + '%p 줄고') + ', 가장 긴 사각 구간이 ' + fmtD(short.gap) + ' → ' + fmtD(safe.gap) + '로 바뀝니다.';
  $('verdict').textContent = v;
  const ol = $('steps'); ol.innerHTML = '';
  const add = h => { const li = document.createElement('li'); li.innerHTML = h; ol.appendChild(li); };
  add('<b>' + esc(start.name) + '</b>에서 출발');
  safe.steps.slice(0, 12).forEach(s => add((s.named ? '<b>' + esc(s.n) + '</b>' : esc(s.n)) + ' 따라 ' + fmtD(s.d)));
  if (safe.steps.length > 12) add('… 이후 ' + (safe.steps.length - 12) + '개 구간');
  add('<b>' + esc(dest.p.n) + '</b> 도착');
  if (fit) fitRoute(); else render();
}

// ---------- location ----------
function useJongno(reason) {
  const [x, y] = toXY(JONGNO.lat, JONGNO.lon);
  return setStart(x, y, JONGNO.name, reason, true);
}
function locate(manual) {
  if (!navigator.geolocation) return useJongno('이 브라우저는 위치 기능을 지원하지 않아 종로를 출발지로 정했어요.');
  $('start-name').textContent = '위치를 확인하는 중…';
  $('start-note').textContent = '브라우저가 위치 권한을 물으면 허용해 주세요.';
  let settled = false;
  const giveUp = setTimeout(() => { if (!settled) { settled = true; useJongno('위치 정보를 받지 못해 종로를 출발지로 정했어요.'); } }, 12000);
  navigator.geolocation.getCurrentPosition(pos => {
    const [x, y] = toXY(pos.coords.latitude, pos.coords.longitude);
    const acc = Math.round(pos.coords.accuracy || 0);
    if (!inBounds(x, y)) {
      if (!settled) { settled = true; clearTimeout(giveUp); useJongno('현재 위치가 서울 밖이라 종로를 출발지로 정했어요.'); }
      else if (manual) toast('현재 위치가 서울 밖이에요.');
      return;
    }
    if (settled && userMovedStart && !manual) return;   // keep a start the user picked meanwhile
    settled = true; clearTimeout(giveUp);
    setStart(x, y, '현재 위치', acc ? '위치 정확도 약 ±' + acc + ' m' : '', true);
  }, err => {
    if (settled) { if (manual) toast('위치 정보를 받지 못했어요.'); return; }
    settled = true; clearTimeout(giveUp);
    const why = err.code === 1 ? '위치 권한이 꺼져 있어' : err.code === 3 ? '위치 확인이 너무 오래 걸려' : '위치 정보를 받지 못해';
    useJongno(why + ' 종로를 출발지로 정했어요.');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

// ---------- map ----------
const cv = $('map'), ctx = cv.getContext('2d');
let view = { cx: 0, cy: 0, s: 0.12 }, DPR = 1, CW = 0, CH = 0;
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
let C = {};
function readColors() { ['ground', 'park', 'water', 'heritage', 'road', 'road-edge', 'alley', 'ink', 'ink-2', 'ink-3', 'safe', 'short', 'cam', 'cam-glow', 'gap', 'pin-a', 'pin-b', 'panel'].forEach(k => C[k] = css('--' + k)); }
readColors();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); render(); });
function resize() { const r = cv.getBoundingClientRect(); DPR = Math.min(2, window.devicePixelRatio || 1); CW = r.width; CH = r.height; cv.width = Math.round(CW * DPR); cv.height = Math.round(CH * DPR); render(); }
const sx = x => (x - view.cx) * view.s + CW / 2, sy = y => CH / 2 - (y - view.cy) * view.s;
const wx = px => (px - CW / 2) / view.s + view.cx, wy = py => view.cy - (py - CH / 2) / view.s;
let raf = 0; function render() { if (!raf) raf = requestAnimationFrame(draw); }
function visible(bb, m) { m = m || 0; return !(bb[2] < wx(-m) || bb[0] > wx(CW + m) || bb[3] < wy(CH + m) || bb[1] > wy(-m)); }
function ring(flat) { ctx.moveTo(sx(flat[0]), sy(flat[1])); for (let k = 2; k < flat.length; k += 2) ctx.lineTo(sx(flat[k]), sy(flat[k + 1])); ctx.closePath(); }
function linePts(pts) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))); }
function edgePath(e) { ctx.moveTo(sx(VX[e.a]), sy(VY[e.a])); for (let k = 0; k < e.pts.length; k += 2) ctx.lineTo(sx(e.pts[k]), sy(e.pts[k + 1])); ctx.lineTo(sx(VX[e.b]), sy(VY[e.b])); }
function draw() {
  raf = 0;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = C.ground; ctx.fillRect(0, 0, CW, CH);
  const s = view.s;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // areas
  const fills = { g: C.park, w: C.water, h: C.heritage };
  for (const k of ['g', 'h', 'w']) {
    ctx.fillStyle = fills[k]; ctx.beginPath();
    for (const a of LARGE) if (a.k === k && visible(a.bb)) a.rings.forEach(ring);
    for (const a of AREAS) if (a.k === k && visible(a.bb)) a.rings.forEach(ring);
    ctx.fill('evenodd');
  }
  // CCTV halos
  if (s > 0.15) {
    ctx.fillStyle = C['cam-glow']; ctx.beginPath();
    for (const c of cams) { const x = sx(c[0]), y = sy(c[1]); if (x < -60 || y < -60 || x > CW + 60 || y > CH + 60) continue; ctx.moveTo(x + R * s, y); ctx.arc(x, y, R * s, 0, 6.283); }
    ctx.fill();
  }
  // roads, batched per class
  const widths = { 0: 2.2, 1: 2, 2: 3.2, 3: 6, 4: 9 };
  const minCls = s < 0.05 ? 3 : s < 0.09 ? 2 : 0;
  const vis = E.filter(e => e.cls >= minCls && visible(e.bb, 20));
  for (const cls of [4, 3]) {
    ctx.strokeStyle = C['road-edge']; ctx.lineWidth = Math.max(0.6, widths[cls] * s * 1.4) + 1.5; ctx.beginPath();
    for (const e of vis) if (e.cls === cls) edgePath(e);
    ctx.stroke();
  }
  for (const cls of [0, 1, 2, 3, 4]) {
    ctx.strokeStyle = cls >= 2 ? C.road : C.alley; ctx.lineWidth = Math.max(0.6, widths[cls] * s * 1.4);
    ctx.setLineDash(cls === 1 && s > 0.5 ? [2, 2] : []);
    ctx.beginPath(); for (const e of vis) if (e.cls === cls) edgePath(e); ctx.stroke();
  }
  ctx.setLineDash([]);
  // CCTV dots
  if (s > 0.08) {
    const cr = Math.max(1.4, Math.min(4, 6.4 * s));
    ctx.fillStyle = C.cam; ctx.beginPath();
    for (const c of cams) { const x = sx(c[0]), y = sy(c[1]); if (x < -10 || y < -10 || x > CW + 10 || y > CH + 10) continue; const r = cr * (c[2] > 2 ? 1.25 : 1); ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.283); }
    ctx.fill();
  }
  // reach circle
  if (start) { ctx.strokeStyle = C['pin-a']; ctx.globalAlpha = .55; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.arc(sx(start.x), sy(start.y), REACH * s, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
  // routes
  if (short) { ctx.strokeStyle = C.short; ctx.lineWidth = 4; ctx.setLineDash([8, 6]); linePts(short.line); ctx.stroke(); ctx.setLineDash([]); }
  if (safe) {
    ctx.strokeStyle = C.panel; ctx.lineWidth = 9; linePts(safe.line); ctx.stroke();
    ctx.strokeStyle = C.safe; ctx.lineWidth = 5.5; linePts(safe.line); ctx.stroke();
    ctx.strokeStyle = C.gap; ctx.lineWidth = 5.5; for (const g of safe.gaps) { linePts(g); ctx.stroke(); }
  }
  // places within reach
  ctx.font = '500 12px ' + css('--f-body'); ctx.textBaseline = 'middle';
  for (const r of reach) {
    const x = sx(r.p.x), y = sy(r.p.y);
    if (x < -100 || y < -20 || x > CW + 100 || y > CH + 20) continue;
    const on = dest === r;
    ctx.fillStyle = C.panel; ctx.strokeStyle = C['pin-b']; ctx.lineWidth = on ? 3.5 : 2.5;
    ctx.beginPath(); ctx.arc(x, y, on ? 6 : 4.5, 0, 6.283); ctx.fill(); ctx.stroke();
    if (s > 0.16 || on) { ctx.lineWidth = 3; ctx.strokeStyle = C.ground; ctx.strokeText(r.p.n, x + 8, y); ctx.fillStyle = on ? C.ink : C['ink-2']; ctx.fillText(r.p.n, x + 8, y); }
  }
  if (start) pin(VX[start.v], VY[start.v], C['pin-a'], '출');
  if (dest) pin(VX[dest.p.v], VY[dest.p.v], C['pin-b'], '도');
}
function pin(wx_, wy_, col, t) {
  const x = sx(wx_), y = sy(wy_);
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y - 14, 11, 0, 6.283); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 6, y - 8); ctx.lineTo(x, y); ctx.lineTo(x + 6, y - 8); ctx.fill();
  ctx.fillStyle = C.panel; ctx.font = '700 11px ' + css('--f-body'); ctx.textAlign = 'center'; ctx.fillText(t, x, y - 14); ctx.textAlign = 'left';
}
function fitBox(a, b, c, d, pad) {
  pad = pad || 50;
  view.cx = (a + c) / 2; view.cy = (b + d) / 2;
  view.s = Math.min(3, Math.max(0.03, Math.min((CW - pad * 2) / Math.max(50, c - a), (CH - pad * 2) / Math.max(50, d - b))));
  render();
}
function fitRoute() {
  if (!safe) return fitReach();
  let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
  for (const [x, y] of safe.line.concat(short.line)) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  fitBox(a, b, c, d, 60);
}
function fitReach() { if (start) fitBox(start.x - REACH, start.y - REACH, start.x + REACH, start.y + REACH, 20); }

// pan / zoom / tap
const ptrs = new Map(); let moved = 0, pinch0 = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]); moved = 0; cv.classList.add('drag'); if (ptrs.size === 2) { const [p, q] = [...ptrs.values()]; pinch0 = { d: Math.hypot(p[0] - q[0], p[1] - q[1]), s: view.s }; } });
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  const [px, py] = ptrs.get(e.pointerId);
  if (ptrs.size === 2 && pinch0) { ptrs.set(e.pointerId, [e.offsetX, e.offsetY]); const [p, q] = [...ptrs.values()]; zoomAt((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, pinch0.s * Math.hypot(p[0] - q[0], p[1] - q[1]) / pinch0.d / view.s); moved = 99; return; }
  const dx = e.offsetX - px, dy = e.offsetY - py; moved += Math.abs(dx) + Math.abs(dy);
  view.cx -= dx / view.s; view.cy += dy / view.s; ptrs.set(e.pointerId, [e.offsetX, e.offsetY]); render();
});
cv.addEventListener('pointerup', e => { if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; cv.classList.remove('drag'); if (moved < 6 && ptrs.size === 0) tap(e.offsetX, e.offsetY); });
cv.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); pinch0 = null; });
cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
function zoomAt(px, py, f) { const x = wx(px), y = wy(py); view.s = Math.min(4, Math.max(0.03, view.s * f)); view.cx = x - (px - CW / 2) / view.s; view.cy = y + (py - CH / 2) / view.s; render(); }
$('zin').onclick = () => zoomAt(CW / 2, CH / 2, 1.5); $('zout').onclick = () => zoomAt(CW / 2, CH / 2, 1 / 1.5); $('zfit').onclick = fitRoute;
function tap(px, py) {
  if (busyNow) return;
  // a place within reach?
  let hit = null, hd = 14;
  for (const r of reach) { const d = Math.hypot(sx(r.p.x) - px, sy(r.p.y) - py); if (d < hd) { hd = d; hit = r; } }
  if (hit) { $('camcard').hidden = true; selectDest(hit, false); return; }
  // a camera (when zoomed in)?
  if (view.s > 0.5) {
    let best = null, bd = 12;
    for (const c of cams) { const d = Math.hypot(sx(c[0]) - px, sy(c[1]) - py); if (d < bd) { bd = d; best = c; } }
    if (best) { showCam(best); return; }
  }
  $('camcard').hidden = true;
  userMovedStart = true;
  setStart(wx(px), wy(py), '지도에서 고른 지점', '지도를 눌러 정한 출발지예요.', false).then(() => toast('출발지를 옮겼어요.'));
}
function showCam(c) {
  const ym = c[5] && c[5].length >= 6 ? c[5].slice(0, 4) + '년 ' + (+c[5].slice(4, 6)) + '월' : '정보 없음';
  const k = $('camcard');
  k.innerHTML = '<button class="x" type="button" aria-label="닫기">×</button><h4>' + esc(PURP[c[3]]) + ' CCTV · ' + c[2] + '대</h4>' +
    '<div>' + esc(c[4] || '주소 정보 없음') + '</div><div class="kv"><span>설치</span><b>' + esc(ym) + '</b></div><div class="kv"><span>관리</span><b style="font-family:var(--f-body)">' + esc(c[6] || '–') + '</b></div>';
  k.hidden = false; k.querySelector('.x').onclick = () => k.hidden = true;
}

// ---------- misc UI ----------
let toastT; function toast(m, ms) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms || 2600); }
let busyNow = false; function busy(msg) { busyNow = !!msg; $('loading').hidden = !msg; if (msg) $('loading-text').textContent = msg; }

$('q').addEventListener('input', renderPlaces);
$('weight').oninput = e => { W = +e.target.value; route(false); };
$('radius').oninput = e => { R = +e.target.value; $('radiusv').textContent = R + ' m'; computeCoverage(); route(false); };
$('locate').onclick = () => { userMovedStart = false; locate(true); };
$('jongno').onclick = () => { userMovedStart = true; useJongno('기본 출발지예요.'); };
document.querySelectorAll('input[name=src]').forEach(r => r.onchange = () => { if (r.checked) { source = r.value; applyCams(); if (start) { findReach(); renderPlaces(); } route(false); } });

// CSV import (whole Seoul, kept in memory and, if it fits, in this browser)
$('csv').onchange = async ev => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const buf = await f.arrayBuffer(); let txt;
    try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { txt = new TextDecoder('euc-kr').decode(buf); }
    const rows = parseCSV(txt.replace(/^﻿/, '')); if (rows.length < 2) throw new Error('행이 없어요');
    const h = rows[0].map(s => s.trim()), fi = re => h.findIndex(x => re.test(x));
    const la = fi(/WGS84\s*위도|위도|^lat|latitude/i), lo = fi(/WGS84\s*경도|경도|^lon|^lng|longitude/i), cn = fi(/카메라\s*대수|대수|수량|count/i),
      pu = fi(/설치\s*목적/), ad = fi(/도로명주소|주소/), ym = fi(/설치\s*연월/), ag = fi(/관리\s*기관명/);
    if (la < 0 || lo < 0) throw new Error('위도·경도 열을 찾지 못했어요. (첫 줄: ' + h.slice(0, 6).join(', ') + ')');
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], a = parseFloat(r[la]), b = parseFloat(r[lo]); if (!isFinite(a) || !isFinite(b)) continue;
      const [x, y] = toXY(a, b); if (!inBounds(x, y)) continue;
      let p = pu >= 0 ? PURP.indexOf((r[pu] || '').trim()) : -1; if (p < 0) p = PURP.indexOf('기타');
      out.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.max(1, parseInt(r[cn]) || 1), p,
        ad >= 0 ? (r[ad] || '').replace('서울특별시 ', '') : '', ym >= 0 ? r[ym] || '' : '', ag >= 0 ? (r[ag] || '').replace('서울특별시 ', '') : '']);
    }
    if (!out.length) throw new Error('서울 범위에 해당하는 CCTV 좌표를 찾지 못했어요.');
    IMPORTED = out;
    try { localStorage.setItem('seoul-safe-walk:cams3', JSON.stringify(out)); } catch (_) { toast('파일이 커서 이번 방문에만 쓰고 저장하지는 않아요.', 4000); }
    refreshImportUI(); $('src-import').checked = true; source = 'import'; applyCams(); route(false);
    toast('CCTV ' + out.length.toLocaleString() + '곳을 불러왔어요.');
  } catch (err) { toast(err.message || String(err), 5000); }
  ev.target.value = '';
};
$('clear-import').onclick = () => { IMPORTED = null; try { localStorage.removeItem('seoul-safe-walk:cams3'); } catch (_) { } refreshImportUI(); $('src-base').checked = true; source = 'base'; applyCams(); route(false); toast('불러온 데이터를 지웠어요.'); };
function parseCSV(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// ---------- boot ----------
window.addEventListener('resize', resize);
resize();
busy('지도 정보를 불러오는 중…');
Promise.all(['index.json', 'places.json', 'areas-large.json'].map(n => fetch(DATA + n).then(r => { if (!r.ok) throw new Error(n + ' (HTTP ' + r.status + ')'); return r.json(); })))
  .then(([idx, places, large]) => {
    IDX = idx; TILESET = new Set(idx.tiles); PURP = idx.purposes;
    enabled = new Set(PURP.filter(p => p !== '교통단속' && p !== '교통정보수집'));
    toXY = (lat, lon) => [(lon - idx.lon0) * idx.kx, (lat - idx.lat0) * idx.ky];
    inBounds = (x, y) => x >= idx.bounds[0] && y >= idx.bounds[1] && x <= idx.bounds[2] && y <= idx.bounds[3] &&
      TILESET.has(Math.floor(x / idx.tile) + '_' + Math.floor(y / idx.tile));
    PLACES = places.map(([n, k, x, y, en]) => ({ n, k, x, y, en }));
    LARGE = large.map(([k, rings]) => ({ k, rings, bb: bbox(rings.flat()) }));
    $('base-hint').textContent = '전국CCTV표준데이터 · ' + idx.camsDate + ' 기준 · 서울 ' + idx.counts.cctvSites.toLocaleString() + '곳, 카메라 ' + idx.counts.cctvCameras.toLocaleString() + '대';
    refreshImportUI();
    if (IMPORTED && IMPORTED.length) { source = 'import'; $('src-import').checked = true; }
    const [x, y] = toXY(JONGNO.lat, JONGNO.lon); view.cx = x; view.cy = y;
    busy(null);
    locate(false);
  })
  .catch(err => { busy(null); $('verdict').textContent = '지도 데이터를 불러오지 못했어요 (' + err.message + '). 페이지를 새로고침해 주세요.'; });
})();
