import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all deps before importing commands
vi.mock('../../public/js/state.js', () => ({
  els: {
    canvas: { width: 100, height: 100, toDataURL: vi.fn(() => 'data:image/png;base64,mock') },
    ctx: {},
    chatMessages: { appendChild: vi.fn(), scrollTop: 0, scrollHeight: 0 },
    statusEl: { textContent: '' },
  },
  state: { currentImg: null, currentImageKey: null },
}));

vi.mock('../../public/js/ui.js', () => ({
  setChatEnabled: vi.fn(),
}));

vi.mock('../../public/js/canvas.js', () => ({
  saveState: vi.fn(),
}));

vi.mock('../../public/js/gallery.js', () => ({
  incrementEditCount: vi.fn(),
}));

vi.mock('../../public/js/filters.js', () => ({
  executeCrop: vi.fn(),
  executeResize: vi.fn(),
  executeRotate: vi.fn(),
  executeAddText: vi.fn(),
  executeFlip: vi.fn(),
  executeGrayscale: vi.fn(),
  executeBrightness: vi.fn(),
  executeContrast: vi.fn(),
  executeBlur: vi.fn(),
  executeSharpen: vi.fn(),
  executeSepia: vi.fn(),
  executeSaturation: vi.fn(),
  executeHueRotate: vi.fn(),
  executeInvert: vi.fn(),
  executeVignette: vi.fn(),
  executeShadowsHighlights: vi.fn(),
}));

const { isDestructiveCommand, hasDestructiveCommands, executeCommands } = await import('../../public/js/commands.js');
const filters = await import('../../public/js/filters.js');
const { state } = await import('../../public/js/state.js');

describe('commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isDestructiveCommand', () => {
    it('classifies crop as destructive', () => {
      expect(isDestructiveCommand({ action: 'crop' })).toBe(true);
    });

    it('classifies resize as destructive', () => {
      expect(isDestructiveCommand({ action: 'resize' })).toBe(true);
    });

    it('classifies rotate as destructive', () => {
      expect(isDestructiveCommand({ action: 'rotate' })).toBe(true);
    });

    it('classifies flip as destructive', () => {
      expect(isDestructiveCommand({ action: 'flip' })).toBe(true);
    });

    it('classifies brightness as non-destructive', () => {
      expect(isDestructiveCommand({ action: 'brightness' })).toBe(false);
    });

    it('classifies grayscale as non-destructive', () => {
      expect(isDestructiveCommand({ action: 'grayscale' })).toBe(false);
    });

    it('classifies contrast as non-destructive', () => {
      expect(isDestructiveCommand({ action: 'contrast' })).toBe(false);
    });

    it('classifies blur as non-destructive', () => {
      expect(isDestructiveCommand({ action: 'blur' })).toBe(false);
    });

    it('classifies unknown actions as non-destructive', () => {
      expect(isDestructiveCommand({ action: 'unknown' })).toBe(false);
    });
  });

  describe('hasDestructiveCommands', () => {
    it('returns true when any command is destructive', () => {
      expect(hasDestructiveCommands([
        { action: 'brightness', value: 10 },
        { action: 'crop', x: 0, y: 0, width: 50, height: 50 },
      ])).toBe(true);
    });

    it('returns false when no commands are destructive', () => {
      expect(hasDestructiveCommands([
        { action: 'brightness', value: 10 },
        { action: 'grayscale' },
      ])).toBe(false);
    });

    it('returns false for empty array', () => {
      expect(hasDestructiveCommands([])).toBe(false);
    });
  });

  describe('executeCommands', () => {
    it('does nothing when no current image', () => {
      state.currentImg = null;
      executeCommands([{ action: 'grayscale' }]);
      expect(filters.executeGrayscale).not.toHaveBeenCalled();
    });

    it('does nothing with null commands', () => {
      state.currentImg = {};
      executeCommands(null);
      expect(filters.executeGrayscale).not.toHaveBeenCalled();
    });

    it('dispatches each command to the correct filter', () => {
      state.currentImg = {};
      executeCommands([
        { action: 'grayscale' },
        { action: 'brightness', value: 50 },
        { action: 'sepia' },
      ]);
      expect(filters.executeGrayscale).toHaveBeenCalledOnce();
      expect(filters.executeBrightness).toHaveBeenCalledWith({ action: 'brightness', value: 50 });
      expect(filters.executeSepia).toHaveBeenCalledOnce();
    });

    it('dispatches crop command', () => {
      state.currentImg = {};
      const cmd = { action: 'crop', x: 10, y: 10, width: 50, height: 50 };
      executeCommands([cmd]);
      expect(filters.executeCrop).toHaveBeenCalledWith(cmd);
    });

    it('dispatches all 16 action types correctly', () => {
      state.currentImg = {};
      const commands = [
        { action: 'crop', x: 0, y: 0, width: 100, height: 100 },
        { action: 'resize', scale: 0.5 },
        { action: 'rotate', degrees: 90 },
        { action: 'addText', text: 'hi', x: 50, y: 50 },
        { action: 'flip', direction: 'horizontal' },
        { action: 'grayscale' },
        { action: 'brightness', value: 10 },
        { action: 'contrast', value: 10 },
        { action: 'blur', radius: 3 },
        { action: 'sharpen', amount: 1 },
        { action: 'sepia' },
        { action: 'saturation', value: 50 },
        { action: 'hue-rotate', degrees: 90 },
        { action: 'invert' },
        { action: 'vignette', strength: 50 },
        { action: 'shadows-highlights', shadows: 10, highlights: -10 },
      ];
      executeCommands(commands);
      expect(filters.executeCrop).toHaveBeenCalled();
      expect(filters.executeResize).toHaveBeenCalled();
      expect(filters.executeRotate).toHaveBeenCalled();
      expect(filters.executeAddText).toHaveBeenCalled();
      expect(filters.executeFlip).toHaveBeenCalled();
      expect(filters.executeGrayscale).toHaveBeenCalled();
      expect(filters.executeBrightness).toHaveBeenCalled();
      expect(filters.executeContrast).toHaveBeenCalled();
      expect(filters.executeBlur).toHaveBeenCalled();
      expect(filters.executeSharpen).toHaveBeenCalled();
      expect(filters.executeSepia).toHaveBeenCalled();
      expect(filters.executeSaturation).toHaveBeenCalled();
      expect(filters.executeHueRotate).toHaveBeenCalled();
      expect(filters.executeInvert).toHaveBeenCalled();
      expect(filters.executeVignette).toHaveBeenCalled();
      expect(filters.executeShadowsHighlights).toHaveBeenCalled();
    });
  });
});
