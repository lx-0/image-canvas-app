// Shape annotation tools — rectangle, circle/ellipse, line, arrow on the active layer
import { els, state } from './state.js';
import { saveState } from './canvas.js';
import { getActiveLayer, getActiveCtx, compositeLayers } from './layers.js';

const { canvas, container, statusEl } = els;

const shapeBtn = document.getElementById('shape-btn');
const shapePanel = document.getElementById('shape-panel');
const shapeTypeBtns = shapePanel.querySelectorAll('.shape-type-btn');
const shapeFillToggle = document.getElementById('shape-fill-toggle');

// --- Toggle shape mode ---
export function setShapeMode(active) {
  state.shapeMode = active;
  shapeBtn.classList.toggle('active', active);
  shapePanel.classList.toggle('visible', active);
  container.classList.toggle('drawing-mode', active);
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
    // Deactivate eraser
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

    state.gradientMode = false;
    state.isGradient = false;
    const gradientBtnEl = document.getElementById('gradient-btn');
    if (gradientBtnEl) gradientBtnEl.classList.remove('active');
    const gradientPanelEl = document.getElementById('gradient-panel');
    if (gradientPanelEl) gradientPanelEl.classList.remove('visible');
    container.classList.remove('gradient-mode');
  }
  if (!active) {
    state.isShaping = false;
  }
}

shapeBtn.addEventListener('click', () => {
  if (state.layers.length === 0 && !state.currentImg) return;
  setShapeMode(!state.shapeMode);
});

// --- Shape type selector ---
shapeTypeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    state.shapeType = btn.dataset.shape;
    shapeTypeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// --- Fill toggle ---
shapeFillToggle.addEventListener('change', () => {
  state.shapeFill = shapeFillToggle.checked;
});

// --- Coordinate conversion (same as draw.js) ---
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

function scaledBrushSize() {
  const layer = getActiveLayer();
  if (layer && canvas.width > 0) {
    return state.brushSize * (layer.canvas.width / canvas.width);
  }
  return state.brushSize;
}

// --- Shape drawing state ---
let _shapeCtx = null;
let _startPos = null;
let _snapshot = null;
let _shiftHeld = false;

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

// --- Mouse events ---
canvas.addEventListener('mousedown', (e) => {
  if (!state.shapeMode || (state.layers.length === 0 && !state.currentImg) || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  beginShape(e.clientX, e.clientY, e.shiftKey);
});

window.addEventListener('mousemove', (e) => {
  if (!state.isShaping) return;
  e.preventDefault();
  _shiftHeld = e.shiftKey;
  previewShape(e.clientX, e.clientY);
});

window.addEventListener('mouseup', () => {
  if (state.isShaping) endShape();
});

// --- Touch events ---
canvas.addEventListener('touchstart', (e) => {
  if (!state.shapeMode || (state.layers.length === 0 && !state.currentImg)) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  e.stopPropagation();
  beginShape(e.touches[0].clientX, e.touches[0].clientY, false);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (!state.isShaping) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  previewShape(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  if (state.isShaping && e.touches.length === 0) endShape();
}, { passive: true });

// --- Shape lifecycle ---
function beginShape(clientX, clientY, shiftKey) {
  state.isShaping = true;
  _shapeCtx = getActiveCtx();
  _startPos = layerCoords(clientX, clientY);
  _shiftHeld = shiftKey;
  captureSnapshot();
}

function previewShape(clientX, clientY) {
  if (!_shapeCtx || !_startPos) return;
  restoreSnapshot();
  const endPos = layerCoords(clientX, clientY);
  drawShape(_shapeCtx, _startPos, endPos, _shiftHeld);
  compositeLayers();
}

function endShape() {
  state.isShaping = false;
  _shapeCtx = null;
  _startPos = null;
  _snapshot = null;
  _shiftHeld = false;
  compositeLayers();
  saveState();
  const layer = getActiveLayer();
  if (layer) {
    statusEl.textContent = `${layer.canvas.width}\u00D7${layer.canvas.height} \u2014 ${state.shapeType} drawn`;
  }
}

// --- Draw a shape on ctx ---
function drawShape(ctx, start, end, constrain) {
  const lineWidth = scaledBrushSize();
  ctx.save();
  ctx.globalAlpha = state.brushOpacity;
  ctx.strokeStyle = state.brushColor;
  ctx.fillStyle = state.brushColor;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (state.shapeType) {
    case 'rect':
      drawRect(ctx, start, end, constrain);
      break;
    case 'circle':
      drawEllipse(ctx, start, end, constrain);
      break;
    case 'line':
      drawLine(ctx, start, end, constrain);
      break;
    case 'arrow':
      drawArrow(ctx, start, end, constrain, lineWidth);
      break;
  }

  ctx.restore();
}

function drawRect(ctx, start, end, constrain) {
  let w = end.x - start.x;
  let h = end.y - start.y;
  if (constrain) {
    const side = Math.max(Math.abs(w), Math.abs(h));
    w = side * Math.sign(w);
    h = side * Math.sign(h);
  }
  ctx.beginPath();
  ctx.rect(start.x, start.y, w, h);
  if (state.shapeFill) {
    ctx.fill();
  }
  ctx.stroke();
}

function drawEllipse(ctx, start, end, constrain) {
  let w = end.x - start.x;
  let h = end.y - start.y;
  if (constrain) {
    const side = Math.max(Math.abs(w), Math.abs(h));
    w = side * Math.sign(w);
    h = side * Math.sign(h);
  }
  const cx = start.x + w / 2;
  const cy = start.y + h / 2;
  const rx = Math.abs(w) / 2;
  const ry = Math.abs(h) / 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx || 0.1, ry || 0.1, 0, 0, Math.PI * 2);
  if (state.shapeFill) {
    ctx.fill();
  }
  ctx.stroke();
}

function drawLine(ctx, start, end, constrain) {
  let ex = end.x;
  let ey = end.y;
  if (constrain) {
    const snapped = snapAngle(start, end);
    ex = snapped.x;
    ey = snapped.y;
  }
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
}

function drawArrow(ctx, start, end, constrain, lineWidth) {
  let ex = end.x;
  let ey = end.y;
  if (constrain) {
    const snapped = snapAngle(start, end);
    ex = snapped.x;
    ey = snapped.y;
  }
  const dx = ex - start.x;
  const dy = ey - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  const headLen = Math.max(lineWidth * 4, 12);
  const angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - headLen * Math.cos(angle - Math.PI / 6), ey - headLen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - headLen * Math.cos(angle + Math.PI / 6), ey - headLen * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

function snapAngle(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const dist = Math.sqrt(dx * dx + dy * dy);
  return {
    x: start.x + dist * Math.cos(snapped),
    y: start.y + dist * Math.sin(snapped),
  };
}

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.shapeMode) {
    if (state.isShaping) {
      restoreSnapshot();
      state.isShaping = false;
      _shapeCtx = null;
      _startPos = null;
      _snapshot = null;
      compositeLayers();
    } else {
      setShapeMode(false);
    }
  }
  if (e.key === 'g' || e.key === 'G') {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (state.layers.length === 0 && !state.currentImg) return;
    e.preventDefault();
    setShapeMode(!state.shapeMode);
  }
});
