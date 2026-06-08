import { els, state } from './state.js';
import { saveState } from './canvas.js';
import { getActiveLayer, getActiveCtx, compositeLayers } from './layers.js';

const { canvas, container, statusEl } = els;

const gradientBtn = document.getElementById('gradient-btn');
const gradientPanel = document.getElementById('gradient-panel');
const gradientTypeBtns = gradientPanel.querySelectorAll('.gradient-type-btn');
const gradientColor2Input = document.getElementById('gradient-color2');
const gradientOpacityInput = document.getElementById('gradient-opacity');
const gradientOpacityValue = document.getElementById('gradient-opacity-value');

export function setGradientMode(active) {
  state.gradientMode = active;
  gradientBtn.classList.toggle('active', active);
  gradientPanel.classList.toggle('visible', active);
  container.classList.toggle('gradient-mode', active);
  if (active) {
    state.drawingMode = false;
    state.isDrawing = false;
    const drawBtnEl = document.getElementById('draw-btn');
    if (drawBtnEl) drawBtnEl.classList.remove('active');
    const drawPanelEl = document.getElementById('draw-panel');
    if (drawPanelEl) drawPanelEl.classList.remove('visible');
    container.classList.remove('select-mode');

    state.selectMode = false;
    state.selRect = null;
    const selectBtnEl = document.getElementById('select-btn');
    if (selectBtnEl) selectBtnEl.classList.remove('active');
    const selToolbar = document.getElementById('select-toolbar');
    if (selToolbar) selToolbar.classList.remove('visible');

    state.textMode = false;
    state.isTextEditing = false;
    const textBtnEl = document.getElementById('text-btn');
    if (textBtnEl) textBtnEl.classList.remove('active');
    container.classList.remove('text-mode');
    const textPanelEl = document.getElementById('text-panel');
    if (textPanelEl) textPanelEl.classList.remove('visible');

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

    state.shapeMode = false;
    state.isShaping = false;
    const shapeBtnEl = document.getElementById('shape-btn');
    if (shapeBtnEl) shapeBtnEl.classList.remove('active');
    const shapePanelEl = document.getElementById('shape-panel');
    if (shapePanelEl) shapePanelEl.classList.remove('visible');

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

    state.lassoMode = false;
    state.isLassoing = false;
    state.lassoPoints = [];
    const lassoBtnEl = document.getElementById('lasso-btn');
    if (lassoBtnEl) lassoBtnEl.classList.remove('active');
    container.classList.remove('lasso-mode');

    state.magicWandMode = false;
    state.wandMask = null;
    const wandBtnEl = document.getElementById('magicwand-btn');
    if (wandBtnEl) wandBtnEl.classList.remove('active');
    const wandPanelEl = document.getElementById('magicwand-panel');
    if (wandPanelEl) wandPanelEl.classList.remove('visible');
    container.classList.remove('magicwand-mode');
  }
  if (!active) {
    state.isGradient = false;
  }
}

gradientBtn.addEventListener('click', () => {
  if (state.layers.length === 0 && !state.currentImg) return;
  setGradientMode(!state.gradientMode);
});

gradientTypeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    state.gradientType = btn.dataset.type;
    gradientTypeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

gradientColor2Input.addEventListener('input', () => {
  state.gradientColor2 = gradientColor2Input.value;
});

gradientOpacityInput.addEventListener('input', () => {
  state.gradientOpacity = parseFloat(gradientOpacityInput.value);
  gradientOpacityValue.textContent = Math.round(state.gradientOpacity * 100) + '%';
});

function layerCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const layer = getActiveLayer();
  if (layer) {
    return {
      x: (clientX - rect.left) * layer.canvas.width / rect.width,
      y: (clientY - rect.top) * layer.canvas.height / rect.height,
    };
  }
  return {
    x: (clientX - rect.left) / (rect.width / canvas.width),
    y: (clientY - rect.top) / (rect.height / canvas.height),
  };
}

let _gradCtx = null;
let _startPos = null;
let _snapshot = null;

function captureSnapshot() {
  const layer = getActiveLayer();
  if (!layer) return;
  _snapshot = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
}

function restoreSnapshot() {
  const layer = getActiveLayer();
  if (!layer || !_snapshot) return;
  layer.ctx.putImageData(_snapshot, 0, 0);
}

canvas.addEventListener('mousedown', (e) => {
  if (!state.gradientMode || (state.layers.length === 0 && !state.currentImg) || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  beginGradient(e.clientX, e.clientY);
});

window.addEventListener('mousemove', (e) => {
  if (!state.isGradient) return;
  e.preventDefault();
  previewGradient(e.clientX, e.clientY);
});

window.addEventListener('mouseup', () => {
  if (state.isGradient) endGradient();
});

canvas.addEventListener('touchstart', (e) => {
  if (!state.gradientMode || (state.layers.length === 0 && !state.currentImg)) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  e.stopPropagation();
  beginGradient(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (!state.isGradient) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  previewGradient(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  if (state.isGradient && e.touches.length === 0) endGradient();
}, { passive: true });

function beginGradient(clientX, clientY) {
  state.isGradient = true;
  _gradCtx = getActiveCtx();
  _startPos = layerCoords(clientX, clientY);
  captureSnapshot();
}

function previewGradient(clientX, clientY) {
  if (!_gradCtx || !_startPos) return;
  restoreSnapshot();
  const endPos = layerCoords(clientX, clientY);
  drawGradient(_gradCtx, _startPos, endPos);
  drawPreviewLine(_startPos, endPos);
  compositeLayers();
}

function endGradient() {
  if (!_gradCtx || !_startPos) {
    state.isGradient = false;
    return;
  }
  state.isGradient = false;
  _gradCtx = null;
  _startPos = null;
  _snapshot = null;
  compositeLayers();
  saveState();
  const layer = getActiveLayer();
  if (layer) {
    statusEl.textContent = `${layer.canvas.width}×${layer.canvas.height} — ${state.gradientType} gradient applied`;
  }
}

function drawGradient(ctx, start, end) {
  const layer = getActiveLayer();
  if (!layer) return;
  const w = layer.canvas.width;
  const h = layer.canvas.height;

  let grad;
  if (state.gradientType === 'radial') {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    grad = ctx.createRadialGradient(start.x, start.y, 0, start.x, start.y, radius || 1);
  } else {
    grad = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
  }

  grad.addColorStop(0, state.brushColor);
  grad.addColorStop(1, state.gradientColor2);

  ctx.save();
  ctx.globalAlpha = state.gradientOpacity;
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawPreviewLine(start, end) {
  const displayCtx = els.ctx;
  const rect = canvas.getBoundingClientRect();
  const layer = getActiveLayer();
  if (!layer) return;

  const sx = start.x * rect.width / layer.canvas.width;
  const sy = start.y * rect.height / layer.canvas.height;
  const ex = end.x * rect.width / layer.canvas.width;
  const ey = end.y * rect.height / layer.canvas.height;

  displayCtx.save();
  displayCtx.setLineDash([6, 4]);
  displayCtx.strokeStyle = '#ffffff';
  displayCtx.lineWidth = 2;
  displayCtx.beginPath();
  displayCtx.moveTo(sx, sy);
  displayCtx.lineTo(ex, ey);
  displayCtx.stroke();

  displayCtx.strokeStyle = '#000000';
  displayCtx.lineWidth = 1;
  displayCtx.beginPath();
  displayCtx.moveTo(sx, sy);
  displayCtx.lineTo(ex, ey);
  displayCtx.stroke();
  displayCtx.setLineDash([]);

  drawEndpoint(displayCtx, sx, sy, state.brushColor);
  drawEndpoint(displayCtx, ex, ey, state.gradientColor2);
  displayCtx.restore();
}

function drawEndpoint(ctx, x, y, color) {
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.gradientMode) {
    if (state.isGradient) {
      restoreSnapshot();
      state.isGradient = false;
      _gradCtx = null;
      _startPos = null;
      _snapshot = null;
      compositeLayers();
    } else {
      setGradientMode(false);
    }
  }
  if (e.key === 'h' || e.key === 'H') {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (state.layers.length === 0 && !state.currentImg) return;
    e.preventDefault();
    setGradientMode(!state.gradientMode);
  }
});
