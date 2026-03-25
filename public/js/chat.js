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

// SSE parser
function createSSEParser(onEvent) {
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
    addChatMessage('user', text);
    chatInput.value = '';
  }
  setChatEnabled(false);
  addTypingIndicator();

  if (!isRetry) {
    state.conversationHistory.push({ role: 'user', content: text });
    saveConversation();
  }

  const body = {
    messages: state.conversationHistory,
    imageData: getCanvasDataURL(),
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
}

// Event listeners
chatSend.addEventListener('click', sendMessage);

document.getElementById('new-chat-btn').addEventListener('click', () => {
  clearConversation();
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
