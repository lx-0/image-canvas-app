import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to mock state.js before gallery.js loads
const mockGalleryList = document.createElement('div');
const mockGallerySidebar = document.createElement('div');
const mockGalleryCollapseBtn = document.createElement('button');
const mockGalleryToggleBtn = document.createElement('button');
const mockDeleteOverlay = document.createElement('div');
const mockDeleteYesBtn = document.createElement('button');
const mockDeleteNoBtn = document.createElement('button');
const mockStatusEl = document.createElement('div');
const mockErrorEl = document.createElement('div');
const mockChatMessages = document.createElement('div');

const galleryState = {
  currentImg: null,
  currentImageKey: null,
  conversationHistory: [],
  historyStack: [],
  historyIndex: -1,
  galleryItems: [],
  pendingDeleteUrl: null,
  GALLERY_KEY: 'imggallery_items',
  GALLERY_COLLAPSED_KEY: 'imggallery_collapsed',
  CHAT_STORAGE_PREFIX: 'imgchat_',
};

vi.mock('../../public/js/state.js', () => ({
  els: {
    gallerySidebar: mockGallerySidebar,
    galleryList: mockGalleryList,
    galleryCollapseBtn: mockGalleryCollapseBtn,
    galleryToggleBtn: mockGalleryToggleBtn,
    deleteOverlay: mockDeleteOverlay,
    deleteYesBtn: mockDeleteYesBtn,
    deleteNoBtn: mockDeleteNoBtn,
    statusEl: mockStatusEl,
    errorEl: mockErrorEl,
    chatMessages: mockChatMessages,
  },
  state: galleryState,
}));

vi.mock('../../public/js/ui.js', () => ({
  addSystemMessage: vi.fn(),
}));

vi.mock('../../public/js/canvas.js', () => ({
  resizeAndDraw: vi.fn(),
  resetZoomPan: vi.fn(),
  saveState: vi.fn(),
  updateUndoRedoButtons: vi.fn(),
}));

vi.mock('../../public/js/chat-persistence.js', () => ({
  loadConversation: vi.fn(() => null),
  restoreConversationUI: vi.fn(),
  chatStorageKey: vi.fn((key) => 'imgchat_' + key),
}));

// Mock fetch for syncGallery and delete
global.fetch = vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ images: [] }) }));

// Mock EventSource
class MockEventSource {
  constructor() { this.readyState = 0; }
  addEventListener() {}
  close() {}
  set onerror(_fn) {}
}
global.EventSource = MockEventSource;

const { addToGallery, incrementEditCount, renderGallery } = await import('../../public/js/gallery.js');

describe('gallery', () => {
  beforeEach(() => {
    galleryState.galleryItems = [];
    galleryState.currentImageKey = null;
    galleryState.pendingDeleteUrl = null;
    mockGalleryList.innerHTML = '';
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('addToGallery', () => {
    it('adds a new image to the gallery', () => {
      addToGallery('/uploads/test.png', 'test.png');
      expect(galleryState.galleryItems).toHaveLength(1);
      expect(galleryState.galleryItems[0].url).toBe('/uploads/test.png');
      expect(galleryState.galleryItems[0].name).toBe('test.png');
      expect(galleryState.galleryItems[0].editCount).toBe(0);
    });

    it('does not add duplicate URLs', () => {
      addToGallery('/uploads/test.png', 'test.png');
      addToGallery('/uploads/test.png', 'test.png');
      expect(galleryState.galleryItems).toHaveLength(1);
    });

    it('adds items to the front of the list', () => {
      addToGallery('/uploads/first.png', 'first.png');
      addToGallery('/uploads/second.png', 'second.png');
      expect(galleryState.galleryItems[0].url).toBe('/uploads/second.png');
    });

    it('persists to localStorage', () => {
      addToGallery('/uploads/test.png', 'test.png');
      const stored = JSON.parse(localStorage.getItem('imggallery_items'));
      expect(stored).toHaveLength(1);
      expect(stored[0].url).toBe('/uploads/test.png');
    });

    it('extracts filename as name when not provided', () => {
      addToGallery('/uploads/photo.jpg');
      expect(galleryState.galleryItems[0].name).toBe('photo.jpg');
    });

    it('stores thumbnail URL', () => {
      addToGallery('/uploads/img.png', 'img.png', '/thumbnails/img.png');
      expect(galleryState.galleryItems[0].thumbnailUrl).toBe('/thumbnails/img.png');
    });
  });

  describe('incrementEditCount', () => {
    it('increments edit count for existing item', () => {
      addToGallery('/uploads/test.png', 'test.png');
      incrementEditCount('/uploads/test.png');
      expect(galleryState.galleryItems[0].editCount).toBe(1);
    });

    it('increments multiple times', () => {
      addToGallery('/uploads/test.png', 'test.png');
      incrementEditCount('/uploads/test.png');
      incrementEditCount('/uploads/test.png');
      incrementEditCount('/uploads/test.png');
      expect(galleryState.galleryItems[0].editCount).toBe(3);
    });

    it('does nothing for unknown URL', () => {
      addToGallery('/uploads/test.png', 'test.png');
      incrementEditCount('/uploads/nonexistent.png');
      expect(galleryState.galleryItems[0].editCount).toBe(0);
    });
  });

  describe('renderGallery', () => {
    it('shows empty state when no items', () => {
      renderGallery();
      const empty = mockGalleryList.querySelector('#gallery-empty');
      expect(empty).not.toBeNull();
      expect(empty.textContent).toContain('No images yet');
    });

    it('renders gallery items as DOM elements', () => {
      galleryState.galleryItems = [
        { url: '/uploads/a.png', name: 'a.png', editCount: 0, thumbnailUrl: null },
        { url: '/uploads/b.png', name: 'b.png', editCount: 2, thumbnailUrl: null },
      ];
      renderGallery();
      const items = mockGalleryList.querySelectorAll('.gallery-item');
      expect(items).toHaveLength(2);
    });

    it('shows edit badge when editCount > 0', () => {
      galleryState.galleryItems = [
        { url: '/uploads/a.png', name: 'a.png', editCount: 5, thumbnailUrl: null },
      ];
      renderGallery();
      const badge = mockGalleryList.querySelector('.edit-badge');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toBe('5');
    });

    it('marks active item', () => {
      galleryState.galleryItems = [
        { url: '/uploads/a.png', name: 'a.png', editCount: 0, thumbnailUrl: null },
      ];
      galleryState.currentImageKey = '/uploads/a.png';
      renderGallery();
      const item = mockGalleryList.querySelector('.gallery-item');
      expect(item.classList.contains('active')).toBe(true);
    });

    it('does not show edit badge when editCount is 0', () => {
      galleryState.galleryItems = [
        { url: '/uploads/a.png', name: 'a.png', editCount: 0, thumbnailUrl: null },
      ];
      renderGallery();
      const badge = mockGalleryList.querySelector('.edit-badge');
      expect(badge).toBeNull();
    });
  });
});
