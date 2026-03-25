// Theme, accessibility, keyboard shortcuts, progress indicators
import { els } from './state.js';

const { themeToggle, themeIcon, srAnnouncer, uploadProgress: uploadProgressEl,
        uploadProgressBar, canvasOverlay, canvasOverlayText, chatMessages,
        chatSend, chatInput, statusEl, errorEl } = els;

// Theme
export function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function setTheme(theme) {
  document.body.classList.add('theme-transitioning');
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  themeIcon.textContent = theme === 'light' ? '🌙' : '☀';
  localStorage.setItem('theme', theme);
  setTimeout(() => document.body.classList.remove('theme-transitioning'), 250);
}

export function toggleTheme() {
  setTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
}

// Progress indicators
export function showUploadProgress(pct) {
  uploadProgressEl.classList.add('visible');
  uploadProgressBar.style.width = pct + '%';
  uploadProgressEl.setAttribute('aria-valuenow', Math.round(pct));
}

export function hideUploadProgress() {
  uploadProgressEl.classList.remove('visible');
  uploadProgressBar.style.width = '0%';
}

export function showCanvasOverlay(text) {
  canvasOverlayText.textContent = text || 'Processing…';
  canvasOverlay.classList.add('visible');
}

export function hideCanvasOverlay() {
  canvasOverlay.classList.remove('visible');
}

// Typing indicator
export function addTypingIndicator() {
  const div = document.createElement('div');
  div.className = 'typing-indicator';
  div.id = 'typing-indicator';
  div.innerHTML = '<span></span><span></span><span></span>';
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

export function removeTypingIndicator() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

// Chat enable/disable
export function setChatEnabled(enabled) {
  chatSend.disabled = !enabled;
  chatInput.disabled = !enabled;
  if (enabled) chatInput.focus();
}

// Chat message helpers
export function addChatMessage(role, text, hadCommands) {
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  if (hadCommands && role === 'assistant') {
    const badge = document.createElement('span');
    badge.className = 'cmd-badge';
    badge.textContent = 'APPLIED';
    div.appendChild(badge);
    div.appendChild(document.createElement('br'));
  }
  div.appendChild(document.createTextNode(text));
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

export function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'chat-msg system';
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

export function addRetryableError(text, retryFn) {
  const div = document.createElement('div');
  div.className = 'chat-msg system';
  const msgSpan = document.createElement('span');
  msgSpan.textContent = text + ' ';
  div.appendChild(msgSpan);
  const retryBtn = document.createElement('button');
  retryBtn.textContent = 'Retry';
  retryBtn.style.cssText = 'padding:2px 10px;border-radius:4px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-size:0.85em;margin-left:4px';
  retryBtn.addEventListener('click', () => {
    div.remove();
    retryFn();
  });
  div.appendChild(retryBtn);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

export function addStreamingMessage() {
  const div = document.createElement('div');
  div.className = 'chat-msg assistant';
  const textNode = document.createTextNode('');
  div.appendChild(textNode);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return { div, textNode };
}

// Screen reader announcements
export function announce(msg) {
  srAnnouncer.textContent = '';
  requestAnimationFrame(() => { srAnnouncer.textContent = msg; });
}

// Focus trap utility
export function trapFocus(dialogEl) {
  const focusable = dialogEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!focusable.length) return null;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  function handler(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  dialogEl.addEventListener('keydown', handler);
  return () => dialogEl.removeEventListener('keydown', handler);
}

// Upload with progress
export function uploadWithProgress(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        showUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener('load', () => {
      hideUploadProgress();
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(new Error(data.error || 'Upload failed.'));
        }
      } catch (_e) {
        reject(new Error('Upload failed.'));
      }
    });
    xhr.addEventListener('error', () => {
      hideUploadProgress();
      reject(new Error('Upload failed.'));
    });
    xhr.send(formData);
  });
}

// Initialize theme on module load
themeIcon.textContent = getCurrentTheme() === 'light' ? '🌙' : '☀';
themeToggle.addEventListener('click', toggleTheme);

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
  if (!localStorage.getItem('theme')) {
    setTheme(e.matches ? 'light' : 'dark');
  }
});

// Observe status/error for screen reader announcements
const statusObserver = new MutationObserver(() => {
  const text = statusEl.textContent;
  if (text) announce(text);
});
statusObserver.observe(statusEl, { childList: true, characterData: true, subtree: true });

const errorObserver = new MutationObserver(() => {
  const text = errorEl.textContent;
  if (text) announce(text);
});
errorObserver.observe(errorEl, { childList: true, characterData: true, subtree: true });
