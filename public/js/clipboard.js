import { els, state } from './state.js';
import { saveState, resizeAndDraw } from './canvas.js';
import { getActiveLayer, getActiveCtx, compositeLayers, addImageLayer } from './layers.js';
import { setSelectMode } from './select.js';
import { setLassoMode } from './lasso.js';
import { setMagicWandMode } from './magicwand.js';

const { canvas, ctx, container, statusEl } = els;
const selToolbar = document.getElementById('select-toolbar');
const selDims = document.getElementById('select-dims');
const selCutBtn = document.getElementById('select-cut-btn');

// --- Detect active selection type ---

function getSelectionType() {
  if (state.selectMode && state.selRect && state.selRect.w > 2 && state.selRect.h > 2) return 'rect';
  if (state.lassoMode && state.lassoPoints.length > 10) return 'lasso';
  if (state.magicWandMode && state.wandMask) return 'wand';
  return null;
}

// --- Lasso helpers (duplicated from lasso.js to avoid export changes) ---

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

// --- Wand bounds helper ---

function getWandBounds() {
  if (!state.wandMask) return null;
  const w = state.wandMaskWidth;
  const h = state.wandMaskHeight;
  let minX = w, minY = h, maxX = 0, maxY = 0;
  let found = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (state.wandMask[y * w + x]) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// --- Copy selection pixels to internal clipboard ---

function copySelectionToClipboard() {
  const type = getSelectionType();
  if (!type) return false;

  const layer = getActiveLayer();
  if (!layer) return false;

  if (type === 'rect') {
    const { x, y, w, h } = state.selRect;
    const scaleX = layer.canvas.width / canvas.width;
    const scaleY = layer.canvas.height / canvas.height;
    const lx = Math.round(x * scaleX);
    const ly = Math.round(y * scaleY);
    const lw = Math.round(w * scaleX);
    const lh = Math.round(h * scaleY);

    const c = document.createElement('canvas');
    c.width = lw;
    c.height = lh;
    c.getContext('2d').drawImage(layer.canvas, lx, ly, lw, lh, 0, 0, lw, lh);
    state.clipboardCanvas = c;
    return true;
  }

  if (type === 'lasso') {
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
    if (w <= 0 || h <= 0) return false;

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cCtx = c.getContext('2d');
    const shifted = layerPoints.map(p => ({ x: p.x - minX, y: p.y - minY }));
    cCtx.save();
    applyLassoClip(cCtx, shifted);
    cCtx.drawImage(layer.canvas, minX, minY, w, h, 0, 0, w, h);
    cCtx.restore();
    state.clipboardCanvas = c;
    return true;
  }

  if (type === 'wand') {
    const bounds = getWandBounds();
    if (!bounds) return false;
    const w = bounds.w;
    const h = bounds.h;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cCtx = c.getContext('2d');

    const srcData = getActiveCtx().getImageData(bounds.x, bounds.y, w, h);
    const dstData = cCtx.createImageData(w, h);
    const sd = srcData.data;
    const dd = dstData.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const maskIdx = (y + bounds.y) * state.wandMaskWidth + (x + bounds.x);
        if (state.wandMask[maskIdx]) {
          const idx = (y * w + x) * 4;
          dd[idx] = sd[idx];
          dd[idx + 1] = sd[idx + 1];
          dd[idx + 2] = sd[idx + 2];
          dd[idx + 3] = sd[idx + 3];
        }
      }
    }
    cCtx.putImageData(dstData, 0, 0);
    state.clipboardCanvas = c;
    return true;
  }

  return false;
}

// --- Clear selected area on active layer ---

function clearSelectedArea() {
  const type = getSelectionType();
  if (!type) return false;

  const layer = getActiveLayer();
  if (!layer) return false;
  const layerCtx = getActiveCtx();

  if (type === 'rect') {
    const { x, y, w, h } = state.selRect;
    const scaleX = layer.canvas.width / canvas.width;
    const scaleY = layer.canvas.height / canvas.height;
    layerCtx.clearRect(
      Math.round(x * scaleX), Math.round(y * scaleY),
      Math.round(w * scaleX), Math.round(h * scaleY)
    );
    return true;
  }

  if (type === 'lasso') {
    const layerPoints = getLassoLayerPoints();
    layerCtx.save();
    applyLassoClip(layerCtx, layerPoints);
    layerCtx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    layerCtx.restore();
    return true;
  }

  if (type === 'wand') {
    const w = layer.canvas.width;
    const h = layer.canvas.height;
    const imageData = layerCtx.getImageData(0, 0, w, h);
    const d = imageData.data;
    for (let i = 0; i < w * h; i++) {
      if (state.wandMask[i]) {
        const idx = i * 4;
        d[idx] = d[idx + 1] = d[idx + 2] = d[idx + 3] = 0;
      }
    }
    layerCtx.putImageData(imageData, 0, 0);
    return true;
  }

  return false;
}

// --- Deselect all selections ---

function deselectAll() {
  if (state.selectMode) setSelectMode(false);
  if (state.lassoMode) setLassoMode(false);
  if (state.magicWandMode) setMagicWandMode(false);
}

// --- Select entire canvas ---

function selectAll() {
  if (state.layers.length === 0 && !state.currentImg) return;

  if (state.lassoMode) setLassoMode(false);
  if (state.magicWandMode) setMagicWandMode(false);
  if (!state.selectMode) setSelectMode(true);

  state.selRect = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  resizeAndDraw();

  let scaleX = 1, scaleY = 1;
  if (state.layers.length > 0) {
    scaleX = state.layers[0].canvas.width / canvas.width;
    scaleY = state.layers[0].canvas.height / canvas.height;
  }
  selDims.textContent = `${Math.round(canvas.width * scaleX)} × ${Math.round(canvas.height * scaleY)} px`;

  if (selToolbar) selToolbar.classList.add('visible');
  statusEl.textContent = 'All selected';
}

// --- Invert selection ---

function invertSelection() {
  const type = getSelectionType();
  if (!type) return;

  if (type === 'wand') {
    for (let i = 0; i < state.wandMask.length; i++) {
      state.wandMask[i] = state.wandMask[i] ? 0 : 1;
    }
    resizeAndDraw();
    statusEl.textContent = 'Selection inverted';
    return;
  }

  const layer = getActiveLayer();
  if (!layer) return;
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  const mask = new Uint8Array(w * h);

  if (type === 'rect') {
    const scaleX = w / canvas.width;
    const scaleY = h / canvas.height;
    const lx = Math.round(state.selRect.x * scaleX);
    const ly = Math.round(state.selRect.y * scaleY);
    const lw = Math.round(state.selRect.w * scaleX);
    const lh = Math.round(state.selRect.h * scaleY);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < lx || x >= lx + lw || y < ly || y >= ly + lh) {
          mask[y * w + x] = 1;
        }
      }
    }
  }

  if (type === 'lasso') {
    const layerPoints = getLassoLayerPoints();
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.fillStyle = '#000';
    tmpCtx.beginPath();
    tmpCtx.moveTo(layerPoints[0].x, layerPoints[0].y);
    for (let i = 1; i < layerPoints.length; i++) {
      tmpCtx.lineTo(layerPoints[i].x, layerPoints[i].y);
    }
    tmpCtx.closePath();
    tmpCtx.fill();
    const imgData = tmpCtx.getImageData(0, 0, w, h);
    const d = imgData.data;
    for (let i = 0; i < w * h; i++) {
      mask[i] = d[i * 4 + 3] > 0 ? 0 : 1;
    }
  }

  // Switch to wand mode with the inverted mask
  state.selectMode = false;
  state.selRect = null;
  const selectBtnEl = document.getElementById('select-btn');
  if (selectBtnEl) selectBtnEl.classList.remove('active');
  container.classList.remove('select-mode');

  state.lassoMode = false;
  state.isLassoing = false;
  state.lassoPoints = [];
  const lassoBtnEl = document.getElementById('lasso-btn');
  if (lassoBtnEl) lassoBtnEl.classList.remove('active');
  container.classList.remove('lasso-mode');

  state.magicWandMode = true;
  const wandBtnEl = document.getElementById('magicwand-btn');
  if (wandBtnEl) wandBtnEl.classList.add('active');
  const wandPanel = document.getElementById('magicwand-panel');
  if (wandPanel) wandPanel.classList.add('visible');
  container.classList.add('magicwand-mode');

  state.wandMask = mask;
  state.wandMaskWidth = w;
  state.wandMaskHeight = h;

  resizeAndDraw();
  statusEl.textContent = 'Selection inverted';
}

// --- Paste from internal clipboard ---

function pasteFromClipboard() {
  if (!state.clipboardCanvas || state.layers.length === 0) return;
  const img = new Image();
  img.onload = () => {
    addImageLayer(img, 'Pasted');
    resizeAndDraw();
    statusEl.textContent = `Pasted as new layer (${img.width}×${img.height})`;
  };
  img.src = state.clipboardCanvas.toDataURL('image/png');
}

// --- Toolbar Cut button ---

if (selCutBtn) {
  selCutBtn.addEventListener('click', () => {
    if (!getSelectionType()) return;
    if (copySelectionToClipboard()) {
      clearSelectedArea();
      compositeLayers();
      resizeAndDraw();
      saveState();
      statusEl.textContent = 'Selection cut';
      deselectAll();
    }
  });
}

// Copy toolbar button: also populate internal clipboard
const selCopyBtn = document.getElementById('select-copy-btn');
if (selCopyBtn) {
  selCopyBtn.addEventListener('click', () => {
    if (getSelectionType()) copySelectionToClipboard();
  });
}

// --- Paste event handler (internal clipboard takes priority) ---

document.addEventListener('paste', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (state.clipboardCanvas && state.layers.length > 0) {
    e.preventDefault();
    e.stopImmediatePropagation();
    pasteFromClipboard();
  }
});

// --- Keyboard shortcuts ---

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  // Ctrl+C: Copy selection to internal clipboard
  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey) {
    if (getSelectionType()) {
      e.preventDefault();
      if (copySelectionToClipboard()) {
        statusEl.textContent = 'Selection copied to clipboard';
      }
    }
    return;
  }

  // Ctrl+X: Cut selection
  if ((e.ctrlKey || e.metaKey) && e.key === 'x' && !e.shiftKey) {
    if (getSelectionType()) {
      e.preventDefault();
      if (copySelectionToClipboard()) {
        clearSelectedArea();
        compositeLayers();
        resizeAndDraw();
        saveState();
        statusEl.textContent = 'Selection cut';
        deselectAll();
      }
    }
    return;
  }

  // Backspace: Delete selection (Delete key handled by existing modules)
  if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey) {
    if (getSelectionType()) {
      e.preventDefault();
      clearSelectedArea();
      compositeLayers();
      resizeAndDraw();
      saveState();
      statusEl.textContent = 'Selection deleted';
      deselectAll();
    }
    return;
  }

  // Ctrl+A: Select all
  if ((e.ctrlKey || e.metaKey) && e.key === 'a' && !e.shiftKey) {
    if (state.layers.length > 0 || state.currentImg) {
      e.preventDefault();
      selectAll();
    }
    return;
  }

  // Ctrl+D: Deselect
  if ((e.ctrlKey || e.metaKey) && e.key === 'd' && !e.shiftKey) {
    if (getSelectionType()) {
      e.preventDefault();
      deselectAll();
      statusEl.textContent = 'Deselected';
    }
    return;
  }

  // Ctrl+Shift+I: Invert selection
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I') {
    if (getSelectionType()) {
      e.preventDefault();
      invertSelection();
    }
    return;
  }
});

// --- Marching ants animation ---

let cachedWandOverlay = null;
let cachedWandMaskRef = null;
let cachedWandCanvasW = 0;
let cachedWandCanvasH = 0;

function getWandOverlayCanvas() {
  const w = canvas.width;
  const h = canvas.height;
  if (cachedWandMaskRef === state.wandMask && cachedWandOverlay &&
      cachedWandCanvasW === w && cachedWandCanvasH === h) {
    return cachedWandOverlay;
  }
  const scaleX = state.wandMaskWidth / w;
  const scaleY = state.wandMaskHeight / h;
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tmpCtx = tmp.getContext('2d');
  tmpCtx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  tmpCtx.fillRect(0, 0, w, h);
  const imgData = tmpCtx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let dy = 0; dy < h; dy++) {
    const ly = Math.floor(dy * scaleY);
    const rowOffset = ly * state.wandMaskWidth;
    for (let dx = 0; dx < w; dx++) {
      const lx = Math.floor(dx * scaleX);
      if (state.wandMask[rowOffset + lx]) {
        const idx = (dy * w + dx) * 4;
        d[idx + 3] = 0;
      }
    }
  }
  tmpCtx.putImageData(imgData, 0, 0);
  cachedWandOverlay = tmp;
  cachedWandMaskRef = state.wandMask;
  cachedWandCanvasW = w;
  cachedWandCanvasH = h;
  return tmp;
}

function drawAnimatedOverlay() {
  const type = getSelectionType();
  if (!type) return;
  const offset = state.marchingAntsOffset;

  if (type === 'rect') {
    const { x, y, w, h } = state.selRect;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, canvas.width, y);
    ctx.fillRect(0, y + h, canvas.width, canvas.height - (y + h));
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, canvas.width - (x + w), h);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.lineDashOffset = -offset;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineDashOffset = -offset + 5;
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
    return;
  }

  if (type === 'lasso') {
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
    ctx.lineDashOffset = -offset;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineDashOffset = -offset + 5;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (type === 'wand') {
    ctx.drawImage(getWandOverlayCanvas(), 0, 0);
    const bounds = getWandBounds();
    if (bounds) {
      const dScaleX = canvas.width / state.wandMaskWidth;
      const dScaleY = canvas.height / state.wandMaskHeight;
      const bx = bounds.x * dScaleX;
      const by = bounds.y * dScaleY;
      const bw = bounds.w * dScaleX;
      const bh = bounds.h * dScaleY;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.lineDashOffset = -offset;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineDashOffset = -offset + 5;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();
    }
  }
}

function marchingAntsLoop() {
  const hasSelection = getSelectionType() !== null;
  const isDragging = state.isSelecting || state.isLassoing;

  if (hasSelection && !isDragging) {
    state.marchingAntsOffset = (state.marchingAntsOffset + 0.4) % 10;
    compositeLayers();
    drawAnimatedOverlay();
  }

  requestAnimationFrame(marchingAntsLoop);
}

requestAnimationFrame(marchingAntsLoop);
