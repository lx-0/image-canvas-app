'use strict';

const request = require('supertest');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// Ensure the server doesn't use a real API key on load
delete process.env.GEMINI_API_KEY;

const app = require('./server');

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
  try {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
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

describe('Static files', () => {
  it('GET / returns HTML', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});
