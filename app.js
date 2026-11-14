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
const OFFICES = [
  { id: 'personal', name: '個人幕僚辦公室', members: ['pa', 'ia'], x: -3.9, z: 2.05, w: 6.6, d: 4.6, color: 0x5aa9ff },
  { id: 'special',  name: '特殊小組辦公室', members: ['admin', 'kobe', 'fly'], x: -3.9, z: -4.55, w: 6.6, d: 6.6, color: 0xff6b9a },
  { id: 'staff',    name: '公司幕僚辦公室', members: ['cos'], x: 3.9, z: 2.05, w: 6.6, d: 4.6, color: 0x8b7bff },
  { id: 'pro',      name: '公司專業辦公室', members: ['clo', 'cto', 'cpo', 'fpa'], x: 3.9, z: -4.55, w: 6.6, d: 6.6, color: 0x4dd4c6 },
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

function officeState(off) {
  return off.members.map((id) => {
    const f = FLOORS.find((x) => x.id === id);
    const p = person(id);
    const doing = arr(p, 'doing');
    const waiting = arr(p, 'waiting_on_louis');
    return { f, p, doing, waiting, empty: !p || (!doing.length && !waiting.length) };
  });
}

function boardInner(off) {
  return officeState(off).map(({ f, doing, waiting, empty }) => {
    let body;
    if (empty) body = emptyLine;
    else {
      body = doing.length
        ? `<ul>${doing.map((x) => `<li>${val(x.text)}${timeTag(x.since)}</li>`).join('')}</ul>`
        : emptyLine;
      if (waiting.length) body += `<p class="board-wait">等我 ${waiting.length}</p>`;
    }
    return `<div class="board-person"><h4>${esc(f.name)}</h4>${body}</div>`;
  }).join('');
}

function highlightBoard(id) {
  document.querySelectorAll('.office-board').forEach((el) => el.classList.toggle('active', !!id && el.dataset.office === id));
}

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
  $('#boards').innerHTML = OFFICES.map((off) =>
    `<div class="office-board" data-office="${esc(off.id)}" role="button" tabindex="0"><h3>${esc(off.name)}｜工作看板</h3>${boardInner(off)}</div>`
  ).join('');
  document.querySelectorAll('#boards .office-board').forEach((el) => {
    const open = () => showOfficeBoard(el.dataset.office);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
  if (building) building.update();
  const open = $('#detail').dataset.id;
  if (open && !$('#detail').hidden) {
    if (open.startsWith('office:')) showOfficeBoard(open.slice(7));
    else showDetail(open);
  }
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
  highlightBoard(null);
  if (building) building.select(id);
  $('#detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showOfficeBoard(id) {
  const off = OFFICES.find((x) => x.id === id);
  if (!off) return;
  $('#detail').dataset.id = 'office:' + id;
  $('#detail-title').textContent = `${off.name}｜工作看板`;
  $('#detail-body').innerHTML = boardInner(off);
  $('#detail').hidden = false;
  highlightBoard(id);
  if (building) building.selectOffice(id);
  $('#detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
$('#detail-close').addEventListener('click', () => {
  $('#detail').hidden = true; $('#detail').dataset.id = '';
  highlightBoard(null);
  if (building) building.select(null);
});

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

// ---------- 三維辦公室（同一層，四間封閉辦公室＋牆上工作看板） ----------
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
    controls.maxPolarAngle = Math.PI * 0.48;
    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x0b1220, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(6, 14, 8); scene.add(sun);
    const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
    const box = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; };
    const FONT = '"PingFang TC","Noto Sans CJK TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    function fitText(c, text, max, size, weight) {
      let s = size;
      do { c.font = `${weight} ${s}px ${FONT}`; s -= 2; } while (c.measureText(text).width > max && s > 16);
    }
    function wrapText(c, text, maxW) {
      const lines = [];
      let line = '';
      for (const ch of String(text)) {
        const t = line + ch;
        if (line && c.measureText(t).width > maxW) { lines.push(line); line = ch; }
        else line = t;
      }
      if (line) lines.push(line);
      return lines;
    }
    function floorText(text, x, z, w, color) {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
      const c = cv.getContext('2d'); c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
      fitText(c, text, 500, 96, 'bold'); c.fillText(text, 256, 64);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.03, z); scene.add(m);
    }
    function plaque(text, w, h, fg, bg, stroke) {
      const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
      const c = cv.getContext('2d');
      c.fillStyle = bg; c.beginPath(); c.roundRect(8, 8, 1008, 240, 28); c.fill();
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = 10; c.stroke(); }
      c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
      fitText(c, text, 960, 110, 'bold'); c.fillText(text, 512, 132);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    }

    // 樓板與中央走道
    const FW = 15, FD = 15, Z0 = -1.3;
    box(FW, 0.2, FD, M(0x1c2842), 0, -0.1, Z0, scene);
    box(1.0, 0.025, 13.4, M(0x3a4a6a), 0, 0.015, Z0 - 0.2, scene);
    for (const z of [-7, -5, -3, -1, 1, 3, 5]) box(0.12, 0.03, 0.8, M(0xf5d76e), 0, 0.03, z, scene);
    floorText('走道', 0, -7.4, 1.0, 'rgba(245,215,110,.9)');

    const WH = 2.35, WT = 0.08, DW = 1.4, DH = 1.92;
    const boards = [];
    const officeFloors = [];

    function addOffice(zn) {
      const left = zn.x < 0;
      const x0 = zn.x - zn.w / 2, x1 = zn.x + zn.w / 2;
      const z0 = zn.z - zn.d / 2, z1 = zn.z + zn.d / 2;
      const aisleX = left ? x1 : x0;
      const outerX = left ? x0 : x1;
      const floorMat = M(zn.color, { transparent: true, opacity: 0.16, emissive: zn.color, emissiveIntensity: 0.04 });
      const floorMesh = box(zn.w - 0.16, 0.02, zn.d - 0.16, floorMat, zn.x, 0.01, zn.z, scene);
      officeFloors.push({ id: zn.id, mat: floorMat });

      const glassCam = M(zn.color, { transparent: true, opacity: 0.09, roughness: 0.08, metalness: 0.15, depthWrite: false });
      const glassSide = M(zn.color, { transparent: true, opacity: 0.20, roughness: 0.1, metalness: 0.12, depthWrite: false });
      const glassBack = M(zn.color, { transparent: true, opacity: 0.26, roughness: 0.12, metalness: 0.1, depthWrite: false });
      const post = M(zn.color, { roughness: 0.4, metalness: 0.25, transparent: true, opacity: 0.88 });
      const frame = M(0xd8d0c4, { roughness: 0.45 });
      const base = M(zn.color, { transparent: true, opacity: 0.75 });

      // 後牆、前牆（鏡頭側較透明）、外側牆
      box(zn.w, WH, WT, glassBack, zn.x, WH / 2, z0 + WT / 2, scene);
      box(zn.w, WH, WT, glassCam, zn.x, WH / 2, z1 - WT / 2, scene);
      box(WT, WH, zn.d, glassSide, outerX + (left ? WT / 2 : -WT / 2), WH / 2, zn.z, scene);
      // 面向走道的牆，中間開門
      const doorZ = zn.z;
      const ax = aisleX + (left ? -WT / 2 : WT / 2);
      const zA = z0 + WT, zB = z1 - WT;
      const door0 = doorZ - DW / 2, door1 = doorZ + DW / 2;
      const lenBack = door0 - zA, lenFront = zB - door1;
      if (lenBack > 0.05) box(WT, WH, lenBack, glassSide, ax, WH / 2, zA + lenBack / 2, scene);
      if (lenFront > 0.05) box(WT, WH, lenFront, glassSide, ax, WH / 2, zB - lenFront / 2, scene);
      box(WT, WH - DH, DW, glassSide, ax, DH + (WH - DH) / 2, doorZ, scene);
      // 門框與略開的玻璃門（向室內開）
      box(0.1, DH, 0.1, frame, ax, DH / 2, door0, scene);
      box(0.1, DH, 0.1, frame, ax, DH / 2, door1, scene);
      box(0.1, 0.12, DW + 0.12, frame, ax, DH + 0.02, doorZ, scene);
      const doorG = new THREE.Group();
      const doorW = DW * 0.7;
      box(0.03, DH - 0.06, doorW, M(0xaed8ff, { transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false }), 0, (DH - 0.06) / 2 + 0.03, doorW / 2, doorG);
      doorG.position.set(ax, 0, door0);
      doorG.rotation.y = left ? -0.7 : 0.7;
      scene.add(doorG);
      // 四角柱與踢腳
      for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) box(0.11, WH, 0.11, post, px, WH / 2, pz, scene);
      box(zn.w, 0.08, 0.06, base, zn.x, 0.04, z0 + 0.03, scene);
      box(zn.w, 0.08, 0.06, base, zn.x, 0.04, z1 - 0.03, scene);
      box(0.06, 0.08, zn.d, base, outerX + (left ? 0.03 : -0.03), 0.04, zn.z, scene);
      if (lenBack > 0.05) box(0.06, 0.08, lenBack, base, ax, 0.04, zA + lenBack / 2, scene);
      if (lenFront > 0.05) box(0.06, 0.08, lenFront, base, ax, 0.04, zB - lenFront / 2, scene);
      // 牆頂橫樑，讓辦公室輪廓從上方清楚可見
      box(zn.w, 0.07, 0.1, post, zn.x, WH, z0 + 0.05, scene);
      box(zn.w, 0.07, 0.1, post, zn.x, WH, z1 - 0.05, scene);
      box(0.1, 0.07, zn.d, post, outerX + (left ? 0.05 : -0.05), WH, zn.z, scene);
      box(0.1, 0.07, lenBack > 0 ? lenBack : 0.1, post, ax, WH, zA + Math.max(lenBack, 0.1) / 2, scene);
      box(0.1, 0.07, lenFront > 0 ? lenFront : 0.1, post, ax, WH, zB - Math.max(lenFront, 0.1) / 2, scene);

      // 門牌：門旁面向走道的銘牌，以及門上方面向鏡頭的辦公室名牌
      const doorPlaque = plaque(zn.name, 1.15, 0.3, '#1a1406', '#f3ead8', hex(zn.color));
      doorPlaque.position.set(ax + (left ? 0.05 : -0.05), DH + 0.28, door1 + 0.75);
      doorPlaque.rotation.y = left ? Math.PI / 2 : -Math.PI / 2;
      scene.add(doorPlaque);
      {
        const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
        const c = cv.getContext('2d');
        c.fillStyle = '#f3ead8'; c.beginPath(); c.roundRect(8, 8, 1008, 240, 28); c.fill();
        c.strokeStyle = hex(zn.color); c.lineWidth = 12; c.stroke();
        c.fillStyle = '#1a1406'; c.textAlign = 'center'; c.textBaseline = 'middle';
        fitText(c, zn.name, 960, 110, 'bold'); c.fillText(zn.name, 512, 132);
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
        spr.scale.set(2.35, 0.59, 1);
        spr.position.set(left ? aisleX - 1.25 : aisleX + 1.25, WH + 0.42, doorZ);
        spr.renderOrder = 12;
        scene.add(spr);
      }

      // 後牆工作看板：牆上裝框，內容用面向鏡頭的看板，以利判讀
      const n = zn.members.length;
      const cv = document.createElement('canvas'); cv.width = 1024; cv.height = n >= 3 ? 1152 : 896;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      const bw = n >= 3 ? 2.85 : 2.95;
      const bh = bw * (cv.height / cv.width);
      // 掛在各辦公室前牆內側；後排辦公室再往外側移，避免被前排名牌擋住
      const bx = zn.z < 0 ? zn.x + (left ? -1.55 : 1.55) : zn.x;
      const backing = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.12, bh + 0.12, 0.06), M(0x1a2233));
      backing.position.set(bx, 1.45, z1 - 0.07);
      backing.userData = { type: 'board', id: zn.id };
      scene.add(backing);
      const board = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      board.scale.set(bw, bh, 1);
      board.position.set(bx, 1.55, z1 - 0.55);
      board.renderOrder = 8;
      board.userData = { type: 'board', id: zn.id };
      scene.add(board);
      boards.push({ zn, cv, tex, hits: [board, backing] });
    }
    OFFICES.forEach(addOffice);

    function drawBoard(b) {
      const { zn, cv, tex } = b;
      const c = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      c.clearRect(0, 0, W, H);
      c.fillStyle = '#101827';
      c.beginPath(); c.roundRect(0, 0, W, H, 28); c.fill();
      c.strokeStyle = hex(zn.color); c.lineWidth = 14; c.stroke();
      c.fillStyle = hex(zn.color);
      c.fillRect(0, 0, W, 132);
      c.fillStyle = '#04121f'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const title = `${zn.name}｜工作看板`;
      fitText(c, title, W - 48, 70, 'bold'); c.fillText(title, W / 2, 68);
      const rows = officeState(zn);
      const pad = 36, inner = W - pad * 2;
      const top = 152, slot = (H - top - 20) / rows.length;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i], y = top + i * slot;
        c.fillStyle = 'rgba(255,255,255,.06)';
        c.beginPath(); c.roundRect(pad - 8, y, inner + 16, slot - 14, 16); c.fill();
        c.textAlign = 'left'; c.textBaseline = 'top';
        c.fillStyle = '#ffffff';
        fitText(c, row.f.name, inner, 46, 'bold');
        c.fillText(row.f.name, pad, y + 12);
        let ty = y + 66;
        c.font = `36px ${FONT}`;
        if (row.empty) {
          c.fillStyle = '#8fa1bf'; c.fillText(NO_DATA, pad, ty);
        } else {
          if (row.doing.length) {
            c.fillStyle = '#e6edf7';
            for (const item of row.doing) {
              const lines = wrapText(c, '· ' + item.text, inner);
              for (const ln of lines) {
                if (ty > y + slot - 52) break;
                c.fillText(ln, pad, ty); ty += 44;
              }
            }
          } else {
            c.fillStyle = '#8fa1bf'; c.fillText(NO_DATA, pad, ty); ty += 44;
          }
          if (row.waiting.length) {
            c.fillStyle = '#ffb3b3'; c.font = `bold 34px ${FONT}`;
            c.fillText('等我 ' + row.waiting.length, pad, ty);
          }
        }
      }
      tex.needsUpdate = true;
    }

    // 總經理室（玻璃隔間，不可點選、不顯示資料）
    const office = new THREE.Group(); office.position.set(0, 0, 5.4); scene.add(office);
    const glass = M(0xaed8ff, { transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false });
    box(4.4, 1.4, 0.05, glass, 0, 0.7, -1.1, office); box(0.05, 1.4, 2.2, glass, -2.2, 0.7, 0, office); box(0.05, 1.4, 2.2, glass, 2.2, 0.7, 0, office);
    box(1.6, 1.4, 0.05, glass, -1.4, 0.7, 1.1, office); box(1.6, 1.4, 0.05, glass, 1.4, 0.7, 1.1, office);
    const gmFrame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(4.4, 1.4, 2.2)), new THREE.LineBasicMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0.5 }));
    gmFrame.position.y = 0.7; office.add(gmFrame);
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
      const scr = M(0x0e1a2e, { emissive: f.color, emissiveIntensity: 0.15 });
      box(0.8, 0.5, 0.05, scr, 0, 1.1, 0.6, inner); box(0.08, 0.25, 0.08, M(0x555f73), 0, 0.88, 0.6, inner);
      box(0.5, 0.08, 0.5, M(0x34405a), 0, 0.48, -0.5, inner); box(0.5, 0.55, 0.08, M(0x34405a), 0, 0.78, -0.76, inner);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.23, 0.55, 16), M(f.color)); body.position.set(0, 0.8, -0.45); inner.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), M(0xf1d3b3)); head.position.set(0, 1.24, -0.45); inner.add(head);
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 300;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      const ls = L.k ? Math.min(1, L.k * 1.0) : 1; spr.scale.set(2.3 * ls, 1.35 * ls, 1); spr.position.set(0, 2.3 * k, 0); spr.renderOrder = 10; g.add(spr);
      const hits = [zone, top, body, head, spr];
      hits.forEach((m) => { m.userData.id = f.id; m.userData.type = 'desk'; });
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
    let selected = null, selectedOffice = null;
    function update() {
      for (const d of desks) {
        const p = person(d.f.id);
        const busy = p && (arr(p, 'doing').length || arr(p, 'tasks').some((t) => t.status === 'in_progress'));
        const waiting = p && arr(p, 'waiting_on_louis').length;
        const on = d.f.id === selected;
        const inOff = selectedOffice && OFFICES.some((o) => o.id === selectedOffice && o.members.includes(d.f.id));
        d.zoneMat.emissiveIntensity = on ? 0.9 : inOff ? 0.55 : waiting ? 0.5 : busy ? 0.3 : 0.05;
        d.zoneMat.opacity = on || inOff ? 0.6 : p ? 0.35 : 0.15;
        d.scr.emissiveIntensity = busy ? 0.8 : 0.1;
        drawLabel(d, on);
      }
      for (const o of officeFloors) {
        o.mat.opacity = selectedOffice === o.id ? 0.32 : 0.16;
        o.mat.emissiveIntensity = selectedOffice === o.id ? 0.2 : 0.04;
      }
      for (const b of boards) drawBoard(b);
    }
    function select(id) { selected = id; selectedOffice = null; update(); }
    function selectOffice(id) { selectedOffice = id; selected = null; update(); }

    controls.target.set(0, 0.5, -0.6);
    function resize() {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      if (!resize.done) {
        const narrow = w / h < 1;
        // 略從斜前方俯視，才能看清玻璃牆內的門牌與工作看板
        if (narrow) camera.position.set(0, 18.8, 17.2); else camera.position.set(0, 13.2, 17.5);
        resize.done = true;
      }
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(el); resize();

    const ray = new THREE.Raycaster(), v = new THREE.Vector2();
    const targets = desks.flatMap((d) => d.hits).concat(boards.flatMap((b) => b.hits));
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) { down = null; return; }
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v, camera);
      const hit = ray.intersectObjects(targets)[0];
      if (!hit) return;
      if (hit.object.userData.type === 'board') showOfficeBoard(hit.object.userData.id);
      else showDetail(hit.object.userData.id);
    });
    (function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();
    building = { update, select, selectOffice };
    update();
  } catch (e) {
    el.innerHTML = '<p class="empty" style="padding:24px;text-align:center">三維畫面無法載入，下方清單仍可正常查看</p>';
  }
}

render();
initBuilding();
load();
