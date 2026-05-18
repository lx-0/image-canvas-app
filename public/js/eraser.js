import { els, state } from './state.js';
import { saveState } from './canvas.js';
import { getActiveLayer, getActiveCtx, compositeLayers } from './layers.js';

const { canvas, container, statusEl } = els;

const eraserBtn = document.getElementById('eraser-btn');
const eraserPanel = document.getElementById('eraser-panel');
const eraserSizeButtons = eraserPanel.querySelectorAll('.eraser-size-btn');
const eraserOpacitySlider = document.getElementById('eraser-opacity');
const eraserOpacityValue = document.getElementById('eraser-opacity-value');

export function setEraserMode(active) {
  state.eraserMode = active;
  eraserBtn.classList.toggle('active', active);
  eraserPanel.classList.toggle('visible', active);
  container.classList.toggle('eraser-mode', active);
  if (active) {
    state.drawingMode = false;
    const drawBtn = document.getElementById('draw-btn');
    if (drawBtn) drawBtn.classList.remove('active');
    const drawPanel = document.getElementById('draw-panel');
    if (drawPanel) drawPanel.classList.remove('visible');
    container.classList.remove('drawing-mode');

    state.selectMode = false;
    state.selRect = null;
    const selectBtn = document.getElementById('select-btn');
    if (selectBtn) selectBtn.classList.remove('active');
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

    state.eyedropperMode = false;
    const eyedropperBtnEl = document.getElementById('eyedropper-btn');
    if (eyedropperBtnEl) eyedropperBtnEl.classList.remove('active');
    container.classList.remove('eyedropper-mode');

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
    state.isErasing = false;
  }
}

eraserBtn.addEventListener('click', () => {
  if (state.layers.length === 0 && !state.currentImg) return;
  setEraserMode(!state.eraserMode);
});

eraserSizeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    state.eraserSize = parseInt(btn.dataset.size, 10);
    eraserSizeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

eraserOpacitySlider.addEventListener('input', () => {
  state.eraserOpacity = parseFloat(eraserOpacitySlider.value);
  eraserOpacityValue.textContent = Math.round(state.eraserOpacity * 100) + '%';
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

function scaledEraserSize() {
  const layer = getActiveLayer();
  if (layer && canvas.width > 0) {
    return state.eraserSize * (layer.canvas.width / canvas.width);
  }
  return state.eraserSize;
}

canvas.addEventListener('mousedown', (e) => {
  if (!state.eraserMode || (state.layers.length === 0 && !state.currentImg) || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  beginErase(e.clientX, e.clientY);
});

window.addEventListener('mousemove', (e) => {
  if (!state.isErasing) return;
  e.preventDefault();
  continueErase(e.clientX, e.clientY);
});

window.addEventListener('mouseup', () => {
  if (state.isErasing) endErase();
});

canvas.addEventListener('touchstart', (e) => {
  if (!state.eraserMode || (state.layers.length === 0 && !state.currentImg)) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  e.stopPropagation();
  beginErase(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (!state.isErasing) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  continueErase(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  if (state.isErasing && e.touches.length === 0) endErase();
}, { passive: true });

let _eraseCtx = null;

function beginErase(clientX, clientY) {
  state.isErasing = true;
  _eraseCtx = getActiveCtx();
  const pos = layerCoords(clientX, clientY);
  _eraseCtx.save();
  _eraseCtx.globalAlpha = state.eraserOpacity;
  _eraseCtx.globalCompositeOperation = 'destination-out';
  _eraseCtx.strokeStyle = 'rgba(0,0,0,1)';
  _eraseCtx.lineWidth = scaledEraserSize();
  _eraseCtx.lineCap = 'round';
  _eraseCtx.lineJoin = 'round';
  _eraseCtx.beginPath();
  _eraseCtx.moveTo(pos.x, pos.y);
  _eraseCtx.lineTo(pos.x + 0.1, pos.y + 0.1);
  _eraseCtx.stroke();
  compositeLayers();
}

function continueErase(clientX, clientY) {
  if (!_eraseCtx) return;
  const pos = layerCoords(clientX, clientY);
  _eraseCtx.lineTo(pos.x, pos.y);
  _eraseCtx.stroke();
  compositeLayers();
}

function endErase() {
  state.isErasing = false;
  if (_eraseCtx) {
    _eraseCtx.closePath();
    _eraseCtx.restore();
    _eraseCtx = null;
  }
  compositeLayers();
  saveState();
  const layer = getActiveLayer();
  if (layer) {
    statusEl.textContent = `${layer.canvas.width}×${layer.canvas.height} — erased`;
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.eraserMode) {
    setEraserMode(false);
  }
  if (e.key === 'e' || e.key === 'E') {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (state.layers.length === 0 && !state.currentImg) return;
    e.preventDefault();
    setEraserMode(!state.eraserMode);
  }
});
