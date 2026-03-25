// AI-powered smart crop preset buttons
import { sendMessage } from './chat.js';
import { state } from './state.js';
import { addSystemMessage } from './ui.js';

const PRESETS = {
  '1:1':  'Crop this image to a 1:1 square aspect ratio, keeping the most important content centered.',
  '4:3':  'Crop this image to a 4:3 landscape aspect ratio, keeping the most important content centered.',
  '16:9': 'Crop this image to a 16:9 widescreen aspect ratio, keeping the most important content centered.',
  '9:16': 'Crop this image to a 9:16 vertical/portrait aspect ratio, keeping the most important content centered.',
  '4:5':  'Crop this image to a 4:5 portrait aspect ratio, keeping the most important content centered.',
};

export function initCropPresets() {
  const container = document.getElementById('crop-presets');
  if (!container) return;

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.crop-preset-btn');
    if (!btn) return;

    if (!state.currentImg) {
      addSystemMessage('No image loaded. Upload an image first.');
      return;
    }

    const ratio = btn.dataset.ratio;
    const message = PRESETS[ratio];
    if (message) {
      sendMessage(message);
    }
  });
}
