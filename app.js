// AI 辦公樓看板：前端只讀取加密資料檔 data.enc.json，於瀏覽器端以通關密語解密。
const FLOORS = [
  { id: 'pa',  name: 'Sr. PA Ai（私人資深特助）', color: 0x5aa9ff },
  { id: 'cos', name: 'CoS Ai（幕僚長）', color: 0x8b7bff },
  { id: 'clo', name: 'CLO Ai（法務）', color: 0xc77dff },
  { id: 'cto', name: 'CTO Ai（技術長）', color: 0x4dd4c6 },
  { id: 'cpo', name: 'CPO Ai（採購長）', color: 0x6fcf6f },
  { id: 'fpa', name: 'Sr. FP&A Analyst Ai（財務規劃）', color: 0xf5b544 },
  { id: 'ia',  name: 'Sr. IA Ai（投資分析師）', color: 0xff8f5a },
  { id: 'air', name: 'Air 特殊小組', color: 0xff6b9a },
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

// ---------- 三維開放式辦公室（所有人同一層） ----------
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
    controls.minDistance = 7; controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI * 0.45;
    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x0b1220, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(6, 14, 8); scene.add(sun);
    const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
    const box = (w, h, d, mat, x, y, z, parent) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; };

    // 樓板與隔間線
    const narrow = el.clientWidth < 600;
    const COLS = narrow ? 2 : 4, ROWS = Math.ceil(FLOORS.length / COLS), SX = narrow ? 3.6 : 3.4, SZ = narrow ? 3.6 : 4.0;
    const FW = COLS * SX + 1.2, FD = ROWS * SZ + 1.2;
    box(FW, 0.2, FD, M(0x1c2842), 0, -0.1, 0, scene);
    const grid = new THREE.GridHelper(Math.max(FW, FD), 16, 0x2f4166, 0x24324d); grid.position.y = 0.01; scene.add(grid);
    box(FW, 1.2, 0.08, M(0x2a3a5a, { transparent: true, opacity: 0.6 }), 0, 0.6, -FD / 2, scene);

    const desks = [];
    FLOORS.forEach((f, i) => {
      const col = i % COLS, row = Math.floor(i / COLS);
      const g = new THREE.Group();
      g.position.set((col - (COLS - 1) / 2) * SX, 0, (row - (ROWS - 1) / 2) * SZ);
      // 座位區地墊（可點選）
      const zoneMat = M(f.color, { transparent: true, opacity: 0.25, emissive: f.color, emissiveIntensity: 0.05 });
      const zone = box(SX - 0.4, 0.04, SZ - 0.6, zoneMat, 0, 0.03, 0, g);
      // 桌子
      const top = box(1.9, 0.08, 0.9, M(0xd9c7a8), 0, 0.75, -0.3, g);
      for (const [x, z] of [[-0.85, -0.65], [0.85, -0.65], [-0.85, 0.05], [0.85, 0.05]]) box(0.06, 0.72, 0.06, M(0x555f73), x, 0.36, z, g);
      // 螢幕
      const scr = M(0x0e1a2e, { emissive: f.color, emissiveIntensity: 0.15 });
      box(0.9, 0.55, 0.05, scr, 0, 1.12, -0.6, g); box(0.08, 0.25, 0.08, M(0x555f73), 0, 0.88, -0.6, g);
      // 椅子與人
      box(0.55, 0.08, 0.55, M(0x34405a), 0, 0.48, 0.55, g); box(0.55, 0.6, 0.08, M(0x34405a), 0, 0.8, 0.82, g);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.6, 16), M(f.color)); body.position.set(0, 0.82, 0.5); g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 16), M(0xf1d3b3)); head.position.set(0, 1.28, 0.5); g.add(head);
      // 名牌
      const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 220;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      spr.scale.set(3.2, 0.69, 1); spr.position.set(0, 2.3, 0); spr.renderOrder = 10; g.add(spr);
      const hits = [zone, top, body, head, spr];
      hits.forEach((m) => { m.userData.id = f.id; });
      scene.add(g);
      desks.push({ f, zoneMat, scr, cv, tex, hits });
    });

    function fitText(c, text, max, size, weight) {
      let s = size;
      do { c.font = `${weight} ${s}px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif`; s -= 2; } while (c.measureText(text).width > max && s > 20);
    }
    function drawLabel(d, selected) {
      const p = person(d.f.id);
      const c = d.cv.getContext('2d');
      c.clearRect(0, 0, 1024, 220);
      c.fillStyle = selected ? 'rgba(90,169,255,.96)' : 'rgba(11,18,32,.86)';
      c.beginPath(); c.roundRect(4, 4, 1016, 212, 28); c.fill();
      c.textAlign = 'center';
      c.fillStyle = selected ? '#04121f' : '#ffffff';
      fitText(c, d.f.name, 980, 76, 'bold'); c.fillText(d.f.name, 512, 92);
      let sub = NO_DATA;
      if (p) {
        const dn = arr(p, 'doing').length, prog = arr(p, 'tasks').filter((t) => t.status === 'in_progress').length, w = arr(p, 'waiting_on_louis').length;
        if (dn || prog || w || arr(p, 'tasks').length) sub = `正在做 ${dn}｜進行中 ${prog}｜等我 ${w}`;
      }
      c.fillStyle = selected ? '#04121f' : '#b8c7e0';
      fitText(c, sub, 980, 60, 'normal'); c.fillText(sub, 512, 178);
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

    controls.target.set(0, 0.6, 0);
    function resize() {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      if (!resize.done) {
        if (narrow) camera.position.set(0, 17, 11); else camera.position.set(0, 10, 13.5);
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
