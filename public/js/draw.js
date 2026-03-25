// Freehand drawing tool — brush strokes on the active layer with undo/redo integration
import { els, state } from './state.js';
import { saveState, resizeAndDraw } from './canvas.js';
import { getActiveLayer, getActiveCtx, compositeLayers } from './layers.js';

const { canvas, container, statusEl } = els;

// --- Drawing panel DOM references ---
const drawBtn = document.getElementById('draw-btn');
const drawPanel = document.getElementById('draw-panel');
const brushSizeButtons = drawPanel.querySelectorAll('.brush-size-btn');
const colorSwatches = drawPanel.querySelectorAll('.color-swatch');
const colorCustomInput = document.getElementById('brush-color-custom');
const opacitySlider = document.getElementById('brush-opacity');
const opacityValue = document.getElementById('brush-opacity-value');

// --- Toggle drawing mode ---
export function setDrawingMode(active) {
  state.drawingMode = active;
  drawBtn.classList.toggle('active', active);
  drawPanel.classList.toggle('visible', active);
  container.classList.toggle('drawing-mode', active);
  if (active) {
    // Deactivate selection mode when entering drawing
    state.selectMode = false;
    state.selRect = null;
    const selectBtn = document.getElementById('select-btn');
    if (selectBtn) selectBtn.classList.remove('active');
    container.classList.remove('select-mode');
    const selToolbar = document.getElementById('select-toolbar');
    if (selToolbar) selToolbar.classList.remove('visible');
  }
  if (!active) {
    state.isDrawing = false;
  }
}

drawBtn.addEventListener('click', () => {
  if (state.layers.length === 0 && !state.currentImg) return;
  setDrawingMode(!state.drawingMode);
});

// --- Brush size ---
brushSizeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    state.brushSize = parseInt(btn.dataset.size, 10);
    brushSizeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// --- Color swatches ---
colorSwatches.forEach(swatch => {
  swatch.addEventListener('click', () => {
    state.brushColor = swatch.dataset.color;
    colorSwatches.forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    colorCustomInput.value = swatch.dataset.color;
  });
});

colorCustomInput.addEventListener('input', () => {
  state.brushColor = colorCustomInput.value;
  colorSwatches.forEach(s => s.classList.remove('active'));
});

// --- Opacity ---
opacitySlider.addEventListener('input', () => {
  state.brushOpacity = parseFloat(opacitySlider.value);
  opacityValue.textContent = Math.round(state.brushOpacity * 100) + '%';
});

// --- Coordinate conversion (screen -> active layer pixels) ---
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

// Scale brush size to layer resolution
function scaledBrushSize() {
  const layer = getActiveLayer();
  if (layer && canvas.width > 0) {
    return state.brushSize * (layer.canvas.width / canvas.width);
  }
  return state.brushSize;
}

// --- Mouse drawing ---
canvas.addEventListener('mousedown', (e) => {
  if (!state.drawingMode || (state.layers.length === 0 && !state.currentImg) || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  beginStroke(e.clientX, e.clientY);
});

window.addEventListener('mousemove', (e) => {
  if (!state.isDrawing) return;
  e.preventDefault();
  continueStroke(e.clientX, e.clientY);
});

window.addEventListener('mouseup', () => {
  if (state.isDrawing) endStroke();
});

// --- Touch drawing ---
canvas.addEventListener('touchstart', (e) => {
  if (!state.drawingMode || (state.layers.length === 0 && !state.currentImg)) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  e.stopPropagation();
  beginStroke(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (!state.isDrawing) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  continueStroke(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  if (state.isDrawing && e.touches.length === 0) endStroke();
}, { passive: true });

// --- Stroke lifecycle ---
let _strokeCtx = null;

function beginStroke(clientX, clientY) {
  state.isDrawing = true;
  _strokeCtx = getActiveCtx();
  const pos = layerCoords(clientX, clientY);
  _strokeCtx.save();
  _strokeCtx.globalAlpha = state.brushOpacity;
  _strokeCtx.strokeStyle = state.brushColor;
  _strokeCtx.lineWidth = scaledBrushSize();
  _strokeCtx.lineCap = 'round';
  _strokeCtx.lineJoin = 'round';
  _strokeCtx.beginPath();
  _strokeCtx.moveTo(pos.x, pos.y);
  // draw a dot for single click
  _strokeCtx.lineTo(pos.x + 0.1, pos.y + 0.1);
  _strokeCtx.stroke();
  compositeLayers();
}

function continueStroke(clientX, clientY) {
  if (!_strokeCtx) return;
  const pos = layerCoords(clientX, clientY);
  _strokeCtx.lineTo(pos.x, pos.y);
  _strokeCtx.stroke();
  compositeLayers();
}

function endStroke() {
  state.isDrawing = false;
  if (_strokeCtx) {
    _strokeCtx.closePath();
    _strokeCtx.restore();
    _strokeCtx = null;
  }
  compositeLayers();
  saveState();
  const layer = getActiveLayer();
  if (layer) {
    statusEl.textContent = `${layer.canvas.width}\u00D7${layer.canvas.height} \u2014 stroke drawn`;
  }
}

// --- Escape to exit drawing mode ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.drawingMode) {
    setDrawingMode(false);
  }
  // Toggle with D key when not typing
  if (e.key === 'd' || e.key === 'D') {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (state.layers.length === 0 && !state.currentImg) return;
    e.preventDefault();
    setDrawingMode(!state.drawingMode);
  }
});
