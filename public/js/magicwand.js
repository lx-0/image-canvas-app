import { els, state } from './state.js';
import { saveState, resizeAndDraw } from './canvas.js';
import { getActiveLayer, getActiveCtx, compositeLayers } from './layers.js';
import { executeCrop } from './filters.js';

const { canvas, ctx, container, statusEl } = els;

const wandBtn = document.getElementById('magicwand-btn');
const wandPanel = document.getElementById('magicwand-panel');
const toleranceSlider = document.getElementById('magicwand-tolerance');
const toleranceValue = document.getElementById('magicwand-tolerance-value');
const selToolbar = document.getElementById('select-toolbar');
const selDims = document.getElementById('select-dims');
const selCropBtn = document.getElementById('select-crop-btn');
const selDeleteBtn = document.getElementById('select-delete-btn');
const selCopyBtn = document.getElementById('select-copy-btn');
const selCancelBtn = document.getElementById('select-cancel-btn');

export function setMagicWandMode(active) {
  state.magicWandMode = active;
  wandBtn.classList.toggle('active', active);
  wandPanel.classList.toggle('visible', active);
  container.classList.toggle('magicwand-mode', active);
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

    state.lassoMode = false;
    state.isLassoing = false;
    state.lassoPoints = [];
    const lassoBtnEl = document.getElementById('lasso-btn');
    if (lassoBtnEl) lassoBtnEl.classList.remove('active');
    container.classList.remove('lasso-mode');

    state.gradientMode = false;
    state.isGradient = false;
    const gradientBtnEl = document.getElementById('gradient-btn');
    if (gradientBtnEl) gradientBtnEl.classList.remove('active');
    const gradientPanelEl = document.getElementById('gradient-panel');
    if (gradientPanelEl) gradientPanelEl.classList.remove('visible');
    container.classList.remove('gradient-mode');
  }
  if (!active) {
    clearWandSelection();
  }
}

function clearWandSelection() {
  state.wandMask = null;
  state.wandMaskWidth = 0;
  state.wandMaskHeight = 0;
  selToolbar.classList.remove('visible');
  if (state.layers.length > 0 || state.currentImg) {
    resizeAndDraw();
  }
}

wandBtn.addEventListener('click', () => {
  if (state.layers.length === 0 && !state.currentImg) return;
  setMagicWandMode(!state.magicWandMode);
});

toleranceSlider.addEventListener('input', () => {
  state.magicWandTolerance = parseInt(toleranceSlider.value, 10);
  toleranceValue.textContent = toleranceSlider.value;
});

function layerCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const layer = getActiveLayer();
  if (layer) {
    return {
      x: Math.floor((clientX - rect.left) * layer.canvas.width / rect.width),
      y: Math.floor((clientY - rect.top) * layer.canvas.height / rect.height),
    };
  }
  return {
    x: Math.floor((clientX - rect.left) / (rect.width / canvas.width)),
    y: Math.floor((clientY - rect.top) / (rect.height / canvas.height)),
  };
}

function colorDiff(data, idx, sr, sg, sb, sa) {
  return Math.abs(data[idx] - sr) +
         Math.abs(data[idx + 1] - sg) +
         Math.abs(data[idx + 2] - sb) +
         Math.abs(data[idx + 3] - sa);
}

function buildSelectionMask(layerCtx, startX, startY, tolerance, width, height) {
  const imageData = layerCtx.getImageData(0, 0, width, height);
  const data = imageData.data;

  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return null;

  const startIdx = (startY * width + startX) * 4;
  const sr = data[startIdx];
  const sg = data[startIdx + 1];
  const sb = data[startIdx + 2];
  const sa = data[startIdx + 3];

  const mask = new Uint8Array(width * height);

  function matches(idx) {
    return colorDiff(data, idx * 4, sr, sg, sb, sa) <= tolerance;
  }

  const stack = [[startX, startY]];

  while (stack.length > 0) {
    const [x, y] = stack.pop();
    if (y < 0 || y >= height) continue;

    let left = x;
    while (left > 0 && !mask[y * width + left - 1] && matches(y * width + left - 1)) {
      left--;
    }

    let right = x;
    while (right < width - 1 && !mask[y * width + right + 1] && matches(y * width + right + 1)) {
      right++;
    }

    if (!matches(y * width + left) && left === x) {
      if (!matches(y * width + x)) continue;
      left = x;
    }
    if (!matches(y * width + left)) left++;

    let spanAbove = false;
    let spanBelow = false;

    for (let i = left; i <= right; i++) {
      const pixIdx = y * width + i;
      if (!matches(pixIdx)) {
        spanAbove = false;
        spanBelow = false;
        continue;
      }

      mask[pixIdx] = 1;

      if (y > 0) {
        const aboveIdx = (y - 1) * width + i;
        if (!mask[aboveIdx] && matches(aboveIdx)) {
          if (!spanAbove) { stack.push([i, y - 1]); spanAbove = true; }
        } else {
          spanAbove = false;
        }
      }

      if (y < height - 1) {
        const belowIdx = (y + 1) * width + i;
        if (!mask[belowIdx] && matches(belowIdx)) {
          if (!spanBelow) { stack.push([i, y + 1]); spanBelow = true; }
        } else {
          spanBelow = false;
        }
      }
    }
  }

  return mask;
}

function drawWandOverlay() {
  if (!state.wandMask) return;
  const layer = getActiveLayer();
  if (!layer) return;

  const w = canvas.width;
  const h = canvas.height;
  const scaleX = state.wandMaskWidth / w;
  const scaleY = state.wandMaskHeight / h;

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = w;
  tmpCanvas.height = h;
  const tmpCtx = tmpCanvas.getContext('2d');
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
  ctx.drawImage(tmpCanvas, 0, 0);

  const bounds = getWandBounds();
  if (bounds) {
    const dScaleX = w / state.wandMaskWidth;
    const dScaleY = h / state.wandMaskHeight;
    const bx = bounds.x * dScaleX;
    const by = bounds.y * dScaleY;
    const bw = bounds.w * dScaleX;
    const bh = bounds.h * dScaleY;

    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineDashOffset = 5;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.restore();
  }
}

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

function hasWandSelection() {
  return state.magicWandMode && state.wandMask;
}

function doWandSelect(clientX, clientY) {
  const layer = getActiveLayer();
  if (!layer) return;

  const pos = layerCoords(clientX, clientY);
  const w = layer.canvas.width;
  const h = layer.canvas.height;

  if (pos.x < 0 || pos.x >= w || pos.y < 0 || pos.y >= h) return;

  const layerCtx = getActiveCtx();
  const mask = buildSelectionMask(layerCtx, pos.x, pos.y, state.magicWandTolerance, w, h);
  if (!mask) return;

  state.wandMask = mask;
  state.wandMaskWidth = w;
  state.wandMaskHeight = h;

  resizeAndDraw();
  drawWandOverlay();
  updateWandUI();
}

function updateWandUI() {
  const bounds = getWandBounds();
  if (!bounds) return;

  selDims.textContent = `${bounds.w} × ${bounds.h} px`;

  const rect = canvas.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const dScaleX = canvas.width / state.wandMaskWidth;
  const dScaleY = canvas.height / state.wandMaskHeight;
  const screenX = rect.left + (bounds.x * dScaleX / canvas.width) * rect.width;
  const screenY = rect.top + (bounds.y * dScaleY / canvas.height) * rect.height;

  let toolbarLeft = screenX - containerRect.left;
  let toolbarTop = screenY - containerRect.top - selToolbar.offsetHeight - 8;

  if (toolbarTop < 0) {
    const belowY = rect.top + ((bounds.y + bounds.h) * dScaleY / canvas.height) * rect.height;
    toolbarTop = belowY - containerRect.top + 8;
  }

  toolbarLeft = Math.max(4, Math.min(toolbarLeft, containerRect.width - selToolbar.offsetWidth - 4));
  toolbarTop = Math.max(4, Math.min(toolbarTop, containerRect.height - selToolbar.offsetHeight - 4));

  selToolbar.style.left = toolbarLeft + 'px';
  selToolbar.style.top = toolbarTop + 'px';
  selToolbar.classList.add('visible');
}

// --- Selection actions ---
function cropToWand() {
  const bounds = getWandBounds();
  if (!bounds) return;

  const cmd = {
    action: 'crop',
    x: (bounds.x / state.wandMaskWidth) * 100,
    y: (bounds.y / state.wandMaskHeight) * 100,
    width: (bounds.w / state.wandMaskWidth) * 100,
    height: (bounds.h / state.wandMaskHeight) * 100,
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
  setMagicWandMode(false);
}

function deleteWandSelection() {
  const layer = getActiveLayer();
  if (!layer || !state.wandMask) return;

  const layerCtx = getActiveCtx();
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  const imageData = layerCtx.getImageData(0, 0, w, h);
  const d = imageData.data;

  for (let i = 0; i < w * h; i++) {
    if (state.wandMask[i]) {
      const idx = i * 4;
      d[idx] = 0;
      d[idx + 1] = 0;
      d[idx + 2] = 0;
      d[idx + 3] = 0;
    }
  }

  layerCtx.putImageData(imageData, 0, 0);
  compositeLayers();
  resizeAndDraw();
  saveState();
  statusEl.textContent = 'Selection deleted';
  setMagicWandMode(false);
}

async function copyWandSelection() {
  const layer = getActiveLayer();
  if (!layer || !state.wandMask) return;

  const bounds = getWandBounds();
  if (!bounds) return;

  const w = bounds.w;
  const h = bounds.h;
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = w;
  tmpCanvas.height = h;
  const tmpCtx = tmpCanvas.getContext('2d');

  const srcData = getActiveCtx().getImageData(bounds.x, bounds.y, w, h);
  const dstData = tmpCtx.createImageData(w, h);
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

  tmpCtx.putImageData(dstData, 0, 0);

  try {
    const blob = await new Promise(resolve => tmpCanvas.toBlob(resolve, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    statusEl.textContent = 'Selection copied';
  } catch (_err) {
    statusEl.textContent = 'Copy failed';
  }
}

// --- Mouse events ---
canvas.addEventListener('mousedown', (e) => {
  if (!state.magicWandMode || (state.layers.length === 0 && !state.currentImg) || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  doWandSelect(e.clientX, e.clientY);
});

canvas.addEventListener('touchstart', (e) => {
  if (!state.magicWandMode || (state.layers.length === 0 && !state.currentImg)) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  e.stopPropagation();
  doWandSelect(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

// --- Toolbar handlers ---
selCropBtn.addEventListener('click', () => {
  if (hasWandSelection()) cropToWand();
});

selDeleteBtn.addEventListener('click', () => {
  if (hasWandSelection()) deleteWandSelection();
});

selCopyBtn.addEventListener('click', () => {
  if (hasWandSelection()) copyWandSelection();
});

selCancelBtn.addEventListener('click', () => {
  if (state.magicWandMode) setMagicWandMode(false);
});

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.magicWandMode) {
    setMagicWandMode(false);
    return;
  }
  if (e.key === 'Enter' && hasWandSelection()) {
    cropToWand();
    return;
  }
  if (e.key === 'Delete' && hasWandSelection()) {
    deleteWandSelection();
    return;
  }
  if (e.key === 'w' || e.key === 'W') {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (state.layers.length === 0 && !state.currentImg) return;
    e.preventDefault();
    setMagicWandMode(!state.magicWandMode);
  }
});
