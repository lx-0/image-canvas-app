// Transform handles — 8 draggable handles around the canvas for interactive resize
import { els, state } from './state.js';
import { executeResize } from './filters.js';
import { saveState, resizeAndDraw } from './canvas.js';

const { canvas, container, statusEl } = els;

const HANDLE_SIZE = 10; // px
const MIN_SIZE = 20;    // minimum canvas dimension in px

// Handle definitions: id, x-fraction, y-fraction, resize axis, CSS cursor
const HANDLES = [
  { id: 'nw', xf: 0,   yf: 0,   axis: 'corner', cursor: 'nwse-resize' },
  { id: 'n',  xf: 0.5, yf: 0,   axis: 'y',      cursor: 'ns-resize' },
  { id: 'ne', xf: 1,   yf: 0,   axis: 'corner', cursor: 'nesw-resize' },
  { id: 'e',  xf: 1,   yf: 0.5, axis: 'x',      cursor: 'ew-resize' },
  { id: 'se', xf: 1,   yf: 1,   axis: 'corner', cursor: 'nwse-resize' },
  { id: 's',  xf: 0.5, yf: 1,   axis: 'y',      cursor: 'ns-resize' },
  { id: 'sw', xf: 0,   yf: 1,   axis: 'corner', cursor: 'nesw-resize' },
  { id: 'w',  xf: 0,   yf: 0.5, axis: 'x',      cursor: 'ew-resize' },
];

let handlesWrap = null;
let handleEls = {};
let previewEl = null;
let drag = null;

// --- Public API ---

export function initTransformHandles() {
  // Handles container (pointer-events: none, children are auto)
  handlesWrap = document.createElement('div');
  handlesWrap.id = 'transform-handles';
  container.appendChild(handlesWrap);

  // Create individual handle elements
  HANDLES.forEach(h => {
    const el = document.createElement('div');
    el.className = 'transform-handle';
    el.dataset.handle = h.id;
    el.style.cursor = h.cursor;
    handlesWrap.appendChild(el);
    handleEls[h.id] = el;

    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      beginDrag(h, e.clientX, e.clientY);
    });

    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      beginDrag(h, e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
  });

  // Dashed preview outline shown during drag
  previewEl = document.createElement('div');
  previewEl.id = 'transform-preview';
  container.appendChild(previewEl);

  // Global drag listeners
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onDragEnd);
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onDragEnd);

  // Auto-update positions when canvas resizes or transforms
  new ResizeObserver(() => positionHandles()).observe(canvas);
  new MutationObserver(() => positionHandles()).observe(canvas, {
    attributes: true, attributeFilter: ['style', 'width', 'height'],
  });
  // Detect draw-mode / select-mode class toggles on the container
  new MutationObserver(() => positionHandles()).observe(container, {
    attributes: true, attributeFilter: ['class'],
  });

  positionHandles();
}

export function positionHandles() {
  if (!handlesWrap) return;

  const visible = state.currentImg && !state.drawingMode && !state.selectMode && !drag;
  handlesWrap.style.display = visible ? '' : 'none';
  if (!visible) return;

  const cr = canvas.getBoundingClientRect();
  const pr = container.getBoundingClientRect();
  const l = cr.left - pr.left;
  const t = cr.top - pr.top;
  const w = cr.width;
  const h = cr.height;

  HANDLES.forEach(hd => {
    const el = handleEls[hd.id];
    el.style.left = (l + w * hd.xf - HANDLE_SIZE / 2) + 'px';
    el.style.top  = (t + h * hd.yf - HANDLE_SIZE / 2) + 'px';
  });
}

// --- Drag lifecycle ---

function beginDrag(handle, clientX, clientY) {
  if (state.drawingMode || state.selectMode) return;

  const cr = canvas.getBoundingClientRect();
  const pr = container.getBoundingClientRect();

  // Anchor = opposite corner/edge (stays fixed during resize)
  const ax = cr.left + cr.width  * (handle.axis === 'y' ? 0.5 : (1 - handle.xf));
  const ay = cr.top  + cr.height * (handle.axis === 'x' ? 0.5 : (1 - handle.yf));

  drag = {
    handle,
    ax, ay,
    startW: cr.width,
    startH: cr.height,
    containerLeft: pr.left,
    containerTop: pr.top,
    aspect: cr.width / cr.height,
    newW: cr.width,
    newH: cr.height,
  };

  previewEl.style.display = 'block';
  document.body.style.cursor = handle.cursor;
  handlesWrap.style.display = 'none';
}

function onMouseMove(e) {
  if (!drag) return;
  e.preventDefault();
  computePreview(e.clientX, e.clientY);
}

function onTouchMove(e) {
  if (!drag) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  computePreview(e.touches[0].clientX, e.touches[0].clientY);
}

function computePreview(mx, my) {
  const { handle, ax, ay, startW, startH, aspect, containerLeft, containerTop } = drag;

  const dirX = handle.xf >= 0.5 ? 1 : -1;
  const dirY = handle.yf >= 0.5 ? 1 : -1;
  const minVisual = MIN_SIZE * state.zoomLevel;

  let nw, nh;

  if (handle.axis === 'corner') {
    // Proportional: width-dominant, preserve aspect ratio
    nw = Math.max(minVisual, (mx - ax) * dirX);
    nh = nw / aspect;
    if (nh < minVisual) { nh = minVisual; nw = nh * aspect; }
  } else if (handle.axis === 'x') {
    nw = Math.max(minVisual, (mx - ax) * dirX);
    nh = startH;
  } else {
    nh = Math.max(minVisual, (my - ay) * dirY);
    nw = startW;
  }

  // Compute preview position (anchor side stays fixed)
  let nl, nt;

  if (handle.xf === 0)        nl = ax - nw - containerLeft;   // left handle: right edge anchored
  else if (handle.xf === 1)   nl = ax - containerLeft;        // right handle: left edge anchored
  else                         nl = ax - nw / 2 - containerLeft; // center: stay centered

  if (handle.yf === 0)        nt = ay - nh - containerTop;
  else if (handle.yf === 1)   nt = ay - containerTop;
  else                         nt = ay - nh / 2 - containerTop;

  previewEl.style.left   = nl + 'px';
  previewEl.style.top    = nt + 'px';
  previewEl.style.width  = nw + 'px';
  previewEl.style.height = nh + 'px';

  drag.newW = nw;
  drag.newH = nh;
}

function onDragEnd() {
  if (!drag) return;

  const { newW, newH, startW, startH } = drag;
  const scaleX = newW / startW;
  const scaleY = newH / startH;
  const finalW = Math.max(MIN_SIZE, Math.round(canvas.width * scaleX));
  const finalH = Math.max(MIN_SIZE, Math.round(canvas.height * scaleY));

  previewEl.style.display = 'none';
  document.body.style.cursor = '';
  drag = null;

  if (finalW !== canvas.width || finalH !== canvas.height) {
    executeResize({ width: finalW, height: finalH });

    const snapshot = new Image();
    snapshot.onload = () => {
      state.currentImg = snapshot;
      saveState();
      resizeAndDraw();
      positionHandles();
      statusEl.textContent = `${snapshot.width}×${snapshot.height} resized`;
    };
    snapshot.src = canvas.toDataURL('image/png');
  } else {
    positionHandles();
  }
}
