import { els, state } from './state.js';
import { saveState } from './canvas.js';
import { getActiveLayer, getActiveCtx, compositeLayers } from './layers.js';

const { canvas, container, statusEl } = els;

const floodfillBtn = document.getElementById('floodfill-btn');
const floodfillPanel = document.getElementById('floodfill-panel');
const toleranceSlider = document.getElementById('floodfill-tolerance');
const toleranceValue = document.getElementById('floodfill-tolerance-value');
const antiAliasToggle = document.getElementById('floodfill-antialias');

export function setFloodFillMode(active) {
  state.floodFillMode = active;
  floodfillBtn.classList.toggle('active', active);
  floodfillPanel.classList.toggle('visible', active);
  container.classList.toggle('floodfill-mode', active);
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

    state.eyedropperMode = false;
    const eyedropperBtnEl = document.getElementById('eyedropper-btn');
    if (eyedropperBtnEl) eyedropperBtnEl.classList.remove('active');
    container.classList.remove('eyedropper-mode');

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
}

floodfillBtn.addEventListener('click', () => {
  if (state.layers.length === 0 && !state.currentImg) return;
  setFloodFillMode(!state.floodFillMode);
});

toleranceSlider.addEventListener('input', () => {
  state.floodFillTolerance = parseInt(toleranceSlider.value, 10);
  toleranceValue.textContent = toleranceSlider.value;
});

antiAliasToggle.addEventListener('change', () => {
  state.floodFillAntiAlias = antiAliasToggle.checked;
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

function hexToRgba(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b, a: 255 };
}

function colorDiff(data, idx, sr, sg, sb, sa) {
  return Math.abs(data[idx] - sr) +
         Math.abs(data[idx + 1] - sg) +
         Math.abs(data[idx + 2] - sb) +
         Math.abs(data[idx + 3] - sa);
}

function scanlineFill(layerCtx, startX, startY, fillColor, tolerance, width, height) {
  const imageData = layerCtx.getImageData(0, 0, width, height);
  const data = imageData.data;

  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;

  const startIdx = (startY * width + startX) * 4;
  const sr = data[startIdx];
  const sg = data[startIdx + 1];
  const sb = data[startIdx + 2];
  const sa = data[startIdx + 3];

  if (sr === fillColor.r && sg === fillColor.g && sb === fillColor.b && sa === fillColor.a && tolerance === 0) return;

  const visited = new Uint8Array(width * height);

  function matches(idx) {
    return colorDiff(data, idx * 4, sr, sg, sb, sa) <= tolerance;
  }

  const stack = [[startX, startY]];

  while (stack.length > 0) {
    let [x, y] = stack.pop();

    if (y < 0 || y >= height) continue;

    let left = x;
    while (left > 0 && !visited[(y * width + left - 1)] && matches(y * width + left - 1)) {
      left--;
    }

    let right = x;
    while (right < width - 1 && !visited[(y * width + right + 1)] && matches(y * width + right + 1)) {
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

      visited[pixIdx] = 1;
      const dataIdx = pixIdx * 4;
      data[dataIdx] = fillColor.r;
      data[dataIdx + 1] = fillColor.g;
      data[dataIdx + 2] = fillColor.b;
      data[dataIdx + 3] = fillColor.a;

      if (y > 0) {
        const aboveIdx = (y - 1) * width + i;
        if (!visited[aboveIdx] && matches(aboveIdx)) {
          if (!spanAbove) {
            stack.push([i, y - 1]);
            spanAbove = true;
          }
        } else {
          spanAbove = false;
        }
      }

      if (y < height - 1) {
        const belowIdx = (y + 1) * width + i;
        if (!visited[belowIdx] && matches(belowIdx)) {
          if (!spanBelow) {
            stack.push([i, y + 1]);
            spanBelow = true;
          }
        } else {
          spanBelow = false;
        }
      }
    }
  }

  layerCtx.putImageData(imageData, 0, 0);
}

function scanlineFillAntiAlias(layerCtx, startX, startY, fillColor, tolerance, width, height) {
  const imageData = layerCtx.getImageData(0, 0, width, height);
  const data = imageData.data;

  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return;

  const startIdx = (startY * width + startX) * 4;
  const sr = data[startIdx];
  const sg = data[startIdx + 1];
  const sb = data[startIdx + 2];
  const sa = data[startIdx + 3];

  if (sr === fillColor.r && sg === fillColor.g && sb === fillColor.b && sa === fillColor.a && tolerance === 0) return;

  const visited = new Uint8Array(width * height);
  const alphaMap = new Float32Array(width * height);

  function diff(idx) {
    return colorDiff(data, idx * 4, sr, sg, sb, sa);
  }

  const stack = [[startX, startY]];

  while (stack.length > 0) {
    let [x, y] = stack.pop();

    if (y < 0 || y >= height) continue;

    let left = x;
    while (left > 0 && !visited[(y * width + left - 1)] && diff(y * width + left - 1) <= tolerance) {
      left--;
    }

    let right = x;
    while (right < width - 1 && !visited[(y * width + right + 1)] && diff(y * width + right + 1) <= tolerance) {
      right++;
    }

    if (diff(y * width + left) > tolerance && left === x) {
      if (diff(y * width + x) > tolerance) continue;
      left = x;
    }
    if (diff(y * width + left) > tolerance) left++;

    let spanAbove = false;
    let spanBelow = false;

    for (let i = left; i <= right; i++) {
      const pixIdx = y * width + i;
      const d = diff(pixIdx);
      if (d > tolerance) {
        spanAbove = false;
        spanBelow = false;
        continue;
      }

      visited[pixIdx] = 1;
      alphaMap[pixIdx] = tolerance > 0 ? 1 - (d / (tolerance + 1)) : 1;

      if (y > 0) {
        const aboveIdx = (y - 1) * width + i;
        if (!visited[aboveIdx] && diff(aboveIdx) <= tolerance) {
          if (!spanAbove) {
            stack.push([i, y - 1]);
            spanAbove = true;
          }
        } else {
          spanAbove = false;
        }
      }

      if (y < height - 1) {
        const belowIdx = (y + 1) * width + i;
        if (!visited[belowIdx] && diff(belowIdx) <= tolerance) {
          if (!spanBelow) {
            stack.push([i, y + 1]);
            spanBelow = true;
          }
        } else {
          spanBelow = false;
        }
      }
    }
  }

  for (let i = 0; i < width * height; i++) {
    if (!visited[i]) continue;
    const alpha = alphaMap[i];
    const dataIdx = i * 4;
    data[dataIdx] = Math.round(fillColor.r * alpha + data[dataIdx] * (1 - alpha));
    data[dataIdx + 1] = Math.round(fillColor.g * alpha + data[dataIdx + 1] * (1 - alpha));
    data[dataIdx + 2] = Math.round(fillColor.b * alpha + data[dataIdx + 2] * (1 - alpha));
    data[dataIdx + 3] = Math.round(fillColor.a * alpha + data[dataIdx + 3] * (1 - alpha));
  }

  layerCtx.putImageData(imageData, 0, 0);
}

function doFill(clientX, clientY) {
  const layer = getActiveLayer();
  if (!layer) return;

  const pos = layerCoords(clientX, clientY);
  const w = layer.canvas.width;
  const h = layer.canvas.height;

  if (pos.x < 0 || pos.x >= w || pos.y < 0 || pos.y >= h) return;

  const fillColor = hexToRgba(state.brushColor);
  const layerCtx = getActiveCtx();

  if (state.floodFillAntiAlias) {
    scanlineFillAntiAlias(layerCtx, pos.x, pos.y, fillColor, state.floodFillTolerance, w, h);
  } else {
    scanlineFill(layerCtx, pos.x, pos.y, fillColor, state.floodFillTolerance, w, h);
  }

  compositeLayers();
  saveState();
  statusEl.textContent = `${w}×${h} — filled`;
}

canvas.addEventListener('mousedown', (e) => {
  if (!state.floodFillMode || (state.layers.length === 0 && !state.currentImg) || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  doFill(e.clientX, e.clientY);
});

canvas.addEventListener('touchstart', (e) => {
  if (!state.floodFillMode || (state.layers.length === 0 && !state.currentImg)) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  e.stopPropagation();
  doFill(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.floodFillMode) {
    setFloodFillMode(false);
  }
  if (e.key === 'b' || e.key === 'B') {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (state.layers.length === 0 && !state.currentImg) return;
    e.preventDefault();
    setFloodFillMode(!state.floodFillMode);
  }
});
