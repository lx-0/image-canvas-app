'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rfs = require('rotating-file-stream');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getDb, closeDb, DATA_DIR } = require('./db');

// Configuration with defaults
const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  uploadDir: process.env.UPLOAD_DIR || 'public/uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 10 * 1024 * 1024,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  adminToken: process.env.ADMIN_TOKEN || '',
  assetPrefix: process.env.ASSET_PREFIX || '',
};

// Structured logging with timestamps
function logError(requestId, message, err) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] [${requestId}] ${message}:`, err && err.message ? err.message : err);
}

function logInfo(requestId, message) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${requestId}] ${message}`);
}

// Generate a short unique request ID
function generateRequestId() {
  return crypto.randomBytes(8).toString('hex');
}

// Classify Gemini API errors into user-friendly messages
function classifyApiError(err) {
  const status = err && err.status;
  const message = err && err.message ? err.message.toLowerCase() : '';
  if (status === 401 || status === 403 || message.includes('api key')) {
    return { status: 502, message: 'AI service authentication error. Please contact the administrator.', retryable: false };
  }
  if (status === 429 || message.includes('resource exhausted') || message.includes('quota')) {
    return { status: 429, message: 'AI service is busy. Please wait a moment and try again.', retryable: true };
  }
  if (status === 408 || (err && err.code === 'ETIMEDOUT') || message.includes('timeout') || message.includes('deadline')) {
    return { status: 504, message: 'AI service timed out. Please try again.', retryable: true };
  }
  if (status >= 500) {
    return { status: 502, message: 'AI service is temporarily unavailable. Please try again shortly.', retryable: true };
  }
  if (err && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ECONNRESET')) {
    return { status: 502, message: 'Unable to reach AI service. Please try again later.', retryable: true };
  }
  return { status: 500, message: 'An unexpected error occurred processing your request.', retryable: false };
}

// Retry wrapper with exponential backoff for Gemini API calls
async function withRetry(fn, requestId, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const classified = classifyApiError(err);
      if (!classified.retryable || attempt === maxAttempts) {
        throw err;
      }
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      logInfo(requestId, `Attempt ${attempt}/${maxAttempts} failed (${err.status || err.code || 'unknown'}), retrying in ${delayMs}ms`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

const app = express();

// SSE: track connected clients for real-time gallery events
const sseClients = new Set();

function broadcastEvent(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

// Request counter for stats
let requestCount = 0;
const serverStartTime = Date.now();

// Production security and performance middleware
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression({
  filter: (req, res) => {
    const type = res.getHeader('Content-Type') || '';
    // Skip compression for already-compressed image formats
    if (/^image\/(jpeg|png|gif|webp|avif)/.test(type)) {
      return false;
    }
    return compression.filter(req, res);
  },
}));

app.use(express.json({ limit: '10mb' }));

const uploadsDir = path.isAbsolute(config.uploadDir)
  ? config.uploadDir
  : path.join(__dirname, '..', config.uploadDir);
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const thumbnailsDir = path.join(uploadsDir, '..', 'thumbnails');
if (!fs.existsSync(thumbnailsDir)) {
  fs.mkdirSync(thumbnailsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const sanitized = sanitizeFilename(file.originalname);
    const ext = path.extname(sanitized);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
  limits: { fileSize: config.maxFileSize },
});

// Initialize Gemini client
let geminiModel = null;
if (config.geminiApiKey) {
  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  geminiModel = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
} else {
  console.warn('GEMINI_API_KEY not set — /api/chat will return 503 until configured');
}

// Test helper: allow injecting a mock Gemini model
app._setGeminiModel = function (model) {
  geminiModel = model;
};

const SYSTEM_PROMPT = `You are an AI image editing assistant. The user has an image displayed on an HTML5 canvas and will ask you to manipulate it.

The user may attach multiple gallery images for reference. When multiple images are provided, the first image is the current canvas image being edited, and any additional images are reference images the user wants you to consider (e.g., for style matching, combining elements, or comparison). Commands you issue always apply to the canvas image (the first one).

You can respond with JSON commands that the frontend will execute on the canvas. When the user asks for an edit, respond with a JSON block wrapped in <commands>...</commands> tags, followed by a brief natural-language explanation.

Available commands (return as a JSON array):
- {"action": "crop", "x": number, "y": number, "width": number, "height": number} — Crop to a region. Values are percentages (0-100) of the image dimensions.
- {"action": "resize", "width": number, "height": number} — Resize the image. Values in pixels.
- {"action": "resize", "scale": number} — Resize by a scale factor (e.g., 0.5 for half size, 2 for double).
- {"action": "rotate", "degrees": number} — Rotate the image (90, 180, 270, or any angle).
- {"action": "addText", "text": string, "x": number, "y": number, "fontSize": number, "color": string, "font": string} — Add text overlay. x/y are percentages (0-100). fontSize in pixels. font defaults to "sans-serif".
- {"action": "flip", "direction": "horizontal" | "vertical"} — Flip the image.
- {"action": "grayscale"} — Convert to grayscale.
- {"action": "brightness", "value": number} — Adjust brightness (-100 to 100).
- {"action": "contrast", "value": number} — Adjust contrast (-100 to 100).
- {"action": "blur", "radius": number} — Apply gaussian blur. Radius controls intensity (1-10, default 3).
- {"action": "sharpen", "amount": number} — Sharpen image with unsharp mask (0.5-3, default 1).
- {"action": "sepia"} — Apply warm vintage sepia tone.
- {"action": "saturation", "value": number} — Adjust color saturation (-100 to 100). Negative desaturates, positive increases vibrancy.
- {"action": "hue-rotate", "degrees": number} — Shift hue of all colors (0-360 degrees).
- {"action": "invert"} — Invert/negate all colors.
- {"action": "vignette", "strength": number} — Darken edges for a vignette effect (0-100, default 50).
- {"action": "shadows-highlights", "shadows": number, "highlights": number} — Adjust shadows and highlights independently (-100 to 100 each).

Example response for "rotate 90 degrees and add hello text":
<commands>[{"action":"rotate","degrees":90},{"action":"addText","text":"Hello","x":50,"y":50,"fontSize":32,"color":"white"}]</commands>
Rotated the image 90° clockwise and added "Hello" text in the center.

If the user asks a general question or something that doesn't require canvas manipulation, just respond normally without commands. Always be concise.`;

// Request ID middleware — attaches a unique ID to every request
app.use((req, res, next) => {
  req.requestId = generateRequestId();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// Request counter middleware
app.use((_req, _res, next) => {
  requestCount++;
  next();
});

// HTTP request logging with morgan (combined format)
const logsDir = path.join(DATA_DIR, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const accessLogStream = rfs.createStream('access.log', {
  interval: '1d',
  path: logsDir,
  maxFiles: 14,
});

morgan.token('request-id', (req) => req.requestId);
app.use(morgan(':request-id :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"', {
  stream: accessLogStream,
}));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Client config endpoint — exposes ASSET_PREFIX for CDN-aware frontends
app.get('/api/config', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ assetPrefix: config.assetPrefix });
});

// Stats endpoint — returns server and image metrics
app.get('/api/stats', (req, res) => {
  try {
    const db = getDb();
    const imageCount = db.prepare('SELECT COUNT(*) AS count FROM images').get().count;
    const totalSize = db.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM images').get().total;
    const conversationCount = db.prepare('SELECT COUNT(*) AS count FROM conversations').get().count;
    const editCount = db.prepare('SELECT COUNT(*) AS count FROM edits').get().count;
    const uptimeMs = Date.now() - serverStartTime;

    res.json({
      totalImages: imageCount,
      totalDiskUsageBytes: totalSize,
      totalConversations: conversationCount,
      totalEdits: editCount,
      requestCount,
      uptimeSeconds: Math.floor(uptimeMs / 1000),
      serverStartedAt: new Date(serverStartTime).toISOString(),
    });
  } catch (err) {
    logError(req.requestId, 'Stats endpoint error', err);
    res.status(500).json({ error: 'Failed to retrieve stats' });
  }
});

// SSE endpoint for real-time gallery updates
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': config.corsOrigin,
  });

  // Send initial keepalive
  res.write(':ok\n\n');

  sseClients.add(res);

  // Keepalive every 30s to prevent proxy/timeout disconnects
  const keepalive = setInterval(() => {
    res.write(':keepalive\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(keepalive);
    sseClients.delete(res);
  });
});

// CORS
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', config.corsOrigin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Rate limiters
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many requests, please try again later' });
  },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many uploads, please try again later' });
  },
});

const errorReportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many error reports' });
  },
});

// Magic byte signatures for common image formats
const IMAGE_SIGNATURES = [
  { ext: 'jpg', bytes: [0xFF, 0xD8, 0xFF] },
  { ext: 'png', bytes: [0x89, 0x50, 0x4E, 0x47] },
  { ext: 'gif', bytes: [0x47, 0x49, 0x46] },
  { ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46], offset4: [0x57, 0x45, 0x42, 0x50] },
  { ext: 'bmp', bytes: [0x42, 0x4D] },
];

function isValidImageByMagicBytes(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);

    for (const sig of IMAGE_SIGNATURES) {
      const match = sig.bytes.every((b, i) => buf[i] === b);
      if (match) {
        if (sig.offset4) {
          const match2 = sig.offset4.every((b, i) => buf[i + 8] === b);
          if (match2) return true;
        } else {
          return true;
        }
      }
    }
    // Allow SVG (starts with < or whitespace then <)
    const str = buf.toString('utf8').trim();
    if (str.startsWith('<')) return true;

    return false;
  } catch {
    return false;
  }
}

function sanitizeFilename(filename) {
  // Strip directory components and path traversal
  const base = path.basename(filename);
  // Remove special characters, keep alphanumeric, dots, hyphens, underscores
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// Static assets: JS/CSS get 1-day cache (no hashed filenames yet),
// HTML gets short cache with revalidation
const publicDir = path.join(__dirname, '../public');

app.use(express.static(publicDir, {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html') {
      // HTML: short cache, always revalidate
      res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
    } else if (ext === '.js' || ext === '.css') {
      // JS/CSS: 1 day cache (increase to immutable once hashed filenames are added)
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else if (ext === '.json' || ext === '.webmanifest') {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    } else {
      // Other static assets (icons, fonts): 1 week
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  },
}));

// Service worker: must always revalidate
app.get('/sw.js', (_req, res, next) => {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  next();
});

// Uploaded images: 7-day cache with ETags for revalidation
app.use('/uploads', express.static(uploadsDir, {
  etag: true,
  lastModified: true,
  maxAge: '7d',
  immutable: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=604800');
  },
}));

// Thumbnails: 7-day cache with ETags
app.use('/thumbnails', express.static(thumbnailsDir, {
  etag: true,
  lastModified: true,
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=604800');
  },
}));

// Resize a base64 image to fit within Gemini API limits
async function resizeForApi(base64Data, mediaType) {
  const inputBuffer = Buffer.from(base64Data, 'base64');
  const metadata = await sharp(inputBuffer).metadata();
  const longest = Math.max(metadata.width || 0, metadata.height || 0);

  if (longest <= 3072) {
    return { data: base64Data, mimeType: mediaType };
  }

  const resized = await sharp(inputBuffer)
    .resize({ width: 3072, height: 3072, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { data: resized.toString('base64'), mimeType: 'image/jpeg' };
}

// Load a gallery image from disk for the Gemini API
async function loadGalleryImageForApi(imgUrl) {
  // imgUrl is like "/uploads/1711382400000-542311.jpg"
  if (typeof imgUrl !== 'string' || !imgUrl.startsWith('/uploads/')) return null;
  const filename = path.basename(imgUrl);
  // Sanitize: no path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return null;
  const filePath = path.join(uploadsDir, filename);
  try {
    if (!fs.existsSync(filePath)) return null;
    const buffer = await sharp(filePath)
      .resize({ width: 3072, height: 3072, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { data: buffer.toString('base64'), mimeType: 'image/jpeg' };
  } catch (_e) {
    return null;
  }
}

// Convert chat messages to Gemini format
function buildGeminiContents(messages, imageParts) {
  const contents = [];
  for (const msg of messages) {
    const parts = [];

    // Add image parts to user messages if provided
    if (msg.role === 'user' && imageParts && msg === messages[messages.length - 1]) {
      for (const img of imageParts) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }
    }

    parts.push({ text: msg.content });
    contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
  }
  return contents;
}

// List uploaded images from database (with filesystem fallback for legacy files)
app.get('/api/images', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, filename, original_name, size, width, height, created_at, thumbnail_path
       FROM images ORDER BY created_at DESC`
    ).all();

    // Also scan filesystem for files not yet in the DB (legacy migration)
    const dbFilenames = new Set(rows.map(r => r.filename));
    const fsFiles = fs.readdirSync(uploadsDir)
      .filter((f) => /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(f) && !dbFilenames.has(f));

    // Insert any legacy files into DB
    if (fsFiles.length > 0) {
      const insert = db.prepare(
        `INSERT OR IGNORE INTO images (filename, original_name, size, thumbnail_path)
         VALUES (?, ?, ?, ?)`
      );
      const insertMany = db.transaction((files) => {
        for (const f of files) {
          const stat = fs.statSync(path.join(uploadsDir, f));
          const thumbFile = `thumb_${f}`;
          const thumbExists = fs.existsSync(path.join(thumbnailsDir, thumbFile));
          insert.run(f, f, stat.size, thumbExists ? `/thumbnails/${thumbFile}` : null);
        }
      });
      insertMany(fsFiles);

      // Re-query after migration
      const allRows = db.prepare(
        `SELECT id, filename, original_name, size, width, height, created_at, thumbnail_path
         FROM images ORDER BY created_at DESC`
      ).all();

      const images = allRows.map(r => ({
        url: `/uploads/${r.filename}`,
        thumbnailUrl: r.thumbnail_path || null,
        name: r.filename,
        originalName: r.original_name,
        size: r.size,
        width: r.width,
        height: r.height,
        createdAt: r.created_at,
      }));
      return res.json({ images });
    }

    const images = rows.map(r => ({
      url: `/uploads/${r.filename}`,
      thumbnailUrl: r.thumbnail_path || null,
      name: r.filename,
      originalName: r.original_name,
      size: r.size,
      width: r.width,
      height: r.height,
      createdAt: r.created_at,
    }));
    res.json({ images });
  } catch (err) {
    logError(req.requestId, 'List images error', err);
    res.json({ images: [] });
  }
});

// Delete an uploaded image
app.delete('/api/images/:filename', (req, res) => {
  const filename = req.params.filename;
  // Prevent path traversal
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(uploadsDir, filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      // Also delete thumbnail if it exists
      const thumbPath = path.join(thumbnailsDir, `thumb_${filename}`);
      try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch { /* ignore */ }
    } else {
      return res.status(404).json({ error: 'File not found' });
    }

    // Remove from database (cascades to conversations and edits)
    try {
      const db = getDb();
      db.prepare('DELETE FROM images WHERE filename = ?').run(filename);
    } catch (_dbErr) {
      logError(req.requestId, 'DB delete error', _dbErr);
    }

    broadcastEvent('image:deleted', { url: `/uploads/${filename}` });

    res.json({ success: true });
  } catch (err) {
    logError(req.requestId, 'Delete image error', err);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Admin page — protected by ADMIN_TOKEN query parameter
app.get('/admin', (req, res) => {
  if (!config.adminToken) {
    return res.status(403).json({ error: 'Admin access is not configured. Set the ADMIN_TOKEN environment variable.' });
  }
  if (req.query.token !== config.adminToken) {
    return res.status(401).json({ error: 'Invalid or missing admin token.' });
  }
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Client-side error reporting endpoint
app.post('/api/errors', errorReportLimiter, express.json({ limit: '4kb' }), (req, res) => {
  const requestId = req.requestId || generateRequestId();
  const { message, source, lineno, colno, stack, type } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Missing error message' });
  }
  const safeMessage = message.slice(0, 500);
  const safeSource = typeof source === 'string' ? source.slice(0, 200) : '';
  const safeStack = typeof stack === 'string' ? stack.slice(0, 1000) : '';
  logError(requestId, `[CLIENT ${type || 'error'}] ${safeMessage}`, {
    message: safeMessage,
    source: safeSource,
    lineno,
    colno,
    stack: safeStack,
  });
  res.status(204).end();
});

app.post('/upload', uploadLimiter, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = path.join(uploadsDir, req.file.filename);

  // Validate magic bytes
  if (!isValidImageByMagicBytes(filePath)) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    return res.status(400).json({ error: 'File content does not match a valid image format' });
  }

  try {
    // Optimize the uploaded image: auto-compress while preserving quality and EXIF orientation
    const optimizedPath = filePath + '.opt';
    await sharp(filePath)
      .rotate() // auto-rotate based on EXIF orientation
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(optimizedPath);

    // Replace original with optimized version
    fs.renameSync(optimizedPath, filePath);

    // Get image metadata for DB
    const metadata = await sharp(filePath).metadata();
    const stat = fs.statSync(filePath);

    // Generate 200px-wide thumbnail
    const thumbFilename = `thumb_${req.file.filename}`;
    const thumbPath = path.join(thumbnailsDir, thumbFilename);
    await sharp(filePath)
      .resize(200, null, { withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toFile(thumbPath);

    // Insert into database
    const db = getDb();
    db.prepare(
      `INSERT INTO images (filename, original_name, size, width, height, thumbnail_path)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      req.file.filename,
      req.file.originalname,
      stat.size,
      metadata.width || null,
      metadata.height || null,
      `/thumbnails/${thumbFilename}`
    );

    const uploadResult = {
      url: `/uploads/${req.file.filename}`,
      thumbnailUrl: `/thumbnails/${thumbFilename}`,
    };

    broadcastEvent('image:uploaded', {
      url: uploadResult.url,
      thumbnailUrl: uploadResult.thumbnailUrl,
      name: req.file.filename,
    });

    res.json(uploadResult);
  } catch (err) {
    logError(req.requestId, 'Image optimization error', err);
    // Fall back to unoptimized upload if sharp fails (e.g., SVG or unsupported format)
    // Still insert into DB with minimal info
    try {
      const stat = fs.statSync(filePath);
      const db = getDb();
      db.prepare(
        `INSERT INTO images (filename, original_name, size) VALUES (?, ?, ?)`
      ).run(req.file.filename, req.file.originalname, stat.size);
    } catch (_dbErr) {
      logError(req.requestId, 'DB insert fallback error', _dbErr);
    }

    broadcastEvent('image:uploaded', {
      url: `/uploads/${req.file.filename}`,
      thumbnailUrl: null,
      name: req.file.filename,
    });

    res.json({ url: `/uploads/${req.file.filename}` });
  }
});

app.post('/api/chat', apiLimiter, async (req, res) => {
  const requestId = req.requestId;

  if (!geminiModel) {
    return res.status(503).json({ error: 'AI assistant is not configured. Image uploads still work normally.', requestId });
  }

  const { messages, imageData, additionalImages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required', requestId });
  }

  try {
    // Prepare image parts if provided
    const imageParts = [];
    if (imageData) {
      const match = imageData.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        const optimized = await resizeForApi(match[2], match[1]);
        imageParts.push(optimized);
      }
    }

    // Load additional gallery images from disk
    if (Array.isArray(additionalImages)) {
      for (const imgUrl of additionalImages.slice(0, 5)) {
        const imgPart = await loadGalleryImageForApi(imgUrl);
        if (imgPart) imageParts.push(imgPart);
      }
    }

    const contents = buildGeminiContents(messages, imageParts.length > 0 ? imageParts : null);

    const response = await withRetry(() => geminiModel.generateContent({
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { maxOutputTokens: 1024 },
    }), requestId);

    const text = response.response.text();

    // Extract commands if present
    let commands = null;
    const cmdMatch = text.match(/<commands>([\s\S]*?)<\/commands>/);
    if (cmdMatch) {
      try {
        commands = JSON.parse(cmdMatch[1]);
      } catch (_e) {
        // If command parsing fails, just return text
      }
    }

    const displayText = text.replace(/<commands>[\s\S]*?<\/commands>\s*/g, '').trim();

    res.json({ response: displayText, commands, requestId });
  } catch (err) {
    const classified = classifyApiError(err);
    logError(requestId, 'Chat API error', err);
    res.status(classified.status).json({ error: classified.message, retryable: classified.retryable, requestId });
  }
});

app.post('/api/chat/stream', apiLimiter, async (req, res) => {
  const requestId = req.requestId;

  if (!geminiModel) {
    return res.status(503).json({ error: 'AI assistant is not configured. Image uploads still work normally.', requestId });
  }

  const { messages, imageData, additionalImages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required', requestId });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Request-Id': requestId,
  });

  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  function sendEvent(event, data) {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    // Prepare image parts if provided
    const imageParts = [];
    if (imageData) {
      const match = imageData.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        const optimized = await resizeForApi(match[2], match[1]);
        imageParts.push(optimized);
      }
    }

    // Load additional gallery images from disk
    if (Array.isArray(additionalImages)) {
      for (const imgUrl of additionalImages.slice(0, 5)) {
        const imgPart = await loadGalleryImageForApi(imgUrl);
        if (imgPart) imageParts.push(imgPart);
      }
    }

    const contents = buildGeminiContents(messages, imageParts.length > 0 ? imageParts : null);

    // Retry logic: for streams, retry the initial connection (not mid-stream)
    const streamResult = await withRetry(() => geminiModel.generateContentStream({
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: { maxOutputTokens: 1024 },
    }), requestId);

    let fullText = '';

    for await (const chunk of streamResult.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        fullText += chunkText;
        sendEvent('delta', { text: chunkText });
      }
    }

    // Extract commands from the full response
    let commands = null;
    const cmdMatch = fullText.match(/<commands>([\s\S]*?)<\/commands>/);
    if (cmdMatch) {
      try {
        commands = JSON.parse(cmdMatch[1]);
      } catch (_e) {
        // If command parsing fails, skip
      }
    }

    const displayText = fullText.replace(/<commands>[\s\S]*?<\/commands>\s*/g, '').trim();
    sendEvent('done', { response: displayText, commands, requestId });
    res.end();
  } catch (err) {
    const classified = classifyApiError(err);
    logError(requestId, 'Chat stream error', err);
    sendEvent('error', { error: classified.message, retryable: classified.retryable, requestId });
    res.end();
  }
});

const ANALYZE_SYSTEM_PROMPT = `You are an expert image analyst. Analyze the provided image and return a structured JSON analysis wrapped in <analysis>...</analysis> tags.

Your JSON response MUST include these fields:
- dominantColors: array of up to 5 objects, each with "hex" (string, e.g. "#3A7BD5"), "name" (human-readable color name, e.g. "Steel Blue"), and "percentage" (estimated percentage of the image this color occupies, number 0-100)
- objects: array of strings listing detected objects, people, animals, or notable elements in the image
- composition: object with "rule" (e.g. "rule of thirds", "centered", "symmetrical", "diagonal"), "balance" (e.g. "balanced", "left-heavy", "top-heavy"), and "notes" (brief composition observations)
- mood: string describing the overall mood or atmosphere (e.g. "warm and inviting", "dramatic and moody")
- suggestedEdits: array of objects, each with "action" (a specific edit action like "brightness", "contrast", "crop", "saturation"), "description" (what the edit would improve), and "parameters" (object with suggested parameter values matching the canvas command format)

Example response:
<analysis>{"dominantColors":[{"hex":"#2C5F8A","name":"Ocean Blue","percentage":35},{"hex":"#F5E6CC","name":"Warm Sand","percentage":25}],"objects":["beach","ocean waves","palm tree","sunset sky"],"composition":{"rule":"rule of thirds","balance":"balanced","notes":"Horizon sits on upper third line, palm tree anchors left third"},"mood":"peaceful and warm","suggestedEdits":[{"action":"contrast","description":"Boost contrast to make the sunset colors pop","parameters":{"value":20}},{"action":"saturation","description":"Increase color vibrancy slightly","parameters":{"value":15}}]}</analysis>

Always respond with the analysis JSON block only. Be precise with hex color values. Keep object lists concise but thorough. Suggested edits should be practical improvements, not drastic changes.`;

app.post('/api/analyze', apiLimiter, async (req, res) => {
  const requestId = req.requestId;

  if (!geminiModel) {
    return res.status(503).json({ error: 'AI assistant is not configured.', requestId });
  }

  const { imageData } = req.body;

  if (!imageData) {
    return res.status(400).json({ error: 'imageData is required', requestId });
  }

  try {
    const match = imageData.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid image data URL', requestId });
    }

    const optimized = await resizeForApi(match[2], match[1]);

    const response = await withRetry(() => geminiModel.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: optimized.mimeType, data: optimized.data } },
            { text: 'Analyze this image in detail.' },
          ],
        },
      ],
      systemInstruction: { parts: [{ text: ANALYZE_SYSTEM_PROMPT }] },
      generationConfig: { maxOutputTokens: 2048 },
    }), requestId);

    const text = response.response.text();

    let analysis = null;
    const analysisMatch = text.match(/<analysis>([\s\S]*?)<\/analysis>/);
    if (analysisMatch) {
      try {
        analysis = JSON.parse(analysisMatch[1]);
      } catch (_e) {
        // If parsing fails, return raw text
      }
    }

    if (!analysis) {
      return res.status(502).json({ error: 'Failed to parse image analysis', requestId });
    }

    res.json({ analysis, requestId });
  } catch (err) {
    const classified = classifyApiError(err);
    logError(requestId, 'Analyze API error', err);
    res.status(classified.status).json({ error: classified.message, retryable: classified.retryable, requestId });
  }
});

app.post('/api/composite', apiLimiter, async (req, res) => {
  const requestId = req.requestId;

  if (!geminiModel) {
    return res.status(503).json({ error: 'AI assistant is not configured. Image uploads still work normally.', requestId });
  }

  const { baseImage, droppedImage, instructions } = req.body;

  if (!baseImage || !droppedImage) {
    return res.status(400).json({ error: 'baseImage and droppedImage are required', requestId });
  }

  function parseDataURL(dataUrl) {
    const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return null;
    return { mimeType: match[1], data: match[2] };
  }

  const base = parseDataURL(baseImage);
  const dropped = parseDataURL(droppedImage);

  if (!base || !dropped) {
    return res.status(400).json({ error: 'Invalid image data URLs' });
  }

  const userPrompt = instructions
    ? `The user wants to composite the second image onto the first with these instructions: "${instructions}"`
    : 'Composite the second image onto the first. Identify the main subject/object in the second image and place it naturally on the base image.';

  const compositeSystemPrompt = `You are an image compositing assistant. You receive two images:
1. The BASE image (first image) - the background/canvas
2. The DROPPED image (second image) - contains a subject to composite onto the base

Analyze both images and determine the best placement for the main subject of the dropped image onto the base image.

Respond with a JSON block wrapped in <composite>...</composite> tags, followed by a brief explanation.

The JSON must have these fields:
- x: horizontal position as percentage (0-100) of the base image where the CENTER of the dropped content should go
- y: vertical position as percentage (0-100) of the base image where the CENTER of the dropped content should go
- scale: scale factor for the dropped image relative to the base image (e.g., 0.3 means 30% of the base image width)
- description: brief description of what you identified and where you placed it

Example:
<composite>{"x": 65, "y": 40, "scale": 0.25, "description": "Placed the cat on the right side of the couch"}</composite>
I identified a cat in the dropped image and placed it on the couch in the base image, scaled to look natural.`;

  try {
    // Resize both images for the API
    const optimizedBase = await resizeForApi(base.data, base.mimeType);
    const optimizedDropped = await resizeForApi(dropped.data, dropped.mimeType);

    const response = await withRetry(() => geminiModel.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: optimizedBase.mimeType, data: optimizedBase.data } },
            { inlineData: { mimeType: optimizedDropped.mimeType, data: optimizedDropped.data } },
            { text: userPrompt },
          ],
        },
      ],
      systemInstruction: { parts: [{ text: compositeSystemPrompt }] },
      generationConfig: { maxOutputTokens: 1024 },
    }), requestId);

    const text = response.response.text();

    let compositeData = null;
    const cmdMatch = text.match(/<composite>([\s\S]*?)<\/composite>/);
    if (cmdMatch) {
      try {
        compositeData = JSON.parse(cmdMatch[1]);
      } catch (_e) {
        // parsing failed
      }
    }

    const displayText = text.replace(/<composite>[\s\S]*?<\/composite>\s*/g, '').trim();

    res.json({ response: displayText, composite: compositeData, requestId });
  } catch (err) {
    const classified = classifyApiError(err);
    logError(requestId, 'Composite API error', err);
    res.status(classified.status).json({ error: classified.message, retryable: classified.retryable, requestId });
  }
});

// ── Server-side image processing ──────────────────────────────────────
// POST /api/process
// Accepts an image + a list of operations (same command format the AI returns)
// and executes them server-side using Sharp for higher quality results.
//
// Body (JSON): { image: "<base64 data-URL or raw base64>", operations: [...] }
//   OR multipart: field "image" (file) + field "operations" (JSON string)
//
// Response: { image: "data:image/png;base64,..." } or saves to disk when
//           "save" field is truthy (returns { filename, path }).

const processUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
  limits: { fileSize: config.maxFileSize },
});

app.post('/api/process', processUpload.single('image'), async (req, res) => {
  const requestId = req.requestId;
  try {
    // ── Parse input image ───────────────────────────────────────────
    let imageBuffer;
    if (req.file) {
      imageBuffer = req.file.buffer;
    } else if (req.body && req.body.image) {
      const raw = req.body.image.replace(/^data:image\/\w+;base64,/, '');
      imageBuffer = Buffer.from(raw, 'base64');
    } else {
      return res.status(400).json({ error: 'No image provided. Send as base64 in "image" field or as multipart file.', requestId });
    }

    // ── Parse operations ────────────────────────────────────────────
    let operations;
    if (typeof req.body.operations === 'string') {
      operations = JSON.parse(req.body.operations);
    } else if (Array.isArray(req.body.operations)) {
      operations = req.body.operations;
    } else {
      return res.status(400).json({ error: '"operations" must be a JSON array of commands.', requestId });
    }

    if (!Array.isArray(operations) || operations.length === 0) {
      return res.status(400).json({ error: '"operations" must be a non-empty array.', requestId });
    }

    // Validate all operations have an action
    for (const op of operations) {
      if (!op || !op.action) {
        return res.status(400).json({ error: 'Each operation must have an "action" field.', requestId });
      }
    }

    // ── Process pipeline ────────────────────────────────────────────
    let pipeline = sharp(imageBuffer);
    const metadata = await sharp(imageBuffer).metadata();
    let currentWidth = metadata.width;
    let currentHeight = metadata.height;

    for (const op of operations) {
      switch (op.action) {
        case 'rotate':
          pipeline = pipeline.rotate(op.degrees || 0);
          if (op.degrees === 90 || op.degrees === 270 || op.degrees === -90 || op.degrees === -270) {
            [currentWidth, currentHeight] = [currentHeight, currentWidth];
          }
          break;

        case 'resize':
          if (op.scale) {
            const newW = Math.round(currentWidth * op.scale);
            const newH = Math.round(currentHeight * op.scale);
            pipeline = pipeline.resize(newW, newH, { kernel: sharp.kernel.lanczos3 });
            currentWidth = newW;
            currentHeight = newH;
          } else if (op.width && op.height) {
            pipeline = pipeline.resize(op.width, op.height, { kernel: sharp.kernel.lanczos3, fit: 'fill' });
            currentWidth = op.width;
            currentHeight = op.height;
          }
          break;

        case 'crop': {
          const left = Math.round((op.x / 100) * currentWidth);
          const top = Math.round((op.y / 100) * currentHeight);
          const width = Math.round((op.width / 100) * currentWidth);
          const height = Math.round((op.height / 100) * currentHeight);
          pipeline = pipeline.extract({ left, top, width, height });
          currentWidth = width;
          currentHeight = height;
          break;
        }

        case 'flip':
          if (op.direction === 'vertical') {
            pipeline = pipeline.flip();
          } else {
            pipeline = pipeline.flop();
          }
          break;

        case 'grayscale':
          pipeline = pipeline.grayscale();
          break;

        case 'blur': {
          const sigma = Math.max(0.3, (op.radius || 3) * 0.5);
          pipeline = pipeline.blur(sigma);
          break;
        }

        case 'sharpen': {
          const amount = op.amount || 1;
          pipeline = pipeline.sharpen({ sigma: 1, m1: amount, m2: amount * 0.5 });
          break;
        }

        case 'brightness': {
          // Sharp modulate uses a multiplier (1.0 = unchanged)
          const bFactor = 1 + (op.value || 0) / 100;
          pipeline = pipeline.modulate({ brightness: Math.max(0, bFactor) });
          break;
        }

        case 'contrast': {
          // Sharp linear: output = input * a + b
          // Map -100..100 to multiplier range ~0.5..1.5
          const cVal = (op.value || 0) / 100;
          const a = 1 + cVal;
          const b = -128 * cVal;
          pipeline = pipeline.linear(a, b);
          break;
        }

        case 'saturation': {
          // Sharp modulate saturation multiplier (1.0 = unchanged)
          const sFactor = 1 + (op.value || 0) / 100;
          pipeline = pipeline.modulate({ saturation: Math.max(0, sFactor) });
          break;
        }

        case 'hue-rotate': {
          // Sharp modulate hue takes degrees
          pipeline = pipeline.modulate({ hue: op.degrees || 0 });
          break;
        }

        case 'invert':
          pipeline = pipeline.negate({ alpha: false });
          break;

        case 'sepia':
          // Approximate sepia via tint after desaturation
          pipeline = pipeline.modulate({ saturation: 0.3 }).tint({ r: 112, g: 66, b: 20 });
          break;

        case 'vignette':
        case 'shadows-highlights':
        case 'addText':
          // These require pixel-level or compositing ops beyond Sharp's pipeline.
          // We skip them server-side with a note in the response.
          logInfo(requestId, `Skipping "${op.action}" — not supported in server-side processing`);
          break;

        default:
          logInfo(requestId, `Unknown action "${op.action}" — skipping`);
          break;
      }
    }

    // ── Output ──────────────────────────────────────────────────────
    const outputBuffer = await pipeline.png().toBuffer();

    if (req.body.save) {
      const filename = `processed-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`;
      const outputPath = path.join(uploadsDir, filename);
      fs.writeFileSync(outputPath, outputBuffer);
      logInfo(requestId, `Processed image saved as ${filename}`);
      return res.json({ filename, path: `/uploads/${filename}`, requestId });
    }

    const dataUrl = `data:image/png;base64,${outputBuffer.toString('base64')}`;
    logInfo(requestId, `Processed image (${operations.length} operations, ${outputBuffer.length} bytes)`);
    res.json({ image: dataUrl, requestId });
  } catch (err) {
    logError(requestId, 'Image processing error', err);
    res.status(500).json({ error: `Processing failed: ${err.message}`, requestId });
  }
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message });
});

// Export app for testing; only listen when run directly
module.exports = app;

// Test helpers: expose internal functions for unit testing
app._classifyApiError = classifyApiError;
app._sanitizeFilename = sanitizeFilename;
app._isValidImageByMagicBytes = isValidImageByMagicBytes;
app._resizeForApi = resizeForApi;
app._resetRateLimiters = async function () {
  await apiLimiter.resetKey('::ffff:127.0.0.1');
  await apiLimiter.resetKey('127.0.0.1');
  await uploadLimiter.resetKey('::ffff:127.0.0.1');
  await uploadLimiter.resetKey('127.0.0.1');
};

if (require.main === module) {
  const server = app.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
  });

  // Graceful shutdown on SIGTERM/SIGINT
  function gracefulShutdown(signal) {
    console.log(`${signal} received, shutting down gracefully...`);
    server.close(() => {
      closeDb();
      console.log('HTTP server closed');
      process.exit(0);
    });
    // Force exit after 10 seconds if connections don't drain
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
