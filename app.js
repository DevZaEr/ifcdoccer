import * as THREE from "three";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import * as WebIFC from "https://cdn.jsdelivr.net/npm/web-ifc@0.0.51/web-ifc-api.js";

window.addEventListener('error', (e) => showError(e.error || e.message || e));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

const viewport = document.getElementById('viewport');
const emptyEl = document.getElementById('empty');
const loadingEl = document.getElementById('loading');
const loadingMsg = document.getElementById('loadingMsg');
const hintEl = document.getElementById('hint');
const statusEl = document.getElementById('status');
const gridEl = document.getElementById('grid');
const countEl = document.getElementById('containerCount');
const resetAllBtn = document.getElementById('resetAll');
const fileInput = document.getElementById('fileInput');
const errbox = document.getElementById('errbox');
const errtext = document.getElementById('errtext');

document.getElementById('loadBtn').onclick = () => fileInput.click();
document.getElementById('loadBtn2').onclick = () => fileInput.click();

// ---------- collapsible sidebar ----------
const asideEl = document.querySelector('aside');
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
sidebarToggleBtn.onclick = () => {
  const collapsed = asideEl.classList.toggle('collapsed');
  sidebarToggleBtn.textContent = collapsed ? 'Показать панель' : 'Скрыть панель';
};
document.getElementById('errCopy').onclick = () => {
  navigator.clipboard?.writeText(errtext.textContent).catch(() => {});
};

function showError(err) {
  console.error(err);
  errtext.textContent = (err && (err.stack || err.message)) || String(err);
  errbox.classList.add('show');
}

// ---------- three.js scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeef1f4); // light by default; adjustable via the swatch picker in the sidebar

const camera = new THREE.PerspectiveCamera(50, 1, 10, 500000);
camera.position.set(8000, 8000, 8000);

// antialias off + pixel ratio capped at 1: meaningfully lighter on weak/integrated
// GPUs, at the cost of slightly softer edges (not very noticeable on this kind of
// flat, blocky container geometry).
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// ---------- cinematic idle camera ----------
// When the user isn't interacting, the camera slowly drifts around the model
// (gentle orbit + height sway + slow zoom breathing) so the scene never looks frozen.
const IDLE_RESUME_DELAY = 3500;   // ms of inactivity before the idle drift resumes
let IDLE_ROT_SPEED = 0.045;       // rad/s azimuth drift (adjustable via slider)
const IDLE_PHI_AMPLITUDE = 0.10;  // rad, vertical sway
const IDLE_PHI_FREQ = 0.15;       // rad/s
const IDLE_RADIUS_AMPLITUDE = 0.035; // fraction of radius, slow zoom breathing
const IDLE_RADIUS_FREQ = 0.08;    // rad/s
let IDLE_ARC_FRACTION = 0.02;     // fraction of a full circle flown before reversing direction (adjustable via slider)
let idleEnabled = true;           // master on/off switch (the "stop camera" button)

const clock = new THREE.Clock();
// theta is the live azimuth angle; dir/segment track the pendulum sweep that
// reverses once it has covered IDLE_ARC_FRACTION of a full circle
const idle = { active: false, t: 0, theta: 0, dir: 1, segment: 0, phi0: Math.PI / 4, radius0: 10000 };
let resumeTimer = null;

function startIdle() {
  if (!idleEnabled) return;
  const offset = camera.position.clone().sub(controls.target);
  const sph = new THREE.Spherical().setFromVector3(offset);
  idle.theta = sph.theta;
  idle.phi0 = sph.phi;
  idle.radius0 = sph.radius;
  idle.dir = 1;
  idle.segment = 0;
  idle.t = 0;
  idle.active = true;
}
function stopIdle() {
  idle.active = false;
  clearTimeout(resumeTimer);
}
function scheduleIdleResume() {
  clearTimeout(resumeTimer);
  if (!idleEnabled) return;
  resumeTimer = setTimeout(startIdle, IDLE_RESUME_DELAY);
}
controls.addEventListener('start', stopIdle);
controls.addEventListener('end', scheduleIdleResume);

function tickIdleCamera(dt) {
  if (!idle.active || !idleEnabled) return;
  idle.t += dt;
  const step = IDLE_ROT_SPEED * dt;
  const arcLimit = IDLE_ARC_FRACTION * Math.PI * 2;
  idle.segment += step;
  if (idle.segment >= arcLimit) {
    idle.dir *= -1;
    idle.segment = 0;
  }
  idle.theta += idle.dir * step;
  const phi = THREE.MathUtils.clamp(
    idle.phi0 + Math.sin(idle.t * IDLE_PHI_FREQ) * IDLE_PHI_AMPLITUDE, 0.2, Math.PI - 0.2
  );
  const radius = idle.radius0 * (1 + IDLE_RADIUS_AMPLITUDE * Math.sin(idle.t * IDLE_RADIUS_FREQ));
  const offset = new THREE.Vector3().setFromSphericalCoords(radius, phi, idle.theta);
  camera.position.copy(controls.target).add(offset);
  camera.lookAt(controls.target);
}

// ---------- sun position: 40°N latitude, 11:00 local solar time (equinox) ----------
// Standard solar-position formulas, assuming solar declination = 0 (equinox, since
// no specific date was given) and hour angle H = 15°*(hour-12):
//   altitude: sin(alt) = cos(lat)*cos(H)                       -> alt ≈ 47.7°
//   azimuth:  cos(Az)  = -sin(lat)*sin(alt) / (cos(lat)*cos(alt)) -> Az ≈ 157° from North
// World axes used: +Y = up, +X = East, +Z = South, -Z = North.
const SUN_ALT = THREE.MathUtils.degToRad(47.7);
const SUN_AZ = THREE.MathUtils.degToRad(157.4); // clockwise from North
const sunDir = new THREE.Vector3(
  Math.cos(SUN_ALT) * Math.sin(SUN_AZ),   // East component
  Math.sin(SUN_ALT),                      // up
  -Math.cos(SUN_ALT) * Math.cos(SUN_AZ),  // South component
).normalize();

scene.add(new THREE.AmbientLight(0xcfe0ff, 0.35)); // soft cool sky fill
const sun = new THREE.DirectionalLight(0xfff2db, 1.495); // warm late-morning sunlight (+30%)
sun.position.copy(sunDir).multiplyScalar(10000);
scene.add(sun);
const sun2 = new THREE.DirectionalLight(0xdbe8ff, 0.3); // faint cool bounce from the opposite side
sun2.position.copy(sunDir).multiplyScalar(-10000);
scene.add(sun2);

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
new ResizeObserver(resize).observe(viewport);
resize();

// ---------- video pane (placeholder until a real camera stream is wired up) ----------
const videoPane = document.getElementById('videoPane');
const cameraCanvas = document.getElementById('cameraCanvas');
const videoPlaceholderEl = document.getElementById('videoPlaceholder');
const videoCtx = cameraCanvas.getContext('2d');

function drawVideoPlaceholder() {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = videoPane.clientWidth, h = videoPane.clientHeight;
  cameraCanvas.width = Math.max(1, w * dpr);
  cameraCanvas.height = Math.max(1, h * dpr);
  videoCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  videoCtx.fillStyle = '#0b0e12';
  videoCtx.fillRect(0, 0, w, h);
  // faint scanline texture so the empty canvas doesn't look like a rendering bug
  videoCtx.strokeStyle = 'rgba(143,160,181,0.05)';
  videoCtx.lineWidth = 1;
  for (let y = 0; y < h; y += 3) {
    videoCtx.beginPath(); videoCtx.moveTo(0, y + 0.5); videoCtx.lineTo(w, y + 0.5); videoCtx.stroke();
  }
}
new ResizeObserver(drawVideoPlaceholder).observe(videoPane);
drawVideoPlaceholder();

// ---------- draggable divider between the 3D view and the video pane ----------
const sceneArea = document.getElementById('sceneArea');
const sceneResizer = document.getElementById('sceneResizer');
const SCENE_PANE_MIN = 60; // px, minimum height either pane can be dragged to
let scenePaneDragging = false;
// By default the video pane is sized to exactly match the demo video's own
// aspect ratio (1280x720, 16:9) at the full width of the scene area, so the
// video is shown edge-to-edge with no cropping/letterboxing. Once the user
// drags the divider themselves, that auto-fit is dropped in favor of whatever
// split they chose, same as before.
// The exported demo-video.mp4 is a 1280x720 (16:9) file, but its actual filmed
// content only fills a 2432x412 region in the middle, with black letterbox bars
// padding it out to 16:9. So the pane is pinned to that content ratio (412/2432)
// rather than the file's own 16:9 — this crops the black bars away via
// object-fit:cover, showing the real footage edge-to-edge. TEMPORARY: once a
// video without the letterbox bars is exported, flip FORCE_VIDEO_ASPECT below
// back to false so the pane auto-detects whatever new ratio that file has.
const FORCE_VIDEO_ASPECT = true;
let VIDEO_ASPECT_H_OVER_W = FORCE_VIDEO_ASPECT ? (412 / 2432) : (720 / 1280); // fallback until the real video's own size is known
let autoFitVideoHeight = true;

function setViewportHeight(px) {
  const areaH = sceneArea.clientHeight;
  const resizerH = sceneResizer.clientHeight;
  const maxH = Math.max(SCENE_PANE_MIN, areaH - resizerH - SCENE_PANE_MIN);
  const clamped = Math.max(SCENE_PANE_MIN, Math.min(px, maxH));
  viewport.style.flex = `0 0 ${clamped}px`;
}
function applyVideoAspectFit() {
  const areaH = sceneArea.clientHeight;
  const resizerH = sceneResizer.clientHeight;
  const width = sceneArea.clientWidth;
  const desiredVideoH = width * VIDEO_ASPECT_H_OVER_W;
  setViewportHeight(areaH - resizerH - desiredVideoH);
}
function scenePaneMoveHandler(clientY) {
  const rect = sceneArea.getBoundingClientRect();
  setViewportHeight(clientY - rect.top);
}
function startScenePaneDrag(e) {
  scenePaneDragging = true;
  autoFitVideoHeight = false; // user is taking manual control of the split
  sceneResizer.classList.add('dragging');
  document.body.style.userSelect = 'none';
  e.preventDefault();
}
function endScenePaneDrag() {
  if (!scenePaneDragging) return;
  scenePaneDragging = false;
  sceneResizer.classList.remove('dragging');
  document.body.style.userSelect = '';
}
sceneResizer.addEventListener('mousedown', startScenePaneDrag);
window.addEventListener('mousemove', (e) => { if (scenePaneDragging) scenePaneMoveHandler(e.clientY); });
window.addEventListener('mouseup', endScenePaneDrag);
sceneResizer.addEventListener('touchstart', (e) => { startScenePaneDrag(e); }, { passive: false });
window.addEventListener('touchmove', (e) => {
  if (!scenePaneDragging) return;
  scenePaneMoveHandler(e.touches[0].clientY);
  e.preventDefault();
}, { passive: false });
window.addEventListener('touchend', endScenePaneDrag);
// keep the video pane matched to the video's aspect ratio on resize, unless
// the user has manually dragged the divider (then just keep their split proportional)
new ResizeObserver(() => {
  if (scenePaneDragging) return;
  if (autoFitVideoHeight) applyVideoAspectFit();
  else setViewportHeight(viewport.clientHeight);
}).observe(sceneArea);
// Also apply it directly, right now: ResizeObserver's own initial callback is
// supposed to fire on observe() in every modern engine, but don't rely on that
// alone — run it explicitly too so the very first paint is already correctly sized.
applyVideoAspectFit();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  tickIdleCamera(dt);
  tickExplode(dt);
  tickHighlightBlink(dt);
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// ---------- container state ----------
const DEFAULT_COLOR = 0x8fa0b5;
const containers = new Map(); // expressID -> { meshes:[Mesh], catIndex }

const CATEGORIES = [
  { id: 0, title: 'Порожний / гружёный', color: 0x1b1f24, on: true },
  { id: 1, title: 'Отсутствие заявки', color: 0xef4444, on: true },
  { id: 2, title: 'Есть заявка, нет автотранспорта', color: 0xf2c23e, on: true },
  { id: 3, title: 'Есть заявка и автотранспорт', color: 0x34d399, on: true },
];

function colorHex(hexInt) { return '#' + hexInt.toString(16).padStart(6, '0'); }

function renderCategory(cat) {
  const members = [...containers.values()].filter(e => e.catIndex === cat.id);
  const color = cat.on ? cat.color : DEFAULT_COLOR;
  members.forEach(entry => {
    entry.meshes.forEach(m => m.material.color.setHex(color));
    if (entry.label) entry.label.visible = labelShouldBeVisible(entry);
  });
  if (cat.btn) {
    cat.btn.classList.toggle('on', cat.on);
    cat.cntEl.textContent = members.length + ' шт.';
  }
}

function buildCategoryButtons() {
  gridEl.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat';
    btn.style.setProperty('--sw', colorHex(cat.color));
    btn.innerHTML = `<span class="swatch"></span><span class="body"><div class="ttl">${cat.title}</div><div class="cnt">0 шт.</div></span>`;
    btn.onclick = () => { cat.on = !cat.on; renderCategory(cat); };
    cat.btn = btn;
    cat.cntEl = btn.querySelector('.cnt');
    gridEl.appendChild(btn);
    renderCategory(cat);
  });
}

function shuffleCategories() {
  containers.forEach(entry => { entry.catIndex = Math.floor(Math.random() * CATEGORIES.length); });
  CATEGORIES.forEach(renderCategory);
}

resetAllBtn.onclick = () => {
  CATEGORIES.forEach(cat => { cat.on = false; renderCategory(cat); });
};
document.getElementById('shuffleBtn').onclick = () => shuffleCategories();

// ---------- global opacity ----------
let currentOpacity = 1;
const opacitySlider = document.getElementById('opacitySlider');
const opacityVal = document.getElementById('opacityVal');

function applyOpacity(value) {
  currentOpacity = value;
  containers.forEach(entry => entry.meshes.forEach(m => {
    m.material.opacity = currentOpacity;
    m.material.depthWrite = currentOpacity >= 0.999;
  }));
}
opacitySlider.addEventListener('input', () => {
  const pct = Number(opacitySlider.value);
  opacityVal.textContent = pct + '%';
  applyOpacity(pct / 100);
  applyHighlight(); // re-assert the 100%/20% split on top of the new base opacity, if a container is highlighted
});

// ---------- highlight a single container by its table number ----------
const HIGHLIGHT_DIM_OPACITY = 0.1;
const HIGHLIGHT_BLINK_PERIOD = 0.7; // seconds per full blink cycle
const HIGHLIGHT_BLINK_MIN = 0.35;   // lowest opacity the highlighted container dips to
let highlightedKey = null;
let highlightedEntry = null; // the actual container entry currently blinking, if any
let highlightBlinkT = 0;
const highlightSelect = document.getElementById('highlightSelect');

function applyHighlight() {
  highlightedEntry = null;
  if (highlightedKey == null) {
    applyOpacity(currentOpacity);
    return;
  }
  containers.forEach((entry, key) => {
    const isPicked = String(key) === highlightedKey;
    if (isPicked) highlightedEntry = entry;
    const op = isPicked ? 1 : HIGHLIGHT_DIM_OPACITY;
    entry.meshes.forEach(m => {
      m.material.opacity = op;
      m.material.depthWrite = op >= 0.999;
    });
  });
  highlightBlinkT = 0; // restart the blink phase cleanly each time a new container is picked
}

function tickHighlightBlink(dt) {
  if (!highlightedEntry) return;
  highlightBlinkT += dt;
  const phase = (highlightBlinkT % HIGHLIGHT_BLINK_PERIOD) / HIGHLIGHT_BLINK_PERIOD;
  const factor = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2); // smooth 0..1..0 wave
  const op = HIGHLIGHT_BLINK_MIN + (1 - HIGHLIGHT_BLINK_MIN) * factor;
  highlightedEntry.meshes.forEach(m => {
    m.material.opacity = op;
    m.material.depthWrite = op >= 0.999;
  });
}

function populateHighlightSelect() {
  const prevValue = highlightSelect.value;
  highlightSelect.innerHTML = '<option value="">— не выбран —</option>';
  const entries = [...containers.entries()].filter(([, e]) => e.cellNumber != null);
  entries.sort((a, b) => a[1].cellNumber - b[1].cellNumber);
  entries.forEach(([key, entry]) => {
    const opt = document.createElement('option');
    opt.value = String(key);
    opt.textContent = '№ ' + entry.cellNumber;
    highlightSelect.appendChild(opt);
  });
  const stillValid = [...highlightSelect.options].some(o => o.value === prevValue && prevValue !== '');
  highlightSelect.value = stillValid ? prevValue : '';
  highlightedKey = stillValid ? prevValue : null;
  applyHighlight();
}

highlightSelect.addEventListener('change', () => {
  highlightedKey = highlightSelect.value === '' ? null : highlightSelect.value;
  applyHighlight();
});

const arcSlider = document.getElementById('arcSlider');
const arcVal = document.getElementById('arcVal');
arcSlider.addEventListener('input', () => {
  const pct = Number(arcSlider.value);
  arcVal.textContent = pct.toFixed(1) + '%';
  IDLE_ARC_FRACTION = pct / 100;
});

const BASE_ROT_SPEED = IDLE_ROT_SPEED; // 100% reference point for the speed slider
const speedSlider = document.getElementById('speedSlider');
const speedVal = document.getElementById('speedVal');
speedSlider.addEventListener('input', () => {
  const pct = Number(speedSlider.value);
  speedVal.textContent = pct + '%';
  IDLE_ROT_SPEED = BASE_ROT_SPEED * (pct / 100);
});

const cameraToggleBtn = document.getElementById('cameraToggleBtn');
cameraToggleBtn.onclick = () => {
  idleEnabled = !idleEnabled;
  if (idleEnabled) {
    cameraToggleBtn.textContent = 'Остановить камеру';
    cameraToggleBtn.classList.remove('on');
    startIdle();
  } else {
    cameraToggleBtn.textContent = 'Включить автооблёт';
    cameraToggleBtn.classList.add('on');
    stopIdle();
  }
};

// ---------- container number labels: show/hide ----------
let labelsVisible = false; // numbers stay hidden by default until the user toggles them on
const numbersToggleBtn = document.getElementById('numbersToggleBtn');
// a label is only ever shown if the user turned numbers on AND the container's
// own status category is currently active (its color switched on)
function labelShouldBeVisible(entry) {
  if (!labelsVisible) return false;
  const cat = CATEGORIES[entry.catIndex];
  return !!(cat && cat.on);
}
function refreshAllLabelVisibility() {
  containers.forEach(entry => { if (entry.label) entry.label.visible = labelShouldBeVisible(entry); });
}
function setLabelsVisible(v) {
  labelsVisible = v;
  refreshAllLabelVisibility();
  numbersToggleBtn.textContent = v ? 'Скрыть номера контейнеров' : 'Показать номера контейнеров';
  numbersToggleBtn.classList.toggle('on', !v);
}
numbersToggleBtn.onclick = () => setLabelsVisible(!labelsVisible);

// ---------- scene background color ----------
const BG_PRESETS = [
  { name: 'Светлый', hex: '#eef1f4' },
  { name: 'Белый', hex: '#ffffff' },
  { name: 'Голубой', hex: '#dce8f5' },
  { name: 'Песочный', hex: '#f2ead9' },
  { name: 'Тёмный', hex: '#11161c' },
];
const bgCustom = document.getElementById('bgCustom');
const bgSwatchesEl = document.getElementById('bgSwatches');
const bgSwatchBtns = [];

function setSceneBackground(hex) {
  scene.background.set(hex);
  bgCustom.value = hex;
  bgSwatchBtns.forEach(b => b.classList.toggle('active', b.dataset.hex.toLowerCase() === hex.toLowerCase()));
}
function buildBgSwatches() {
  bgSwatchesEl.innerHTML = '';
  bgSwatchBtns.length = 0;
  BG_PRESETS.forEach(p => {
    const b = document.createElement('button');
    b.className = 'swbtn';
    b.style.background = p.hex;
    b.title = p.name;
    b.dataset.hex = p.hex;
    b.onclick = () => setSceneBackground(p.hex);
    bgSwatchBtns.push(b);
    bgSwatchesEl.appendChild(b);
  });
}
buildBgSwatches();
setSceneBackground('#' + scene.background.getHexString());
bgCustom.addEventListener('input', () => setSceneBackground(bgCustom.value));

// ---------- exploded view ----------
// Pushes every container radially outward from the model's center so the gaps
// between them become clearly visible, then animates back on toggle.
const EXPLODE_FACTOR = 1.7;   // 1 = original spacing; distance moved = (factor-1)*original — halved from before
const EXPLODE_DURATION = 0.9; // seconds for the animation
const explodeBtn = document.getElementById('explodeBtn');
const explodeState = { progress: 0, target: 0 };

function easeInOutQuad(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

function tickExplode(dt) {
  if (explodeState.progress === explodeState.target) return;
  const dir = explodeState.target > explodeState.progress ? 1 : -1;
  explodeState.progress = THREE.MathUtils.clamp(explodeState.progress + dir * (dt / EXPLODE_DURATION), 0, 1);
  const eased = easeInOutQuad(explodeState.progress);
  containers.forEach(entry => {
    if (!entry.explodeDelta) return;
    const base = entry.basePosition;
    entry.group.position.set(
      base.x + entry.explodeDelta.x * eased,
      base.y + entry.explodeDelta.y * eased,
      base.z + entry.explodeDelta.z * eased
    );
  });
}

function resetExplode() {
  explodeState.progress = 0;
  explodeState.target = 0;
  containers.forEach(entry => entry.group.position.copy(entry.basePosition));
  explodeBtn.textContent = 'Разъехаться';
  explodeBtn.classList.remove('on');
  explodeBtn.disabled = containers.size === 0;
}

// Recomputes each container's world center + its radial explode offset, relative
// to the current bounding center of *all* containers (IFC-loaded and manual combined).
function recomputeExplodeGeometry() {
  if (containers.size === 0) return;
  const box = new THREE.Box3();
  containers.forEach(entry => box.expandByPoint(entry.center));
  const center = box.getCenter(new THREE.Vector3());
  containers.forEach(entry => {
    entry.explodeDelta = entry.center.clone().sub(center).multiplyScalar(EXPLODE_FACTOR - 1);
  });
  if (explodeState.progress > 0) tickExplode(0); // re-apply immediately if mid-explode
}

// Refreshes counts/enabled-state of the shared controls after containers are
// added or removed, without resetting opacity/explode/category assignments.
function refreshContainerUI() {
  countEl.textContent = containers.size;
  resetAllBtn.disabled = containers.size === 0;
  document.getElementById('shuffleBtn').disabled = containers.size === 0;
  opacitySlider.disabled = containers.size === 0;
  explodeBtn.disabled = containers.size === 0;
  buildCategoryButtons();
  populateHighlightSelect();
  if (containers.size > 0) {
    emptyEl.style.display = 'none';
    hintEl.style.display = 'block';
  } else {
    emptyEl.style.display = 'flex';
    hintEl.style.display = 'none';
  }
  const mCount = manualCount();
  const base = loadedFileName ? `<b>${loadedFileName}</b>` : (containers.size ? '<b>Без IFC-файла</b>' : 'Файл не загружен');
  statusEl.innerHTML = containers.size
    ? `${base}<br>всего контейнеров: ${containers.size}${mCount ? ' · вручную: ' + mCount : ''}`
    : base;
}
let loadedFileName = null;

explodeBtn.onclick = () => {
  explodeState.target = explodeState.target === 0 ? 1 : 0;
  explodeBtn.textContent = explodeState.target === 1 ? 'Собрать обратно' : 'Разъехаться';
  explodeBtn.classList.toggle('on', explodeState.target === 1);
};

// ---------- manual layout (no IFC file needed) ----------
// Three 7x10 tables, numbered continuously 1-210, representing the SAME 7x10
// footprint stacked three tiers high (not three separate yard zones). Clicking
// a cell adds/removes a simple box container at that grid position.
const GRID_COLS = 7, GRID_ROWS = 10, GRID_TIERS = 3;
const C_WIDTH = 2438, C_LENGTH = 12192, C_HEIGHT = 2591; // 40ft container, mm
const GAP_X = 600, GAP_Z = 3000; // aisle gaps between columns / rows, mm
const manualGroup = new THREE.Group();
scene.add(manualGroup);
const manualOverlay = document.getElementById('manualOverlay');
const manualCountEl = document.getElementById('manualCount');
const manualCellBtns = new Map(); // cell number -> button element

function manualCount() {
  let n = 0;
  containers.forEach((_, key) => { if (typeof key === 'string') n++; });
  return n;
}

function cellToPosition(n) {
  const idx = n - 1;
  const tier = Math.floor(idx / (GRID_COLS * GRID_ROWS));
  const within = idx % (GRID_COLS * GRID_ROWS);
  const row = Math.floor(within / GRID_COLS);
  const col = within % GRID_COLS;
  const x = (col - (GRID_COLS - 1) / 2) * (C_WIDTH + GAP_X);
  const z = (row - (GRID_ROWS - 1) / 2) * (C_LENGTH + GAP_Z);
  const y = tier * C_HEIGHT + C_HEIGHT / 2;
  return new THREE.Vector3(x, y, z);
}

function addManualContainer(n) {
  const key = 'cell-' + n;
  if (containers.has(key)) return;
  const pos = cellToPosition(n);
  const geo = new THREE.BoxGeometry(C_WIDTH, C_HEIGHT, C_LENGTH);
  const mat = new THREE.MeshStandardMaterial({
    color: DEFAULT_COLOR, metalness: 0.15, roughness: 0.75,
    transparent: true, opacity: currentOpacity, depthWrite: currentOpacity >= 0.999,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const group = new THREE.Group();
  group.add(mesh);
  const label = makeLabelSprite(String(n));
  label.position.set(0, C_HEIGHT / 2 + C_WIDTH * 0.55, 0);
  label.visible = labelsVisible;
  group.add(label);
  group.position.copy(pos);
  manualGroup.add(group);
  const wasEmpty = containers.size === 0;
  containers.set(key, {
    meshes: [mesh], catIndex: Math.floor(Math.random() * CATEGORIES.length),
    group, center: pos.clone(), explodeDelta: null, basePosition: pos.clone(), isIfc: false, label,
    cellNumber: n,
  });
  recomputeExplodeGeometry();
  resetExplode();
  refreshContainerUI();
  if (wasEmpty) {
    const radius = Math.max(GRID_COLS * (C_WIDTH + GAP_X), GRID_ROWS * (C_LENGTH + GAP_Z)) * 0.6;
    camera.position.set(pos.x + radius, pos.y + radius * 0.8, pos.z + radius);
    camera.near = radius / 500; camera.far = radius * 50;
    camera.updateProjectionMatrix();
    controls.target.copy(pos);
    controls.update();
    startIdle();
  }
}

function removeManualContainer(n) {
  const key = 'cell-' + n;
  const entry = containers.get(key);
  if (!entry) return;
  entry.meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
  disposeLabel(entry.label);
  manualGroup.remove(entry.group);
  containers.delete(key);
  recomputeExplodeGeometry();
  resetExplode();
  refreshContainerUI();
}

function toggleManualCell(n) {
  const key = 'cell-' + n;
  if (containers.has(key)) removeManualContainer(n); else addManualContainer(n);
  const btn = manualCellBtns.get(n);
  if (btn) btn.classList.toggle('occ', containers.has(key));
  manualCountEl.textContent = 'Расставлено вручную: ' + manualCount();
}

function buildManualTables() {
  const wrap = document.getElementById('manualTables');
  wrap.innerHTML = '';
  const perTable = GRID_COLS * GRID_ROWS;
  for (let t = 0; t < GRID_TIERS; t++) {
    const block = document.createElement('div');
    block.className = 'tblock';
    const title = document.createElement('div');
    title.className = 'ttitle';
    const from = t * perTable + 1, to = (t + 1) * perTable;
    title.textContent = `Ярус ${t + 1} (${from}–${to})`;
    const grid = document.createElement('div');
    grid.className = 'tgrid';
    for (let n = from; n <= to; n++) {
      const btn = document.createElement('button');
      btn.className = 'cellbtn';
      btn.textContent = n;
      btn.onclick = () => toggleManualCell(n);
      manualCellBtns.set(n, btn);
      grid.appendChild(btn);
    }
    block.appendChild(title);
    block.appendChild(grid);
    wrap.appendChild(block);
  }
}
buildManualTables();

document.getElementById('manualBtn').onclick = () => manualOverlay.classList.add('show');
manualOverlay.addEventListener('click', (e) => { if (e.target === manualOverlay) manualOverlay.classList.remove('show'); });
document.getElementById('manualClear').onclick = () => {
  [...manualCellBtns.keys()].forEach(n => {
    if (containers.has('cell-' + n)) removeManualContainer(n);
    const btn = manualCellBtns.get(n);
    if (btn) btn.classList.remove('occ');
  });
  manualCountEl.textContent = 'Расставлено вручную: 0';
};

// ---------- IFC container visibility grid ----------
// A second set of 7x10x3 tables (same continuous 1-210 numbering, same "three
// tiers of one footprint" idea as the manual layout) but each cell maps to one
// specific container loaded from the IFC model, and clicking toggles whether
// that container is visible in the scene. For now cells are assigned in the
// order containers appear in the IFC file; a future iteration will drive this
// mapping from an external JSON payload instead of this positional default.
const ifcVisOverlay = document.getElementById('ifcVisOverlay');
const ifcVisBtn = document.getElementById('ifcVisBtn');
const ifcVisCountEl = document.getElementById('ifcVisCount');
const cellToExpressId = new Map(); // cell number (1..210) -> expressID, or absent if unmapped
const ifcCellBtns = new Map();     // cell number -> button element

function assignIfcCells() {
  cellToExpressId.clear();
  const maxCells = GRID_COLS * GRID_ROWS * GRID_TIERS;
  let n = 1;
  containers.forEach((entry, key) => {
    if (typeof key === 'number') {
      if (n <= maxCells) {
        cellToExpressId.set(n, key);
        entry.cellNumber = n;
        n++;
      } else {
        entry.cellNumber = null;
      }
    }
  });
}

function updateIfcVisCount() {
  let visible = 0;
  cellToExpressId.forEach(expId => {
    const entry = containers.get(expId);
    if (entry && entry.group.visible) visible++;
  });
  ifcVisCountEl.textContent = `Видно: ${visible} из ${cellToExpressId.size}`;
}

function refreshIfcCellBtn(n) {
  const btn = ifcCellBtns.get(n);
  if (!btn) return;
  const expId = cellToExpressId.get(n);
  btn.classList.remove('occ', 'hidden-cell', 'empty-cell');
  if (expId === undefined) {
    btn.classList.add('empty-cell');
    btn.disabled = true;
    btn.title = 'В модели нет контейнера с этим номером';
    return;
  }
  const entry = containers.get(expId);
  btn.disabled = false;
  if (entry && entry.group.visible) {
    btn.classList.add('occ');
    btn.title = 'Контейнер #' + expId + ' — виден, клик скроет';
  } else {
    btn.classList.add('hidden-cell');
    btn.title = 'Контейнер #' + expId + ' — скрыт, клик покажет';
  }
}

function toggleIfcVisibility(n) {
  const expId = cellToExpressId.get(n);
  if (expId === undefined) return;
  const entry = containers.get(expId);
  if (!entry) return;
  entry.group.visible = !entry.group.visible;
  refreshIfcCellBtn(n);
  updateIfcVisCount();
}

function buildIfcVisTables() {
  const wrap = document.getElementById('ifcVisTables');
  wrap.innerHTML = '';
  ifcCellBtns.clear();
  const perTable = GRID_COLS * GRID_ROWS;
  for (let t = 0; t < GRID_TIERS; t++) {
    const block = document.createElement('div');
    block.className = 'tblock';
    const title = document.createElement('div');
    title.className = 'ttitle';
    const from = t * perTable + 1, to = (t + 1) * perTable;
    title.textContent = `Ярус ${t + 1} (${from}–${to})`;
    const grid = document.createElement('div');
    grid.className = 'tgrid';
    for (let n = from; n <= to; n++) {
      const btn = document.createElement('button');
      btn.className = 'cellbtn';
      btn.textContent = n;
      btn.onclick = () => toggleIfcVisibility(n);
      ifcCellBtns.set(n, btn);
      grid.appendChild(btn);
      refreshIfcCellBtn(n);
    }
    block.appendChild(title);
    block.appendChild(grid);
    wrap.appendChild(block);
  }
  updateIfcVisCount();
}

ifcVisBtn.onclick = () => ifcVisOverlay.classList.add('show');
ifcVisOverlay.addEventListener('click', (e) => { if (e.target === ifcVisOverlay) ifcVisOverlay.classList.remove('show'); });

// Delegated close handling for every ".mclose" button (robust against any single
// overlay's own listener failing to attach) + Escape key closes whichever is open.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.mclose');
  if (!btn) return;
  const overlay = document.getElementById(btn.dataset.target);
  if (overlay) overlay.classList.remove('show');
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.show').forEach(el => {
    if (el.id === 'manualOverlay' || el.id === 'ifcVisOverlay') el.classList.remove('show');
  });
});
document.getElementById('ifcVisShowAll').onclick = () => {
  cellToExpressId.forEach((expId, n) => {
    const entry = containers.get(expId);
    if (entry) entry.group.visible = true;
    refreshIfcCellBtn(n);
  });
  updateIfcVisCount();
};
document.getElementById('ifcVisHideAll').onclick = () => {
  cellToExpressId.forEach((expId, n) => {
    const entry = containers.get(expId);
    if (entry) entry.group.visible = false;
    refreshIfcCellBtn(n);
  });
  updateIfcVisCount();
};

// ---------- geometry decoding ----------
// Revit's "TraceParts" containers reuse a handful of base shapes (IFCMAPPEDITEM)
// across all ~120 instances. getBaseGeometry() decodes each distinct shape out of
// the WASM heap only once (cached by geometryExpressID) instead of once per
// occurrence, and keeps it in its own local coordinates — the per-occurrence
// placement is applied afterwards as the Mesh's own position/rotation/scale, so
// the same BufferGeometry object (and its GPU buffer) is shared by every container
// that uses that shape. This cuts both the WASM->JS extraction work and GPU memory
// use roughly 120/7-fold for this model, which matters most on weaker machines.
function getBaseGeometry(ifcapi, modelID, geometryExpressID, cache) {
  const cached = cache.get(geometryExpressID);
  if (cached) return cached;
  const g = ifcapi.GetGeometry(modelID, geometryExpressID);
  const vData = ifcapi.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
  const iData = ifcapi.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
  const n = vData.length / 6;
  const pos = new Float32Array(n * 3);
  const norm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = vData[i * 6]; pos[i * 3 + 1] = vData[i * 6 + 1]; pos[i * 3 + 2] = vData[i * 6 + 2];
    norm[i * 3] = vData[i * 6 + 3]; norm[i * 3 + 1] = vData[i * 6 + 4]; norm[i * 3 + 2] = vData[i * 6 + 5];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  geo.setIndex(Array.from(iData));
  g.delete();
  cache.set(geometryExpressID, geo);
  return geo;
}

// ---------- number labels ----------
// Billboard sprite with the container's number, always facing the camera and
// unaffected by the opacity slider or status-category coloring, for legibility.
const LABEL_CANVAS_SIZE = [160, 80];
function makeLabelSprite(text, refSize) {
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_CANVAS_SIZE[0];
  canvas.height = LABEL_CANVAS_SIZE[1];
  const ctx = canvas.getContext('2d');
  ctx.font = '350 46px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4.5;
  ctx.strokeStyle = 'rgba(10,13,17,0.9)';
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: true });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 999; // always drawn on top, so the number stays readable even inside an opaque container
  // scale relative to the actual container's own size (falls back to the manual-grid
  // container width) so a label never dwarfs a container that's smaller than assumed
  const base = refSize || C_WIDTH;
  sprite.scale.set(base * 2.1, base * 1.05, 1);
  return sprite;
}
function disposeLabel(sprite) {
  if (!sprite) return;
  sprite.material.map.dispose();
  sprite.material.dispose();
}

function labelFor(ifcapi, modelID, expressID) {
  try {
    const line = ifcapi.GetLine(modelID, expressID);
    const tag = line.Tag && line.Tag.value;
    if (tag) return String(tag);
    const name = line.Name && line.Name.value;
    if (name) return name.split(':').pop();
  } catch (e) {}
  return String(expressID);
}

// ---------- model loading ----------
let modelGroup = null;

async function loadIfc(fileOrBytes, overrideName) {
  const isFileObj = typeof File !== 'undefined' && fileOrBytes instanceof File;
  const file = { name: overrideName || (isFileObj ? fileOrBytes.name : 'модель.ifc') };
  loadingEl.classList.add('show');
  emptyEl.style.display = 'none';
  loadingMsg.textContent = 'Запуск WebAssembly-движка…';
  statusEl.textContent = 'Загрузка…';
  gridEl.innerHTML = '';
  // drop only IFC-sourced containers (numeric keys); manually placed ones use
  // string keys ('cell-N') and persist across file reloads
  containers.forEach((entry, key) => {
    if (typeof key === 'number') {
      entry.meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
      disposeLabel(entry.label);
      containers.delete(key);
    }
  });
  if (modelGroup) { scene.remove(modelGroup); modelGroup = null; }

  const ifcapi = new WebIFC.IfcAPI();
  ifcapi.SetWasmPath('https://cdn.jsdelivr.net/npm/web-ifc@0.0.51/', true);
  await ifcapi.Init();

  loadingMsg.textContent = 'Чтение файла…';
  await new Promise(r => setTimeout(r, 10));
  const buffer = isFileObj ? new Uint8Array(await fileOrBytes.arrayBuffer()) : fileOrBytes;

  loadingMsg.textContent = 'Разбор геометрии модели…';
  await new Promise(r => setTimeout(r, 10));
  const modelID = ifcapi.OpenModel(buffer);

  modelGroup = new THREE.Group();
  const box = new THREE.Box3();
  let meshCount = 0;
  const geometryCache = new Map(); // geometryExpressID -> shared untransformed BufferGeometry (reset per file load)

  ifcapi.StreamAllMeshes(modelID, (flatMesh) => {
    const group = new THREE.Group();
    const meshes = [];
    const geoms = flatMesh.geometries;
    for (let i = 0; i < geoms.size(); i++) {
      const placed = geoms.get(i);
      const geo = getBaseGeometry(ifcapi, modelID, placed.geometryExpressID, geometryCache);
      const mat = new THREE.MeshStandardMaterial({
        color: DEFAULT_COLOR, metalness: 0.15, roughness: 0.75, side: THREE.DoubleSide,
        transparent: true, opacity: currentOpacity, depthWrite: currentOpacity >= 0.999,
      });
      const mesh = new THREE.Mesh(geo, mat);
      // this occurrence's own placement (translation/rotation/scale), kept on the
      // Mesh itself instead of baked into the (now shared) geometry
      new THREE.Matrix4().fromArray(placed.flatTransformation).decompose(mesh.position, mesh.quaternion, mesh.scale);
      group.add(mesh);
      meshes.push(mesh);
      meshCount++;
    }
    modelGroup.add(group);
    box.expandByObject(group);
    const groupBox = new THREE.Box3().setFromObject(group);
    const ctr = groupBox.getCenter(new THREE.Vector3());
    const sz = groupBox.getSize(new THREE.Vector3());
    // label is created afterwards, once each container has a table cell number assigned
    containers.set(flatMesh.expressID, {
      meshes, catIndex: 0, group, center: ctr, size: sz, explodeDelta: null,
      basePosition: new THREE.Vector3(0, 0, 0), isIfc: true, label: null,
    });
  });

  scene.add(modelGroup);

  // frame camera on model
  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.75 || 5000;
    camera.position.set(center.x + radius, center.y + radius * 0.8, center.z + radius);
    camera.near = radius / 500; camera.far = radius * 50;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
    startIdle();
  }
  recomputeExplodeGeometry();
  resetExplode();

  // randomly assign the newly loaded IFC containers to one of the 4 status
  // categories (manually placed containers keep whatever they already had)
  loadingMsg.textContent = 'Распределение контейнеров по статусам…';
  await new Promise(r => setTimeout(r, 10));
  containers.forEach(entry => {
    if (entry.isIfc) entry.catIndex = Math.floor(Math.random() * CATEGORIES.length);
  });

  opacitySlider.value = 100;
  opacityVal.textContent = '100%';
  applyOpacity(1);
  loadedFileName = file.name;
  refreshContainerUI();
  assignIfcCells();
  // build each IFC container's number label now that it has a table cell number;
  // placed at the container's own center so the number reads as if printed inside it
  containers.forEach(entry => {
    if (!entry.isIfc) return;
    disposeLabel(entry.label);
    entry.group.remove(...entry.group.children.filter(c => c.isSprite));
    const text = entry.cellNumber != null ? String(entry.cellNumber) : '—';
    // use the container's own smallest dimension as the size reference, so the
    // label scales with this specific container instead of the manual-grid constant
    const refSize = entry.size ? Math.max(1, Math.min(entry.size.x, entry.size.y, entry.size.z)) : undefined;
    const label = makeLabelSprite(text, refSize ? refSize * 0.8 : undefined);
    label.position.copy(entry.center);
    label.visible = labelShouldBeVisible(entry);
    entry.group.add(label);
    entry.label = label;
  });
  buildIfcVisTables();
  populateHighlightSelect();
  ifcVisBtn.disabled = cellToExpressId.size === 0;
  statusEl.innerHTML = `<b>${file.name}</b><br>контейнеров из IFC: ${containers.size - manualCount()} · мешей: ${meshCount}${manualCount() ? ' · вручную: ' + manualCount() : ''}`;
  hintEl.style.display = 'block';
  loadingEl.classList.remove('show');
}

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadIfc(file).catch(err => {
    loadingEl.classList.remove('show');
    statusEl.textContent = 'Ошибка загрузки файла';
    showError(err);
  });
});

// ---------- demo auto-load: pull the model + video from plain files sitting
// next to this HTML page on the same host, instead of embedding them ----------
const DEMO_IFC_URL = 'model.ifc';
const DEMO_VIDEO_URL = 'demo-video.mp4';
const DEMO_IFC_NAME = 'площадка_в_ревит1.ifc';

(async function tryAutoLoadDemoIfc() {
  loadingMsg.textContent = 'Загрузка демо-модели…';
  loadingEl.classList.add('show');
  emptyEl.style.display = 'none';
  let bytes;
  try {
    // no explicit cache mode: let the browser do normal HTTP caching/revalidation,
    // so a replaced model.ifc on the server is picked up instead of sticking forever.
    const resp = await fetch(DEMO_IFC_URL);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    bytes = new Uint8Array(await resp.arrayBuffer());
  } catch (err) {
    // genuinely couldn't fetch model.ifc (e.g. running the clean viewer locally,
    // with no demo file next to it) — fall back to the normal "choose a file" state, silently.
    loadingEl.classList.remove('show');
    emptyEl.style.display = 'flex';
    return;
  }
  // model.ifc WAS found — any error from here on is a real bug in parsing/building
  // the scene, so surface it instead of silently reverting to the empty state.
  await loadIfc(bytes, DEMO_IFC_NAME).catch(err => {
    loadingEl.classList.remove('show');
    statusEl.textContent = 'Ошибка загрузки демо-модели';
    showError(err);
  });
})();

(function tryAutoPlayDemoVideo() {
  const video = document.createElement('video');
  video.id = 'demoVideo';
  video.autoplay = true;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:none;';
  // read the ACTUAL dimensions of whatever video file got loaded and use that
  // as the pane's target aspect ratio, instead of the hardcoded fallback above —
  // so dropping in a differently-shaped demo-video.mp4 just works, no code change
  // needed. Skipped for now while FORCE_VIDEO_ASPECT pins the ratio to the current
  // letterboxed file's actual content area instead of its raw (16:9) frame size.
  video.addEventListener('loadedmetadata', () => {
    if (!FORCE_VIDEO_ASPECT && video.videoWidth > 0 && video.videoHeight > 0) {
      VIDEO_ASPECT_H_OVER_W = video.videoHeight / video.videoWidth;
      if (autoFitVideoHeight) applyVideoAspectFit();
    }
  });
  video.addEventListener('loadeddata', () => {
    video.style.display = 'block';
    videoPlaceholderEl.style.display = 'none';
    cameraCanvas.style.display = 'none';
  });
  video.addEventListener('error', () => {
    // no demo-video.mp4 next to the page — keep the placeholder canvas.
    video.remove();
  });
  video.src = DEMO_VIDEO_URL;
  videoPane.appendChild(video);
})();
