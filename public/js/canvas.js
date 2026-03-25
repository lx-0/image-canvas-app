// Canvas rendering, zoom/pan, undo/redo — layer-aware
import { els, state } from './state.js';
import { compositeLayers, serializeLayerStack, deserializeLayerStack, registerSaveState } from './layers.js';

const { canvas, ctx, container, statusEl, undoBtn, redoBtn, saveBtn,
        zoomLevelEl, zoomInBtn, zoomOutBtn, zoomFitBtn, emptyState } = els;

const drawBtn = document.getElementById('draw-btn');
const selectBtn = document.getElementById('select-btn');
const textBtn = document.getElementById('text-btn');
const filterBtn = document.getElementById('filter-btn');
const layersBtn = document.getElementById('layers-btn');
const compareBtn = document.getElementById('compare-btn');

// --- Undo/Redo ---

export function saveState() {
  if (state.layers.length === 0 && !state.currentImg) return;

  let snapshot;
  if (state.layers.length > 0) {
    snapshot = {
      type: 'layers',
      layers: serializeLayerStack(),
      activeLayerIndex: state.activeLayerIndex,
    };
  } else {
    snapshot = {
      type: 'flat',
      dataURL: canvas.toDataURL('image/png'),
    };
  }

  state.historyStack = state.historyStack.slice(0, state.historyIndex + 1);
  state.historyStack.push(snapshot);
  if (state.historyStack.length > state.MAX_HISTORY) {
    state.historyStack.shift();
  }
  state.historyIndex = state.historyStack.length - 1;
  updateUndoRedoButtons();
}

// Register with layers module so layer operations can trigger saves
registerSaveState(saveState);

export function undo() {
  if (state.historyIndex <= 0) return;
  state.historyIndex--;
  restoreSnapshot(state.historyStack[state.historyIndex]);
}

export function redo() {
  if (state.historyIndex >= state.historyStack.length - 1) return;
  state.historyIndex++;
  restoreSnapshot(state.historyStack[state.historyIndex]);
}

function restoreSnapshot(snapshot) {
  if (snapshot.type === 'layers') {
    deserializeLayerStack(snapshot.layers, snapshot.activeLayerIndex).then(() => {
      resizeAndDraw();
      statusEl.textContent = `${state.layers[0].canvas.width}\u00D7${state.layers[0].canvas.height} rendered`;
      updateUndoRedoButtons();
    });
  } else {
    // Legacy flat restore
    const img = new Image();
    img.onload = () => {
      state.currentImg = img;
      resizeAndDraw();
      statusEl.textContent = `${img.width}\u00D7${img.height} rendered`;
      updateUndoRedoButtons();
    };
    img.src = snapshot.dataURL;
  }
}

export function updateUndoRedoButtons() {
  undoBtn.disabled = state.historyIndex <= 0;
  redoBtn.disabled = state.historyIndex >= state.historyStack.length - 1;
  const hasContent = state.layers.length > 0 || !!state.currentImg;
  saveBtn.disabled = !hasContent;
  if (drawBtn) drawBtn.disabled = !hasContent;
  if (selectBtn) selectBtn.disabled = !hasContent;
  if (textBtn) textBtn.disabled = !hasContent;
  if (filterBtn) filterBtn.disabled = !hasContent;
  if (layersBtn) layersBtn.disabled = !hasContent;
  if (compareBtn) compareBtn.disabled = !hasContent;
  const saveProjectBtn = document.getElementById('save-project-btn');
  if (saveProjectBtn) saveProjectBtn.disabled = !hasContent;
}

// --- Canvas drawing ---

export function resizeAndDraw() {
  const cw = container.clientWidth - 32;
  const ch = container.clientHeight - 32;

  // Layer-based rendering
  if (state.layers.length > 0) {
    const docW = state.layers[0].canvas.width;
    const docH = state.layers[0].canvas.height;
    emptyState.classList.add('hidden');
    const scale = Math.min(cw / docW, ch / docH, 1);
    const w = Math.round(docW * scale);
    const h = Math.round(docH * scale);
    canvas.width = w;
    canvas.height = h;
    compositeLayers();
    return;
  }

  // Fallback: no layers (legacy path)
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

// --- Zoom & Pan ---

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
  if (state.layers.length === 0 && !state.currentImg) return null;
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

// --- Event listeners ---

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
window.addEventListener('resize', resizeAndDraw);
resizeAndDraw();

// Mouse wheel zoom
container.addEventListener('wheel', (e) => {
  if (state.layers.length === 0 && !state.currentImg) return;
  e.preventDefault();
  const delta = -Math.sign(e.deltaY) * state.ZOOM_STEP * Math.max(1, state.zoomLevel * 0.5);
  zoomToPoint(state.zoomLevel + delta, e.clientX, e.clientY);
}, { passive: false });

container.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

// Pan via middle-mouse or left-click drag when zoomed
container.addEventListener('mousedown', (e) => {
  if (state.layers.length === 0 && !state.currentImg) return;
  if (state.drawingMode && e.button === 0) return;
  if (state.selectMode && e.button === 0) return;
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
  if (state.layers.length === 0 && !state.currentImg) return;
  const rect = container.getBoundingClientRect();
  zoomToPoint(state.zoomLevel + state.ZOOM_STEP * Math.max(1, state.zoomLevel * 0.5), rect.left + rect.width / 2, rect.top + rect.height / 2);
});

zoomOutBtn.addEventListener('click', () => {
  if (state.layers.length === 0 && !state.currentImg) return;
  const rect = container.getBoundingClientRect();
  zoomToPoint(state.zoomLevel - state.ZOOM_STEP * Math.max(1, state.zoomLevel * 0.5), rect.left + rect.width / 2, rect.top + rect.height / 2);
});

zoomFitBtn.addEventListener('click', resetZoomPan);
