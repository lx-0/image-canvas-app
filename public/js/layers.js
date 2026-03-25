// Layer management, compositing, and layers panel UI
import { els, state } from './state.js';

// Callback for saving state (set by canvas.js to avoid circular deps)
let _saveState = () => {};
export function registerSaveState(fn) { _saveState = fn; }

// --- Layer creation ---

function createLayerObj(name, width, height) {
  const cvs = document.createElement('canvas');
  cvs.width = width;
  cvs.height = height;
  return {
    id: `${Date.now()}-${Math.random()}`,
    name,
    visible: true,
    opacity: 1.0,
    canvas: cvs,
    ctx: cvs.getContext('2d'),
  };
}

// Initialize a single Background layer from a loaded image
export function initLayersFromImage(img) {
  const layer = createLayerObj('Background', img.width, img.height);
  layer.ctx.drawImage(img, 0, 0);
  state.layers = [layer];
  state.activeLayerIndex = 0;
  renderLayersPanel();
}

// --- Compositing ---

// Composite all visible layers onto the display canvas (scaled to display size)
export function compositeLayers() {
  const { canvas, ctx } = els;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(layer.canvas, 0, 0, canvas.width, canvas.height);
  }
  ctx.globalAlpha = 1.0;
}

// Get a full-resolution flattened canvas (for export)
export function getFlattenedCanvas() {
  if (state.layers.length === 0) return null;
  const ref = state.layers[0].canvas;
  const c = document.createElement('canvas');
  c.width = ref.width;
  c.height = ref.height;
  const cx = c.getContext('2d');
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    cx.globalAlpha = layer.opacity;
    cx.drawImage(layer.canvas, 0, 0);
  }
  cx.globalAlpha = 1.0;
  return c;
}

// --- Active layer accessors ---

export function getActiveLayer() {
  if (!state.layers || state.layers.length === 0) return null;
  return state.layers[state.activeLayerIndex] || state.layers[0];
}

export function getActiveCanvas() {
  const layer = getActiveLayer();
  return layer ? layer.canvas : els.canvas;
}

export function getActiveCtx() {
  const layer = getActiveLayer();
  return layer ? layer.ctx : els.ctx;
}

// --- Layer operations ---

export function addLayer(name) {
  const ref = state.layers[0] || { canvas: els.canvas };
  const layer = createLayerObj(
    name || `Layer ${state.layers.length + 1}`,
    ref.canvas.width,
    ref.canvas.height
  );
  state.layers.splice(state.activeLayerIndex + 1, 0, layer);
  state.activeLayerIndex++;
  compositeLayers();
  renderLayersPanel();
  _saveState();
}

export function deleteLayer(index) {
  if (state.layers.length <= 1) return;
  state.layers.splice(index, 1);
  if (state.activeLayerIndex >= state.layers.length) {
    state.activeLayerIndex = state.layers.length - 1;
  }
  compositeLayers();
  renderLayersPanel();
  _saveState();
}

export function duplicateLayer(index) {
  const src = state.layers[index];
  if (!src) return;
  const dup = createLayerObj(src.name + ' copy', src.canvas.width, src.canvas.height);
  dup.opacity = src.opacity;
  dup.visible = src.visible;
  dup.ctx.drawImage(src.canvas, 0, 0);
  state.layers.splice(index + 1, 0, dup);
  state.activeLayerIndex = index + 1;
  compositeLayers();
  renderLayersPanel();
  _saveState();
}

export function toggleLayerVisibility(index) {
  state.layers[index].visible = !state.layers[index].visible;
  compositeLayers();
  renderLayersPanel();
}

export function setLayerOpacity(index, opacity) {
  state.layers[index].opacity = Math.max(0, Math.min(1, opacity));
  compositeLayers();
}

export function moveLayer(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= state.layers.length) return;
  const [layer] = state.layers.splice(fromIndex, 1);
  state.layers.splice(toIndex, 0, layer);
  if (state.activeLayerIndex === fromIndex) {
    state.activeLayerIndex = toIndex;
  } else if (state.activeLayerIndex > fromIndex && state.activeLayerIndex <= toIndex) {
    state.activeLayerIndex--;
  } else if (state.activeLayerIndex < fromIndex && state.activeLayerIndex >= toIndex) {
    state.activeLayerIndex++;
  }
  compositeLayers();
  renderLayersPanel();
  _saveState();
}

export function setActiveLayer(index) {
  if (index >= 0 && index < state.layers.length) {
    state.activeLayerIndex = index;
    renderLayersPanel();
  }
}

export function renameLayer(index, name) {
  state.layers[index].name = name;
  renderLayersPanel();
}

export function flattenLayers() {
  if (state.layers.length <= 1) return;
  const ref = state.layers[0].canvas;
  const flat = createLayerObj('Background', ref.width, ref.height);
  for (const layer of state.layers) {
    if (!layer.visible) continue;
    flat.ctx.globalAlpha = layer.opacity;
    flat.ctx.drawImage(layer.canvas, 0, 0);
  }
  flat.ctx.globalAlpha = 1.0;
  state.layers = [flat];
  state.activeLayerIndex = 0;
  compositeLayers();
  renderLayersPanel();
  _saveState();
}

// --- Undo/redo serialization ---

export function serializeLayerStack() {
  return state.layers.map(layer => ({
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    dataURL: layer.canvas.toDataURL('image/png'),
    width: layer.canvas.width,
    height: layer.canvas.height,
  }));
}

export function deserializeLayerStack(snapshot, activeIndex) {
  return new Promise((resolve) => {
    if (!snapshot || snapshot.length === 0) { resolve(); return; }
    const newLayers = new Array(snapshot.length);
    let loaded = 0;
    snapshot.forEach((s, i) => {
      const img = new Image();
      img.onload = () => {
        const layer = createLayerObj(s.name, s.width, s.height);
        layer.visible = s.visible;
        layer.opacity = s.opacity;
        layer.ctx.drawImage(img, 0, 0);
        newLayers[i] = layer;
        loaded++;
        if (loaded === snapshot.length) {
          state.layers = newLayers;
          state.activeLayerIndex = Math.min(activeIndex, state.layers.length - 1);
          compositeLayers();
          renderLayersPanel();
          resolve();
        }
      };
      img.src = s.dataURL;
    });
  });
}

// --- Panel visibility ---

export function toggleLayersPanel() {
  state.layersPanelVisible = !state.layersPanelVisible;
  const panel = document.getElementById('layers-panel');
  const btn = document.getElementById('layers-btn');
  if (panel) panel.classList.toggle('visible', state.layersPanelVisible);
  if (btn) btn.classList.toggle('active', state.layersPanelVisible);
}

// --- Render layers panel ---

function drawCheckerboard(ctx, w, h) {
  const sz = 5;
  for (let y = 0; y < h; y += sz) {
    for (let x = 0; x < w; x += sz) {
      ctx.fillStyle = ((x / sz + y / sz) % 2 === 0) ? '#ccc' : '#fff';
      ctx.fillRect(x, y, sz, sz);
    }
  }
}

export function renderLayersPanel() {
  const list = document.getElementById('layers-list');
  if (!list) return;
  list.innerHTML = '';

  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    const isActive = i === state.activeLayerIndex;

    const item = document.createElement('div');
    item.className = 'layer-item' + (isActive ? ' active' : '');
    item.dataset.index = i;

    // Visibility toggle
    const visBtn = document.createElement('button');
    visBtn.className = 'layer-vis-btn';
    visBtn.textContent = layer.visible ? '\u{1F441}' : '\u25CC';
    visBtn.title = layer.visible ? 'Hide layer' : 'Show layer';
    visBtn.setAttribute('aria-label', `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`);
    visBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleLayerVisibility(i); });

    // Thumbnail
    const thumb = document.createElement('canvas');
    thumb.className = 'layer-thumb';
    thumb.width = 40;
    thumb.height = 30;
    const tCtx = thumb.getContext('2d');
    drawCheckerboard(tCtx, 40, 30);
    if (layer.canvas.width > 0 && layer.canvas.height > 0) {
      const sc = Math.min(40 / layer.canvas.width, 30 / layer.canvas.height);
      const tw = layer.canvas.width * sc;
      const th = layer.canvas.height * sc;
      tCtx.drawImage(layer.canvas, (40 - tw) / 2, (30 - th) / 2, tw, th);
    }

    // Name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'layer-name';
    nameSpan.textContent = layer.name;
    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'layer-name-input';
      input.value = layer.name;
      nameSpan.replaceWith(input);
      input.focus();
      input.select();
      const finish = () => renameLayer(i, input.value.trim() || layer.name);
      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') input.blur();
        if (ke.key === 'Escape') { input.value = layer.name; input.blur(); }
      });
    });

    // Opacity slider
    const opSlider = document.createElement('input');
    opSlider.type = 'range';
    opSlider.className = 'layer-opacity';
    opSlider.min = '0';
    opSlider.max = '1';
    opSlider.step = '0.05';
    opSlider.value = String(layer.opacity);
    opSlider.title = `Opacity: ${Math.round(layer.opacity * 100)}%`;
    opSlider.setAttribute('aria-label', `${layer.name} opacity`);
    opSlider.addEventListener('input', (e) => {
      e.stopPropagation();
      setLayerOpacity(i, parseFloat(opSlider.value));
      opSlider.title = `Opacity: ${Math.round(opSlider.value * 100)}%`;
    });

    // Reorder buttons
    const moveBtns = document.createElement('div');
    moveBtns.className = 'layer-move-btns';

    const moveUp = document.createElement('button');
    moveUp.className = 'layer-move-btn';
    moveUp.textContent = '\u25B2';
    moveUp.title = 'Move up';
    moveUp.disabled = i === state.layers.length - 1;
    moveUp.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(i, i + 1); });

    const moveDown = document.createElement('button');
    moveDown.className = 'layer-move-btn';
    moveDown.textContent = '\u25BC';
    moveDown.title = 'Move down';
    moveDown.disabled = i === 0;
    moveDown.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(i, i - 1); });

    moveBtns.appendChild(moveUp);
    moveBtns.appendChild(moveDown);

    // Click to select
    item.addEventListener('click', () => setActiveLayer(i));

    item.appendChild(visBtn);
    item.appendChild(thumb);
    item.appendChild(nameSpan);
    item.appendChild(opSlider);
    item.appendChild(moveBtns);
    list.appendChild(item);
  }
}

// --- Initialize panel buttons ---

export function initLayersPanel() {
  const addBtn = document.getElementById('layer-add-btn');
  const deleteBtn = document.getElementById('layer-delete-btn');
  const flattenBtn = document.getElementById('layer-flatten-btn');
  const layersBtn = document.getElementById('layers-btn');

  if (addBtn) addBtn.addEventListener('click', () => addLayer());
  if (deleteBtn) deleteBtn.addEventListener('click', () => deleteLayer(state.activeLayerIndex));
  if (flattenBtn) flattenBtn.addEventListener('click', () => flattenLayers());
  if (layersBtn) layersBtn.addEventListener('click', () => toggleLayersPanel());
}
