'use strict';

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// Ensure the server doesn't use a real API key on load
delete process.env.GEMINI_API_KEY;

// Use a temporary DB path for tests
const testDbDir = path.join(__dirname, '..', '__test_data__');
if (!fs.existsSync(testDbDir)) fs.mkdirSync(testDbDir, { recursive: true });
process.env.DB_PATH = path.join(testDbDir, 'test.db');

const app = require('./server');
const { closeDb } = require('./db');

// Inject a mock Gemini model for chat/composite tests
const mockGeminiModel = {
  generateContent: async () => ({
    response: {
      text: () => '<commands>[{"action":"grayscale"}]</commands>\nConverted to grayscale.',
    },
  }),
  generateContentStream: async () => ({
    stream: (async function* () {
      yield { text: () => 'Hello from stream' };
    })(),
  }),
};

// Create a minimal valid PNG in a temp dir for upload tests
let testImagePath;
const testDir = path.join(__dirname, '..', '__test_fixtures__');

beforeAll(async () => {
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  testImagePath = path.join(testDir, 'test.png');
  await sharp({
    create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toFile(testImagePath);
});

afterAll(() => {
  closeDb();
  try {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testDbDir)) {
      fs.rmSync(testDbDir, { recursive: true, force: true });
    }
  } catch {
    // ignore cleanup errors
  }
});

describe('Health check', () => {
  it('GET /health returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('Upload endpoint', () => {
  it('POST /upload with a valid image returns url', async () => {
    const res = await request(app)
      .post('/upload')
      .attach('file', testImagePath);
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/uploads\//);
  });

  it('POST /upload with no file returns 400', async () => {
    const res = await request(app).post('/upload');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('POST /upload with non-image file returns 400', async () => {
    const textFile = path.join(testDir, 'notimage.txt');
    fs.writeFileSync(textFile, 'this is not an image');
    const res = await request(app)
      .post('/upload')
      .attach('file', textFile);
    expect(res.status).toBe(400);
  });

  it('POST /upload with oversized file returns 400', async () => {
    // Create a file that exceeds the default 10MB limit
    const bigFile = path.join(testDir, 'oversized.png');
    // Write a valid PNG header followed by enough padding to exceed limit
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const padding = Buffer.alloc(11 * 1024 * 1024); // 11MB
    fs.writeFileSync(bigFile, Buffer.concat([pngHeader, padding]));
    const res = await request(app)
      .post('/upload')
      .attach('file', bigFile);
    expect(res.status).toBe(400);
  });
});

describe('Chat endpoint', () => {
  it('POST /api/chat returns 503 when no API key configured', async () => {
    // With no API key, gemini model is null
    app._setGeminiModel(null);
    const res = await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'user', content: 'hello' }] });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('POST /api/chat with mock client returns response and commands', async () => {
    app._setGeminiModel(mockGeminiModel);
    const res = await request(app)
      .post('/api/chat')
      .send({
        messages: [{ role: 'user', content: 'Make it grayscale' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.response).toBe('Converted to grayscale.');
    expect(res.body.commands).toEqual([{ action: 'grayscale' }]);
    expect(res.body.requestId).toBeDefined();
  });

  it('POST /api/chat with empty messages returns 400', async () => {
    app._setGeminiModel(mockGeminiModel);
    const res = await request(app)
      .post('/api/chat')
      .send({ messages: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/messages/i);
  });

  it('POST /api/chat with no messages field returns 400', async () => {
    app._setGeminiModel(mockGeminiModel);
    const res = await request(app)
      .post('/api/chat')
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('Composite endpoint', () => {
  it('POST /api/composite without images returns 400', async () => {
    app._setGeminiModel(mockGeminiModel);
    const res = await request(app)
      .post('/api/composite')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/baseImage|droppedImage/i);
  });
});

describe('Image list endpoint', () => {
  it('GET /api/images returns images array', async () => {
    const res = await request(app).get('/api/images');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.images)).toBe(true);
  });
});

describe('Process endpoint', () => {
  let testBase64;

  beforeAll(async () => {
    const buf = await sharp({
      create: { width: 100, height: 80, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).png().toBuffer();
    testBase64 = `data:image/png;base64,${buf.toString('base64')}`;
  });

  it('POST /api/process with base64 image + rotate returns data URL', async () => {
    const res = await request(app)
      .post('/api/process')
      .send({ image: testBase64, operations: [{ action: 'rotate', degrees: 90 }] });
    expect(res.status).toBe(200);
    expect(res.body.image).toMatch(/^data:image\/png;base64,/);
    // After 90° rotation, width/height should swap (100x80 → 80x100)
    const outBuf = Buffer.from(res.body.image.replace(/^data:image\/png;base64,/, ''), 'base64');
    const meta = await sharp(outBuf).metadata();
    expect(meta.width).toBe(80);
    expect(meta.height).toBe(100);
  });

  it('POST /api/process with resize returns smaller image', async () => {
    const res = await request(app)
      .post('/api/process')
      .send({ image: testBase64, operations: [{ action: 'resize', scale: 0.5 }] });
    expect(res.status).toBe(200);
    const outBuf = Buffer.from(res.body.image.replace(/^data:image\/png;base64,/, ''), 'base64');
    const meta = await sharp(outBuf).metadata();
    expect(meta.width).toBe(50);
    expect(meta.height).toBe(40);
  });

  it('POST /api/process with crop returns cropped region', async () => {
    const res = await request(app)
      .post('/api/process')
      .send({ image: testBase64, operations: [{ action: 'crop', x: 0, y: 0, width: 50, height: 50 }] });
    expect(res.status).toBe(200);
    const outBuf = Buffer.from(res.body.image.replace(/^data:image\/png;base64,/, ''), 'base64');
    const meta = await sharp(outBuf).metadata();
    expect(meta.width).toBe(50);
    expect(meta.height).toBe(40);
  });

  it('POST /api/process with grayscale returns image', async () => {
    const res = await request(app)
      .post('/api/process')
      .send({ image: testBase64, operations: [{ action: 'grayscale' }] });
    expect(res.status).toBe(200);
    expect(res.body.image).toMatch(/^data:image\/png;base64,/);
  });

  it('POST /api/process with multiple operations chains correctly', async () => {
    const res = await request(app)
      .post('/api/process')
      .send({
        image: testBase64,
        operations: [
          { action: 'grayscale' },
          { action: 'resize', width: 20, height: 20 },
          { action: 'flip', direction: 'horizontal' },
        ],
      });
    expect(res.status).toBe(200);
    const outBuf = Buffer.from(res.body.image.replace(/^data:image\/png;base64,/, ''), 'base64');
    const meta = await sharp(outBuf).metadata();
    expect(meta.width).toBe(20);
    expect(meta.height).toBe(20);
  });

  it('POST /api/process with multipart file upload works', async () => {
    const res = await request(app)
      .post('/api/process')
      .attach('image', testImagePath)
      .field('operations', JSON.stringify([{ action: 'blur', radius: 2 }]));
    expect(res.status).toBe(200);
    expect(res.body.image).toMatch(/^data:image\/png;base64,/);
  });

  it('POST /api/process with no image returns 400', async () => {
    const res = await request(app)
      .post('/api/process')
      .send({ operations: [{ action: 'grayscale' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no image/i);
  });

  it('POST /api/process with no operations returns 400', async () => {
    const res = await request(app)
      .post('/api/process')
      .send({ image: testBase64 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/operations/i);
  });

  it('POST /api/process with empty operations returns 400', async () => {
    const res = await request(app)
      .post('/api/process')
      .send({ image: testBase64, operations: [] });
    expect(res.status).toBe(400);
  });

  it('POST /api/process with save=true writes to disk', async () => {
    const res = await request(app)
      .post('/api/process')
      .send({ image: testBase64, operations: [{ action: 'invert' }], save: true });
    expect(res.status).toBe(200);
    expect(res.body.filename).toMatch(/^processed-/);
    expect(res.body.path).toMatch(/^\/uploads\//);
  });

  it('POST /api/process skips unsupported actions gracefully', async () => {
    const res = await request(app)
      .post('/api/process')
      .send({ image: testBase64, operations: [{ action: 'vignette', strength: 50 }, { action: 'grayscale' }] });
    expect(res.status).toBe(200);
    expect(res.body.image).toMatch(/^data:image\/png;base64,/);
  });
});

describe('Static files', () => {
  it('GET / returns HTML', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});

// ── New test suites for expanded coverage ──────────────────────────────

describe('Image deletion endpoint', () => {
  let uploadedFilename;

  beforeAll(async () => {
    // Upload an image so we have something to delete
    const res = await request(app).post('/upload').attach('file', testImagePath);
    // Extract filename from returned URL (e.g. "/uploads/1711382400000-542311.png")
    uploadedFilename = path.basename(res.body.url);
  });

  it('DELETE /api/images/:filename removes the file and returns success', async () => {
    const res = await request(app).delete(`/api/images/${uploadedFilename}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /api/images/:filename returns 404 for non-existent file', async () => {
    const res = await request(app).delete('/api/images/nonexistent-12345.png');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('DELETE /api/images/:filename rejects path traversal with ..', async () => {
    const res = await request(app).delete('/api/images/..%2Fserver.js');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('DELETE /api/images/:filename rejects path traversal with slashes', async () => {
    const res = await request(app).delete('/api/images/sub%2Ffile.png');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('DELETE /api/images/:filename rejects backslash traversal', async () => {
    const res = await request(app).delete('/api/images/..%5Cserver.js');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });
});

describe('Composite endpoint (with mock)', () => {
  let smallBase64;

  beforeAll(async () => {
    app._setGeminiModel({
      generateContent: async () => ({
        response: {
          text: () =>
            '<composite>{"x": 50, "y": 50, "scale": 0.3, "description": "Placed on center"}</composite>\nPlaced the object in the center.',
        },
      }),
    });
    const buf = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 255, b: 0 } },
    }).png().toBuffer();
    smallBase64 = `data:image/png;base64,${buf.toString('base64')}`;
  });

  it('returns composite data with valid placement coordinates', async () => {
    const res = await request(app)
      .post('/api/composite')
      .send({ baseImage: smallBase64, droppedImage: smallBase64 });
    expect(res.status).toBe(200);
    expect(res.body.composite).toEqual({
      x: 50,
      y: 50,
      scale: 0.3,
      description: 'Placed on center',
    });
    expect(res.body.response).toBe('Placed the object in the center.');
    expect(res.body.requestId).toBeDefined();
  });

  it('returns 503 when no AI model configured', async () => {
    app._setGeminiModel(null);
    const res = await request(app)
      .post('/api/composite')
      .send({ baseImage: smallBase64, droppedImage: smallBase64 });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('returns 400 for invalid data URLs', async () => {
    app._setGeminiModel(mockGeminiModel);
    const res = await request(app)
      .post('/api/composite')
      .send({ baseImage: 'not-a-data-url', droppedImage: 'also-bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it('handles API errors with classified status', async () => {
    app._setGeminiModel({
      generateContent: async () => {
        const err = new Error('quota exceeded');
        err.status = 429;
        throw err;
      },
    });
    const res = await request(app)
      .post('/api/composite')
      .send({ baseImage: smallBase64, droppedImage: smallBase64 });
    expect(res.status).toBe(429);
    expect(res.body.retryable).toBe(true);
  });
});

describe('Streaming chat SSE', () => {
  beforeAll(async () => {
    await app._resetRateLimiters();
  });

  it('POST /api/chat/stream returns SSE events with delta and done', async () => {
    app._setGeminiModel({
      generateContentStream: async () => ({
        stream: (async function* () {
          yield { text: () => 'chunk1' };
          yield { text: () => 'chunk2' };
        })(),
      }),
    });

    const res = await request(app)
      .post('/api/chat/stream')

      .send({ messages: [{ role: 'user', content: 'hello' }] })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk.toString(); });
        res.on('end', () => cb(null, data));
      });

    expect(res.status).toBe(200);
    const body = res.body;
    // Verify SSE format: should contain delta events and a done event
    expect(body).toContain('event: delta');
    expect(body).toContain('"text":"chunk1"');
    expect(body).toContain('"text":"chunk2"');
    expect(body).toContain('event: done');
  });

  it('POST /api/chat/stream returns 503 when no AI configured', async () => {
    app._setGeminiModel(null);
    const res = await request(app)
      .post('/api/chat/stream')

      .send({ messages: [{ role: 'user', content: 'hello' }] });
    expect(res.status).toBe(503);
  });

  it('POST /api/chat/stream returns 400 for empty messages', async () => {
    app._setGeminiModel(mockGeminiModel);
    const res = await request(app)
      .post('/api/chat/stream')

      .send({ messages: [] });
    expect(res.status).toBe(400);
  });

  it('POST /api/chat/stream sends error event on API failure', async () => {
    app._setGeminiModel({
      generateContentStream: async () => {
        const err = new Error('service down');
        err.status = 500;
        throw err;
      },
    });

    const res = await request(app)
      .post('/api/chat/stream')

      .send({ messages: [{ role: 'user', content: 'hello' }] })
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk.toString(); });
        res.on('end', () => cb(null, data));
      });

    expect(res.body).toContain('event: error');
    expect(res.body).toContain('temporarily unavailable');
  });
});

describe('classifyApiError', () => {
  const classify = app._classifyApiError;

  it('classifies 401 as 502 non-retryable auth error', () => {
    const result = classify({ status: 401, message: 'unauthorized' });
    expect(result.status).toBe(502);
    expect(result.retryable).toBe(false);
    expect(result.message).toMatch(/authentication/i);
  });

  it('classifies 403 as 502 non-retryable auth error', () => {
    const result = classify({ status: 403, message: 'forbidden' });
    expect(result.status).toBe(502);
    expect(result.retryable).toBe(false);
  });

  it('classifies "api key" message as auth error regardless of status', () => {
    const result = classify({ status: 400, message: 'Invalid API key provided' });
    expect(result.status).toBe(502);
    expect(result.retryable).toBe(false);
  });

  it('classifies 429 as retryable quota error', () => {
    const result = classify({ status: 429, message: 'rate limited' });
    expect(result.status).toBe(429);
    expect(result.retryable).toBe(true);
  });

  it('classifies "resource exhausted" as quota error', () => {
    const result = classify({ status: 400, message: 'Resource exhausted for project' });
    expect(result.status).toBe(429);
    expect(result.retryable).toBe(true);
  });

  it('classifies "quota" message as quota error', () => {
    const result = classify({ status: 400, message: 'Quota exceeded' });
    expect(result.status).toBe(429);
    expect(result.retryable).toBe(true);
  });

  it('classifies 408 as retryable timeout', () => {
    const result = classify({ status: 408, message: 'request timeout' });
    expect(result.status).toBe(504);
    expect(result.retryable).toBe(true);
  });

  it('classifies ETIMEDOUT as retryable timeout', () => {
    const result = classify({ code: 'ETIMEDOUT', message: 'timed out' });
    expect(result.status).toBe(504);
    expect(result.retryable).toBe(true);
  });

  it('classifies "deadline" message as timeout', () => {
    const result = classify({ message: 'Deadline exceeded' });
    expect(result.status).toBe(504);
    expect(result.retryable).toBe(true);
  });

  it('classifies 500 as retryable server error', () => {
    const result = classify({ status: 500, message: 'internal' });
    expect(result.status).toBe(502);
    expect(result.retryable).toBe(true);
  });

  it('classifies 503 as retryable server error', () => {
    const result = classify({ status: 503, message: 'service unavailable' });
    expect(result.status).toBe(502);
    expect(result.retryable).toBe(true);
  });

  it('classifies ECONNREFUSED as retryable connection error', () => {
    const result = classify({ code: 'ECONNREFUSED', message: 'connection refused' });
    expect(result.status).toBe(502);
    expect(result.retryable).toBe(true);
  });

  it('classifies ENOTFOUND as retryable connection error', () => {
    const result = classify({ code: 'ENOTFOUND', message: 'dns lookup failed' });
    expect(result.status).toBe(502);
    expect(result.retryable).toBe(true);
  });

  it('classifies ECONNRESET as retryable connection error', () => {
    const result = classify({ code: 'ECONNRESET', message: 'connection reset' });
    expect(result.status).toBe(502);
    expect(result.retryable).toBe(true);
  });

  it('classifies unknown errors as 500 non-retryable', () => {
    const result = classify({ message: 'something weird happened' });
    expect(result.status).toBe(500);
    expect(result.retryable).toBe(false);
  });

  it('handles null/undefined error gracefully', () => {
    const result = classify(null);
    expect(result.status).toBe(500);
    expect(result.retryable).toBe(false);
  });
});

describe('sanitizeFilename', () => {
  const sanitize = app._sanitizeFilename;

  it('keeps safe filenames unchanged', () => {
    expect(sanitize('photo.png')).toBe('photo.png');
    expect(sanitize('my-image_2024.jpg')).toBe('my-image_2024.jpg');
  });

  it('strips directory traversal components', () => {
    expect(sanitize('../../etc/passwd')).toBe('passwd');
    expect(sanitize('../secret.txt')).toBe('secret.txt');
  });

  it('strips Unix absolute path prefixes', () => {
    expect(sanitize('/etc/passwd')).toBe('passwd');
  });

  it('neutralizes Windows-style paths on any platform', () => {
    const result = sanitize('C:\\Windows\\system32\\cmd.exe');
    // On Linux, backslashes are not path separators so path.basename keeps them,
    // then the regex replaces them with underscores — either way, traversal is prevented
    expect(result).not.toContain('\\');
    expect(result).toMatch(/cmd\.exe$/);
  });

  it('replaces special characters with underscores', () => {
    expect(sanitize('file name (1).png')).toBe('file_name__1_.png');
    expect(sanitize('hello@world#$.txt')).toBe('hello_world__.txt');
  });

  it('handles empty and edge-case filenames', () => {
    expect(sanitize('...')).toBe('...');
    expect(sanitize('.hidden')).toBe('.hidden');
  });

  it('strips URL-encoded traversal attempts', () => {
    // path.basename handles the string literal, special chars replaced
    expect(sanitize('%2e%2e%2fpasswd')).toBe('_2e_2e_2fpasswd');
  });
});

describe('isValidImageByMagicBytes', () => {
  const isValid = app._isValidImageByMagicBytes;

  it('validates PNG files', () => {
    const pngFile = path.join(testDir, 'magic-test.png');
    fs.writeFileSync(pngFile, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]));
    expect(isValid(pngFile)).toBe(true);
  });

  it('validates JPEG files', () => {
    const jpgFile = path.join(testDir, 'magic-test.jpg');
    fs.writeFileSync(jpgFile, Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(isValid(jpgFile)).toBe(true);
  });

  it('validates GIF files', () => {
    const gifFile = path.join(testDir, 'magic-test.gif');
    fs.writeFileSync(gifFile, Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]));
    expect(isValid(gifFile)).toBe(true);
  });

  it('validates BMP files', () => {
    const bmpFile = path.join(testDir, 'magic-test.bmp');
    fs.writeFileSync(bmpFile, Buffer.from([0x42, 0x4D, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(isValid(bmpFile)).toBe(true);
  });

  it('validates WebP files', () => {
    const webpFile = path.join(testDir, 'magic-test.webp');
    // RIFF....WEBP
    fs.writeFileSync(webpFile, Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]));
    expect(isValid(webpFile)).toBe(true);
  });

  it('validates SVG-like files starting with <', () => {
    const svgFile = path.join(testDir, 'magic-test.svg');
    fs.writeFileSync(svgFile, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(isValid(svgFile)).toBe(true);
  });

  it('rejects random binary data', () => {
    const badFile = path.join(testDir, 'magic-bad.bin');
    fs.writeFileSync(badFile, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B]));
    expect(isValid(badFile)).toBe(false);
  });

  it('rejects text files', () => {
    const txtFile = path.join(testDir, 'magic-bad.txt');
    fs.writeFileSync(txtFile, 'Hello, this is not an image');
    expect(isValid(txtFile)).toBe(false);
  });

  it('returns false for non-existent files', () => {
    expect(isValid(path.join(testDir, 'does-not-exist.png'))).toBe(false);
  });

  it('rejects RIFF without WEBP signature', () => {
    const riffFile = path.join(testDir, 'magic-riff.bin');
    // RIFF header but not WEBP at offset 8
    fs.writeFileSync(riffFile, Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]));
    expect(isValid(riffFile)).toBe(false);
  });
});

describe('resizeForApi', () => {
  const resizeForApi = app._resizeForApi;

  it('returns small images unchanged', async () => {
    const buf = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
    }).png().toBuffer();
    const b64 = buf.toString('base64');
    const result = await resizeForApi(b64, 'image/png');
    expect(result.data).toBe(b64);
    expect(result.mimeType).toBe('image/png');
  });

  it('returns images at exactly 3072px unchanged', async () => {
    const buf = await sharp({
      create: { width: 3072, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
    }).png().toBuffer();
    const b64 = buf.toString('base64');
    const result = await resizeForApi(b64, 'image/png');
    expect(result.data).toBe(b64);
    expect(result.mimeType).toBe('image/png');
  });

  it('resizes images larger than 3072px and converts to JPEG', async () => {
    const buf = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).png().toBuffer();
    const b64 = buf.toString('base64');
    const result = await resizeForApi(b64, 'image/png');
    expect(result.mimeType).toBe('image/jpeg');
    // Verify the output is smaller
    const outBuf = Buffer.from(result.data, 'base64');
    const meta = await sharp(outBuf).metadata();
    expect(meta.width).toBeLessThanOrEqual(3072);
    expect(meta.height).toBeLessThanOrEqual(3072);
  });

  it('preserves aspect ratio when resizing', async () => {
    const buf = await sharp({
      create: { width: 6000, height: 3000, channels: 3, background: { r: 0, g: 255, b: 0 } },
    }).png().toBuffer();
    const b64 = buf.toString('base64');
    const result = await resizeForApi(b64, 'image/png');
    const outBuf = Buffer.from(result.data, 'base64');
    const meta = await sharp(outBuf).metadata();
    expect(meta.width).toBe(3072);
    // Height should be proportional: 3000 * (3072/6000) = 1536
    expect(meta.height).toBe(1536);
  });
});
