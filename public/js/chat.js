// Chat messaging, SSE streaming
import { els, state } from './state.js';
import { setChatEnabled, addTypingIndicator, removeTypingIndicator,
         addChatMessage, addSystemMessage, addRetryableError, addStreamingMessage } from './ui.js';
import { getCanvasDataURL } from './canvas.js';
import { hasDestructiveCommands, showCommandPreview } from './commands.js';
import { saveConversation, clearConversation } from './chat-persistence.js';

const { chatMessages, chatInput, chatSend } = els;

// Re-export for convenience
export { saveConversation, loadConversation, restoreConversationUI, clearConversation, chatStorageKey } from './chat-persistence.js';

// --- Image attachment UI ---
const attachBtn = document.getElementById('chat-attach-btn');
const attachmentsBar = document.getElementById('chat-attachments');
const picker = document.getElementById('chat-image-picker');
const pickerGrid = document.getElementById('chat-image-picker-grid');
const pickerClose = document.getElementById('chat-picker-close');

function renderAttachments() {
  if (state.chatAttachedImages.length === 0) {
    attachmentsBar.style.display = 'none';
    attachmentsBar.innerHTML = '';
    return;
  }
  attachmentsBar.style.display = 'flex';
  attachmentsBar.innerHTML = '';
  for (const item of state.chatAttachedImages) {
    const thumb = document.createElement('div');
    thumb.className = 'chat-attachment-thumb';

    const img = document.createElement('img');
    img.src = item.thumbnailUrl || item.url;
    img.alt = item.name || 'attached image';
    thumb.appendChild(img);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'chat-attachment-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', () => {
      state.chatAttachedImages = state.chatAttachedImages.filter(i => i.url !== item.url);
      renderAttachments();
      // Update picker selection if open
      if (picker.style.display !== 'none') renderPicker();
    });
    thumb.appendChild(removeBtn);

    attachmentsBar.appendChild(thumb);
  }
}

function renderPicker() {
  pickerGrid.innerHTML = '';
  const items = state.galleryItems;
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = 'No gallery images available.';
    pickerGrid.appendChild(empty);
    return;
  }
  const attachedUrls = new Set(state.chatAttachedImages.map(i => i.url));
  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'picker-image';
    if (attachedUrls.has(item.url)) div.classList.add('selected');

    const img = document.createElement('img');
    img.src = item.thumbnailUrl || item.url;
    img.alt = item.name || 'gallery image';
    img.loading = 'lazy';
    div.appendChild(img);

    const check = document.createElement('span');
    check.className = 'picker-check';
    check.textContent = '✓';
    div.appendChild(check);

    div.addEventListener('click', () => {
      if (attachedUrls.has(item.url)) {
        state.chatAttachedImages = state.chatAttachedImages.filter(i => i.url !== item.url);
        attachedUrls.delete(item.url);
        div.classList.remove('selected');
      } else {
        state.chatAttachedImages.push({ url: item.url, thumbnailUrl: item.thumbnailUrl, name: item.name });
        attachedUrls.add(item.url);
        div.classList.add('selected');
      }
      renderAttachments();
    });

    pickerGrid.appendChild(div);
  }
}

function togglePicker() {
  if (picker.style.display === 'none') {
    renderPicker();
    picker.style.display = 'block';
  } else {
    picker.style.display = 'none';
  }
}

attachBtn.addEventListener('click', togglePicker);
pickerClose.addEventListener('click', () => { picker.style.display = 'none'; });

// SSE parser
export function createSSEParser(onEvent) {
  let buffer = '';
  return function feed(chunk) {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    let eventType = null;
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7);
      } else if (line.startsWith('data: ') && eventType) {
        try {
          onEvent(eventType, JSON.parse(line.slice(6)));
        } catch (_e) { /* skip malformed data */ }
        eventType = null;
      }
    }
  };
}

// Send chat message with streaming
export async function sendMessage(retryText) {
  const isRetry = typeof retryText === 'string';
  const text = isRetry ? retryText : chatInput.value.trim();
  if (!text) return;

  if (!isRetry) {
    // Show attached images in the user message
    const attachedCount = state.chatAttachedImages.length;
    const displayText = attachedCount > 0
      ? `${text}\n[${attachedCount} image${attachedCount > 1 ? 's' : ''} attached]`
      : text;
    addChatMessage('user', displayText);
    chatInput.value = '';
  }
  setChatEnabled(false);
  attachBtn.disabled = true;
  picker.style.display = 'none';
  addTypingIndicator();

  if (!isRetry) {
    state.conversationHistory.push({ role: 'user', content: text });
    saveConversation();
  }

  // Collect attached gallery image URLs
  const additionalImages = state.chatAttachedImages.map(i => i.url);
  // Clear attachments after sending
  state.chatAttachedImages = [];
  renderAttachments();

  const body = {
    messages: state.conversationHistory,
    imageData: getCanvasDataURL(),
    additionalImages: additionalImages.length > 0 ? additionalImages : undefined,
  };

  try {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error('Stream endpoint returned ' + res.status);
    }

    removeTypingIndicator();
    const { div, textNode } = addStreamingMessage();
    let streamedText = '';
    let doneData = null;

    await new Promise((resolve, reject) => {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      const parser = createSSEParser((event, data) => {
        if (event === 'delta') {
          streamedText += data.text;
          const display = streamedText.replace(/<commands>[\s\S]*?(<\/commands>)?/g, '').trim();
          textNode.textContent = display;
          chatMessages.scrollTop = chatMessages.scrollHeight;
        } else if (event === 'done') {
          doneData = data;
        } else if (event === 'error') {
          reject(new Error(data.error || 'Stream error'));
        }
      });

      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) return resolve();
          parser(decoder.decode(value, { stream: true }));
          pump();
        }).catch(reject);
      }
      pump();
    });

    if (doneData) {
      const responseText = doneData.response || '(no response)';
      textNode.textContent = responseText;
      state.conversationHistory.push({ role: 'assistant', content: responseText });
      saveConversation();

      if (doneData.commands && doneData.commands.length > 0) {
        if (hasDestructiveCommands(doneData.commands)) {
          showCommandPreview(doneData.commands, div);
          return;
        }
        showCommandPreview(doneData.commands, div);
      }
    } else {
      const display = streamedText.replace(/<commands>[\s\S]*?<\/commands>\s*/g, '').trim();
      textNode.textContent = display || '(no response)';
      state.conversationHistory.push({ role: 'assistant', content: display || '' });
      saveConversation();
    }
  } catch (streamErr) {
    removeTypingIndicator();
    addTypingIndicator();
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        removeTypingIndicator();
        const errMsg = data.error || 'Chat request failed.';
        if (data.retryable) {
          state.conversationHistory.pop();
          addRetryableError(errMsg, sendMessage.bind(null, text));
        } else {
          addSystemMessage(errMsg);
          state.conversationHistory.pop();
        }
        setChatEnabled(true);
        attachBtn.disabled = false;
        return;
      }

      const responseText = data.response || '(no response)';
      state.conversationHistory.push({ role: 'assistant', content: responseText });
      saveConversation();

      removeTypingIndicator();
      addChatMessage('assistant', responseText, false);
      if (data.commands && data.commands.length > 0) {
        const lastMsg = chatMessages.lastElementChild;
        if (hasDestructiveCommands(data.commands)) {
          showCommandPreview(data.commands, lastMsg);
          return;
        }
        showCommandPreview(data.commands, lastMsg);
      }
    } catch (fallbackErr) {
      removeTypingIndicator();
      state.conversationHistory.pop();
      const isNetwork = fallbackErr instanceof TypeError || fallbackErr.message.includes('fetch') || fallbackErr.message.includes('network');
      if (isNetwork) {
        addRetryableError('Network error — check your connection and try again.', sendMessage.bind(null, text));
      } else {
        addRetryableError('Something went wrong. ' + fallbackErr.message, sendMessage.bind(null, text));
      }
    }
  }

  setChatEnabled(true);
  attachBtn.disabled = false;
}

// Event listeners
chatSend.addEventListener('click', sendMessage);

document.getElementById('new-chat-btn').addEventListener('click', () => {
  clearConversation();
  state.chatAttachedImages = [];
  renderAttachments();
  picker.style.display = 'none';
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
});
