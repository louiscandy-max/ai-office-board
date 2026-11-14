// AI 辦公樓看板：前端只讀取加密資料檔，於瀏覽器端以通關密語解密。
// 性別（Louis 2026-11-15 指定）：只有 CTO 與 Louis 為男性，其餘助理（PA、CoS、CLO、CPO、FP&A、IA、Admin、Kobe、Fly）皆為女性。
// Louis 不再以站立人物呈現，改為中央「主位」太極核心，顯示最後來訊時間。
const FLOORS = [
  { id: 'louis', g: 'm', name: 'Louis（總經理）', color: 0xb8995a },
  { id: 'pa', g: 'f',  name: 'Sr. PA Ai（私人資深特助）', color: 0x5f9e8a },
  { id: 'cos', g: 'f', name: 'CoS Ai（幕僚長）', color: 0xb8995a },
  { id: 'clo', g: 'f', name: 'CLO Ai（法務）', color: 0x6b7f99 },
  { id: 'cto', g: 'm', name: 'CTO Ai（技術長）', color: 0x3f6f8f },
  { id: 'cpo', g: 'f', name: 'CPO Ai（採購長）', color: 0x8a6a4a },
  { id: 'fpa', g: 'f', name: 'Sr. FP&A Analyst Ai（財務規劃）', color: 0x9a8a3a },
  { id: 'ia', g: 'f',  name: 'Sr. IA Ai（投資分析師）', color: 0xb5443a },
  { id: 'admin', g: 'f', name: 'Admin（特殊小組・Air 執行維運）', color: 0x4f7f6a },
  { id: 'kobe', g: 'f', name: 'Ai Kobe（特殊小組・個人事務）', color: 0xa0524a },
  { id: 'fly', g: 'f', name: 'Ai Fly（特殊小組・碳酸鋰預測）', color: 0xc9a13a },
];
const NO_DATA = '暫無數據';
const STATUS_TEXT = { done: '已完成', in_progress: '進行中', pending: '待處理' };
const LS_KEY = 'aiOfficeBoard.pass';
const $ = (s) => document.querySelector(s);

let people = null;
let encCache = null;
let liveEncCache = null;
let agentsEncCache = null;
let usage = { hermes: null, grok: null };
let building = null;
let meetings = [];
let louisActive = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const val = (v) => (has(v) ? esc(v) : `<span class="empty">${NO_DATA}</span>`);
const timeTag = (t) => `<span class="time">${has(t) ? esc(t) : NO_DATA}</span>`;
const emptyLine = `<p class="empty">${NO_DATA}</p>`;

function fmtTaipei(iso, withDate = true) {
  if (!has(iso)) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return withDate ? `${p.month}/${p.day} ${p.hour}:${p.minute}` : `${p.hour}:${p.minute}`;
}
function setUpdated(iso) {
  const t = fmtTaipei(iso);
  $('#updated').textContent = t ? `資料更新於 ${t}（台北時間）` : `資料更新於：${NO_DATA}`;
}
const setStatus = (m) => { $('#status').textContent = m || ''; };

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decrypt(enc, pass) {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(enc.salt), iterations: enc.iter || 600000 },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

function person(id) { return people && people[id] ? people[id] : null; }
const arr = (p, k) => (p && Array.isArray(p[k]) ? p[k] : []);

function isWorking(p) { return !!(p && arr(p, 'doing').length); }
function hasRecord(id) { return !!(people && people[id]); }

/** 只使用資料裡既有的數字，不臆造。優先 doing[].progress（0–100），否則 tasks 已完成／總數。 */
function progressOf(p) {
  if (!p) return { value: null };
  const nums = arr(p, 'doing').map((x) => x.progress).filter((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100);
  if (nums.length) return { value: Math.round(nums.reduce((a, b) => a + b, 0) / nums.length), source: 'doing' };
  const tasks = arr(p, 'tasks');
  if (tasks.length) {
    const done = tasks.filter((x) => x.status === 'done').length;
    return { value: Math.round((done / tasks.length) * 100), source: 'tasks', done, total: tasks.length };
  }
  return { value: null };
}

function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h;
}

function parseMeetings(raw) {
  if (!Array.isArray(raw)) return [];
  const known = new Set(FLOORS.map((f) => f.id));
  const out = [];
  for (const m of raw) {
    if (!m || !has(m.id) || !has(m.title)) continue;
    const pod = 'left'; // 右側會議艙已改為大型看板會議室，所有會議集中在左艙
    const members = [];
    const seen = new Set();
    for (const id of Array.isArray(m.members) ? m.members : []) {
      if (!known.has(id) || seen.has(id)) continue;
      seen.add(id); members.push(id);
    }
    if (members.length < 2) continue;
    out.push({ id: String(m.id), pod, title: String(m.title).trim(), members, since: has(m.since) ? String(m.since) : '', source: has(m.source) ? String(m.source) : '' });
  }
  return out;
}
function parseLouisActive(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.active !== 'boolean') return null;
  const o = { active: raw.active };
  if (has(raw.last_seen)) o.last_seen = String(raw.last_seen);
  if (has(raw.source)) o.source = String(raw.source);
  return o;
}
function meetingOf(id) {
  if (!id) return null;
  return meetings.find((m) => m.members.includes(id)) || null;
}
function louisState() {
  if (!people || !louisActive || typeof louisActive.active !== 'boolean') return 'unknown';
  return louisActive.active ? 'active' : 'idle';
}
function showProgressBar(id, p) {
  if (id === 'louis') return progressOf(p).value != null;
  return isWorking(p);
}
function progressBlock(p) {
  const pr = progressOf(p);
  if (pr.value == null) {
    return `<h3>進度</h3><div class="prog-wrap prog-unknown" role="img" aria-label="進度暫無數據"></div><p class="prog-label">進度暫無數據</p>`;
  }
  const note = pr.source === 'tasks' ? `（任務 ${pr.done}／${pr.total} 已完成）` : '';
  return `<h3>進度</h3><div class="prog-wrap" role="img" aria-label="進度 ${pr.value}%"><div class="prog-fill" style="width:${pr.value}%"></div></div><p class="prog-label">${pr.value}%${note}</p>`;
}
function statusHtml(id) {
  const p = person(id);
  const meet = meetingOf(id);
  const bits = [];
  if (meet) bits.push(`<h3>目前</h3><p class="status-meet">會議中：${esc(meet.title)}</p>`);
  else if (id === 'louis') {
    const st = louisState();
    if (st === 'active') {
      bits.push(`<h3>目前</h3><p class="status-work">工作中${louisActive && has(louisActive.last_seen) ? timeTag(louisActive.last_seen) : ''}</p>`);
      if (louisActive && has(louisActive.source)) bits.push(`<div class="src">來源：${esc(louisActive.source)}</div>`);
    } else if (st === 'idle') bits.push(`<h3>目前</h3><p class="status-rest">休息中</p>`);
    else bits.push(`<h3>目前</h3><p class="empty">${NO_DATA}</p>`);
  } else if (people && p && !isWorking(p)) {
    bits.push(`<h3>目前</h3><p class="status-rest">休息中</p>`);
  }
  if (showProgressBar(id, p)) bits.push(progressBlock(p));
  return bits.join('');
}

function render() {
  const doing = [], flow = [];
  const waits = [];
  for (const f of FLOORS) {
    const p = person(f.id);
    const d = arr(p, 'doing');
    const meet = meetingOf(f.id);
    const items = d.length ? `<ul>${d.map((x) => `<li>${val(x.text)}${timeTag(x.since)}</li>`).join('')}</ul>` : '';
    let body;
    if (meet) body = `<p class="status-meet">會議中：${esc(meet.title)}</p>${items}`;
    else if (f.id === 'louis') {
      const st = louisState();
      body = (st === 'active' ? '<p class="status-work">工作中</p>' : st === 'idle' ? '<p class="status-rest">休息中</p>' : emptyLine) + items;
    } else body = items || (people && p ? '<p class="status-rest">休息中</p>' : emptyLine);
    doing.push(`<div class="person f-${f.id === 'louis' ? 'x' : freshness(p)}"><h3>${esc(f.name)}</h3>${body}${updLine(f.id)}${chatLink(f.id)}</div>`);
    for (const w of arr(p, 'waiting_on_louis')) waits.push({ f, w });
    const t = arr(p, 'tasks');
    const order = { in_progress: 0, pending: 1, done: 2 };
    const ts = [...t].sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
    flow.push(`<div class="person"><h3>${esc(f.name)}</h3>${ts.length ? `<ul class="flow">${ts.map((x) => {
      const st = STATUS_TEXT[x.status] ? x.status : 'pending';
      return `<li class="${st}"><span class="tag ${st}">${STATUS_TEXT[x.status] || NO_DATA}</span>${val(x.title)}${timeTag(x.time)}</li>`;
    }).join('')}</ul>` : emptyLine}</div>`);
  }
  $('#doing').innerHTML = doing.join('');
  $('#flow').innerHTML = flow.join('');
  $('#waiting').innerHTML = waits.length
    ? waits.map(({ f, w }) => `<div class="wait-item"><b>${esc(f.name)}</b>：${val(w.text)}${timeTag(w.since)}<div class="src">來源：${val(w.source)}</div></div>`).join('')
    : emptyLine;
  $('#usage').innerHTML = usageHtml();
  const al = alertList();
  if ($('#alerts')) $('#alerts').innerHTML = al.length ? al.map((a) => `<div class="wait-item ${a.level}">${esc(a.text)}</div>`).join('') : emptyLine;
  if (building) building.update();
  const open = $('#detail').dataset.id;
  if (open && !$('#detail').hidden) showDetail(open);
}

const fmtTok = (n) => (typeof n === 'number' && Number.isFinite(n) ? new Intl.NumberFormat('zh-TW', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : NO_DATA);
const fmtPct = (n, lt1) => (lt1 ? '&lt;1%' : (typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * 10) / 10}%` : NO_DATA));
const shortTime = (iso) => fmtTaipei(iso) || NO_DATA;
/** 累計用量：Hermes 為真實 token；Grok Bot 只有週額度占比（非 token）。沒有就顯示暫無數據。 */
function usageHtml() {
  if (!people) return emptyLine;
  const rows = [];
  const h = usage.hermes;
  rows.push(`<h3>Air 特殊小組（真實詞元數）</h3>`);
  if (h && Array.isArray(h.profiles) && h.profiles.length) {
    for (const p of h.profiles) {
      const today = p.today && typeof p.today.total === 'number'
        ? `今日 ${fmtTok(p.today.total)}${has(p.today.since) && p.today.partial ? `（自 ${esc(shortTime(p.today.since))} 起）` : ''}` : `今日 ${NO_DATA}`;
      rows.push(`<div class="u-row"><span class="u-name">${esc(p.label || p.id)}</span><span class="u-val">累計 ${fmtTok(p.total)}｜${today}</span><span class="u-sub">輸入 ${fmtTok(p.input)}／輸出 ${fmtTok(p.output)}／快取讀取 ${fmtTok(p.cache_read)}</span></div>`);
    }
    rows.push(`<p class="src">來源：Air 端會話用量資料庫（唯讀），擷取 ${esc(shortTime(h.captured_at))}（台北時間）。累計＝輸入＋輸出（不含快取讀取）。</p>`);
  } else rows.push(emptyLine);
  const g = usage.grok;
  rows.push(`<h3>雲端助理（週額度占比，非詞元）</h3>`);
  if (g && g.shares) {
    rows.push(`<p class="u-head">本週額度已用 ${fmtPct(g.weekly_used_percent)}｜重設 ${esc(shortTime(g.week_reset))}｜擷取 ${esc(shortTime(g.captured_at))}</p>`);
    const lt1 = new Set(Array.isArray(g.lt1) ? g.lt1 : []);
    const cum = g.cumulative_points || {};
    for (const id of ['pa', 'cos', 'clo', 'cto', 'cpo', 'fpa', 'ia']) {
      const f = FLOORS.find((x) => x.id === id);
      const sh = g.shares[id];
      const w = typeof sh === 'number' ? Math.max(0, Math.min(100, sh)) : 0;
      const c = cum[id];
      rows.push(`<div class="u-row"><span class="u-name">${esc(f ? f.name.replace(/（.*$/, '') : id)}</span><span class="u-val">本週占比 ${typeof sh === 'number' ? fmtPct(sh, lt1.has(id)) : NO_DATA}｜累計估算 ${typeof c === 'number' ? `${Math.round(c * 10) / 10} 點` : NO_DATA}</span><span class="u-bar"><i style="width:${w}%"></i></span></div>`);
    }
    rows.push(`<p class="src">累計估算＝各額度週最後一筆「已用%×占比」加總，單位為週額度百分點，自 ${esc(shortTime(g.first_captured_at))} 起共 ${esc(g.weeks_counted)} 週；早期回填只列前幾名。</p>`);
  } else rows.push(emptyLine);
  return rows.join('');
}

function showDetail(id) {
  const f = FLOORS.find((x) => x.id === id);
  if (!f) return;
  const p = person(id);
  $('#detail').dataset.id = id;
  $('#detail-title').textContent = f.name;
  const list = (items, fn) => (items.length ? `<ul>${items.map(fn).join('')}</ul>` : emptyLine);
  $('#detail-body').innerHTML = `
    ${updLine(id)}${chatLink(id)}
    ${statusHtml(id)}
    <h3>正在做</h3>${list(arr(p, 'doing'), (x) => `<li>${val(x.text)}${timeTag(x.since)}</li>`)}
    <h3>等我回覆</h3>${list(arr(p, 'waiting_on_louis'), (x) => `<li>${val(x.text)}${timeTag(x.since)}<div class="src">來源：${val(x.source)}</div></li>`)}
    <h3>任務流</h3>${list(arr(p, 'tasks'), (x) => `<li><span class="tag ${STATUS_TEXT[x.status] ? x.status : 'pending'}">${STATUS_TEXT[x.status] || NO_DATA}</span>${val(x.title)}${timeTag(x.time)}</li>`)}`;
  $('#detail').hidden = false;
  if (building) building.select(id);
  $('#detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('#detail-close').addEventListener('click', () => {
  $('#detail').hidden = true; $('#detail').dataset.id = '';
  if (building) building.select(null);
});

function stampMs(s) {
  const t = Date.parse(s || '');
  return Number.isFinite(t) ? t : null;
}
const SRC_LABEL = { data: '夜間底稿', live: 'Air 即時', agents: '助理即時' };
const FILES = ['data', 'live', 'agents', 'directory'];
const REPO = 'louiscandy-max/ai-office-board';
const POLL_MS = 30000;
let pass = null, lastCheck = null, pollTimer = null, polling = false;
const encs = {}, plains = {}, fetchState = {};
let directory = null;

function shortName(f) { return f.name.replace(/（.*$/, ''); }
/** fresh：15 分鐘內；warm：2 小時內；old：更舊或來自夜間底稿；none：無資料 */
function freshness(p) {
  if (!p) return 'none';
  if (p._src === 'data') return 'old';
  const ms = stampMs(p._ts); if (ms == null) return 'old';
  const m = (Date.now() - ms) / 60000;
  return m <= 15 ? 'fresh' : m <= 120 ? 'warm' : 'old';
}
function ago(iso) {
  const ms = stampMs(iso); if (ms == null) return '';
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 1) return '剛剛'; if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60); return h < 48 ? `${h} 小時前` : `${Math.floor(h / 24)} 天前`;
}
function updLine(id) {
  if (id === 'louis') {
    if (!louisActive || !has(louisActive.last_seen)) return `<div class="upd none">最後活動：${NO_DATA}</div>`;
    return `<div class="upd">最後活動 ${esc(fmtTaipei(louisActive.last_seen))}（${esc(ago(louisActive.last_seen))}）・只記時間</div>`;
  }
  const p = person(id);
  if (!p) return `<div class="upd none">尚無任何回報</div>`;
  const f = freshness(p);
  return `<div class="upd ${f}"><i></i>更新 ${esc(fmtTaipei(p._ts) || NO_DATA)}（${esc(ago(p._ts))}）・${esc(SRC_LABEL[p._src] || '')}${p._src === 'data' ? '・非即時' : ''}</div>`;
}
function chatLink(id) {
  const d = directory && directory.people && directory.people[id];
  const url = d && d.chat;
  if (!url || !(/^grokbot:\/\//.test(url) || /^https:\/\/t\.me\//.test(url))) return '';
  return `<a class="chat" href="${esc(url)}">開啟對話</a>`;
}
function alertList() {
  const out = [];
  for (const n of ['data', 'live', 'agents']) if (fetchState[n] === 'error') out.push({ level: 'red', text: `${SRC_LABEL[n]}讀取失敗，畫面可能不是最新` });
  if (!people) return out;
  for (const f of FLOORS) for (const w of arr(person(f.id), 'waiting_on_louis')) out.push({ level: 'red', text: `${shortName(f)} 等你回覆：${w.text}` });
  for (const f of FLOORS) {
    const p = person(f.id);
    if (f.id !== 'louis' && p && isWorking(p) && freshness(p) === 'old') out.push({ level: 'amber', text: `${shortName(f)} 進度來自${p._src === 'data' ? '夜間底稿' : '2 小時前'}（${fmtTaipei(p._ts) || NO_DATA}），非即時` });
  }
  const none = FLOORS.filter((f) => f.id !== 'louis' && !person(f.id)).map(shortName);
  if (none.length) out.push({ level: 'amber', text: `尚無資料：${none.join('、')}` });
  if (usage.grok && typeof usage.grok.weekly_used_percent === 'number' && usage.grok.weekly_used_percent >= 80) out.push({ level: 'red', text: `助理本週額度已用 ${Math.round(usage.grok.weekly_used_percent)}%` });
  return out;
}

/** 合併：夜間底稿 ← Air 即時 ← 助理即時；每人以較新時間戳為準，記錄來源 _src 與時間 _ts。 */
function mergeAll() {
  const d = plains.data || {};
  const out = { updated_at: d.updated_at, people: [], meetings: Array.isArray(d.meetings) ? d.meetings : [], louis_active: d.louis_active || null };
  const by = {};
  for (const p of arr(d, 'people')) if (p && p.id) { by[p.id] = { ...p, _src: 'data', _ts: p.updated_at || d.updated_at }; }
  usage = { hermes: null, grok: null };
  for (const n of ['live', 'agents']) {
    const L = plains[n]; if (!L) continue;
    for (const lp of arr(L, 'people')) {
      if (!lp || !lp.id) continue;
      const ts = lp.updated_at || L.updated_at, cur = by[lp.id];
      const a = stampMs(ts), b = cur ? stampMs(cur._ts) : null;
      if (cur && b != null && (a == null || a < b)) continue;
      const m = { ...(cur || {}), id: lp.id, _src: n, _ts: ts };
      for (const k of ['doing', 'waiting_on_louis', 'tasks', 'name']) if (k in lp) m[k] = lp[k];
      by[lp.id] = m;
    }
    if (L.louis_active) {
      const cur = out.louis_active, a = stampMs(L.louis_active.last_seen), b = cur ? stampMs(cur.last_seen) : null;
      if (!cur || b == null || (a != null && a >= b)) out.louis_active = L.louis_active;
    }
    if (L.usage && L.usage.hermes) usage.hermes = L.usage.hermes;
    if (L.usage && L.usage.grok) usage.grok = L.usage.grok;
    if (stampMs(L.updated_at) > (stampMs(out.updated_at) || 0)) out.updated_at = L.updated_at;
  }
  out.people = Object.values(by);
  directory = plains.directory || null;
  return out;
}

function applyData(data) {
  people = {};
  for (const p of (data && Array.isArray(data.people) ? data.people : [])) if (p && p.id) people[p.id] = p;
  meetings = parseMeetings(data && data.meetings);
  louisActive = parseLouisActive(data && data.louis_active);
  setUpdated(data && data.updated_at);
  render();
}
function noData(msg) { people = null; meetings = []; louisActive = null; usage = { hermes: null, grok: null }; setUpdated(null); setStatus(msg); render(); }

/** 取得 main 最新 commit（API 以 ETag 重新驗證，304 不計入額度），再以 commit 固定網址讀 raw，避開 CDN 約 5 分鐘快取。 */
async function headSha() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, { cache: 'no-cache', headers: { Accept: 'application/vnd.github.sha' } });
    if (r.ok) { const t = (await r.text()).trim(); if (/^[0-9a-f]{40}$/.test(t)) return t; }
  } catch (e) { /* 改用備援 */ }
  return null;
}
async function fetchEnc(name, sha) {
  const t = Date.now();
  const urls = [];
  if (sha) urls.push(`https://raw.githubusercontent.com/${REPO}/${sha}/${name}.enc.json`);
  urls.push(`https://raw.githubusercontent.com/${REPO}/main/${name}.enc.json?t=${t}`, `${name}.enc.json?t=${t}`);
  let missing = false;
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: u.includes('?t=') ? 'no-store' : 'default' });
      if (r.status === 404) { missing = true; continue; }
      if (!r.ok) continue;
      const j = await r.json();
      if (j && j.ct) return { state: 'ok', json: j };
    } catch (e) { /* 下一個來源 */ }
  }
  return { state: missing ? 'missing' : 'error' };
}

async function poll(force) {
  if (polling || !pass) return;
  polling = true; $('#refresh').disabled = true;
  try {
    const sha = await headSha();
    const res = await Promise.all(FILES.map((n) => fetchEnc(n, sha)));
    let changed = false;
    for (let i = 0; i < FILES.length; i++) {
      const n = FILES[i], r = res[i];
      fetchState[n] = r.state;
      if (r.state !== 'ok') { if (r.state === 'missing' && plains[n]) { delete plains[n]; delete encs[n]; changed = true; } continue; }
      if (!force && encs[n] && encs[n].ct === r.json.ct) continue;
      try { plains[n] = await decrypt(r.json, pass); encs[n] = r.json; changed = true; }
      catch (e) { if (n === 'data') { lockOut('通關密語已變更，請重新輸入'); return; } }
    }
    lastCheck = new Date();
    if (changed || force) applyData(mergeAll()); else render();
    setStatus(plains.data ? '' : '讀取資料失敗，稍後自動重試');
    updateLive();
  } finally { polling = false; $('#refresh').disabled = false; }
}
function updateLive() {
  const el = $('#live'); if (!el) return;
  const bad = ['data', 'live', 'agents'].some((n) => fetchState[n] === 'error');
  el.className = `live ${!pass ? 'off' : bad ? 'warn' : 'on'}`;
  $('#live-text').textContent = !pass ? '尚未解鎖' : `即時更新中・每 30 秒檢查・上次 ${lastCheck ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(lastCheck) : '—'}`;
}
function lockOut(msg) {
  pass = null; if (pollTimer) clearInterval(pollTimer); pollTimer = null;
  for (const k of Object.keys(plains)) delete plains[k];
  for (const k of Object.keys(encs)) delete encs[k];
  directory = null;
  localStorage.removeItem(LS_KEY); sessionStorage.removeItem(LS_KEY);
  people = null; render(); updateLive();
  $('#gate').hidden = false; $('#lock').hidden = true; setStatus(msg || '需要通關密語才能查看內容'); $('#pass').focus();
}

async function tryUnlock(pw, remember) {
  const r = await fetchEnc('data', await headSha());
  if (r.state !== 'ok') { setStatus('目前讀不到資料檔，稍後再試'); return false; }
  try { plains.data = await decrypt(r.json, pw); encs.data = r.json; } catch (e) { return false; }
  pass = pw;
  if (remember) localStorage.setItem(LS_KEY, pw);
  sessionStorage.setItem(LS_KEY, pw);
  $('#gate').hidden = true; $('#lock').hidden = false; setStatus('');
  applyData(mergeAll());
  await poll(true);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') poll(false); }, POLL_MS);
  return true;
}

async function load() {
  render(); updateLive();
  const saved = sessionStorage.getItem(LS_KEY) || localStorage.getItem(LS_KEY);
  if (saved && await tryUnlock(saved, false)) return;
  if (saved) { localStorage.removeItem(LS_KEY); sessionStorage.removeItem(LS_KEY); }
  people = null; render();
  setStatus('需要通關密語才能查看內容');
  $('#gate').hidden = false; $('#pass').focus();
}

$('#gate-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('#gate-msg').textContent = '解密中…';
  const ok = await tryUnlock($('#pass').value, $('#remember').checked);
  $('#gate-msg').textContent = ok ? '' : '通關密語不正確';
  if (ok) $('#pass').value = '';
});
$('#refresh').addEventListener('click', () => (pass ? poll(true) : load()));
$('#lock').addEventListener('click', () => { lockOut(''); location.reload(); });
$('#to-board').addEventListener('click', () => { if (building && building.focusBoard) { building.focusBoard(); $('#building').scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
$('#to-all').addEventListener('click', () => { if (building && building.focusAll) building.focusAll(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && pass) poll(false); });
setInterval(() => { if (pass && people) render(); }, 60000);

// ---------- 三維太極辦公層（同一層、圓形對稱） ----------
// 左半為陽（個人側），右半為陰（公司側）；中央為 Louis 主位（太極核心），後方為全員即時看板牆。
const CZ = 0.2;          // 圓心 z
const RING_R = 5.7;      // 工位所在圓半徑
const PLAT_R = 7.6;      // 圓形平台半徑
const SEAT_DEG = { ia: -28, pa: -62, admin: -98, kobe: -131, fly: -163, clo: 28, cos: 62, cto: 98, cpo: 131, fpa: 163 };
const TAG = {
  louis: ['Louis', '總經理'], pa: ['PA', '私人特助'], cos: ['CoS', '幕僚長'], clo: ['CLO', '法務'], cto: ['CTO', '技術長'],
  cpo: ['CPO', '採購長'], fpa: ['FP&A', '財務規劃'], ia: ['IA', '投資分析'], admin: ['Admin', '執行維運'], kobe: ['Kobe', '個人事務'], fly: ['Fly', '碳酸鋰預測'],
};
const PERSONAL = new Set(['pa', 'ia', 'admin', 'kobe', 'fly']);
const INK = 0x2f2d2a, PAPER = 0xf1ede4, GOLD = 0xb8995a, JADE = 0x5f9e8a, CINNABAR = 0xb5443a;
const BOARD = { x: 0, y: 2.95, z: -9.25, w: 7.6, h: 4.75 };
const DS = 1.22; // 工位與人物放大倍率

async function initBuilding() {
  const el = $('#building');
  try {
    const THREE = await import('three');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe9e5dc);
    scene.fog = new THREE.Fog(0xe9e5dc, 34, 70);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.enablePan = false;
    controls.minDistance = 3; controls.maxDistance = 46;
    controls.maxPolarAngle = Math.PI * 0.5; // 允許水平視角，看板模式才能正對不變形
    controls.autoRotateSpeed = 0.4;
    scene.add(new THREE.HemisphereLight(0xfffdf6, 0x8a8478, 1.25));
    const sun = new THREE.DirectionalLight(0xfff8ec, 1.1); sun.position.set(5, 16, 12); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xe6eef0, 0.45); fill.position.set(-9, 8, -6); scene.add(fill);

    const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
    const box = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; };
    const cyl = (rt, rb, h, mat, x, y, z, parent, seg = 24) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.position.set(x, y, z); parent.add(m); return m; };
    const SANS = '"PingFang TC","Noto Sans CJK TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
    const SERIF = '"Songti TC","Noto Serif CJK TC","Noto Serif TC","PMingLiU",serif';
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    const canvasTex = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
    function fitText(c, text, max, size, weight, font = SANS) {
      let s = size;
      do { c.font = `${weight} ${s}px ${font}`; s -= 2; } while (c.measureText(text).width > max && s > 14);
    }
    const P = (deg, r = RING_R) => { const a = deg * Math.PI / 180; return { x: r * Math.sin(a), z: CZ + r * Math.cos(a) }; };

    // 太極圖（canvas）：左白右黑，上方白魚頭、下方黑魚頭
    function drawTaiji(c, cx, cy, r, light, dark) {
      c.fillStyle = light; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
      c.fillStyle = dark; c.beginPath(); c.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2); c.closePath(); c.fill();
      c.fillStyle = light; c.beginPath(); c.arc(cx, cy - r / 2, r / 2, 0, Math.PI * 2); c.fill();
      c.fillStyle = dark; c.beginPath(); c.arc(cx, cy + r / 2, r / 2, 0, Math.PI * 2); c.fill();
      c.fillStyle = dark; c.beginPath(); c.arc(cx, cy - r / 2, r / 7, 0, Math.PI * 2); c.fill();
      c.fillStyle = light; c.beginPath(); c.arc(cx, cy + r / 2, r / 7, 0, Math.PI * 2); c.fill();
    }
    function inkWash(c, W, H, n, alpha) {
      for (let i = 0; i < n; i++) {
        const x = Math.random() * W, y = Math.random() * H, r = 40 + Math.random() * W * 0.18;
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(60,58,54,${alpha})`); g.addColorStop(1, 'rgba(60,58,54,0)');
        c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    const flat = (mesh, y) => { mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; return mesh; };

    // 外圍石板地
    {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
      const c = cv.getContext('2d');
      c.fillStyle = '#dedad0'; c.fillRect(0, 0, 512, 512);
      inkWash(c, 512, 512, 18, 0.05);
      c.strokeStyle = 'rgba(80,74,64,.16)'; c.lineWidth = 2;
      for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(0, i * 128); c.lineTo(512, i * 128); c.stroke(); c.beginPath(); c.moveTo(i * 128, 0); c.lineTo(i * 128, 512); c.stroke(); }
      const tex = canvasTex(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(5.5, 5.5);
      const fl = new THREE.Mesh(new THREE.BoxGeometry(23, 0.3, 21.4), M(0xffffff, { map: tex, roughness: 0.9 }));
      fl.position.set(0, -0.15, -0.2); scene.add(fl);
      box(23.2, 0.12, 21.6, M(0x4a443c), 0, -0.3, -0.2, scene);
    }
    // 圓形太極平台
    {
      const S = 2048, cv = document.createElement('canvas'); cv.width = cv.height = S;
      const c = cv.getContext('2d');
      drawTaiji(c, S / 2, S / 2, S / 2 - 4, '#f2eee5', '#383531');
      inkWash(c, S, S, 46, 0.045);
      // 細金圈
      c.strokeStyle = 'rgba(184,153,90,.9)'; c.lineWidth = 10;
      c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 12, 0, Math.PI * 2); c.stroke();
      c.lineWidth = 4; c.strokeStyle = 'rgba(184,153,90,.55)';
      c.beginPath(); c.arc(S / 2, S / 2, (S / 2) * (RING_R - 0.95) / PLAT_R, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(S / 2, S / 2, (S / 2) * (RING_R + 0.95) / PLAT_R, 0, Math.PI * 2); c.stroke();
      // 八卦（環繞主位）
      const TRI = [[1, 1, 1], [0, 1, 1], [1, 0, 1], [0, 0, 1], [1, 1, 0], [0, 1, 0], [1, 0, 0], [0, 0, 0]];
      const rr = (S / 2) * 2.55 / PLAT_R;
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        c.save(); c.translate(S / 2 + Math.sin(a) * rr, S / 2 - Math.cos(a) * rr); c.rotate(a);
        c.fillStyle = 'rgba(184,153,90,.95)';
        TRI[i].forEach((yang, k) => {
          const y = -34 + k * 30;
          if (yang) c.fillRect(-58, y, 116, 16); else { c.fillRect(-58, y, 50, 16); c.fillRect(8, y, 50, 16); }
        });
        c.restore();
      }
      const tex = canvasTex(cv);
      const plat = cyl(PLAT_R, PLAT_R + 0.08, 0.14, [M(0x6b6255), M(0xffffff, { map: tex, roughness: 0.82 }), M(0x6b6255)], 0, 0.07, CZ, scene, 96);
      plat.material = [M(0x7a7062, { roughness: 0.8 }), M(0xffffff, { map: tex, roughness: 0.82 }), M(0x7a7062)];
    }
    const TOP = 0.14; // 平台頂面高度

    // 竹林（四周點綴）
    const bamboos = [];
    const stalkMat = M(0x6f9a5a, { roughness: 0.55 }), nodeMat = M(0x4f7a40), leafMat = M(0x5d8c4a, { roughness: 0.8, side: THREE.DoubleSide });
    function addBamboo(x, z, n = 5, h = 3.2) {
      const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
      cyl(0.42, 0.48, 0.32, M(0x3a3632), 0, 0.16, 0, g, 20);
      cyl(0.4, 0.4, 0.02, M(0xcfc8b8), 0, 0.33, 0, g, 20);
      for (let i = 0; i < n; i++) {
        const a = i * 2.4, r = 0.12 + (i % 3) * 0.09, hh = h * (0.75 + ((i * 37) % 10) / 40);
        const s = new THREE.Group(); s.position.set(Math.cos(a) * r, 0.33, Math.sin(a) * r); s.rotation.z = (Math.cos(a) * 0.07); s.rotation.x = Math.sin(a) * 0.07; g.add(s);
        cyl(0.035, 0.04, hh, stalkMat, 0, hh / 2, 0, s, 8);
        for (let y = 0.45; y < hh; y += 0.45) cyl(0.045, 0.045, 0.03, nodeMat, 0, y, 0, s, 8);
        for (let k = 0; k < 5; k++) {
          const lf = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.34), leafMat);
          lf.position.set(Math.cos(k * 1.3) * 0.12, hh - 0.3 - k * 0.18, Math.sin(k * 1.3) * 0.12);
          lf.rotation.set(0.9, k * 1.3, 0.6); s.add(lf);
        }
      }
      bamboos.push({ g, ph: Math.random() * 6 });
    }
    // 石燈（圓燈）
    function addLantern(x, z) {
      const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
      cyl(0.16, 0.2, 0.1, M(0x8a8478), 0, 0.05, 0, g, 12);
      cyl(0.05, 0.06, 0.55, M(0x8a8478), 0, 0.37, 0, g, 10);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), M(0xfff6e2, { emissive: 0xffe9bf, emissiveIntensity: 0.55, roughness: 0.4 }));
      ball.position.y = 0.84; g.add(ball);
      cyl(0.22, 0.12, 0.06, M(0x3a3632), 0, 1.06, 0, g, 12);
    }

    // ---------- 全員即時看板牆（正面平放，不傾斜） ----------
    const bigCv = document.createElement('canvas'); bigCv.width = 2048; bigCv.height = 1280;
    const bigTex = canvasTex(bigCv);
    {
      const wz = BOARD.z - 0.14;
      box(11.6, 0.3, 0.9, M(0x3a3632), 0, 0.15, wz, scene);
      box(11.2, 6.1, 0.22, M(0x22201d, { roughness: 0.85 }), 0, 3.35, wz, scene);
      box(11.4, 0.1, 0.3, M(GOLD, { metalness: 0.6, roughness: 0.35 }), 0, 6.45, wz, scene);
      box(11.4, 0.06, 0.28, M(GOLD, { metalness: 0.6, roughness: 0.35 }), 0, 0.32, wz + 0.02, scene);
      // 螢幕金框與畫面
      box(BOARD.w + 0.22, BOARD.h + 0.22, 0.08, M(GOLD, { metalness: 0.55, roughness: 0.35 }), BOARD.x, BOARD.y, BOARD.z - 0.02, scene);
      box(BOARD.w + 0.08, BOARD.h + 0.08, 0.09, M(0x0d0d0c), BOARD.x, BOARD.y, BOARD.z - 0.01, scene);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.w, BOARD.h), new THREE.MeshBasicMaterial({ map: bigTex, toneMapped: false }));
      screen.position.set(BOARD.x, BOARD.y, BOARD.z + 0.04); scene.add(screen);
      // 兩側對聯
      for (const [x, text] of [[-4.75, '道法自然'], [4.75, '厚德載物']]) {
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 1024;
        const c = cv.getContext('2d');
        c.fillStyle = '#efe8d8'; c.fillRect(0, 0, 256, 1024);
        inkWash(c, 256, 1024, 8, 0.05);
        c.strokeStyle = '#b8995a'; c.lineWidth = 8; c.strokeRect(14, 14, 228, 996);
        c.fillStyle = '#26231f'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `bold 150px ${SERIF}`;
        [...text].forEach((ch, i) => c.fillText(ch, 128, 150 + i * 240));
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 3.6), new THREE.MeshStandardMaterial({ map: canvasTex(cv), roughness: 0.9 }));
        m.position.set(x, 3.15, wz + 0.12); scene.add(m);
      }
      addBamboo(-6.4, wz + 0.55, 6, 3.6); addBamboo(6.4, wz + 0.55, 6, 3.6);
    }

    // ---------- 中央主位：太極核心（Louis） ----------
    const core = new THREE.Group(); core.position.set(0, TOP, CZ); scene.add(core);
    cyl(1.62, 1.72, 0.16, M(0x2a2825, { roughness: 0.6 }), 0, 0.08, 0, core, 64);
    cyl(1.5, 1.58, 0.12, M(GOLD, { metalness: 0.55, roughness: 0.35 }), 0, 0.2, 0, core, 64);
    const coreTop = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1024;
      const c = cv.getContext('2d');
      drawTaiji(c, 512, 512, 506, '#f7f4ec', '#1c1b19');
      const m = new THREE.Mesh(new THREE.CircleGeometry(1.46, 64), new THREE.MeshStandardMaterial({ map: canvasTex(cv), roughness: 0.35, metalness: 0.05 }));
      flat(m, 0.265); core.add(m); return m;
    })();
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x7fd1b5, transparent: true, opacity: 0.0, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.RingGeometry(1.78, 2.2, 96), glowMat); flat(glow, 0.03); core.add(glow);
    const haloMat = new THREE.MeshStandardMaterial({ color: JADE, emissive: 0x6fd0ae, emissiveIntensity: 0.0, roughness: 0.3, metalness: 0.2 });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.67, 0.035, 10, 120), haloMat); halo.rotation.x = Math.PI / 2; halo.position.y = 0.28; core.add(halo);
    // 主位名牌
    const coreCv = document.createElement('canvas'); coreCv.width = 640; coreCv.height = 260;
    const coreTex = canvasTex(coreCv);
    const coreSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: coreTex, depthTest: false, transparent: true }));
    coreSpr.scale.set(2.7, 1.1, 1); coreSpr.position.set(0, TOP + 1.7, CZ); coreSpr.renderOrder = 11; scene.add(coreSpr);
    for (const m of [coreTop, glow, halo, coreSpr]) m.userData.id = 'louis';

    // ---------- 工位（面向中央主位） ----------
    // 弧形桌面（環形扇面擠出）
    const deskGeo = (() => {
      const sh = new THREE.Shape(), a0 = -0.62, a1 = 0.62, ri = 0.64, ro = 1.08;
      sh.absarc(0, 0, ro, Math.PI / 2 - a1, Math.PI / 2 - a0, false);
      sh.absarc(0, 0, ri, Math.PI / 2 - a0, Math.PI / 2 - a1, true);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.015, bevelSegments: 2, curveSegments: 24 });
      g.rotateX(Math.PI / 2); // 形狀平面轉為水平：形狀 +y 對應 +z（朝向螢幕與中央）
      return g;
    })();
    const DESK_DARK = M(0x2b2825, { roughness: 0.45 }), DESK_LIGHT = M(0xe9e3d6, { roughness: 0.5 });
    function makeLabel() {
      const cv = document.createElement('canvas'); cv.width = 560; cv.height = 300;
      const tex = canvasTex(cv);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      spr.renderOrder = 10;
      return { cv, tex, spr };
    }
    function makeAvatar(gender, outfit, accent, light) {
      const g = new THREE.Group();
      const rig = new THREE.Group(); g.add(rig);
      const skin = M(0xf0d4b6, { roughness: 0.6 });
      const hairMat = M(0x1d1916, { roughness: 0.75, side: THREE.DoubleSide });
      const cloth = M(outfit, { roughness: 0.75 });
      const accentMat = M(accent, { roughness: 0.4, metalness: 0.2 });
      const legMat = gender === 'f' ? M(light ? 0x4a423c : 0x3b3530) : cloth;
      const shoeMat = M(light ? 0x6a5f55 : 0x151413);
      const hip = new THREE.Group(); hip.position.y = 0.72; rig.add(hip);
      const legs = [];
      for (const sx of [-0.085, 0.085]) {
        const thigh = new THREE.Group(); thigh.position.x = sx; hip.add(thigh);
        const tw = gender === 'f' ? 0.085 : 0.115;
        box(tw, 0.38, tw + 0.01, legMat, 0, -0.19, 0, thigh);
        const knee = new THREE.Group(); knee.position.y = -0.38; thigh.add(knee);
        box(tw - 0.01, 0.32, tw, legMat, 0, -0.16, 0, knee);
        box(0.1, 0.05, 0.19, shoeMat, 0, -0.33, 0.035, knee);
        legs.push({ thigh, knee });
      }
      const upper = new THREE.Group(); hip.add(upper);
      const torso = new THREE.Mesh(gender === 'f' ? new THREE.CylinderGeometry(0.145, 0.17, 0.5, 18) : new THREE.CylinderGeometry(0.19, 0.18, 0.52, 18), cloth);
      torso.position.y = 0.26; upper.add(torso);
      // 腰帶（點綴色）
      const belt = new THREE.Mesh(new THREE.TorusGeometry(gender === 'f' ? 0.165 : 0.183, 0.022, 6, 24), accentMat); belt.rotation.x = Math.PI / 2; belt.position.y = 0.04; upper.add(belt);
      let skirt = null, lap = null;
      if (gender === 'f') {
        skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.33, 0.44, 22, 1, true), M(outfit, { roughness: 0.75, side: THREE.DoubleSide }));
        skirt.position.y = -0.2; hip.add(skirt);
        lap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.44), M(outfit, { roughness: 0.75 })); lap.position.set(0, -0.02, 0.17); lap.visible = false; hip.add(lap);
        const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.12, 22, 1, true), M(outfit, { roughness: 0.75, side: THREE.DoubleSide })); hem.position.y = -0.03; hip.add(hem);
      } else {
        box(0.16, 0.2, 0.02, M(0xf7f5f0), 0, 0.42, 0.172, upper);
        box(0.045, 0.3, 0.02, accentMat, 0, 0.3, 0.19, upper);
        box(0.06, 0.05, 0.022, accentMat, 0, 0.45, 0.188, upper);
      }
      cyl(0.05, 0.055, 0.08, skin, 0, 0.55, 0, upper, 10);
      const head = new THREE.Group(); head.position.y = 0.72; upper.add(head);
      const face = new THREE.Mesh(new THREE.SphereGeometry(0.155, 20, 16), skin); face.scale.set(1, 1.08, 1); head.add(face);
      for (const ex of [-0.055, 0.055]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), M(0x111111)); e.position.set(ex, 0.015, 0.145); head.add(e); }
      if (gender === 'f') {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.172, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat); cap.position.y = 0.012; head.add(cap);
        const back = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.5, 20, 1, true, Math.PI * 0.42, Math.PI * 1.16), hairMat);
        back.position.y = -0.2; head.add(back);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 8, Math.PI * 0.42, Math.PI * 1.16, Math.PI * 0.5, Math.PI * 0.5), hairMat); tip.scale.set(1, 0.35, 1); tip.position.y = -0.45; head.add(tip);
      } else {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.167, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.4), hairMat); cap.position.y = 0.02; head.add(cap);
        const nape = new THREE.Mesh(new THREE.SphereGeometry(0.163, 16, 10, Math.PI * 0.6, Math.PI * 0.8, Math.PI * 0.35, Math.PI * 0.25), hairMat); head.add(nape);
      }
      const arms = [];
      for (const sx of [-1, 1]) {
        const sh = new THREE.Group(); sh.position.set(sx * (gender === 'f' ? 0.19 : 0.235), 0.47, 0); upper.add(sh);
        box(0.075, 0.25, 0.08, cloth, 0, -0.12, 0, sh);
        const el2 = new THREE.Group(); el2.position.y = -0.25; sh.add(el2);
        box(0.068, 0.22, 0.072, cloth, 0, -0.1, 0, el2);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), skin); hand.position.y = -0.23; el2.add(hand);
        arms.push({ sh, el: el2 });
      }
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.06, 10), M(0xf2efe8)); cup.position.set(0, -0.27, 0.03); cup.visible = false; arms[1].el.add(cup);
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.14), M(0x7a2e26)); book.position.set(-0.1, -0.26, 0.05); book.visible = false; arms[1].el.add(book);
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }));
      flat(shadow, 0.012); g.add(shadow);
      return { g, rig, hip, upper, head, legs, arms, skirt, lap, cup, book, shadow, parts: [torso, face] };
    }

    const desks = [];
    for (const f of FLOORS) {
      if (f.id === 'louis' || SEAT_DEG[f.id] == null) continue;
      const deg = SEAT_DEG[f.id], pos = P(deg), yaw = deg * Math.PI / 180 + Math.PI;
      const yang = PERSONAL.has(f.id); // 左半陽：深色家具；右半陰：淺色家具
      const g = new THREE.Group(); g.position.set(pos.x, TOP, pos.z); g.rotation.y = yaw; g.scale.setScalar(DS); scene.add(g);
      const lead = f.id === 'pa' || f.id === 'cos';
      // 圓形座席墊
      const matMat = new THREE.MeshStandardMaterial({ color: yang ? 0xe4ddcf : 0x46423c, roughness: 0.9, emissive: JADE, emissiveIntensity: 0 });
      const mat = new THREE.Mesh(new THREE.CircleGeometry(lead ? 1.25 : 1.12, 48), matMat); flat(mat, 0.01); g.add(mat);
      const rim = new THREE.Mesh(new THREE.RingGeometry(lead ? 1.22 : 1.09, lead ? 1.27 : 1.14, 64), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.7 })); flat(rim, 0.015); g.add(rim);
      const dm = yang ? DESK_DARK : DESK_LIGHT;
      // 弧形桌（以圓柱片段做成）
      const top = new THREE.Mesh(deskGeo, dm); top.position.set(0, 0.77, -0.55); g.add(top);
      const front = new THREE.Mesh(new THREE.CylinderGeometry(1.04, 1.04, 0.42, 32, 1, true, -0.6, 1.2), new THREE.MeshStandardMaterial({ color: yang ? 0x24221f : 0xdcd5c6, roughness: 0.5, side: THREE.DoubleSide }));
      front.position.set(0, 0.54, -0.55); g.add(front);
      for (const sx of [-0.55, 0.55]) box(0.04, 0.33, 0.04, M(GOLD, { metalness: 0.5, roughness: 0.4 }), sx, 0.165, 0.33, g);
      box(0.9, 0.025, 0.02, M(GOLD, { metalness: 0.5, roughness: 0.4 }), 0, 0.72, 0.5, g);
      // 螢幕
      const scrMat = new THREE.MeshStandardMaterial({ color: 0x101010, emissive: 0x9fe0c8, emissiveIntensity: 0.05, roughness: 0.3 });
      box(0.72, 0.42, 0.03, M(yang ? 0x1a1917 : 0xcfc8b8), 0, 1.06, 0.36, g);
      const scr = box(0.66, 0.36, 0.01, scrMat, 0, 1.06, 0.345, g); scr.rotation.y = Math.PI;
      box(0.05, 0.22, 0.05, M(GOLD, { metalness: 0.5, roughness: 0.4 }), 0, 0.86, 0.38, g);
      // 桌燈（工作中亮起）
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffe2a8, emissiveIntensity: 0.1 }));
      lamp.position.set(0.5, 0.86, 0.3); g.add(lamp);
      cyl(0.05, 0.06, 0.06, M(GOLD, { metalness: 0.5 }), 0.5, 0.78, 0.3, g, 10);
      // 圓凳椅
      cyl(0.24, 0.24, 0.08, M(yang ? 0x3a3632 : 0xd8d0c0), 0, 0.46, -0.42, g, 20);
      cyl(0.04, 0.05, 0.42, M(0x6b6255), 0, 0.22, -0.42, g, 8);
      const chairMat = M(yang ? 0x3a3632 : 0xd8d0c0);
      const back = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.26, 20, 1, true, Math.PI * 0.7, Math.PI * 0.6), new THREE.MeshStandardMaterial({ color: yang ? 0x3a3632 : 0xd8d0c0, roughness: 0.7, side: THREE.DoubleSide })); back.position.set(0, 0.74, -0.42); g.add(back);
      for (const sx of [-0.2, 0.2]) box(0.03, 0.3, 0.03, chairMat, sx, 0.6, -0.6, g);
      const outfit = yang ? 0x2e2c2a : 0xf0ebe0;
      const av = makeAvatar(f.g, outfit, f.color, !yang);
            scene.add(av.g);
      const label = makeLabel();
      label.spr.position.set(pos.x, 2.55, pos.z); scene.add(label.spr);
      const hits = [mat, top, front, label.spr, ...av.parts];
      hits.forEach((m) => { m.userData.id = f.id; });
      desks.push({ f, deg, pos, yaw, g, lead, yang, matMat, scrMat, lamp, av, label, hits, slot: null, atDesk: true, working: false, phase: (hashId(f.id) % 1000) / 160 });
    }
    // 座位世界座標（椅子處）
    const seatWorld = (d) => { const a = d.yaw; const lx = 0, lz = -0.42 * DS; return { x: d.pos.x + lx * Math.cos(a) + lz * Math.sin(a), z: d.pos.z - lx * Math.sin(a) + lz * Math.cos(a) }; };

    // ---------- 四隅：圓桌會議（左後）、書房（右後）、茶席（左前）、太極場（右前） ----------
    const MEET = { x: -8.6, z: -6.4 };
    {
      const g = new THREE.Group(); g.position.set(MEET.x, 0, MEET.z); scene.add(g);
      const rug = new THREE.Mesh(new THREE.CircleGeometry(1.75, 48), M(0xcfc6b4, { roughness: 0.95 })); flat(rug, 0.012); g.add(rug);
      cyl(0.85, 0.85, 0.07, M(0x2b2825, { roughness: 0.4 }), 0, 0.74, 0, g, 40);
      cyl(0.1, 0.18, 0.7, M(0x2b2825), 0, 0.36, 0, g, 12);
      const yy = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), new THREE.MeshStandardMaterial({ map: coreTop.material.map, roughness: 0.4 })); flat(yy, 0.78); g.add(yy);
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; cyl(0.2, 0.2, 0.08, M(0x6b6255), Math.sin(a) * 1.2, 0.46, Math.cos(a) * 1.2, g, 16); cyl(0.04, 0.05, 0.42, M(0x3a3632), Math.sin(a) * 1.2, 0.21, Math.cos(a) * 1.2, g, 8); }
    }
    const MEET_SEATS = Array.from({ length: 6 }, (_, i) => { const a = i * Math.PI / 3 + Math.PI / 6; return { type: 'meet', x: MEET.x + Math.sin(a) * 1.2, z: MEET.z + Math.cos(a) * 1.2, yaw: a + Math.PI }; });
    const meetCv = document.createElement('canvas'); meetCv.width = 560; meetCv.height = 220;
    const meetTex = canvasTex(meetCv);
    const meetSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: meetTex, depthTest: false, transparent: true }));
    meetSpr.scale.set(2.3, 0.9, 1); meetSpr.position.set(MEET.x, 2.3, MEET.z); meetSpr.renderOrder = 9; scene.add(meetSpr);
    const signs = [];
    function cornerSign(text, x, z, y = 1.7) {
      const cv = document.createElement('canvas'); cv.width = 420; cv.height = 140;
      const c = cv.getContext('2d');
      c.fillStyle = 'rgba(242,238,229,.95)'; c.beginPath(); c.roundRect(6, 6, 408, 128, 20); c.fill();
      c.strokeStyle = '#b8995a'; c.lineWidth = 5; c.stroke();
      c.fillStyle = '#2a2723'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, text, 380, 76, 'bold', SERIF); c.fillText(text, 210, 74);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(cv), transparent: true, depthTest: false }));
      s.scale.set(1.5, 0.5, 1); s.position.set(x, y, z); s.renderOrder = 8; scene.add(s); signs.push(s);
    }
    // 書房
    const READ = { x: 8.6, z: -6.4 };
    {
      const g = new THREE.Group(); g.position.set(READ.x, 0, READ.z); scene.add(g);
      const rug = new THREE.Mesh(new THREE.CircleGeometry(1.75, 48), M(0xcfc6b4, { roughness: 0.95 })); flat(rug, 0.012); g.add(rug);
      const sg = new THREE.Group(); sg.position.set(0.2, 0, -1.35); g.add(sg);
      const wood = M(0x5a4636);
      for (const y of [0.05, 0.6, 1.15, 1.7]) box(2.2, 0.05, 0.36, wood, 0, y, 0, sg);
      for (const x of [-1.1, 0, 1.1]) box(0.05, 1.72, 0.36, wood, x, 0.86, 0, sg);
      const bookCols = [0x7a2e26, 0x2e3a4a, 0xb8995a, 0x3a5a4a, 0xe9e3d6, 0x2b2825];
      for (let r = 0; r < 3; r++) for (let i = 0; i < 9; i++) box(0.09, 0.32 + ((i * 7 + r) % 4) * 0.03, 0.24, M(bookCols[(i + r) % 6]), -1.0 + i * 0.12 + (i > 4 ? 0.2 : 0), 0.25 + r * 0.55 + ((i * 7 + r) % 4) * 0.015, 0, sg);
      for (const [x, z, r] of [[-0.85, 0.2, 0.5], [0.95, 0.3, -0.5]]) {
        const ch = new THREE.Group(); ch.position.set(x, 0, z); ch.rotation.y = r; g.add(ch);
        box(0.62, 0.36, 0.6, M(0x8a7a66, { roughness: 0.9 }), 0, 0.2, 0, ch); box(0.62, 0.42, 0.12, M(0x8a7a66), 0, 0.55, -0.26, ch);
      }
    }
    const READ_SEATS = [{ type: 'read', x: READ.x - 0.85, z: READ.z + 0.25, yaw: 0.5 }, { type: 'read', x: READ.x + 0.95, z: READ.z + 0.35, yaw: -0.5 }];
    // 茶席
    const TEA = { x: -8.6, z: 6.4 };
    {
      const g = new THREE.Group(); g.position.set(TEA.x, 0, TEA.z); scene.add(g);
      box(3.2, 0.06, 2.6, M(0xc9bc9c, { roughness: 0.95 }), 0, 0.03, 0, g);
      for (let i = 0; i < 6; i++) box(3.2, 0.005, 0.02, M(0x9a8a6a), 0, 0.065, -1.3 + i * 0.52, g);
      box(1.0, 0.06, 0.62, M(0x3a2c22, { roughness: 0.4 }), 0, 0.34, 0, g);
      for (const [x, z] of [[-0.42, -0.25], [0.42, -0.25], [-0.42, 0.25], [0.42, 0.25]]) box(0.06, 0.28, 0.06, M(0x3a2c22), x, 0.17, z, g);
      cyl(0.08, 0.1, 0.12, M(0x6b4a3a), 0, 0.43, 0, g, 12);
      for (const x of [-0.25, 0.22, 0.3]) cyl(0.03, 0.025, 0.04, M(0xf2efe8), x, 0.39, x > 0.25 ? 0.15 : -0.12, g, 8);
      for (const [x, z] of [[0, -0.75], [-0.95, 0.15], [0.95, 0.15], [0, 0.85]]) cyl(0.25, 0.27, 0.08, M(0x7a2e26, { roughness: 0.9 }), x, 0.1, z, g, 16);
    }
    const TEA_SEATS = [
      { type: 'tea', x: TEA.x, z: TEA.z - 0.75, yaw: 0 }, { type: 'tea', x: TEA.x - 0.95, z: TEA.z + 0.15, yaw: Math.PI / 2 },
      { type: 'tea', x: TEA.x + 0.95, z: TEA.z + 0.15, yaw: -Math.PI / 2 },
    ];
    // 太極場
    const TAI = { x: 8.6, z: 6.4 };
    {
      const cv = document.createElement('canvas'); cv.width = cv.height = 512;
      const c = cv.getContext('2d'); c.fillStyle = '#d9d2c3'; c.fillRect(0, 0, 512, 512);
      c.globalAlpha = 0.22; drawTaiji(c, 256, 256, 200, '#ffffff', '#2a2723'); c.globalAlpha = 1;
      const m = new THREE.Mesh(new THREE.CircleGeometry(1.75, 48), new THREE.MeshStandardMaterial({ map: canvasTex(cv), roughness: 0.95 })); flat(m, 0.015); m.position.set(TAI.x, 0.015, TAI.z); scene.add(m);
    }
    const TAI_SEATS = [{ type: 'taichi', x: TAI.x - 0.95, z: TAI.z - 0.45, yaw: 0 }, { type: 'taichi', x: TAI.x + 0.95, z: TAI.z - 0.45, yaw: 0 }, { type: 'taichi', x: TAI.x, z: TAI.z + 0.75, yaw: 0 }];
    cornerSign('圓桌會議', MEET.x, MEET.z - 1.6, 1.25); cornerSign('書房', READ.x - 1.4, READ.z + 1.45, 1.1); cornerSign('茶席', TEA.x, TEA.z + 1.6, 0.95); cornerSign('太極場', TAI.x, TAI.z + 1.6, 0.95);
    addBamboo(-10.6, 1.0, 5, 2.8); addBamboo(10.6, 1.0, 5, 2.8); addBamboo(-10.6, -2.6, 4, 2.6); addBamboo(10.6, -2.6, 4, 2.6);
    for (const [x, z] of [[-4.2, 9.2], [4.2, 9.2], [-10.4, 4.0], [10.4, 4.0]]) addLantern(x, z);

    // 地面組織線：金線＝直屬；朱紅虛線＝ PA 稽核 IA
    const lineMat = new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.85 });
    const dashMat = new THREE.LineDashedMaterial({ color: CINNABAR, dashSize: 0.22, gapSize: 0.16, transparent: true, opacity: 0.95 });
    const link = (a, b, mat) => {
      const A = P(SEAT_DEG[a], RING_R - 0.6), B = P(SEAT_DEG[b], RING_R - 0.6);
      const pts = []; for (let i = 0; i <= 24; i++) { const t = i / 24; const k = 1 - Math.sin(Math.PI * t) * 0.12; pts.push(new THREE.Vector3((A.x + (B.x - A.x) * t) * k, TOP + 0.02, CZ + (A.z - CZ + (B.z - A.z) * t) * k)); }
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat); ln.computeLineDistances(); scene.add(ln);
    };
    for (const t of ['admin', 'kobe', 'fly']) link('pa', t, lineMat);
    for (const t of ['clo', 'cto', 'cpo', 'fpa']) link('cos', t, lineMat);
    link('pa', 'ia', dashMat);

    // 休息／活動位置
    const SLOTS = [
      { id: 'walk-in-a', type: 'walk', label: '散步', r: 3.35, sp: 0.22, off: 0 },
      { id: 'tea-1', ...TEA_SEATS[0], label: '品茶' },
      { id: 'read-1', ...READ_SEATS[0], label: '看書' },
      { id: 'tai-1', ...TAI_SEATS[0], label: '打太極' },
      { id: 'walk-out-a', type: 'walk', label: '散步', r: 8.35, sp: -0.1, off: 0 },
      { id: 'tea-2', ...TEA_SEATS[1], label: '品茶' },
      { id: 'read-2', ...READ_SEATS[1], label: '看書' },
      { id: 'tai-2', ...TAI_SEATS[1], label: '打太極' },
      { id: 'walk-in-b', type: 'walk', label: '散步', r: 3.35, sp: 0.22, off: Math.PI },
      { id: 'tea-3', ...TEA_SEATS[2], label: '品茶' },
      { id: 'tai-3', ...TAI_SEATS[2], label: '打太極' },
      { id: 'walk-out-b', type: 'walk', label: '散步', r: 8.35, sp: -0.1, off: Math.PI },
    ];

    // ---------- 名牌 ----------
    function drawBar(c, x, y, w, h, value, color) {
      c.save(); c.beginPath(); c.roundRect(x, y, w, h, h / 2); c.clip();
      if (value == null) {
        c.fillStyle = '#5b5750'; c.fillRect(x, y, w, h); c.fillStyle = '#7a756c';
        for (let i = -h; i < w + h; i += 16) { c.beginPath(); c.moveTo(x + i, y); c.lineTo(x + i + 8, y); c.lineTo(x + i + 8 - h, y + h); c.lineTo(x + i - h, y + h); c.fill(); }
      } else {
        c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(x, y, w, h);
        c.fillStyle = color || '#7fc4a8'; c.fillRect(x, y, w * Math.max(0, Math.min(1, value / 100)), h);
      }
      c.restore();
    }
    const FRESH_COL = { fresh: '#6fd0ae', warm: '#e0b25c', old: '#9a948a', none: '#9a948a' };
    function labelInfo(id) {
      const p = person(id), meet = meetingOf(id);
      const bar = showProgressBar(id, p);
      let status;
      if (meet) status = '會議中';
      else if (isWorking(p)) status = '工作中';
      else if (hasRecord(id)) status = '休息中';
      else status = NO_DATA;
      return { p, meet, bar, status };
    }
    function drawLabel(d, selected) {
      const { p, bar, status } = labelInfo(d.f.id);
      const c = d.label.cv.getContext('2d'), W = 560, H = 300;
      c.clearRect(0, 0, W, H);
      const dark = true;
      const h = bar ? 288 : 204, y0 = (H - h) / 2;
      c.fillStyle = selected ? 'rgba(234,246,240,.97)' : 'rgba(28,27,25,.9)';
      c.beginPath(); c.roundRect(8, y0, W - 16, h, 26); c.fill();
      c.strokeStyle = selected ? '#5f9e8a' : '#b8995a'; c.lineWidth = selected ? 10 : 4; c.stroke();
      const fg = selected ? '#1c1b19' : '#f4f1ea', sub = selected ? '#3a3632' : '#c9c2b4';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const [nm, role] = TAG[d.f.id];
      c.fillStyle = fg; fitText(c, `${nm}・${role}`, W - 60, 60, 'bold'); c.fillText(`${nm}・${role}`, W / 2, y0 + 52);
      let st = status;
      if (status === '休息中' && d.slot && d.slot.label) st = `休息中・${d.slot.label}`;
      if (status === '會議中') { const m = meetingOf(d.f.id); if (m) st = `會議中・${m.title}`; }
      if (bar) {
        const pr = progressOf(p), fr = freshness(p);
        drawBar(c, 44, y0 + 102, W - 224, 34, pr.value, fr === 'old' ? '#9a948a' : null);
        c.fillStyle = fg; c.textAlign = 'right'; fitText(c, pr.value == null ? '暫無' : `${pr.value}%`, 120, 46, 'bold'); c.fillText(pr.value == null ? '暫無' : `${pr.value}%`, W - 40, y0 + 120);
        c.textAlign = 'center';
        const t = arr(p, 'doing').map((x) => x.text).filter(has).join('；') || '工作中';
        c.fillStyle = sub; fitText(c, t, W - 60, 38, 'normal'); let tt = t; while (c.measureText(tt).width > W - 60 && tt.length > 2) tt = tt.slice(0, -2) + '…'; c.fillText(tt, W / 2, y0 + 180);
      } else {
        c.fillStyle = status === '會議中' ? '#e0b25c' : sub; fitText(c, st, W - 60, 44, 'normal'); let tt = st; while (c.measureText(tt).width > W - 60 && tt.length > 2) tt = tt.slice(0, -2) + '…'; c.fillText(tt, W / 2, y0 + 118);
      }
      // 更新時間＋新鮮度圓點
      const fr = freshness(p);
      const ut = p ? `${fmtTaipei(p._ts, false) || NO_DATA}${p._src === 'data' ? ' 底稿・非即時' : ' 更新'}` : '尚無回報';
      const yy = y0 + h - 34;
      c.font = `30px ${SANS}`; const tw = c.measureText(ut).width;
      c.fillStyle = FRESH_COL[fr]; c.beginPath(); c.arc(W / 2 - tw / 2 - 16, yy, 9, 0, Math.PI * 2); c.fill();
      c.fillStyle = selected ? '#3a3632' : FRESH_COL[fr] === '#9a948a' ? '#b3ac9f' : FRESH_COL[fr]; c.fillText(ut, W / 2 + 8, yy);
      d.label.tex.needsUpdate = true;
      const s = narrow ? 1.5 : 1.3;
      d.label.spr.scale.set(2.25 * s, 1.205 * s, 1); d.label.base = [2.25 * s, 1.205 * s]; d.label.fill = (bar ? 288 : 204) / 300;
    }
    function drawCore() {
      const c = coreCv.getContext('2d'), W = 640, H = 260;
      c.clearRect(0, 0, W, H);
      const st = louisState(), sel = selected === 'louis';
      c.fillStyle = sel ? 'rgba(234,246,240,.97)' : 'rgba(247,244,236,.94)';
      c.beginPath(); c.roundRect(10, 10, W - 20, H - 20, 30); c.fill();
      c.strokeStyle = st === 'active' ? '#5f9e8a' : '#b8995a'; c.lineWidth = st === 'active' || sel ? 10 : 5; c.stroke();
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#1c1b19'; fitText(c, 'Louis・總經理主位', W - 70, 62, 'bold', SERIF); c.fillText('Louis・總經理主位', W / 2, 74);
      let line;
      if (!louisActive || !has(louisActive.last_seen)) line = `最後來訊：${NO_DATA}`;
      else line = `最後來訊 ${fmtTaipei(louisActive.last_seen, false)}（${ago(louisActive.last_seen)}）`;
      c.fillStyle = st === 'active' ? '#2f7a63' : '#5a554d'; fitText(c, line, W - 70, 44, 'bold'); c.fillText(line, W / 2, 150);
      const tip = st === 'active' ? '一小時內有來訊・主位發光' : st === 'idle' ? '超過一小時未來訊' : '只記時間、不記內容';
      c.fillStyle = '#8a8478'; fitText(c, tip, W - 70, 32, 'normal'); c.fillText(tip, W / 2, 206);
      coreTex.needsUpdate = true;
      const s = narrow ? 1.4 : 1.15; coreSpr.scale.set(2.7 * s, 1.1 * s, 1); meetSpr.scale.set(2.3 * s, 0.9 * s, 1);
    }
    function drawMeet() {
      const c = meetCv.getContext('2d'), W = 560, H = 220;
      c.clearRect(0, 0, W, H);
      const busy = meetings.length > 0;
      c.fillStyle = 'rgba(28,27,25,.9)'; c.beginPath(); c.roundRect(8, 8, W - 16, H - 16, 26); c.fill();
      c.strokeStyle = busy ? '#e0b25c' : '#b8995a'; c.lineWidth = busy ? 8 : 4; c.stroke();
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if (!busy) { c.fillStyle = '#c9c2b4'; fitText(c, '會議室・空閒', W - 60, 64, 'bold'); c.fillText('會議室・空閒', W / 2, H / 2); }
      else {
        let t = meetings.map((x) => x.title).join('／'); c.fillStyle = '#f4f1ea'; fitText(c, t, W - 60, 54, 'bold'); while (c.measureText(t).width > W - 60 && t.length > 2) t = t.slice(0, -2) + '…'; c.fillText(t, W / 2, 80);
        c.fillStyle = '#e0b25c'; fitText(c, '會議中', W - 60, 48, 'bold'); c.fillText('會議中', W / 2, 150);
      }
      meetTex.needsUpdate = true;
    }

    // ---------- 大型看板內容 ----------
    function drawBigBoard() {
      const c = bigCv.getContext('2d'), W = 2048, H = 1280;
      const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#191816'); bg.addColorStop(1, '#100f0e');
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      // 標題列
      c.save(); c.globalAlpha = 0.9; drawTaiji(c, 92, 78, 38, '#f2eee5', '#191816'); c.restore();
      c.strokeStyle = '#b8995a'; c.lineWidth = 3; c.beginPath(); c.arc(92, 78, 38, 0, Math.PI * 2); c.stroke();
      c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillStyle = '#f4f1ea';
      c.font = `bold 66px ${SERIF}`; c.fillText('全員即時看板', 150, 80);
      c.textAlign = 'right'; c.fillStyle = '#a49d90'; c.font = `34px ${SANS}`;
      c.fillText(lastCheck ? `每 30 秒檢查・上次 ${fmtTaipei(lastCheck.toISOString())}（台北時間）` : '尚未解鎖', W - 60, 80);
      c.fillStyle = '#b8995a'; c.fillRect(60, 140, W - 120, 3);
      // 左欄：成員
      const ids = ['pa', 'ia', 'admin', 'kobe', 'fly', 'cos', 'clo', 'cto', 'cpo', 'fpa'];
      const x0 = 60, colW = 1250, y0 = 172, rowH = 100;
      c.font = `28px ${SANS}`; c.fillStyle = '#8a8478'; c.textAlign = 'left';
      c.fillText('成員', x0 + 30, y0 + 6); c.fillText('目前', x0 + 300, y0 + 6); c.fillText('進度', x0 + 760, y0 + 6); c.textAlign = 'right'; c.fillText('更新', x0 + colW - 20, y0 + 6); c.textAlign = 'left';
      ids.forEach((id, i) => {
        const f = FLOORS.find((x) => x.id === id), p = person(id), y = y0 + 34 + i * rowH;
        if (i === 5) { c.fillStyle = 'rgba(184,153,90,.5)'; c.fillRect(x0, y - 6, colW, 2); }
        c.fillStyle = i % 2 ? 'rgba(255,255,255,.025)' : 'rgba(255,255,255,.055)'; c.fillRect(x0, y, colW, rowH - 10);
        c.fillStyle = PERSONAL.has(id) ? '#f2eee5' : '#4a4640'; c.beginPath(); c.arc(x0 + 30, y + 45, 13, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#b8995a'; c.lineWidth = 2; c.stroke();
        const [nm, role] = TAG[id];
        c.fillStyle = '#f4f1ea'; c.font = `bold 40px ${SANS}`; c.fillText(nm, x0 + 60, y + 34);
        c.fillStyle = '#a49d90'; c.font = `26px ${SANS}`; c.fillText(role, x0 + 60, y + 72);
        const working = isWorking(p), meet = meetingOf(id), fr = freshness(p);
        const d = arr(p, 'doing');
        let txt = meet ? `會議中：${meet.title}` : d.length ? d.map((x) => x.text).join('；') : (p ? '休息中' : NO_DATA);
        c.fillStyle = working || meet ? '#f4f1ea' : '#8a8478'; c.font = `34px ${SANS}`;
        while (c.measureText(txt).width > 430 && txt.length > 2) txt = txt.slice(0, -2) + '…';
        c.fillText(txt, x0 + 300, y + 45);
        if (working) {
          const pr = progressOf(p).value;
          drawBar(c, x0 + 760, y + 30, 190, 30, pr, fr === 'old' ? '#9a948a' : null);
          c.fillStyle = '#f4f1ea'; c.font = `bold 32px ${SANS}`; c.fillText(pr == null ? '暫無' : `${pr}%`, x0 + 964, y + 45);
        } else { c.fillStyle = '#5a554d'; c.font = `30px ${SANS}`; c.fillText('—', x0 + 760, y + 45); }
        c.font = `30px ${SANS}`; c.textAlign = 'right';
        const ut = p ? `${fmtTaipei(p._ts, false) || NO_DATA}${p._src === 'data' ? ' 底稿' : ''}` : '—';
        c.fillStyle = FRESH_COL[fr]; c.fillText(ut, x0 + colW - 20, y + 45);
        c.beginPath(); c.arc(x0 + colW - 40 - c.measureText(ut).width, y + 45, 9, 0, Math.PI * 2); c.fill(); c.textAlign = 'left';
      });
      // 右欄
      const x2 = x0 + colW + 60, w2 = W - x2 - 60;
      c.fillStyle = 'rgba(255,255,255,.04)'; c.fillRect(x2 - 24, 172, w2 + 48, H - 230);
      let yy = 220;
      // 主位
      c.fillStyle = '#b8995a'; c.font = `bold 40px ${SERIF}`; c.fillText('主位', x2, yy); yy += 56;
      const st = louisState();
      c.fillStyle = st === 'active' ? '#6fd0ae' : '#c9c2b4'; c.font = `32px ${SANS}`;
      c.fillText(louisActive && has(louisActive.last_seen) ? `Louis 最後來訊 ${fmtTaipei(louisActive.last_seen, false)}（${ago(louisActive.last_seen)}）` : `Louis 最後來訊：${NO_DATA}`, x2, yy); yy += 74;
      c.fillStyle = '#b8995a'; c.font = `bold 40px ${SERIF}`; c.fillText('警示', x2, yy); yy += 56;
      const al = alertList().slice(0, 5);
      c.font = `30px ${SANS}`;
      if (!al.length) { c.fillStyle = '#8a8478'; c.fillText('目前沒有警示', x2, yy); yy += 50; }
      for (const a of al) {
        c.fillStyle = a.level === 'red' ? '#d0574a' : '#e0b25c'; c.fillRect(x2, yy - 20, 8, 40);
        c.fillStyle = '#e8e3d8'; let t = a.text; while (c.measureText(t).width > w2 - 30 && t.length > 2) t = t.slice(0, -2) + '…';
        c.fillText(t, x2 + 22, yy); yy += 54;
      }
      yy = Math.max(yy + 24, 720);
      c.fillStyle = '#b8995a'; c.font = `bold 40px ${SERIF}`; c.fillText('累計用量', x2, yy); yy += 56;
      c.font = `30px ${SANS}`;
      const h = usage.hermes;
      if (h && Array.isArray(h.profiles) && h.profiles.length) for (const pf of h.profiles) {
        c.fillStyle = '#c9c2b4'; c.fillText(String(pf.label || pf.id).replace(/（.*?）/, ''), x2, yy);
        c.textAlign = 'right'; c.fillStyle = '#f4f1ea'; c.fillText(`${fmtTok(pf.total)} 詞元`, x2 + w2, yy); c.textAlign = 'left'; yy += 46;
      } else { c.fillStyle = '#8a8478'; c.fillText(`Air 特殊小組：${NO_DATA}`, x2, yy); yy += 46; }
      const g = usage.grok;
      if (g && g.shares) {
        c.fillStyle = '#c9c2b4'; c.fillText('助理本週額度已用', x2, yy);
        c.textAlign = 'right'; c.fillStyle = '#f4f1ea'; c.fillText(typeof g.weekly_used_percent === 'number' ? `${Math.round(g.weekly_used_percent * 10) / 10}%` : NO_DATA, x2 + w2, yy); c.textAlign = 'left'; yy += 50;
        const tops = Object.entries(g.shares).filter(([, v]) => typeof v === 'number').sort((a, b) => b[1] - a[1]).slice(0, 4);
        for (const [id, v] of tops) {
          c.fillStyle = '#a49d90'; c.fillText(TAG[id] ? TAG[id][0] : id, x2, yy);
          drawBar(c, x2 + 150, yy - 13, w2 - 280, 26, v);
          c.fillStyle = '#f4f1ea'; c.textAlign = 'right'; c.fillText(v < 1 ? '<1%' : `${Math.round(v)}%`, x2 + w2, yy); c.textAlign = 'left'; yy += 44;
        }
      } else { c.fillStyle = '#8a8478'; c.fillText(`助理額度：${NO_DATA}`, x2, yy); }
      c.fillStyle = '#6a655c'; c.font = `24px ${SANS}`; c.fillText('特殊小組為真實詞元數；助理為週額度占比（非詞元）', x2, H - 52);
      bigTex.needsUpdate = true;
    }

    // ---------- 狀態更新 ----------
    function assignActivities() {
      const idle = desks.map((d) => d.f.id).filter((id) => !meetingOf(id) && hasRecord(id) && !isWorking(person(id))).sort();
      const taken = new Set(), map = {};
      for (const id of idle) {
        const i = hashId(id) % SLOTS.length;
        for (let n = 0; n < SLOTS.length; n++) { const s = SLOTS[(i + n) % SLOTS.length]; if (!taken.has(s.id)) { taken.add(s.id); map[id] = s; break; } }
      }
      return map;
    }
    function assignMeetSeats() {
      const map = {}; let n = 0;
      for (const m of meetings) for (const id of m.members) { if (map[id] || id === 'louis') continue; map[id] = MEET_SEATS[n % MEET_SEATS.length]; n++; }
      return map;
    }
    let selected = null, narrow = false;
    function update() {
      const act = assignActivities(), meetSeat = assignMeetSeats();
      for (const d of desks) {
        const id = d.f.id, p = person(id), working = isWorking(p), meet = meetingOf(id), on = id === selected;
        const waiting = p && arr(p, 'waiting_on_louis').length;
        if (meet) { d.atDesk = false; d.slot = meetSeat[id] || null; }
        else { d.atDesk = working || !hasRecord(id); d.slot = d.atDesk ? null : (act[id] || null); }
        if (!d.atDesk && !d.slot) d.atDesk = true;
        d.working = d.atDesk && working;
        d.matMat.emissiveIntensity = on ? 0.55 : waiting ? 0.3 : d.working ? 0.16 : 0;
        d.scrMat.emissiveIntensity = d.working ? 0.9 : 0.05;
        d.lamp.material.emissiveIntensity = d.working ? 1.0 : 0.1;
        drawLabel(d, on);
      }
      drawCore(); drawMeet(); drawBigBoard();
    }
    function select(id) { selected = id; update(); }

    // ---------- 姿勢 ----------
    function sit(a, hipY, kneeBend = Math.PI / 2) {
      a.hip.position.y = hipY;
      for (const L of a.legs) { L.thigh.rotation.x = -Math.PI / 2; L.knee.rotation.x = kneeBend; }
      if (a.skirt) { a.skirt.visible = false; a.lap.visible = true; }
    }
    function poseAvatar(d, sec) {
      const a = d.av, k = DS * (d.lead ? 1.06 : 1), ph = d.phase;
      a.cup.visible = a.book.visible = false;
      a.hip.position.y = 0.72; a.upper.rotation.set(0, 0, 0); a.head.rotation.set(0, 0, 0);
      for (const L of a.legs) { L.thigh.rotation.set(0, 0, 0); L.knee.rotation.set(0, 0, 0); }
      for (const A of a.arms) { A.sh.rotation.set(0, 0, 0); A.el.rotation.set(0, 0, 0); }
      if (a.skirt) { a.skirt.visible = true; a.lap.visible = false; }
      a.g.scale.setScalar(k);
      let lx, lz, ly = 2.55;
      if (d.atDesk || !d.slot) {
        const s = seatWorld(d);
        a.g.position.set(s.x, TOP, s.z); a.g.rotation.y = d.yaw;
        sit(a, 0.5 / (d.lead ? 1.06 : 1));
        if (d.working) {
          for (const [i, A] of a.arms.entries()) { A.sh.rotation.x = -0.55; A.el.rotation.x = -0.95 + Math.sin(sec * 9 + ph + i * 1.7) * 0.08; }
          a.head.rotation.x = 0.12 + Math.sin(sec * 0.8 + ph) * 0.03;
        } else {
          for (const A of a.arms) { A.sh.rotation.x = -0.3; A.el.rotation.x = -0.6; }
          a.upper.rotation.x = -0.05 + Math.sin(sec * 1.2 + ph) * 0.02;
        }
        lx = d.pos.x; lz = d.pos.z;
      } else {
        const s = d.slot;
        if (s.type === 'walk') {
          const ang = s.off + sec * s.sp + ph * 0.05;
          a.g.position.set(Math.sin(ang) * s.r, s.r < PLAT_R ? TOP : 0, CZ + Math.cos(ang) * s.r);
          a.g.rotation.y = ang + (s.sp > 0 ? Math.PI / 2 : -Math.PI / 2);
          const w = Math.sin(sec * 6 + ph);
          a.legs[0].thigh.rotation.x = w * 0.45; a.legs[1].thigh.rotation.x = -w * 0.45;
          a.legs[0].knee.rotation.x = Math.max(0, -w) * 0.5; a.legs[1].knee.rotation.x = Math.max(0, w) * 0.5;
          a.arms[0].sh.rotation.x = -w * 0.4; a.arms[1].sh.rotation.x = w * 0.4;
          a.hip.position.y = 0.72 + Math.abs(w) * 0.025;
        } else if (s.type === 'meet') {
          a.g.position.set(s.x, 0, s.z); a.g.rotation.y = s.yaw; sit(a, 0.5);
          for (const A of a.arms) { A.sh.rotation.x = -0.5; A.el.rotation.x = -0.7; }
          a.head.rotation.y = Math.sin(sec * 0.7 + ph) * 0.3;
        } else if (s.type === 'tea') {
          a.g.position.set(s.x, 0.1, s.z); a.g.rotation.y = s.yaw;
          sit(a, 0.24, Math.PI * 0.92);
          a.cup.visible = true;
          a.arms[1].sh.rotation.x = -0.6 + Math.sin(sec * 0.9 + ph) * 0.25; a.arms[1].el.rotation.x = -1.2;
          a.arms[0].sh.rotation.x = -0.35; a.arms[0].el.rotation.x = -0.9;
        } else if (s.type === 'read') {
          a.g.position.set(s.x, 0, s.z); a.g.rotation.y = s.yaw; sit(a, 0.42);
          a.book.visible = true;
          a.arms[0].sh.rotation.x = -0.55; a.arms[0].el.rotation.x = -1.0; a.arms[1].sh.rotation.x = -0.55; a.arms[1].el.rotation.x = -1.0;
          a.head.rotation.x = 0.3;
        } else if (s.type === 'taichi') {
          a.g.position.set(s.x, 0.015, s.z); a.g.rotation.y = s.yaw + Math.sin(sec * 0.35) * 0.5;
          const t = sec * 0.6;
          a.hip.position.y = 0.66;
          a.legs[0].thigh.rotation.z = 0.18; a.legs[1].thigh.rotation.z = -0.18;
          a.arms[0].sh.rotation.x = -0.9 - Math.sin(t) * 0.5; a.arms[0].sh.rotation.z = -0.35 - Math.cos(t) * 0.3; a.arms[0].el.rotation.x = -0.5;
          a.arms[1].sh.rotation.x = -0.9 + Math.sin(t) * 0.5; a.arms[1].sh.rotation.z = 0.35 - Math.cos(t) * 0.3; a.arms[1].el.rotation.x = -0.5;
        }
        lx = a.g.position.x; lz = a.g.position.z; ly = 2.45;
      }
      d.label.spr.position.set(lx, ly, lz);
    }

    // ---------- 鏡頭 ----------
    const camQ = (new URLSearchParams(location.search).get('cam') || '').split(',').map(Number);
    const VIEW_ALL = () => (camQ.length === 6 && camQ.every(Number.isFinite) ? { pos: camQ.slice(0, 3), tgt: camQ.slice(3) }
      : narrow ? { pos: [0, 28.5, 16], tgt: [0, 0, -0.9] } : { pos: [0, 14.2, 19.8], tgt: [0, 0.4, -0.9] });
    function boardView() {
      // 正對看板，依畫面比例自動決定距離，讓整面螢幕完整入鏡
      const vf = THREE.MathUtils.degToRad(camera.fov), asp = camera.aspect || 1.6;
      const hf = 2 * Math.atan(Math.tan(vf / 2) * asp);
      const dist = Math.max((BOARD.h * 1.12 / 2) / Math.tan(vf / 2), (BOARD.w * 1.08 / 2) / Math.tan(hf / 2));
      return { pos: [BOARD.x, BOARD.y, BOARD.z + dist], tgt: [BOARD.x, BOARD.y, BOARD.z] };
    }
    function setView(v) { camera.position.set(...v.pos); controls.target.set(...v.tgt); camera.updateProjectionMatrix(); controls.update(); }
    function resize() {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      const wasNarrow = narrow; narrow = w / h < 1;
      camera.fov = narrow ? 46 : 40;
      camera.updateProjectionMatrix();
      if (!resize.done) { resize.done = true; setView(mode === 'board' ? boardView() : VIEW_ALL()); }
      else if (mode === 'board' && !fly) setView(boardView());
      if (wasNarrow !== narrow) update();
    }
    let mode = new URLSearchParams(location.search).get('look') === 'board' ? 'board' : 'all';
    let fly = null;
    const boardCenter = new THREE.Vector3(BOARD.x, BOARD.y, BOARD.z);
    new ResizeObserver(resize).observe(el); resize();

    let userMoved = mode === 'board';
    const stopSpin = () => { userMoved = true; controls.autoRotate = false; };
    renderer.domElement.addEventListener('pointerdown', stopSpin);
    renderer.domElement.addEventListener('wheel', stopSpin, { passive: true });
    renderer.domElement.addEventListener('touchstart', stopSpin, { passive: true });
    setTimeout(() => { if (!userMoved && mode === 'all') controls.autoRotate = true; }, 8000);

    const ray = new THREE.Raycaster(), v = new THREE.Vector2();
    const targets = [...desks.flatMap((d) => d.hits), coreTop, glow, halo, coreSpr];
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) { down = null; return; }
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v, camera);
      const hit = ray.intersectObjects(targets)[0];
      if (hit && hit.object.userData.id) showDetail(hit.object.userData.id);
    });
    // 名牌防重疊：依螢幕座標由近到遠排位，較遠者向上讓開（每格重新計算，不累積）
    const pv = new THREE.Vector3(), pv2 = new THREE.Vector3(), pv3 = new THREE.Vector3();
    function rectOf(spr, fill) {
      pv.copy(spr.position).project(camera);
      const Wd = el.clientWidth, Ht = el.clientHeight;
      const dist = camera.position.distanceTo(spr.position);
      const ppu = Ht / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      return { x: (pv.x + 1) / 2 * Wd, y: (1 - pv.y) / 2 * Ht, w: spr.scale.x * ppu * 0.96, h: spr.scale.y * ppu * fill, ppu, dist, front: pv.z < 1 };
    }
    let spritesShown = true;
    function showSprites(on) {
      if (on === spritesShown) return; spritesShown = on;
      for (const d of desks) d.label.spr.visible = on;
      coreSpr.visible = meetSpr.visible = on; for (const sg of signs) sg.visible = on;
    }
    function declutter() {
      // 看板模式：隱藏所有名牌，避免擋住正面螢幕
      showSprites(!(mode === 'board' && (!fly || performance.now() - fly.t0 > 500)));
      if (!spritesShown) return;
      const fixed = [rectOf(coreSpr, 0.85), rectOf(meetSpr, 0.85), ...signs.map((sg) => rectOf(sg, 0.9))];
      // 拉近時名牌不無限放大：螢幕寬度上限約 300 像素
      for (const d of desks) {
        const b = d.label.base; if (!b) continue;
        const dist = camera.position.distanceTo(d.label.spr.position);
        const ppu = el.clientHeight / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
        const k = Math.min(1, 300 / (b[0] * ppu));
        d.label.spr.scale.set(b[0] * k, b[1] * k, 1);
      }
      const items = desks.map((d) => ({ d, r: rectOf(d.label.spr, d.label.fill || 0.7) })).filter((o) => o.r.front).sort((a, b) => a.r.dist - b.r.dist);
      const placed = [...fixed];
      const hit = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
      const right = pv2.setFromMatrixColumn(camera.matrixWorld, 0), up = pv3.setFromMatrixColumn(camera.matrixWorld, 1);
      const Wd = el.clientWidth;
      for (const o of items) {
        const r = o.r, y0 = r.y, x0 = r.x;
        // 水平夾在畫面內，避免名牌被裁切
        r.x = Math.min(Math.max(r.x, r.w / 2 + 4), Wd - r.w / 2 - 4);
        if (r.x !== x0) o.d.label.spr.position.addScaledVector(right, (r.x - x0) / r.ppu);
        for (let pass = 0; pass < 6; pass++) {
          const c = placed.find((q) => hit(r, q));
          if (!c) break;
          r.y = c.y - (c.h + r.h) / 2 - 3;
        }
        placed.push(r);
        if (r.y !== y0) o.d.label.spr.position.addScaledVector(up, (y0 - r.y) / r.ppu);
      }
    }
    function flyTo(vw) { fly = { t0: performance.now(), from: camera.position.clone(), to: new THREE.Vector3(...vw.pos), tf: controls.target.clone(), tt: new THREE.Vector3(...vw.tgt) }; }
    function focusBoard() { mode = 'board'; stopSpin(); flyTo(boardView()); }
    function focusAll() { mode = 'all'; flyTo(VIEW_ALL()); }
    (function loop(t) {
      const now = performance.now(), sec = t * 0.001;
      if (fly) { const k = Math.min(1, (now - fly.t0) / 1300), e = k * k * (3 - 2 * k); camera.position.lerpVectors(fly.from, fly.to, e); controls.target.lerpVectors(fly.tf, fly.tt, e); if (k >= 1) fly = null; }
      controls.update();
      // 看板模式：把近裁切面推到看板前，前景桌椅不會擋住螢幕（手機直式距離較遠時特別需要）
      const nearWant = mode === 'board' && !fly ? Math.max(0.1, camera.position.distanceTo(boardCenter) - 0.9) : 0.1;
      if (Math.abs(camera.near - nearWant) > 0.01) { camera.near = nearWant; camera.updateProjectionMatrix(); }
      coreTop.rotation.z = sec * 0.12;
      const st = louisState();
      const pulse = 0.5 + Math.sin(sec * 2.2) * 0.5;
      glowMat.opacity = st === 'active' ? 0.35 + pulse * 0.4 : 0;
      haloMat.emissiveIntensity = st === 'active' ? 0.6 + pulse * 0.8 : st === 'idle' ? 0.05 : 0.0;
      haloMat.color.setHex(st === 'active' ? JADE : 0x8a8478);
      for (const b of bamboos) b.g.rotation.z = Math.sin(sec * 0.8 + b.ph) * 0.012;
      for (const d of desks) { poseAvatar(d, sec); if (d.working) d.lamp.material.emissiveIntensity = 0.8 + Math.sin(sec * 2.6 + d.phase) * 0.25; }
      declutter();
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    })(0);
    building = { update, select, focusBoard, focusAll };
    update();
  } catch (e) {
    console.error(e);
    el.innerHTML = '<p class="empty" style="padding:24px;text-align:center">三維畫面無法載入，下方清單仍可正常查看</p>';
  }
}

render();
initBuilding();
load();
