// AI 辦公樓看板：前端只讀取加密資料檔 data.enc.json，於瀏覽器端以通關密語解密。
const FLOORS = [
  { id: 'pa',  name: 'Sr. PA Ai（私人資深特助）', color: 0x4285F4 },
  { id: 'cos', name: 'CoS Ai（幕僚長）', color: 0x76B900 },
  { id: 'clo', name: 'CLO Ai（法務）', color: 0x5aa86a },
  { id: 'cto', name: 'CTO Ai（技術長）', color: 0x76B900 },
  { id: 'cpo', name: 'CPO Ai（採購長）', color: 0x3d5c2a },
  { id: 'fpa', name: 'Sr. FP&A Analyst Ai（財務規劃）', color: 0xc5e86a },
  { id: 'ia',  name: 'Sr. IA Ai（投資分析師）', color: 0xEA4335 },
  { id: 'admin', name: 'Admin（特殊小組・Air 執行維運）', color: 0x34A853 },
  { id: 'kobe', name: 'Ai Kobe（特殊小組・個人事務）', color: 0xEA4335 },
  { id: 'fly', name: 'Ai Fly（特殊小組・碳酸鋰預測）', color: 0xFBBC05 },
];
const OFFICES = [
  { id: 'personal', name: '個人幕僚辦公室', zone: '個人幕僚區', members: ['pa', 'ia'], x: -3.9, z: 2.05, w: 6.6, d: 4.6, color: 0x4285F4, side: 'google' },
  { id: 'special',  name: '特殊小組辦公室', zone: '特殊小組區', members: ['admin', 'kobe', 'fly'], x: -3.9, z: -4.55, w: 6.6, d: 6.6, color: 0xFBBC05, side: 'google' },
  { id: 'staff',    name: '公司幕僚辦公室', zone: '公司幕僚區', members: ['cos'], x: 3.9, z: 2.05, w: 6.6, d: 4.6, color: 0x76B900, side: 'nvidia' },
  { id: 'pro',      name: '公司專業辦公室', zone: '公司專業區', members: ['clo', 'cto', 'cpo', 'fpa'], x: 3.9, z: -4.55, w: 6.6, d: 6.6, color: 0x1f2a18, accent: 0x76B900, side: 'nvidia' },
];
const NO_DATA = '暫無數據';
const STATUS_TEXT = { done: '已完成', in_progress: '進行中', pending: '待處理' };
const LS_KEY = 'aiOfficeBoard.pass';
const $ = (s) => document.querySelector(s);

let people = null;
let encCache = null;
let building = null;

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

$('#detail-close').addEventListener('click', () => {
  $('#detail').hidden = true; $('#detail').dataset.id = '';
  if (building) building.select(null);
});

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

// ---------- 三維開放式辦公區（同一層，四個鄰里） ----------
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
    scene.background = new THREE.Color(0xd4e8fb);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.enablePan = false;
    controls.minDistance = 8; controls.maxDistance = 48;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.autoRotate = false; controls.autoRotateSpeed = 0.55;
    scene.add(new THREE.HemisphereLight(0xfff6e8, 0x4a3a28, 1.15));
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.15); sun.position.set(6, 16, 10); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xddeeff, 0.35); fill.position.set(-8, 8, -4); scene.add(fill);

    const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
    const box = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; };
    const FONT = '"PingFang TC","Noto Sans CJK TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    function fitText(c, text, max, size, weight) {
      let s = size;
      do { c.font = `${weight} ${s}px ${FONT}`; s -= 2; } while (c.measureText(text).width > max && s > 18);
    }
    function floorText(text, x, z, w, color) {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
      const c = cv.getContext('2d'); c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
      fitText(c, text, 500, 96, 'bold'); c.fillText(text, 256, 64);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.04, z); scene.add(m);
    }
    function labelSprite(text, w, h, fg, bg, stroke) {
      const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
      const c = cv.getContext('2d');
      c.fillStyle = bg; c.beginPath(); c.roundRect(8, 8, 1008, 240, 28); c.fill();
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = 12; c.stroke(); }
      c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
      fitText(c, text, 960, 110, 'bold'); c.fillText(text, 512, 132);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      spr.scale.set(w, h, 1); spr.renderOrder = 12;
      return spr;
    }

    // 木質樓板與中央走道
    const FW = 18, FD = 18.4, Z0 = -1.6;
    {
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
      const c = cv.getContext('2d');
      for (let i = 0; i < 8; i++) {
        c.fillStyle = i % 2 ? '#c4a06a' : '#d2b07a';
        c.fillRect(0, i * 32, 256, 32);
        c.strokeStyle = 'rgba(90,50,20,.22)'; c.beginPath(); c.moveTo(0, i * 32); c.lineTo(256, i * 32); c.stroke();
      }
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(10, 10);
      const floor = new THREE.Mesh(new THREE.BoxGeometry(FW, 0.2, FD), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78 }));
      floor.position.set(0, -0.1, Z0); scene.add(floor);
    }
    box(1.35, 0.03, 16.6, M(0xe6d3b0), 0, 0.02, Z0 - 0.2, scene);
    for (const z of [-8.5, -6.5, -4.5, -2.5, -0.5, 1.5, 3.5, 5.2]) box(0.14, 0.035, 0.7, M(0xf5d76e), 0, 0.04, z, scene);
    floorText('走道', 0, -9.4, 1.1, 'rgba(120,80,30,.8)');

    const beam = M(0xddd6c8, { roughness: 0.5 });

    const potMat = M(0xc46a3a, { roughness: 0.7 });
    const leafMat = M(0x3d9a54, { roughness: 0.72 });
    const stemMat = M(0x5a8a3a);
    const potGeo = new THREE.CylinderGeometry(0.18, 0.14, 0.2, 8);
    const leafGeo = new THREE.SphereGeometry(1, 9, 7);
    const plants = [];
    function addPlant(x, z, s = 1) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s);
      const pot = new THREE.Mesh(potGeo, potMat); pot.position.y = 0.12; g.add(pot);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.45, 6), stemMat); stem.position.y = 0.42; g.add(stem);
      for (const [lx, ly, lz, r] of [[0, 0.75, 0, 0.22], [0.12, 0.7, 0.08, 0.16], [-0.1, 0.68, -0.08, 0.15]]) {
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.position.set(lx, ly, lz); leaf.scale.set(r, r * 0.85, r); g.add(leaf);
      }
      scene.add(g);
      plants.push({ g, phase: Math.random() * Math.PI * 2, amp: 0.02 + Math.random() * 0.02 });
    }
    function addPendant(x, z, shade) {
      box(0.45, 0.06, 0.08, beam, x, 3.92, z, scene);
      box(0.018, 1.35, 0.018, M(0x667), x, 3.2, z, scene);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.22, 10, 1, true), M(shade, { roughness: 0.35, metalness: 0.2, emissive: shade, emissiveIntensity: 0.22 }));
      cone.position.set(x, 2.52, z); cone.rotation.x = Math.PI; scene.add(cone);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), new THREE.MeshBasicMaterial({ color: 0xfff3c8, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      glow.position.set(x, 2.42, z); glow.rotation.x = Math.PI / 2; scene.add(glow);
    }
    function addShelf(x, z, rot, w = 1.8) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g);
      const wood = M(0x8a6239);
      box(w, 0.06, 0.32, wood, 0, 0.18, 0, g);
      box(w, 0.06, 0.32, wood, 0, 0.48, 0, g);
      box(w, 0.06, 0.32, wood, 0, 0.78, 0, g);
      box(0.06, 0.78, 0.32, wood, -w / 2 + 0.03, 0.45, 0, g);
      box(0.06, 0.78, 0.32, wood, w / 2 - 0.03, 0.45, 0, g);
      const hues = [0x4285F4, 0xEA4335, 0xFBBC05, 0x34A853, 0x76B900, 0x1a1a1a];
      for (let i = 0; i < 6; i++) box(0.1, 0.2, 0.16, M(hues[i % hues.length]), -w / 2 + 0.25 + i * 0.26, 0.62, 0, g);
    }
    function addWhiteboard(x, z, rot) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g);
      box(1.5, 1.15, 0.05, M(0x2a2a2a), 0, 1.15, 0, g);
      box(1.4, 1.05, 0.04, M(0xf7f7f4), 0, 1.15, 0.03, g);
      box(0.06, 1.1, 0.06, M(0x8a6239), -0.55, 0.55, 0, g);
      box(0.06, 1.1, 0.06, M(0x8a6239), 0.55, 0.55, 0, g);
      box(0.22, 0.16, 0.02, M(0x4285F4), -0.4, 1.35, 0.06, g);
      box(0.2, 0.16, 0.02, M(0xEA4335), -0.12, 1.32, 0.06, g);
      box(0.2, 0.16, 0.02, M(0xFBBC05), 0.16, 1.36, 0.06, g);
    }

    const officeFloors = [];

    function addNeighborhood(zn) {
      const left = zn.x < 0;
      const x0 = zn.x - zn.w / 2, x1 = zn.x + zn.w / 2;
      const z0 = zn.z - zn.d / 2, z1 = zn.z + zn.d / 2;
      const trim = zn.accent || zn.color;
      box(zn.w - 0.05, 0.02, zn.d - 0.05, M(trim, { roughness: 0.85 }), zn.x, 0.015, zn.z, scene);
      const baseOp = zn.side === 'nvidia' && !zn.accent ? 0.5 : 0.36;
      const carpet = box(zn.w - 0.22, 0.025, zn.d - 0.22, M(zn.color, { transparent: true, opacity: baseOp, roughness: 0.9, emissive: trim, emissiveIntensity: 0.04 }), zn.x, 0.03, zn.z, scene);
      officeFloors.push({ id: zn.id, mat: carpet.material, baseOp });
      // 區名銘牌平放在靠近走道的地毯上
      const labelX = left ? x1 - 1.2 : x0 + 1.2;
      {
        const cv = document.createElement('canvas'); cv.width = 768; cv.height = 192;
        const c = cv.getContext('2d');
        c.fillStyle = zn.side === 'nvidia' ? '#141a10' : '#f7f4ee';
        c.beginPath(); c.roundRect(10, 16, 748, 160, 24); c.fill();
        c.strokeStyle = hex(zn.accent || zn.color); c.lineWidth = 8; c.stroke();
        c.fillStyle = zn.side === 'nvidia' ? '#b6f35a' : '#1a3a7a';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        fitText(c, zn.zone, 700, 96, 'bold'); c.fillText(zn.zone, 384, 98);
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2.15, 0.54), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.position.set(labelX, 0.055, zn.z); scene.add(m);
      }

      // 角落植栽
      addPlant(x0 + 0.35, z0 + 0.35, 0.95);
      addPlant(x1 - 0.35, z0 + 0.35, 0.9);
      addPlant(x0 + 0.35, z1 - 0.35, 1.0);
      if (zn.members.length < 4) addPlant(x1 - 0.35, z1 - 0.35, 0.85);

      // 吊燈
      const shades = zn.side === 'google' ? [0x4285F4, 0xEA4335, 0xFBBC05, 0x34A853] : [0x1a1a1a, 0x76B900, 0x2a2a2a];
      addPendant(zn.x - 1.5, zn.z + 0.4, shades[0]);
      addPendant(zn.x + 1.5, zn.z + 0.4, shades[1]);
      if (zn.d > 5) addPendant(zn.x, zn.z - 1.6, shades[2]);

      // 矮櫃與白板（當軟隔間，不是牆）
      if (zn.z > 0) addShelf(left ? x0 + 0.25 : x1 - 0.25, zn.z, left ? Math.PI / 2 : -Math.PI / 2, 1.7);
      else addWhiteboard(zn.x + (left ? -2.4 : 2.4), z0 + 0.55, 0);

    }
    OFFICES.forEach(addNeighborhood);

    // 總經理室：開放辦公區裡的小型玻璃角落辦公室
    const office = new THREE.Group(); office.position.set(0, 0, 5.55); scene.add(office);
    const glass = M(0xaed8ff, { transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false });
    box(4.2, 1.55, 0.05, glass, 0, 0.78, -1.05, office);
    box(0.05, 1.55, 2.1, glass, -2.1, 0.78, 0, office);
    box(0.05, 1.55, 2.1, glass, 2.1, 0.78, 0, office);
    box(1.5, 1.55, 0.05, glass, -1.35, 0.78, 1.05, office);
    box(1.5, 1.55, 0.05, glass, 1.35, 0.78, 1.05, office);
    const gmFrame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(4.2, 1.55, 2.1)), new THREE.LineBasicMaterial({ color: 0xcfe3ff, transparent: true, opacity: 0.55 }));
    gmFrame.position.y = 0.78; office.add(gmFrame);
    box(4.1, 0.03, 2.0, M(0x2e3d5c), 0, 0.02, 0, office);
    box(1.8, 0.08, 0.8, M(0x8a6a4a), 0, 0.75, -0.2, office);
    box(0.6, 0.8, 0.6, M(0x34405a), 0, 0.4, 0.45, office);
    {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 120;
      const c = cv.getContext('2d'); c.fillStyle = 'rgba(245,215,110,.95)'; c.beginPath(); c.roundRect(4, 4, 504, 112, 24); c.fill();
      c.fillStyle = '#1a1406'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, '總經理室（Louis）', 480, 60, 'bold'); c.fillText('總經理室（Louis）', 256, 62);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      spr.scale.set(2.6, 0.61, 1); spr.position.set(0, 2.15, 0); spr.renderOrder = 10; office.add(spr);
    }
    addPlant(-2.5, 6.5, 1.05); addPlant(2.5, 6.5, 1.0);

    // 走道末端：咖啡吧與休憩區
    box(3.4, 0.9, 0.7, M(0x6b4a2a), 0, 0.45, -8.7, scene);
    box(3.5, 0.07, 0.8, M(0xe8d5b5), 0, 0.94, -8.7, scene);
    box(0.5, 0.55, 0.36, M(0x222), -1.05, 1.28, -8.7, scene);
    box(0.22, 0.14, 0.16, M(0x76B900), -1.05, 1.6, -8.7, scene);
    box(0.12, 0.14, 0.12, M(0xf2f2f2), -0.5, 1.05, -8.55, scene);
    box(0.12, 0.14, 0.12, M(0x4285F4), -0.28, 1.05, -8.55, scene);
    for (const sx of [-0.9, 0.05, 1.0]) {
      const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.08, 10), M(0x333));
      stool.position.set(sx, 0.55, -8.05); scene.add(stool);
      box(0.07, 0.5, 0.07, M(0x555), sx, 0.25, -8.05, scene);
    }
    const cafeSign = labelSprite('咖啡吧', 1.7, 0.42, '#1a1406', '#f3ead8', '#76B900');
    cafeSign.position.set(0, 1.95, -8.7); scene.add(cafeSign);
    addPlant(-2.0, -8.9, 0.95); addPlant(2.0, -8.9, 0.9);

    // 沙發、豆袋、小茶几
    function sofa(x, z, rot, color) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g);
      box(1.55, 0.34, 0.68, M(color, { roughness: 0.85 }), 0, 0.28, 0, g);
      box(1.55, 0.52, 0.18, M(color, { roughness: 0.85 }), 0, 0.58, -0.26, g);
      box(0.12, 0.38, 0.68, M(color), -0.72, 0.42, 0, g);
      box(0.12, 0.38, 0.68, M(color), 0.72, 0.42, 0, g);
    }
    sofa(-3.3, -8.5, 0.3, 0x4285F4);
    sofa(3.3, -8.5, -0.3, 0x1a1a1a);
    const beanGeo = new THREE.SphereGeometry(1, 10, 8);
    function beanbag(x, z, color) {
      const m = new THREE.Mesh(beanGeo, M(color, { roughness: 0.92 }));
      m.scale.set(0.42, 0.26, 0.42); m.position.set(x, 0.2, z); scene.add(m);
    }
    beanbag(-2.35, -7.7, 0xEA4335);
    beanbag(-3.7, -7.55, 0xFBBC05);
    beanbag(2.45, -7.7, 0x76B900);
    beanbag(3.65, -7.5, 0x34A853);
    box(0.85, 0.07, 0.55, M(0xdecaa0), -3.15, 0.32, -7.7, scene);
    // 彩色圓球雕塑（校園感）
    const orbGeo = new THREE.SphereGeometry(0.28, 12, 10);
    [[-0.35, 0.28, -7.55, 0x4285F4], [0.05, 0.28, -7.35, 0xEA4335], [0.28, 0.28, -7.7, 0xFBBC05], [-0.05, 0.52, -7.55, 0x34A853]].forEach(([x, y, z, col]) => {
      const o = new THREE.Mesh(orbGeo, M(col, { roughness: 0.35, metalness: 0.15 })); o.position.set(x, y, z); scene.add(o);
    });

    // 兩側圓形會議艙
    function pod(x, z, rot, color) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g);
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 1.5, 16, 1, true, 0.5, Math.PI * 1.65), M(color, { side: THREE.DoubleSide, roughness: 0.55 }));
      wall.position.y = 0.75; g.add(wall);
      const roof = new THREE.Mesh(new THREE.CircleGeometry(1.14, 16), M(color, { roughness: 0.5 }));
      roof.rotation.x = -Math.PI / 2; roof.position.y = 1.5; g.add(roof);
      box(1.05, 0.26, 0.42, M(0xeeeae4), 0, 0.26, -0.2, g);
      const tbl = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 12), M(0xe8d5b5)); tbl.position.set(0, 0.52, 0.15); g.add(tbl);
    }
    pod(-8.15, -1.0, Math.PI / 2, 0x4285F4);
    pod(8.15, -1.0, -Math.PI / 2, 0x1f2a18);
    const podL = labelSprite('會議艙', 1.15, 0.3, '#1a1406', '#f3ead8', '#4285F4'); podL.position.set(-8.15, 2.0, -1.0); scene.add(podL);
    const podR = labelSprite('會議艙', 1.15, 0.3, '#f3ead8', '#1a1a1a', '#76B900'); podR.position.set(8.15, 2.0, -1.0); scene.add(podR);

    // 地面連線：實線＝直屬，虛線＝審核
    const lineMat = new THREE.LineBasicMaterial({ color: 0x6a5840, transparent: true, opacity: 0.55 });
    const dashMat = new THREE.LineDashedMaterial({ color: 0xEA4335, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.85 });
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
      const zone = box(2.2, 0.04, 2.6, zoneMat, 0, 0.05, 0, inner);
      const top = box(1.7, 0.08, 0.8, M(L.lead ? 0xe6d2ae : 0xd9c7a8), 0, 0.75, 0.3, inner);
      for (const [x, z] of [[-0.75, -0.05], [0.75, -0.05], [-0.75, 0.65], [0.75, 0.65]]) box(0.06, 0.72, 0.06, M(0x555f73), x, 0.36, z, inner);
      const scr = M(0x0e1a2e, { emissive: f.color, emissiveIntensity: 0.15 });
      box(0.8, 0.5, 0.05, scr, 0, 1.1, 0.6, inner); box(0.08, 0.25, 0.08, M(0x555f73), 0, 0.88, 0.6, inner);
      box(0.5, 0.08, 0.5, M(0x34405a), 0, 0.48, -0.5, inner); box(0.5, 0.55, 0.08, M(0x34405a), 0, 0.78, -0.76, inner);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.23, 0.55, 16), M(f.color)); body.position.set(0, 0.8, -0.45); inner.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), M(0xf1d3b3)); head.position.set(0, 1.24, -0.45); inner.add(head);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), M(f.color, { emissive: f.color, emissiveIntensity: 0.2, roughness: 0.3 }));
      lamp.position.set(0, 1.48, 0.6); inner.add(lamp);
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 300;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      const ls = L.k ? Math.min(1, L.k * 1.0) : 1; spr.scale.set(2.3 * ls, 1.35 * ls, 1); spr.position.set(0, 2.3 * k, 0); spr.renderOrder = 10; g.add(spr);
      const hits = [zone, top, body, head, spr];
      hits.forEach((m) => { m.userData.id = f.id; m.userData.type = 'desk'; });
      scene.add(g);
      desks.push({ f, zoneMat, scr, lamp, cv, tex, hits, busyPulse: false });
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
        d.busyPulse = !!(busy || waiting);
        d.lamp.material.emissiveIntensity = d.busyPulse ? 0.7 : 0.18;
        drawLabel(d, on);
      }
      for (const o of officeFloors) {
        o.mat.opacity = o.baseOp;
        o.mat.emissiveIntensity = 0.04;
      }
    }
    function select(id) { selected = id; update(); }

    controls.target.set(0, 0.5, -0.8);
    function resize() {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      if (!resize.done) {
        const narrow = w / h < 1;
        if (narrow) camera.position.set(0, 19.5, 18.2); else camera.position.set(0, 13.6, 18.2);
        resize.done = true;
      }
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(el); resize();

    let userMoved = false;
    const stopSpin = () => { userMoved = true; controls.autoRotate = false; };
    renderer.domElement.addEventListener('pointerdown', stopSpin);
    renderer.domElement.addEventListener('wheel', stopSpin, { passive: true });
    renderer.domElement.addEventListener('touchstart', stopSpin, { passive: true });
    setTimeout(() => { if (!userMoved) controls.autoRotate = true; }, 5000);

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
    (function loop(t) {
      controls.update();
      const sec = t * 0.001;
      for (const p of plants) p.g.rotation.z = Math.sin(sec * 1.15 + p.phase) * p.amp;
      for (const d of desks) {
        d.lamp.material.emissiveIntensity = d.busyPulse ? 0.5 + Math.sin(sec * 3.2) * 0.4 : 0.18;
      }
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    })(0);
    building = { update, select };
    update();
  } catch (e) {
    el.innerHTML = '<p class="empty" style="padding:24px;text-align:center">三維畫面無法載入，下方清單仍可正常查看</p>';
  }
}

render();
initBuilding();
load();
