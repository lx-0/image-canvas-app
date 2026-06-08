// Color swatches panel — save, organize, and reuse colors with localStorage persistence
import { state } from './state.js';

const STORAGE_KEY = 'imgcanvas_swatches';

const DEFAULT_PALETTE = [
  '#000000', '#ffffff', '#e94560', '#ff6b6b', '#f59e0b', '#fbbf24',
  '#10b981', '#34d399', '#3b82f6', '#60a5fa', '#8b5cf6', '#a78bfa',
  '#ec4899', '#f472b6', '#6b7280', '#9ca3af', '#78350f', '#92400e',
  '#064e3b', '#065f46', '#1e3a5f', '#1e40af',
];

const swatchesBtn = document.getElementById('swatches-btn');
const swatchesPanel = document.getElementById('swatches-panel');
const swatchesGrid = document.getElementById('swatches-grid');
const addBtn = document.getElementById('swatch-add-btn');

let swatches = [];
let focusIndex = -1;

function loadSwatches() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        swatches = parsed;
        return;
      }
    }
  } catch (_) { /* use defaults */ }
  swatches = [...DEFAULT_PALETTE];
  saveSwatches();
}

function saveSwatches() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(swatches));
  } catch (_) { /* storage full — ignore */ }
}

function renderSwatches() {
  swatchesGrid.innerHTML = '';
  swatches.forEach((color, i) => {
    const btn = document.createElement('button');
    btn.className = 'swatch-item';
    btn.style.background = color;
    btn.dataset.index = i;
    btn.dataset.color = color;
    btn.setAttribute('role', 'gridcell');
    btn.setAttribute('aria-label', `Color ${color}`);
    btn.setAttribute('tabindex', '-1');
    if (color === state.brushColor) btn.classList.add('active');
    swatchesGrid.appendChild(btn);
  });
}

function selectSwatch(color) {
  state.brushColor = color;
  const customInput = document.getElementById('brush-color-custom');
  if (customInput) customInput.value = color;
  const drawSwatches = document.querySelectorAll('#draw-panel .color-swatch');
  drawSwatches.forEach(s => {
    s.classList.toggle('active', s.dataset.color === color);
  });
  renderSwatches();
}

function addCurrentColor() {
  const color = state.brushColor || '#000000';
  if (!swatches.includes(color)) {
    swatches.push(color);
    saveSwatches();
    renderSwatches();
  }
}

function removeSwatch(index) {
  if (index >= 0 && index < swatches.length) {
    swatches.splice(index, 1);
    saveSwatches();
    renderSwatches();
    if (focusIndex >= swatches.length) focusIndex = swatches.length - 1;
  }
}

export function toggleSwatchesPanel() {
  const visible = swatchesPanel.classList.toggle('visible');
  swatchesBtn.classList.toggle('active', visible);
  if (visible) {
    renderSwatches();
    focusIndex = -1;
  }
}

// Click on grid — select or delete (right-click)
swatchesGrid.addEventListener('click', (e) => {
  const item = e.target.closest('.swatch-item');
  if (!item) return;
  selectSwatch(item.dataset.color);
});

swatchesGrid.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('.swatch-item');
  if (!item) return;
  e.preventDefault();
  removeSwatch(parseInt(item.dataset.index, 10));
});

addBtn.addEventListener('click', addCurrentColor);

swatchesBtn.addEventListener('click', toggleSwatchesPanel);

// Keyboard navigation within the grid
swatchesGrid.addEventListener('keydown', (e) => {
  const items = swatchesGrid.querySelectorAll('.swatch-item');
  if (items.length === 0) return;

  const cols = Math.max(1, Math.floor(swatchesGrid.clientWidth / 28));

  if (e.key === 'ArrowRight') {
    e.preventDefault();
    focusIndex = Math.min(focusIndex + 1, items.length - 1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    focusIndex = Math.max(focusIndex - 1, 0);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusIndex = Math.min(focusIndex + cols, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusIndex = Math.max(focusIndex - cols, 0);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (focusIndex >= 0 && focusIndex < items.length) {
      selectSwatch(items[focusIndex].dataset.color);
    }
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (focusIndex >= 0 && focusIndex < items.length) {
      removeSwatch(parseInt(items[focusIndex].dataset.index, 10));
    }
  } else {
    return;
  }

  // Update visual focus
  items.forEach(it => it.classList.remove('focused'));
  if (focusIndex >= 0 && focusIndex < swatchesGrid.querySelectorAll('.swatch-item').length) {
    const updated = swatchesGrid.querySelectorAll('.swatch-item');
    updated[focusIndex].classList.add('focused');
    updated[focusIndex].focus();
  }
});

swatchesGrid.addEventListener('focus', () => {
  if (focusIndex < 0) {
    focusIndex = 0;
    const items = swatchesGrid.querySelectorAll('.swatch-item');
    if (items.length > 0) {
      items[0].classList.add('focused');
      items[0].focus();
    }
  }
});

// K key to toggle
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && swatchesPanel.classList.contains('visible')) {
    swatchesPanel.classList.remove('visible');
    swatchesBtn.classList.remove('active');
    return;
  }
  if (e.key === 'k' || e.key === 'K') {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    toggleSwatchesPanel();
  }
});

// Initialize
loadSwatches();
