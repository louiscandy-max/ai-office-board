// AI 辦公樓看板：前端只讀取加密資料檔 data.enc.json，於瀏覽器端以通關密語解密。
const FLOORS = [
  { id: 'pa',  name: 'Sr. PA Ai（私人資深特助）', color: 0x5aa9ff },
  { id: 'cos', name: 'CoS Ai（幕僚長）', color: 0x8b7bff },
  { id: 'clo', name: 'CLO Ai（法務）', color: 0xc77dff },
  { id: 'cto', name: 'CTO Ai（技術長）', color: 0x4dd4c6 },
  { id: 'cpo', name: 'CPO Ai（採購長）', color: 0x6fcf6f },
  { id: 'fpa', name: 'Sr. FP&A Analyst Ai（財務規劃）', color: 0xf5b544 },
  { id: 'ia',  name: 'Sr. IA Ai（投資分析師）', color: 0xff8f5a },
  { id: 'admin', name: 'Admin（特殊小組・Air 執行維運）', color: 0x4dd4c6 },
  { id: 'kobe', name: 'Ai Kobe（特殊小組・個人事務）', color: 0xff6b9a },
  { id: 'fly', name: 'Ai Fly（特殊小組・碳酸鋰預測）', color: 0xffc94d },
];
const NO_DATA = '暫無數據';
const STATUS_TEXT = { done: '已完成', in_progress: '進行中', pending: '待處理' };
const LS_KEY = 'aiOfficeBoard.pass';
const $ = (s) => document.querySelector(s);

let people = null;      // 解密後的人員資料（以 id 對應）；null 代表沒有資料
let encCache = null;    // 最近一次抓到的加密檔
let building = null;    // 三維場景控制物件

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const val = (v) => (has(v) ? esc(v) : `<span class="empty">${NO_DATA}</span>`);
const timeTag = (t) => `<span class="time">${has(t) ? esc(t) : NO_DATA}</span>`;
const emptyLine = `<p class="empty">${NO_DATA}</p>`;

function fmtTaipei(iso) {
  if (!has(iso)) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
function setUpdated(iso) {
  const t = fmtTaipei(iso);
  $('#updated').textContent = t ? `資料更新於 ${t}（台北時間）` : `資料更新於：${NO_DATA}`;
}
const setStatus = (m) => { $('#status').textContent = m || ''; };

// ---------- 解密（PBKDF2-SHA256 → AES-256-GCM） ----------
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function decrypt(enc, pass) {
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(enc.salt), iterations: enc.iter || 600000 },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// ---------- 畫面 ----------
function person(id) { return people && people[id] ? people[id] : null; }
const arr = (p, k) => (p && Array.isArray(p[k]) ? p[k] : []);

function render() {
  const doing = [], flow = [];
  const waits = [];
  for (const f of FLOORS) {
    const p = person(f.id);
    const d = arr(p, 'doing');
    doing.push(`<div class="person"><h3>${esc(f.name)}</h3>${d.length ? `<ul>${d.map((x) => `<li>${val(x.text)}${timeTag(x.since)}</li>`).join('')}</ul>` : emptyLine}</div>`);
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
  if (building) building.update();
  const open = $('#detail').dataset.id;
  if (open && !$('#detail').hidden) showDetail(open);
}

function showDetail(id) {
  const f = FLOORS.find((x) => x.id === id);
  if (!f) return;
  const p = person(id);
  $('#detail').dataset.id = id;
  $('#detail-title').textContent = f.name;
  const list = (items, fn) => (items.length ? `<ul>${items.map(fn).join('')}</ul>` : emptyLine);
  $('#detail-body').innerHTML = `
    <h3>正在做</h3>${list(arr(p, 'doing'), (x) => `<li>${val(x.text)}${timeTag(x.since)}</li>`)}
    <h3>等我回覆</h3>${list(arr(p, 'waiting_on_louis'), (x) => `<li>${val(x.text)}${timeTag(x.since)}<div class="src">來源：${val(x.source)}</div></li>`)}
    <h3>任務流</h3>${list(arr(p, 'tasks'), (x) => `<li><span class="tag ${STATUS_TEXT[x.status] ? x.status : 'pending'}">${STATUS_TEXT[x.status] || NO_DATA}</span>${val(x.title)}${timeTag(x.time)}</li>`)}`;
  $('#detail').hidden = false;
  if (building) building.select(id);
  $('#detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
$('#detail-close').addEventListener('click', () => { $('#detail').hidden = true; if (building) building.select(null); });

// ---------- 資料流程 ----------
function applyData(data) {
  people = {};
  for (const p of (data && Array.isArray(data.people) ? data.people : [])) if (p && p.id) people[p.id] = p;
  setUpdated((data && data.updated_at) || (encCache && encCache.updated_at));
  render();
}
function noData(msg) { people = null; setUpdated(null); setStatus(msg); render(); }

async function tryUnlock(pass, remember) {
  try {
    const data = await decrypt(encCache, pass);
    if (remember) localStorage.setItem(LS_KEY, pass);
    sessionStorage.setItem(LS_KEY, pass);
    $('#gate').hidden = true; $('#lock').hidden = false;
    setStatus('');
    applyData(data);
    return true;
  } catch (e) { return false; }
}

async function load() {
  $('#refresh').disabled = true;
  setStatus('讀取最新資料中…');
  try {
    const r = await fetch(`data.enc.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) { encCache = null; noData('目前沒有資料檔'); return; }
    encCache = await r.json();
    if (!encCache || !encCache.ct) { noData('資料檔格式不正確'); return; }
    setUpdated(encCache.updated_at);
    const pass = sessionStorage.getItem(LS_KEY) || localStorage.getItem(LS_KEY);
    if (pass && await tryUnlock(pass, false)) return;
    if (pass) { localStorage.removeItem(LS_KEY); sessionStorage.removeItem(LS_KEY); }
    people = null; render();
    setStatus('需要通關密語才能查看內容');
    $('#gate').hidden = false; $('#pass').focus();
  } catch (e) {
    noData('讀取資料失敗，請稍後再按重新整理');
  } finally { $('#refresh').disabled = false; }
}

$('#gate-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('#gate-msg').textContent = '解密中…';
  const ok = await tryUnlock($('#pass').value, $('#remember').checked);
  $('#gate-msg').textContent = ok ? '' : '通關密語不正確';
  if (ok) $('#pass').value = '';
});
$('#refresh').addEventListener('click', load);
$('#lock').addEventListener('click', () => { localStorage.removeItem(LS_KEY); sessionStorage.removeItem(LS_KEY); location.reload(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });

// ---------- 三維辦公室（同一層，依組織架構配置） ----------
// 前方中央：總經理室；左半：個人區（Sr. PA Ai 帶領）；右半：公司區（CoS Ai 帶領）；中央走道分隔公私。
const LAYOUT = {
  pa:  { x: -3.3, z: 1.6, lead: true },
  admin: { x: -6.0, z: -4.2, k: 0.9 }, kobe: { x: -3.85, z: -4.2, k: 0.9 }, fly: { x: -1.7, z: -4.2, k: 0.9 },
  ia: { x: -6.45, z: 1.6, k: 0.85 },
  cos: { x: 3.3, z: 1.6, lead: true },
  clo: { x: 2.55, z: -3.3 }, cto: { x: 5.15, z: -3.3 },
  cpo: { x: 2.55, z: -6.3 }, fpa: { x: 5.15, z: -6.3 },
};
async function initBuilding() {
  const el = $('#building');
  try {
    const THREE = await import('three');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.enablePan = false;
    controls.minDistance = 7; controls.maxDistance = 45;
    controls.maxPolarAngle = Math.PI * 0.45;
    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x0b1220, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(6, 14, 8); scene.add(sun);
    const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
    const box = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; };
    const FONT = '"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
    function fitText(c, text, max, size, weight) {
      let s = size;
      do { c.font = `${weight} ${s}px ${FONT}`; s -= 2; } while (c.measureText(text).width > max && s > 18);
    }
    // 平放在地上的文字
    function floorText(text, x, z, w, color) {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
      const c = cv.getContext('2d'); c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
      fitText(c, text, 500, 96, 'bold'); c.fillText(text, 256, 64);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.03, z); scene.add(m);
    }

    // 樓板、兩區與中央走道
    const FW = 15, FD = 15, Z0 = -1.3; // 樓板中心 z
    box(FW, 0.2, FD, M(0x1c2842), 0, -0.1, Z0, scene);
    // 四個工作區：左前 個人幕僚區、左後 特殊小組區、右前 公司幕僚區、右後 公司專業區（各有底色、矮隔間與地面名稱）
    const ZONES = [
      { name: '個人幕僚區', x: -3.9, z: 1.95, w: 6.6, d: 4.9, color: 0x5aa9ff, text: 'rgba(140,190,255,.95)', tz: 3.95 },
      { name: '特殊小組區', x: -3.9, z: -4.4, w: 6.6, d: 7.0, color: 0xff6b9a, text: 'rgba(255,160,190,.95)', tx: -5.75, tz: -1.5, tw: 2.2 },
      { name: '公司幕僚區', x: 3.9, z: 1.95, w: 6.6, d: 4.9, color: 0x8b7bff, text: 'rgba(185,175,255,.95)', tz: 3.95 },
      { name: '公司專業區', x: 3.9, z: -4.4, w: 6.6, d: 7.0, color: 0x4dd4c6, text: 'rgba(130,230,220,.95)', tx: 5.75, tz: -1.5, tw: 2.2 },
    ];
    for (const zn of ZONES) {
      box(zn.w - 0.2, 0.02, zn.d - 0.2, M(zn.color, { transparent: true, opacity: 0.13 }), zn.x, 0.01, zn.z, scene);
      const wall = M(zn.color, { transparent: true, opacity: 0.55 });
      const H = 0.32, T = 0.07, hw = zn.w / 2 - 0.1, hd = zn.d / 2 - 0.1;
      box(zn.w - 0.2, H, T, wall, zn.x, H / 2, zn.z - hd, scene);
      box(zn.w - 0.2, H, T, wall, zn.x, H / 2, zn.z + hd, scene);
      box(T, H, zn.d - 0.2, wall, zn.x - hw, H / 2, zn.z, scene);
      box(T, H, zn.d - 0.2, wall, zn.x + hw, H / 2, zn.z, scene);
      floorText(zn.name, zn.tx ?? zn.x, zn.tz, zn.tw ?? 2.6, zn.text);
    }
    box(1.0, 0.025, 13.4, M(0x3a4a6a), 0, 0.015, Z0 - 0.2, scene); // 走道
    for (const z of [-7, -5, -3, -1, 1, 3, 5]) box(0.12, 0.03, 0.8, M(0xf5d76e), 0, 0.03, z, scene); // 走道標線
    floorText('走道', 0, -7.4, 1.0, 'rgba(245,215,110,.9)');

    // 總經理室（玻璃隔間，不可點選、不顯示資料）
    const office = new THREE.Group(); office.position.set(0, 0, 5.4); scene.add(office);
    const glass = M(0xaed8ff, { transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false });
    box(4.4, 1.4, 0.05, glass, 0, 0.7, -1.1, office); box(0.05, 1.4, 2.2, glass, -2.2, 0.7, 0, office); box(0.05, 1.4, 2.2, glass, 2.2, 0.7, 0, office);
    box(1.6, 1.4, 0.05, glass, -1.4, 0.7, 1.1, office); box(1.6, 1.4, 0.05, glass, 1.4, 0.7, 1.1, office);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(4.4, 1.4, 2.2)), new THREE.LineBasicMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0.5 }));
    frame.position.y = 0.7; office.add(frame);
    box(4.3, 0.03, 2.1, M(0x2e3d5c), 0, 0.02, 0, office);
    box(1.8, 0.08, 0.8, M(0x8a6a4a), 0, 0.75, -0.2, office); box(0.6, 0.8, 0.6, M(0x34405a), 0, 0.4, 0.45, office);
    {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 120;
      const c = cv.getContext('2d'); c.fillStyle = 'rgba(245,215,110,.95)'; c.beginPath(); c.roundRect(4, 4, 504, 112, 24); c.fill();
      c.fillStyle = '#1a1406'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, '總經理室（Louis）', 480, 60, 'bold'); c.fillText('總經理室（Louis）', 256, 62);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      spr.scale.set(2.6, 0.61, 1); spr.position.set(0, 2.0, 0); spr.renderOrder = 10; office.add(spr);
    }

    // 地面連線：實線＝直屬，虛線＝審核
    const lineMat = new THREE.LineBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.55 });
    const dashMat = new THREE.LineDashedMaterial({ color: 0xf5d76e, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.9 });
    const link = (from, to, mat) => {
      const a = LAYOUT[from], b = LAYOUT[to];
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, 0.08, a.z), new THREE.Vector3(b.x, 0.08, b.z)]), mat);
      ln.computeLineDistances(); scene.add(ln);
    };
    for (const t of ['admin', 'kobe', 'fly']) link('pa', t, lineMat);
    for (const t of ['clo', 'cto', 'cpo', 'fpa']) link('cos', t, lineMat);
    link('pa', 'ia', dashMat);

    // 座位
    const desks = [];
    FLOORS.forEach((f) => {
      const L = LAYOUT[f.id]; if (!L) return;
      const g = new THREE.Group(); g.position.set(L.x, 0, L.z);
      const k = L.k || (L.lead ? 1.25 : 1);
      const inner = new THREE.Group(); inner.scale.set(k, k, k); g.add(inner);
      const zoneMat = M(f.color, { transparent: true, opacity: 0.25, emissive: f.color, emissiveIntensity: 0.05 });
      const zone = box(2.2, 0.04, 2.6, zoneMat, 0, 0.03, 0, inner);
      const top = box(1.7, 0.08, 0.8, M(L.lead ? 0xe6d2ae : 0xd9c7a8), 0, 0.75, 0.3, inner);
      for (const [x, z] of [[-0.75, -0.05], [0.75, -0.05], [-0.75, 0.65], [0.75, 0.65]]) box(0.06, 0.72, 0.06, M(0x555f73), x, 0.36, z, inner);
      // 面向前方（總經理室方向），螢幕在桌子前緣、人在桌後
      const scr = M(0x0e1a2e, { emissive: f.color, emissiveIntensity: 0.15 });
      box(0.8, 0.5, 0.05, scr, 0, 1.1, 0.6, inner); box(0.08, 0.25, 0.08, M(0x555f73), 0, 0.88, 0.6, inner);
      box(0.5, 0.08, 0.5, M(0x34405a), 0, 0.48, -0.5, inner); box(0.5, 0.55, 0.08, M(0x34405a), 0, 0.78, -0.76, inner);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.23, 0.55, 16), M(f.color)); body.position.set(0, 0.8, -0.45); inner.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), M(0xf1d3b3)); head.position.set(0, 1.24, -0.45); inner.add(head);
      // 名牌：三行（名稱／職稱／狀態），窄版避免手機上互相重疊
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 300;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      const ls = L.k ? Math.min(1, L.k * 1.0) : 1; spr.scale.set(2.3 * ls, 1.35 * ls, 1); spr.position.set(0, 2.3 * k, 0); spr.renderOrder = 10; g.add(spr);
      const hits = [zone, top, body, head, spr];
      hits.forEach((m) => { m.userData.id = f.id; });
      scene.add(g);
      desks.push({ f, zoneMat, scr, cv, tex, hits });
    });

    function drawLabel(d, selected) {
      const p = person(d.f.id);
      const c = d.cv.getContext('2d');
      c.clearRect(0, 0, 512, 300);
      c.fillStyle = selected ? 'rgba(90,169,255,.96)' : 'rgba(11,18,32,.88)';
      c.beginPath(); c.roundRect(4, 4, 504, 292, 26); c.fill();
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const m = d.f.name.match(/^(.*?)（(.*)）$/);
      const name = m ? m[1] : d.f.name, role = m ? m[2] : '';
      c.fillStyle = selected ? '#04121f' : '#ffffff';
      fitText(c, name, 480, 76, 'bold'); c.fillText(name, 256, role ? 66 : 100);
      if (role) { c.fillStyle = selected ? '#04121f' : '#cfe0ff'; fitText(c, role, 480, 54, 'normal'); c.fillText(role, 256, 140); }
      let sub = NO_DATA;
      if (p) {
        const dn = arr(p, 'doing').length, prog = arr(p, 'tasks').filter((t) => t.status === 'in_progress').length, w = arr(p, 'waiting_on_louis').length;
        if (dn || prog || w || arr(p, 'tasks').length) sub = `正在做 ${dn}｜進行中 ${prog}｜等我 ${w}`;
      }
      c.fillStyle = selected ? '#04121f' : (sub === NO_DATA ? '#8fa1bf' : '#f5d76e');
      fitText(c, sub, 480, 46, 'normal'); c.fillText(sub, 256, 226);
      d.tex.needsUpdate = true;
    }
    let selected = null;
    function update() {
      for (const d of desks) {
        const p = person(d.f.id);
        const busy = p && (arr(p, 'doing').length || arr(p, 'tasks').some((t) => t.status === 'in_progress'));
        const waiting = p && arr(p, 'waiting_on_louis').length;
        const on = d.f.id === selected;
        d.zoneMat.emissiveIntensity = on ? 0.9 : waiting ? 0.5 : busy ? 0.3 : 0.05;
        d.zoneMat.opacity = on ? 0.6 : p ? 0.35 : 0.15;
        d.scr.emissiveIntensity = busy ? 0.8 : 0.1;
        drawLabel(d, on);
      }
    }
    function select(id) { selected = id; update(); }

    controls.target.set(0, 0.5, -0.6);
    function resize() {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      if (!resize.done) {
        // 手機：較高、較俯視的視角，讓兩區與名牌都在畫面內且不重疊
        const narrow = w / h < 1;
        if (narrow) camera.position.set(0, 23.5, 9.5); else camera.position.set(0, 19.5, 10);
        resize.done = true;
      }
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(el); resize();

    // 點選座位（區分拖曳與點擊）
    const ray = new THREE.Raycaster(), v = new THREE.Vector2();
    const targets = desks.flatMap((d) => d.hits);
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) { down = null; return; }
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v, camera);
      const hit = ray.intersectObjects(targets)[0];
      if (hit) showDetail(hit.object.userData.id);
    });
    (function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();
    building = { update, select };
    update();
  } catch (e) {
    el.innerHTML = '<p class="empty" style="padding:24px;text-align:center">三維畫面無法載入，下方清單仍可正常查看</p>';
  }
}

render();
initBuilding();
load();
