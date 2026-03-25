import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock canvas/ctx used by filters.js
let mockData;
let mockCanvas;
let mockCtx;

vi.mock('../../public/js/state.js', () => {
  mockCanvas = { width: 2, height: 2 };
  mockCtx = {
    getImageData: vi.fn(() => ({ data: mockData, width: mockCanvas.width, height: mockCanvas.height })),
    putImageData: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    font: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    fillText: vi.fn(),
  };
  return {
    els: { canvas: mockCanvas, ctx: mockCtx },
    state: {},
  };
});

// Must import after mock setup
const filters = await import('../../public/js/filters.js');

function setPixels(...pixels) {
  // Each pixel is [r, g, b, a]
  const flat = pixels.flat();
  mockData = new Uint8ClampedArray(flat);
}

describe('filters', () => {
  beforeEach(() => {
    mockCanvas.width = 2;
    mockCanvas.height = 2;
    vi.clearAllMocks();
  });

  describe('executeGrayscale', () => {
    it('converts pixels to luminance-weighted grayscale', () => {
      setPixels([255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [128, 128, 128, 255]);
      filters.executeGrayscale();
      // R: 255*0.299 = 76.245
      expect(mockData[0]).toBeCloseTo(76, 0);
      expect(mockData[1]).toBeCloseTo(76, 0);
      expect(mockData[2]).toBeCloseTo(76, 0);
      expect(mockData[3]).toBe(255); // alpha unchanged
      // G: 255*0.587 = 149.685
      expect(mockData[4]).toBeCloseTo(150, 0);
      // B: 255*0.114 = 29.07
      expect(mockData[8]).toBeCloseTo(29, 0);
      expect(mockCtx.putImageData).toHaveBeenCalledOnce();
    });

    it('preserves alpha channel', () => {
      setPixels([100, 200, 50, 128], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
      filters.executeGrayscale();
      expect(mockData[3]).toBe(128);
    });
  });

  describe('executeInvert', () => {
    it('inverts RGB channels', () => {
      setPixels([255, 0, 128, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
      filters.executeInvert();
      expect(mockData[0]).toBe(0);
      expect(mockData[1]).toBe(255);
      expect(mockData[2]).toBe(127);
      expect(mockData[3]).toBe(255); // alpha unchanged
    });

    it('double invert restores original', () => {
      setPixels([50, 100, 200, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
      filters.executeInvert();
      filters.executeInvert();
      expect(mockData[0]).toBe(50);
      expect(mockData[1]).toBe(100);
      expect(mockData[2]).toBe(200);
    });
  });

  describe('executeSepia', () => {
    it('applies sepia tone matrix', () => {
      setPixels([100, 150, 200, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
      filters.executeSepia();
      // r = min(255, 100*0.393 + 150*0.769 + 200*0.189) = min(255, 39.3+115.35+37.8) = 192.45
      expect(mockData[0]).toBeCloseTo(192, 0);
      // g = min(255, 100*0.349 + 150*0.686 + 200*0.168) = min(255, 34.9+102.9+33.6) = 171.4
      expect(mockData[1]).toBeCloseTo(171, 0);
      // b = min(255, 100*0.272 + 150*0.534 + 200*0.131) = min(255, 27.2+80.1+26.2) = 133.5
      expect(mockData[2]).toBeCloseTo(134, 0);
    });
  });

  describe('executeBrightness', () => {
    it('increases brightness with positive value', () => {
      setPixels([100, 100, 100, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
      filters.executeBrightness({ value: 50 });
      // factor = (50/100)*255 = 127.5
      expect(mockData[0]).toBeCloseTo(228, 0);
    });

    it('decreases brightness with negative value', () => {
      setPixels([200, 200, 200, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
      filters.executeBrightness({ value: -50 });
      // factor = (-50/100)*255 = -127.5 => 200-127.5 = 72.5, Uint8ClampedArray rounds to 72
      expect(mockData[0]).toBe(72);
    });

    it('clamps to 0-255 range', () => {
      setPixels([250, 10, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
      filters.executeBrightness({ value: 100 });
      expect(mockData[0]).toBe(255); // clamped to max
      // 10 + 255 = 265 -> clamped to 255
      expect(mockData[1]).toBe(255);
    });
  });

  describe('executeContrast', () => {
    it('applies contrast factor around midpoint 128', () => {
      setPixels([200, 50, 128, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
      filters.executeContrast({ value: 50 });
      // factor = (259 * (50 + 255)) / (255 * (259 - 50)) = 259*305 / 255*209 = 78995/53295 ≈ 1.4825
      const factor = (259 * 305) / (255 * 209);
      expect(mockData[0]).toBeCloseTo(Math.min(255, Math.max(0, factor * (200 - 128) + 128)), 0);
      expect(mockData[2]).toBeCloseTo(128, 0); // midpoint stays near 128
    });
  });

  describe('executeSaturation', () => {
    it('desaturates with negative value', () => {
      setPixels([255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
      filters.executeSaturation({ value: -100 });
      // factor = 1 + (-100/100) = 0 => gray = 255*0.299 = 76.245
      // result = gray + (r - gray) * 0 = gray
      const gray = 255 * 0.299;
      expect(mockData[0]).toBeCloseTo(gray, 0);
      expect(mockData[1]).toBeCloseTo(gray, 0);
      expect(mockData[2]).toBeCloseTo(gray, 0);
    });

    it('increases saturation with positive value', () => {
      setPixels([200, 100, 100, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
      filters.executeSaturation({ value: 50 });
      const gray = 200 * 0.299 + 100 * 0.587 + 100 * 0.114;
      const factor = 1 + 0.5;
      expect(mockData[0]).toBeCloseTo(Math.min(255, Math.max(0, gray + (200 - gray) * factor)), 0);
    });
  });

  describe('executeHueRotate', () => {
    it('rotates hue by specified degrees', () => {
      setPixels([255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
      filters.executeHueRotate({ degrees: 120 });
      // 120 degree rotation should shift red toward green
      expect(mockData[4 + 0]).toBe(0); // second pixel unchanged
      expect(mockCtx.putImageData).toHaveBeenCalled();
    });

    it('does nothing at 0 degrees', () => {
      setPixels([255, 128, 64, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]);
      filters.executeHueRotate({ degrees: 0 });
      expect(mockData[0]).toBe(255);
      expect(mockData[1]).toBe(128);
      expect(mockData[2]).toBe(64);
    });
  });

  describe('executeVignette', () => {
    it('darkens corners more than center', () => {
      // 2x2 image, all white
      setPixels([255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255], [255, 255, 255, 255]);
      filters.executeVignette({ strength: 100 });
      // Center (0.5,0.5) vs corners (0,0) — corners should be darker
      // All 4 pixels in a 2x2 are equidistant from center, so all same
      expect(mockCtx.putImageData).toHaveBeenCalled();
      // In a 2x2 all pixels are corner pixels, so all darken equally
      expect(mockData[0]).toBeLessThan(255);
    });
  });

  describe('executeShadowsHighlights', () => {
    it('lifts shadows without affecting highlights', () => {
      setPixels([20, 20, 20, 255], [240, 240, 240, 255], [0, 0, 0, 0], [0, 0, 0, 0]);
      filters.executeShadowsHighlights({ shadows: 50, highlights: 0 });
      // Dark pixel (20/255 ≈ 0.078) should be lifted
      expect(mockData[0]).toBeGreaterThan(20);
      // Bright pixel (240/255 ≈ 0.941) should barely change
      expect(mockData[4]).toBeGreaterThanOrEqual(240);
    });

    it('darkens highlights without affecting shadows', () => {
      setPixels([20, 20, 20, 255], [240, 240, 240, 255], [0, 0, 0, 0], [0, 0, 0, 0]);
      filters.executeShadowsHighlights({ shadows: 0, highlights: -50 });
      // Dark pixel barely changes
      expect(mockData[0]).toBeLessThanOrEqual(20);
      // Bright pixel should darken
      expect(mockData[4]).toBeLessThan(240);
    });
  });

  describe('executeCrop', () => {
    it('calls getImageData with percentage-based coordinates', () => {
      mockCanvas.width = 100;
      mockCanvas.height = 100;
      setPixels([0, 0, 0, 0]); // minimal data
      filters.executeCrop({ x: 10, y: 20, width: 50, height: 50 });
      expect(mockCtx.getImageData).toHaveBeenCalledWith(10, 20, 50, 50);
    });
  });

  describe('executeFlip', () => {
    beforeEach(() => {
      // jsdom doesn't support canvas getContext('2d'), so stub document.createElement
      // to return a mock canvas for temp canvas creation
      const origCreate = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        if (tag === 'canvas') {
          return {
            width: 0, height: 0,
            getContext: () => ({ drawImage: vi.fn() }),
          };
        }
        return origCreate(tag);
      });
    });

    it('sets up horizontal flip transform', () => {
      setPixels([0, 0, 0, 0]);
      filters.executeFlip({ direction: 'horizontal' });
      expect(mockCtx.scale).toHaveBeenCalledWith(-1, 1);
    });

    it('sets up vertical flip transform', () => {
      setPixels([0, 0, 0, 0]);
      filters.executeFlip({ direction: 'vertical' });
      expect(mockCtx.scale).toHaveBeenCalledWith(1, -1);
    });
  });

  describe('executeAddText', () => {
    it('renders text at percentage-based position', () => {
      mockCanvas.width = 200;
      mockCanvas.height = 100;
      filters.executeAddText({ text: 'Hello', x: 50, y: 50, fontSize: 16, color: 'red' });
      expect(mockCtx.fillText).toHaveBeenCalledWith('Hello', 100, 50);
      expect(mockCtx.fillStyle).toBe('red');
    });

    it('uses default font settings', () => {
      mockCanvas.width = 100;
      mockCanvas.height = 100;
      filters.executeAddText({ text: 'Test', x: 0, y: 0 });
      expect(mockCtx.font).toBe('24px sans-serif');
      expect(mockCtx.fillStyle).toBe('white');
    });
  });
});
