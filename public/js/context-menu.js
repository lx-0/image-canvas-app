// Canvas right-click context menu
import { els, state } from './state.js';
import { undo, redo, resetZoomPan, getCanvasDataURL } from './canvas.js';
import { openExportDialog } from './export.js';
import { announce } from './ui.js';

const { container } = els;

const menu = document.getElementById('canvas-context-menu');

function show(x, y) {
  // Update disabled states
  menu.querySelector('[data-action="undo"]').classList.toggle('disabled', state.historyIndex <= 0);
  menu.querySelector('[data-action="redo"]').classList.toggle('disabled', state.historyIndex >= state.historyStack.length - 1);

  const hasImage = !!state.currentImg;
  menu.querySelector('[data-action="export"]').classList.toggle('disabled', !hasImage);
  menu.querySelector('[data-action="copy"]').classList.toggle('disabled', !hasImage);

  // Position within viewport
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('visible');

  // Adjust if overflowing viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = (x - rect.width) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = (y - rect.height) + 'px';
  }

  // Focus first enabled item for keyboard nav
  const first = menu.querySelector('.ctx-item:not(.disabled)');
  if (first) first.focus();
}

function hide() {
  menu.classList.remove('visible');
}

async function copyToClipboard() {
  const dataURL = getCanvasDataURL();
  if (!dataURL) return;

  try {
    const res = await fetch(dataURL);
    const blob = await res.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob })
    ]);
    announce('Image copied to clipboard');
  } catch {
    announce('Failed to copy image');
  }
}

const actions = {
  undo() { undo(); announce('Undo'); },
  redo() { redo(); announce('Redo'); },
  fit() { resetZoomPan(); announce('Fit to view'); },
  reset() { resetZoomPan(); announce('Zoom reset'); },
  export() { openExportDialog(); },
  copy() { copyToClipboard(); },
};

// Right-click on canvas container
container.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  show(e.clientX, e.clientY);
});

// Click menu item
menu.addEventListener('click', (e) => {
  const item = e.target.closest('.ctx-item');
  if (!item || item.classList.contains('disabled')) return;
  const action = item.dataset.action;
  if (actions[action]) actions[action]();
  hide();
});

// Keyboard navigation within menu
menu.addEventListener('keydown', (e) => {
  const items = [...menu.querySelectorAll('.ctx-item:not(.disabled)')];
  const idx = items.indexOf(document.activeElement);

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    items[(idx + 1) % items.length]?.focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    items[(idx - 1 + items.length) % items.length]?.focus();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    document.activeElement?.click();
  } else if (e.key === 'Escape') {
    hide();
  }
});

// Dismiss on outside click
document.addEventListener('mousedown', (e) => {
  if (menu.classList.contains('visible') && !menu.contains(e.target)) {
    hide();
  }
});

// Dismiss on Escape (global)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menu.classList.contains('visible')) {
    hide();
  }
});
