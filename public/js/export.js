// Export/Save dialog functionality
import { els, state } from './state.js';
import { announce, trapFocus } from './ui.js';

const { canvas, exportOverlay, exportFilename, exportFormat, exportQuality,
        qualityValue, qualityField, exportCancelBtn, exportDownloadBtn,
        saveBtn, statusEl, errorEl } = els;

let exportFocusTrap = null;

function getDefaultFilename() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `image-canvas-${yyyy}-${mm}-${dd}`;
}

export function openExportDialog() {
  if (!state.currentImg) return;
  exportFilename.value = getDefaultFilename();
  exportFormat.value = 'png';
  qualityField.style.display = 'none';
  exportQuality.value = 92;
  qualityValue.textContent = '92';
  exportOverlay.classList.add('visible');
  exportFilename.select();
  exportFocusTrap = trapFocus(document.getElementById('export-dialog'));
  announce('Export dialog opened');
}

export function closeExportDialog() {
  exportOverlay.classList.remove('visible');
  if (exportFocusTrap) { exportFocusTrap(); exportFocusTrap = null; }
  saveBtn.focus();
  announce('Export dialog closed');
}

exportFormat.addEventListener('change', () => {
  qualityField.style.display = exportFormat.value === 'jpeg' ? '' : 'none';
});

exportQuality.addEventListener('input', () => {
  qualityValue.textContent = exportQuality.value;
});

exportCancelBtn.addEventListener('click', closeExportDialog);

exportOverlay.addEventListener('click', (e) => {
  if (e.target === exportOverlay) closeExportDialog();
});

exportDownloadBtn.addEventListener('click', () => {
  if (!state.currentImg) return;

  const format = exportFormat.value;
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const quality = format === 'jpeg' ? Number(exportQuality.value) / 100 : undefined;
  const filename = (exportFilename.value.trim() || getDefaultFilename()) + '.' + format;

  const offscreen = document.createElement('canvas');
  offscreen.width = state.currentImg.width;
  offscreen.height = state.currentImg.height;
  offscreen.getContext('2d').drawImage(state.currentImg, 0, 0);

  offscreen.toBlob((blob) => {
    if (!blob) {
      errorEl.textContent = 'Export failed.';
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
    statusEl.textContent = `Exported ${filename}`;
    closeExportDialog();
  }, mimeType, quality);
});

saveBtn.addEventListener('click', openExportDialog);
