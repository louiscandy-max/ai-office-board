// AI 辦公樓看板：前端只讀取加密資料檔，於瀏覽器端以通關密語解密。
// 性別（Louis 2026-11-15 指定）：只有 CTO 與 Louis 為男性，其餘助理（PA、CoS、CLO、CPO、FP&A、IA、Admin、Kobe、Fly）皆為女性。
// Louis 不再以站立人物呈現，改為中央「主位」太極核心，顯示最後來訊時間。
// 組織、職稱與線條依《AI 團隊架構協議 2.6.4 定稿》（版本代碼 261122223000）。
const PROTOCOL = '2.6.4 定稿 261122223000';
const FLOORS = [
  { id: 'louis', g: 'm', name: 'Louis（總經理）', color: 0xb8995a },
  { id: 'pa', g: 'f',  name: 'Sr. PA Ai（私人線主要 Bot）', color: 0x5f9e8a },
  { id: 'cos', g: 'f', name: 'CoS Ai（幕僚長）', color: 0xb8995a },
  { id: 'clo', g: 'f', name: 'CLO Ai（合約）', color: 0x6b7f99 },
  { id: 'cto', g: 'm', name: 'CTO Ai（規格與數量）', color: 0x3f6f8f },
  { id: 'cpo', g: 'f', name: 'CPO Ai（報價與成本）', color: 0x8a6a4a },
  { id: 'fpa', g: 'f', name: 'FP&A Ai（資金與公司利益）', color: 0x9a8a3a },
  { id: 'ia', g: 'f',  name: 'Sr. IA Ai（投資與金融稽核）', color: 0xb5443a },
  { id: 'admin', g: 'f', name: 'Admin（特殊小組・Hermes Agent 系統維護）', color: 0x4f7f6a },
  { id: 'kobe', g: 'f', name: 'Kobe（特殊小組・私人優先）', color: 0xa0524a },
  { id: 'fly', g: 'f', name: 'Fly（特殊小組・公司任務為主）', color: 0xc9a13a },
];
// 模板：A＝太極（預設）、B＝AI 科技公司。網址 ?theme=A|B 優先，其次本機記住的選擇。
const THEME_KEY = 'aiOfficeBoard.theme';
const THEME = (() => {
  const q = (new URLSearchParams(location.search).get('theme') || '').toUpperCase();
  if (q === 'A' || q === 'B') return q;
  try { const s = localStorage.getItem(THEME_KEY); if (s === 'A' || s === 'B') return s; } catch (e) { /* 無法讀取時用預設 */ }
  return 'A';
})();
const IS_B = THEME === 'B';
document.documentElement.dataset.theme = THEME;
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
let lastDataIso = null;
function setUpdated(iso) {
  lastDataIso = iso || null;
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d)) { $('#updated').textContent = `資料更新於：${NO_DATA}`; return; }
  const t = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(d);
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  const rel = m < 1 ? '剛剛' : m < 60 ? `${m} 分鐘前` : `${Math.floor(m / 60)} 小時 ${m % 60} 分前`;
  $('#updated').textContent = `資料更新於 ${t}（台北時間・${rel}最後一次狀態變更）`;
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
const POLL_MS = 10000; // 2026-11-18 即時修正：10 秒檢查（Pages 同源，無 API 額度問題）
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

/** 同時接受 people 陣列或 {id: {...}} 物件。 */
function peopleList(src) {
  const p = src && src.people;
  if (Array.isArray(p)) return p.filter((x) => x && (x.id || x.id === 0));
  if (p && typeof p === 'object') {
    return Object.entries(p).flatMap(([id, v]) => {
      if (!v || typeof v !== 'object') return [];
      const rec = { ...v, id: v.id || id };
      return rec.id ? [rec] : [];
    });
  }
  return [];
}

/** 合併：夜間底稿 ← Air 即時 ← 助理即時；每人以較新的「個人」updated_at 為準。
 *  夜間底稿常只有檔案級 updated_at、每人沒有自己的時間戳，不可因此蓋掉即時狀態。 */
function mergeAll() {
  const d = plains.data || {};
  const out = { updated_at: d.updated_at, people: [], meetings: Array.isArray(d.meetings) ? d.meetings : [], louis_active: d.louis_active || null };
  const by = {};
  for (const p of peopleList(d)) if (p && p.id) { by[p.id] = { ...p, _src: 'data', _ts: p.updated_at || d.updated_at, _personTs: !!p.updated_at }; }
  usage = { hermes: null, grok: null };
  for (const n of ['live', 'agents']) {
    const L = plains[n]; if (!L) continue;
    for (const lp of peopleList(L)) {
      if (!lp || !lp.id) continue;
      const personTs = !!lp.updated_at;
      const ts = lp.updated_at || L.updated_at, cur = by[lp.id];
      if (cur && !(cur._src === 'data' && !cur._personTs)) {
        // 底稿只有檔案時間時，不得蓋掉即時紀錄；雙方都有個人時間戳才比新舊。
        if (cur._personTs && !personTs) continue;
        if (cur._personTs === personTs) {
          const a = stampMs(ts), b = stampMs(cur._ts);
          if (b != null && (a == null || a < b)) continue;
        }
      }
      const m = { ...(cur || {}), id: lp.id, _src: n, _ts: ts, _personTs: personTs };
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
  out.people = Object.values(by).map(({ _personTs, ...rest }) => rest);
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

/** 2026-11-18 即時修正（根因：raw.githubusercontent.com/main 會忽略 ?t= 快取最多 5 分鐘；
 *  api.github.com 未登入每小時只有 60 次，30 秒一次輪詢半小時就被擋，退回 raw/main 拿到舊檔）。
 *  現在：主來源＝本站 GitHub Pages 同源檔（?t= 不快取，推送後約 25 秒更新）；
 *  輔助＝API 取 commit（最多 2 分鐘一次、被限流就等到重設）後讀 raw/<sha>（不會舊）。
 *  兩邊都抓，取信封 updated_at 最新的一份；raw/main 只在兩者都失敗時當最後備援。 */
const API_EVERY_MS = 120000;
let apiSha = null, apiNextAt = 0;
async function headSha() {
  if (Date.now() < apiNextAt) return apiSha;
  apiNextAt = Date.now() + API_EVERY_MS;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, { cache: 'no-cache', headers: { Accept: 'application/vnd.github.sha' } });
    if (r.ok) { const t = (await r.text()).trim(); if (/^[0-9a-f]{40}$/.test(t)) apiSha = t; }
    else if (r.status === 403 || r.status === 429) {
      const reset = Number(r.headers.get('X-RateLimit-Reset'));
      if (Number.isFinite(reset) && reset > 0) apiNextAt = Math.max(apiNextAt, reset * 1000 + 1000);
      else apiNextAt = Date.now() + 15 * 60000;
    }
  } catch (e) { /* 只靠 Pages */ }
  return apiSha;
}
async function getEnc(u, noStore) {
  try {
    const r = await fetch(u, { cache: noStore ? 'no-store' : 'default' });
    if (r.status === 404) return { state: 'missing' };
    if (!r.ok) return { state: 'error' };
    const j = await r.json();
    return j && j.ct ? { state: 'ok', json: j } : { state: 'error' };
  } catch (e) { return { state: 'error' }; }
}
async function fetchEnc(name, sha) {
  const t = Date.now();
  const cands = [getEnc(`${name}.enc.json?t=${t}`, true)];
  if (sha) cands.push(getEnc(`https://raw.githubusercontent.com/${REPO}/${sha}/${name}.enc.json`, false));
  const res = await Promise.all(cands);
  let best = null;
  for (const r of res) {
    if (r.state !== 'ok') continue;
    if (!best || (stampMs(r.json.updated_at) || 0) > (stampMs(best.json.updated_at) || 0)) best = r;
  }
  if (best) return best;
  const last = await getEnc(`https://raw.githubusercontent.com/${REPO}/main/${name}.enc.json?t=${t}`, true);
  if (last.state === 'ok') return last;
  return { state: res.every((r) => r.state === 'missing') ? 'missing' : 'error' };
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
  $('#live-text').textContent = !pass ? '尚未解鎖' : `即時更新中・每 10 秒檢查・上次 ${lastCheck ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(lastCheck) : '—'}`;
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
for (const [btnId, t] of [['#theme-a', 'A'], ['#theme-b', 'B']]) {
  const btn = $(btnId); if (!btn) continue;
  btn.classList.toggle('on', THEME === t); btn.setAttribute('aria-pressed', THEME === t ? 'true' : 'false');
  btn.addEventListener('click', () => {
    if (THEME === t) return;
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* 無法記住時仍以網址切換 */ }
    const u = new URL(location.href); u.searchParams.set('theme', t); location.href = u.toString();
  });
}
if (IS_B) {
  const lg = $('.legend');
  if (lg) lg.innerHTML = '藍天綠地 AI 科技開放式辦公：<b>中央走道</b> 直通後牆嵌入式全員看板，盡頭是 <b>總經理指揮台</b>（Louis 最後來訊時間，一小時內有來訊即發光）<br><b>走道左側</b> 私人線：PA、特殊小組（Admin、Kobe、Fly）、IA｜<b>走道右側</b> 公司線：CoS、CTO、CPO、CLO、FP&amp;A（兩側面對面、朝向走道）<br>兩側玻璃會議室（左＝私人線、右＝公司線）・機房・專注艙・咖啡吧・休息區<br><b>可愛版 Louis</b> 會主動找休息中的成員打招呼；休息中的成員也會在咖啡吧、休息區一起喝咖啡聊 AI 趨勢（工作中、會議中的成員不參加）<br><b>藍色實線</b>：直屬上下級（箭頭指向下級）｜<b>橘色虛線</b>：平行、稽核、確認（PA 與 CoS 平行；特殊小組金融性產出交 IA 稽核；IA 報告由 PA 審核；CoS 協調、經 PA 同意由 Fly 支援公司任務）<br>依《AI 團隊架構協議 ' + PROTOCOL + '》';
  const wrap = $('#building-wrap');
  if (wrap && !$('.org-key')) { const k = document.createElement('div'); k.className = 'org-key'; k.innerHTML = '<b>組織架構</b><span><i class="k-sol"></i>實線＝直屬上下級</span><span><i class="k-dsh"></i>虛線＝平行、稽核、確認</span><span>協議 ' + PROTOCOL + '</span>'; wrap.appendChild(k); }
  const bw = $('#building'); if (bw) bw.setAttribute('aria-label', '三維 AI 科技公司辦公區總覽');
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && pass) poll(false); });
setInterval(() => { if (pass && people) { render(); setUpdated(lastDataIso); } }, 60000);

// ---------- 三維太極辦公層（同一層、圓形對稱） ----------
// 左半為陽（私人線），右半為陰（公司線）；中央為 Louis 主位（太極核心），後方為全員即時看板牆。
const CZ = 0.2;          // 圓心 z
const RING_R = 5.7;      // 工位所在圓半徑
const PLAT_R = 7.6;      // 圓形平台半徑
const SEAT_DEG = { ia: -28, pa: -62, admin: -98, kobe: -131, fly: -163, clo: 28, cos: 62, cto: 98, cpo: 131, fpa: 163 };
const TAG = {
  louis: ['Louis', '總經理'], pa: ['PA', '私人線主要 Bot'], cos: ['CoS', '幕僚長'], clo: ['CLO', '合約'], cto: ['CTO', '規格與數量'],
  cpo: ['CPO', '報價與成本'], fpa: ['FP&A', '資金與公司利益'], ia: ['IA', '投資與金融稽核'], admin: ['Admin', '系統維護'], kobe: ['Kobe', '私人優先'], fly: ['Fly', '公司任務為主'],
};
const PERSONAL = new Set(['pa', 'ia', 'admin', 'kobe', 'fly']);
const INK = 0x2f2d2a, PAPER = 0xf1ede4, GOLD = 0xb8995a, JADE = 0x5f9e8a, CINNABAR = 0xb5443a;
const BOARD = { x: 0, y: 2.95, z: -9.25, w: 7.6, h: 4.75 };
const DS = 1.22; // 工位與人物放大倍率
const ACT = IS_B ? 0x38c8ff : JADE, ACT_E = IS_B ? 0x5fdcff : 0x6fd0ae, IDLE = IS_B ? 0x4a5a72 : 0x8a8478;
const PAL = IS_B
  ? { bg0: '#0b1426', bg1: '#060b16', ink: '#eaf4ff', muted: '#8ea3bf', dim: '#6c7f99', faint: '#3d4c63', foot: '#4f6079', acc: '#38c8ff', accA: 'rgba(56,200,255,.5)', dotP: '#38c8ff', dotC: '#a78bfa', sub2: '#b9c9de', alertTxt: '#dde8f5', bar: '#38c8ff', active: '#5fe3c0',
      lblBg: 'rgba(255,255,255,.96)', lblSelBg: 'rgba(222,241,255,.98)', lblBorder: '#2f9be8', lblSelBorder: '#1f6fbf', lblFg: '#12324f', lblSelFg: '#0b2540', lblSub: '#3d5a75', lblSelSub: '#2c4a66',
      coreBg: 'rgba(255,255,255,.96)', coreSelBg: 'rgba(222,241,255,.98)', coreAct: '#2fae6a', coreIdle: '#2f9be8', coreTitle: '#12324f', coreLineAct: '#1d7a4a', coreLine: '#3d5a75', coreTip: '#5d7891',
      meetBg: 'rgba(255,255,255,.95)', meetIdle: '#2f9be8', meetIdleTxt: '#3d5a75', meetTitle: '#12324f', meetFree: '全像會議室・空閒',
      signBg: 'rgba(255,255,255,.95)', signBorder: '#3fb56b', signTxt: '#1d4a2e', freshTxt: { fresh: '#1d7a4a', warm: '#9a6400', old: '#5d6b7a', none: '#5d6b7a' }, meetTxt: '#b26a00', track: 'rgba(18,50,79,.14)' }
  : { bg0: '#191816', bg1: '#100f0e', ink: '#f4f1ea', muted: '#a49d90', dim: '#8a8478', faint: '#5a554d', foot: '#6a655c', acc: '#b8995a', accA: 'rgba(184,153,90,.5)', dotP: '#f2eee5', dotC: '#4a4640', sub2: '#c9c2b4', alertTxt: '#e8e3d8', bar: '#7fc4a8', active: '#6fd0ae',
      lblBg: 'rgba(28,27,25,.9)', lblSelBg: 'rgba(234,246,240,.97)', lblBorder: '#b8995a', lblSelBorder: '#5f9e8a', lblFg: '#f4f1ea', lblSelFg: '#1c1b19', lblSub: '#c9c2b4', lblSelSub: '#3a3632',
      coreBg: 'rgba(247,244,236,.94)', coreSelBg: 'rgba(234,246,240,.97)', coreAct: '#5f9e8a', coreIdle: '#b8995a', coreTitle: '#1c1b19', coreLineAct: '#2f7a63', coreLine: '#5a554d', coreTip: '#8a8478',
      meetBg: 'rgba(28,27,25,.9)', meetIdle: '#b8995a', meetIdleTxt: '#c9c2b4', meetTitle: '#f4f1ea', meetFree: '會議室・空閒',
      signBg: 'rgba(242,238,229,.95)', signBorder: '#b8995a', signTxt: '#2a2723' };

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
    scene.background = new THREE.Color(IS_B ? 0xbfe2ff : 0xe9e5dc);
    scene.fog = new THREE.Fog(IS_B ? 0x060b16 : 0xe9e5dc, 34, 70);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, IS_B ? 400 : 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.enablePan = false;
    controls.minDistance = 3; controls.maxDistance = IS_B ? 72 : 46;
    controls.maxPolarAngle = Math.PI * 0.5; // 允許水平視角，看板模式才能正對不變形
    controls.autoRotateSpeed = 0.4;
    scene.add(IS_B ? new THREE.HemisphereLight(0xe6f4ff, 0x9ccf8a, 1.35) : new THREE.HemisphereLight(0xfffdf6, 0x8a8478, 1.25));
    const sun = new THREE.DirectionalLight(IS_B ? 0xfff9ee : 0xfff8ec, IS_B ? 1.25 : 1.1); sun.position.set(5, 16, 12); scene.add(sun);
    const fill = new THREE.DirectionalLight(IS_B ? 0xcfe8ff : 0xe6eef0, IS_B ? 0.45 : 0.45); fill.position.set(-9, 8, -6); scene.add(fill);

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
    const ringPt = (deg, dr = 0) => P(deg, RING_R + dr);

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

    const B = IS_B ? buildThemeB() : null; // 模板 B 的共用素材與場景（見下方）
    // 外圍石板地
    if (!IS_B) {
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
    if (!IS_B) {
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
    const TOP = IS_B ? 0.02 : 0.14; // 平台頂面高度（模板 B 為整片架高地板）

    // ---------- 模板 B：AI 科技公司（矩形開放式辦公：中央走道直通後牆看板、兩側長桌工作區、玻璃會議室、機房、專注艙、咖啡吧、休息區） ----------
    function buildThemeB() {
      const T0 = 0.02; // 架高地板頂面（與 TOP 相同）
      const CY = 0x2f9be8, VI = 0x3fb56b;
      const glow = (color, k = 1) => new THREE.MeshStandardMaterial({ color: 0x0a0f18, emissive: color, emissiveIntensity: k, roughness: 0.4 });
      const glass = (op = 0.14, color = 0x9fdcff) => new THREE.MeshStandardMaterial({ color, transparent: true, opacity: op, roughness: 0.08, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
      const metal = M(0x9aa6b8, { metalness: 0.7, roughness: 0.3 });
      const blink = [], spin = [];
      let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      // 走道兩旁面對面：左＝個人側一列、右＝公司側一列，人與桌都朝向中央走道；主管（PA、CoS）最靠近總經理指揮台
      const PI = Math.PI, DX = 3.45, RZ = [-2.9, -0.95, 1.0, 2.95, 4.9];
      const SEATS = {
        pa: { x: -DX, z: RZ[0], yaw: PI / 2 }, admin: { x: -DX, z: RZ[1], yaw: PI / 2 }, kobe: { x: -DX, z: RZ[2], yaw: PI / 2 }, fly: { x: -DX, z: RZ[3], yaw: PI / 2 }, ia: { x: -DX, z: RZ[4], yaw: PI / 2 },
        cos: { x: DX, z: RZ[0], yaw: -PI / 2 }, cto: { x: DX, z: RZ[1], yaw: -PI / 2 }, cpo: { x: DX, z: RZ[2], yaw: -PI / 2 }, clo: { x: DX, z: RZ[3], yaw: -PI / 2 }, fpa: { x: DX, z: RZ[4], yaw: -PI / 2 },
      };
      const CORE = { x: 0, z: -5.3 };                      // 總經理指揮台：走道盡頭、看板正前方（位置不變）
      // 寬闊島嶼規劃：地坪約 32.0×29.5（寬深各放大約 39%／38%）；各區維持 4.60×3.80，以 1.5 以上間距分開，不共牆
      const FW = 32.0, FD = 29.5, FX0 = -16.0, FX1 = 16.0, FZ0 = -11.5, FZ1 = 18.0, FLZ = (FZ0 + FZ1) / 2;
      const AISLE = 1.20;                                   // 中央主走道半寬，全寬 2.40，由下方入口直通後牆
      const RX0 = 8.00, RX1 = 12.60, RW = RX1 - RX0, RD = 3.80; // 外圍島（會議室／咖啡吧／專注艙／休息區）
      const SVX0 = -10.80, SVX1 = -6.20;                    // 機房：左上內側角落、獨立靠牆（與廣場間隔 1.20）
      const SVZ0 = -9.25, SVZ1 = SVZ0 + RD;                 // 機房 -9.25 .. -5.45
      const MEET_L_Z0 = -3.40, MEET_L_Z1 = MEET_L_Z0 + RD;  // 個人側會議室（中段）-3.40 .. 0.40
      const BOOTH_Z0 = -3.40, BOOTH_Z1 = BOOTH_Z0 + RD;     // 公司側專注艙（中段）-3.40 .. 0.40
      const MEET_R_Z0 = 1.90, MEET_R_Z1 = MEET_R_Z0 + RD;   // 公司側會議室（中段靠入口）1.90 .. 5.70
      const FRONT_Z0 = 10.50, FRONT_Z1 = FRONT_Z0 + RD;     // 咖啡吧／休息區（入口端）10.50 .. 14.30
      const WX0 = 2.70, WX1 = 6.20, WZ0 = -4.10, WZ1 = 5.60; // 工位獨立島 3.50×9.70；與主走道隔 1.50 次走道
      const ROOMX = (RX0 + RX1) / 2, FRONTZ = (FRONT_Z0 + FRONT_Z1) / 2;
      const MEET_LZ = (MEET_L_Z0 + MEET_L_Z1) / 2, MEET_RZ = (MEET_R_Z0 + MEET_R_Z1) / 2;
      const BOOTHZ = (BOOTH_Z0 + BOOTH_Z1) / 2, REARZ = (SVZ0 + SVZ1) / 2, SVCX = (SVX0 + SVX1) / 2;
      const ROOMS = { left: { x: -ROOMX, z: MEET_LZ, name: '私人線會議室' }, right: { x: ROOMX, z: MEET_RZ, name: '公司線會議室' } };

      // 天空：藍天漸層背景＋緩慢飄動的白雲
      const clouds = [];
      {
        const cv = document.createElement('canvas'); cv.width = 16; cv.height = 512;
        const c = cv.getContext('2d'), g = c.createLinearGradient(0, 0, 0, 512);
        g.addColorStop(0, '#3f97e6'); g.addColorStop(0.55, '#86c4f5'); g.addColorStop(1, '#dff1ff'); c.fillStyle = g; c.fillRect(0, 0, 16, 512);
        scene.background = canvasTex(cv);
        scene.fog = new THREE.Fog(0xd6ecff, 80, 220);
        const cc = document.createElement('canvas'); cc.width = 512; cc.height = 256;
        const k = cc.getContext('2d');
        for (let i = 0; i < 14; i++) {
          const x = 90 + rnd() * 330, y = 120 + (rnd() - 0.5) * 70, r = 40 + rnd() * 60;
          const gg = k.createRadialGradient(x, y, 0, x, y, r); gg.addColorStop(0, 'rgba(255,255,255,.95)'); gg.addColorStop(0.6, 'rgba(255,255,255,.75)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
          k.fillStyle = gg; k.beginPath(); k.arc(x, y, r, 0, Math.PI * 2); k.fill();
        }
        const ct = canvasTex(cc);
        for (let i = 0; i < 16; i++) {
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: 0.85 + rnd() * 0.15 }));
          const w = 10 + rnd() * 12; s.scale.set(w, w / 2, 1);
          const side = i % 4;
          const base = side < 2 ? { x: -45 + rnd() * 90, y: 3.5 + rnd() * 6, z: -24 - rnd() * 22 } : { x: (side === 2 ? -1 : 1) * (15 + rnd() * 10), y: -5 + rnd() * 6, z: -12 + rnd() * 26 };
          s.position.set(base.x, base.y, base.z); scene.add(s);
          clouds.push({ s, base, sp: 0.25 + rnd() * 0.35 });
        }
      }

      // 地板：草地（兩區不同綠色）、中央淺色石板步道、白色與淺綠細線（全部沿走道方向）
      {
        const S = 2048, cv = document.createElement('canvas'); cv.width = cv.height = S;
        const c = cv.getContext('2d');
        const X = (x) => (x - FX0) / FW * S, Y = (z) => (z - FZ0) / FD * S, U = S / FW;
        const grass = (x0, z0, x1, z1, base, tones, n) => {
          c.fillStyle = base; c.fillRect(X(x0), Y(z0), X(x1) - X(x0), Y(z1) - Y(z0));
          for (let i = 0; i < n; i++) { c.fillStyle = tones[(rnd() * tones.length) | 0]; c.fillRect(X(x0) + rnd() * (X(x1) - X(x0)), Y(z0) + rnd() * (Y(z1) - Y(z0)), 2, 4 + rnd() * 5); }
        };
        grass(FX0, FZ0, FX1, FZ1, '#86c96a', ['#79bd5e', '#93d575', '#6fb455', '#a0dc80'], 140000);
        const stone = (x0, z0, x1, z1, col, joint, step = 1.0) => {
          c.fillStyle = col; c.fillRect(X(x0), Y(z0), X(x1) - X(x0), Y(z1) - Y(z0));
          c.strokeStyle = joint; c.lineWidth = 2;
          for (let z = z0; z <= z1 + 0.01; z += step) { c.beginPath(); c.moveTo(X(x0), Y(z)); c.lineTo(X(x1), Y(z)); c.stroke(); }
          for (let x = x0; x <= x1 + 0.01; x += step * 1.6) { c.beginPath(); c.moveTo(X(x), Y(z0)); c.lineTo(X(x), Y(z1)); c.stroke(); }
        };
        const strip = (x0, z0, x1, z1, col = '#f3efe6', joint = 'rgba(170,160,140,.4)', step = 0.9) => stone(x0, z0, x1, z1, col, joint, step);
        // 工作島：兩種綠色草坪，白色收邊；與主走道之間的次走道用較淺的綠
        grass(-2.70, WZ0, -AISLE, WZ1, '#b7e39a', ['#a8db8c', '#c3eba6', '#9cd483'], 5000);
        grass(AISLE, WZ0, 2.70, WZ1, '#b7e39a', ['#a8db8c', '#c3eba6', '#9cd483'], 5000);
        grass(-WX1, WZ0, -WX0, WZ1, '#a3db84', ['#98d379', '#aee38f', '#8fcb70'], 16000);
        grass(WX0, WZ0, WX1, WZ1, '#6fbf7c', ['#64b471', '#7aca87', '#5aa968'], 16000);
        c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = 5; c.strokeRect(X(-WX1), Y(WZ0), X(-WX0) - X(-WX1), Y(WZ1) - Y(WZ0)); c.strokeRect(X(WX0), Y(WZ0), X(WX1) - X(WX0), Y(WZ1) - Y(WZ0));
        // 看板前石板廣場、中央主走道（2.4 寬，直通入口）、入口放大石板、通往各島的步道
        stone(-5.0, -9.25, 5.0, -4.25, '#ece8df', 'rgba(170,160,140,.35)', 1.2);
        stone(-AISLE, -4.25, AISLE, 15.80, '#f3efe6', 'rgba(170,160,140,.4)', 1.0);
        stone(-2.05, 15.80, 2.05, 17.70, '#efe8d8', 'rgba(170,160,140,.45)', 0.8);
        // 各功能島地坪
        stone(SVX0, SVZ0, SVX1, SVZ1, '#dfe4ea', 'rgba(140,150,165,.4)', 0.6);
        stone(-RX1, MEET_L_Z0, -RX0, MEET_L_Z1, '#e8eef4', 'rgba(140,150,165,.3)', 0.7);
        stone(RX0, BOOTH_Z0, RX1, BOOTH_Z1, '#e6e9ee', 'rgba(140,150,165,.35)', 0.6);
        stone(RX0, MEET_R_Z0, RX1, MEET_R_Z1, '#e8eef4', 'rgba(140,150,165,.3)', 0.7);
        c.fillStyle = '#e2cfa9'; c.fillRect(X(-RX1), Y(FRONT_Z0), X(-RX0) - X(-RX1), Y(FRONT_Z1) - Y(FRONT_Z0));
        c.strokeStyle = 'rgba(150,115,70,.35)'; c.lineWidth = 2; for (let z = FRONT_Z0; z <= FRONT_Z1 + 0.01; z += 0.25) { c.beginPath(); c.moveTo(X(-RX1), Y(z)); c.lineTo(X(-RX0), Y(z)); c.stroke(); }
        stone(RX0, FRONT_Z0, RX1, FRONT_Z1, '#eef0ea', 'rgba(160,170,150,.35)', 0.9);
        // 通往各島的淺色步道（寬約 0.9）
        strip(-5.0, REARZ - 0.45, SVX1, REARZ + 0.45);                         // 廣場 → 機房
        strip(-RX0, MEET_LZ - 0.45, -WX1, MEET_LZ + 0.45);                      // 工位島 → 個人側會議室
        strip(WX1, BOOTHZ - 0.45, RX0, BOOTHZ + 0.45);                          // 工位島 → 專注艙
        strip(WX1, MEET_RZ - 0.45, RX0, MEET_RZ + 0.45);                        // 工位島 → 公司側會議室
        strip(-RX0, FRONTZ - 0.45, -AISLE, FRONTZ + 0.45);                      // 主走道 → 咖啡吧
        strip(AISLE, FRONTZ - 0.45, RX0, FRONTZ + 0.45);                        // 主走道 → 休息區
        c.fillStyle = 'rgba(110,140,170,.22)'; for (let z = -4; z < 15.6; z += 1.4) { c.beginPath(); c.moveTo(X(-0.55), Y(z + 0.55)); c.lineTo(X(0), Y(z)); c.lineTo(X(0.55), Y(z + 0.55)); c.lineTo(X(0.55), Y(z + 0.85)); c.lineTo(X(0), Y(z + 0.3)); c.lineTo(X(-0.55), Y(z + 0.85)); c.closePath(); c.fill(); }
        const trace = (pts, col, w) => {
          c.lineJoin = 'miter'; c.lineCap = 'square';
          for (const [lw, a] of [[w * 3, 0.25], [w, 0.95]]) {
            c.strokeStyle = col.replace('A', a); c.lineWidth = lw; c.beginPath();
            pts.forEach(([x, z], i) => (i ? c.lineTo(X(x), Y(z)) : c.moveTo(X(x), Y(z)))); c.stroke();
          }
          const [ex, ez] = pts[pts.length - 1]; c.fillStyle = col.replace('A', 1); c.fillRect(X(ex) - w * 2.2, Y(ez) - w * 2.2, w * 4.4, w * 4.4);
        };
        const WH = 'rgba(255,255,255,A)', LG2 = 'rgba(222,255,205,A)';
        trace([[-1.35, 17.5], [-1.35, -4.55], [-0.7, -4.55]], WH, 3); trace([[1.35, 17.5], [1.35, -4.55], [0.7, -4.55]], LG2, 3);
        const inPad = (x, z, a, b, c0, d0, m = 0.25) => x >= a - m && x <= b + m && z >= c0 - m && z <= d0 + m;
        for (let i = 0; i < 70; i++) {
          let x = FX0 + 0.8 + rnd() * (FW - 1.6), z = FZ0 + 0.8 + rnd() * (FD - 1.6);
          const inSide = inPad(x, z, -RX1, -RX0, MEET_L_Z0, MEET_L_Z1) || inPad(x, z, -RX1, -RX0, FRONT_Z0, FRONT_Z1)
            || inPad(x, z, SVX0, SVX1, SVZ0, SVZ1)
            || inPad(x, z, RX0, RX1, BOOTH_Z0, BOOTH_Z1) || inPad(x, z, RX0, RX1, MEET_R_Z0, MEET_R_Z1) || inPad(x, z, RX0, RX1, FRONT_Z0, FRONT_Z1);
          if ((Math.abs(x) < 5.2 && z < -4.15) || Math.abs(x) < AISLE + 0.55 || (Math.abs(x) >= WX0 - 0.2 && Math.abs(x) <= WX1 + 0.2 && z >= WZ0 - 0.2 && z <= WZ1 + 0.2) || inSide) continue;
          const pts = [[x, z]];
          for (let k = 0; k < 3; k++) { const d = 0.5 + rnd() * 1.4; if (k % 2) x += (rnd() < 0.5 ? -d : d); else z += (rnd() < 0.5 ? -d : d); pts.push([x, z]); }
          trace(pts, 'rgba(255,255,255,A)', 1.2);
        }
        // 地面分區字樣（深綠字＋白邊）
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
        const label = (t, x, z, size, col) => { c.font = `bold ${Math.round(U * size)}px ${SANS}`; c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = U * size * 0.16; c.strokeText(t, X(x), Y(z)); c.fillStyle = col; c.fillText(t, X(x), Y(z)); };
        label('入口', 0, 16.55, 0.58, '#1d4a2e');
        label('私人線', -4.40, 7.45, 0.62, '#1f5f99'); label('公司線', 4.40, 7.45, 0.62, '#1d6b3c');
        label('PA・Admin・Kobe・Fly・IA', -4.40, 8.10, 0.26, '#2c4a66'); label('CoS・CTO・CPO・CLO・FP&A', 4.40, 8.10, 0.26, '#2c4a66');
        // 組織架構線：畫在略高於地面的透明層，幹線外移到椅背外側，避免坐著的人擋住
        const ov = document.createElement('canvas'); ov.width = ov.height = S;
        const o = ov.getContext('2d');
        const SOL = '#1b5fae', DSH = '#ff7a14';
        const org = (pts, col, dashed, arrow) => {
          o.lineJoin = 'round'; o.lineCap = 'round';
          o.setLineDash([]); o.strokeStyle = 'rgba(255,255,255,.95)'; o.lineWidth = U * 0.30; o.beginPath(); pts.forEach(([x, z], i) => (i ? o.lineTo(X(x), Y(z)) : o.moveTo(X(x), Y(z)))); o.stroke();
          o.setLineDash(dashed ? [U * 0.34, U * 0.2] : []); o.lineCap = dashed ? 'butt' : 'round'; o.strokeStyle = col; o.lineWidth = U * 0.18; o.beginPath(); pts.forEach(([x, z], i) => (i ? o.lineTo(X(x), Y(z)) : o.moveTo(X(x), Y(z)))); o.stroke();
          o.setLineDash([]);
          if (arrow) { const [ax, az] = pts[pts.length - 1], [bx, bz] = pts[pts.length - 2], a = Math.atan2(Y(az) - Y(bz), X(ax) - X(bx)), L = U * 0.46, Wd = U * 0.30;
            o.save(); o.translate(X(ax), Y(az)); o.rotate(a); o.fillStyle = col; o.strokeStyle = 'rgba(255,255,255,.95)'; o.lineWidth = U * 0.05;
            o.beginPath(); o.moveTo(0, 0); o.lineTo(-L, -Wd); o.lineTo(-L, Wd); o.closePath(); o.stroke(); o.fill(); o.restore(); }
        };
        const tag = (t, x, z, col) => { o.font = `bold ${Math.round(U * 0.3)}px ${SANS}`; o.strokeStyle = 'rgba(255,255,255,.95)'; o.lineWidth = U * 0.07; o.strokeText(t, X(x), Y(z)); o.fillStyle = col; o.fillText(t, X(x), Y(z)); };
        const BK = DX + 1.20, TR = DX + 1.95, TR2 = DX + 2.55; // 外移至椅背外側：4.65／5.40／6.00
        for (const sg of [-1, 1]) {
          // Louis → PA／CoS（自指揮台兩端走到主管桌側）
          org([[sg * 1.5, CORE.z], [sg * DX, CORE.z], [sg * DX, RZ[0] - 1.05]], SOL, false, true);
          // 主管 → 下級（椅背後方幹線，分支箭頭指向各下級）
          const subs = sg < 0 ? RZ.slice(1, 4) : RZ.slice(1, 5);
          org([[sg * BK, RZ[0]], [sg * TR, RZ[0]], [sg * TR, subs[subs.length - 1]]], SOL, false, false);
          for (const z of subs) org([[sg * TR, z], [sg * (BK - 0.05), z]], SOL, false, true);
        }
        // CoS ↔ PA 平行（跨走道，畫在次走道上以免被桌子擋住）
        org([[-(DX - 1.2), RZ[0]], [DX - 1.2, RZ[0]]], DSH, true, false); tag('平行', 0, RZ[0] - 0.42, '#c25a00');
        // 協議 2.6.4：IA 報告由 PA 審核（外側虛線幹線，箭頭指向 PA：IA 稽核後交 PA 核實）；IA 不是 PA 的下級
        org([[-BK, RZ[4]], [-TR2, RZ[4]], [-TR2, RZ[0] - 0.5], [-BK, RZ[0] - 0.5]], DSH, true, true);
        // 特殊小組（Admin、Kobe、Fly）金融性產出 → IA 稽核
        org([[-(BK + 0.15), RZ[1] + 0.35], [-(BK + 0.15), RZ[4] - 0.4]], DSH, true, true);
        // CoS 協調、經 PA 同意 → Fly 支援公司任務（次走道虛線，跨主走道）
        org([[DX - 1.2, RZ[0] + 0.45], [DX - 1.2, RZ[3] - 0.25], [-(DX - 1.2), RZ[3] - 0.25]], DSH, true, true); tag('經 PA 同意支援公司任務', 0, RZ[3] - 0.62, '#c25a00');
        o.save(); o.translate(X(-TR2 - 0.38), Y((RZ[1] + RZ[2]) / 2)); o.rotate(-Math.PI / 2); o.font = `bold ${Math.round(U * 0.3)}px ${SANS}`; o.strokeStyle = 'rgba(255,255,255,.95)'; o.lineWidth = U * 0.07; o.strokeText('IA 報告由 PA 審核', 0, 0); o.fillStyle = '#c25a00'; o.fillText('IA 報告由 PA 審核', 0, 0); o.restore();
        tag('直屬', -(TR + 0.05), RZ[0] - 0.45, SOL); tag('直屬', TR + 0.05, RZ[0] - 0.45, SOL);
        const tex = canvasTex(cv);
        const fl = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.14, roughness: 0.92, metalness: 0 }));
        flat(fl, T0 + 0.001); fl.position.z = FLZ; scene.add(fl);
        const otex = canvasTex(ov);
        const orgFl = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), new THREE.MeshStandardMaterial({ map: otex, transparent: true, depthWrite: false, roughness: 0.55, metalness: 0, emissive: 0xffffff, emissiveMap: otex, emissiveIntensity: 0.45 }));
        flat(orgFl, T0 + 0.04); orgFl.position.z = FLZ; orgFl.renderOrder = 3; scene.add(orgFl);
        box(FW + 0.2, 0.3, FD + 0.2, M(0xb5c7aa, { roughness: 0.9 }), 0, T0 - 0.151, FLZ, scene);
        box(FW + 0.2, 0.03, 0.04, glow(CY, 1.0), 0, T0, FZ1 + 0.02, scene);
        const aisleLen = 20.1, aisleMid = 5.75;
        for (const sx of [-AISLE, AISLE]) box(0.05, 0.02, aisleLen, glow(sx < 0 ? CY : VI, 1.2), sx, T0 + 0.01, aisleMid, scene);
      }
      // 兩側落地窗：白天的藍天、白雲與綠地
      {
        const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 356;
        const c = cv.getContext('2d'), W = cv.width, H = cv.height;
        const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#4fa3ea'); g.addColorStop(0.65, '#a9d8fb'); g.addColorStop(1, '#e3f4ff'); c.fillStyle = g; c.fillRect(0, 0, W, H);
        for (let i = 0; i < 26; i++) { const x = rnd() * W, y = 30 + rnd() * 120, r = 18 + rnd() * 34; const gg = c.createRadialGradient(x, y, 0, x, y, r); gg.addColorStop(0, 'rgba(255,255,255,.95)'); gg.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gg; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
        c.fillStyle = '#8fc98a'; c.beginPath(); c.moveTo(0, H); for (let x = 0; x <= W; x += 32) c.lineTo(x, H * 0.72 - Math.sin(x / 260) * 22 - Math.sin(x / 97) * 8); c.lineTo(W, H); c.closePath(); c.fill();
        c.fillStyle = '#6db45f'; c.beginPath(); c.moveTo(0, H); for (let x = 0; x <= W; x += 32) c.lineTo(x, H * 0.82 - Math.sin(x / 180 + 1) * 14); c.lineTo(W, H); c.closePath(); c.fill();
        for (let x = 20; x < W; x += 50 + rnd() * 70) { const ty = H * 0.8 + rnd() * 20, r = 16 + rnd() * 14; c.fillStyle = '#7a5a3a'; c.fillRect(x - 3, ty, 6, 22); c.fillStyle = rnd() < 0.5 ? '#3f9a4f' : '#56ad5c'; c.beginPath(); c.arc(x, ty - r * 0.4, r, 0, Math.PI * 2); c.fill(); }
        c.fillStyle = '#f4f7fa'; for (let x = 0; x <= W; x += W / 16) c.fillRect(x - 4, 0, 8, H);
        const tex = canvasTex(cv);
        const WINL = 24.0, WINX = 15.94, WINZ = 3.75;
        for (const sx of [-1, 1]) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(WINL, 3.4), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.2 }));
          m.position.set(sx * WINX, T0 + 1.7, WINZ); m.rotation.y = -sx * PI / 2; scene.add(m);
          box(0.1, 0.08, WINL, M(0xf4f7fa), sx * WINX, T0 + 3.43, WINZ, scene);
          box(0.12, 0.1, WINL, M(0xdde5ee), sx * (WINX + 0.02), T0 + 0.05, WINZ, scene);
        }
      }
      // 入口門框（下方中央）
      {
        for (const sx of [-1, 1]) {
          box(0.16, 2.2, 0.16, M(0xf4f7fa), sx * 2.05, T0 + 1.1, 17.15, scene);
          box(0.22, 0.06, 0.22, glow(sx < 0 ? CY : VI, 1.1), sx * 2.05, T0 + 2.22, 17.15, scene);
        }
        box(4.26, 0.08, 0.12, M(0xdde5ee), 0, T0 + 2.35, 17.15, scene);
        box(4.26, 0.03, 0.04, glow(CY, 1.0), 0, T0 + 2.41, 17.15, scene);
      }

      // 後牆：嵌入式平面看板（與牆面齊平、正對前方）＋神經網路圖樣
      function wall(bigTex) {
        const wf = BOARD.z; // 牆面正面
        const WW = 32.2, WH = 6.9;
        box(WW, WH, 0.3, M(0xf2f6fa, { roughness: 0.6 }), 0, T0 + WH / 2, wf - 0.15, scene);
        const cv = document.createElement('canvas'); cv.width = 3072; cv.height = Math.round(3072 * WH / WW);
        const c = cv.getContext('2d'), W = cv.width, H = cv.height;
        const X = (x) => (x + WW / 2) / WW * W, Yy = (y) => (1 - (y - T0) / WH) * H;
        const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#fbfdff'); g.addColorStop(1, '#e6f1fb'); c.fillStyle = g; c.fillRect(0, 0, W, H);
        // 細網格
        c.strokeStyle = 'rgba(47,155,232,.07)'; c.lineWidth = 1;
        for (let x = 0; x < W; x += 34) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
        for (let y = 0; y < H; y += 34) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
        // 神經網路（左右兩區）
        const net = (x0, x1, flip) => {
          const layers = [4, 6, 6, 3], y0 = Yy(5.6), y1 = Yy(0.9), nodes = layers.map((n, li) => Array.from({ length: n }, (_, k) => ({ x: x0 + (x1 - x0) * (flip ? 1 - li / (layers.length - 1) : li / (layers.length - 1)), y: y0 + (y1 - y0) * (k + 0.5) / n })));
          for (let li = 0; li < nodes.length - 1; li++) for (const a of nodes[li]) for (const b2 of nodes[li + 1]) {
            c.strokeStyle = `rgba(${rnd() < 0.5 ? '47,155,232' : '63,181,107'},${0.15 + rnd() * 0.3})`; c.lineWidth = 2; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.stroke();
          }
          for (const L of nodes) for (const n of L) {
            const gg = c.createRadialGradient(n.x, n.y, 0, n.x, n.y, 30); gg.addColorStop(0, 'rgba(47,155,232,.45)'); gg.addColorStop(1, 'rgba(47,155,232,0)');
            c.fillStyle = gg; c.beginPath(); c.arc(n.x, n.y, 30, 0, Math.PI * 2); c.fill();
            c.fillStyle = '#2f9be8'; c.beginPath(); c.arc(n.x, n.y, 9, 0, Math.PI * 2); c.fill();
          }
        };
        net(X(-14.8), X(-5.8), false); net(X(5.8), X(14.8), true);
        // 螢幕周圍深色嵌入框
        c.fillStyle = '#1b2a3a'; c.fillRect(X(BOARD.x - BOARD.w / 2 - 0.12), Yy(BOARD.y + BOARD.h / 2 + 0.12), (BOARD.w + 0.24) / WW * W, (BOARD.h + 0.24) / WH * H);
        c.fillStyle = '#1f5f99'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `bold 72px ${SANS}`;
        c.fillText('智慧協作・數據驅動', X(0), Yy(6.05));
        c.font = `40px ${SANS}`; c.fillStyle = 'rgba(44,74,102,.9)';
        c.fillText('左側 私人線', X(-10.4), Yy(6.2)); c.fillText('右側 公司線', X(10.4), Yy(6.2));
        const tex = canvasTex(cv);
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(WW, WH), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.5 }));
        panel.position.set(0, T0 + WH / 2, wf + 0.003); scene.add(panel);
        // 螢幕（與牆面齊平）與細光框
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.w, BOARD.h), new THREE.MeshBasicMaterial({ map: bigTex, toneMapped: false }));
        screen.position.set(BOARD.x, BOARD.y, wf + 0.012); scene.add(screen);
        const fm = glow(CY, 1.4), t = 0.045, hw = BOARD.w / 2 + t / 2 + 0.03, hh = BOARD.h / 2 + t / 2 + 0.03;
        box(BOARD.w + 0.15, t, 0.02, fm, BOARD.x, BOARD.y + hh, wf + 0.012, scene); box(BOARD.w + 0.15, t, 0.02, fm, BOARD.x, BOARD.y - hh, wf + 0.012, scene);
        box(t, BOARD.h + 0.06, 0.02, fm, BOARD.x - hw, BOARD.y, wf + 0.012, scene); box(t, BOARD.h + 0.06, 0.02, fm, BOARD.x + hw, BOARD.y, wf + 0.012, scene);
        // 牆腳與牆頂光條
        box(WW, 0.05, 0.04, glow(CY, 1.0), 0, T0 + 0.06, wf + 0.02, scene);
        box(WW, 0.04, 0.04, glow(VI, 0.9), 0, T0 + WH - 0.05, wf + 0.02, scene);
      }

      // 總經理指揮台（矩形）：檯面顯示幕、兩端光柱；有來訊時檯緣與地面光框發光
      function core(grp) {
        box(3.0, 0.92, 0.95, M(0xf4f7fb, { roughness: 0.4 }), 0, 0.46, 0, grp);
        box(3.1, 0.05, 1.05, M(0xd9e3ee, { metalness: 0.3, roughness: 0.3 }), 0, 0.945, 0, grp);
        const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 340;
        const c = cv.getContext('2d');
        c.fillStyle = '#071226'; c.fillRect(0, 0, 1024, 340);
        c.strokeStyle = 'rgba(56,200,255,.25)'; c.lineWidth = 1; for (let x = 0; x < 1024; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 340); c.stroke(); }
        for (let i = 0; i < 18; i++) { const h = 40 + rnd() * 170; c.fillStyle = i % 3 ? 'rgba(56,200,255,.75)' : 'rgba(139,123,255,.8)'; c.fillRect(560 + i * 24, 300 - h, 14, h); }
        c.strokeStyle = '#5fe3c0'; c.lineWidth = 4; c.beginPath(); for (let i = 0; i <= 20; i++) { const x = 40 + i * 24, y = 230 - Math.sin(i * 0.7) * 50 - i * 4; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke();
        c.fillStyle = '#eaf4ff'; c.font = `bold 54px ${SANS}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('總經理指揮台', 40, 60);
        const ct = canvasTex(cv);
        const coreTop = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.85), new THREE.MeshStandardMaterial({ map: ct, emissiveMap: ct, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.3 }));
        flat(coreTop, 0.975); grp.add(coreTop);
        const haloMat = new THREE.MeshStandardMaterial({ color: ACT, emissive: ACT_E, emissiveIntensity: 0.0, roughness: 0.3, metalness: 0.2 });
        const halo = box(3.12, 0.04, 0.04, haloMat, 0, 0.95, 0.53, grp);
        box(3.02, 0.04, 0.03, haloMat, 0, 0.08, 0.49, grp);
        // 地面光框（矩形）
        const sh = new THREE.Shape(); sh.moveTo(-2.1, -1.0); sh.lineTo(2.1, -1.0); sh.lineTo(2.1, 1.0); sh.lineTo(-2.1, 1.0); sh.closePath();
        const hole = new THREE.Path(); hole.moveTo(-1.85, -0.78); hole.lineTo(-1.85, 0.78); hole.lineTo(1.85, 0.78); hole.lineTo(1.85, -0.78); hole.closePath(); sh.holes.push(hole);
        const glowMat = new THREE.MeshBasicMaterial({ color: CY, transparent: true, opacity: 0.0, depthWrite: false });
        const glowM = new THREE.Mesh(new THREE.ShapeGeometry(sh), glowMat); flat(glowM, 0.012); grp.add(glowM);
        // 兩端光柱
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0x0a0f18, emissive: CY, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 });
        for (const sx of [-1.62, 1.62]) { box(0.12, 1.5, 0.12, M(0xf4f7fb), sx, 0.75, -0.2, grp); box(0.05, 1.42, 0.13, bladeMat, sx, 0.75, -0.2, grp); }
        const om = new THREE.MeshBasicMaterial({ color: 0x5fdcff, wireframe: true, transparent: true, opacity: 0.5 });
        const octa = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), om); octa.position.set(0, 1.35, -0.1); grp.add(octa);
        return { coreTop, glowMat, glow: glowM, haloMat, halo, holo: { octa, om, bladeMat } };
      }

      // 工位（長桌模組；局部座標：人朝 +z，桌在前方，前緣為低矮玻璃隔板）
      function desk(g, yang, lead) {
        const side = yang ? CY : VI;
        const sh = new THREE.Shape(); sh.moveTo(-0.78, -1.0); sh.lineTo(0.78, -1.0); sh.lineTo(0.78, 0.6); sh.lineTo(-0.78, 0.6); sh.closePath();
        const matMat = new THREE.MeshStandardMaterial({ color: yang ? 0xe6f3ff : 0xe4f5e6, roughness: 0.6, emissive: ACT, emissiveIntensity: 0 });
        const mat = new THREE.Mesh(new THREE.ShapeGeometry(sh), matMat); flat(mat, 0.012); g.add(mat);
        if (lead) { const r = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(sh.getPoints().map((p) => new THREE.Vector3(p.x, 0.016, -p.y))), new THREE.LineBasicMaterial({ color: side })); g.add(r); }
        const top = box(1.5, 0.045, 0.62, M(yang ? 0xffffff : 0xf1ede4, { roughness: 0.35 }), 0, 0.77, 0.3, g);
        const front = box(1.42, 0.36, 0.03, M(yang ? 0xe3edf6 : 0xe6e0d2, { roughness: 0.5 }), 0, 0.53, 0.55, g);
        for (const sx of [-0.72, 0.72]) { box(0.05, 0.74, 0.05, metal, sx, 0.37, 0.06, g); box(0.05, 0.74, 0.05, metal, sx, 0.37, 0.56, g); }
        // 前緣低矮玻璃隔板（頂端光條）
        const p = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 0.015), glass(0.18)); p.position.set(0, 1.0, 0.6); g.add(p);
        box(1.5, 0.018, 0.03, glow(side, 1.1), 0, 1.21, 0.6, g);
        // 雙螢幕
        const scrMat = new THREE.MeshStandardMaterial({ color: 0x05080f, emissive: 0x5fd0ff, emissiveIntensity: 0.05, roughness: 0.25 });
        for (const sx of [-1, 1]) {
          const mg = new THREE.Group(); mg.position.set(sx * 0.3, 1.07, 0.44); mg.rotation.y = -sx * 0.18; g.add(mg);
          box(0.56, 0.34, 0.025, M(0x111725, { metalness: 0.5, roughness: 0.3 }), 0, 0, 0, mg);
          box(0.52, 0.3, 0.006, scrMat, 0, 0, -0.015, mg);
          box(0.035, 0.22, 0.035, metal, 0, -0.2, 0.02, mg);
        }
        box(0.4, 0.015, 0.14, M(0x2a3346), 0, 0.8, 0.18, g);
        // 檯燈（工作中亮起）
        cyl(0.06, 0.07, 0.02, metal, 0.62, 0.8, 0.42, g, 12);
        box(0.02, 0.42, 0.02, metal, 0.62, 1.0, 0.42, g);
        box(0.02, 0.02, 0.26, metal, 0.62, 1.2, 0.3, g);
        const lamp = box(0.12, 0.025, 0.07, new THREE.MeshStandardMaterial({ color: 0xeef6ff, emissive: 0xdff4ff, emissiveIntensity: 0.1 }), 0.62, 1.185, 0.17, g);
        // 人體工學椅
        const chair = M(yang ? 0x6fb6e8 : 0x7cc48c, { roughness: 0.6 });
        box(0.48, 0.07, 0.46, chair, 0, 0.46, -0.42, g);
        box(0.44, 0.52, 0.06, chair, 0, 0.8, -0.68, g);
        box(0.3, 0.03, 0.03, glow(side, 0.8), 0, 1.04, -0.66, g);
        cyl(0.035, 0.035, 0.4, metal, 0, 0.23, -0.42, g, 8);
        cyl(0.26, 0.26, 0.03, M(0x2a3346), 0, 0.04, -0.42, g, 5);
        return { matMat, mat, top, front, scrMat, lamp, outfit: yang ? 0x2f6fae : 0xf2f5f8 };
      }

      // 玻璃會議室（左＝個人側、右＝公司側）：長桌、六張椅、桌上全像投影、內牆螢幕
      const MEET_SEATS = { left: [], right: [] };
      function glassRoom(x0, z0, x1, z1, openSide) {
        const h = 2.4, edges = [['b', x0, z0, x1, z0], ['f', x0, z1, x1, z1], ['l', x0, z0, x0, z1], ['r', x1, z0, x1, z1]];
        for (const [k, ax, az, bx, bz] of edges) {
          if (k === openSide) continue;
          const len = Math.hypot(bx - ax, bz - az), alongX = az === bz;
          const pn = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.04, h, alongX ? 0.04 : len), glass(0.12)); pn.position.set((ax + bx) / 2, T0 + h / 2, (az + bz) / 2); scene.add(pn);
          box(alongX ? len : 0.05, 0.04, alongX ? 0.05 : len, glow(CY, 1.0), (ax + bx) / 2, T0 + h, (az + bz) / 2, scene);
          box(alongX ? len : 0.06, 0.06, alongX ? 0.06 : len, M(0xdde5ee), (ax + bx) / 2, T0 + 0.03, (az + bz) / 2, scene);
        }
      }
      for (const [pod, R] of Object.entries(ROOMS)) {
        const sg = Math.sign(R.x), x0 = R.x - RW / 2, x1 = R.x + RW / 2, z0 = R.z - RD / 2, z1 = R.z + RD / 2;
        const zone = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), M(0xf3f6f9, { roughness: 0.8 })); flat(zone, T0 + 0.005); zone.position.set(R.x, T0 + 0.005, R.z); scene.add(zone);
        glassRoom(x0, z0, x1, z1, sg < 0 ? 'r' : 'l'); // 朝自己那一側的工位島開口
        box(1.2, 0.05, 2.6, M(0xe6ebf2, { roughness: 0.3, metalness: 0.2 }), R.x, T0 + 0.75, R.z, scene);
        box(1.22, 0.015, 2.62, glow(CY, 0.9), R.x, T0 + 0.72, R.z, scene);
        box(0.34, 0.7, 1.7, M(0xdde5ee, { metalness: 0.5 }), R.x, T0 + 0.37, R.z, scene);
        const hg = new THREE.Group(); hg.position.set(R.x, T0 + 1.15, R.z); scene.add(hg);
        hg.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: 0x5fdcff, wireframe: true, transparent: true, opacity: 0.6 })));
        spin.push(hg);
        for (const s of [-1, 1]) for (const dz of [-0.90, 0, 0.90]) {
          const cx = R.x + s * 1.15, ch = new THREE.Group(); ch.position.set(cx, T0, R.z + dz); ch.rotation.y = -s * PI / 2; scene.add(ch);
          box(0.44, 0.06, 0.44, M(0x6fb6e8), 0, 0.46, 0, ch); box(0.42, 0.42, 0.05, M(0x6fb6e8), 0, 0.72, -0.24, ch);
          cyl(0.03, 0.03, 0.42, metal, 0, 0.22, 0, ch, 8);
          MEET_SEATS[pod].push({ type: 'meet', x: cx, z: R.z + dz, yaw: -s * PI / 2, y: T0 });
        }
        // 內牆（背面玻璃上）小螢幕
        box(1.4, 0.8, 0.03, M(0x0a1222, { emissive: 0x38c8ff, emissiveIntensity: 0.25 }), R.x, T0 + 1.5, z0 + 0.06, scene);
      }

      function bush(x, z, r = 0.2, h = 0.52, col = 0x3f9a4f) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), M(col, { roughness: 0.9 }));
        m.position.set(x, T0 + h * 0.55, z); m.scale.y = Math.max(0.7, h / (r * 2)); scene.add(m);
      }
      function hedgeRect(x0, z0, x1, z1, openSide) {
        const sp = 0.42;
        const along = (ax, az, bx, bz, open) => {
          const len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(len / sp));
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            if (open && t > 0.32 && t < 0.68) continue;
            const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
            bush(x, z, 0.17 + (i % 3) * 0.035, 0.46 + (i % 2) * 0.1, i % 2 ? 0x3f9a4f : 0x56ad5c);
          }
        };
        along(x0, z0, x1, z0, openSide === 'b'); along(x0, z1, x1, z1, openSide === 'f');
        along(x0, z0, x0, z1, openSide === 'l'); along(x1, z0, x1, z1, openSide === 'r');
      }
      function cabinet(x, z, w, d, yaw) {
        const g = new THREE.Group(); g.position.set(x, T0, z); g.rotation.y = yaw; scene.add(g);
        box(w, 0.72, d, M(0xe6ebf2, { roughness: 0.55 }), 0, 0.36, 0, g);
        box(w + 0.04, 0.03, d + 0.04, M(0xd9e3ee), 0, 0.735, 0, g);
        box(w - 0.08, 0.012, 0.02, glow(VI, 0.6), 0, 0.75, d / 2, g);
      }
      function tree(x, z, h = 1.7) {
        cyl(0.055, 0.08, h * 0.45, M(0x7a5a3a), x, T0 + h * 0.22, z, scene, 8);
        const a = new THREE.Mesh(new THREE.IcosahedronGeometry(h * 0.28, 1), M(0x3f9a4f, { roughness: 0.85, flatShading: true })); a.position.set(x, T0 + h * 0.55, z); scene.add(a);
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(h * 0.2, 1), M(0x56ad5c, { roughness: 0.85, flatShading: true })); b.position.set(x + 0.14, T0 + h * 0.7, z - 0.06); scene.add(b);
      }

      // 機房（左上靠牆）、專注艙（公司側中段）、咖啡吧／休息區（入口端）；回傳休息／活動位置
      function corners(cornerSign) {
        const ledCv = document.createElement('canvas'); ledCv.width = 128; ledCv.height = 512;
        { const c = ledCv.getContext('2d'); c.fillStyle = '#070b13'; c.fillRect(0, 0, 128, 512);
          for (let r = 0; r < 14; r++) { c.fillStyle = '#121a28'; c.fillRect(6, 8 + r * 36, 116, 30);
            for (let k = 0; k < 6; k++) { const v = rnd(); c.fillStyle = v < 0.55 ? '#38c8ff' : v < 0.8 ? '#5fe3c0' : v < 0.93 ? '#8b7bff' : '#ffb347'; c.fillRect(14 + k * 12, 18 + r * 36, 6, 6); }
            c.fillStyle = 'rgba(56,200,255,.35)'; c.fillRect(92, 20 + r * 36, 22, 4); } }
        const ledTex = canvasTex(ledCv);

        // 機房（左上內側角落，獨立靠牆）：兩排機櫃，中間冷通道；玻璃隔間，朝廣場開口
        const SVCZ = REARZ;
        for (const rz of [SVCZ - 0.85, SVCZ + 0.85]) for (let i = 0; i < 5; i++) {
          const x = SVX0 + 0.70 + i * 0.70;
          box(0.62, 2.1, 0.9, M(0x3a4556, { metalness: 0.5, roughness: 0.4 }), x, T0 + 1.05, rz, scene);
          const fm = new THREE.MeshStandardMaterial({ map: ledTex, emissiveMap: ledTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 });
          for (const sd of [1, -1]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 1.96), fm); f.position.set(x, T0 + 1.05, rz + sd * 0.452); if (sd < 0) f.rotation.y = PI; scene.add(f); }
          box(0.62, 0.03, 0.9, glow(CY, 1.0), x, T0 + 2.11, rz, scene);
          blink.push({ m: fm, ph: rnd() * 6, sp: 1.5 + rnd() * 2 });
        }
        { const aisle = new THREE.Mesh(new THREE.PlaneGeometry((SVX1 - SVX0) - 0.8, 0.5), new THREE.MeshBasicMaterial({ color: CY, transparent: true, opacity: 0.2 })); flat(aisle, T0 + 0.006); aisle.position.set(SVCX, T0 + 0.006, SVCZ); scene.add(aisle); }
        glassRoom(SVX0, SVZ0, SVX1, SVZ1, 'r');

        // 專注艙（公司側中段）：區界用綠籬與矮櫃，區內並列兩座玻璃小艙
        const BOOTH = [ROOMX - 1.05, ROOMX + 1.05];
        hedgeRect(RX0, BOOTH_Z0, RX1, BOOTH_Z1, 'l');
        cabinet(RX1 - 0.28, BOOTHZ, 0.36, 1.6, 0);
        for (const bx of BOOTH) {
          glassRoom(bx - 0.95, BOOTH_Z0 + 0.25, bx + 0.95, BOOTH_Z1 - 0.25, null);
          box(1.9, 0.05, RD - 0.5, M(0xdde5ee), bx, T0 + 2.42, BOOTHZ, scene);
          box(1.2, 0.02, 0.06, glow(0xeef6ff, 0.8), bx, T0 + 2.39, BOOTHZ, scene);
          box(0.6, 0.44, 0.5, M(0x6fb6e8, { roughness: 0.85 }), bx, T0 + 0.22, BOOTHZ - 0.55, scene); box(0.6, 0.5, 0.12, M(0x6fb6e8), bx, T0 + 0.65, BOOTHZ - 0.80, scene);
          box(0.9, 0.04, 0.4, M(0xe6ebf2), bx, T0 + 0.72, BOOTHZ + 0.55, scene); box(0.04, 0.7, 0.04, metal, bx, T0 + 0.36, BOOTHZ + 0.55, scene);
        }

        // 咖啡吧（個人側入口端）：靠窗吧檯＋兩張高桌；區界用綠籬
        const CF = { x: -ROOMX, z: FRONTZ };
        hedgeRect(-RX1, FRONT_Z0, -RX0, FRONT_Z1, 'r');
        cabinet(-RX0 - 0.28, FRONTZ - 1.15, 0.36, 1.1, 0);
        { box(0.62, 0.92, 2.9, M(0xf6f8fa, { roughness: 0.5 }), -RX1 + 0.35, T0 + 0.46, CF.z, scene);
          box(0.7, 0.05, 3.0, M(0xc89f6e, { roughness: 0.5 }), -RX1 + 0.35, T0 + 0.945, CF.z, scene);
          box(0.03, 0.03, 2.9, glow(CY, 1.1), -RX1 + 0.67, T0 + 0.9, CF.z, scene);
          box(0.42, 0.48, 0.5, M(0x9aa6b8, { metalness: 0.8, roughness: 0.25 }), -RX1 + 0.30, T0 + 1.21, CF.z - 0.8, scene);
          box(0.01, 0.1, 0.2, glow(CY, 1.4), -RX1 + 0.52, T0 + 1.3, CF.z - 0.8, scene);
          for (const dz of [0.1, 0.32, 0.54]) cyl(0.04, 0.035, 0.09, M(0xf4f6f8), -RX1 + 0.40, T0 + 1.015, CF.z + dz, scene, 10);
          const mc = document.createElement('canvas'); mc.width = 512; mc.height = 256; const c = mc.getContext('2d');
          c.fillStyle = '#071226'; c.fillRect(0, 0, 512, 256); c.strokeStyle = '#38c8ff'; c.lineWidth = 6; c.strokeRect(6, 6, 500, 244);
          c.fillStyle = '#eaf4ff'; c.textAlign = 'center'; c.font = `bold 64px ${SANS}`; c.fillText('咖啡吧', 256, 100); c.font = `38px ${SANS}`; c.fillStyle = '#7fe0ff'; c.fillText('美式・拿鐵・冷萃', 256, 180);
          const mt = canvasTex(mc); const ms = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65), new THREE.MeshStandardMaterial({ map: mt, emissiveMap: mt, emissive: 0xffffff, emissiveIntensity: 0.85 }));
          ms.position.set(-RX1 + 0.04, T0 + 1.9, CF.z + 0.4); ms.rotation.y = PI / 2; scene.add(ms);
          for (const [x, z] of [[-ROOMX - 0.15, FRONTZ - 0.55], [-ROOMX + 1.15, FRONTZ + 0.7]]) {
            box(0.9, 0.04, 0.6, M(0xeef2f7, { roughness: 0.3 }), x, T0 + 1.05, z, scene);
            box(0.92, 0.012, 0.62, glow(CY, 0.9), x, T0 + 1.03, z, scene);
            box(0.05, 1.03, 0.05, metal, x, T0 + 0.52, z, scene); box(0.5, 0.03, 0.4, M(0x2a3346), x, T0 + 0.015, z, scene);
            cyl(0.035, 0.03, 0.09, M(0xf4f6f8), x + 0.15, T0 + 1.115, z, scene, 10);
          } }

        // 休息區（公司側入口端）：沙發與茶几；區界用綠籬，不與咖啡吧合併
        const LG = { x: ROOMX, z: FRONTZ };
        hedgeRect(RX0, FRONT_Z0, RX1, FRONT_Z1, 'l');
        cabinet(RX0 + 0.28, FRONTZ - 1.15, 0.36, 1.1, 0);
        { const sofa = M(0x6fb6e8, { roughness: 0.85 }), cush = M(0xf6f8fa, { roughness: 0.9 });
          box(2.4, 0.38, 0.75, sofa, LG.x - 0.15, T0 + 0.19, LG.z - 0.95, scene); box(2.4, 0.56, 0.2, sofa, LG.x - 0.15, T0 + 0.6, LG.z - 1.28, scene);
          for (const dx of [-0.7, 0.4]) box(1.05, 0.08, 0.62, cush, LG.x + dx - 0.15, T0 + 0.42, LG.z - 0.90, scene);
          box(0.75, 0.38, 1.8, sofa, LG.x + 1.70, T0 + 0.19, LG.z + 0.35, scene); box(0.2, 0.56, 1.8, sofa, LG.x + 2.02, T0 + 0.6, LG.z + 0.35, scene);
          box(0.62, 0.08, 1.6, cush, LG.x + 1.68, T0 + 0.42, LG.z + 0.35, scene);
          box(1.1, 0.04, 0.62, glass(0.4, 0xbfe9ff), LG.x - 0.15, T0 + 0.38, LG.z + 0.2, scene); box(1.0, 0.36, 0.50, M(0xe9eef3), LG.x - 0.15, T0 + 0.18, LG.z + 0.2, scene);
          box(1.12, 0.012, 0.64, glow(VI, 0.8), LG.x - 0.15, T0 + 0.355, LG.z + 0.2, scene);
          for (const [x, z] of [[LG.x - 1.7, LG.z - 1.35], [LG.x + 1.85, LG.z - 1.35], [LG.x - 1.7, LG.z + 1.45]]) {
            box(0.4, 0.42, 0.4, M(0xe6ebf2, { roughness: 0.4 }), x, T0 + 0.21, z, scene);
            const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 1), M(0x2f8a6a, { roughness: 0.8, flatShading: true })); f.position.set(x, T0 + 0.80, z); scene.add(f);
          } }
        // 分隔植栽：中段與入口端之間、右後留白、入口兩側（只種在綠地，不擋組織線）
        for (const [x, z, h] of [
          [-10.2, 4.4, 1.8], [-8.8, 6.2, 1.55], [-11.6, 5.6, 1.9], [-9.6, 8.3, 1.45],
          [10.2, 7.6, 1.8], [8.9, 8.6, 1.5], [11.7, 7.2, 1.85], [9.4, 9.1, 1.4],
          [9.6, -7.4, 1.9], [12.1, -8.2, 2.1], [7.8, -6.6, 1.6], [11.2, -5.4, 1.75], [8.6, -8.8, 1.5],
          [-14.4, 1.2, 2.0], [14.4, 1.2, 2.0], [-14.6, 8.4, 1.7], [14.6, 8.4, 1.7],
          [-4.6, 16.1, 1.5], [4.6, 16.1, 1.5], [-13.5, 15.2, 1.8], [13.5, 15.2, 1.8],
        ]) tree(x, z, h);
        cornerSign('機房', SVX1 + 0.05, SVZ1 + 0.15, 2.6); cornerSign('專注艙', RX0 - 0.15, BOOTH_Z1 + 0.15, 2.6);
        cornerSign('咖啡吧', -RX0 + 0.15, FRONT_Z0 - 0.15, 0.95); cornerSign('休息區', RX0 - 0.15, FRONT_Z0 - 0.15, 0.95);
        const y = T0, P2 = (x, z) => ({ x, z });
        return [
          { id: 'walk-aisle-a', type: 'patrol', label: '散步', p0: P2(-0.55, 15.2), p1: P2(-0.55, -3.6), sp: 0.14, off: 0, y, side: 'L' },
          { id: 'coffee-1', type: 'coffee', x: -ROOMX - 0.55, z: FRONTZ - 0.55, yaw: PI / 2, y, label: '喝咖啡', side: 'L' },
          { id: 'lounge-1', type: 'read', x: LG.x - 0.75, z: LG.z - 0.85, yaw: 0, y, label: '休息區小憩', side: 'R' },
          { id: 'server-1', type: 'patrol', label: '巡視機房', p0: P2(SVX0 + 0.5, SVCZ), p1: P2(SVX1 - 0.5, SVCZ), sp: 0.35, off: 0, y, side: 'L' },
          { id: 'booth-1', type: 'read', x: BOOTH[0], z: BOOTHZ - 0.2, yaw: 0, y, label: '專注艙', side: 'R' },
          { id: 'coffee-2', type: 'coffee', x: -ROOMX + 0.55, z: FRONTZ - 0.55, yaw: -PI / 2, y, label: '喝咖啡', side: 'L' },
          { id: 'lounge-2', type: 'read', x: LG.x + 0.35, z: LG.z - 0.85, yaw: 0, y, label: '休息區小憩', side: 'R' },
          { id: 'walk-front-l', type: 'patrol', label: '散步', p0: P2(-6.0, 7.6), p1: P2(-2.0, 7.6), sp: 0.12, off: 0, y, side: 'L' },
          { id: 'walk-aisle-b', type: 'patrol', label: '散步', p0: P2(0.55, -3.6), p1: P2(0.55, 15.2), sp: 0.14, off: PI * 0.6, y, side: 'R' },
          { id: 'coffee-3', type: 'coffee', x: -ROOMX + 1.15, z: FRONTZ + 0.7, yaw: -PI / 2, y, label: '喝咖啡', side: 'L' },
          { id: 'lounge-3', type: 'read', x: LG.x + 1.68, z: LG.z + 0.55, yaw: -PI / 2, y, label: '休息區小憩', side: 'R' },
          { id: 'booth-2', type: 'read', x: BOOTH[1], z: BOOTHZ - 0.2, yaw: 0, y, label: '專注艙', side: 'R' },
          { id: 'server-2', type: 'patrol', label: '巡視機房', p0: P2(SVX0 + 0.5, SVCZ), p1: P2(SVX1 - 0.5, SVCZ), sp: 0.35, off: PI, y, side: 'L' },
          { id: 'walk-front-r', type: 'patrol', label: '散步', p0: P2(2.0, 7.6), p1: P2(6.0, 7.6), sp: 0.12, off: 0, y, side: 'R' },
        ];
      }

      function boardLogo(c, x, y) {
        c.save(); c.strokeStyle = '#38c8ff'; c.fillStyle = '#0c1a30'; c.lineWidth = 4;
        c.beginPath(); c.roundRect(x - 34, y - 34, 68, 68, 10); c.fill(); c.stroke();
        c.fillStyle = '#38c8ff'; for (let k = 0; k < 4; k++) { const o = -24 + k * 16; c.fillRect(x + o - 2, y - 46, 4, 10); c.fillRect(x + o - 2, y + 36, 4, 10); c.fillRect(x - 46, y + o - 2, 10, 4); c.fillRect(x + 36, y + o - 2, 10, 4); }
        c.fillStyle = '#eaf4ff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `bold 32px ${SANS}`; c.fillText('AI', x, y + 1); c.restore();
        c.textAlign = 'left';
      }

      function tick(sec, st, holo) {
        if (holo) {
          const on = st === 'active', pulse = 0.5 + Math.sin(sec * 2.2) * 0.5;
          holo.octa.rotation.y = sec * 0.8; holo.octa.position.y = 1.35 + Math.sin(sec * 1.3) * 0.05;
          holo.om.opacity = on ? 0.6 + pulse * 0.35 : 0.22;
          holo.bladeMat.emissiveIntensity = on ? 0.9 + pulse * 0.9 : 0.25;
        }
        for (const s of spin) s.rotation.y = sec * 0.7;
        for (const cl of clouds) { if (cl.base.z < -20) { const span = 110; cl.s.position.x = ((cl.base.x + sec * cl.sp + span * 1.5) % span) - span / 2; } else cl.s.position.z = cl.base.z + Math.sin(sec * 0.04 * cl.sp + cl.base.x) * 3; }
        for (const b of blink) b.m.emissiveIntensity = 0.75 + Math.sin(sec * b.sp + b.ph) * 0.3;
      }
      return { SEATS, CORE, ROOMS, MEET_SEATS, wall, core, desk, corners, boardLogo, tick };
    }

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
    if (IS_B) B.wall(bigTex);
    else {
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
    // 模板 B 改為走道盡頭的矩形「總經理指揮台」
    const CORE_P = IS_B ? B.CORE : { x: 0, z: CZ };
    const core = new THREE.Group(); core.position.set(CORE_P.x, TOP, CORE_P.z); scene.add(core);
    let coreTop, glowMat, glow, haloMat, halo, coreHolo = null;
    if (IS_B) ({ coreTop, glowMat, glow, haloMat, halo, holo: coreHolo } = B.core(core));
    else {
    cyl(1.62, 1.72, 0.16, M(0x2a2825, { roughness: 0.6 }), 0, 0.08, 0, core, 64);
    cyl(1.5, 1.58, 0.12, M(GOLD, { metalness: 0.55, roughness: 0.35 }), 0, 0.2, 0, core, 64);
    coreTop = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1024;
      const c = cv.getContext('2d');
      drawTaiji(c, 512, 512, 506, '#f7f4ec', '#1c1b19');
      const m = new THREE.Mesh(new THREE.CircleGeometry(1.46, 64), new THREE.MeshStandardMaterial({ map: canvasTex(cv), roughness: 0.35, metalness: 0.05 }));
      flat(m, 0.265); core.add(m); return m;
    })();
    glowMat = new THREE.MeshBasicMaterial({ color: 0x7fd1b5, transparent: true, opacity: 0.0, depthWrite: false });
    glow = new THREE.Mesh(new THREE.RingGeometry(1.78, 2.2, 96), glowMat); flat(glow, 0.03); core.add(glow);
    haloMat = new THREE.MeshStandardMaterial({ color: ACT, emissive: ACT_E, emissiveIntensity: 0.0, roughness: 0.3, metalness: 0.2 });
    halo = new THREE.Mesh(new THREE.TorusGeometry(1.67, 0.035, 10, 120), haloMat); halo.rotation.x = Math.PI / 2; halo.position.y = 0.28; core.add(halo);
    }
    // 主位名牌
    const coreCv = document.createElement('canvas'); coreCv.width = 640; coreCv.height = 260;
    const coreTex = canvasTex(coreCv);
    const coreSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: coreTex, depthTest: false, transparent: true }));
    coreSpr.scale.set(2.7, 1.1, 1); coreSpr.position.set(CORE_P.x, TOP + (IS_B ? 2.05 : 1.7), CORE_P.z); coreSpr.renderOrder = 11; scene.add(coreSpr);
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
      const deg = SEAT_DEG[f.id], pos = IS_B ? { x: B.SEATS[f.id].x, z: B.SEATS[f.id].z } : ringPt(deg), yaw = IS_B ? B.SEATS[f.id].yaw : deg * Math.PI / 180 + Math.PI;
      const yang = PERSONAL.has(f.id); // 左半陽：深色家具；右半陰：淺色家具
      const g = new THREE.Group(); g.position.set(pos.x, TOP, pos.z); g.rotation.y = yaw; g.scale.setScalar(DS); scene.add(g);
      const lead = f.id === 'pa' || f.id === 'cos';
      let matMat, mat, top, front, scrMat, lamp, outfit;
      if (IS_B) ({ matMat, mat, top, front, scrMat, lamp, outfit } = B.desk(g, yang, lead));
      else {
      // 圓形座席墊
      matMat = new THREE.MeshStandardMaterial({ color: yang ? 0xe4ddcf : 0x46423c, roughness: 0.9, emissive: JADE, emissiveIntensity: 0 });
      mat = new THREE.Mesh(new THREE.CircleGeometry(lead ? 1.25 : 1.12, 48), matMat); flat(mat, 0.01); g.add(mat);
      const rim = new THREE.Mesh(new THREE.RingGeometry(lead ? 1.22 : 1.09, lead ? 1.27 : 1.14, 64), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.7 })); flat(rim, 0.015); g.add(rim);
      const dm = yang ? DESK_DARK : DESK_LIGHT;
      // 弧形桌（以圓柱片段做成）
      top = new THREE.Mesh(deskGeo, dm); top.position.set(0, 0.77, -0.55); g.add(top);
      front = new THREE.Mesh(new THREE.CylinderGeometry(1.04, 1.04, 0.42, 32, 1, true, -0.6, 1.2), new THREE.MeshStandardMaterial({ color: yang ? 0x24221f : 0xdcd5c6, roughness: 0.5, side: THREE.DoubleSide }));
      front.position.set(0, 0.54, -0.55); g.add(front);
      for (const sx of [-0.55, 0.55]) box(0.04, 0.33, 0.04, M(GOLD, { metalness: 0.5, roughness: 0.4 }), sx, 0.165, 0.33, g);
      box(0.9, 0.025, 0.02, M(GOLD, { metalness: 0.5, roughness: 0.4 }), 0, 0.72, 0.5, g);
      // 螢幕
      scrMat = new THREE.MeshStandardMaterial({ color: 0x101010, emissive: 0x9fe0c8, emissiveIntensity: 0.05, roughness: 0.3 });
      box(0.72, 0.42, 0.03, M(yang ? 0x1a1917 : 0xcfc8b8), 0, 1.06, 0.36, g);
      const scr = box(0.66, 0.36, 0.01, scrMat, 0, 1.06, 0.345, g); scr.rotation.y = Math.PI;
      box(0.05, 0.22, 0.05, M(GOLD, { metalness: 0.5, roughness: 0.4 }), 0, 0.86, 0.38, g);
      // 桌燈（工作中亮起）
      lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffe2a8, emissiveIntensity: 0.1 }));
      lamp.position.set(0.5, 0.86, 0.3); g.add(lamp);
      cyl(0.05, 0.06, 0.06, M(GOLD, { metalness: 0.5 }), 0.5, 0.78, 0.3, g, 10);
      // 圓凳椅
      cyl(0.24, 0.24, 0.08, M(yang ? 0x3a3632 : 0xd8d0c0), 0, 0.46, -0.42, g, 20);
      cyl(0.04, 0.05, 0.42, M(0x6b6255), 0, 0.22, -0.42, g, 8);
      const chairMat = M(yang ? 0x3a3632 : 0xd8d0c0);
      const back = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.26, 20, 1, true, Math.PI * 0.7, Math.PI * 0.6), new THREE.MeshStandardMaterial({ color: yang ? 0x3a3632 : 0xd8d0c0, roughness: 0.7, side: THREE.DoubleSide })); back.position.set(0, 0.74, -0.42); g.add(back);
      for (const sx of [-0.2, 0.2]) box(0.03, 0.3, 0.03, chairMat, sx, 0.6, -0.6, g);
      outfit = yang ? 0x2e2c2a : 0xf0ebe0;
      }
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
    const MEET = IS_B ? B.ROOMS.left : { x: -8.6, z: -6.4 };
    if (!IS_B) {
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
    meetSpr.scale.set(2.3, 0.9, 1); meetSpr.position.set(MEET.x, IS_B ? 2.75 : 2.3, MEET.z); meetSpr.renderOrder = 9; scene.add(meetSpr);
    // 模板 B：右側公司側會議室另有一塊名牌（左艙／右艙依資料的 pod）
    const meetCv2 = document.createElement('canvas'); meetCv2.width = 560; meetCv2.height = 220;
    const meetTex2 = canvasTex(meetCv2);
    const meetSpr2 = IS_B ? new THREE.Sprite(new THREE.SpriteMaterial({ map: meetTex2, depthTest: false, transparent: true })) : null;
    if (meetSpr2) { meetSpr2.scale.set(2.3, 0.9, 1); meetSpr2.position.set(B.ROOMS.right.x, 2.75, B.ROOMS.right.z); meetSpr2.renderOrder = 9; scene.add(meetSpr2); }
    const signs = [];
    function cornerSign(text, x, z, y = 1.7) {
      const cv = document.createElement('canvas'); cv.width = 420; cv.height = 140;
      const c = cv.getContext('2d');
      c.fillStyle = PAL.signBg; c.beginPath(); c.roundRect(6, 6, 408, 128, 20); c.fill();
      c.strokeStyle = PAL.signBorder; c.lineWidth = 5; c.stroke();
      c.fillStyle = PAL.signTxt; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, text, 380, 76, 'bold', IS_B ? SANS : SERIF); c.fillText(text, 210, 74);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(cv), transparent: true, depthTest: false }));
      s.scale.set(1.5, 0.5, 1); s.position.set(x, y, z); s.renderOrder = 8; scene.add(s); signs.push(s);
    }
    let SLOTS;
    if (IS_B) SLOTS = B.corners(cornerSign);
    else {
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
    // 休息／活動位置
    SLOTS = [
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
    }

    // ---------- 太極拳宗師（可愛版）：主動走向休息中的成員打招呼；工作中、會議中、無資料者一律不打擾 ----------
    // 可互動＝與休息安排同一判斷：沒有會議、有資料、doing[] 為空（isWorking 為否）。
    const master = IS_B ? null : (() => {
      const g = new THREE.Group(); const rig = new THREE.Group(); g.add(rig);
      const skin = M(0xf2d6b8, { roughness: 0.6 }), whiteM = M(0xf7f4ec, { roughness: 0.8 }), blackM = M(0x23211e, { roughness: 0.7 });
      const hairM = M(0xfbfaf6, { roughness: 0.9 }), goldM = M(GOLD, { metalness: 0.5, roughness: 0.4 });
      const hip = new THREE.Group(); hip.position.y = 0.34; rig.add(hip);
      const legs = [];
      for (const sx of [-0.08, 0.08]) { const th = new THREE.Group(); th.position.x = sx; hip.add(th); box(0.1, 0.3, 0.11, blackM, 0, -0.15, 0, th); box(0.12, 0.05, 0.18, blackM, 0, -0.31, 0.03, th); legs.push(th); }
      const upper = new THREE.Group(); hip.add(upper);
      // 長袍：左半黑、右半白（太極兩儀），胸前與背後各一枚太極紋
      for (const [t0, mat] of [[0, blackM], [Math.PI, whiteM]]) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.3, 0.52, 24, 1, false, t0, Math.PI), mat); h.position.y = 0.17; upper.add(h); }
      const sash = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.025, 6, 24), goldM); sash.rotation.x = Math.PI / 2; sash.position.y = 0.2; upper.add(sash);
      const ec = document.createElement('canvas'); ec.width = ec.height = 128; drawTaiji(ec.getContext('2d'), 64, 64, 58, '#ffffff', '#23211e');
      const emMat = new THREE.MeshBasicMaterial({ map: canvasTex(ec), transparent: true });
      for (const sz of [1, -1]) { const em = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), emMat); em.position.set(0, 0.31, sz * 0.212); em.rotation.set(-0.24 * sz, sz > 0 ? 0 : Math.PI, 0); upper.add(em); }
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 20), goldM); collar.rotation.x = Math.PI / 2; collar.position.y = 0.43; upper.add(collar);
      // 大圓頭、光頭白髮髻、白眉、白長鬚、腮紅
      const head = new THREE.Group(); head.position.y = 0.66; upper.add(head);
      head.add(new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 18), skin));
      const ring = new THREE.Mesh(new THREE.SphereGeometry(0.248, 24, 12, Math.PI * 0.55, Math.PI * 0.9, Math.PI * 0.3, Math.PI * 0.32), hairM); head.add(ring);
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), hairM); bun.position.set(0, 0.27, -0.02); head.add(bun);
      cyl(0.012, 0.012, 0.2, goldM, 0, 0.28, -0.02, head, 6).rotation.z = Math.PI / 2;
      for (const ex of [-0.08, 0.08]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), M(0x111111)); e.position.set(ex, 0.03, 0.222); head.add(e);
        const hl = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 4), M(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 })); hl.position.set(ex + 0.01, 0.042, 0.248); head.add(hl);
        const br = box(0.1, 0.022, 0.03, hairM, ex * 1.05, 0.095, 0.215, head); br.rotation.z = ex > 0 ? -0.35 : 0.35;
        const bl = new THREE.Mesh(new THREE.CircleGeometry(0.03, 12), new THREE.MeshBasicMaterial({ color: 0xf0a0a0, transparent: true, opacity: 0.7 })); bl.position.set(ex * 1.55, -0.04, 0.2); bl.rotation.y = ex > 0 ? 0.6 : -0.6; head.add(bl);
      }
      const beard = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 16), hairM); beard.rotation.x = Math.PI + 0.25; beard.position.set(0, -0.24, 0.15); head.add(beard);
      for (const sx of [-1, 1]) { const mu = box(0.1, 0.03, 0.04, hairM, sx * 0.05, -0.06, 0.225, head); mu.rotation.z = sx * -0.4; }
      const arms = [];
      for (const sx of [-1, 1]) {
        const sh = new THREE.Group(); sh.position.set(sx * 0.2, 0.38, 0); upper.add(sh);
        const sleeveM = sx > 0 ? blackM : whiteM;
        cyl(0.055, 0.075, 0.2, sleeveM, 0, -0.1, 0, sh, 12);
        const el2 = new THREE.Group(); el2.position.y = -0.2; sh.add(el2);
        cyl(0.075, 0.085, 0.14, sleeveM, 0, -0.06, 0, el2, 12);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin); hand.position.y = -0.16; el2.add(hand);
        arms.push({ sh, el: el2 });
      }
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }));
      flat(shadow, 0.012); g.add(shadow);
      g.scale.setScalar(1.3); scene.add(g);
      // 名牌與對話泡泡
      const tag = (() => { const cv = document.createElement('canvas'); cv.width = 360; cv.height = 96; const c = cv.getContext('2d');
        c.fillStyle = 'rgba(35,33,30,0.82)'; c.beginPath(); c.roundRect(4, 4, 352, 88, 44); c.fill(); c.strokeStyle = '#b8995a'; c.lineWidth = 4; c.stroke();
        c.fillStyle = '#f7f4ec'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, '太極拳宗師', 320, 52, 'bold', SERIF); c.fillText('太極拳宗師', 180, 50);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(cv), transparent: true, depthTest: false })); s.scale.set(1.05, 0.28, 1); s.renderOrder = 11; scene.add(s); return s; })();
      const mkBubble = (W, edge) => { const cv = document.createElement('canvas'); cv.width = 480; cv.height = 180; const tex = canvasTex(cv);
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })); spr.scale.set(W, W * 0.374, 1); spr.renderOrder = 12; spr.visible = false; scene.add(spr);
        let cur = ''; const say = (t) => { if (t === cur) return; cur = t; const c = cv.getContext('2d'); c.clearRect(0, 0, 480, 180);
          c.fillStyle = '#fffdf7'; c.strokeStyle = edge; c.lineWidth = 6; c.beginPath(); c.roundRect(8, 8, 464, 124, 40); c.moveTo(220, 132); c.lineTo(240, 172); c.lineTo(262, 132); c.fill(); c.stroke();
          c.fillStyle = '#fffdf7'; c.fillRect(224, 124, 34, 12);
          c.fillStyle = '#23211e'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, t, 420, 56, 'bold', SERIF); c.fillText(t, 240, 72); tex.needsUpdate = true; };
        return { spr, say }; };
      const mb = mkBubble(2.3, '#b8995a'), rb = mkBubble(2.0, '#5f9e8a'); // 宗師：金框；成員回話：玉色框
      return { g, rig, hip, upper, head, legs, arms, tag, bubble: mb.spr, say: mb.say, reply: rb.spr, replySay: rb.say };
    })();
    // ---------- 模板 B：可愛版 Louis（短黑髮、白襯衫＋深藍西裝外套），主動找休息中的成員互動 ----------
    const louis = !IS_B ? null : (() => {
      const g = new THREE.Group(); const rig = new THREE.Group(); g.add(rig);
      const skin = M(0xf2d3b4, { roughness: 0.6 }), hairM = M(0x1c1a19, { roughness: 0.8 }), navy = M(0x23365c, { roughness: 0.7 });
      const shirt = M(0xf7f9fc, { roughness: 0.7 }), pants = M(0x3a3f4a, { roughness: 0.8 }), shoe = M(0x5a3a26, { roughness: 0.6 });
      const hip = new THREE.Group(); hip.position.y = 0.36; rig.add(hip);
      const legs = [];
      for (const sx of [-0.08, 0.08]) { const th = new THREE.Group(); th.position.x = sx; hip.add(th); box(0.11, 0.32, 0.12, pants, 0, -0.16, 0, th); box(0.12, 0.05, 0.19, shoe, 0, -0.33, 0.03, th); legs.push(th); }
      const upper = new THREE.Group(); hip.add(upper);
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.44, 20), navy); torso.position.y = 0.2; upper.add(torso);
      box(0.13, 0.3, 0.03, shirt, 0, 0.27, 0.185, upper);                 // 白襯衫前襟（不打領帶）
      for (const sx of [-1, 1]) { const lp = box(0.06, 0.26, 0.02, M(0x1b2a48), sx * 0.085, 0.3, 0.19, upper); lp.rotation.z = sx * 0.25; } // 西裝翻領
      for (const yy of [0.12, 0.2]) cyl(0.012, 0.012, 0.01, M(0xd9c48a), 0.0, yy, 0.205, upper, 8).rotation.x = Math.PI / 2;
      const collar = box(0.18, 0.05, 0.05, shirt, 0, 0.43, 0.13, upper); collar.rotation.x = -0.3;
      const head = new THREE.Group(); head.position.y = 0.66; upper.add(head);
      head.add(new THREE.Mesh(new THREE.SphereGeometry(0.235, 24, 18), skin));
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.248, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), hairM); hair.position.y = 0.02; head.add(hair);
      const fringe = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 10, Math.PI * 1.15, Math.PI * 0.7, Math.PI * 0.3, Math.PI * 0.14), hairM); head.add(fringe);
      const back = new THREE.Mesh(new THREE.SphereGeometry(0.244, 20, 12, Math.PI * 0.4, Math.PI * 1.2, Math.PI * 0.3, Math.PI * 0.35), hairM); head.add(back);
      for (const ex of [-0.08, 0.08]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.027, 10, 8), M(0x111111)); e.position.set(ex, 0.0, 0.215); head.add(e);
        const hl = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 4), M(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 })); hl.position.set(ex + 0.01, 0.012, 0.24); head.add(hl);
        const br = box(0.08, 0.018, 0.02, hairM, ex, 0.075, 0.215, head); br.rotation.z = ex > 0 ? -0.1 : 0.1;
        const bl = new THREE.Mesh(new THREE.CircleGeometry(0.028, 12), new THREE.MeshBasicMaterial({ color: 0xf0a0a0, transparent: true, opacity: 0.6 })); bl.position.set(ex * 1.5, -0.06, 0.2); bl.rotation.y = ex > 0 ? 0.6 : -0.6; head.add(bl);
      }
      const smile = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12, Math.PI), M(0x7a3b2e)); smile.position.set(0, -0.08, 0.222); smile.rotation.z = Math.PI; head.add(smile);
      const arms = [];
      for (const sx of [-1, 1]) {
        const sh = new THREE.Group(); sh.position.set(sx * 0.215, 0.38, 0); upper.add(sh);
        cyl(0.05, 0.055, 0.2, navy, 0, -0.1, 0, sh, 12);
        const el2 = new THREE.Group(); el2.position.y = -0.2; sh.add(el2);
        cyl(0.05, 0.05, 0.13, navy, 0, -0.06, 0, el2, 12);
        cyl(0.052, 0.052, 0.025, shirt, 0, -0.13, 0, el2, 12);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), skin); hand.position.y = -0.17; el2.add(hand);
        arms.push({ sh, el: el2 });
      }
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }));
      flat(shadow, 0.012); g.add(shadow);
      g.scale.setScalar(1.3); scene.add(g);
      const tag = (() => { const cv = document.createElement('canvas'); cv.width = 360; cv.height = 96; const c = cv.getContext('2d');
        c.fillStyle = 'rgba(16,40,80,0.86)'; c.beginPath(); c.roundRect(4, 4, 352, 88, 44); c.fill(); c.strokeStyle = '#38c8ff'; c.lineWidth = 4; c.stroke();
        c.fillStyle = '#eaf4ff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `bold 54px ${SANS}`; c.fillText('Louis', 180, 50);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(cv), transparent: true, depthTest: false })); s.scale.set(0.95, 0.26, 1); s.renderOrder = 11; scene.add(s); return s; })();
      const mkBubble = (W, edge) => { const cv = document.createElement('canvas'); cv.width = 480; cv.height = 180; const tex = canvasTex(cv);
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })); spr.scale.set(W, W * 0.374, 1); spr.renderOrder = 12; spr.visible = false; scene.add(spr);
        let cur = ''; const say = (t) => { if (t === cur) return; cur = t; const c = cv.getContext('2d'); c.clearRect(0, 0, 480, 180);
          c.fillStyle = '#ffffff'; c.strokeStyle = edge; c.lineWidth = 6; c.beginPath(); c.roundRect(8, 8, 464, 124, 40); c.moveTo(220, 132); c.lineTo(240, 172); c.lineTo(262, 132); c.fill(); c.stroke();
          c.fillStyle = '#ffffff'; c.fillRect(224, 124, 34, 12);
          c.fillStyle = '#10223f'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, t, 420, 56, 'bold', SANS); c.fillText(t, 240, 72); tex.needsUpdate = true; };
        return { spr, say }; };
      const mb = mkBubble(2.3, '#1f6fbf'), rb = mkBubble(2.0, '#3fb56b');
      return { kind: 'louis', g, rig, hip, upper, head, legs, arms, tag, bubble: mb.spr, say: mb.say, reply: rb.spr, replySay: rb.say };
    })();
    if (master) master.kind = 'master';
    const VIS = master || louis; // 每個模板只有一位主動訪客：模板 A 太極拳宗師、模板 B Louis
    const TALK = {"dlg": [{"g": "tech", "a": ["IEA：資料中心用電到2030年將近倍增", "從2025年485TWh增至約950TWh"], "s": "儲能應用案例先整理好，客戶問得到"}, {"g": "tech", "a": ["IEA：2025年AI資料中心用電成長50%"], "s": "可多留意AI機房對備援電力的需求"}, {"g": "tech", "a": ["IEA估2030年資料中心電池需求約25GW"], "s": "產品說明可補上削峰與備援情境"}, {"g": "proc", "a": ["TrendForce：AI機房儲能從選配變必要"], "s": "報價前先問清楚客戶的備援規格"}, {"g": "proc", "a": ["日經：DRAM價格已約為去年底的兩倍"], "s": "買電腦或伺服器前，先比價再排交期"}, {"g": "proc", "a": ["TrendForce：第4季DRAM合約價估季增10–15%"], "s": "含記憶體的設備報價，留意有效期"}, {"g": "proc", "a": ["TrendForce：記憶體缺口收斂，漲幅逐季縮小"], "s": "長約價格條款，簽約前逐條確認"}, {"g": "legal", "a": ["歐盟AI法：今年8月2日起開始執法", "含通用模型、禁止行為與透明度規則"], "s": "與歐洲夥伴合作，留意合約AI條款"}, {"g": "legal", "a": ["歐盟對頂尖模型罰款最高達全球營收3%"], "s": "用AI工具前，先看條款與資料用途"}, {"g": "legal", "a": ["歐盟高風險AI規則2027年12月2日起適用", "範圍包含關鍵基礎設施等領域"], "s": "設備若用AI控制，可先確認是否適用"}, {"g": "fin", "a": ["Menlo：企業AI部署支出至9月達1770億美元", "去年約330億美元"], "s": "導入AI先算月成本，再看省多少工時"}, {"g": "fin", "a": ["麥肯錫：約兩成企業說AI成本限制了使用"], "s": "每月檢查一次AI訂閱與用量"}, {"g": "fin", "a": ["Ramp：每百萬token均價一個月降21%"], "s": "模型可定期比價，不必綁定一家"}, {"g": "inv", "a": ["NPR：那斯達克本週跌10%", "為2020年3月以來最差的一週"], "s": "波動大時先看全貌，別急著做決定"}, {"g": "inv", "a": ["NPR：Fed九月升息，三年多來首次", "AI蓋資料中心的借貸成本跟著變高"], "s": "研究AI題材時，可一併看負債與利率"}, {"g": "inv", "a": ["NPR：市場擔心AI公司間循環融資風險"], "s": "留意資產是否過度集中在同一主題"}, {"g": "mgmt", "a": ["Gartner：僅17%組織已部署AI代理", "逾六成預計兩年內導入"], "s": "可先挑一個流程試行，再慢慢擴大"}, {"g": "mgmt", "a": ["Gartner：代理式AI正處期望膨脹高峰"], "s": "導入前先定好驗收標準與負責人"}, {"g": "mgmt", "a": ["麥肯錫：大企業四成在擴大用AI代理", "小型組織則持平在22%"], "s": "小公司可從重複的文書工作開始"}, {"g": "ops", "a": ["KPMG：資料準備與存取是AI首要障礙"], "s": "報價與規格資料先整理成固定格式"}, {"g": "ops", "a": ["Gartner：41%資安長遇過深偽社交工程"], "s": "改帳戶或付款的要求，一律回撥確認"}, {"g": "ops", "a": ["IDC：不到一半的AI概念驗證能上線"], "s": "試行時記錄成效，沒效就及早停"}], "react": ["真的嗎？那可以怎麼做？", "這個值得記下來", "嗯，有道理", "那我們能做什麼？", "原來如此", "好，回頭整理給大家"], "mOpen": ["來來來，喝茶先，趨勢慢慢聊", "老夫考考你們：AI最近有何新鮮事？", "以柔克剛，先聽再出手", "茶要慢慢品，消息也要慢慢查"], "mReact": ["好！這招老夫記下了", "心靜，判斷才準", "快不如穩，穩不如準", "妙哉，貴在實用"], "lOpen": ["大家在聊什麼？我也聽聽", "喝杯咖啡，聊聊AI新消息吧", "有什麼值得注意的趨勢？"], "lReact": ["這點很實用，記下了", "好，我們慢慢來", "謝謝，辛苦大家了", "有道理，回頭再細看"]};
    const ROLE = { cto: 'tech', cpo: 'proc', clo: 'legal', fpa: 'fin', ia: 'inv', cos: 'mgmt', pa: 'mgmt', kobe: 'ops', fly: 'ops', admin: 'ops' };
    // 聚會泡泡（每處聚會一個；一次只有一人說話，輪流出現）
    function talkBubble() {
      const cv = document.createElement('canvas'); cv.width = 720; cv.height = 250; const tex = canvasTex(cv);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })); spr.scale.set(3.1, 3.1 * 250 / 720, 1); spr.renderOrder = 12; spr.visible = false; scene.add(spr);
      let cur = '';
      const say = (t, who) => { const key = who + '|' + t; if (key === cur) return; cur = key; const c = cv.getContext('2d'); c.clearRect(0, 0, 720, 250);
        c.fillStyle = IS_B ? '#ffffff' : '#fffdf7'; c.strokeStyle = IS_B ? '#1f6fbf' : '#5f9e8a'; c.lineWidth = 6;
        c.beginPath(); c.roundRect(8, 8, 704, 190, 36); c.moveTo(338, 198); c.lineTo(360, 242); c.lineTo(384, 198); c.fill(); c.stroke(); c.fillRect(342, 190, 38, 12);
        c.fillStyle = IS_B ? '#1f6fbf' : '#8a6a2e'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = `bold 34px ${SANS}`; c.fillText(who, 30, 42);
        c.fillStyle = IS_B ? '#10223f' : '#23211e'; c.textAlign = 'center'; const font = IS_B ? SANS : SERIF;
        const lines = t.length > 16 ? [t.slice(0, Math.ceil(t.length / 2)), t.slice(Math.ceil(t.length / 2))] : [t];
        let sz = 54; c.font = `bold ${sz}px ${font}`; while (lines.some((l) => c.measureText(l).width > 660) && sz > 30) { sz -= 2; c.font = `bold ${sz}px ${font}`; }
        lines.forEach((l, i) => c.fillText(l, 360, lines.length === 1 ? 118 : 96 + i * 62)); tex.needsUpdate = true; };
      return { spr, say };
    }
    const mst = { state: 'pick', target: null, route: [], timer: 0, replan: 0, visited: new Set(), x: IS_B ? -1.9 : 0, z: IS_B ? 9.3 : CZ + 8.0, yaw: Math.PI, prev: null, log: [], greetT: 0 };
    {
      const LI = 4.0, LO = 8.0, CR = 2.0, SPEED = 1.3, GAPS = [0, 45, 80, 114.5, 147, 180, -45, -80, -114.5, -147].map((d) => d * Math.PI / 180);
      const PRACTICE = IS_B ? { x: -1.9, z: 9.3 } : { x: 0, z: CZ + 8.0 };
      const CORNERS = { tea: { x: -8.6, z: 6.4 }, read: { x: 8.6, z: -6.4 }, taichi: { x: 8.6, z: 6.4 } };
      const th = (p) => Math.atan2(p.x, p.z - CZ), rad = (p) => Math.hypot(p.x, p.z - CZ);
      const pt = (r, t) => ({ x: r * Math.sin(t), z: CZ + r * Math.cos(t) });
      const dAng = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
      const arc = (cx, cz, r, t0, t1) => { const d = dAng(t0, t1), n = Math.max(1, Math.ceil(Math.abs(d) * r / 0.35)), o = []; for (let i = 1; i <= n; i++) { const t = t0 + d * i / n; o.push({ x: cx + r * Math.sin(t), z: cz + r * Math.cos(t) }); } return o; };
      const cornerOf = (p) => Object.values(CORNERS).find((c) => Math.hypot(p.x - c.x, p.z - c.z) < CR + 0.4) || null;
      // 模板 A：從某點走到外圈或內圈走道（回傳路徑點與所在走道）
      function exitTo(p) {
        const c = cornerOf(p);
        if (c) { const a = Math.atan2(p.x - c.x, p.z - c.z), ain = Math.atan2(-c.x, CZ - c.z); return { pts: [{ x: c.x + CR * Math.sin(a), z: c.z + CR * Math.cos(a) }, ...arc(c.x, c.z, CR, a, ain), pt(LO, th(c))], lane: LO, t: th(c) }; }
        const r = rad(p), t = th(p);
        return r < 4.8 ? { pts: [pt(LI, t)], lane: LI, t } : { pts: [pt(LO, t)], lane: LO, t };
      }
      function planA(from, to) {
        const A = exitTo(from), B = exitTo(to); const pts = [...A.pts];
        if (A.lane === B.lane) pts.push(...arc(0, CZ, A.lane, A.t, B.t));
        else {
          let best = GAPS[0], bc = 1e9; for (const gp of GAPS) { const c = Math.abs(dAng(A.t, gp)) * A.lane + Math.abs(dAng(gp, B.t)) * B.lane; if (c < bc) { bc = c; best = gp; } }
          pts.push(...arc(0, CZ, A.lane, A.t, best), pt(B.lane, best), ...arc(0, CZ, B.lane, best, B.t));
        }
        pts.push(...B.pts.slice(0, -1).reverse(), { x: to.x, z: to.z });
        return pts;
      }
      // 模板 B 走道圖：中央主走道 C（x=0）、兩側次走道 L／R（x=∓7.1，工位島與外圍島之間）、前方橫走道 X1（z=8.7）；
      // 咖啡吧、休息區、專注艙各從綠籬開口進出；機房與專注艙第二座玻璃艙走不進去，不列為拜訪目標。
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      function attachB(p) {
        const ax = Math.abs(p.x), sx = Math.sign(p.x) || 1;
        if (p.x < -7.6 && p.z > 10.3) return { room: 'coffee', pre: [{ x: -8.6, z: 12.4 }], cp: { x: -7.1, z: 12.4 }, k: 'L' };
        if (p.x > 7.6 && p.z > 10.3) return { room: 'lounge', pre: (p.x > 9.3 ? [{ x: p.x, z: 13.5 }, { x: 9.0, z: 13.5 }] : []).concat([{ x: 8.6, z: 12.4 }]), cp: { x: 7.1, z: 12.4 }, k: 'R' };
        if (p.x > 7.6 && p.z > -3.6 && p.z < 0.6) return { room: 'booth', pre: [{ x: 8.6, z: -1.4 }], cp: { x: 7.1, z: -1.4 }, k: 'R' };
        if (ax >= 6.6) return { pre: [], cp: { x: 7.1 * sx, z: clamp(p.z, -4.6, 16.0) }, k: sx < 0 ? 'L' : 'R' };
        if (p.z > 6.2) return { pre: [], cp: { x: clamp(p.x, -7.1, 7.1), z: 8.7 }, k: 'X' };
        return { pre: [], cp: { x: 0, z: clamp(p.z, -3.0, 15.5) }, k: 'C' };
      }
      const JUNC = { C: { x: 0, z: 8.7 }, L: { x: -7.1, z: 8.7 }, R: { x: 7.1, z: 8.7 } };
      function planB(from, to) {
        if (Math.hypot(from.x - to.x, from.z - to.z) < 1.2) return [{ x: to.x, z: to.z }];
        const A = attachB(from), B = attachB(to);
        if (A.room && A.room === B.room) return [...(B.room === 'lounge' && (from.x > 9.3) !== (to.x > 9.3) ? [{ x: 9.0, z: 13.5 }] : []), { x: to.x, z: to.z }];
        const pts = [...A.pre, A.cp];
        if (A.k !== B.k) { if (A.k !== 'X') pts.push(JUNC[A.k]); if (B.k !== 'X') pts.push(JUNC[B.k]); }
        pts.push(B.cp, ...B.pre.slice().reverse(), { x: to.x, z: to.z });
        return pts;
      }
      const plan = IS_B ? planB : planA;
      const isFree = (d) => !meetingOf(d.f.id) && hasRecord(d.f.id) && !isWorking(person(d.f.id));
      // 站位：在對方外側約 1.15 處；散步中的人依其角速度預估會合點
      function standOfA(d, lead = 0) {
        const s = d.slot;
        if (d.atDesk || !s) { const w = seatWorld(d), t = th(w); return { ...pt(rad(w) + 1.2, t), moving: false }; }
        if (s.type === 'walk') { const p = d.av.g.position, t = th(p) + (d.react ? 0 : s.sp * lead), r = rad(p); return { ...pt(r + 1.15, t), moving: true }; }
        const c = CORNERS[s.type]; if (!c) return null;
        const dx = s.x - c.x, dz = s.z - c.z, L = Math.hypot(dx, dz) || 1, k = (L + 1.15) / L; return { x: c.x + dx * k, z: c.z + dz * k, moving: false };
      }
      const STAND_B = { 'coffee-1': { x: -10.85, z: 12.85 }, 'coffee-2': { x: -9.4, z: 12.45 }, 'coffee-3': { x: -8.5, z: 13.3 }, 'lounge-1': { x: 8.85, z: 12.2 }, 'lounge-2': { x: 11.2, z: 12.15 }, 'lounge-3': { x: 11.25, z: 13.3 }, 'booth-1': { x: 8.6, z: -1.4 } };
      function standOfB(d) {
        const s = d.slot;
        if (d.atDesk || !s) { const w = seatWorld(d); return { x: (Math.sign(w.x) || 1) * 2.0, z: w.z, moving: false }; }
        if (s.type === 'patrol') {
          const p = d.av.g.position;
          if (/^walk-aisle/.test(s.id)) return { x: p.x, z: p.z + (mst.z >= p.z ? 1.1 : -1.1), moving: true };
          if (/^walk-front/.test(s.id)) return { x: p.x, z: 8.7, moving: true };
          return null; // 機房巡視：玻璃機房內走道太窄
        }
        const st = STAND_B[s.id]; return st ? { ...st, moving: false } : null;
      }
      const standOf = IS_B ? standOfB : standOfA;
      const routeLen = (pts) => { let L = 0, px = mst.x, pz = mst.z; for (const q of pts) { L += Math.hypot(q.x - px, q.z - pz); px = q.x; pz = q.z; } return L; };
      function replan(d) {
        let st = standOf(d); if (!st) return null;
        if (st.moving && !IS_B) for (let i = 0; i < 3; i++) { const T = routeLen(plan(mst, st)) / SPEED; st = standOf(d, T); }
        mst.route = plan(mst, st); return st;
      }
      const isMaster = VIS && VIS.kind === 'master';
      const GREET = isMaster ? (n) => [`${n}，休息一下～`, `抱拳！${n} 你好`, `${n}，深呼吸～`, `${n}，喝口茶吧`] : (n) => [`嗨，${n}！休息一下`, `${n}，辛苦了`, `${n}，喝杯咖啡嗎？`, `${n}，最近還好嗎？`];
      const REPLY = isMaster ? ['宗師早！', '謝謝宗師', '一起練！', '宗師好～', '受教了！', '宗師請喝茶'] : ['Louis 好！', '謝謝總經理', '一起喝咖啡！', '您好～', '收到，謝謝', '總經理辛苦了'];
      const CALL = isMaster ? '宗師！' : 'Louis！';
      const COOL = 8, GREET_T = 4.0, SAY_T = 1.9, LINE_T = 4.2; // 同一人 8 秒內不重複；宗師／Louis 先說、對方 1.9 秒後回話
      mst.cool = {}; mst.caller = null; mst.greets = 0;
      const logIt = (ev, d) => { mst.log.push({ t: Math.round(performance.now()), ev, id: d ? (d.f ? d.f.id : d.id) : null }); if (mst.log.length > 120) mst.log.shift(); };
      const ok = (d, sec) => isFree(d) && !(mst.cool[d.f.id] > sec - COOL) && !d.gather && !!standOf(d);
      const distTo = (d) => Math.hypot(d.av.g.position.x - mst.x, d.av.g.position.z - mst.z);
      const startGo = (d) => { mst.target = d; mst.state = 'go'; mst.replan = 0; mst.stand = null; logIt('target', d); };
      // ---------- 聚會：同一休息區有 2–3 位休息中成員（或 1 位＋宗師／Louis）就一起喝茶、吃點心、喝咖啡、聊 AI 趨勢 ----------
      const SPOTS = IS_B ? [
        { id: 'coffee', name: '咖啡吧', test: (s) => /^coffee/.test(s.id), c: { x: -10.0, z: 12.4 }, host: { x: -9.0, z: 12.1 }, act: ['coffee'] },
        { id: 'lounge', name: '休息區', test: (s) => /^lounge/.test(s.id), c: { x: 10.4, z: 12.2 }, host: { x: 8.9, z: 12.7 }, act: ['coffee', 'chat'] },
      ] : [
        { id: 'tea', name: '茶席', test: (s) => s.type === 'tea', c: { x: -8.6, z: 6.4 }, host: { x: -8.6, z: 7.45 }, act: ['tea', 'meal'] },
        { id: 'read', name: '書房', test: (s) => s.type === 'read', c: { x: 8.6, z: -6.2 }, host: { x: 8.6, z: -5.15 }, act: ['chat'] },
        { id: 'tai', name: '太極場', test: (s) => s.type === 'taichi', c: { x: 8.6, z: 6.2 }, host: { x: 8.6, z: 6.25 }, act: ['chat'] },
      ];
      for (const sp of SPOTS) Object.assign(sp, { seq: null, li: 0, t: 0, gap: 1.5 + Math.random() * 3, k: Math.floor(Math.random() * 7), bub: talkBubble(), hostCool: -99, members: [] });
      let dlgPtr = Math.floor(Math.random() * TALK.dlg.length);
      const nameOf = (who) => who === 'host' ? (isMaster ? '太極拳宗師' : 'Louis') : (TAG[who.f.id] || [shortName(who.f)])[0];
      const pick = (arr, k) => arr[((k % arr.length) + arr.length) % arr.length];
      function buildSeq(sp, hostHere) {
        const m = sp.members, roles = new Set(m.map((d) => ROLE[d.f.id]));
        let dl = null; for (let n = 0; n < TALK.dlg.length; n++) { const c = TALK.dlg[(dlgPtr + n) % TALK.dlg.length]; if (roles.has(c.g)) { dl = c; dlgPtr = (dlgPtr + n + 1) % TALK.dlg.length; break; } }
        if (!dl) return null;
        const R = m.find((d) => ROLE[d.f.id] === dl.g), others = m.filter((d) => d !== R), O = hostHere ? 'host' : pick(others, sp.k);
        if (!O) return null;
        const seq = [];
        if (hostHere) seq.push({ who: 'host', text: pick(isMaster ? TALK.mOpen : TALK.lOpen, sp.k) });
        for (const t of dl.a) seq.push({ who: R, text: t });
        seq.push({ who: O, text: O === 'host' ? pick(isMaster ? TALK.mReact : TALK.lReact, sp.k + 1) : pick(TALK.react, sp.k) });
        seq.push({ who: R, text: dl.s });
        if (hostHere && others.length) seq.push({ who: others[0], text: pick(TALK.react, sp.k + 2) });
        return seq;
      }
      function tickSpots(sec, dt) {
        for (const d of desks) d.gather = null;
        for (const sp of SPOTS) {
          sp.members = desks.filter((d) => !d.atDesk && d.slot && sp.test(d.slot) && isFree(d) && !d.react).slice(0, 3);
          const hostHere = mst.state === 'hosting' && mst.spot === sp;
          const active = sp.members.length >= 2 || (sp.members.length >= 1 && hostHere);
          if (!active) { sp.seq = null; sp.bub.spr.visible = false; continue; }
          if (!sp.seq) { if ((sp.gap -= dt) <= 0) { sp.seq = buildSeq(sp, hostHere); sp.withHost = hostHere; sp.li = 0; sp.t = 0; sp.k++; sp.actNow = pick(sp.act, sp.k); if (sp.seq) logIt('talk:' + sp.id + ':' + sp.members.map((d) => d.f.id).join('+') + (hostHere ? '+host' : '')); } }
          let line = null;
          if (sp.seq) {
            sp.t += dt; if (sp.t > LINE_T) { sp.li++; sp.t = 0; }
            while (sp.seq && sp.li < sp.seq.length && sp.seq[sp.li].who !== 'host' && !sp.members.includes(sp.seq[sp.li].who)) sp.li++; // 說話者轉忙碌：跳過
            if (sp.seq && sp.seq[sp.li] && sp.seq[sp.li].who === 'host' && !hostHere) sp.li++;
            if (sp.li >= sp.seq.length) { sp.seq = null; sp.gap = 5 + Math.random() * 4; if (sp.withHost) mst.hostDone = true; }
            else line = sp.seq[sp.li];
          }
          const act = sp.actNow || sp.act[0];
          for (const d of sp.members) d.gather = { cx: sp.c.x, cz: sp.c.z, speaking: !!line && line.who === d, act, sp: sp.id };
          sp.speakingHost = !!line && line.who === 'host';
          if (line && spritesShown) { const p = line.who === 'host' ? VIS.g.position : line.who.av.g.position; sp.bub.say(line.text, nameOf(line.who)); sp.bub.spr.position.set(p.x, p.y + 3.15, p.z); sp.bub.spr.visible = true; sp.lastLine = line.text; }
          else sp.bub.spr.visible = false;
        }
      }
      mst.spots = SPOTS;
      mst.tick = (sec, dt) => {
        const a = VIS; if (!a) return;
        tickSpots(sec, dt);
        // 目標或呼喚者轉為工作中／會議中：立即放棄
        if (mst.target && !isFree(mst.target)) { logIt('abandon', mst.target); mst.target = null; mst.state = 'pick'; mst.route = []; }
        if (mst.state === 'called' && (!mst.caller || !isFree(mst.caller))) { logIt('abandon', mst.caller); mst.caller = null; mst.state = 'pick'; }
        if ((mst.state === 'host-go' || mst.state === 'hosting') && !desks.some((d) => !d.atDesk && d.slot && mst.spot.test(d.slot) && isFree(d))) { logIt('host-abandon', mst.spot); mst.state = 'pick'; mst.route = []; }
        if (mst.state === 'hosting') { mst.timer -= dt; if (mst.hostDone || mst.timer <= 0) { logIt('host-done', mst.spot); for (const d of mst.spot.members) mst.cool[d.f.id] = sec; mst.spot.hostCool = sec; mst.lastHost = sec; mst.state = 'rest'; mst.timer = 1.4; } }
        if (mst.state === 'pick' || (mst.state === 'practice' && (mst.timer -= dt) <= 0)) {
          // 約三成回合：帶休息中的成員在休息區喝茶／吃點心／喝咖啡聊天
          const hostable = SPOTS.filter((sp) => sec - sp.hostCool > 25 && !(mst.lastHost > sec - 20) && desks.some((d) => !d.atDesk && d.slot && sp.test(d.slot) && isFree(d) && !(mst.cool[d.f.id] > sec - COOL)));
          let c = desks.filter((d) => ok(d, sec) && !mst.visited.has(d.f.id));
          if (!c.length) { mst.visited.clear(); c = desks.filter((d) => ok(d, sec)); }
          if (hostable.length && (Math.random() < 0.3 || !c.length)) { const sp = pick(hostable, Math.floor(Math.random() * 9)); mst.spot = sp; mst.state = 'host-go'; mst.route = plan(mst, sp.host); logIt('host-go', sp); }
          else if (c.length) {
            const near = c.filter((d) => distTo(d) < 6);
            if (near.length && Math.random() < 0.2) { const k = near[Math.floor(Math.random() * near.length)]; mst.caller = k; mst.state = 'called'; mst.timer = 1.6; mst.route = []; logIt('call', k); }
            else { c.sort((p, q) => distTo(p) - distTo(q)); startGo(c[0]); }
          } else if (mst.state !== 'practice') { mst.state = 'practice'; mst.route = plan(mst, PRACTICE); mst.timer = 1; logIt('practice'); }
          else mst.timer = 1;
        }
        let moving = false, face = null, st = null;
        if (mst.state === 'called' && mst.caller) {
          const cp = mst.caller.av.g.position; face = Math.atan2(cp.x - mst.x, cp.z - mst.z);
          if ((mst.timer -= dt) <= 0) { const k = mst.caller; mst.caller = null; startGo(k); }
        }
        if (mst.state === 'host-go' && !mst.route.length && Math.hypot(mst.spot.host.x - mst.x, mst.spot.host.z - mst.z) < 0.3) { mst.state = 'hosting'; mst.hostDone = false; mst.timer = 45; mst.spot.seq = null; mst.spot.gap = 0.6; logIt('hosting', mst.spot); }
        if (mst.state === 'hosting') face = Math.atan2(mst.spot.c.x - mst.x, mst.spot.c.z - mst.z);
        const d = mst.target;
        if (mst.state === 'go' && d) {
          // 靜止目標只規劃一次（位置改變才重算）；散步中的目標預估會合點，走完再重估，接近時直接迎上
          const key = d.atDesk ? 'desk' : d.slot;
          const near = mst.stand && mst.stand.moving && (() => { const lv = standOf(d); if (!lv) return null; const dd = Math.hypot(lv.x - mst.x, lv.z - mst.z); return (IS_B ? dd < 2.6 : dd < 2.2 && Math.abs(rad(lv) - rad(mst)) < 0.6) ? lv : null; })();
          if (near) mst.route = [{ x: near.x, z: near.z }]; // 已很近：直接迎上去
          else if (mst.replan <= 0 || mst.slotRef !== key || (mst.stand && mst.stand.moving && (!mst.route.length || (IS_B && (mst.replan -= dt) <= 0)))) { st = replan(d); mst.replan = 1.5; mst.stand = st; mst.slotRef = key; }
          const live = standOf(d);
          if (!live) { logIt('abandon', d); mst.target = null; mst.state = 'pick'; mst.route = []; }
          else if (Math.hypot(live.x - mst.x, live.z - mst.z) < (live.moving ? 0.5 : 0.25)) {
            mst.state = 'greet'; mst.greetT = 0; mst.route = []; mst.mirror = Math.random() < 0.5; const n = mst.greets++;
            a.say(GREET((TAG[d.f.id] || [shortName(d.f)])[0])[hashId(d.f.id + n) % 4]); mst.replyText = REPLY[hashId(n + d.f.id) % REPLY.length]; logIt('greet', d);
          } else if (!mst.route.length && !live.moving) mst.route = [{ x: live.x, z: live.z }];
        }
        if (mst.route.length) {
          let step = SPEED * dt;
          while (step > 0 && mst.route.length) { const q = mst.route[0], dx = q.x - mst.x, dz = q.z - mst.z, L = Math.hypot(dx, dz); if (L <= step) { mst.x = q.x; mst.z = q.z; step -= L; mst.route.shift(); } else { mst.x += dx / L * step; mst.z += dz / L * step; step = 0; face = Math.atan2(dx, dz); } if (L > 1e-4) face = Math.atan2(dx, dz); }
          moving = true;
        }
        if (mst.state === 'greet' && d) {
          const tp = d.av.g.position; face = Math.atan2(tp.x - mst.x, tp.z - mst.z);
          if ((mst.greetT += dt) > GREET_T) { logIt('done', d); mst.visited.add(d.f.id); mst.cool[d.f.id] = sec; mst.prev = d.f.id; mst.target = null; mst.state = 'rest'; mst.timer = 1.4; }
        }
        if (mst.state === 'rest' && (mst.timer -= dt) <= 0) mst.state = 'pick';
        if (face != null) { mst.yaw += dAng(mst.yaw, face) * Math.min(1, dt * 8); }
        // 對方的回應（只給休息中的人；忙碌者 react 一律為空）：下一格由 poseAvatar 套用
        for (const q of desks) q.react = null;
        if (mst.state === 'called' && mst.caller && isFree(mst.caller)) mst.caller.react = { mode: 'call', t: 1.6 - mst.timer, mx: mst.x, mz: mst.z };
        const tg = mst.target;
        if (tg && isFree(tg)) {
          if (mst.state === 'greet') tg.react = { mode: 'greet', t: mst.greetT, mirror: mst.mirror, mx: mst.x, mz: mst.z };
          else if (mst.state === 'go' && distTo(tg) < 2.5) tg.react = { mode: 'face', mx: mst.x, mz: mst.z };
        }
        // 姿勢
        const kL = a.kind === 'louis';
        a.hip.position.y = kL ? 0.36 : 0.34; a.upper.rotation.set(0, 0, 0); a.head.rotation.set(0, 0, 0); a.rig.rotation.set(0, 0, 0);
        for (const L of a.legs) L.rotation.set(0, 0, 0);
        for (const A of a.arms) { A.sh.rotation.set(0, 0, 0); A.el.rotation.set(0, 0, 0); }
        if (moving) {
          const w = Math.sin(sec * 9);
          a.legs[0].rotation.x = w * 0.55; a.legs[1].rotation.x = -w * 0.55;
          a.arms[0].sh.rotation.x = -w * 0.5; a.arms[1].sh.rotation.x = w * 0.5; a.arms[0].sh.rotation.z = -0.15; a.arms[1].sh.rotation.z = 0.15;
          a.hip.position.y += Math.abs(w) * 0.03;
        }
        if (mst.state === 'greet') {
          const t = mst.greetT;
          if (t < 1.3) { a.arms[1].sh.rotation.z = 2.5; a.arms[1].el.rotation.z = Math.sin(sec * 11) * 0.45; a.head.rotation.z = Math.sin(sec * 5) * 0.08; }
          else if (t < 2.7) { const e = Math.sin(Math.min(1, (t - 1.3) / 1.4) * Math.PI); a.upper.rotation.x = e * (kL ? 0.25 : 0.45); a.head.rotation.x = e * 0.2;
            a.arms[0].sh.rotation.x = -1.35; a.arms[1].sh.rotation.x = -1.35; a.arms[0].sh.rotation.z = 0.5; a.arms[1].sh.rotation.z = -0.5; a.arms[0].el.rotation.x = -0.5; a.arms[1].el.rotation.x = -0.5; }
          else if (kL) { a.arms[1].sh.rotation.x = -0.9 + Math.sin(sec * 4) * 0.2; a.arms[1].el.rotation.x = -0.6; a.head.rotation.x = Math.sin(sec * 3) * 0.06; }
          else { const k = sec * 1.6; a.arms[0].sh.rotation.x = -1.0 - Math.sin(k) * 0.4; a.arms[1].sh.rotation.x = -1.0 + Math.sin(k) * 0.4; a.arms[0].sh.rotation.z = -0.3; a.arms[1].sh.rotation.z = 0.3; a.arms[0].el.rotation.x = -0.6; a.arms[1].el.rotation.x = -0.6; }
        } else if (mst.state === 'called') {
          a.arms[1].sh.rotation.z = 1.3; a.head.rotation.x = -0.1;
        } else if (mst.state === 'hosting' && !moving && (kL || mst.spot.speakingHost)) {
          // 主持聚會：說話時比手勢，聽時點頭
          if (mst.spot.speakingHost) { a.arms[1].sh.rotation.x = -0.9 + Math.sin(sec * 4) * 0.25; a.arms[1].el.rotation.x = -0.6; a.arms[0].sh.rotation.x = -0.3; }
          else a.head.rotation.x = 0.08 + Math.sin(sec * 1.6) * 0.06;
        } else if (!moving) {
          if (kL) { a.rig.rotation.y = Math.sin(sec * 0.6) * 0.15; a.head.rotation.y = Math.sin(sec * 0.8) * 0.25; a.arms[0].sh.rotation.z = -0.08; a.arms[1].sh.rotation.z = 0.08; }
          else {
          // 原地打太極（雲手）
          const t = sec * 0.7;
          a.hip.position.y = 0.31; a.legs[0].rotation.z = -0.16; a.legs[1].rotation.z = 0.16; a.rig.rotation.y = Math.sin(t * 0.5) * 0.45;
          a.arms[0].sh.rotation.x = -0.9 - Math.sin(t) * 0.5; a.arms[0].sh.rotation.z = -0.35 - Math.cos(t) * 0.3; a.arms[0].el.rotation.x = -0.5;
          a.arms[1].sh.rotation.x = -0.9 + Math.sin(t) * 0.5; a.arms[1].sh.rotation.z = 0.35 - Math.cos(t) * 0.3; a.arms[1].el.rotation.x = -0.5;
          }
        }
        const y = IS_B ? TOP : rad(mst) < PLAT_R ? TOP : 0;
        a.g.position.set(mst.x, y, mst.z); a.g.rotation.y = mst.yaw;
        a.tag.position.set(mst.x, y + 1.95, mst.z);
        a.bubble.position.set(mst.x, y + 2.6, mst.z);
        a.bubble.visible = spritesShown && mst.state === 'greet' && mst.greetT < SAY_T;
        a.tag.visible = spritesShown && !a.bubble.visible;
        // 對方的回話泡泡（說完才出現，避免兩個泡泡疊在一起）
        let rp = null;
        if (mst.state === 'greet' && tg && tg.react && mst.greetT >= SAY_T) { rp = tg; a.replySay(mst.replyText); }
        else if (mst.state === 'called' && mst.caller && mst.caller.react) { rp = mst.caller; a.replySay(CALL); }
        a.reply.visible = spritesShown && !!rp;
        if (rp) { const p = rp.av.g.position; a.reply.position.set(p.x, p.y + 2.75, p.z); }
      };
    }

    // 地面組織線（協議 2.6.4）：金線＝直屬、派工；朱紅虛線＝平行、稽核、確認
    const lineMat = new THREE.LineBasicMaterial({ color: IS_B ? 0x1f6fbf : GOLD, transparent: true, opacity: 0.85 });
    const dashMat = new THREE.LineDashedMaterial({ color: IS_B ? 0xff9a3c : CINNABAR, dashSize: 0.22, gapSize: 0.16, transparent: true, opacity: 0.95 });
    const link = (a, b, mat) => {
      if (IS_B) return; // 模板 B 的組織線畫在地面貼圖（buildThemeB）
      const A = ringPt(SEAT_DEG[a], -0.6), Bp = ringPt(SEAT_DEG[b], -0.6);
      const pts = []; for (let i = 0; i <= 24; i++) { const t = i / 24; const k = 1 - Math.sin(Math.PI * t) * 0.12; pts.push(new THREE.Vector3((A.x + (Bp.x - A.x) * t) * k, TOP + 0.02, CZ + (A.z - CZ + (Bp.z - A.z) * t) * k)); }
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat); ln.computeLineDistances(); scene.add(ln);
    };
    // Louis（中央主位）→ PA、CoS：直屬
    const linkCore = (b, mat) => {
      if (IS_B) return;
      const Bp = ringPt(SEAT_DEG[b], -0.6), L = Math.hypot(Bp.x, Bp.z - CZ), ux = Bp.x / L, uz = (Bp.z - CZ) / L, r0 = 2.3;
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ux * r0, TOP + 0.02, CZ + uz * r0), new THREE.Vector3(Bp.x, TOP + 0.02, Bp.z)]), mat); ln.computeLineDistances(); scene.add(ln);
    };
    linkCore('pa', lineMat); linkCore('cos', lineMat);
    for (const t of ['admin', 'kobe', 'fly']) link('pa', t, lineMat);       // PA 派工給特殊小組
    for (const t of ['clo', 'cto', 'cpo', 'fpa']) link('cos', t, lineMat);  // CoS 派工給四位專業 AI
    link('pa', 'cos', dashMat);                                            // PA 與 CoS 平行、不分大小
    link('pa', 'ia', dashMat);                                             // IA 報告由 PA 審核（IA 不是 PA 的下級）
    for (const t of ['admin', 'kobe', 'fly']) link(t, 'ia', dashMat);      // 特殊小組金融性產出交 IA 稽核
    link('cos', 'fly', dashMat);                                           // CoS 協調、經 PA 同意由 Fly 支援公司任務


    // ---------- 名牌 ----------
    function drawBar(c, x, y, w, h, value, color, track) {
      c.save(); c.beginPath(); c.roundRect(x, y, w, h, h / 2); c.clip();
      if (value == null) {
        c.fillStyle = '#5b5750'; c.fillRect(x, y, w, h); c.fillStyle = '#7a756c';
        for (let i = -h; i < w + h; i += 16) { c.beginPath(); c.moveTo(x + i, y); c.lineTo(x + i + 8, y); c.lineTo(x + i + 8 - h, y + h); c.lineTo(x + i - h, y + h); c.fill(); }
      } else {
        c.fillStyle = track || 'rgba(255,255,255,.14)'; c.fillRect(x, y, w, h);
        c.fillStyle = color || PAL.bar; c.fillRect(x, y, w * Math.max(0, Math.min(1, value / 100)), h);
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
      c.fillStyle = selected ? PAL.lblSelBg : PAL.lblBg;
      c.beginPath(); c.roundRect(8, y0, W - 16, h, 26); c.fill();
      c.strokeStyle = selected ? PAL.lblSelBorder : PAL.lblBorder; c.lineWidth = selected ? 10 : 4; c.stroke();
      const fg = selected ? PAL.lblSelFg : PAL.lblFg, sub = selected ? PAL.lblSelSub : PAL.lblSub;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const [nm, role] = TAG[d.f.id];
      c.fillStyle = fg; fitText(c, `${nm}・${role}`, W - 60, 60, 'bold'); c.fillText(`${nm}・${role}`, W / 2, y0 + 52);
      let st = status;
      if (status === '休息中' && d.slot && d.slot.label) st = `休息中・${d.slot.label}`;
      if (status === '會議中') { const m = meetingOf(d.f.id); if (m) st = `會議中・${m.title}`; }
      if (bar) {
        const pr = progressOf(p), fr = freshness(p);
        drawBar(c, 44, y0 + 102, W - 224, 34, pr.value, fr === 'old' ? '#9a948a' : null, PAL.track);
        c.fillStyle = fg; c.textAlign = 'right'; fitText(c, pr.value == null ? '暫無' : `${pr.value}%`, 120, 46, 'bold'); c.fillText(pr.value == null ? '暫無' : `${pr.value}%`, W - 40, y0 + 120);
        c.textAlign = 'center';
        const t = arr(p, 'doing').map((x) => x.text).filter(has).join('；') || '工作中';
        c.fillStyle = sub; fitText(c, t, W - 60, 38, 'normal'); let tt = t; while (c.measureText(tt).width > W - 60 && tt.length > 2) tt = tt.slice(0, -2) + '…'; c.fillText(tt, W / 2, y0 + 180);
      } else {
        c.fillStyle = status === '會議中' ? (PAL.meetTxt || '#e0b25c') : sub; fitText(c, st, W - 60, 44, 'normal'); let tt = st; while (c.measureText(tt).width > W - 60 && tt.length > 2) tt = tt.slice(0, -2) + '…'; c.fillText(tt, W / 2, y0 + 118);
      }
      // 更新時間＋新鮮度圓點
      const fr = freshness(p);
      const ut = p ? `${fmtTaipei(p._ts, false) || NO_DATA}${p._src === 'data' ? ' 底稿・非即時' : ' 更新'}` : '尚無回報';
      const yy = y0 + h - 34;
      c.font = `30px ${SANS}`; const tw = c.measureText(ut).width;
      c.fillStyle = FRESH_COL[fr]; c.beginPath(); c.arc(W / 2 - tw / 2 - 16, yy, 9, 0, Math.PI * 2); c.fill();
      c.fillStyle = selected ? PAL.lblSelSub : PAL.freshTxt ? PAL.freshTxt[fr] : FRESH_COL[fr] === '#9a948a' ? '#b3ac9f' : FRESH_COL[fr]; c.fillText(ut, W / 2 + 8, yy);
      d.label.tex.needsUpdate = true;
      const s = narrow ? 1.5 : 1.3;
      d.label.spr.scale.set(2.25 * s, 1.205 * s, 1); d.label.base = [2.25 * s, 1.205 * s]; d.label.fill = (bar ? 288 : 204) / 300;
    }
    function drawCore() {
      const c = coreCv.getContext('2d'), W = 640, H = 260;
      c.clearRect(0, 0, W, H);
      const st = louisState(), sel = selected === 'louis';
      c.fillStyle = sel ? PAL.coreSelBg : PAL.coreBg;
      c.beginPath(); c.roundRect(10, 10, W - 20, H - 20, 30); c.fill();
      c.strokeStyle = st === 'active' ? PAL.coreAct : PAL.coreIdle; c.lineWidth = st === 'active' || sel ? 10 : 5; c.stroke();
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const ttl = IS_B ? 'Louis・總經理指揮台' : 'Louis・總經理主位';
      c.fillStyle = PAL.coreTitle; fitText(c, ttl, W - 70, 62, 'bold', IS_B ? SANS : SERIF); c.fillText(ttl, W / 2, 74);
      let line;
      if (!louisActive || !has(louisActive.last_seen)) line = `最後來訊：${NO_DATA}`;
      else line = `最後來訊 ${fmtTaipei(louisActive.last_seen, false)}（${ago(louisActive.last_seen)}）`;
      c.fillStyle = st === 'active' ? PAL.coreLineAct : PAL.coreLine; fitText(c, line, W - 70, 44, 'bold'); c.fillText(line, W / 2, 150);
      const tip = st === 'active' ? (IS_B ? '一小時內有來訊・指揮台發光' : '一小時內有來訊・主位發光') : st === 'idle' ? '超過一小時未來訊' : '只記時間、不記內容';
      c.fillStyle = PAL.coreTip; fitText(c, tip, W - 70, 32, 'normal'); c.fillText(tip, W / 2, 206);
      coreTex.needsUpdate = true;
      const s = narrow ? 1.4 : 1.15; coreSpr.scale.set(2.7 * s, 1.1 * s, 1); meetSpr.scale.set(2.3 * s, 0.9 * s, 1); if (meetSpr2) meetSpr2.scale.set(2.3 * s, 0.9 * s, 1);
    }
    function drawMeet() {
      if (!IS_B) { drawMeetCard(meetCv, meetTex, meetings, PAL.meetFree); return; }
      const isLeft = (m) => m.pod === 'left';
      drawMeetCard(meetCv, meetTex, meetings.filter(isLeft), `${B.ROOMS.left.name}・空閒`);
      drawMeetCard(meetCv2, meetTex2, meetings.filter((m) => !isLeft(m)), `${B.ROOMS.right.name}・空閒`);
    }
    function drawMeetCard(cv, tex, list, freeText) {
      const c = cv.getContext('2d'), W = 560, H = 220;
      c.clearRect(0, 0, W, H);
      const busy = list.length > 0;
      c.fillStyle = PAL.meetBg; c.beginPath(); c.roundRect(8, 8, W - 16, H - 16, 26); c.fill();
      c.strokeStyle = busy ? '#e0b25c' : PAL.meetIdle; c.lineWidth = busy ? 8 : 4; c.stroke();
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if (!busy) { c.fillStyle = PAL.meetIdleTxt; fitText(c, freeText, W - 60, 64, 'bold'); c.fillText(freeText, W / 2, H / 2); }
      else {
        let t = list.map((x) => x.title).join('／'); c.fillStyle = PAL.meetTitle; fitText(c, t, W - 60, 54, 'bold'); while (c.measureText(t).width > W - 60 && t.length > 2) t = t.slice(0, -2) + '…'; c.fillText(t, W / 2, 80);
        c.fillStyle = '#e0b25c'; fitText(c, '會議中', W - 60, 48, 'bold'); c.fillText('會議中', W / 2, 150);
      }
      tex.needsUpdate = true;
    }

    // ---------- 大型看板內容 ----------
    function drawBigBoard() {
      const c = bigCv.getContext('2d'), W = 2048, H = 1280;
      const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, PAL.bg0); bg.addColorStop(1, PAL.bg1);
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      // 標題列
      if (IS_B) B.boardLogo(c, 92, 78);
      else {
        c.save(); c.globalAlpha = 0.9; drawTaiji(c, 92, 78, 38, '#f2eee5', '#191816'); c.restore();
        c.strokeStyle = '#b8995a'; c.lineWidth = 3; c.beginPath(); c.arc(92, 78, 38, 0, Math.PI * 2); c.stroke();
      }
      c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillStyle = PAL.ink;
      c.font = `bold 66px ${IS_B ? SANS : SERIF}`; c.fillText('全員即時看板', 150, 80);
      c.textAlign = 'right'; c.fillStyle = PAL.muted; c.font = `34px ${SANS}`;
      c.fillText(lastCheck ? `每 30 秒檢查・上次 ${fmtTaipei(lastCheck.toISOString())}（台北時間）` : '尚未解鎖', W - 60, 80);
      c.fillStyle = PAL.acc; c.fillRect(60, 140, W - 120, 3);
      // 左欄：成員
      const ids = ['pa', 'ia', 'admin', 'kobe', 'fly', 'cos', 'clo', 'cto', 'cpo', 'fpa'];
      const x0 = 60, colW = 1250, y0 = 172, rowH = 100;
      c.font = `28px ${SANS}`; c.fillStyle = PAL.dim; c.textAlign = 'left';
      c.fillText('成員', x0 + 30, y0 + 6); c.fillText('目前', x0 + 300, y0 + 6); c.fillText('進度', x0 + 760, y0 + 6); c.textAlign = 'right'; c.fillText('更新', x0 + colW - 20, y0 + 6); c.textAlign = 'left';
      ids.forEach((id, i) => {
        const f = FLOORS.find((x) => x.id === id), p = person(id), y = y0 + 34 + i * rowH;
        if (i === 5) { c.fillStyle = PAL.accA; c.fillRect(x0, y - 6, colW, 2); }
        c.fillStyle = i % 2 ? 'rgba(255,255,255,.025)' : 'rgba(255,255,255,.055)'; c.fillRect(x0, y, colW, rowH - 10);
        c.fillStyle = PERSONAL.has(id) ? PAL.dotP : PAL.dotC; c.beginPath(); c.arc(x0 + 30, y + 45, 13, 0, Math.PI * 2); c.fill();
        c.strokeStyle = PAL.acc; c.lineWidth = 2; c.stroke();
        const [nm, role] = TAG[id];
        c.fillStyle = PAL.ink; c.font = `bold 40px ${SANS}`; c.fillText(nm, x0 + 60, y + 34);
        c.fillStyle = PAL.muted; c.font = `26px ${SANS}`; c.fillText(role, x0 + 60, y + 72);
        const working = isWorking(p), meet = meetingOf(id), fr = freshness(p);
        const d = arr(p, 'doing');
        let txt = meet ? `會議中：${meet.title}` : d.length ? d.map((x) => x.text).join('；') : (p ? '休息中' : NO_DATA);
        c.fillStyle = working || meet ? PAL.ink : PAL.dim; c.font = `34px ${SANS}`;
        while (c.measureText(txt).width > 430 && txt.length > 2) txt = txt.slice(0, -2) + '…';
        c.fillText(txt, x0 + 300, y + 45);
        if (working) {
          const pr = progressOf(p).value;
          drawBar(c, x0 + 760, y + 30, 190, 30, pr, fr === 'old' ? '#9a948a' : null);
          c.fillStyle = PAL.ink; c.font = `bold 32px ${SANS}`; c.fillText(pr == null ? '暫無' : `${pr}%`, x0 + 964, y + 45);
        } else { c.fillStyle = PAL.faint; c.font = `30px ${SANS}`; c.fillText('—', x0 + 760, y + 45); }
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
      c.fillStyle = PAL.acc; c.font = `bold 40px ${IS_B ? SANS : SERIF}`; c.fillText(IS_B ? '總經理指揮台' : '主位', x2, yy); yy += 56;
      const st = louisState();
      c.fillStyle = st === 'active' ? PAL.active : PAL.sub2; c.font = `32px ${SANS}`;
      c.fillText(louisActive && has(louisActive.last_seen) ? `Louis 最後來訊 ${fmtTaipei(louisActive.last_seen, false)}（${ago(louisActive.last_seen)}）` : `Louis 最後來訊：${NO_DATA}`, x2, yy); yy += 74;
      c.fillStyle = PAL.acc; c.font = `bold 40px ${IS_B ? SANS : SERIF}`; c.fillText('警示', x2, yy); yy += 56;
      const al = alertList().slice(0, 5);
      c.font = `30px ${SANS}`;
      if (!al.length) { c.fillStyle = PAL.dim; c.fillText('目前沒有警示', x2, yy); yy += 50; }
      for (const a of al) {
        c.fillStyle = a.level === 'red' ? '#d0574a' : '#e0b25c'; c.fillRect(x2, yy - 20, 8, 40);
        c.fillStyle = PAL.alertTxt; let t = a.text; while (c.measureText(t).width > w2 - 30 && t.length > 2) t = t.slice(0, -2) + '…';
        c.fillText(t, x2 + 22, yy); yy += 54;
      }
      yy = Math.max(yy + 24, 720);
      c.fillStyle = PAL.acc; c.font = `bold 40px ${IS_B ? SANS : SERIF}`; c.fillText('累計用量', x2, yy); yy += 56;
      c.font = `30px ${SANS}`;
      const h = usage.hermes;
      if (h && Array.isArray(h.profiles) && h.profiles.length) for (const pf of h.profiles) {
        c.fillStyle = PAL.sub2; c.fillText(String(pf.label || pf.id).replace(/（.*?）/, ''), x2, yy);
        c.textAlign = 'right'; c.fillStyle = PAL.ink; c.fillText(`${fmtTok(pf.total)} 詞元`, x2 + w2, yy); c.textAlign = 'left'; yy += 46;
      } else { c.fillStyle = PAL.dim; c.fillText(`Air 特殊小組：${NO_DATA}`, x2, yy); yy += 46; }
      const g = usage.grok;
      if (g && g.shares) {
        c.fillStyle = PAL.sub2; c.fillText('助理本週額度已用', x2, yy);
        c.textAlign = 'right'; c.fillStyle = PAL.ink; c.fillText(typeof g.weekly_used_percent === 'number' ? `${Math.round(g.weekly_used_percent * 10) / 10}%` : NO_DATA, x2 + w2, yy); c.textAlign = 'left'; yy += 50;
        const tops = Object.entries(g.shares).filter(([, v]) => typeof v === 'number').sort((a, b) => b[1] - a[1]).slice(0, 4);
        for (const [id, v] of tops) {
          c.fillStyle = PAL.muted; c.fillText(TAG[id] ? TAG[id][0] : id, x2, yy);
          drawBar(c, x2 + 150, yy - 13, w2 - 280, 26, v);
          c.fillStyle = PAL.ink; c.textAlign = 'right'; c.fillText(v < 1 ? '<1%' : `${Math.round(v)}%`, x2 + w2, yy); c.textAlign = 'left'; yy += 44;
        }
      } else { c.fillStyle = PAL.dim; c.fillText(`助理額度：${NO_DATA}`, x2, yy); }
      c.fillStyle = PAL.foot; c.font = `24px ${SANS}`; c.fillText('特殊小組為真實詞元數；助理為週額度占比（非詞元）', x2, H - 52);
      c.fillStyle = PAL.foot; c.font = `24px ${SANS}`; c.fillText(`私人線（上五列）｜公司線（下五列）｜協議 ${PROTOCOL}`, x0 + 30, H - 40);
      bigTex.needsUpdate = true;
    }

    // ---------- 狀態更新 ----------
    function assignActivities() {
      const idle = desks.map((d) => d.f.id).filter((id) => !meetingOf(id) && hasRecord(id) && !isWorking(person(id))).sort();
      const taken = new Set(), map = {};
      const LEFT = new Set(['pa', 'admin', 'kobe', 'fly', 'ia']);
      for (const id of idle) {
        const pool = SLOTS.filter((s) => s.side === (LEFT.has(id) ? 'L' : 'R'));
        const src = pool.length ? pool : SLOTS;
        const i = hashId(id) % src.length;
        for (let n = 0; n < src.length; n++) { const s = src[(i + n) % src.length]; if (!taken.has(s.id)) { taken.add(s.id); map[id] = s; break; } }
      }
      return map;
    }
    function assignMeetSeats() {
      const map = {}; let n = 0;
      if (IS_B) {
        const cnt = { left: 0, right: 0 };
        for (const m of meetings) { const pod = m.pod === 'left' ? 'left' : 'right', seats = B.MEET_SEATS[pod]; for (const id of m.members) { if (map[id] || id === 'louis') continue; map[id] = seats[cnt[pod]++ % seats.length]; } }
        return map;
      }
      for (const m of meetings) for (const id of m.members) { if (map[id] || id === 'louis') continue; map[id] = MEET_SEATS[n % MEET_SEATS.length]; n++; }
      return map;
    }
    let selected = null, narrow = false;
    function update() {
      const act = assignActivities(), meetSeat = assignMeetSeats();
      for (const d of desks) {
        const id = d.f.id, p = person(id), working = isWorking(p), meet = meetingOf(id), on = id === selected;
        const waiting = p && arr(p, 'waiting_on_louis').length;
        if (working || meet || !hasRecord(id)) d.react = d.gather = null; // 轉為忙碌：立即停止互動與聚會
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
          // 與宗師互動時原地停下（累計暫停時間），結束後從同一點沿原路線繼續
          if (d.react) d.pauseAcc = (d.pauseAcc || 0) + (mst.fdt || 0);
          const ang = s.off + (sec - (d.pauseAcc || 0)) * s.sp + ph * 0.05;
          a.g.position.set(Math.sin(ang) * s.r, s.y ?? (s.r < PLAT_R ? TOP : 0), CZ + Math.cos(ang) * (s.rz ?? s.r));
          a.g.rotation.y = ang + (s.sp > 0 ? Math.PI / 2 : -Math.PI / 2);
          const w = d.react ? 0 : Math.sin(sec * 6 + ph);
          a.legs[0].thigh.rotation.x = w * 0.45; a.legs[1].thigh.rotation.x = -w * 0.45;
          a.legs[0].knee.rotation.x = Math.max(0, -w) * 0.5; a.legs[1].knee.rotation.x = Math.max(0, w) * 0.5;
          a.arms[0].sh.rotation.x = -w * 0.4; a.arms[1].sh.rotation.x = w * 0.4;
          a.hip.position.y = 0.72 + Math.abs(w) * 0.025;
        } else if (s.type === 'meet') {
          a.g.position.set(s.x, s.y ?? 0, s.z); a.g.rotation.y = s.yaw; sit(a, 0.5);
          for (const A of a.arms) { A.sh.rotation.x = -0.5; A.el.rotation.x = -0.7; }
          a.head.rotation.y = Math.sin(sec * 0.7 + ph) * 0.3;
        } else if (s.type === 'tea') {
          a.g.position.set(s.x, 0.1, s.z); a.g.rotation.y = s.yaw;
          sit(a, 0.24, Math.PI * 0.92);
          a.cup.visible = true;
          a.arms[1].sh.rotation.x = -0.6 + Math.sin(sec * 0.9 + ph) * 0.25; a.arms[1].el.rotation.x = -1.2;
          a.arms[0].sh.rotation.x = -0.35; a.arms[0].el.rotation.x = -0.9;
        } else if (s.type === 'read') {
          a.g.position.set(s.x, s.y ?? 0, s.z); a.g.rotation.y = s.yaw; sit(a, 0.42);
          a.book.visible = true;
          a.arms[0].sh.rotation.x = -0.55; a.arms[0].el.rotation.x = -1.0; a.arms[1].sh.rotation.x = -0.55; a.arms[1].el.rotation.x = -1.0;
          a.head.rotation.x = 0.3;
        } else if (s.type === 'coffee') {
          // 模板 B：站著喝咖啡聊天
          a.g.position.set(s.x, s.y ?? 0, s.z); a.g.rotation.y = s.yaw;
          a.cup.visible = true;
          a.arms[1].sh.rotation.x = -0.7 + Math.sin(sec * 0.9 + ph) * 0.25; a.arms[1].el.rotation.x = -1.3;
          a.arms[0].sh.rotation.x = 0.05; a.arms[0].sh.rotation.z = -0.08;
          a.head.rotation.y = Math.sin(sec * 0.5 + ph) * 0.25;
        } else if (s.type === 'patrol') {
          // 模板 B：在機房走道來回巡視
          if (d.react) d.pauseAcc = (d.pauseAcc || 0) + (mst.fdt || 0); // 與 Louis 互動時原地停下，結束後從同一點繼續
          const t = (sec - (d.pauseAcc || 0)) * s.sp + ph * 0.3 + (s.off || 0), u = (1 - Math.cos(t)) / 2, dx = s.p1.x - s.p0.x, dz = s.p1.z - s.p0.z;
          a.g.position.set(s.p0.x + dx * u, s.y ?? 0, s.p0.z + dz * u);
          a.g.rotation.y = Math.sin(t) >= 0 ? Math.atan2(dx, dz) : Math.atan2(-dx, -dz);
          const w = d.react ? 0 : Math.sin(sec * 6 + ph) * Math.min(1, Math.abs(Math.sin(t)) * 3);
          a.legs[0].thigh.rotation.x = w * 0.45; a.legs[1].thigh.rotation.x = -w * 0.45;
          a.legs[0].knee.rotation.x = Math.max(0, -w) * 0.5; a.legs[1].knee.rotation.x = Math.max(0, w) * 0.5;
          a.arms[0].sh.rotation.x = -w * 0.4; a.arms[1].sh.rotation.x = w * 0.4;
          a.head.rotation.y = s.label === '巡視機房' ? 0.5 : 0;
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
      if (a.bowl) a.bowl.visible = a.sticks.visible = false;
      if (d.react && !d.working) reactPose(d, sec);
      else if (d.gather && !d.working) gatherPose(d, sec);
      d.label.spr.position.set(lx, ly, lz);
    }
    // 休息中的成員回應宗師：轉身面向他，揮手回禮、抱拳，約半數一起比太極手勢；忙碌者沒有 react，維持原本動作
    // 聚會姿勢：面向聚會中心；說話者比手勢、其他人點頭；茶席輪流喝茶／吃點心（碗筷），咖啡吧拿杯子
    function gatherPose(d, sec) {
      const a = d.av, G = d.gather, s = d.slot, ph = d.phase;
      const yaw = Math.atan2(G.cx - a.g.position.x, G.cz - a.g.position.z);
      if (s.type === 'read') { let dy = yaw - a.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); a.upper.rotation.y = Math.max(-0.9, Math.min(0.9, dy)); }
      else if (s.type !== 'tea') a.g.rotation.y = yaw;
      if (!a.bowl) {
        const bowl = new THREE.Group(); const bm = M(0xf4efe6, { roughness: 0.5 });
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.045, 0.06, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.5, side: THREE.DoubleSide })); bowl.add(cup);
        const food = new THREE.Mesh(new THREE.CircleGeometry(0.068, 14), M(0xd9a54a)); food.rotation.x = -Math.PI / 2; food.position.y = 0.02; bowl.add(food);
        bowl.position.set(0, -0.27, 0.05); bowl.visible = false; a.arms[1].el.add(bowl); a.bowl = bowl;
        const sticks = new THREE.Group(); for (const dx of [-0.012, 0.012]) box(0.008, 0.008, 0.22, M(0x6b4a2e), dx, 0, 0.08, sticks);
        sticks.position.set(0, -0.25, 0.02); sticks.visible = false; a.arms[0].el.add(sticks); a.sticks = sticks; void bm;
      }
      const meal = G.act === 'meal';
      a.bowl.visible = meal; a.sticks.visible = meal;
      if (meal) { a.cup.visible = false; a.arms[1].sh.rotation.x = -0.7; a.arms[1].el.rotation.x = -1.1; a.arms[0].sh.rotation.x = -0.8 + Math.sin(sec * 2.2 + ph) * 0.25; a.arms[0].el.rotation.x = -1.25; }
      else if (G.act === 'tea' || G.act === 'coffee') a.cup.visible = true;
      if (G.speaking) { a.arms[0].sh.rotation.x = -0.75 + Math.sin(sec * 4) * 0.25; a.arms[0].sh.rotation.z = -0.2; a.arms[0].el.rotation.x = -0.55; a.head.rotation.x = Math.sin(sec * 3) * 0.05; }
      else a.head.rotation.x = 0.06 + Math.sin(sec * 1.4 + ph) * 0.06;
    }
    function reactPose(d, sec) {
      const a = d.av, r = d.react, s = d.slot;
      const yaw = Math.atan2(r.mx - a.g.position.x, r.mz - a.g.position.z);
      const seated = d.atDesk || !s || s.type === 'read';
      if (seated) { let dy = yaw - a.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); a.upper.rotation.y = Math.max(-1.1, Math.min(1.1, dy)); }
      else a.g.rotation.y = yaw;
      if (r.mode === 'face') { a.head.rotation.x = -0.08; return; }
      a.cup.visible = a.book.visible = false;
      for (const A of a.arms) { A.sh.rotation.set(0, 0, 0); A.el.rotation.set(0, 0, 0); }
      const wave = () => { a.arms[1].sh.rotation.z = 2.5; a.arms[1].el.rotation.z = Math.sin(sec * 11 + 1) * 0.45; a.head.rotation.z = Math.sin(sec * 5) * 0.08; };
      if (r.mode === 'call') { wave(); return; }
      const t = r.t;
      if (t < 0.4) { a.head.rotation.x = -0.08; }
      else if (t < 1.3) wave();
      else if (t < 2.7) { const e = Math.sin(Math.min(1, (t - 1.3) / 1.4) * Math.PI); a.upper.rotation.x += e * (seated ? 0.2 : 0.35); a.head.rotation.x = e * 0.2;
        a.arms[0].sh.rotation.x = -1.35; a.arms[1].sh.rotation.x = -1.35; a.arms[0].sh.rotation.z = 0.45; a.arms[1].sh.rotation.z = -0.45; a.arms[0].el.rotation.x = -0.5; a.arms[1].el.rotation.x = -0.5; }
      else if (r.mirror) { const k = sec * 1.6; a.arms[0].sh.rotation.x = -1.0 - Math.sin(k) * 0.4; a.arms[1].sh.rotation.x = -1.0 + Math.sin(k) * 0.4; a.arms[0].sh.rotation.z = -0.3; a.arms[1].sh.rotation.z = 0.3; a.arms[0].el.rotation.x = -0.6; a.arms[1].el.rotation.x = -0.6; }
      else { a.arms[0].sh.rotation.x = -0.9; a.arms[1].sh.rotation.x = -0.9; a.arms[0].sh.rotation.z = 0.4; a.arms[1].sh.rotation.z = -0.4; a.arms[0].el.rotation.x = -0.4; a.arms[1].el.rotation.x = -0.4; a.head.rotation.x = 0.12 + Math.sin(sec * 4) * 0.08; }
    }

    // ---------- 鏡頭 ----------
    const camQ = (new URLSearchParams(location.search).get('cam') || '').split(',').map(Number);
    const VIEW_ALL = () => (camQ.length === 6 && camQ.every(Number.isFinite) ? { pos: camQ.slice(0, 3), tgt: camQ.slice(3) }
      : IS_B ? (narrow ? { pos: [0, 46, 28], tgt: [0, 0, 2.6] } : { pos: [0, 26.5, 30.5], tgt: [0, 0.5, 2.4] })
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
    syncOrgKey();
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
      coreSpr.visible = meetSpr.visible = on; if (meetSpr2) meetSpr2.visible = on; for (const sg of signs) sg.visible = on;
    }
    function declutter() {
      // 看板模式：隱藏所有名牌，避免擋住正面螢幕
      showSprites(!(mode === 'board' && (!fly || performance.now() - fly.t0 > 500)));
      if (!spritesShown) return;
      const fixed = [rectOf(coreSpr, 0.85), rectOf(meetSpr, 0.85), ...(meetSpr2 ? [rectOf(meetSpr2, 0.85)] : []), ...signs.map((sg) => rectOf(sg, 0.9)), ...(VIS && VIS.bubble.visible ? [rectOf(VIS.bubble, 0.85)] : []), ...(VIS && VIS.reply.visible ? [rectOf(VIS.reply, 0.85)] : []), ...(mst.spots || []).filter((sp) => sp.bub.spr.visible).map((sp) => rectOf(sp.bub.spr, 0.85))];
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
    function syncOrgKey() { const wrap = $('#building-wrap'); if (wrap) wrap.classList.toggle('board-on', mode === 'board'); }
    function focusBoard() { mode = 'board'; syncOrgKey(); stopSpin(); flyTo(boardView()); }
    function focusAll() { mode = 'all'; syncOrgKey(); flyTo(VIEW_ALL()); }
    (function loop(t) {
      const now = performance.now(), sec = t * 0.001;
      if (fly) { const k = Math.min(1, (now - fly.t0) / 1300), e = k * k * (3 - 2 * k); camera.position.lerpVectors(fly.from, fly.to, e); controls.target.lerpVectors(fly.tf, fly.tt, e); if (k >= 1) fly = null; }
      controls.update();
      // 看板模式：把近裁切面推到看板前，前景桌椅不會擋住螢幕（手機直式距離較遠時特別需要）
      const nearWant = mode === 'board' && !fly ? Math.max(0.1, camera.position.distanceTo(boardCenter) - 0.9) : 0.1;
      if (Math.abs(camera.near - nearWant) > 0.01) { camera.near = nearWant; camera.updateProjectionMatrix(); }
      if (!IS_B) coreTop.rotation.z = sec * 0.12;
      const st = louisState();
      const pulse = 0.5 + Math.sin(sec * 2.2) * 0.5;
      glowMat.opacity = st === 'active' ? 0.35 + pulse * 0.4 : 0;
      haloMat.emissiveIntensity = st === 'active' ? 0.6 + pulse * 0.8 : st === 'idle' ? 0.05 : 0.0;
      haloMat.color.setHex(st === 'active' ? ACT : IDLE);
      if (B) B.tick(sec, st, coreHolo);
      for (const b of bamboos) b.g.rotation.z = Math.sin(sec * 0.8 + b.ph) * 0.012;
      mst.fdt = Math.min(0.25, Math.max(0, sec - (mst.last ?? sec))); mst.last = sec;
      for (const d of desks) { poseAvatar(d, sec); if (d.working) d.lamp.material.emissiveIntensity = 0.8 + Math.sin(sec * 2.6 + d.phase) * 0.25; }
      if (VIS) mst.tick(sec, mst.fdt);
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
