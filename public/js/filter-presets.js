// Batch filter presets — built-in named presets + custom user presets via localStorage
import { state } from './state.js';
import { executeCommands } from './commands.js';
import { saveState } from './canvas.js';
import { announce } from './ui.js';
import { compositeLayers } from './layers.js';

const STORAGE_KEY = 'imagecanvas-custom-presets';

const BUILT_IN_PRESETS = [
  {
    name: 'Vintage',
    commands: [
      { action: 'sepia' },
      { action: 'vignette', strength: 0.5 },
      { action: 'brightness', value: 10 },
    ],
  },
  {
    name: 'Dramatic B&W',
    commands: [
      { action: 'grayscale' },
      { action: 'contrast', value: 30 },
      { action: 'sharpen', amount: 1.5 },
    ],
  },
  {
    name: 'Vivid',
    commands: [
      { action: 'saturation', value: 40 },
      { action: 'contrast', value: 15 },
      { action: 'sharpen', amount: 1.0 },
    ],
  },
  {
    name: 'Fade',
    commands: [
      { action: 'contrast', value: -20 },
      { action: 'brightness', value: 10 },
      { action: 'saturation', value: -30 },
    ],
  },
];

function loadCustomPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomPresets(presets) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

let presetsContainer = null;
let customPresetsContainer = null;

function applyPreset(preset) {
  const hasContent = state.layers.length > 0 || !!state.currentImg;
  if (!hasContent) return;

  executeCommands(preset.commands);
  announce(`Applied preset: ${preset.name}`);
}

function renderCustomPresets() {
  if (!customPresetsContainer) return;
  customPresetsContainer.innerHTML = '';
  const customs = loadCustomPresets();

  for (const preset of customs) {
    const wrapper = document.createElement('div');
    wrapper.className = 'preset-custom-item';

    const btn = document.createElement('button');
    btn.className = 'preset-btn preset-btn-custom';
    btn.textContent = preset.name;
    btn.title = `Apply ${preset.name}`;
    btn.setAttribute('aria-label', `Apply custom preset: ${preset.name}`);
    btn.addEventListener('click', () => applyPreset(preset));

    const delBtn = document.createElement('button');
    delBtn.className = 'preset-delete-btn';
    delBtn.textContent = '\u00D7';
    delBtn.title = `Delete ${preset.name}`;
    delBtn.setAttribute('aria-label', `Delete custom preset: ${preset.name}`);
    delBtn.addEventListener('click', () => {
      const presets = loadCustomPresets().filter(p => p.name !== preset.name);
      saveCustomPresets(presets);
      renderCustomPresets();
      announce(`Deleted preset: ${preset.name}`);
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(delBtn);
    customPresetsContainer.appendChild(wrapper);
  }
}

function promptSavePreset() {
  const name = prompt('Preset name:');
  if (!name || !name.trim()) return;

  // Capture current slider values as commands
  const commands = [];
  const sliders = document.querySelectorAll('#filter-sliders .filter-slider');
  for (const slider of sliders) {
    const id = slider.id.replace('filter-', '');
    const val = parseFloat(slider.value);
    const def = parseFloat(slider.defaultValue || '0');
    if (val === def) continue;

    if (id === 'blur') {
      commands.push({ action: 'blur', radius: val });
    } else if (id === 'sharpen') {
      commands.push({ action: 'sharpen', amount: val });
    } else if (id === 'shadows' || id === 'highlights') {
      commands.push({ action: 'shadows-highlights', shadows: 0, highlights: 0, [id]: val });
    } else {
      commands.push({ action: id, value: val });
    }
  }

  if (commands.length === 0) {
    announce('No filter adjustments to save');
    return;
  }

  const customs = loadCustomPresets();
  const existing = customs.findIndex(p => p.name === name.trim());
  const preset = { name: name.trim(), commands };
  if (existing >= 0) {
    customs[existing] = preset;
  } else {
    customs.push(preset);
  }
  saveCustomPresets(customs);
  renderCustomPresets();
  announce(`Saved preset: ${name.trim()}`);
}

export function initFilterPresets() {
  presetsContainer = document.getElementById('filter-presets');
  if (!presetsContainer) return;

  // Built-in preset buttons
  const builtInRow = document.createElement('div');
  builtInRow.className = 'preset-row';
  for (const preset of BUILT_IN_PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.textContent = preset.name;
    btn.title = preset.commands.map(c => c.action).join(' + ');
    btn.setAttribute('aria-label', `Apply preset: ${preset.name}`);
    btn.addEventListener('click', () => applyPreset(preset));
    builtInRow.appendChild(btn);
  }
  presetsContainer.appendChild(builtInRow);

  // Custom presets section
  customPresetsContainer = document.createElement('div');
  customPresetsContainer.className = 'preset-custom-list';
  customPresetsContainer.id = 'custom-presets-list';
  presetsContainer.appendChild(customPresetsContainer);

  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'preset-btn preset-save-btn';
  saveBtn.textContent = '+ Save Current';
  saveBtn.title = 'Save current slider values as a custom preset';
  saveBtn.setAttribute('aria-label', 'Save current filter settings as a custom preset');
  saveBtn.addEventListener('click', promptSavePreset);
  presetsContainer.appendChild(saveBtn);

  renderCustomPresets();
}
