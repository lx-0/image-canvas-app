import js from "@eslint/js";

const nodeGlobals = {
  process: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  console: "readonly",
  Buffer: "readonly",
  setTimeout: "readonly",
  setInterval: "readonly",
  clearTimeout: "readonly",
  clearInterval: "readonly",
  URL: "readonly",
  module: "readonly",
  require: "readonly",
  exports: "readonly",
  global: "readonly",
};

const browserGlobals = {
  window: "readonly",
  document: "readonly",
  HTMLElement: "readonly",
  FileReader: "readonly",
  Image: "readonly",
  Event: "readonly",
  FormData: "readonly",
  fetch: "readonly",
  alert: "readonly",
  confirm: "readonly",
  prompt: "readonly",
  requestAnimationFrame: "readonly",
  navigator: "readonly",
  HTMLCanvasElement: "readonly",
  HTMLImageElement: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  MutationObserver: "readonly",
  ResizeObserver: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
  ClipboardItem: "readonly",
  File: "readonly",
  Blob: "readonly",
  DataTransfer: "readonly",
  DragEvent: "readonly",
  CustomEvent: "readonly",
  AbortController: "readonly",
  setTimeout: "readonly",
  setInterval: "readonly",
  clearTimeout: "readonly",
  clearInterval: "readonly",
  URL: "readonly",
  ImageData: "readonly",
  EventSource: "readonly",
  XMLHttpRequest: "readonly",
  Response: "readonly",
};

const serviceWorkerGlobals = {
  self: "readonly",
  caches: "readonly",
  Response: "readonly",
  URL: "readonly",
  fetch: "readonly",
  console: "readonly",
};

const testGlobals = {
  describe: "readonly",
  it: "readonly",
  test: "readonly",
  expect: "readonly",
  vi: "readonly",
  beforeEach: "readonly",
  afterEach: "readonly",
  beforeAll: "readonly",
  afterAll: "readonly",
};

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    ignores: ["src/**/*.test.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...nodeGlobals },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.test.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...nodeGlobals, ...testGlobals },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["public/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...browserGlobals },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["public/sw.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...serviceWorkerGlobals },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["tests/**/*.js", "__mocks__/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...nodeGlobals, ...browserGlobals, ...testGlobals },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["e2e/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...nodeGlobals, ...browserGlobals, ...testGlobals },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["*.js", "*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...nodeGlobals },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: ["node_modules/", "test-results/", "data/", "public/uploads/", "public/thumbnails/"],
  },
];
