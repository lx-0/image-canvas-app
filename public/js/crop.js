// Interactive crop tool with draggable handles, aspect ratio lock, and rule-of-thirds grid
import { els, state } from './state.js';
import { saveState, resizeAndDraw } from './canvas.js';
import { setDrawingMode } from './draw.js';
import { setEraserMode } from './eraser.js';
import { executeCrop } from './filters.js';
import { compositeLayers } from './layers.js';

const { canvas, ctx, container, statusEl } = els;

const cropBtn = document.getElementById('crop-btn');
const cropPanel = document.getElementById('crop-panel');
const cropDims = document.getElementById('crop-dims');
const cropApplyBtn = document.getElementById('crop-apply-btn');
const cropCancelBtn = document.getElementById('crop-cancel-btn');
const cropAspectBtns = cropPanel.querySelectorAll('.crop-aspect-btn');

const HANDLE_SIZE = 8;
const HANDLE_HIT = 12;

const ASPECT_RATIOS = {
  free: null,
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:5': 4 / 5,
};

let cropRect = null;   // { x, y, w, h } in display canvas pixels
let dragging = null;    // 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'create'
let dragStart = null;   // { mx, my, rect: {...} }
let aspectRatio = null; // null = free, number = locked

export function setCropMode(active) {
  state.cropMode = active;
  cropBtn.classList.toggle('active', active);
  cropPanel.classList.toggle('visible', active);
  container.classList.toggle('crop-mode', active);
  if (active) {
    deactivateOtherTools();
    cropRect = null;
    aspectRatio = null;
    cropAspectBtns.forEach(b => b.classList.toggle('active', b.dataset.ratio === 'free'));
    cropPanel.querySelector('.crop-actions').classList.remove('visible');
    updateCropDims();
  }
  if (!active) {
    cropRect = null;
    dragging = null;
    resizeAndDraw();
  }
}

function deactivateOtherTools() {
  setDrawingMode(false);
  setEraserMode(false);

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

// --- Coordinate conversion ---
function canvasCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / (rect.width / canvas.width),
    y: (clientY - rect.top) / (rect.height / canvas.height),
  };
}

// --- Aspect ratio buttons ---
cropAspectBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    cropAspectBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const key = btn.dataset.ratio;
    aspectRatio = ASPECT_RATIOS[key];
    if (cropRect && aspectRatio) {
      enforceAspectRatio();
      redrawCrop();
    }
  });
});

function enforceAspectRatio() {
  if (!cropRect || !aspectRatio) return;
  const targetW = cropRect.h * aspectRatio;
  if (targetW <= canvas.width) {
    cropRect.w = targetW;
  } else {
    cropRect.w = canvas.width;
    cropRect.h = cropRect.w / aspectRatio;
  }
  cropRect.x = Math.min(cropRect.x, canvas.width - cropRect.w);
  cropRect.y = Math.min(cropRect.y, canvas.height - cropRect.h);
  cropRect.x = Math.max(0, cropRect.x);
  cropRect.y = Math.max(0, cropRect.y);
}

// --- Hit test for handles ---
function getHandle(mx, my) {
  if (!cropRect) return null;
  const { x, y, w, h } = cropRect;
  const handles = [
    { id: 'nw', hx: x, hy: y },
    { id: 'n',  hx: x + w / 2, hy: y },
    { id: 'ne', hx: x + w, hy: y },
    { id: 'e',  hx: x + w, hy: y + h / 2 },
    { id: 'se', hx: x + w, hy: y + h },
    { id: 's',  hx: x + w / 2, hy: y + h },
    { id: 'sw', hx: x, hy: y + h },
    { id: 'w',  hx: x, hy: y + h / 2 },
  ];
  // Scale hit area by display ratio
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const hitDist = HANDLE_HIT * scaleX;
  for (const h of handles) {
    if (Math.abs(mx - h.hx) < hitDist && Math.abs(my - h.hy) < hitDist) {
      return h.id;
    }
  }
  if (mx > x && mx < x + w && my > y && my < y + h) return 'move';
  return null;
}

function getCursorForHandle(handle) {
  const cursors = {
    nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
    e: 'e-resize', se: 'se-resize', s: 's-resize',
    sw: 'sw-resize', w: 'w-resize', move: 'move',
  };
  return cursors[handle] || 'crosshair';
}

// --- Drawing ---
function drawCropOverlay() {
  if (!cropRect) return;
  const { x, y, w, h } = cropRect;

  ctx.save();

  // Dim outside
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, canvas.width, y);
  ctx.fillRect(0, y + h, canvas.width, canvas.height - (y + h));
  ctx.fillRect(0, y, x, h);
  ctx.fillRect(x + w, y, canvas.width - (x + w), h);

  // Rule of thirds grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([]);
  for (let i = 1; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(x + (w * i) / 3, y);
    ctx.lineTo(x + (w * i) / 3, y + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + (h * i) / 3);
    ctx.lineTo(x + w, y + (h * i) / 3);
    ctx.stroke();
  }

  // Crop border
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(x, y, w, h);

  // Handles
  const handles = [
    [x, y], [x + w / 2, y], [x + w, y],
    [x + w, y + h / 2],
    [x + w, y + h], [x + w / 2, y + h], [x, y + h],
    [x, y + h / 2],
  ];

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.lineWidth = 1;
  for (const [hx, hy] of handles) {
    ctx.fillRect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.strokeRect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
  }

  ctx.restore();
}

function redrawCrop() {
  resizeAndDraw();
  drawCropOverlay();
  updateCropDims();
}

function updateCropDims() {
  if (!cropRect || cropRect.w < 2 || cropRect.h < 2) {
    cropDims.textContent = '';
    cropPanel.querySelector('.crop-actions').classList.remove('visible');
    return;
  }
  let scaleX = 1, scaleY = 1;
  if (state.layers.length > 0) {
    scaleX = state.layers[0].canvas.width / canvas.width;
    scaleY = state.layers[0].canvas.height / canvas.height;
  } else if (state.currentImg) {
    scaleX = state.currentImg.width / canvas.width;
    scaleY = state.currentImg.height / canvas.height;
  }
  const realW = Math.round(Math.abs(cropRect.w) * scaleX);
  const realH = Math.round(Math.abs(cropRect.h) * scaleY);
  cropDims.textContent = `${realW} × ${realH} px`;
  statusEl.textContent = `Crop: ${realW}×${realH}`;
  cropPanel.querySelector('.crop-actions').classList.add('visible');
}

// --- Mouse events ---
canvas.addEventListener('mousedown', (e) => {
  if (!state.cropMode || (state.layers.length === 0 && !state.currentImg) || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const pos = canvasCoords(e.clientX, e.clientY);
  const handle = getHandle(pos.x, pos.y);

  if (handle) {
    dragging = handle;
    dragStart = { mx: pos.x, my: pos.y, rect: { ...cropRect } };
  } else {
    dragging = 'create';
    cropRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
    dragStart = { mx: pos.x, my: pos.y, rect: { ...cropRect } };
  }
});

window.addEventListener('mousemove', (e) => {
  if (!state.cropMode) return;
  const pos = canvasCoords(e.clientX, e.clientY);

  if (!dragging) {
    const handle = getHandle(pos.x, pos.y);
    canvas.style.cursor = handle ? getCursorForHandle(handle) : (cropRect ? 'crosshair' : 'crosshair');
    return;
  }

  e.preventDefault();
  handleDrag(pos.x, pos.y);
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  finishDrag();
});

// --- Touch events ---
canvas.addEventListener('touchstart', (e) => {
  if (!state.cropMode || (state.layers.length === 0 && !state.currentImg)) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  e.stopPropagation();
  const pos = canvasCoords(e.touches[0].clientX, e.touches[0].clientY);
  const handle = getHandle(pos.x, pos.y);

  if (handle) {
    dragging = handle;
    dragStart = { mx: pos.x, my: pos.y, rect: { ...cropRect } };
  } else {
    dragging = 'create';
    cropRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
    dragStart = { mx: pos.x, my: pos.y, rect: { ...cropRect } };
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (!dragging || !state.cropMode) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  const pos = canvasCoords(e.touches[0].clientX, e.touches[0].clientY);
  handleDrag(pos.x, pos.y);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  if (dragging && state.cropMode && e.touches.length === 0) finishDrag();
}, { passive: true });

// --- Drag logic ---
function handleDrag(mx, my) {
  if (!dragStart) return;
  const dx = mx - dragStart.mx;
  const dy = my - dragStart.my;
  const r = dragStart.rect;

  if (dragging === 'create') {
    let newW = mx - r.x;
    let newH = my - r.y;
    if (aspectRatio) {
      const absW = Math.abs(newW);
      const absH = absW / aspectRatio;
      newH = newH >= 0 ? absH : -absH;
    }
    cropRect = normalizeRect({ x: r.x, y: r.y, w: newW, h: newH });
  } else if (dragging === 'move') {
    let nx = r.x + dx;
    let ny = r.y + dy;
    nx = Math.max(0, Math.min(canvas.width - r.w, nx));
    ny = Math.max(0, Math.min(canvas.height - r.h, ny));
    cropRect = { x: nx, y: ny, w: r.w, h: r.h };
  } else {
    resizeFromHandle(dx, dy);
  }

  clampRect();
  redrawCrop();
}

function resizeFromHandle(dx, dy) {
  const r = dragStart.rect;
  let x = r.x, y = r.y, w = r.w, h = r.h;

  if (dragging.includes('w')) { x = r.x + dx; w = r.w - dx; }
  if (dragging.includes('e')) { w = r.w + dx; }
  if (dragging.includes('n')) { y = r.y + dy; h = r.h - dy; }
  if (dragging.includes('s')) { h = r.h + dy; }

  // Midpoint handles: only resize in one axis (unless aspect locked)
  if (dragging === 'n' || dragging === 's') {
    if (!aspectRatio) { x = r.x; w = r.w; }
  }
  if (dragging === 'e' || dragging === 'w') {
    if (!aspectRatio) { y = r.y; h = r.h; }
  }

  if (aspectRatio) {
    if (dragging === 'n' || dragging === 's') {
      w = Math.abs(h) * aspectRatio;
      x = r.x + (r.w - w) / 2;
    } else if (dragging === 'e' || dragging === 'w') {
      h = Math.abs(w) / aspectRatio;
      y = r.y + (r.h - h) / 2;
    } else {
      w = Math.abs(h) * aspectRatio * Math.sign(w || 1);
    }
  }

  cropRect = normalizeRect({ x, y, w, h });
}

function normalizeRect(r) {
  let { x, y, w, h } = r;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return { x, y, w, h };
}

function clampRect() {
  if (!cropRect) return;
  cropRect.x = Math.max(0, cropRect.x);
  cropRect.y = Math.max(0, cropRect.y);
  if (cropRect.x + cropRect.w > canvas.width) cropRect.w = canvas.width - cropRect.x;
  if (cropRect.y + cropRect.h > canvas.height) cropRect.h = canvas.height - cropRect.y;
}

function finishDrag() {
  dragging = null;
  dragStart = null;
  if (cropRect && cropRect.w < 3 && cropRect.h < 3) {
    cropRect = null;
    resizeAndDraw();
  }
  updateCropDims();
}

// --- Apply crop ---
cropApplyBtn.addEventListener('click', applyCrop);

function applyCrop() {
  if (!cropRect || cropRect.w < 3 || cropRect.h < 3) return;
  if (state.layers.length === 0 && !state.currentImg) return;

  const { x, y, w, h } = cropRect;
  const cmd = {
    action: 'crop',
    x: (x / canvas.width) * 100,
    y: (y / canvas.height) * 100,
    width: (w / canvas.width) * 100,
    height: (h / canvas.height) * 100,
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
  } else {
    executeCrop(cmd);
    const snapshot = new Image();
    snapshot.onload = () => {
      state.currentImg = snapshot;
      saveState();
      resizeAndDraw();
      statusEl.textContent = `${snapshot.width}×${snapshot.height} cropped`;
    };
    snapshot.src = canvas.toDataURL('image/png');
  }

  setCropMode(false);
}

// --- Cancel ---
cropCancelBtn.addEventListener('click', () => setCropMode(false));

// --- Button toggle ---
cropBtn.addEventListener('click', () => {
  if (state.layers.length === 0 && !state.currentImg) return;
  setCropMode(!state.cropMode);
});

// --- Keyboard ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.cropMode) {
    setCropMode(false);
    return;
  }
  if (e.key === 'Enter' && state.cropMode && cropRect && cropRect.w > 3) {
    applyCrop();
    return;
  }
  if (e.key === 'c' || e.key === 'C') {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (state.layers.length === 0 && !state.currentImg) return;
    e.preventDefault();
    setCropMode(!state.cropMode);
  }
});
