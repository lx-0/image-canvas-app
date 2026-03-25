// Shared application state and DOM element references

// DOM elements
export const els = {
  form: document.getElementById('upload-form'),
  fileInput: document.getElementById('file-input'),
  canvas: document.getElementById('canvas'),
  ctx: document.getElementById('canvas').getContext('2d'),
  statusEl: document.getElementById('status'),
  errorEl: document.getElementById('error'),
  container: document.getElementById('canvas-container'),
  chatMessages: document.getElementById('chat-messages'),
  chatInput: document.getElementById('chat-input'),
  chatSend: document.getElementById('chat-send'),
  undoBtn: document.getElementById('undo-btn'),
  redoBtn: document.getElementById('redo-btn'),
  saveBtn: document.getElementById('save-btn'),
  uploadProgress: document.getElementById('upload-progress'),
  uploadProgressBar: document.getElementById('upload-progress-bar'),
  canvasOverlay: document.getElementById('canvas-overlay'),
  canvasOverlayText: document.getElementById('canvas-overlay-text'),
  exportOverlay: document.getElementById('export-dialog-overlay'),
  exportFilename: document.getElementById('export-filename'),
  exportFormat: document.getElementById('export-format'),
  exportQuality: document.getElementById('export-quality'),
  qualityValue: document.getElementById('quality-value'),
  qualityField: document.getElementById('quality-field'),
  exportCancelBtn: document.getElementById('export-cancel-btn'),
  exportDownloadBtn: document.getElementById('export-download-btn'),
  themeToggle: document.getElementById('theme-toggle'),
  themeIcon: document.getElementById('theme-icon'),
  gallerySidebar: document.getElementById('gallery-sidebar'),
  galleryList: document.getElementById('gallery-list'),
  galleryCollapseBtn: document.getElementById('gallery-collapse-btn'),
  galleryToggleBtn: document.getElementById('gallery-toggle-btn'),
  deleteOverlay: document.getElementById('delete-confirm-overlay'),
  deleteYesBtn: document.getElementById('delete-confirm-yes'),
  deleteNoBtn: document.getElementById('delete-confirm-no'),
  shortcutsOverlay: document.getElementById('shortcuts-overlay'),
  srAnnouncer: document.getElementById('sr-announcer'),
  zoomLevelEl: document.getElementById('zoom-level'),
  zoomInBtn: document.getElementById('zoom-in-btn'),
  zoomOutBtn: document.getElementById('zoom-out-btn'),
  zoomFitBtn: document.getElementById('zoom-fit-btn'),
  emptyState: document.getElementById('empty-state'),
};

// Mutable application state
export const state = {
  currentImg: null,
  currentImageKey: null,
  conversationHistory: [],

  // Undo/Redo
  MAX_HISTORY: 20,
  historyStack: [],
  historyIndex: -1,

  // Zoom & Pan
  MIN_ZOOM: 0.1,
  MAX_ZOOM: 5,
  ZOOM_STEP: 0.1,
  zoomLevel: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
  panStartX: 0,
  panStartY: 0,
  panStartPanX: 0,
  panStartPanY: 0,

  // Gallery
  GALLERY_KEY: 'imggallery_items',
  GALLERY_COLLAPSED_KEY: 'imggallery_collapsed',
  galleryItems: [],
  pendingDeleteUrl: null,

  // Chat persistence
  CHAT_STORAGE_PREFIX: 'imgchat_',
  MAX_STORED_MESSAGES: 200,

  // Drag-and-drop
  dragCounter: 0,
};
