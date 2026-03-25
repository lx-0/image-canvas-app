// Freehand drawing tool — brush strokes on the canvas with undo/redo integration
import { els, state } from './state.js';
import { saveState, resizeAndDraw } from './canvas.js';

const { canvas, ctx, container, statusEl } = els;

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
  if (!state.currentImg) return;
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

// --- Coordinate conversion (screen -> canvas pixels) ---
function canvasCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / (rect.width / canvas.width),
    y: (clientY - rect.top) / (rect.height / canvas.height),
  };
}

// --- Mouse drawing ---
canvas.addEventListener('mousedown', (e) => {
  if (!state.drawingMode || !state.currentImg || e.button !== 0) return;
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
  if (!state.drawingMode || !state.currentImg) return;
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
function beginStroke(clientX, clientY) {
  state.isDrawing = true;
  const pos = canvasCoords(clientX, clientY);
  ctx.save();
  ctx.globalAlpha = state.brushOpacity;
  ctx.strokeStyle = state.brushColor;
  ctx.lineWidth = state.brushSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  // draw a dot for single click
  ctx.lineTo(pos.x + 0.1, pos.y + 0.1);
  ctx.stroke();
}

function continueStroke(clientX, clientY) {
  const pos = canvasCoords(clientX, clientY);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
}

function endStroke() {
  state.isDrawing = false;
  ctx.closePath();
  ctx.restore();
  // Snapshot canvas into currentImg and save to undo history
  const snapshot = new Image();
  snapshot.onload = () => {
    state.currentImg = snapshot;
    saveState();
    statusEl.textContent = `${snapshot.width}x${snapshot.height} — stroke drawn`;
  };
  snapshot.src = canvas.toDataURL('image/png');
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
    if (!state.currentImg) return;
    e.preventDefault();
    setDrawingMode(!state.drawingMode);
  }
});
