// Project save/load — serializes full app state to downloadable JSON, restores from JSON
import { els, state } from './state.js';
import { serializeLayerStack, deserializeLayerStack, compositeLayers, renderLayersPanel } from './layers.js';
import { resizeAndDraw, resetZoomPan, saveState, applyTransform, updateUndoRedoButtons } from './canvas.js';
import { restoreConversationUI } from './chat-persistence.js';
import { renderGallery } from './gallery.js';
import { addSystemMessage, announce } from './ui.js';

const PROJECT_VERSION = 1;

// --- Save Project ---

export function saveProject() {
  const hasContent = state.layers.length > 0 || !!state.currentImg;
  if (!hasContent) {
    els.errorEl.textContent = 'No project to save. Load an image first.';
    return;
  }

  els.statusEl.textContent = 'Saving project\u2026';

  const project = {
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    canvas: {
      layers: serializeLayerStack(),
      activeLayerIndex: state.activeLayerIndex,
    },
    conversationHistory: state.conversationHistory,
    gallery: state.galleryItems.map(item => ({
      url: item.url,
      thumbnailUrl: item.thumbnailUrl || null,
      name: item.name,
      editCount: item.editCount || 0,
    })),
    view: {
      zoomLevel: state.zoomLevel,
      panX: state.panX,
      panY: state.panY,
    },
  };

  const json = JSON.stringify(project);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const filename = `image-canvas-project-${yyyy}-${mm}-${dd}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  els.statusEl.textContent = `Project saved as ${filename}`;
  announce('Project saved');
}

// --- Open Project ---

export function openProject() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    loadProjectFile(file);
  });
  input.click();
}

function loadProjectFile(file) {
  els.errorEl.textContent = '';
  els.statusEl.textContent = 'Loading project\u2026';

  const reader = new FileReader();
  reader.onerror = () => {
    els.errorEl.textContent = 'Failed to read project file.';
    els.statusEl.textContent = '';
  };
  reader.onload = () => {
    try {
      const project = JSON.parse(reader.result);
      restoreProject(project);
    } catch (e) {
      els.errorEl.textContent = 'Invalid project file: ' + e.message;
      els.statusEl.textContent = '';
    }
  };
  reader.readAsText(file);
}

async function restoreProject(project) {
  if (!project || typeof project.version !== 'number') {
    els.errorEl.textContent = 'Invalid project file: missing version.';
    els.statusEl.textContent = '';
    return;
  }

  if (project.version > PROJECT_VERSION) {
    els.errorEl.textContent = `Project file version ${project.version} is newer than supported (${PROJECT_VERSION}). Please update the app.`;
    els.statusEl.textContent = '';
    return;
  }

  // Restore layers
  if (project.canvas && project.canvas.layers && project.canvas.layers.length > 0) {
    await deserializeLayerStack(project.canvas.layers, project.canvas.activeLayerIndex || 0);

    // Set currentImg from the first layer for compatibility
    const firstLayer = state.layers[0];
    if (firstLayer) {
      const img = new Image();
      img.src = firstLayer.canvas.toDataURL('image/png');
      await new Promise(resolve => { img.onload = resolve; });
      state.currentImg = img;
    }
  }

  // Restore conversation history
  if (Array.isArray(project.conversationHistory)) {
    state.conversationHistory = project.conversationHistory;
    restoreConversationUI(state.conversationHistory);
  } else {
    state.conversationHistory = [];
    els.chatMessages.innerHTML = '';
  }

  // Restore gallery
  if (Array.isArray(project.gallery)) {
    state.galleryItems = project.gallery.map(item => ({
      url: item.url,
      thumbnailUrl: item.thumbnailUrl || null,
      name: item.name,
      editCount: item.editCount || 0,
    }));
    renderGallery();
  }

  // Restore view
  if (project.view) {
    state.zoomLevel = project.view.zoomLevel || 1;
    state.panX = project.view.panX || 0;
    state.panY = project.view.panY || 0;
  } else {
    state.zoomLevel = 1;
    state.panX = 0;
    state.panY = 0;
  }

  // Reset history for the restored state
  state.historyStack = [];
  state.historyIndex = -1;
  state.currentImageKey = null;

  resizeAndDraw();
  applyTransform();
  saveState();
  updateUndoRedoButtons();

  const dims = state.layers.length > 0
    ? `${state.layers[0].canvas.width}\u00D7${state.layers[0].canvas.height}`
    : '';
  els.statusEl.textContent = dims ? `Project loaded (${dims})` : 'Project loaded';
  addSystemMessage('Project restored from file.');
  announce('Project loaded');
}
