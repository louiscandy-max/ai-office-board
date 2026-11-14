// AI 辦公樓看板（同一層平面版）：瀏覽器端以通關密語解密加密資料檔，每 30 秒自動輪詢。
const REPO_RAW = 'https://raw.githubusercontent.com/louiscandy-max/ai-office-board/main/';
const POLL_MS = 30000;
const FILES = ['data', 'live', 'agents', 'directory'];
const NO_DATA = '暫無數據';
const LS_KEY = 'aiOfficeBoard.pass';
const STATUS_TEXT = { done: '已完成', in_progress: '進行中', pending: '待處理' };
// 性別依據：Grok Bot 助理 profile 描述；Admin／Kobe 依 Air default profile SOUL.md「女性」；
// Fly（work profile）、CoS、CLO、CTO 無任何來源載明性別 → 中性形象。
const PEOPLE = [
  { id: 'pa',    name: 'Sr. PA Ai',  role: '私人資深特助', room: '私人特助室',   g: 'f', color: '#4285F4', rel: '個人側主管', side: 'p' },
  { id: 'admin', name: 'Admin',      role: 'Air 執行維運', room: '維運室',       g: 'f', color: '#34A853', rel: '直屬 PA', side: 'p' },
  { id: 'kobe',  name: 'Ai Kobe',    role: '個人事務',     room: '個人事務室',   g: 'f', color: '#EA4335', rel: '直屬 PA', side: 'p' },
  { id: 'fly',   name: 'Ai Fly',     role: '碳酸鋰預測',   room: '預測室',       g: 'n', color: '#F9AB00', rel: '直屬 PA', side: 'p' },
  { id: 'ia',    name: 'Sr. IA Ai',  role: '投資分析師',   room: '投資分析室',   g: 'f', color: '#A142F4', rel: '與 PA 平行・受 PA 稽核', side: 'p' },
  { id: 'cos',   name: 'CoS Ai',     role: '幕僚長',       room: '幕僚長室',     g: 'n', color: '#76B900', rel: '與 PA 平行', side: 'c' },
  { id: 'clo',   name: 'CLO Ai',     role: '法務長',       room: '法務室',       g: 'n', color: '#2E7D5B', rel: '直屬 CoS', side: 'c' },
  { id: 'cto',   name: 'CTO Ai',     role: '技術長',       room: '技術長室',     g: 'n', color: '#00897B', rel: '直屬 CoS', side: 'c' },
  { id: 'cpo',   name: 'CPO Ai',     role: '採購長',       room: '採購長室',     g: 'f', color: '#5D7F2A', rel: '直屬 CoS', side: 'c' },
  { id: 'fpa',   name: 'Sr. FP&A Ai', role: '財務規劃分析', room: '財務規劃室',  g: 'f', color: '#9E9D24', rel: '直屬 CoS', side: 'c' },
  { id: 'louis', name: 'Louis',      role: '總經理',       room: '總經理室',     g: 'm', color: '#3d5a8c', rel: '總經理', side: 'x' },
];
const BY_ID = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));
const AI_IDS = PEOPLE.filter((p) => p.id !== 'louis').map((p) => p.id);
const SRC_LABEL = { data: '夜間底稿', live: 'Air 即時', agents: '助理即時' };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const arr = (p, k) => (p && Array.isArray(p[k]) ? p[k] : []);
const stampMs = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : null; };

let pass = null;
const enc = {};      // name -> 加密檔（含 ct）
const plain = {};    // name -> 解密後資料
const fetchState = {}; // name -> 'ok' | 'missing' | 'error'
let board = null;    // 合併後 { people:{id:rec}, meetings, louis_active, usage }
let lastCheck = null, lastChange = null, timer = null, busy = false;

function fmtTaipei(iso, withDate = true) {
  const ms = stampMs(iso); if (ms == null) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return withDate ? `${p.month}/${p.day} ${p.hour}:${p.minute}` : `${p.hour}:${p.minute}`;
}
function ago(iso) {
  const ms = stampMs(iso); if (ms == null) return null;
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 1) return '剛剛';
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} 小時前`;
  return `${Math.floor(h / 24)} 天前`;
}
function freshness(rec) {
  if (!rec) return 'none';
  if (rec._src === 'data') return 'old';
  const ms = stampMs(rec._ts); if (ms == null) return 'old';
  const m = (Date.now() - ms) / 60000;
  return m <= 15 ? 'fresh' : m <= 120 ? 'warm' : 'old';
}

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decrypt(e, pw) {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(e.salt), iterations: e.iter || 600000 }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(e.iv) }, key, b64(e.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/** 先讀 raw.githubusercontent（commit 後立即可見，加 ?t= 避開 CDN 快取），失敗再讀同網域。 */
async function fetchEnc(name) {
  const t = Date.now();
  for (const base of [REPO_RAW, '']) {
    try {
      const r = await fetch(`${base}${name}.enc.json?t=${t}`, { cache: 'no-store' });
      if (r.status === 404) { if (base) continue; return { state: 'missing' }; }
      if (!r.ok) continue;
      const j = await r.json();
      if (j && j.ct) return { state: 'ok', json: j };
    } catch (e) { /* 換下一個來源 */ }
  }
  return { state: 'error' };
}

/** 合併：夜間底稿 ← Air 即時 ← 助理即時；每人以較新時間戳為準，並記錄來源與時間。 */
function merge() {
  const out = { people: {}, meetings: [], louis_active: null, usage: { hermes: null, grok: null } };
  const d = plain.data;
  if (d) {
    for (const p of arr(d, 'people')) if (p && p.id) out.people[p.id] = { ...p, _src: 'data', _ts: p.updated_at || d.updated_at };
    if (Array.isArray(d.meetings)) out.meetings = d.meetings;
    if (d.louis_active) out.louis_active = { ...d.louis_active, _src: 'data' };
  }
  for (const name of ['live', 'agents']) {
    const L = plain[name]; if (!L) continue;
    for (const lp of arr(L, 'people')) {
      if (!lp || !lp.id) continue;
      const ts = lp.updated_at || L.updated_at;
      const cur = out.people[lp.id];
      const curMs = cur ? stampMs(cur._ts) : null, ms = stampMs(ts);
      if (cur && curMs != null && (ms == null || ms < curMs)) continue;
      const m = { ...(cur || {}), id: lp.id, _src: name, _ts: ts };
      for (const k of ['doing', 'waiting_on_louis', 'tasks', 'name']) if (k in lp) m[k] = lp[k];
      out.people[lp.id] = m;
    }
    if (L.louis_active) {
      const cur = out.louis_active;
      const a = stampMs(L.louis_active.last_seen), b = cur ? stampMs(cur.last_seen) : null;
      if (!cur || b == null || (a != null && a >= b)) out.louis_active = { ...L.louis_active, _src: name };
    }
    if (L.usage && L.usage.hermes) out.usage.hermes = L.usage.hermes;
    if (L.usage && L.usage.grok) out.usage.grok = L.usage.grok;
  }
  return out;
}

function progressOf(p) {
  if (!p) return null;
  const nums = arr(p, 'doing').map((x) => x.progress).filter((n) => typeof n === 'number' && n >= 0 && n <= 100);
  if (nums.length) return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  if (!arr(p, 'doing').length) return null;
  const t = arr(p, 'tasks');
  if (t.length) return Math.round((t.filter((x) => x.status === 'done').length / t.length) * 100);
  return null;
}
function stateOf(id) {
  if (!board) return 'none';
  if (id === 'louis') { const la = board.louis_active; return la && typeof la.active === 'boolean' ? (la.active ? 'work' : 'rest') : 'none'; }
  const p = board.people[id]; if (!p) return 'none';
  return arr(p, 'doing').length ? 'work' : 'rest';
}
const STATE_TEXT = { work: '工作中', rest: '休息中', none: '無資料' };
const meetingOf = (id) => (board ? board.meetings.find((m) => Array.isArray(m.members) && m.members.includes(id)) : null);

function bar(v, cls = '') {
  return v == null
    ? `<div class="bar unknown ${cls}" role="img" aria-label="進度暫無數據"></div>`
    : `<div class="bar ${cls}" role="img" aria-label="進度 ${v}%"><i style="width:${v}%"></i></div>`;
}

// ---- 人物形象（SVG）：f 女性、m 男性、n 中性 ----
function avatar(g, color, state) {
  const skin = '#f2d0b1', hair = '#3b2a20';
  const eyes = '<circle cx="28" cy="25" r="1.4" fill="#2b2b2b"/><circle cx="36" cy="25" r="1.4" fill="#2b2b2b"/>';
  let s = '';
  if (g === 'f') {
    s = `<path d="M19 26c0-11 6-17 13-17s13 6 13 17v15c-4 2-22 2-26 0z" fill="${hair}"/>
      <path d="M11 64c0-12 9-19 21-19s21 7 21 19z" fill="${color}"/>
      <path d="M26 45q6 7 12 0" fill="none" stroke="#fff" stroke-width="2" opacity=".8"/>
      <circle cx="32" cy="25" r="10" fill="${skin}"/>
      <path d="M22 24c1-8 6-12 10-12s10 4 11 12c-6-1-10-4-12-8-2 4-5 7-9 8z" fill="${hair}"/>
      ${eyes}<path d="M29.5 30q2.5 1.8 5 0" stroke="#c4566a" stroke-width="1.4" fill="none"/>
      <circle cx="22.3" cy="28" r="1.2" fill="#f5c542"/><circle cx="41.7" cy="28" r="1.2" fill="#f5c542"/>`;
  } else if (g === 'm') {
    s = `<path d="M11 64c0-12 9-19 21-19s21 7 21 19z" fill="${color}"/>
      <path d="M26 45l6 9 6-9z" fill="#fff"/><path d="M31 47h2l1.2 9-2.2 3-2.2-3z" fill="#22324d"/>
      <circle cx="32" cy="25" r="10" fill="${skin}"/>
      <path d="M22 23c0-7 4-11 10-11s10 4 10 11c-2-3-5-5-10-5s-8 2-10 5z" fill="${hair}"/>
      ${eyes}<path d="M29.5 30.5h5" stroke="#8a5a44" stroke-width="1.4"/>`;
  } else {
    s = `<path d="M12 64c0-11 9-18 20-18s20 7 20 18z" fill="${color}"/>
      <circle cx="32" cy="25" r="11" fill="#e9eef5" stroke="${color}" stroke-width="2.5"/>
      ${eyes}<path d="M29 30q3 2 6 0" stroke="#5b6b82" stroke-width="1.4" fill="none"/>`;
  }
  return `<svg class="av av-${state}" viewBox="0 0 64 64" aria-hidden="true">${s}</svg>`;
}

function chatLink(id, small) {
  const d = plain.directory && plain.directory.people && plain.directory.people[id];
  const url = d && d.chat;
  if (!url || !(/^grokbot:\/\//.test(url) || /^https:\/\/t\.me\//.test(url))) return '';
  return `<a class="chat${small ? ' sm' : ''}" href="${esc(url)}" onclick="event.stopPropagation()">開啟對話</a>`;
}
function updatedLine(id) {
  if (id === 'louis') {
    const la = board && board.louis_active;
    if (!la || !has(la.last_seen)) return `<span class="upd none">最後活動：${NO_DATA}</span>`;
    return `<span class="upd ${freshness({ _src: la._src === 'data' ? 'data' : 'x', _ts: la.last_seen })}">最後活動 ${esc(fmtTaipei(la.last_seen))}（${esc(ago(la.last_seen))}）・只記時間</span>`;
  }
  const p = board && board.people[id];
  if (!p) return `<span class="upd none">尚無任何回報</span>`;
  const t = fmtTaipei(p._ts);
  const f = freshness(p);
  const lab = SRC_LABEL[p._src] || '';
  return `<span class="upd ${f}"><i></i>${t ? `更新 ${esc(t)}（${esc(ago(p._ts))}）` : `更新時間${NO_DATA}`}・${esc(lab)}${p._src === 'data' ? '・非即時' : ''}</span>`;
}

function officeHtml(f) {
  const st = stateOf(f.id);
  const p = board && board.people[f.id];
  const meet = meetingOf(f.id);
  const doing = arr(p, 'doing');
  let task;
  if (meet) task = `<p class="task meet">會議中：${esc(meet.title)}</p>`;
  else if (f.id === 'louis') task = '';
  else if (doing.length) task = `<p class="task">${doing.map((x) => esc(x.text)).join('；')}</p>`;
  else task = `<p class="task muted">${st === 'none' ? '尚無資料' : '目前沒有執行中任務'}</p>`;
  const pr = progressOf(p);
  const showBar = f.id !== 'louis' && st === 'work';
  return `<article class="office side-${f.side} st-${st} f-${f.id === 'louis' ? 'x' : freshness(p)}" data-id="${f.id}" tabindex="0" style="--c:${f.color}">
    <div class="door">${esc(f.room)}</div>
    <div class="who">${avatar(f.g, f.color, st)}<div><b>${esc(f.name)}</b><span class="role">${esc(f.role)}</span><span class="rel">${esc(f.rel)}</span></div>
      <span class="pill ${st}">${STATE_TEXT[st]}</span></div>
    ${task}
    ${showBar ? `<div class="prog">${bar(pr)}<span>${pr == null ? '進度暫無數據' : pr + '%'}</span></div>` : ''}
    <div class="foot">${updatedLine(f.id)}${chatLink(f.id)}</div>
  </article>`;
}

function boardHtml() {
  if (!board) return `<p class="muted">${NO_DATA}</p>`;
  return AI_IDS.map((id) => {
    const f = BY_ID[id]; const p = board.people[id]; const st = stateOf(id);
    const d = arr(p, 'doing'); const pr = progressOf(p);
    const txt = d.length ? d.map((x) => x.text).join('；') : (st === 'none' ? '尚無資料' : '休息中');
    return `<div class="brow st-${st} f-${freshness(p)}" data-id="${id}"><span class="bn" style="--c:${f.color}">${esc(f.name)}</span>
      <span class="bt" title="${esc(txt)}">${esc(txt)}</span>
      <span class="bb">${st === 'work' ? bar(pr, 'thin') : ''}</span>
      <span class="bp">${st === 'work' ? (pr == null ? '—' : pr + '%') : ''}</span>
      <span class="bu ${freshness(p)}">${p ? esc(fmtTaipei(p._ts) || NO_DATA) + (p._src === 'data' ? ' 底稿' : '') : '無資料'}</span></div>`;
  }).join('');
}

function alertsHtml() {
  const out = [];
  for (const n of ['data', 'live', 'agents']) if (fetchState[n] === 'error') out.push(`<li class="a-err">${SRC_LABEL[n]}資料讀取失敗，畫面可能不是最新</li>`);
  if (board) {
    for (const id of [...AI_IDS, 'louis']) {
      const p = board.people[id];
      for (const w of arr(p, 'waiting_on_louis')) out.push(`<li class="a-wait"><b>${esc(BY_ID[id].name)}</b> 等你回覆：${esc(w.text)}${has(w.since) ? `<span class="muted">（${esc(w.since)}）</span>` : ''}</li>`);
    }
    for (const id of AI_IDS) {
      const p = board.people[id];
      if (p && arr(p, 'doing').length && freshness(p) === 'old') out.push(`<li class="a-stale"><b>${esc(BY_ID[id].name)}</b> 的進度已超過 2 小時沒更新或來自夜間底稿（${esc(fmtTaipei(p._ts) || NO_DATA)}），不代表目前狀態</li>`);
    }
    const none = AI_IDS.filter((id) => !board.people[id]).map((id) => BY_ID[id].name);
    if (none.length) out.push(`<li class="a-none">尚無資料：${esc(none.join('、'))}</li>`);
    const g = board.usage.grok;
    if (g && typeof g.weekly_used_percent === 'number' && g.weekly_used_percent >= 80) out.push(`<li class="a-err">Grok Bot 本週額度已用 ${Math.round(g.weekly_used_percent)}%</li>`);
  }
  return out.length ? `<ul class="alerts">${out.join('')}</ul>` : '<p class="muted">目前沒有警示</p>';
}

const fmtTok = (n) => (typeof n === 'number' && Number.isFinite(n) ? new Intl.NumberFormat('zh-TW', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : NO_DATA);
function usageHtml() {
  if (!board) return `<p class="muted">${NO_DATA}</p>`;
  const rows = [];
  const h = board.usage.hermes;
  rows.push('<h5>Air 特殊小組（Hermes，真實 token）</h5>');
  if (h && Array.isArray(h.profiles) && h.profiles.length) {
    for (const p of h.profiles) {
      const today = p.today && typeof p.today.total === 'number' ? `今日 ${fmtTok(p.today.total)}${p.today.partial && has(p.today.since) ? `（自 ${esc(fmtTaipei(p.today.since, false))} 起）` : ''}` : `今日 ${NO_DATA}`;
      rows.push(`<div class="urow"><span>${esc(p.label || p.id)}</span><b>累計 ${fmtTok(p.total)}</b><em>${today}</em></div>`);
    }
    rows.push(`<p class="src">擷取 ${esc(fmtTaipei(h.captured_at) || NO_DATA)}；累計＝輸入＋輸出（不含快取讀取）</p>`);
  } else rows.push(`<p class="muted">${NO_DATA}</p>`);
  const g = board.usage.grok;
  rows.push('<h5>Grok Bot 助理（週額度占比，非 token）</h5>');
  if (g && g.shares) {
    const lt1 = new Set(Array.isArray(g.lt1) ? g.lt1 : []);
    const cum = g.cumulative_points || {};
    rows.push(`<p class="src">本週已用 ${typeof g.weekly_used_percent === 'number' ? Math.round(g.weekly_used_percent * 10) / 10 + '%' : NO_DATA}｜重設 ${esc(fmtTaipei(g.week_reset) || NO_DATA)}｜擷取 ${esc(fmtTaipei(g.captured_at) || NO_DATA)}</p>`);
    for (const id of ['pa', 'cos', 'clo', 'cto', 'cpo', 'fpa', 'ia']) {
      const sh = g.shares[id]; const w = typeof sh === 'number' ? Math.max(0, Math.min(100, sh)) : 0;
      const c = cum[id];
      rows.push(`<div class="urow g"><span>${esc(BY_ID[id].name)}</span><b>${typeof sh === 'number' ? (lt1.has(id) ? '&lt;1%' : Math.round(sh) + '%') : NO_DATA}</b><em>累計 ${typeof c === 'number' ? Math.round(c * 10) / 10 + ' 點' : NO_DATA}</em><i class="ub"><i style="width:${w}%"></i></i></div>`);
    }
    rows.push('<p class="src">累計＝各額度週最後一筆「已用%×占比」加總（週額度百分點，估算）</p>');
  } else rows.push(`<p class="muted">${NO_DATA}</p>`);
  return rows.join('');
}

function meetingsHtml() {
  const ms = board ? board.meetings : [];
  if (!ms.length) return '<p class="muted">空閒</p>';
  return ms.map((m) => `<div class="mt"><b>${esc(m.title)}</b><span>${esc((m.members || []).map((id) => (BY_ID[id] ? BY_ID[id].name : id)).join('、'))}</span>${has(m.since) ? `<span class="muted">${esc(m.since)} 起</span>` : ''}</div>`).join('');
}

function render() {
  for (const el of document.querySelectorAll('[data-office]')) {
    const f = BY_ID[el.dataset.office]; if (f) el.innerHTML = officeHtml(f);
  }
  $('#board-rows').innerHTML = boardHtml();
  $('#alerts').innerHTML = alertsHtml();
  $('#usage').innerHTML = usageHtml();
  $('#meetings').innerHTML = meetingsHtml();
  const resting = board ? AI_IDS.filter((id) => stateOf(id) === 'rest' && !meetingOf(id)) : [];
  $('#lounge').innerHTML = resting.length ? resting.map((id) => `<span class="lp" style="--c:${BY_ID[id].color}">${avatar(BY_ID[id].g, BY_ID[id].color, 'rest')}${esc(BY_ID[id].name)}</span>`).join('') : '<span class="muted">目前沒有人</span>';
  $('#board-clock').textContent = lastChange ? `資料最後變動 ${fmtTaipei(lastChange)}` : '';
  updateLive();
  drawLines();
  const open = $('#detail').dataset.id;
  if (open && !$('#detail').hidden) showDetail(open, false);
}

function updateLive() {
  const el = $('#live'), t = $('#live-text');
  if (!pass) { el.className = 'live off'; t.textContent = '尚未解鎖'; return; }
  const bad = ['data', 'live', 'agents'].some((n) => fetchState[n] === 'error');
  el.className = `live ${bad ? 'warn' : 'on'}`;
  t.textContent = `即時更新中・每 30 秒檢查・上次 ${lastCheck ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(lastCheck) : '—'}`;
}

// ---- 組織連線（SVG，依實際版面計算） ----
function drawLines() {
  const svg = $('#org-lines'), floor = $('#floor');
  if (!svg || window.matchMedia('(max-width: 900px)').matches) { if (svg) svg.innerHTML = ''; return; }
  const fr = floor.getBoundingClientRect();
  const R = (sel) => { const e = floor.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left - fr.left, r: r.right - fr.left, t: r.top - fr.top, b: r.bottom - fr.top, cx: (r.left + r.right) / 2 - fr.left, cy: (r.top + r.bottom) / 2 - fr.top }; };
  const pa = R('.s-pa'), sp = R('.s-special'), ia = R('.s-ia'), cos = R('.s-cos'), pro = R('.s-pro');
  if (!pa || !sp || !ia || !cos || !pro) return;
  svg.setAttribute('viewBox', `0 0 ${fr.width} ${fr.height}`);
  const gx = Math.max(6, pa.l - 12), gy = Math.max(6, pa.t - 30);
  const paths = [
    [`M${pa.cx} ${pa.b} V${sp.t}`, 'solid', '直屬'],
    [`M${pa.l} ${pa.cy} H${gx} V${ia.cy} H${ia.l}`, 'dash', '稽核'],
    [`M${pa.cx} ${pa.t} V${gy} H${cos.cx} V${cos.t}`, 'dot', '平行'],
    [`M${cos.cx} ${cos.b} V${pro.t}`, 'solid', '直屬'],
  ];
  svg.innerHTML = paths.map(([d, c]) => `<path d="${d}" class="ol ${c}"/>`).join('') +
    `<text x="${(pa.cx + cos.cx) / 2}" y="${gy - 4}" class="olt">PA 與 CoS 平行協作</text>`;
}

function showDetail(id, scroll = true) {
  const f = BY_ID[id]; if (!f) return;
  const p = board && board.people[id];
  const list = (items, fn) => (items.length ? `<ul>${items.map(fn).join('')}</ul>` : `<p class="muted">${NO_DATA}</p>`);
  $('#detail').dataset.id = id;
  $('#detail-title').innerHTML = `${esc(f.name)}・${esc(f.role)}`;
  $('#detail-body').innerHTML = `<p>${updatedLine(id)} ${chatLink(id)}</p>
    <h3>正在做</h3>${list(arr(p, 'doing'), (x) => `<li>${esc(x.text)}${typeof x.progress === 'number' ? `（${x.progress}%）` : ''}<span class="muted"> ${esc(x.since || '')}</span></li>`)}
    <h3>等我回覆</h3>${list(arr(p, 'waiting_on_louis'), (x) => `<li>${esc(x.text)}<span class="muted"> ${esc(x.since || '')} 來源：${esc(x.source || NO_DATA)}</span></li>`)}
    <h3>任務流</h3>${list(arr(p, 'tasks'), (x) => `<li><span class="tag ${STATUS_TEXT[x.status] ? x.status : 'pending'}">${STATUS_TEXT[x.status] || NO_DATA}</span>${esc(x.title)}<span class="muted"> ${esc(x.time || '')}</span></li>`)}`;
  $('#detail').hidden = false;
  if (scroll) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---- 輪詢 ----
async function poll(force = false) {
  if (busy || !pass) return;
  busy = true; $('#refresh').disabled = true;
  let changed = false;
  try {
    const res = await Promise.all(FILES.map((n) => fetchEnc(n)));
    for (let i = 0; i < FILES.length; i++) {
      const n = FILES[i], r = res[i];
      fetchState[n] = r.state;
      if (r.state !== 'ok') { if (r.state === 'missing' && plain[n]) { delete plain[n]; delete enc[n]; changed = true; } continue; }
      if (!force && enc[n] && enc[n].ct === r.json.ct) continue;
      try { plain[n] = await decrypt(r.json, pass); enc[n] = r.json; changed = true; }
      catch (e) { if (n === 'data') { lockOut('通關密語已變更，請重新輸入'); return; } }
    }
    lastCheck = new Date();
    if (changed) { board = merge(); lastChange = new Date().toISOString(); }
    setStatus(fetchState.data === 'ok' || plain.data ? '' : '讀取資料失敗，稍後會自動重試');
    render();
  } finally { busy = false; $('#refresh').disabled = false; }
}
function startPolling() { stopPolling(); timer = setInterval(() => { if (document.visibilityState === 'visible') poll(); }, POLL_MS); }
function stopPolling() { if (timer) clearInterval(timer); timer = null; }
const setStatus = (m) => { $('#status').textContent = m || ''; };

function lockOut(msg) {
  pass = null; stopPolling(); board = null;
  for (const k of Object.keys(plain)) delete plain[k];
  for (const k of Object.keys(enc)) delete enc[k];
  localStorage.removeItem(LS_KEY); sessionStorage.removeItem(LS_KEY);
  $('#gate').hidden = false; $('#lock').hidden = true; setStatus(msg || '需要通關密語才能查看內容');
  render(); $('#pass').focus();
}

async function unlock(pw, remember) {
  const r = await fetchEnc('data');
  if (r.state !== 'ok') { $('#gate-msg').textContent = '目前讀不到資料檔，請稍後再試'; return false; }
  try { plain.data = await decrypt(r.json, pw); enc.data = r.json; } catch (e) { return false; }
  pass = pw;
  sessionStorage.setItem(LS_KEY, pw); if (remember) localStorage.setItem(LS_KEY, pw);
  $('#gate').hidden = true; $('#lock').hidden = false;
  board = merge(); render();
  await poll(); startPolling();
  return true;
}

$('#gate-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('#gate-msg').textContent = '解密中…';
  const ok = await unlock($('#pass').value, $('#remember').checked);
  if (ok) { $('#gate-msg').textContent = ''; $('#pass').value = ''; }
  else if ($('#gate-msg').textContent === '解密中…') $('#gate-msg').textContent = '通關密語不正確';
});
$('#refresh').addEventListener('click', () => poll(true));
$('#lock').addEventListener('click', () => { lockOut(''); location.reload(); });
$('#detail-close').addEventListener('click', () => { $('#detail').hidden = true; $('#detail').dataset.id = ''; });
$('#floor').addEventListener('click', (e) => { const o = e.target.closest('[data-id]'); if (o && !e.target.closest('a')) showDetail(o.dataset.id); });
$('#floor').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const o = e.target.closest('[data-id]'); if (o) showDetail(o.dataset.id); } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && pass) poll(); });
new ResizeObserver(() => drawLines()).observe($('#floor'));
setInterval(() => { if (pass && board) render(); }, 60000); // 只更新「幾分鐘前」

(async function init() {
  render();
  const saved = sessionStorage.getItem(LS_KEY) || localStorage.getItem(LS_KEY);
  if (saved && await unlock(saved, false)) return;
  if (saved) { localStorage.removeItem(LS_KEY); sessionStorage.removeItem(LS_KEY); }
  $('#gate').hidden = false; setStatus('需要通關密語才能查看內容'); $('#pass').focus();
})();
