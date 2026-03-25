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
