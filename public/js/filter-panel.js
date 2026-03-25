// Filter adjustment panel with live preview
import { els, state } from './state.js';
import { saveState } from './canvas.js';
import { announce } from './ui.js';

const { canvas, ctx } = els;

// Filter definitions: id, label, min, max, step, default, unit
const FILTERS = [
  { id: 'brightness',  label: 'Brightness',  min: -100, max: 100, step: 1, def: 0,   unit: '' },
  { id: 'contrast',    label: 'Contrast',    min: -100, max: 100, step: 1, def: 0,   unit: '' },
  { id: 'saturation',  label: 'Saturation',  min: -100, max: 100, step: 1, def: 0,   unit: '' },
  { id: 'blur',        label: 'Blur',        min: 0,    max: 10,  step: 1, def: 0,   unit: 'px' },
  { id: 'sharpen',     label: 'Sharpen',     min: 0,    max: 3,   step: 0.1, def: 0, unit: '' },
  { id: 'shadows',     label: 'Shadows',     min: -100, max: 100, step: 1, def: 0,   unit: '' },
  { id: 'highlights',  label: 'Highlights',  min: -100, max: 100, step: 1, def: 0,   unit: '' },
];

let originalImageData = null;
let panelVisible = false;
const sliderValues = {};

// DOM references
const panel = document.getElementById('filter-panel');
const filterBtn = document.getElementById('filter-btn');
const applyBtn = document.getElementById('filter-apply-btn');
const resetBtn = document.getElementById('filter-reset-btn');
const cancelBtn = document.getElementById('filter-cancel-btn');

// Build slider rows
function buildSliders() {
  const slidersContainer = document.getElementById('filter-sliders');
  for (const f of FILTERS) {
    sliderValues[f.id] = f.def;

    const row = document.createElement('div');
    row.className = 'filter-row';

    const label = document.createElement('label');
    label.className = 'filter-label';
    label.textContent = f.label;
    label.setAttribute('for', `filter-${f.id}`);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = `filter-${f.id}`;
    slider.className = 'filter-slider';
    slider.min = f.min;
    slider.max = f.max;
    slider.step = f.step;
    slider.value = f.def;
    slider.setAttribute('aria-label', `${f.label} adjustment`);

    const valueSpan = document.createElement('span');
    valueSpan.className = 'filter-value';
    valueSpan.id = `filter-${f.id}-value`;
    valueSpan.textContent = f.def + f.unit;

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      sliderValues[f.id] = val;
      valueSpan.textContent = (Number.isInteger(val) ? val : val.toFixed(1)) + f.unit;
      applyPreview();
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(valueSpan);
    slidersContainer.appendChild(row);
  }
}

function hasChanges() {
  return FILTERS.some(f => sliderValues[f.id] !== f.def);
}

// Apply all filter adjustments to a copy of originalImageData and render
function applyPreview() {
  if (!originalImageData) return;

  // Clone original data
  const imgData = new ImageData(
    new Uint8ClampedArray(originalImageData.data),
    originalImageData.width,
    originalImageData.height
  );
  const data = imgData.data;
  const w = imgData.width;
  const h = imgData.height;

  // Brightness
  const brightness = sliderValues.brightness;
  if (brightness !== 0) {
    const factor = (brightness / 100) * 255;
    for (let i = 0; i < data.length; i += 4) {
      data[i]     = Math.max(0, Math.min(255, data[i] + factor));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + factor));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + factor));
    }
  }

  // Contrast
  const contrast = sliderValues.contrast;
  if (contrast !== 0) {
    const cFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    for (let i = 0; i < data.length; i += 4) {
      data[i]     = Math.max(0, Math.min(255, cFactor * (data[i] - 128) + 128));
      data[i + 1] = Math.max(0, Math.min(255, cFactor * (data[i + 1] - 128) + 128));
      data[i + 2] = Math.max(0, Math.min(255, cFactor * (data[i + 2] - 128) + 128));
    }
  }

  // Saturation
  const saturation = sliderValues.saturation;
  if (saturation !== 0) {
    const sFactor = 1 + saturation / 100;
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      data[i]     = Math.max(0, Math.min(255, gray + (data[i] - gray) * sFactor));
      data[i + 1] = Math.max(0, Math.min(255, gray + (data[i + 1] - gray) * sFactor));
      data[i + 2] = Math.max(0, Math.min(255, gray + (data[i + 2] - gray) * sFactor));
    }
  }

  // Shadows & Highlights
  const shadows = sliderValues.shadows / 100;
  const highlights = sliderValues.highlights / 100;
  if (shadows !== 0 || highlights !== 0) {
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let val = data[i + c] / 255;
        if (shadows !== 0) val += shadows * (1 - val) * 0.5;
        if (highlights !== 0) val += highlights * val * 0.5;
        data[i + c] = Math.max(0, Math.min(255, val * 255));
      }
    }
  }

  // Sharpen (applied before blur so blur can soften sharpening artifacts)
  const sharpenAmt = sliderValues.sharpen;
  if (sharpenAmt > 0) {
    const orig = new Uint8ClampedArray(data);
    const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        for (let c = 0; c < 3; c++) {
          let val = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              val += orig[((y + ky) * w + (x + kx)) * 4 + c] * kernel[(ky + 1) * 3 + (kx + 1)];
            }
          }
          const idx = (y * w + x) * 4 + c;
          data[idx] = Math.max(0, Math.min(255, orig[idx] + (val - orig[idx]) * sharpenAmt));
        }
      }
    }
  }

  // Blur (box blur, 2-pass)
  const blurRadius = Math.round(sliderValues.blur);
  if (blurRadius > 0) {
    for (let pass = 0; pass < 2; pass++) {
      const src = new Uint8ClampedArray(data);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0, count = 0;
          for (let dy = -blurRadius; dy <= blurRadius; dy++) {
            for (let dx = -blurRadius; dx <= blurRadius; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                const idx = (ny * w + nx) * 4;
                r += src[idx]; g += src[idx + 1]; b += src[idx + 2];
                count++;
              }
            }
          }
          const idx = (y * w + x) * 4;
          data[idx] = r / count;
          data[idx + 1] = g / count;
          data[idx + 2] = b / count;
        }
      }
    }
  }

  // Render preview
  ctx.putImageData(imgData, 0, 0);
}

function resetSliders() {
  for (const f of FILTERS) {
    sliderValues[f.id] = f.def;
    const slider = document.getElementById(`filter-${f.id}`);
    const valueSpan = document.getElementById(`filter-${f.id}-value`);
    if (slider) slider.value = f.def;
    if (valueSpan) valueSpan.textContent = f.def + f.unit;
  }
}

export function openFilterPanel() {
  if (!state.currentImg) return;
  if (panelVisible) return;

  // Capture original canvas state
  originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  resetSliders();

  panelVisible = true;
  state.filterMode = true;
  panel.classList.add('visible');
  filterBtn.classList.add('active');
  announce('Filter adjustments panel opened');
}

export function closeFilterPanel(apply) {
  if (!panelVisible) return;

  if (apply && hasChanges()) {
    // Preview is already on canvas; snapshot for undo history
    const snapshot = new Image();
    snapshot.onload = () => {
      state.currentImg = snapshot;
      saveState();
    };
    snapshot.src = canvas.toDataURL('image/png');
    announce('Filters applied');
  } else {
    // Restore original
    if (originalImageData) {
      ctx.putImageData(originalImageData, 0, 0);
    }
    announce('Filter adjustments cancelled');
  }

  originalImageData = null;
  panelVisible = false;
  state.filterMode = false;
  panel.classList.remove('visible');
  filterBtn.classList.remove('active');
}

export function toggleFilterPanel() {
  if (panelVisible) {
    closeFilterPanel(false);
  } else {
    openFilterPanel();
  }
}

export function isFilterPanelOpen() {
  return panelVisible;
}

// Initialize
export function initFilterPanel() {
  buildSliders();

  filterBtn.addEventListener('click', toggleFilterPanel);
  applyBtn.addEventListener('click', () => closeFilterPanel(true));
  cancelBtn.addEventListener('click', () => closeFilterPanel(false));
  resetBtn.addEventListener('click', () => {
    resetSliders();
    applyPreview();
    announce('Filter sliders reset to defaults');
  });
}
