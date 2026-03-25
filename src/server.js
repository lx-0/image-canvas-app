'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configuration with defaults
const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  uploadDir: process.env.UPLOAD_DIR || 'public/uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 10 * 1024 * 1024,
  corsOrigin: process.env.CORS_ORIGIN || '*',
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

// Production security and performance middleware
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());

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

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
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

app.use(express.static(path.join(__dirname, '../public')));
app.use('/thumbnails', express.static(thumbnailsDir));

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

// List uploaded images
app.get('/api/images', (_req, res) => {
  try {
    const files = fs.readdirSync(uploadsDir)
      .filter((f) => /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(f))
      .map((f) => {
        const stat = fs.statSync(path.join(uploadsDir, f));
        const thumbFile = `thumb_${f}`;
        const thumbExists = fs.existsSync(path.join(thumbnailsDir, thumbFile));
        return {
          url: `/uploads/${f}`,
          thumbnailUrl: thumbExists ? `/thumbnails/${thumbFile}` : null,
          name: f,
          size: stat.size,
          createdAt: stat.birthtimeMs || stat.ctimeMs,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ images: files });
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
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (err) {
    logError(req.requestId, 'Delete image error', err);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
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

    // Generate 200px-wide thumbnail
    const thumbFilename = `thumb_${req.file.filename}`;
    const thumbPath = path.join(thumbnailsDir, thumbFilename);
    await sharp(filePath)
      .resize(200, null, { withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toFile(thumbPath);

    res.json({
      url: `/uploads/${req.file.filename}`,
      thumbnailUrl: `/thumbnails/${thumbFilename}`,
    });
  } catch (err) {
    logError(req.requestId, 'Image optimization error', err);
    // Fall back to unoptimized upload if sharp fails (e.g., SVG or unsupported format)
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

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message });
});

// Export app for testing; only listen when run directly
module.exports = app;

if (require.main === module) {
  const server = app.listen(config.port, () => {
    console.log(`Server running at http://localhost:${config.port}`);
  });

  // Graceful shutdown on SIGTERM/SIGINT
  function gracefulShutdown(signal) {
    console.log(`${signal} received, shutting down gracefully...`);
    server.close(() => {
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
