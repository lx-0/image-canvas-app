// Image filter/manipulation functions — layer-aware
// Pixel filters operate on the active layer by default.
// Geometric transforms (crop, resize, rotate, flip) accept optional canvas/ctx
// so callers can apply them to each layer individually.
import { els } from './state.js';
import { getActiveCanvas, getActiveCtx } from './layers.js';

export function executeCrop(cmd, c, cx) {
  const canvas = c || getActiveCanvas();
  const ctx = cx || getActiveCtx();
  const sx = Math.round((cmd.x / 100) * canvas.width);
  const sy = Math.round((cmd.y / 100) * canvas.height);
  const sw = Math.round((cmd.width / 100) * canvas.width);
  const sh = Math.round((cmd.height / 100) * canvas.height);

  const imageData = ctx.getImageData(sx, sy, sw, sh);
  canvas.width = sw;
  canvas.height = sh;
  ctx.putImageData(imageData, 0, 0);
}

export function executeResize(cmd, c, cx) {
  const canvas = c || getActiveCanvas();
  const ctx = cx || getActiveCtx();
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  tempCanvas.getContext('2d').drawImage(canvas, 0, 0);

  let newW, newH;
  if (cmd.scale) {
    newW = Math.round(canvas.width * cmd.scale);
    newH = Math.round(canvas.height * cmd.scale);
  } else {
    newW = cmd.width;
    newH = cmd.height;
  }

  canvas.width = newW;
  canvas.height = newH;
  ctx.drawImage(tempCanvas, 0, 0, newW, newH);
}

export function executeRotate(cmd, c, cx) {
  const canvas = c || getActiveCanvas();
  const ctx = cx || getActiveCtx();
  const deg = cmd.degrees;
  const rad = (deg * Math.PI) / 180;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  tempCanvas.getContext('2d').drawImage(canvas, 0, 0);

  if (deg === 90 || deg === 270 || deg === -90 || deg === -270) {
    canvas.width = tempCanvas.height;
    canvas.height = tempCanvas.width;
  } else if (deg === 180 || deg === -180) {
    canvas.width = tempCanvas.width;
    canvas.height = tempCanvas.height;
  }

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(tempCanvas, -tempCanvas.width / 2, -tempCanvas.height / 2);
  ctx.restore();
}

export function executeAddText(cmd) {
  const ctx = getActiveCtx();
  const canvas = getActiveCanvas();
  const x = (cmd.x / 100) * canvas.width;
  const y = (cmd.y / 100) * canvas.height;
  const fontSize = cmd.fontSize || 24;
  const color = cmd.color || 'white';
  const font = cmd.font || 'sans-serif';

  ctx.save();
  ctx.font = `${fontSize}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  ctx.fillText(cmd.text, x, y);
  ctx.restore();
}

export function executeFlip(cmd, c, cx) {
  const canvas = c || getActiveCanvas();
  const ctx = cx || getActiveCtx();
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  tempCanvas.getContext('2d').drawImage(canvas, 0, 0);

  ctx.save();
  if (cmd.direction === 'horizontal') {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(0, canvas.height);
    ctx.scale(1, -1);
  }
  ctx.drawImage(tempCanvas, 0, 0);
  ctx.restore();
}

export function executeGrayscale() {
  const canvas = getActiveCanvas();
  const ctx = getActiveCtx();
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const avg = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = data[i + 1] = data[i + 2] = avg;
  }
  ctx.putImageData(imageData, 0, 0);
}

export function executeBrightness(cmd) {
  const canvas = getActiveCanvas();
  const ctx = getActiveCtx();
  const val = cmd.value;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const factor = (val / 100) * 255;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.max(0, Math.min(255, data[i] + factor));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + factor));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + factor));
  }
  ctx.putImageData(imageData, 0, 0);
}

export function executeContrast(cmd) {
  const canvas = getActiveCanvas();
  const ctx = getActiveCtx();
  const val = cmd.value;
  const factor = (259 * (val + 255)) / (255 * (259 - val));
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.max(0, Math.min(255, factor * (data[i] - 128) + 128));
    data[i + 1] = Math.max(0, Math.min(255, factor * (data[i + 1] - 128) + 128));
    data[i + 2] = Math.max(0, Math.min(255, factor * (data[i + 2] - 128) + 128));
  }
  ctx.putImageData(imageData, 0, 0);
}

export function executeBlur(cmd) {
  const canvas = getActiveCanvas();
  const ctx = getActiveCtx();
  const radius = Math.max(1, Math.round(cmd.radius || 3));
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const w = canvas.width;
  const h = canvas.height;
  const copy = new Uint8ClampedArray(data);

  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? copy : new Uint8ClampedArray(data);
    if (pass === 1) src.set(data);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const idx = (ny * w + nx) * 4;
              r += src[idx]; g += src[idx + 1]; b += src[idx + 2];
              count++;
            }
          }
        }
        const idx = (y * w + x) * 4;
        data[idx] = r / count;
        data[idx + 1] = g / count;
        data[idx + 2] = b / count;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

export function executeSharpen(cmd) {
  const canvas = getActiveCanvas();
  const ctx = getActiveCtx();
  const amount = cmd.amount || 1;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const w = canvas.width;
  const h = canvas.height;
  const orig = new Uint8ClampedArray(data);

  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let val = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            val += orig[((y + ky) * w + (x + kx)) * 4 + c] * kernel[(ky + 1) * 3 + (kx + 1)];
          }
        }
        const idx = (y * w + x) * 4 + c;
        data[idx] = Math.max(0, Math.min(255, orig[idx] + (val - orig[idx]) * amount));
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

export function executeSepia() {
  const canvas = getActiveCanvas();
  const ctx = getActiveCtx();
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    data[i] = Math.min(255, r * 0.393 + g * 0.769 + b * 0.189);
    data[i + 1] = Math.min(255, r * 0.349 + g * 0.686 + b * 0.168);
    data[i + 2] = Math.min(255, r * 0.272 + g * 0.534 + b * 0.131);
  }
  ctx.putImageData(imageData, 0, 0);
}

export function executeSaturation(cmd) {
  const canvas = getActiveCanvas();
  const ctx = getActiveCtx();
  const val = cmd.value / 100;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    const factor = 1 + val;
    data[i] = Math.max(0, Math.min(255, gray + (r - gray) * factor));
    data[i + 1] = Math.max(0, Math.min(255, gray + (g - gray) * factor));
    data[i + 2] = Math.max(0, Math.min(255, gray + (b - gray) * factor));
  }
  ctx.putImageData(imageData, 0, 0);
}

export function executeHueRotate(cmd) {
  const canvas = getActiveCanvas();
  const ctx = getActiveCtx();
  const deg = cmd.degrees || 0;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    data[i] = Math.max(0, Math.min(255,
      r * (0.213 + cos * 0.787 - sin * 0.213) +
      g * (0.715 - cos * 0.715 - sin * 0.715) +
      b * (0.072 - cos * 0.072 + sin * 0.928)));
    data[i + 1] = Math.max(0, Math.min(255,
      r * (0.213 - cos * 0.213 + sin * 0.143) +
      g * (0.715 + cos * 0.285 + sin * 0.140) +
      b * (0.072 - cos * 0.072 - sin * 0.283)));
    data[i + 2] = Math.max(0, Math.min(255,
      r * (0.213 - cos * 0.213 - sin * 0.787) +
      g * (0.715 - cos * 0.715 + sin * 0.715) +
      b * (0.072 + cos * 0.928 + sin * 0.072)));
  }
  ctx.putImageData(imageData, 0, 0);
}

export function executeInvert() {
  const canvas = getActiveCanvas();
  const ctx = getActiveCtx();
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  ctx.putImageData(imageData, 0, 0);
}

export function executeVignette(cmd) {
  const canvas = getActiveCanvas();
  const ctx = getActiveCtx();
  const strength = cmd.strength != null ? cmd.strength / 100 : 0.5;
  const w = canvas.width, h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const cx = w / 2, cy = h / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
      const factor = 1 - dist * dist * strength;
      const idx = (y * w + x) * 4;
      data[idx] = Math.max(0, data[idx] * factor);
      data[idx + 1] = Math.max(0, data[idx + 1] * factor);
      data[idx + 2] = Math.max(0, data[idx + 2] * factor);
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

export function executeShadowsHighlights(cmd) {
  const canvas = getActiveCanvas();
  const ctx = getActiveCtx();
  const shadows = (cmd.shadows || 0) / 100;
  const highlights = (cmd.highlights || 0) / 100;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const val = data[i + c] / 255;
      let adjusted = val;
      if (shadows !== 0) {
        const shadowWeight = 1 - val;
        adjusted += shadows * shadowWeight * 0.5;
      }
      if (highlights !== 0) {
        const highlightWeight = val;
        adjusted += highlights * highlightWeight * 0.5;
      }
      data[i + c] = Math.max(0, Math.min(255, adjusted * 255));
    }
  }
  ctx.putImageData(imageData, 0, 0);
}
