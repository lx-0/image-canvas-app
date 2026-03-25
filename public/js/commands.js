// Command classification, preview, and execution dispatch — layer-aware
import { els, state } from './state.js';
import { setChatEnabled } from './ui.js';
import { saveState, resizeAndDraw } from './canvas.js';
import { incrementEditCount } from './gallery.js';
import { compositeLayers } from './layers.js';
import * as filters from './filters.js';

const { canvas, ctx, chatMessages, statusEl } = els;

const DESTRUCTIVE_ACTIONS = new Set(['crop', 'resize', 'rotate', 'flip']);
const GEOMETRIC_ACTIONS = new Set(['crop', 'resize', 'rotate', 'flip']);

export function isDestructiveCommand(cmd) {
  return DESTRUCTIVE_ACTIONS.has(cmd.action);
}

export function hasDestructiveCommands(commands) {
  return commands.some(isDestructiveCommand);
}

function summarizeCommand(cmd) {
  switch (cmd.action) {
    case 'crop':
      return `Crop to ${cmd.width}%\u00D7${cmd.height}% at (${cmd.x}%, ${cmd.y}%)`;
    case 'resize':
      if (cmd.scale) return `Resize to ${Math.round(cmd.scale * 100)}%`;
      return `Resize to ${cmd.width}\u00D7${cmd.height}px`;
    case 'rotate':
      return `Rotate ${cmd.degrees}\u00B0`;
    case 'flip':
      return `Flip ${cmd.direction || 'horizontal'}`;
    case 'brightness':
      return `Adjust brightness ${cmd.value > 0 ? '+' : ''}${cmd.value}%`;
    case 'contrast':
      return `Adjust contrast ${cmd.value > 0 ? '+' : ''}${cmd.value}%`;
    case 'grayscale':
      return 'Convert to grayscale';
    case 'addText':
      return `Add text: "${cmd.text}"`;
    default:
      return cmd.action;
  }
}

function executeOnLayer(filterFn, cmd) {
  if (GEOMETRIC_ACTIONS.has(cmd?.action) && state.layers.length > 0) {
    // Apply geometric transforms to ALL layers
    for (const layer of state.layers) {
      filterFn(cmd, layer.canvas, layer.ctx);
    }
  } else {
    // Pixel transforms: active layer only (or display canvas if no layers)
    filterFn(cmd);
  }
}

export function executeCommands(commands) {
  if ((state.layers.length === 0 && !state.currentImg) || !commands || !Array.isArray(commands)) return;

  for (const cmd of commands) {
    switch (cmd.action) {
      case 'crop': executeOnLayer(filters.executeCrop, cmd); break;
      case 'resize': executeOnLayer(filters.executeResize, cmd); break;
      case 'rotate': executeOnLayer(filters.executeRotate, cmd); break;
      case 'flip': executeOnLayer(filters.executeFlip, cmd); break;
      case 'addText': filters.executeAddText(cmd); break;
      case 'grayscale': filters.executeGrayscale(); break;
      case 'brightness': filters.executeBrightness(cmd); break;
      case 'contrast': filters.executeContrast(cmd); break;
      case 'blur': filters.executeBlur(cmd); break;
      case 'sharpen': filters.executeSharpen(cmd); break;
      case 'sepia': filters.executeSepia(); break;
      case 'saturation': filters.executeSaturation(cmd); break;
      case 'hue-rotate': filters.executeHueRotate(cmd); break;
      case 'invert': filters.executeInvert(); break;
      case 'vignette': filters.executeVignette(cmd); break;
      case 'shadows-highlights': filters.executeShadowsHighlights(cmd); break;
    }
  }

  if (state.layers.length > 0) {
    compositeLayers();
    resizeAndDraw();
    saveState();
    const ref = state.layers[0].canvas;
    statusEl.textContent = `${ref.width}\u00D7${ref.height} rendered`;
  } else {
    const snapshot = new Image();
    snapshot.onload = () => {
      state.currentImg = snapshot;
      saveState();
      statusEl.textContent = `${state.currentImg.width}\u00D7${state.currentImg.height} rendered`;
      if (state.currentImageKey) incrementEditCount(state.currentImageKey);
    };
    snapshot.src = canvas.toDataURL('image/png');
  }
  if (state.currentImageKey) incrementEditCount(state.currentImageKey);
}

export function showCommandPreview(commands, messageDiv) {
  return new Promise((resolve) => {
    const needsConfirmation = hasDestructiveCommands(commands);

    if (!needsConfirmation) {
      executeCommands(commands);
      const badge = document.createElement('span');
      badge.className = 'cmd-badge auto-applied';
      badge.textContent = 'AUTO-APPLIED';
      messageDiv.insertBefore(document.createElement('br'), messageDiv.firstChild);
      messageDiv.insertBefore(badge, messageDiv.firstChild);
      resolve(true);
      return;
    }

    const card = document.createElement('div');
    card.className = 'cmd-preview';
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', 'Command preview \u2014 review before applying');

    const header = document.createElement('div');
    header.className = 'cmd-preview-header';
    header.innerHTML = '<span class="icon" aria-hidden="true">\u26A1</span> Commands to apply';
    card.appendChild(header);

    const list = document.createElement('ul');
    list.className = 'cmd-preview-list';
    list.setAttribute('aria-label', 'Proposed image commands');
    for (const cmd of commands) {
      const li = document.createElement('li');
      if (!isDestructiveCommand(cmd)) li.className = 'non-destructive';
      const icon = document.createElement('span');
      icon.className = 'cmd-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = isDestructiveCommand(cmd) ? '\u26A0' : '\u2713';
      li.appendChild(icon);
      const desc = summarizeCommand(cmd);
      li.appendChild(document.createTextNode(desc));
      if (isDestructiveCommand(cmd)) {
        li.setAttribute('aria-label', `Destructive: ${desc}`);
      }
      list.appendChild(li);
    }
    card.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'cmd-preview-actions';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'cmd-btn-apply';
    applyBtn.textContent = 'Apply';
    applyBtn.setAttribute('aria-label', 'Apply all commands');

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cmd-btn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.setAttribute('aria-label', 'Cancel commands');

    actions.appendChild(applyBtn);
    actions.appendChild(cancelBtn);
    card.appendChild(actions);

    chatMessages.appendChild(card);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    applyBtn.addEventListener('click', () => {
      executeCommands(commands);
      card.classList.add('resolved');
      const status = document.createElement('div');
      status.className = 'cmd-preview-status applied';
      status.textContent = '\u2713 Applied';
      card.appendChild(status);
      const badge = document.createElement('span');
      badge.className = 'cmd-badge';
      badge.textContent = 'APPLIED';
      messageDiv.insertBefore(document.createElement('br'), messageDiv.firstChild);
      messageDiv.insertBefore(badge, messageDiv.firstChild);
      setChatEnabled(true);
      resolve(true);
    });

    cancelBtn.addEventListener('click', () => {
      card.classList.add('resolved');
      const status = document.createElement('div');
      status.className = 'cmd-preview-status cancelled';
      status.textContent = '\u2717 Cancelled';
      card.appendChild(status);
      setChatEnabled(true);
      resolve(false);
    });
  });
}
