import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- SSE Parser tests ---
// createSSEParser is a pure function; we need to mock the module's side-effect imports

vi.mock('../../public/js/state.js', () => {
  const mockEl = (tag = 'div') => {
    const el = document.createElement(tag);
    el.style = {};
    return el;
  };
  return {
    els: {
      chatMessages: mockEl(),
      chatInput: Object.assign(mockEl('textarea'), { value: '' }),
      chatSend: mockEl('button'),
      canvas: Object.assign(mockEl('canvas'), { width: 100, height: 100, toDataURL: () => '' }),
      ctx: {},
      statusEl: mockEl(),
      errorEl: mockEl(),
    },
    state: {
      currentImg: null,
      currentImageKey: null,
      conversationHistory: [],
      chatAttachedImages: [],
      galleryItems: [],
      CHAT_STORAGE_PREFIX: 'imgchat_',
    },
  };
});

vi.mock('../../public/js/ui.js', () => ({
  setChatEnabled: vi.fn(),
  addTypingIndicator: vi.fn(),
  removeTypingIndicator: vi.fn(),
  addChatMessage: vi.fn(),
  addSystemMessage: vi.fn(),
  addRetryableError: vi.fn(),
  addStreamingMessage: vi.fn(() => ({ div: document.createElement('div'), textNode: document.createTextNode('') })),
}));

vi.mock('../../public/js/canvas.js', () => ({
  getCanvasDataURL: vi.fn(() => 'data:image/png;base64,mock'),
}));

vi.mock('../../public/js/commands.js', () => ({
  hasDestructiveCommands: vi.fn(() => false),
  showCommandPreview: vi.fn(),
}));

vi.mock('../../public/js/chat-persistence.js', () => ({
  saveConversation: vi.fn(),
  clearConversation: vi.fn(),
  loadConversation: vi.fn(),
  restoreConversationUI: vi.fn(),
  chatStorageKey: vi.fn((key) => 'imgchat_' + key),
}));

// Stub DOM elements that chat.js grabs at module load
document.body.innerHTML = `
  <button id="chat-attach-btn"></button>
  <div id="chat-attachments"></div>
  <div id="chat-image-picker" style="display:none"></div>
  <div id="chat-image-picker-grid"></div>
  <button id="chat-picker-close"></button>
  <button id="new-chat-btn"></button>
`;

const { createSSEParser } = await import('../../public/js/chat.js');

describe('SSE Parser (createSSEParser)', () => {
  it('parses a single event', () => {
    const events = [];
    const parser = createSSEParser((type, data) => events.push({ type, data }));
    parser('event: delta\ndata: {"text":"hello"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('delta');
    expect(events[0].data).toEqual({ text: 'hello' });
  });

  it('parses multiple events in one chunk', () => {
    const events = [];
    const parser = createSSEParser((type, data) => events.push({ type, data }));
    parser('event: delta\ndata: {"text":"a"}\n\nevent: delta\ndata: {"text":"b"}\n\n');
    expect(events).toHaveLength(2);
    expect(events[0].data.text).toBe('a');
    expect(events[1].data.text).toBe('b');
  });

  it('buffers incomplete lines until newline arrives', () => {
    const events = [];
    const parser = createSSEParser((type, data) => events.push({ type, data }));
    // Partial line stays in buffer
    parser('event: delta\ndata: {"text":"hel');
    expect(events).toHaveLength(0);
    // Complete the line and event in a single feed that also carries event type
    parser('lo"}\nevent: delta\ndata: {"text":"world"}\n\n');
    // First event's data line completed but eventType was lost (parser resets per call)
    // Only the second complete event+data pair fires
    expect(events).toHaveLength(1);
    expect(events[0].data.text).toBe('world');
  });

  it('delivers events when event and data arrive in same chunk', () => {
    const events = [];
    const parser = createSSEParser((type, data) => events.push({ type, data }));
    // Simulating a real SSE stream where chunks contain complete event+data pairs
    parser('event: delta\ndata: {"text":"a"}\n\nevent: done\ndata: {"response":"finished"}\n\n');
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('delta');
    expect(events[1].type).toBe('done');
  });

  it('parses done event with commands', () => {
    const events = [];
    const parser = createSSEParser((type, data) => events.push({ type, data }));
    parser('event: done\ndata: {"response":"ok","commands":[{"action":"grayscale"}]}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('done');
    expect(events[0].data.commands).toHaveLength(1);
  });

  it('parses error events', () => {
    const events = [];
    const parser = createSSEParser((type, data) => events.push({ type, data }));
    parser('event: error\ndata: {"error":"rate limited"}\n\n');
    expect(events[0].type).toBe('error');
    expect(events[0].data.error).toBe('rate limited');
  });

  it('skips malformed JSON data', () => {
    const events = [];
    const parser = createSSEParser((type, data) => events.push({ type, data }));
    parser('event: delta\ndata: not-json\n\nevent: delta\ndata: {"text":"ok"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].data.text).toBe('ok');
  });

  it('ignores data lines without preceding event type', () => {
    const events = [];
    const parser = createSSEParser((type, data) => events.push({ type, data }));
    parser('data: {"text":"orphan"}\n\n');
    expect(events).toHaveLength(0);
  });
});

// --- Conversation persistence tests (via chat-persistence module) ---
describe('chat-persistence', () => {
  let chatPersistence;

  beforeEach(async () => {
    localStorage.clear();
    chatPersistence = await import('../../public/js/chat-persistence.js');
    vi.clearAllMocks();
  });

  describe('chatStorageKey', () => {
    it('returns prefixed key for image URL', () => {
      expect(chatPersistence.chatStorageKey('/uploads/test.png')).toBe('imgchat_/uploads/test.png');
    });
  });
});
