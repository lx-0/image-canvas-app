// Gallery sidebar state, rendering, and server sync
import { els, state } from './state.js';
import { addSystemMessage } from './ui.js';
import { resizeAndDraw, resetZoomPan, saveState, updateUndoRedoButtons } from './canvas.js';
import { loadConversation, restoreConversationUI, chatStorageKey } from './chat-persistence.js';

const { gallerySidebar, galleryList, galleryCollapseBtn, galleryToggleBtn,
        deleteOverlay, deleteYesBtn, deleteNoBtn, statusEl, errorEl, chatMessages } = els;

function findGalleryItem(url) {
  return state.galleryItems.find((item) => item.url === url);
}

export function addToGallery(url, name, thumbnailUrl) {
  if (findGalleryItem(url)) return;
  state.galleryItems.unshift({ url, thumbnailUrl: thumbnailUrl || null, name: name || url.split('/').pop(), editCount: 0 });
  saveGalleryState();
  renderGallery();
}

function removeFromGallery(url) {
  state.galleryItems = state.galleryItems.filter((item) => item.url !== url);
  saveGalleryState();
  renderGallery();
}

export function incrementEditCount(url) {
  const item = findGalleryItem(url);
  if (item) {
    item.editCount++;
    saveGalleryState();
    renderGallery();
  }
}

function saveGalleryState() {
  try {
    localStorage.setItem(state.GALLERY_KEY, JSON.stringify(state.galleryItems));
  } catch (_e) { /* quota */ }
}

function loadGalleryState() {
  try {
    const raw = localStorage.getItem(state.GALLERY_KEY);
    if (raw) state.galleryItems = JSON.parse(raw);
  } catch (_e) { state.galleryItems = []; }

  const collapsed = localStorage.getItem(state.GALLERY_COLLAPSED_KEY);
  if (collapsed === 'true') gallerySidebar.classList.add('collapsed');
}

export function renderGallery() {
  galleryList.innerHTML = '';
  if (state.galleryItems.length === 0) {
    const empty = document.createElement('div');
    empty.id = 'gallery-empty';
    empty.textContent = 'No images yet. Upload one to get started.';
    galleryList.appendChild(empty);
    return;
  }

  for (const item of state.galleryItems) {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    div.setAttribute('role', 'listitem');
    div.setAttribute('tabindex', '0');
    const isActive = state.currentImageKey === item.url;
    if (isActive) div.classList.add('active');
    div.setAttribute('aria-current', isActive ? 'true' : 'false');
    div.setAttribute('aria-label', `${item.name}${item.editCount > 0 ? `, ${item.editCount} edit${item.editCount > 1 ? 's' : ''}` : ''}${isActive ? ' (selected)' : ''}`);

    const img = document.createElement('img');
    img.src = item.thumbnailUrl || item.url;
    img.alt = item.name;
    img.loading = 'lazy';
    div.appendChild(img);

    if (item.editCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'edit-badge';
      badge.textContent = item.editCount;
      badge.setAttribute('aria-hidden', 'true');
      div.appendChild(badge);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = '×';
    delBtn.title = 'Delete image';
    delBtn.setAttribute('aria-label', `Delete ${item.name}`);
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.pendingDeleteUrl = item.url;
      deleteOverlay.classList.add('visible');
    });
    div.appendChild(delBtn);

    div.addEventListener('click', () => {
      switchToImage(item.url);
    });
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchToImage(item.url);
      }
    });

    galleryList.appendChild(div);
  }
}

function switchToImage(url) {
  if (state.currentImageKey === url) return;
  errorEl.textContent = '';
  statusEl.textContent = 'Loading…';

  const img = new Image();
  img.onload = () => {
    state.currentImg = img;
    state.currentImageKey = url;
    state.historyStack = [];
    state.historyIndex = -1;
    resetZoomPan();
    resizeAndDraw();
    saveState();
    statusEl.textContent = `${img.width}×${img.height} rendered`;
    renderGallery();

    const saved = loadConversation(url);
    if (saved && saved.length > 0) {
      state.conversationHistory = saved;
      restoreConversationUI(saved);
      addSystemMessage('Previous conversation restored.');
    } else {
      state.conversationHistory = [];
      chatMessages.innerHTML = '';
      addSystemMessage('Image loaded. You can now ask me to edit it.');
    }
  };
  img.onerror = () => {
    errorEl.textContent = 'Failed to load image.';
    statusEl.textContent = '';
  };
  img.src = url;
}

// Delete confirmation handlers
deleteYesBtn.addEventListener('click', async () => {
  deleteOverlay.classList.remove('visible');
  if (!state.pendingDeleteUrl) return;
  const url = state.pendingDeleteUrl;
  state.pendingDeleteUrl = null;

  const filename = url.split('/').pop();
  try {
    await fetch('/api/images/' + encodeURIComponent(filename), { method: 'DELETE' });
  } catch (_e) { /* best effort */ }

  localStorage.removeItem(chatStorageKey(url));

  if (state.currentImageKey === url) {
    state.currentImg = null;
    state.currentImageKey = null;
    state.conversationHistory = [];
    state.historyStack = [];
    state.historyIndex = -1;
    resizeAndDraw();
    updateUndoRedoButtons();
    chatMessages.innerHTML = '';
    addSystemMessage('Upload an image, then ask me to edit it. I can crop, resize, rotate, add text, flip, adjust brightness/contrast, and more.');
    statusEl.textContent = '';
  }

  removeFromGallery(url);
});

deleteNoBtn.addEventListener('click', () => {
  deleteOverlay.classList.remove('visible');
  state.pendingDeleteUrl = null;
});

deleteOverlay.addEventListener('click', (e) => {
  if (e.target === deleteOverlay) {
    deleteOverlay.classList.remove('visible');
    state.pendingDeleteUrl = null;
  }
});

// Gallery collapse/expand
galleryCollapseBtn.addEventListener('click', () => {
  gallerySidebar.classList.add('collapsed');
  localStorage.setItem(state.GALLERY_COLLAPSED_KEY, 'true');
});

galleryToggleBtn.addEventListener('click', () => {
  gallerySidebar.classList.remove('collapsed');
  localStorage.setItem(state.GALLERY_COLLAPSED_KEY, 'false');
});

// Sync gallery with server on load
async function syncGallery() {
  try {
    const res = await fetch('/api/images');
    const data = await res.json();
    if (data.images && data.images.length > 0) {
      const existingMap = new Map(state.galleryItems.map((i) => [i.url, i]));
      for (const img of data.images) {
        if (!existingMap.has(img.url)) {
          state.galleryItems.push({ url: img.url, thumbnailUrl: img.thumbnailUrl || null, name: img.name, editCount: 0 });
        }
      }
      const serverUrls = new Set(data.images.map((i) => i.url));
      state.galleryItems = state.galleryItems.filter((i) => serverUrls.has(i.url));
      saveGalleryState();
    }
  } catch (_e) { /* offline — use cached gallery */ }
  renderGallery();
}

// Real-time gallery sync via Server-Sent Events
function connectSSE() {
  const evtSource = new EventSource('/api/events');

  evtSource.addEventListener('image:uploaded', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (!findGalleryItem(data.url)) {
        state.galleryItems.unshift({
          url: data.url,
          thumbnailUrl: data.thumbnailUrl || null,
          name: data.name || data.url.split('/').pop(),
          editCount: 0,
        });
        saveGalleryState();
        renderGallery();
      }
    } catch (_e) { /* ignore parse errors */ }
  });

  evtSource.addEventListener('image:deleted', (e) => {
    try {
      const data = JSON.parse(e.data);
      const existed = findGalleryItem(data.url);
      if (existed) {
        state.galleryItems = state.galleryItems.filter((i) => i.url !== data.url);
        saveGalleryState();
        renderGallery();
      }
    } catch (_e) { /* ignore parse errors */ }
  });

  evtSource.onerror = () => {
    // EventSource auto-reconnects; close only if CLOSED state
    if (evtSource.readyState === EventSource.CLOSED) {
      setTimeout(connectSSE, 5000);
    }
  };
}

// Initialize gallery
loadGalleryState();
syncGallery();
connectSSE();
