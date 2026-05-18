import { els, state } from './state.js';
import { saveState, resizeAndDraw } from './canvas.js';
import { getActiveLayer, getActiveCtx, compositeLayers } from './layers.js';
import { executeCrop } from './filters.js';

const { canvas, ctx, container, statusEl } = els;

const lassoBtn = document.getElementById('lasso-btn');
const selToolbar = document.getElementById('select-toolbar');
const selDims = document.getElementById('select-dims');
const selCropBtn = document.getElementById('select-crop-btn');
const selDeleteBtn = document.getElementById('select-delete-btn');
const selCopyBtn = document.getElementById('select-copy-btn');
const selCancelBtn = document.getElementById('select-cancel-btn');

export function setLassoMode(active) {
  state.lassoMode = active;
  lassoBtn.classList.toggle('active', active);
  container.classList.toggle('lasso-mode', active);
  if (active) {
    state.drawingMode = false;
    state.isDrawing = false;
    const drawBtnEl = document.getElementById('draw-btn');
    if (drawBtnEl) drawBtnEl.classList.remove('active');
    const drawPanelEl = document.getElementById('draw-panel');
    if (drawPanelEl) drawPanelEl.classList.remove('visible');
    container.classList.remove('drawing-mode');

    state.selectMode = false;
    state.selRect = null;
    const selectBtnEl = document.getElementById('select-btn');
    if (selectBtnEl) selectBtnEl.classList.remove('active');
    container.classList.remove('select-mode');
    selToolbar.classList.remove('visible');

    state.textMode = false;
    state.isTextEditing = false;
    const textBtnEl = document.getElementById('text-btn');
    if (textBtnEl) textBtnEl.classList.remove('active');
    container.classList.remove('text-mode');
    const textPanelEl = document.getElementById('text-panel');
    if (textPanelEl) textPanelEl.classList.remove('visible');

    state.shapeMode = false;
    state.isShaping = false;
    const shapeBtnEl = document.getElementById('shape-btn');
    if (shapeBtnEl) shapeBtnEl.classList.remove('active');
    const shapePanelEl = document.getElementById('shape-panel');
    if (shapePanelEl) shapePanelEl.classList.remove('visible');

    state.eyedropperMode = false;
    const eyedropperBtnEl = document.getElementById('eyedropper-btn');
    if (eyedropperBtnEl) eyedropperBtnEl.classList.remove('active');
    container.classList.remove('eyedropper-mode');

    state.eraserMode = false;
    state.isErasing = false;
    const eraserBtnEl = document.getElementById('eraser-btn');
    if (eraserBtnEl) eraserBtnEl.classList.remove('active');
    const eraserPanelEl = document.getElementById('eraser-panel');
    if (eraserPanelEl) eraserPanelEl.classList.remove('visible');
    container.classList.remove('eraser-mode');

    state.floodFillMode = false;
    const floodfillBtnEl = document.getElementById('floodfill-btn');
    if (floodfillBtnEl) floodfillBtnEl.classList.remove('active');
    const floodfillPanelEl = document.getElementById('floodfill-panel');
    if (floodfillPanelEl) floodfillPanelEl.classList.remove('visible');
    container.classList.remove('floodfill-mode');

    state.cropMode = false;
    const cropBtnEl = document.getElementById('crop-btn');
    if (cropBtnEl) cropBtnEl.classList.remove('active');
    const cropPanelEl = document.getElementById('crop-panel');
    if (cropPanelEl) cropPanelEl.classList.remove('visible');
    container.classList.remove('crop-mode');

    state.magicWandMode = false;
    state.wandMask = null;
    const wandBtnEl = document.getElementById('magicwand-btn');
    if (wandBtnEl) wandBtnEl.classList.remove('active');
    const wandPanelEl = document.getElementById('magicwand-panel');
    if (wandPanelEl) wandPanelEl.classList.remove('visible');
    container.classList.remove('magicwand-mode');
  }
  if (!active) {
    clearLassoSelection();
  }
}

function clearLassoSelection() {
  state.isLassoing = false;
  state.lassoPoints = [];
  selToolbar.classList.remove('visible');
  if (state.layers.length > 0 || state.currentImg) {
    resizeAndDraw();
  }
}

lassoBtn.addEventListener('click', () => {
  if (state.layers.length === 0 && !state.currentImg) return;
  setLassoMode(!state.lassoMode);
});

function canvasCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / (rect.width / canvas.width),
    y: (clientY - rect.top) / (rect.height / canvas.height),
  };
}

function drawLassoOverlay() {
  const points = state.lassoPoints;
  if (!points || points.length < 3) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = points.length - 1; i >= 0; i--) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.clip('evenodd');
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineDashOffset = 5;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawLassoPreview() {
  const points = state.lassoPoints;
  if (!points || points.length < 2) return;

  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineDashOffset = 4;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

function getLassoBounds() {
  const points = state.lassoPoints;
  if (!points || points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function hasLassoSelection() {
  return state.lassoMode && state.lassoPoints.length > 10;
}

function updateLassoUI() {
  const bounds = getLassoBounds();
  if (!bounds || bounds.w < 2 || bounds.h < 2) return;

  let scaleX = 1, scaleY = 1;
  if (state.layers.length > 0) {
    scaleX = state.layers[0].canvas.width / canvas.width;
    scaleY = state.layers[0].canvas.height / canvas.height;
  }
  selDims.textContent = `${Math.round(bounds.w * scaleX)} × ${Math.round(bounds.h * scaleY)} px`;

  const rect = canvas.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const screenX = rect.left + (bounds.x / canvas.width) * rect.width;
  const screenY = rect.top + (bounds.y / canvas.height) * rect.height;

  let toolbarLeft = screenX - containerRect.left;
  let toolbarTop = screenY - containerRect.top - selToolbar.offsetHeight - 8;

  if (toolbarTop < 0) {
    const belowY = rect.top + ((bounds.y + bounds.h) / canvas.height) * rect.height;
    toolbarTop = belowY - containerRect.top + 8;
  }

  toolbarLeft = Math.max(4, Math.min(toolbarLeft, containerRect.width - selToolbar.offsetWidth - 4));
  toolbarTop = Math.max(4, Math.min(toolbarTop, containerRect.height - selToolbar.offsetHeight - 4));

  selToolbar.style.left = toolbarLeft + 'px';
  selToolbar.style.top = toolbarTop + 'px';
  selToolbar.classList.add('visible');
}

// --- Mouse events ---
canvas.addEventListener('mousedown', (e) => {
  if (!state.lassoMode || (state.layers.length === 0 && !state.currentImg) || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  state.isLassoing = true;
  state.lassoPoints = [canvasCoords(e.clientX, e.clientY)];
  selToolbar.classList.remove('visible');
});

window.addEventListener('mousemove', (e) => {
  if (!state.isLassoing) return;
  e.preventDefault();
  const pos = canvasCoords(e.clientX, e.clientY);
  pos.x = Math.max(0, Math.min(canvas.width, pos.x));
  pos.y = Math.max(0, Math.min(canvas.height, pos.y));
  state.lassoPoints.push(pos);
  resizeAndDraw();
  drawLassoPreview();
});

window.addEventListener('mouseup', () => {
  if (!state.isLassoing) return;
  state.isLassoing = false;
  if (state.lassoPoints.length > 10) {
    resizeAndDraw();
    drawLassoOverlay();
    updateLassoUI();
  } else {
    clearLassoSelection();
  }
});

// --- Touch events ---
canvas.addEventListener('touchstart', (e) => {
  if (!state.lassoMode || (state.layers.length === 0 && !state.currentImg)) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  e.stopPropagation();
  state.isLassoing = true;
  state.lassoPoints = [canvasCoords(e.touches[0].clientX, e.touches[0].clientY)];
  selToolbar.classList.remove('visible');
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (!state.isLassoing || e.touches.length !== 1) return;
  e.preventDefault();
  const pos = canvasCoords(e.touches[0].clientX, e.touches[0].clientY);
  pos.x = Math.max(0, Math.min(canvas.width, pos.x));
  pos.y = Math.max(0, Math.min(canvas.height, pos.y));
  state.lassoPoints.push(pos);
  resizeAndDraw();
  drawLassoPreview();
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  if (!state.isLassoing || e.touches.length > 0) return;
  state.isLassoing = false;
  if (state.lassoPoints.length > 10) {
    resizeAndDraw();
    drawLassoOverlay();
    updateLassoUI();
  } else {
    clearLassoSelection();
  }
}, { passive: true });

// --- Layer coordinate helpers ---
function getLassoLayerPoints() {
  const layer = getActiveLayer();
  if (!layer) return state.lassoPoints;
  const scaleX = layer.canvas.width / canvas.width;
  const scaleY = layer.canvas.height / canvas.height;
  return state.lassoPoints.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
}

function applyLassoClip(targetCtx, points) {
  targetCtx.beginPath();
  targetCtx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    targetCtx.lineTo(points[i].x, points[i].y);
  }
  targetCtx.closePath();
  targetCtx.clip();
}

// --- Selection actions ---
function cropToLasso() {
  const bounds = getLassoBounds();
  if (!bounds) return;

  const cmd = {
    action: 'crop',
    x: (bounds.x / canvas.width) * 100,
    y: (bounds.y / canvas.height) * 100,
    width: (bounds.w / canvas.width) * 100,
    height: (bounds.h / canvas.height) * 100,
  };

  if (state.layers.length > 0) {
    for (const layer of state.layers) {
      executeCrop(cmd, layer.canvas, layer.ctx);
    }
    compositeLayers();
    resizeAndDraw();
    saveState();
    const ref = state.layers[0].canvas;
    statusEl.textContent = `${ref.width}×${ref.height} cropped`;
  }
  setLassoMode(false);
}

function deleteLassoSelection() {
  const layer = getActiveLayer();
  if (!layer) return;

  const layerPoints = getLassoLayerPoints();
  const layerCtx = getActiveCtx();

  layerCtx.save();
  applyLassoClip(layerCtx, layerPoints);
  layerCtx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  layerCtx.restore();

  compositeLayers();
  resizeAndDraw();
  saveState();
  statusEl.textContent = 'Selection deleted';
  setLassoMode(false);
}

async function copyLassoSelection() {
  const layer = getActiveLayer();
  if (!layer) return;

  const layerPoints = getLassoLayerPoints();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of layerPoints) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  minX = Math.max(0, Math.floor(minX));
  minY = Math.max(0, Math.floor(minY));
  maxX = Math.min(layer.canvas.width, Math.ceil(maxX));
  maxY = Math.min(layer.canvas.height, Math.ceil(maxY));
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return;

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = w;
  tmpCanvas.height = h;
  const tmpCtx = tmpCanvas.getContext('2d');

  const shifted = layerPoints.map(p => ({ x: p.x - minX, y: p.y - minY }));
  tmpCtx.save();
  applyLassoClip(tmpCtx, shifted);
  tmpCtx.drawImage(layer.canvas, minX, minY, w, h, 0, 0, w, h);
  tmpCtx.restore();

  try {
    const blob = await new Promise(resolve => tmpCanvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    statusEl.textContent = 'Selection copied';
  } catch (_err) {
    statusEl.textContent = 'Copy failed';
  }
}

// --- Toolbar button handlers ---
selCropBtn.addEventListener('click', () => {
  if (hasLassoSelection()) cropToLasso();
});

selDeleteBtn.addEventListener('click', () => {
  if (hasLassoSelection()) deleteLassoSelection();
});

selCopyBtn.addEventListener('click', () => {
  if (hasLassoSelection()) copyLassoSelection();
});

selCancelBtn.addEventListener('click', () => {
  if (state.lassoMode) setLassoMode(false);
});

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.lassoMode) {
    setLassoMode(false);
    return;
  }
  if (e.key === 'Enter' && hasLassoSelection()) {
    cropToLasso();
    return;
  }
  if (e.key === 'Delete' && hasLassoSelection()) {
    deleteLassoSelection();
    return;
  }
  if (e.key === 'l' || e.key === 'L') {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (state.layers.length === 0 && !state.currentImg) return;
    e.preventDefault();
    setLassoMode(!state.lassoMode);
  }
});
