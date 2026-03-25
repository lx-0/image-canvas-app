// Export/Save dialog functionality
import { els, state } from './state.js';
import { announce, trapFocus } from './ui.js';

const { canvas, exportOverlay, exportFilename, exportFormat, exportQuality,
        qualityValue, qualityField, exportCancelBtn, exportDownloadBtn,
        saveBtn, statusEl, errorEl, sizeEstimate, sizeEstimateField,
        avifOption, qualityLabel } = els;

let exportFocusTrap = null;
let sizeEstimateTimer = null;

const FORMAT_CONFIG = {
  png:  { mime: 'image/png',  ext: 'png',  hasQuality: false, label: '' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg',  hasQuality: true,  label: 'JPEG Quality' },
  webp: { mime: 'image/webp', ext: 'webp', hasQuality: true,  label: 'WebP Quality' },
  avif: { mime: 'image/avif', ext: 'avif', hasQuality: true,  label: 'AVIF Quality' },
};

// Feature-detect AVIF encoding support via a 1x1 canvas test
function detectAvifSupport() {
  return new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    c.toBlob(
      (blob) => resolve(blob !== null && blob.size > 0),
      'image/avif',
      0.5
    );
  });
}

// Disable AVIF option if browser can't encode it
detectAvifSupport().then((supported) => {
  if (!supported && avifOption) {
    avifOption.disabled = true;
    avifOption.textContent = 'AVIF (not supported)';
  }
});

function getDefaultFilename() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `image-canvas-${yyyy}-${mm}-${dd}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getOffscreenCanvas() {
  if (!state.currentImg) return null;
  const offscreen = document.createElement('canvas');
  offscreen.width = state.currentImg.width;
  offscreen.height = state.currentImg.height;
  offscreen.getContext('2d').drawImage(state.currentImg, 0, 0);
  return offscreen;
}

function updateSizeEstimate() {
  if (!state.currentImg) return;

  clearTimeout(sizeEstimateTimer);
  sizeEstimateTimer = setTimeout(() => {
    const format = exportFormat.value;
    const cfg = FORMAT_CONFIG[format];
    if (!cfg) return;

    const quality = cfg.hasQuality ? Number(exportQuality.value) / 100 : undefined;
    const offscreen = getOffscreenCanvas();
    if (!offscreen) return;

    sizeEstimate.textContent = 'Estimating size\u2026';
    sizeEstimateField.style.display = '';

    offscreen.toBlob((blob) => {
      if (blob) {
        sizeEstimate.textContent = `Estimated size: ${formatFileSize(blob.size)}`;
      } else {
        sizeEstimate.textContent = 'Size estimate unavailable';
      }
    }, cfg.mime, quality);
  }, 200);
}

function updateQualityVisibility() {
  const format = exportFormat.value;
  const cfg = FORMAT_CONFIG[format];
  if (!cfg) return;

  qualityField.style.display = cfg.hasQuality ? '' : 'none';
  if (cfg.hasQuality) {
    qualityLabel.textContent = cfg.label;
  }
  updateSizeEstimate();
}

export function openExportDialog() {
  if (!state.currentImg) return;
  exportFilename.value = getDefaultFilename();
  exportFormat.value = 'png';
  exportQuality.value = 92;
  qualityValue.textContent = '92';
  updateQualityVisibility();
  exportOverlay.classList.add('visible');
  exportFilename.select();
  exportFocusTrap = trapFocus(document.getElementById('export-dialog'));
  announce('Export dialog opened');
}

export function closeExportDialog() {
  exportOverlay.classList.remove('visible');
  sizeEstimateField.style.display = 'none';
  if (exportFocusTrap) { exportFocusTrap(); exportFocusTrap = null; }
  saveBtn.focus();
  announce('Export dialog closed');
}

exportFormat.addEventListener('change', updateQualityVisibility);

exportQuality.addEventListener('input', () => {
  qualityValue.textContent = exportQuality.value;
  updateSizeEstimate();
});

exportCancelBtn.addEventListener('click', closeExportDialog);

exportOverlay.addEventListener('click', (e) => {
  if (e.target === exportOverlay) closeExportDialog();
});

exportDownloadBtn.addEventListener('click', () => {
  if (!state.currentImg) return;

  const format = exportFormat.value;
  const cfg = FORMAT_CONFIG[format];
  if (!cfg) return;

  const quality = cfg.hasQuality ? Number(exportQuality.value) / 100 : undefined;
  const ext = cfg.ext;
  const filename = (exportFilename.value.trim() || getDefaultFilename()) + '.' + ext;

  const offscreen = getOffscreenCanvas();
  if (!offscreen) return;

  offscreen.toBlob((blob) => {
    if (!blob) {
      errorEl.textContent = `Export failed. ${format.toUpperCase()} may not be supported in this browser.`;
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    statusEl.textContent = `Exported ${filename} (${formatFileSize(blob.size)})`;
    closeExportDialog();
  }, cfg.mime, quality);
});

saveBtn.addEventListener('click', openExportDialog);
