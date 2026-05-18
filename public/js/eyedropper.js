// Eyedropper tool — sample pixel color from the composited display canvas
import { els, state } from './state.js';

const { canvas, ctx, container, statusEl } = els;

const eyedropperBtn = document.getElementById('eyedropper-btn');
const hexDisplay = document.getElementById('eyedropper-hex');

let _loupeCanvas = null;
let _loupeCtx = null;

// --- Toggle eyedropper mode ---
export function setEyedropperMode(active) {
  state.eyedropperMode = active;
  eyedropperBtn.classList.toggle('active', active);
  container.classList.toggle('eyedropper-mode', active);
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
    const selToolbar = document.getElementById('select-toolbar');
    if (selToolbar) selToolbar.classList.remove('visible');

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
  }
  if (!active) {
    hideLoupe();
  }
}

eyedropperBtn.addEventListener('click', () => {
  if (state.layers.length === 0 && !state.currentImg) return;
  setEyedropperMode(!state.eyedropperMode);
});

// --- Canvas coordinate from client position ---
function canvasPixel(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.round((clientX - rect.left) * canvas.width / rect.width),
    y: Math.round((clientY - rect.top) * canvas.height / rect.height),
  };
}

// --- Sample color at canvas pixel ---
function sampleColor(px, py) {
  const x = Math.max(0, Math.min(canvas.width - 1, px));
  const y = Math.max(0, Math.min(canvas.height - 1, py));
  const pixel = ctx.getImageData(x, y, 1, 1).data;
  return {
    r: pixel[0],
    g: pixel[1],
    b: pixel[2],
    hex: '#' + ((1 << 24) | (pixel[0] << 16) | (pixel[1] << 8) | pixel[2]).toString(16).slice(1),
  };
}

// --- Apply sampled color to brush ---
function applyColor(color) {
  state.brushColor = color.hex;
  const customInput = document.getElementById('brush-color-custom');
  if (customInput) customInput.value = color.hex;
  const swatches = document.querySelectorAll('.color-swatch');
  swatches.forEach(s => {
    s.classList.toggle('active', s.dataset.color === color.hex);
  });
  if (hexDisplay) hexDisplay.textContent = color.hex;
  statusEl.textContent = `Color sampled: ${color.hex}`;
}

// --- Loupe (magnified preview) ---
function ensureLoupe() {
  if (_loupeCanvas) return;
  _loupeCanvas = document.createElement('canvas');
  _loupeCanvas.id = 'eyedropper-loupe';
  _loupeCanvas.width = 120;
  _loupeCanvas.height = 120;
  container.appendChild(_loupeCanvas);
  _loupeCtx = _loupeCanvas.getContext('2d');
}

function showLoupe(clientX, clientY, px, py) {
  ensureLoupe();
  _loupeCanvas.style.display = 'block';

  const containerRect = container.getBoundingClientRect();
  let left = clientX - containerRect.left + 20;
  let top = clientY - containerRect.top - 60;
  if (left + 130 > containerRect.width) left = clientX - containerRect.left - 140;
  if (top < 0) top = clientY - containerRect.top + 20;
  _loupeCanvas.style.left = left + 'px';
  _loupeCanvas.style.top = top + 'px';

  const zoom = 8;
  const srcSize = Math.floor(_loupeCanvas.width / zoom);
  const sx = Math.max(0, px - Math.floor(srcSize / 2));
  const sy = Math.max(0, py - Math.floor(srcSize / 2));

  _loupeCtx.imageSmoothingEnabled = false;
  _loupeCtx.clearRect(0, 0, _loupeCanvas.width, _loupeCanvas.height);
  _loupeCtx.drawImage(canvas, sx, sy, srcSize, srcSize, 0, 0, _loupeCanvas.width, _loupeCanvas.height);

  // Crosshair
  const center = _loupeCanvas.width / 2;
  _loupeCtx.strokeStyle = '#fff';
  _loupeCtx.lineWidth = 1;
  _loupeCtx.strokeRect(center - zoom / 2, center - zoom / 2, zoom, zoom);

  // Color swatch at bottom
  const color = sampleColor(px, py);
  _loupeCtx.fillStyle = color.hex;
  _loupeCtx.fillRect(0, _loupeCanvas.height - 20, _loupeCanvas.width, 20);
  _loupeCtx.fillStyle = '#fff';
  _loupeCtx.font = '11px monospace';
  _loupeCtx.textAlign = 'center';
  _loupeCtx.fillText(color.hex, center, _loupeCanvas.height - 6);
}

function hideLoupe() {
  if (_loupeCanvas) {
    _loupeCanvas.style.display = 'none';
  }
}

// --- Mouse events ---
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;

  // Alt+click from any tool
  if (e.altKey && !state.eyedropperMode) {
    if (state.layers.length === 0 && !state.currentImg) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = canvasPixel(e.clientX, e.clientY);
    const color = sampleColor(pos.x, pos.y);
    applyColor(color);
    return;
  }

  if (!state.eyedropperMode || (state.layers.length === 0 && !state.currentImg)) return;
  e.preventDefault();
  e.stopPropagation();
  const pos = canvasPixel(e.clientX, e.clientY);
  const color = sampleColor(pos.x, pos.y);
  applyColor(color);
});

canvas.addEventListener('mousemove', (e) => {
  if (!state.eyedropperMode) return;
  if (state.layers.length === 0 && !state.currentImg) return;
  const pos = canvasPixel(e.clientX, e.clientY);
  showLoupe(e.clientX, e.clientY, pos.x, pos.y);
});

canvas.addEventListener('mouseleave', () => {
  if (state.eyedropperMode) hideLoupe();
});

// --- Touch events ---
canvas.addEventListener('touchstart', (e) => {
  if (!state.eyedropperMode || (state.layers.length === 0 && !state.currentImg)) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  const pos = canvasPixel(e.touches[0].clientX, e.touches[0].clientY);
  const color = sampleColor(pos.x, pos.y);
  applyColor(color);
}, { passive: false });

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.eyedropperMode) {
    setEyedropperMode(false);
  }
  if (e.key === 'i' || e.key === 'I') {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (state.layers.length === 0 && !state.currentImg) return;
    e.preventDefault();
    setEyedropperMode(!state.eyedropperMode);
  }
});
