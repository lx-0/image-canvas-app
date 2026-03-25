// Canvas rendering, zoom/pan, undo/redo (no chat/gallery deps to avoid cycles)
import { els, state } from './state.js';

const { canvas, ctx, container, statusEl, undoBtn, redoBtn, saveBtn,
        zoomLevelEl, zoomInBtn, zoomOutBtn, zoomFitBtn, emptyState } = els;

const drawBtn = document.getElementById('draw-btn');

// Undo/Redo
export function saveState() {
  if (!state.currentImg) return;
  const dataURL = canvas.toDataURL('image/png');
  state.historyStack = state.historyStack.slice(0, state.historyIndex + 1);
  state.historyStack.push(dataURL);
  if (state.historyStack.length > state.MAX_HISTORY) {
    state.historyStack.shift();
  }
  state.historyIndex = state.historyStack.length - 1;
  updateUndoRedoButtons();
}

export function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  restoreState(state.historyStack[state.historyIndex]);
}

export function redo() {
  if (state.historyIndex >= state.historyStack.length - 1) return;
  state.historyIndex++;
  restoreState(state.historyStack[state.historyIndex]);
}

function restoreState(dataURL) {
  const img = new Image();
  img.onload = () => {
    state.currentImg = img;
    resizeAndDraw();
    statusEl.textContent = `${img.width}×${img.height} rendered`;
    updateUndoRedoButtons();
  };
  img.src = dataURL;
}

export function updateUndoRedoButtons() {
  undoBtn.disabled = state.historyIndex <= 0;
  redoBtn.disabled = state.historyIndex >= state.historyStack.length - 1;
  saveBtn.disabled = !state.currentImg;
  if (drawBtn) drawBtn.disabled = !state.currentImg;
}

// Canvas drawing
export function resizeAndDraw() {
  const cw = container.clientWidth - 32;
  const ch = container.clientHeight - 32;

  if (!state.currentImg) {
    canvas.width = cw;
    canvas.height = ch;
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  const scale = Math.min(cw / state.currentImg.width, ch / state.currentImg.height, 1);
  const w = Math.round(state.currentImg.width * scale);
  const h = Math.round(state.currentImg.height * scale);

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(state.currentImg, 0, 0, w, h);
}

// Zoom & Pan
export function applyTransform() {
  canvas.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoomLevel})`;
  zoomLevelEl.textContent = Math.round(state.zoomLevel * 100) + '%';
}

export function resetZoomPan() {
  state.zoomLevel = 1;
  state.panX = 0;
  state.panY = 0;
  applyTransform();
}

export function zoomToPoint(newZoom, clientX, clientY) {
  newZoom = Math.max(state.MIN_ZOOM, Math.min(state.MAX_ZOOM, newZoom));
  const rect = container.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const ox = (clientX - canvasRect.left) / state.zoomLevel;
  const oy = (clientY - canvasRect.top) / state.zoomLevel;
  const flexOffsetX = (rect.width - canvas.width) / 2;
  const flexOffsetY = (rect.height - canvas.height) / 2;

  state.zoomLevel = newZoom;
  state.panX = (clientX - rect.left) - flexOffsetX - ox * newZoom;
  state.panY = (clientY - rect.top) - flexOffsetY - oy * newZoom;
  applyTransform();
}

export function getCanvasDataURL() {
  if (!state.currentImg) return null;
  try {
    return canvas.toDataURL('image/png');
  } catch (_e) {
    return null;
  }
}

export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Initialize event listeners
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
window.addEventListener('resize', resizeAndDraw);
resizeAndDraw();

// Mouse wheel zoom
container.addEventListener('wheel', (e) => {
  if (!state.currentImg) return;
  e.preventDefault();
  const delta = -Math.sign(e.deltaY) * state.ZOOM_STEP * Math.max(1, state.zoomLevel * 0.5);
  zoomToPoint(state.zoomLevel + delta, e.clientX, e.clientY);
}, { passive: false });

container.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

// Pan via middle-mouse or left-click drag when zoomed (disabled during drawing)
container.addEventListener('mousedown', (e) => {
  if (!state.currentImg) return;
  if (state.drawingMode && e.button === 0) return; // drawing handles left-click
  if (e.button === 1 || (e.button === 0 && state.zoomLevel !== 1)) {
    if (e.button === 0 && state.zoomLevel === 1) return;
    e.preventDefault();
    state.isPanning = true;
    state.panStartX = e.clientX;
    state.panStartY = e.clientY;
    state.panStartPanX = state.panX;
    state.panStartPanY = state.panY;
    container.style.cursor = 'grabbing';
  }
});

window.addEventListener('mousemove', (e) => {
  if (!state.isPanning) return;
  state.panX = state.panStartPanX + (e.clientX - state.panStartX);
  state.panY = state.panStartPanY + (e.clientY - state.panStartY);
  applyTransform();
});

window.addEventListener('mouseup', () => {
  if (state.isPanning) {
    state.isPanning = false;
    container.style.cursor = '';
  }
});

// Zoom buttons
zoomInBtn.addEventListener('click', () => {
  if (!state.currentImg) return;
  const rect = container.getBoundingClientRect();
  zoomToPoint(state.zoomLevel + state.ZOOM_STEP * Math.max(1, state.zoomLevel * 0.5), rect.left + rect.width / 2, rect.top + rect.height / 2);
});

zoomOutBtn.addEventListener('click', () => {
  if (!state.currentImg) return;
  const rect = container.getBoundingClientRect();
  zoomToPoint(state.zoomLevel - state.ZOOM_STEP * Math.max(1, state.zoomLevel * 0.5), rect.left + rect.width / 2, rect.top + rect.height / 2);
});

zoomFitBtn.addEventListener('click', resetZoomPan);
