// Grid overlay — toggleable grid lines on canvas with snap-to-grid support
import { els, state } from './state.js';
import { registerPostComposite, compositeLayers } from './layers.js';
import { announce } from './ui.js';

const STORAGE_KEY = 'imgcanvas_grid';
const GRID_PRESETS = [8, 16, 32, 64];

const gridBtn = document.getElementById('grid-btn');
const gridPanel = document.getElementById('grid-panel');
const gridSizeSelect = document.getElementById('grid-size-select');
const gridCustomSize = document.getElementById('grid-custom-size');
const gridSnapToggle = document.getElementById('grid-snap-toggle');

// --- Persistence ---

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (typeof s.gridVisible === 'boolean') state.gridVisible = s.gridVisible;
    if (typeof s.gridSize === 'number' && s.gridSize >= 2) state.gridSize = s.gridSize;
    if (typeof s.gridSnap === 'boolean') state.gridSnap = s.gridSnap;
  } catch { /* ignore corrupt data */ }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    gridVisible: state.gridVisible,
    gridSize: state.gridSize,
    gridSnap: state.gridSnap,
  }));
}

// --- Grid rendering ---

function drawGrid(ctx, canvas) {
  if (!state.gridVisible) return;

  const docW = state.layers.length > 0 ? state.layers[0].canvas.width : canvas.width;
  const docH = state.layers.length > 0 ? state.layers[0].canvas.height : canvas.height;
  const scaleX = canvas.width / docW;
  const scaleY = canvas.height / docH;

  let effectiveSize = state.gridSize;
  const screenSize = effectiveSize * scaleX * state.zoomLevel;
  if (screenSize < 4) {
    const multiplier = Math.ceil(4 / screenSize);
    effectiveSize = state.gridSize * multiplier;
  }

  const stepX = effectiveSize * scaleX;
  const stepY = effectiveSize * scaleY;

  ctx.save();
  ctx.strokeStyle = '#888888';
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 0.5;

  ctx.beginPath();
  for (let x = stepX; x < canvas.width; x += stepX) {
    const px = Math.round(x) + 0.5;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, canvas.height);
  }
  for (let y = stepY; y < canvas.height; y += stepY) {
    const py = Math.round(y) + 0.5;
    ctx.moveTo(0, py);
    ctx.lineTo(canvas.width, py);
  }
  ctx.stroke();
  ctx.restore();
}

// --- Snap-to-grid ---

export function snapToGrid(value) {
  if (!state.gridSnap || !state.gridVisible) return value;
  return Math.round(value / state.gridSize) * state.gridSize;
}

export function snapPointToGrid(x, y) {
  return { x: snapToGrid(x), y: snapToGrid(y) };
}

// --- Toggle ---

export function toggleGrid() {
  state.gridVisible = !state.gridVisible;
  syncUI();
  saveSettings();
  if (state.layers.length > 0) compositeLayers();
  announce(state.gridVisible ? 'Grid enabled' : 'Grid disabled');
}

export function toggleGridPanel() {
  const isOpen = gridPanel.classList.contains('visible');
  gridPanel.classList.toggle('visible', !isOpen);
}

function syncUI() {
  if (gridBtn) gridBtn.classList.toggle('active', state.gridVisible);

  if (gridSizeSelect) {
    const isPreset = GRID_PRESETS.includes(state.gridSize);
    gridSizeSelect.value = isPreset ? String(state.gridSize) : 'custom';
    if (gridCustomSize) {
      gridCustomSize.style.display = isPreset ? 'none' : 'inline-block';
      gridCustomSize.value = state.gridSize;
    }
  }

  if (gridSnapToggle) gridSnapToggle.checked = state.gridSnap;
}

// --- Event wiring ---

function initGrid() {
  loadSettings();

  registerPostComposite(drawGrid);

  if (gridBtn) {
    gridBtn.addEventListener('click', () => {
      toggleGrid();
      toggleGridPanel();
    });
  }

  if (gridSizeSelect) {
    gridSizeSelect.addEventListener('change', () => {
      const val = gridSizeSelect.value;
      if (val === 'custom') {
        if (gridCustomSize) {
          gridCustomSize.style.display = 'inline-block';
          gridCustomSize.focus();
        }
      } else {
        state.gridSize = parseInt(val, 10);
        if (gridCustomSize) gridCustomSize.style.display = 'none';
        saveSettings();
        if (state.layers.length > 0) compositeLayers();
      }
    });
  }

  if (gridCustomSize) {
    const applyCustom = () => {
      const v = parseInt(gridCustomSize.value, 10);
      if (v >= 2 && v <= 512) {
        state.gridSize = v;
        saveSettings();
        if (state.layers.length > 0) compositeLayers();
      }
    };
    gridCustomSize.addEventListener('change', applyCustom);
    gridCustomSize.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyCustom();
    });
  }

  if (gridSnapToggle) {
    gridSnapToggle.addEventListener('change', () => {
      state.gridSnap = gridSnapToggle.checked;
      saveSettings();
      announce(state.gridSnap ? 'Snap to grid enabled' : 'Snap to grid disabled');
    });
  }

  syncUI();
}

initGrid();

export { toggleGrid as setGridVisible };
