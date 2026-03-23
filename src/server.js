'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

const uploadsDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  anthropic = new Anthropic();
} else {
  console.warn('ANTHROPIC_API_KEY not set — /api/chat will return 503 until configured');
}

const SYSTEM_PROMPT = `You are an AI image editing assistant. The user has an image displayed on an HTML5 canvas and will ask you to manipulate it.

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

Example response for "rotate 90 degrees and add hello text":
<commands>[{"action":"rotate","degrees":90},{"action":"addText","text":"Hello","x":50,"y":50,"fontSize":32,"color":"white"}]</commands>
Rotated the image 90° clockwise and added "Hello" text in the center.

If the user asks a general question or something that doesn't require canvas manipulation, just respond normally without commands. Always be concise.`;

app.use(express.static(path.join(__dirname, '../public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ url: `/uploads/${req.file.filename}` });
});

app.post('/api/chat', async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  }

  const { messages, imageData } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const apiMessages = messages.map((msg, i) => {
      const content = [];

      // Attach the current canvas image to the latest user message
      if (msg.role === 'user' && i === messages.length - 1 && imageData) {
        const match = imageData.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: match[1],
              data: match[2],
            },
          });
        }
      }

      content.push({ type: 'text', text: msg.content });
      return { role: msg.role, content };
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: apiMessages,
    });

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

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

    res.json({ response: displayText, commands });
  } catch (err) {
    console.error('Chat API error:', err.message);
    res.status(500).json({ error: 'Failed to process chat request' });
  }
});

app.post('/api/chat/stream', async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  }

  const { messages, imageData } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
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
    const apiMessages = messages.map((msg, i) => {
      const content = [];
      if (msg.role === 'user' && i === messages.length - 1 && imageData) {
        const match = imageData.match(/^data:(image\/\w+);base64,(.+)$/);
        if (match) {
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: match[1], data: match[2] },
          });
        }
      }
      content.push({ type: 'text', text: msg.content });
      return { role: msg.role, content };
    });

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: apiMessages,
    });

    let fullText = '';

    stream.on('text', (textDelta) => {
      fullText += textDelta;
      sendEvent('delta', { text: textDelta });
    });

    const finalMessage = await stream.finalMessage();

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
    sendEvent('done', { response: displayText, commands });
    res.end();
  } catch (err) {
    console.error('Chat stream error:', err.message);
    sendEvent('error', { error: 'Failed to process chat request' });
    res.end();
  }
});

app.post('/api/composite', async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  }

  const { baseImage, droppedImage, instructions } = req.body;

  if (!baseImage || !droppedImage) {
    return res.status(400).json({ error: 'baseImage and droppedImage are required' });
  }

  function parseDataURL(dataUrl) {
    const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return null;
    return { media_type: match[1], data: match[2] };
  }

  const base = parseDataURL(baseImage);
  const dropped = parseDataURL(droppedImage);

  if (!base || !dropped) {
    return res.status(400).json({ error: 'Invalid image data URLs' });
  }

  const userPrompt = instructions
    ? `The user wants to composite the second image onto the first with these instructions: "${instructions}"`
    : 'Composite the second image onto the first. Identify the main subject/object in the second image and place it naturally on the base image.';

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are an image compositing assistant. You receive two images:
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
I identified a cat in the dropped image and placed it on the couch in the base image, scaled to look natural.`,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: base.media_type, data: base.data } },
            { type: 'image', source: { type: 'base64', media_type: dropped.media_type, data: dropped.data } },
            { type: 'text', text: userPrompt },
          ],
        },
      ],
    });

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

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

    res.json({ response: displayText, composite: compositeData });
  } catch (err) {
    console.error('Composite API error:', err.message);
    res.status(500).json({ error: 'Failed to process composite request' });
  }
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
