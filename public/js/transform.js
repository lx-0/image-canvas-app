// Transform handles — 8 draggable handles around the canvas for interactive resize (layer-aware)
import { els, state } from './state.js';
import { executeResize } from './filters.js';
import { saveState, resizeAndDraw } from './canvas.js';
import { compositeLayers } from './layers.js';

const { canvas, container, statusEl } = els;

const HANDLE_SIZE = 10; // px
const MIN_SIZE = 20;    // minimum canvas dimension in px

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

export function initTransformHandles() {
  handlesWrap = document.createElement('div');
  handlesWrap.id = 'transform-handles';
  container.appendChild(handlesWrap);

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

  previewEl = document.createElement('div');
  previewEl.id = 'transform-preview';
  container.appendChild(previewEl);

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onDragEnd);
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onDragEnd);

  new ResizeObserver(() => positionHandles()).observe(canvas);
  new MutationObserver(() => positionHandles()).observe(canvas, {
    attributes: true, attributeFilter: ['style', 'width', 'height'],
  });
  new MutationObserver(() => positionHandles()).observe(container, {
    attributes: true, attributeFilter: ['class'],
  });

  positionHandles();
}

export function positionHandles() {
  if (!handlesWrap) return;

  const hasContent = state.layers.length > 0 || !!state.currentImg;
  const visible = hasContent && !state.drawingMode && !state.selectMode && !drag;
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

function beginDrag(handle, clientX, clientY) {
  if (state.drawingMode || state.selectMode) return;

  const cr = canvas.getBoundingClientRect();
  const pr = container.getBoundingClientRect();

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

  let nl, nt;

  if (handle.xf === 0)        nl = ax - nw - containerLeft;
  else if (handle.xf === 1)   nl = ax - containerLeft;
  else                         nl = ax - nw / 2 - containerLeft;

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

  previewEl.style.display = 'none';
  document.body.style.cursor = '';
  drag = null;

  // Compute final dimensions in layer space (or display space if no layers)
  let refW, refH;
  if (state.layers.length > 0) {
    refW = state.layers[0].canvas.width;
    refH = state.layers[0].canvas.height;
  } else {
    refW = canvas.width;
    refH = canvas.height;
  }
  const finalW = Math.max(MIN_SIZE, Math.round(refW * scaleX));
  const finalH = Math.max(MIN_SIZE, Math.round(refH * scaleY));

  if (finalW !== refW || finalH !== refH) {
    const cmd = { width: finalW, height: finalH };

    if (state.layers.length > 0) {
      // Resize all layers
      for (const layer of state.layers) {
        executeResize(cmd, layer.canvas, layer.ctx);
      }
      compositeLayers();
      resizeAndDraw();
      saveState();
      positionHandles();
      statusEl.textContent = `${finalW}\u00D7${finalH} resized`;
    } else {
      executeResize(cmd);
      const snapshot = new Image();
      snapshot.onload = () => {
        state.currentImg = snapshot;
        saveState();
        resizeAndDraw();
        positionHandles();
        statusEl.textContent = `${snapshot.width}\u00D7${snapshot.height} resized`;
      };
      snapshot.src = canvas.toDataURL('image/png');
    }
  } else {
    positionHandles();
  }
}
