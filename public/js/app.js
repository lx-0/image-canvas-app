// Application bootstrap — wires all modules together, handles upload flows and events
import { els, state } from './state.js';
import { getCurrentTheme, toggleTheme, showUploadProgress, hideUploadProgress,
         showCanvasOverlay, hideCanvasOverlay, addSystemMessage, uploadWithProgress,
         announce, trapFocus } from './ui.js';
import { resizeAndDraw, resetZoomPan, saveState, undo, redo, updateUndoRedoButtons,
         applyTransform, zoomToPoint, getCanvasDataURL, fileToDataURL } from './canvas.js';
import { loadConversation, restoreConversationUI } from './chat-persistence.js';
import './chat.js'; // Initialize chat event listeners
import './analyze.js'; // Image analysis / describe button
import './context-menu.js'; // Canvas right-click context menu
import { setDrawingMode } from './draw.js'; // Freehand drawing tool
import { setSelectMode } from './select.js'; // Rectangular selection tool
import { setTextMode } from './text.js'; // Text placement tool
import { initTransformHandles } from './transform.js'; // Resize handles
import { openExportDialog, closeExportDialog } from './export.js';
import { addToGallery, renderGallery } from './gallery.js';
import { initCropPresets } from './crop-presets.js';
import { initFilterPanel, toggleFilterPanel, isFilterPanelOpen, closeFilterPanel } from './filter-panel.js';
import { initLayersFromImage, initLayersPanel, toggleLayersPanel, compositeLayers } from './layers.js';

let form, fileInput, canvas, ctx, statusEl, errorEl, container, chatInput, chatMessages,
    exportOverlay, shortcutsOverlay, deleteOverlay, deleteNoBtn,
    zoomInBtn, zoomOutBtn;

try {
  ({ form, fileInput, canvas, ctx, statusEl, errorEl, container, chatInput, chatMessages,
     exportOverlay, shortcutsOverlay, deleteOverlay, deleteNoBtn,
     zoomInBtn, zoomOutBtn } = els);

// --- Upload and render an image ---
async function uploadAndRender(file) {
  errorEl.textContent = '';
  statusEl.textContent = 'Uploading…';
  showUploadProgress(0);

  const formData = new FormData();
  formData.append('file', file);

  try {
    const data = await uploadWithProgress(formData);
    statusEl.textContent = 'Rendering…';
    const img = new Image();
    img.onload = () => {
      state.currentImg = img;
      state.currentImageKey = data.url;
      initLayersFromImage(img);
      resetZoomPan();
      resizeAndDraw();
      saveState();
      statusEl.textContent = `${img.width}×${img.height} rendered`;
      addToGallery(data.url, file.name, data.thumbnailUrl);
      renderGallery();
      restoreOrResetChat(data.url);
    };
    img.onerror = () => {
      errorEl.textContent = 'Failed to load image.';
      statusEl.textContent = '';
    };
    img.src = data.url;
  } catch (err) {
    errorEl.textContent = err.message;
    statusEl.textContent = '';
    hideUploadProgress();
  }
}

function restoreOrResetChat(imageUrl) {
  const saved = loadConversation(imageUrl);
  if (saved && saved.length > 0) {
    state.conversationHistory = saved;
    restoreConversationUI(saved);
    addSystemMessage('Previous conversation restored.');
  } else {
    state.conversationHistory = [];
    chatMessages.innerHTML = '';
    addSystemMessage('Image loaded. You can now ask me to edit it.');
  }
}

// --- AI compositing ---
async function compositeImages(droppedFile, instructions) {
  errorEl.textContent = '';
  statusEl.textContent = 'AI compositing…';
  showCanvasOverlay('Processing…');
  addSystemMessage('Analyzing images for compositing…');

  try {
    const baseImage = canvas.toDataURL('image/png');
    const droppedImage = await fileToDataURL(droppedFile);

    const body = { baseImage, droppedImage };
    if (instructions) body.instructions = instructions;

    const res = await fetch('/api/composite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Composite request failed.';
      if (data.requestId) errorEl.textContent += ' (ref: ' + data.requestId + ')';
      statusEl.textContent = '';
      hideCanvasOverlay();
      return;
    }

    if (data.composite) {
      await renderComposite(droppedImage, data.composite);
      addSystemMessage(data.response || 'Compositing complete.');
    } else {
      addSystemMessage(data.response || 'AI could not determine placement.');
      statusEl.textContent = '';
    }
    hideCanvasOverlay();
  } catch (err) {
    const isNetwork = err instanceof TypeError || (err.message && (err.message.includes('fetch') || err.message.includes('network')));
    errorEl.textContent = isNetwork ? 'Network error — check your connection and try again.' : 'Compositing error: ' + err.message;
    statusEl.textContent = '';
    hideCanvasOverlay();
  }
}

function renderComposite(droppedDataURL, composite) {
  return new Promise((resolve) => {
    const droppedImg = new Image();
    droppedImg.onload = () => {
      const targetWidth = canvas.width * composite.scale;
      const aspectRatio = droppedImg.height / droppedImg.width;
      const targetHeight = targetWidth * aspectRatio;
      const cx = (composite.x / 100) * canvas.width;
      const cy = (composite.y / 100) * canvas.height;

      ctx.drawImage(droppedImg, cx - targetWidth / 2, cy - targetHeight / 2, targetWidth, targetHeight);

      const snapshot = new Image();
      snapshot.onload = () => {
        state.currentImg = snapshot;
        saveState();
        statusEl.textContent = `${state.currentImg.width}×${state.currentImg.height} composited`;
        resolve();
      };
      snapshot.src = canvas.toDataURL('image/png');
    };
    droppedImg.src = droppedDataURL;
  });
}

// --- Upload via form ---
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  statusEl.textContent = '';

  const file = fileInput.files[0];
  if (!file) {
    errorEl.textContent = 'Please select a file.';
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  statusEl.textContent = 'Uploading…';
  showUploadProgress(0);

  try {
    const data = await uploadWithProgress(formData);
    statusEl.textContent = 'Rendering…';
    const img = new Image();
    img.onload = () => {
      state.currentImg = img;
      state.currentImageKey = data.url;
      initLayersFromImage(img);
      resetZoomPan();
      resizeAndDraw();
      saveState();
      statusEl.textContent = `${img.width}×${img.height} rendered`;
      addToGallery(data.url, file.name, data.thumbnailUrl);
      renderGallery();
      restoreOrResetChat(data.url);
    };
    img.onerror = () => {
      errorEl.textContent = 'Failed to load image.';
      statusEl.textContent = '';
    };
    img.src = data.url;
  } catch (err) {
    errorEl.textContent = err.message;
    statusEl.textContent = '';
    hideUploadProgress();
  }
});

// --- Drag-and-drop ---
container.addEventListener('dragenter', (e) => {
  e.preventDefault();
  state.dragCounter++;
  container.classList.add('dragover');
});

container.addEventListener('dragleave', (e) => {
  e.preventDefault();
  state.dragCounter--;
  if (state.dragCounter <= 0) {
    state.dragCounter = 0;
    container.classList.remove('dragover');
  }
});

container.addEventListener('dragover', (e) => { e.preventDefault(); });

container.addEventListener('drop', (e) => {
  e.preventDefault();
  state.dragCounter = 0;
  container.classList.remove('dragover');

  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) {
    errorEl.textContent = 'Please drop an image file.';
    return;
  }

  if (!state.currentImg) {
    uploadAndRender(file);
    return;
  }

  const shiftHeld = e.shiftKey;
  let instructions = null;
  if (shiftHeld) {
    instructions = prompt('Enter compositing instructions (or cancel for automatic):');
    if (instructions !== null && instructions.trim() === '') {
      instructions = null;
    }
  }
  compositeImages(file, instructions);
});

// --- Clipboard paste to upload ---
document.addEventListener('paste', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) uploadAndRender(file);
      return;
    }
  }
});

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    redo();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    openExportDialog();
  }
  if (e.key === 'Escape' && exportOverlay.classList.contains('visible')) {
    closeExportDialog();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
    e.preventDefault();
    zoomInBtn.click();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '-') {
    e.preventDefault();
    zoomOutBtn.click();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault();
    resetZoomPan();
  }
});

// --- Shortcuts overlay ---
function openShortcutsOverlay() {
  shortcutsOverlay.classList.add('visible');
  document.getElementById('shortcuts-close-btn').focus();
}

function closeShortcutsOverlay() {
  shortcutsOverlay.classList.remove('visible');
}

document.getElementById('shortcuts-close-btn').addEventListener('click', closeShortcutsOverlay);
shortcutsOverlay.addEventListener('click', (e) => {
  if (e.target === shortcutsOverlay) closeShortcutsOverlay();
});

// --- Focus traps for dialogs ---
let deleteFocusTrap = null;
let shortcutsFocusTrap = null;

const deleteObserver = new MutationObserver(() => {
  if (deleteOverlay.classList.contains('visible')) {
    deleteFocusTrap = trapFocus(document.getElementById('delete-confirm-dialog'));
    deleteNoBtn.focus();
    announce('Delete confirmation dialog opened');
  } else {
    if (deleteFocusTrap) { deleteFocusTrap(); deleteFocusTrap = null; }
    announce('Delete dialog closed');
  }
});
deleteObserver.observe(deleteOverlay, { attributes: true, attributeFilter: ['class'] });

const shortcutsObserver = new MutationObserver(() => {
  if (shortcutsOverlay.classList.contains('visible')) {
    shortcutsFocusTrap = trapFocus(document.getElementById('shortcuts-dialog'));
  } else {
    if (shortcutsFocusTrap) { shortcutsFocusTrap(); shortcutsFocusTrap = null; }
  }
});
shortcutsObserver.observe(shortcutsOverlay, { attributes: true, attributeFilter: ['class'] });

// --- Enhanced keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  if (e.key === '?' && !isTyping && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    if (shortcutsOverlay.classList.contains('visible')) {
      closeShortcutsOverlay();
    } else {
      openShortcutsOverlay();
    }
    return;
  }

  if (e.key === 'Escape') {
    if (isFilterPanelOpen()) {
      closeFilterPanel(false);
      return;
    }
    if (shortcutsOverlay.classList.contains('visible')) {
      closeShortcutsOverlay();
      return;
    }
    if (deleteOverlay.classList.contains('visible')) {
      deleteOverlay.classList.remove('visible');
      state.pendingDeleteUrl = null;
      return;
    }
  }

  if (e.key === 'f' && !isTyping && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    toggleFilterPanel();
    return;
  }

  if (e.key === 'l' && !isTyping && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    toggleLayersPanel();
    return;
  }

  if (e.key === '/' && !isTyping && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    chatInput.focus();
    announce('Chat input focused');
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
    e.preventDefault();
    fileInput.click();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'T') {
    e.preventDefault();
    toggleTheme();
    announce('Switched to ' + getCurrentTheme() + ' theme');
    return;
  }
});

// --- Transform handles (resize by dragging) ---
initTransformHandles();

// --- AI crop preset buttons ---
initCropPresets();

// --- Filter adjustment panel ---
initFilterPanel();

// --- Layers panel ---
initLayersPanel();

// --- Register service worker ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// --- Mobile touch gestures ---
(function() {
  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

  const chatPanel = document.getElementById('chat-panel');
  const chatHandle = document.getElementById('mobile-chat-handle');
  const chatHeader = document.getElementById('chat-header');

  if (isMobile()) chatPanel.classList.add('collapsed');

  function toggleChat() {
    if (!isMobile()) return;
    chatPanel.classList.toggle('collapsed');
  }

  chatHandle.addEventListener('click', toggleChat);
  chatHeader.addEventListener('click', (e) => {
    if (e.target.id === 'new-chat-btn') return;
    toggleChat();
  });

  let chatTouchStartY = 0;
  let chatTouchStartTime = 0;

  chatHandle.addEventListener('touchstart', (e) => {
    if (!isMobile()) return;
    chatTouchStartY = e.touches[0].clientY;
    chatTouchStartTime = Date.now();
  }, { passive: true });

  chatHandle.addEventListener('touchend', (e) => {
    if (!isMobile()) return;
    const deltaY = chatTouchStartY - e.changedTouches[0].clientY;
    const elapsed = Date.now() - chatTouchStartTime;
    if (elapsed < 400 && Math.abs(deltaY) > 30) {
      if (deltaY > 0) chatPanel.classList.remove('collapsed');
      else chatPanel.classList.add('collapsed');
    }
  }, { passive: true });

  // Pinch-to-zoom & two-finger pan
  let touchState = { active: false, lastDist: 0, lastCenterX: 0, lastCenterY: 0 };

  function getTouchDist(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function getTouchCenter(t1, t2) {
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  }

  container.addEventListener('touchstart', (e) => {
    if (!state.currentImg) return;
    if (state.drawingMode && e.touches.length === 1) return; // drawing handles single-finger
    if (state.selectMode && e.touches.length === 1) return; // selection handles single-finger
    if (state.textMode && e.touches.length === 1) return; // text handles single-finger
    if (e.touches.length === 2) {
      e.preventDefault();
      const t1 = e.touches[0], t2 = e.touches[1];
      touchState.active = true;
      touchState.lastDist = getTouchDist(t1, t2);
      const c = getTouchCenter(t1, t2);
      touchState.lastCenterX = c.x;
      touchState.lastCenterY = c.y;
    } else if (e.touches.length === 1 && state.zoomLevel !== 1) {
      e.preventDefault();
      state.isPanning = true;
      state.panStartX = e.touches[0].clientX;
      state.panStartY = e.touches[0].clientY;
      state.panStartPanX = state.panX;
      state.panStartPanY = state.panY;
    }
  }, { passive: false });

  container.addEventListener('touchmove', (e) => {
    if (!state.currentImg) return;
    if (state.drawingMode && e.touches.length === 1) return; // drawing handles single-finger
    if (state.selectMode && e.touches.length === 1) return; // selection handles single-finger
    if (state.textMode && e.touches.length === 1) return; // text handles single-finger
    if (e.touches.length === 2 && touchState.active) {
      e.preventDefault();
      const t1 = e.touches[0], t2 = e.touches[1];
      const dist = getTouchDist(t1, t2);
      const center = getTouchCenter(t1, t2);

      const scaleFactor = dist / touchState.lastDist;
      const newZoom = Math.max(state.MIN_ZOOM, Math.min(state.MAX_ZOOM, state.zoomLevel * scaleFactor));
      zoomToPoint(newZoom, center.x, center.y);

      const dx = center.x - touchState.lastCenterX;
      const dy = center.y - touchState.lastCenterY;
      state.panX += dx;
      state.panY += dy;
      applyTransform();

      touchState.lastDist = dist;
      touchState.lastCenterX = center.x;
      touchState.lastCenterY = center.y;
    } else if (e.touches.length === 1 && state.isPanning) {
      e.preventDefault();
      state.panX = state.panStartPanX + (e.touches[0].clientX - state.panStartX);
      state.panY = state.panStartPanY + (e.touches[0].clientY - state.panStartY);
      applyTransform();
    }
  }, { passive: false });

  container.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) touchState.active = false;
    if (e.touches.length === 0) state.isPanning = false;
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (!isMobile()) chatPanel.classList.remove('collapsed');
  });
})();

} catch (initError) {
  // Report initialization failure and show user-friendly error page
  if (typeof window.__reportError === 'function') {
    window.__reportError({ type: 'init', message: initError.message, stack: initError.stack || '' });
  }
  const mainArea = document.getElementById('main-area');
  if (mainArea) {
    mainArea.innerHTML =
      '<div style="max-width:480px;margin:80px auto;padding:32px;text-align:center;font-family:system-ui,sans-serif;">' +
      '<h2 style="margin-bottom:16px;">Failed to Load Application</h2>' +
      '<p style="margin-bottom:16px;">An unexpected error occurred while starting the application.</p>' +
      '<button onclick="location.reload()" style="padding:8px 24px;font-size:14px;cursor:pointer;border:1px solid #666;border-radius:4px;background:#e94560;color:#fff;">Reload Page</button>' +
      '</div>';
  }
  /* eslint-disable-next-line no-undef */
  console.error('App initialization failed:', initError);
}
