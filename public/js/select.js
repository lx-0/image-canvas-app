// Rectangular selection tool — click-drag to draw selection, crop or cancel
import { els, state } from './state.js';
import { saveState, resizeAndDraw } from './canvas.js';
import { setDrawingMode } from './draw.js';
import { executeCrop } from './filters.js';

const { canvas, ctx, container, statusEl } = els;

// --- DOM references ---
const selectBtn = document.getElementById('select-btn');
const selToolbar = document.getElementById('select-toolbar');
const selDims = document.getElementById('select-dims');
const selCropBtn = document.getElementById('select-crop-btn');
const selCancelBtn = document.getElementById('select-cancel-btn');

// --- Toggle selection mode ---
export function setSelectMode(active) {
  state.selectMode = active;
  selectBtn.classList.toggle('active', active);
  container.classList.toggle('select-mode', active);
  if (active) {
    // Deactivate drawing mode when entering selection
    setDrawingMode(false);
  }
  if (!active) {
    clearSelection();
  }
}

function clearSelection() {
  state.isSelecting = false;
  state.selRect = null;
  selToolbar.classList.remove('visible');
  // Redraw canvas to remove selection overlay
  if (state.currentImg) resizeAndDraw();
}

selectBtn.addEventListener('click', () => {
  if (!state.currentImg) return;
  setSelectMode(!state.selectMode);
});

// --- Coordinate conversion (screen -> canvas pixels) ---
function canvasCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / (rect.width / canvas.width),
    y: (clientY - rect.top) / (rect.height / canvas.height),
  };
}

// --- Draw selection overlay ---
function drawSelectionOverlay() {
  if (!state.selRect) return;
  const { x, y, w, h } = state.selRect;

  // Dim area outside selection
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  // Top
  ctx.fillRect(0, 0, canvas.width, y);
  // Bottom
  ctx.fillRect(0, y + h, canvas.width, canvas.height - (y + h));
  // Left
  ctx.fillRect(0, y, x, h);
  // Right
  ctx.fillRect(x + w, y, canvas.width - (x + w), h);

  // Dashed rectangle border
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);

  // Inner dark stroke for visibility on light backgrounds
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineDashOffset = 5;
  ctx.strokeRect(x, y, w, h);

  ctx.restore();
}

function updateSelectionUI() {
  if (!state.selRect) return;
  const { w, h } = state.selRect;
  const absW = Math.round(Math.abs(w));
  const absH = Math.round(Math.abs(h));

  // Scale to original image dimensions for display
  const scaleX = state.currentImg.width / canvas.width;
  const scaleY = state.currentImg.height / canvas.height;
  const realW = Math.round(absW * scaleX);
  const realH = Math.round(absH * scaleY);

  selDims.textContent = `${realW} × ${realH} px`;

  // Position toolbar above selection
  const rect = canvas.getBoundingClientRect();
  const selMinX = Math.min(state.selRect.x, state.selRect.x + state.selRect.w);
  const selMinY = Math.min(state.selRect.y, state.selRect.y + state.selRect.h);

  const screenX = rect.left + (selMinX / canvas.width) * rect.width;
  const screenY = rect.top + (selMinY / canvas.height) * rect.height;

  // Position relative to container
  const containerRect = container.getBoundingClientRect();
  let toolbarLeft = screenX - containerRect.left;
  let toolbarTop = screenY - containerRect.top - selToolbar.offsetHeight - 8;

  // If not enough room above, show below selection
  if (toolbarTop < 0) {
    const selMaxY = Math.max(state.selRect.y, state.selRect.y + state.selRect.h);
    const belowY = rect.top + (selMaxY / canvas.height) * rect.height;
    toolbarTop = belowY - containerRect.top + 8;
  }

  // Clamp to container bounds
  toolbarLeft = Math.max(4, Math.min(toolbarLeft, containerRect.width - selToolbar.offsetWidth - 4));
  toolbarTop = Math.max(4, Math.min(toolbarTop, containerRect.height - selToolbar.offsetHeight - 4));

  selToolbar.style.left = toolbarLeft + 'px';
  selToolbar.style.top = toolbarTop + 'px';

  if (absW > 2 && absH > 2) {
    selToolbar.classList.add('visible');
  }
}

// --- Mouse selection ---
canvas.addEventListener('mousedown', (e) => {
  if (!state.selectMode || !state.currentImg || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  beginSelection(e.clientX, e.clientY);
});

window.addEventListener('mousemove', (e) => {
  if (!state.isSelecting) return;
  e.preventDefault();
  updateSelection(e.clientX, e.clientY);
});

window.addEventListener('mouseup', () => {
  if (state.isSelecting) endSelection();
});

// --- Touch selection ---
canvas.addEventListener('touchstart', (e) => {
  if (!state.selectMode || !state.currentImg) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  e.stopPropagation();
  beginSelection(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (!state.isSelecting) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  updateSelection(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  if (state.isSelecting && e.touches.length === 0) endSelection();
}, { passive: true });

// --- Selection lifecycle ---
function beginSelection(clientX, clientY) {
  state.isSelecting = true;
  const pos = canvasCoords(clientX, clientY);
  state.selStartX = pos.x;
  state.selStartY = pos.y;
  state.selRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
  selToolbar.classList.remove('visible');
}

function updateSelection(clientX, clientY) {
  const pos = canvasCoords(clientX, clientY);
  // Clamp to canvas bounds
  const cx = Math.max(0, Math.min(canvas.width, pos.x));
  const cy = Math.max(0, Math.min(canvas.height, pos.y));

  const rawW = cx - state.selStartX;
  const rawH = cy - state.selStartY;

  // Normalize to positive x, y, w, h
  state.selRect = {
    x: rawW >= 0 ? state.selStartX : cx,
    y: rawH >= 0 ? state.selStartY : cy,
    w: Math.abs(rawW),
    h: Math.abs(rawH),
  };

  // Redraw canvas then overlay
  resizeAndDraw();
  drawSelectionOverlay();
  updateSelectionUI();
}

function endSelection() {
  state.isSelecting = false;
  if (state.selRect && state.selRect.w > 2 && state.selRect.h > 2) {
    updateSelectionUI();
  } else {
    clearSelection();
  }
}

// --- Crop to selection ---
selCropBtn.addEventListener('click', () => {
  if (!state.selRect || !state.currentImg) return;
  const { x, y, w, h } = state.selRect;

  // Convert from canvas pixels to percentages for executeCrop
  const cmd = {
    action: 'crop',
    x: (x / canvas.width) * 100,
    y: (y / canvas.height) * 100,
    width: (w / canvas.width) * 100,
    height: (h / canvas.height) * 100,
  };

  executeCrop(cmd);

  // Snapshot and save to undo history
  const snapshot = new Image();
  snapshot.onload = () => {
    state.currentImg = snapshot;
    saveState();
    resizeAndDraw();
    statusEl.textContent = `${snapshot.width}×${snapshot.height} cropped`;
  };
  snapshot.src = canvas.toDataURL('image/png');

  // Exit selection mode
  setSelectMode(false);
});

// --- Cancel ---
selCancelBtn.addEventListener('click', () => {
  setSelectMode(false);
});

// --- Keyboard: Escape exits, S toggles ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selectMode) {
    setSelectMode(false);
    return;
  }
  // Enter confirms crop when selection exists
  if (e.key === 'Enter' && state.selectMode && state.selRect && state.selRect.w > 2) {
    selCropBtn.click();
    return;
  }
  // Toggle with S key when not typing
  if (e.key === 's' || e.key === 'S') {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!state.currentImg) return;
    e.preventDefault();
    setSelectMode(!state.selectMode);
  }
});
