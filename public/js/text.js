// Text tool — click to place text on the active layer with floating toolbar
import { els, state } from './state.js';
import { saveState } from './canvas.js';
import { getActiveLayer, getActiveCtx, getActiveCanvas, compositeLayers } from './layers.js';

const { canvas, container, statusEl } = els;

// --- Text panel DOM references ---
const textBtn = document.getElementById('text-btn');
const textPanel = document.getElementById('text-panel');
const fontSelect = document.getElementById('text-font');
const sizeSlider = document.getElementById('text-size');
const sizeValue = document.getElementById('text-size-value');
const colorInput = document.getElementById('text-color');
const boldBtn = document.getElementById('text-bold-btn');
const italicBtn = document.getElementById('text-italic-btn');
const alignBtns = textPanel.querySelectorAll('.text-align-btn');

// --- Internal editing state ---
let _editingText = '';      // current text content
let _cursorX = 0;           // layer-space X
let _cursorY = 0;           // layer-space Y
let _isDragging = false;
let _dragStartX = 0;
let _dragStartY = 0;
let _origCursorX = 0;
let _origCursorY = 0;
let _cursorVisible = true;
let _cursorInterval = null;

// --- Toggle text mode ---
export function setTextMode(active) {
  state.textMode = active;
  textBtn.classList.toggle('active', active);
  textPanel.classList.toggle('visible', active);
  container.classList.toggle('text-mode', active);
  if (active) {
    // Deactivate other modes
    state.drawingMode = false;
    state.isDrawing = false;
    state.selectMode = false;
    state.selRect = null;
    const drawBtn = document.getElementById('draw-btn');
    if (drawBtn) drawBtn.classList.remove('active');
    container.classList.remove('drawing-mode');
    const drawPanel = document.getElementById('draw-panel');
    if (drawPanel) drawPanel.classList.remove('visible');
    const selectBtn = document.getElementById('select-btn');
    if (selectBtn) selectBtn.classList.remove('active');
    container.classList.remove('select-mode');
    const selToolbar = document.getElementById('select-toolbar');
    if (selToolbar) selToolbar.classList.remove('visible');
  }
  if (!active) {
    commitText();
  }
}

textBtn.addEventListener('click', () => {
  if (state.layers.length === 0 && !state.currentImg) return;
  setTextMode(!state.textMode);
});

// --- Font controls ---
fontSelect.addEventListener('change', () => {
  state.textFont = fontSelect.value;
  if (state.isTextEditing) renderPreview();
});

sizeSlider.addEventListener('input', () => {
  state.textSize = parseInt(sizeSlider.value, 10);
  sizeValue.textContent = state.textSize + 'px';
  if (state.isTextEditing) renderPreview();
});

colorInput.addEventListener('input', () => {
  state.textColor = colorInput.value;
  if (state.isTextEditing) renderPreview();
});

boldBtn.addEventListener('click', () => {
  state.textBold = !state.textBold;
  boldBtn.classList.toggle('active', state.textBold);
  if (state.isTextEditing) renderPreview();
});

italicBtn.addEventListener('click', () => {
  state.textItalic = !state.textItalic;
  italicBtn.classList.toggle('active', state.textItalic);
  if (state.isTextEditing) renderPreview();
});

alignBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    state.textAlign = btn.dataset.align;
    alignBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (state.isTextEditing) renderPreview();
  });
});

// --- Coordinate conversion (same as draw.js) ---
function layerCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const layer = getActiveLayer();
  if (layer) {
    return {
      x: (clientX - rect.left) * layer.canvas.width / rect.width,
      y: (clientY - rect.top) * layer.canvas.height / rect.height,
    };
  }
  return {
    x: (clientX - rect.left) / (rect.width / canvas.width),
    y: (clientY - rect.top) / (rect.height / canvas.height),
  };
}

// --- Scale font size to layer resolution ---
function scaledFontSize() {
  const layer = getActiveLayer();
  if (layer && canvas.width > 0) {
    return state.textSize * (layer.canvas.width / canvas.width);
  }
  return state.textSize;
}

// --- Build font string ---
function buildFont() {
  const size = scaledFontSize();
  let font = '';
  if (state.textItalic) font += 'italic ';
  if (state.textBold) font += 'bold ';
  font += size + 'px ' + state.textFont;
  return font;
}

// --- Snapshot for live preview (save layer state before editing) ---
let _previewSnapshot = null;

function captureSnapshot() {
  const layerCanvas = getActiveCanvas();
  if (!layerCanvas) return;
  const snap = document.createElement('canvas');
  snap.width = layerCanvas.width;
  snap.height = layerCanvas.height;
  snap.getContext('2d').drawImage(layerCanvas, 0, 0);
  _previewSnapshot = snap;
}

function restoreSnapshot() {
  if (!_previewSnapshot) return;
  const ctx = getActiveCtx();
  const layerCanvas = getActiveCanvas();
  if (!ctx || !layerCanvas) return;
  ctx.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
  ctx.drawImage(_previewSnapshot, 0, 0);
}

// --- Render text preview on layer (non-destructive via snapshot restore) ---
function renderPreview() {
  if (!state.isTextEditing) return;
  restoreSnapshot();
  const ctx = getActiveCtx();
  if (!ctx) return;

  ctx.save();
  ctx.font = buildFont();
  ctx.fillStyle = state.textColor;
  ctx.textAlign = state.textAlign;
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 2;

  const lines = _editingText.split('\n');
  const lineHeight = scaledFontSize() * 1.2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], _cursorX, _cursorY + i * lineHeight);
  }

  // Draw blinking cursor
  if (_cursorVisible && _editingText !== undefined) {
    const lastLine = lines[lines.length - 1];
    const metrics = ctx.measureText(lastLine);
    let cursorDrawX = _cursorX;
    if (state.textAlign === 'left') {
      cursorDrawX = _cursorX + metrics.width;
    } else if (state.textAlign === 'center') {
      cursorDrawX = _cursorX + metrics.width / 2;
    } else if (state.textAlign === 'right') {
      cursorDrawX = _cursorX;
    }
    const cursorY = _cursorY + (lines.length - 1) * lineHeight;
    ctx.strokeStyle = state.textColor;
    ctx.lineWidth = Math.max(1, scaledFontSize() / 16);
    ctx.beginPath();
    ctx.moveTo(cursorDrawX, cursorY);
    ctx.lineTo(cursorDrawX, cursorY + lineHeight);
    ctx.stroke();
  }

  ctx.restore();
  compositeLayers();
}

// --- Cursor blink ---
function startCursorBlink() {
  stopCursorBlink();
  _cursorVisible = true;
  _cursorInterval = setInterval(() => {
    _cursorVisible = !_cursorVisible;
    renderPreview();
  }, 530);
}

function stopCursorBlink() {
  if (_cursorInterval) {
    clearInterval(_cursorInterval);
    _cursorInterval = null;
  }
}

// --- Start text editing at a position ---
function startEditing(clientX, clientY) {
  if (state.isTextEditing) {
    commitText();
  }
  const pos = layerCoords(clientX, clientY);
  _cursorX = pos.x;
  _cursorY = pos.y;
  _editingText = '';
  state.isTextEditing = true;
  captureSnapshot();
  startCursorBlink();
  renderPreview();
  canvas.focus();
}

// --- Commit text to layer ---
function commitText() {
  stopCursorBlink();
  if (!state.isTextEditing) return;
  state.isTextEditing = false;

  if (_editingText.trim() === '') {
    // No text entered — restore original
    restoreSnapshot();
    compositeLayers();
    _previewSnapshot = null;
    return;
  }

  // Render final text (no cursor)
  restoreSnapshot();
  const ctx = getActiveCtx();
  if (ctx) {
    ctx.save();
    ctx.font = buildFont();
    ctx.fillStyle = state.textColor;
    ctx.textAlign = state.textAlign;
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 2;

    const lines = _editingText.split('\n');
    const lineHeight = scaledFontSize() * 1.2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], _cursorX, _cursorY + i * lineHeight);
    }
    ctx.restore();
  }

  compositeLayers();
  saveState();
  _previewSnapshot = null;

  const layer = getActiveLayer();
  if (layer) {
    statusEl.textContent = `${layer.canvas.width}\u00D7${layer.canvas.height} \u2014 text placed`;
  }
}

// --- Mouse events ---
canvas.addEventListener('mousedown', (e) => {
  if (!state.textMode || (state.layers.length === 0 && !state.currentImg) || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  if (state.isTextEditing && _editingText.trim() !== '') {
    // Check if clicking near existing text for drag, otherwise commit and start new
    const pos = layerCoords(e.clientX, e.clientY);
    const lineHeight = scaledFontSize() * 1.2;
    const lines = _editingText.split('\n');
    const textHeight = lines.length * lineHeight;
    const ctx = getActiveCtx();
    ctx.save();
    ctx.font = buildFont();
    const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
    ctx.restore();

    // Hit test for drag
    let hitX = _cursorX;
    if (state.textAlign === 'center') hitX = _cursorX - maxWidth / 2;
    else if (state.textAlign === 'right') hitX = _cursorX - maxWidth;

    if (pos.x >= hitX - 10 && pos.x <= hitX + maxWidth + 10 &&
        pos.y >= _cursorY - 10 && pos.y <= _cursorY + textHeight + 10) {
      // Start drag
      _isDragging = true;
      _dragStartX = pos.x;
      _dragStartY = pos.y;
      _origCursorX = _cursorX;
      _origCursorY = _cursorY;
      return;
    }
    // Click away — commit text
    commitText();
    return;
  }

  if (state.isTextEditing) {
    // Empty text, click away cancels
    commitText();
    return;
  }

  startEditing(e.clientX, e.clientY);
});

window.addEventListener('mousemove', (e) => {
  if (!_isDragging) return;
  e.preventDefault();
  const pos = layerCoords(e.clientX, e.clientY);
  _cursorX = _origCursorX + (pos.x - _dragStartX);
  _cursorY = _origCursorY + (pos.y - _dragStartY);
  renderPreview();
});

window.addEventListener('mouseup', () => {
  _isDragging = false;
});

// --- Touch events ---
canvas.addEventListener('touchstart', (e) => {
  if (!state.textMode || (state.layers.length === 0 && !state.currentImg)) return;
  if (e.touches.length !== 1) return;
  e.preventDefault();
  e.stopPropagation();

  if (state.isTextEditing) {
    commitText();
    return;
  }
  startEditing(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

// --- Keyboard input ---
document.addEventListener('keydown', (e) => {
  if (!state.isTextEditing) return;

  // Don't capture if focused on an actual input
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  if (e.key === 'Escape') {
    e.preventDefault();
    if (state.isTextEditing) {
      _editingText = '';
      commitText(); // restores snapshot since text is empty
    }
    return;
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    commitText();
    return;
  }

  if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    _editingText += '\n';
    _cursorVisible = true;
    renderPreview();
    return;
  }

  if (e.key === 'Backspace') {
    e.preventDefault();
    _editingText = _editingText.slice(0, -1);
    _cursorVisible = true;
    renderPreview();
    return;
  }

  // Ignore modifier-only keys and control combos (except shift)
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.length !== 1) return;

  e.preventDefault();
  _editingText += e.key;
  _cursorVisible = true;
  renderPreview();
});

// --- Escape to exit text mode (when not editing) ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.textMode && !state.isTextEditing) {
    setTextMode(false);
  }
  // Toggle with T key when not typing
  if (e.key === 't' || e.key === 'T') {
    if (state.isTextEditing) return; // don't toggle while typing
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (state.layers.length === 0 && !state.currentImg) return;
    e.preventDefault();
    setTextMode(!state.textMode);
  }
});
