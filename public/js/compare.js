// Before/after comparison slider — shows original (first history state) vs current
import { els, state } from './state.js';
import { deserializeLayerStack, compositeLayers } from './layers.js';

const overlay = document.getElementById('compare-overlay');
const beforeCanvas = document.getElementById('compare-before');
const afterCanvas = document.getElementById('compare-after');
const divider = document.getElementById('compare-divider');
const compareBtn = document.getElementById('compare-btn');

let compareActive = false;
let sliderPos = 50; // percentage

// --- Public API ---

export function toggleCompare() {
  if (compareActive) {
    closeCompare();
  } else {
    openCompare();
  }
}

export function isCompareOpen() {
  return compareActive;
}

export function closeCompare() {
  compareActive = false;
  overlay.classList.remove('visible');
  if (compareBtn) compareBtn.classList.remove('active');
}

function openCompare() {
  if (state.historyStack.length === 0) return;
  if (state.layers.length === 0 && !state.currentImg) return;

  compareActive = true;
  sliderPos = 50;
  overlay.classList.add('visible');
  if (compareBtn) compareBtn.classList.add('active');

  renderCompareCanvases();
}

// --- Render before/after canvases ---

async function renderCompareCanvases() {
  const container = document.getElementById('canvas-container');
  const cw = container.clientWidth - 32;
  const ch = container.clientHeight - 32;

  // Get the original (first history state)
  const firstSnapshot = state.historyStack[0];

  // Render "before" (original)
  if (firstSnapshot.type === 'layers') {
    // Deserialize into a temp set of layers, composite to before canvas
    const tempCanvas = await renderLayerSnapshot(firstSnapshot, cw, ch);
    beforeCanvas.width = tempCanvas.width;
    beforeCanvas.height = tempCanvas.height;
    beforeCanvas.getContext('2d').drawImage(tempCanvas, 0, 0);
  } else {
    // Legacy flat snapshot
    await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(cw / img.width, ch / img.height, 1);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        beforeCanvas.width = w;
        beforeCanvas.height = h;
        beforeCanvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve();
      };
      img.src = firstSnapshot.dataURL;
    });
  }

  // Render "after" (current) — just copy from the display canvas
  const displayCanvas = els.canvas;
  afterCanvas.width = displayCanvas.width;
  afterCanvas.height = displayCanvas.height;
  afterCanvas.getContext('2d').drawImage(displayCanvas, 0, 0);

  // Ensure both canvases are the same size (use the larger dimensions)
  const w = Math.max(beforeCanvas.width, afterCanvas.width);
  const h = Math.max(beforeCanvas.height, afterCanvas.height);

  overlay.style.width = w + 'px';
  overlay.style.height = h + 'px';

  // Match before/after to same size if they differ
  if (beforeCanvas.width !== w || beforeCanvas.height !== h) {
    resizeCanvasTo(beforeCanvas, w, h);
  }
  if (afterCanvas.width !== w || afterCanvas.height !== h) {
    resizeCanvasTo(afterCanvas, w, h);
  }

  applySlider();
}

function resizeCanvasTo(cvs, w, h) {
  const temp = document.createElement('canvas');
  temp.width = cvs.width;
  temp.height = cvs.height;
  temp.getContext('2d').drawImage(cvs, 0, 0);
  cvs.width = w;
  cvs.height = h;
  // Center the image in the new size
  const ox = Math.round((w - temp.width) / 2);
  const oy = Math.round((h - temp.height) / 2);
  cvs.getContext('2d').drawImage(temp, ox, oy);
}

async function renderLayerSnapshot(snapshot, maxW, maxH) {
  // Decode layer images from snapshot without modifying app state
  const layers = await Promise.all(snapshot.layers.map((s) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ img, opacity: s.opacity, visible: s.visible, width: s.width, height: s.height });
      img.src = s.dataURL;
    })
  ));

  const docW = layers[0].width;
  const docH = layers[0].height;
  const scale = Math.min(maxW / docW, maxH / docH, 1);
  const w = Math.round(docW * scale);
  const h = Math.round(docH * scale);

  const cvs = document.createElement('canvas');
  cvs.width = w;
  cvs.height = h;
  const ctx = cvs.getContext('2d');

  for (const layer of layers) {
    if (!layer.visible) continue;
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(layer.img, 0, 0, w, h);
  }
  ctx.globalAlpha = 1.0;
  return cvs;
}

// --- Slider ---

function applySlider() {
  const pct = sliderPos;
  // Clip the "before" canvas to show left portion, "after" shows right
  beforeCanvas.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
  afterCanvas.style.clipPath = `inset(0 0 0 ${pct}%)`;
  divider.style.left = pct + '%';
}

function updateSlider(clientX) {
  const rect = overlay.getBoundingClientRect();
  const x = clientX - rect.left;
  sliderPos = Math.max(0, Math.min(100, (x / rect.width) * 100));
  applySlider();
}

// --- Mouse interaction ---

let isDragging = false;

divider.addEventListener('mousedown', (e) => {
  e.preventDefault();
  isDragging = true;
});

overlay.addEventListener('mousedown', (e) => {
  if (e.target === overlay || e.target === beforeCanvas || e.target === afterCanvas) {
    isDragging = true;
    updateSlider(e.clientX);
  }
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  updateSlider(e.clientX);
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

// --- Touch interaction ---

divider.addEventListener('touchstart', (e) => {
  e.preventDefault();
  isDragging = true;
}, { passive: false });

overlay.addEventListener('touchstart', (e) => {
  if (e.target === overlay || e.target === beforeCanvas || e.target === afterCanvas) {
    isDragging = true;
    updateSlider(e.touches[0].clientX);
  }
}, { passive: true });

window.addEventListener('touchmove', (e) => {
  if (!isDragging) return;
  updateSlider(e.touches[0].clientX);
}, { passive: true });

window.addEventListener('touchend', () => {
  isDragging = false;
});

// --- Keyboard on divider ---

divider.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') {
    sliderPos = Math.max(0, sliderPos - 2);
    applySlider();
  } else if (e.key === 'ArrowRight') {
    sliderPos = Math.min(100, sliderPos + 2);
    applySlider();
  } else if (e.key === 'Escape') {
    closeCompare();
  }
});

// --- Button ---

if (compareBtn) {
  compareBtn.addEventListener('click', toggleCompare);
}

// Enable/disable button with other tools
export function updateCompareButton() {
  if (!compareBtn) return;
  const hasContent = state.layers.length > 0 || !!state.currentImg;
  compareBtn.disabled = !hasContent;
}
