// AI 辦公樓看板：前端只讀取加密資料檔 data.enc.json，於瀏覽器端以通關密語解密。
const FLOORS = [
  { id: 'pa',  name: 'Sr. PA Ai（私人資深特助）', color: 0x5aa9ff },
  { id: 'cos', name: 'CoS Ai（幕僚長）', color: 0x8b7bff },
  { id: 'clo', name: 'CLO Ai（法務）', color: 0xc77dff },
  { id: 'cto', name: 'CTO Ai（技術長）', color: 0x4dd4c6 },
  { id: 'cpo', name: 'CPO Ai（採購長）', color: 0x6fcf6f },
  { id: 'fpa', name: 'Sr. FP&A Analyst Ai（財務規劃）', color: 0xf5b544 },
  { id: 'ia',  name: 'Sr. IA Ai（投資分析師）', color: 0xff8f5a },
  { id: 'air', name: 'Air 特殊小組（Admin／Kobe／Fly）', color: 0xff6b9a },
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
  const idx = FLOORS.indexOf(f);
  $('#detail').dataset.id = id;
  $('#detail-title').textContent = `${FLOORS.length - idx} 樓｜${f.name}`;
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

// ---------- 三維辦公樓 ----------
async function initBuilding() {
  const el = $('#building');
  try {
    const THREE = await import('three');
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.enablePan = false;
    controls.minDistance = 9; controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI * 0.55;
    scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x0b1220, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(8, 16, 10); scene.add(sun);

    const H = 1.0, W = 5.2, D = 3.6, N = FLOORS.length;
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.2, 48), new THREE.MeshStandardMaterial({ color: 0x18233a }));
    ground.position.y = -0.1; scene.add(ground);
    const floors = [];
    FLOORS.forEach((f, i) => {
      const level = N - 1 - i;
      const g = new THREE.Group(); g.position.y = level * H + H / 2;
      const mat = new THREE.MeshStandardMaterial({ color: f.color, transparent: true, opacity: 0.55, roughness: 0.2, metalness: 0.3, emissive: f.color, emissiveIntensity: 0.05 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.92, D), mat);
      box.userData.id = f.id;
      g.add(box);
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })));
      const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 0.06, D + 0.2), new THREE.MeshStandardMaterial({ color: 0x2a3a5a }));
      slab.position.y = -H / 2; g.add(slab);
      // 標籤
      const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 160;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      spr.scale.set(6.4, 1.0, 1); spr.position.set(0, 0, D / 2 + 0.6); spr.renderOrder = 10;
      g.add(spr);
      scene.add(g);
      floors.push({ f, level, box, mat, cv, tex });
    });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.15, D + 0.3), new THREE.MeshStandardMaterial({ color: 0x2a3a5a }));
    roof.position.y = N * H + 0.05; scene.add(roof);

    function drawLabel(fl, selected) {
      const p = person(fl.f.id);
      const c = fl.cv.getContext('2d');
      c.clearRect(0, 0, 1024, 160);
      c.fillStyle = selected ? 'rgba(90,169,255,.95)' : 'rgba(11,18,32,.82)';
      c.beginPath(); c.roundRect(4, 4, 1016, 152, 24); c.fill();
      c.fillStyle = selected ? '#04121f' : '#ffffff';
      c.font = 'bold 50px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
      c.fillText(`${N - FLOORS.indexOf(fl.f)}F　${fl.f.name}`, 30, 68);
      c.font = '40px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
      c.fillStyle = selected ? '#04121f' : '#b8c7e0';
      let sub = NO_DATA;
      if (p) {
        const prog = arr(p, 'tasks').filter((t) => t.status === 'in_progress').length;
        const w = arr(p, 'waiting_on_louis').length;
        const d = arr(p, 'doing').length;
        sub = (d || prog || w || arr(p, 'tasks').length) ? `正在做 ${d}｜進行中 ${prog}｜等我 ${w}` : NO_DATA;
      }
      c.fillText(sub, 30, 128);
      fl.tex.needsUpdate = true;
    }
    let selected = null;
    function update() {
      for (const fl of floors) {
        const p = person(fl.f.id);
        const busy = p && (arr(p, 'doing').length || arr(p, 'tasks').some((t) => t.status === 'in_progress'));
        const waiting = p && arr(p, 'waiting_on_louis').length;
        fl.mat.emissiveIntensity = fl.f.id === selected ? 0.9 : waiting ? 0.5 : busy ? 0.3 : 0.05;
        fl.mat.opacity = p ? 0.7 : 0.35;
        drawLabel(fl, fl.f.id === selected);
      }
    }
    function select(id) { selected = id; update(); }

    const center = new THREE.Vector3(0, N * H / 2, 0);
    controls.target.copy(center);
    function resize() {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      const dist = w < 600 ? 19 : 15;
      if (!resize.done) { camera.position.set(dist * 0.55, N * H * 0.75, dist); resize.done = true; }
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(el); resize();

    // 點選樓層（區分拖曳與點擊）
    const ray = new THREE.Raycaster(), v = new THREE.Vector2();
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) { down = null; return; }
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v, camera);
      const hit = ray.intersectObjects(floors.map((x) => x.box))[0];
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
