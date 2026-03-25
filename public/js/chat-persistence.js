// Chat conversation persistence (localStorage) — no gallery/commands deps
import { els, state } from './state.js';
import { addChatMessage } from './ui.js';

const { chatMessages } = els;

export function chatStorageKey(imageKey) {
  return state.CHAT_STORAGE_PREFIX + imageKey;
}

export function saveConversation() {
  if (!state.currentImageKey) return;
  const data = { messages: state.conversationHistory };
  try {
    localStorage.setItem(chatStorageKey(state.currentImageKey), JSON.stringify(data));
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      trimAndRetrySave();
    }
  }
}

function trimAndRetrySave() {
  if (!state.currentImageKey) return;
  const trimCount = Math.max(1, Math.floor(state.conversationHistory.length / 2));
  state.conversationHistory.splice(0, trimCount);
  try {
    localStorage.setItem(chatStorageKey(state.currentImageKey), JSON.stringify({ messages: state.conversationHistory }));
  } catch (_e) {
    localStorage.removeItem(chatStorageKey(state.currentImageKey));
  }
}

export function loadConversation(imageKey) {
  try {
    const raw = localStorage.getItem(chatStorageKey(imageKey));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.messages || null;
  } catch (_e) {
    return null;
  }
}

export function clearConversation() {
  if (state.currentImageKey) {
    localStorage.removeItem(chatStorageKey(state.currentImageKey));
  }
  state.conversationHistory = [];
  chatMessages.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'chat-msg system';
  div.textContent = 'Upload an image, then ask me to edit it. I can crop, resize, rotate, add text, flip, adjust brightness/contrast, and more.';
  chatMessages.appendChild(div);
}

export function restoreConversationUI(messages) {
  chatMessages.innerHTML = '';
  for (const msg of messages) {
    addChatMessage(msg.role, msg.content, false);
  }
}
