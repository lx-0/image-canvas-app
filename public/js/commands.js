// Command classification, preview, and execution dispatch
import { els, state } from './state.js';
import { setChatEnabled } from './ui.js';
import { saveState } from './canvas.js';
import { incrementEditCount } from './gallery.js';
import * as filters from './filters.js';

const { canvas, ctx, chatMessages, statusEl } = els;

const DESTRUCTIVE_ACTIONS = new Set(['crop', 'resize', 'rotate', 'flip']);

export function isDestructiveCommand(cmd) {
  return DESTRUCTIVE_ACTIONS.has(cmd.action);
}

export function hasDestructiveCommands(commands) {
  return commands.some(isDestructiveCommand);
}

function summarizeCommand(cmd) {
  switch (cmd.action) {
    case 'crop':
      return `Crop to ${cmd.width}%×${cmd.height}% at (${cmd.x}%, ${cmd.y}%)`;
    case 'resize':
      if (cmd.scale) return `Resize to ${Math.round(cmd.scale * 100)}%`;
      return `Resize to ${cmd.width}×${cmd.height}px`;
    case 'rotate':
      return `Rotate ${cmd.degrees}°`;
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

export function executeCommands(commands) {
  if (!state.currentImg || !commands || !Array.isArray(commands)) return;

  for (const cmd of commands) {
    switch (cmd.action) {
      case 'crop': filters.executeCrop(cmd); break;
      case 'resize': filters.executeResize(cmd); break;
      case 'rotate': filters.executeRotate(cmd); break;
      case 'addText': filters.executeAddText(cmd); break;
      case 'flip': filters.executeFlip(cmd); break;
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

  const snapshot = new Image();
  snapshot.onload = () => {
    state.currentImg = snapshot;
    saveState();
    statusEl.textContent = `${state.currentImg.width}×${state.currentImg.height} rendered`;
    if (state.currentImageKey) incrementEditCount(state.currentImageKey);
  };
  snapshot.src = canvas.toDataURL('image/png');
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

    const header = document.createElement('div');
    header.className = 'cmd-preview-header';
    header.innerHTML = '<span class="icon">⚡</span> Commands to apply';
    card.appendChild(header);

    const list = document.createElement('ul');
    list.className = 'cmd-preview-list';
    for (const cmd of commands) {
      const li = document.createElement('li');
      if (!isDestructiveCommand(cmd)) li.className = 'non-destructive';
      const icon = document.createElement('span');
      icon.className = 'cmd-icon';
      icon.textContent = isDestructiveCommand(cmd) ? '⚠' : '✓';
      li.appendChild(icon);
      li.appendChild(document.createTextNode(summarizeCommand(cmd)));
      list.appendChild(li);
    }
    card.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'cmd-preview-actions';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'cmd-btn-apply';
    applyBtn.textContent = 'Apply';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cmd-btn-cancel';
    cancelBtn.textContent = 'Cancel';

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
      status.textContent = '✓ Applied';
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
      status.textContent = '✗ Cancelled';
      card.appendChild(status);
      setChatEnabled(true);
      resolve(false);
    });
  });
}
