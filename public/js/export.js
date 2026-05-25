// Export/Save dialog functionality — layer-aware, multi-format, resolution scaling
import { els, state } from './state.js';
import { announce, trapFocus } from './ui.js';
import { getFlattenedCanvas, getActiveLayer } from './layers.js';

const { canvas, exportOverlay, exportFilename, exportFormat, exportQuality,
        qualityValue, qualityField, exportCancelBtn, exportDownloadBtn,
        saveBtn, statusEl, errorEl, sizeEstimate, sizeEstimateField,
        avifOption, qualityLabel, exportResolution, customDimsField,
        exportWidth, exportHeight, exportLinkDims, exportDimsInfo,
        exportDimsLabel, exportWarningField, exportWarning } = els;

let exportFocusTrap = null;
let sizeEstimateTimer = null;
let aspectLocked = true;
let sourceAspect = 1;

const MAX_EXPORT_DIM = 8000;

const FORMAT_CONFIG = {
  png:  { mime: 'image/png',  ext: 'png',  hasQuality: false, label: '',             supportsAlpha: true  },
  jpeg: { mime: 'image/jpeg', ext: 'jpg',  hasQuality: true,  label: 'JPEG Quality', supportsAlpha: false },
  webp: { mime: 'image/webp', ext: 'webp', hasQuality: true,  label: 'WebP Quality', supportsAlpha: true  },
  avif: { mime: 'image/avif', ext: 'avif', hasQuality: true,  label: 'AVIF Quality', supportsAlpha: true  },
};

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

function getSourceCanvas() {
  const layerMode = document.querySelector('input[name="export-layers"]:checked')?.value || 'visible';

  if (layerMode === 'active' && state.layers.length > 0) {
    const layer = getActiveLayer();
    if (layer) return layer.canvas;
  }

  if (state.layers.length > 0) {
    return getFlattenedCanvas();
  }

  if (!state.currentImg) return null;
  const offscreen = document.createElement('canvas');
  offscreen.width = state.currentImg.width;
  offscreen.height = state.currentImg.height;
  offscreen.getContext('2d').drawImage(state.currentImg, 0, 0);
  return offscreen;
}

function getSourceDimensions() {
  if (state.layers.length > 0) {
    const ref = state.layers[0].canvas;
    return { w: ref.width, h: ref.height };
  }
  if (state.currentImg) {
    return { w: state.currentImg.width, h: state.currentImg.height };
  }
  return null;
}

function getExportDimensions() {
  const src = getSourceDimensions();
  if (!src) return null;

  const res = exportResolution.value;
  if (res === 'custom') {
    const w = parseInt(exportWidth.value, 10) || src.w;
    const h = parseInt(exportHeight.value, 10) || src.h;
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  const scale = parseFloat(res);
  return { w: Math.round(src.w * scale), h: Math.round(src.h * scale) };
}

function buildExportCanvas() {
  const source = getSourceCanvas();
  if (!source) return null;

  const dims = getExportDimensions();
  if (!dims) return source;

  const format = exportFormat.value;
  const cfg = FORMAT_CONFIG[format];
  const needsWhiteBg = cfg && !cfg.supportsAlpha;

  const out = document.createElement('canvas');
  out.width = dims.w;
  out.height = dims.h;
  const ctx = out.getContext('2d');

  if (needsWhiteBg) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dims.w, dims.h);
  }

  ctx.drawImage(source, 0, 0, dims.w, dims.h);
  return out;
}

function updateDimsInfo() {
  const dims = getExportDimensions();
  if (!dims) {
    exportDimsInfo.style.display = 'none';
    return;
  }

  exportDimsLabel.textContent = `Output: ${dims.w} × ${dims.h} px`;
  exportDimsInfo.style.display = '';

  if (dims.w > MAX_EXPORT_DIM || dims.h > MAX_EXPORT_DIM) {
    exportWarning.textContent = `Warning: dimensions exceed ${MAX_EXPORT_DIM}px. Large exports may be slow or fail.`;
    exportWarningField.style.display = '';
  } else {
    exportWarningField.style.display = 'none';
  }
}

function updateCustomDimsVisibility() {
  customDimsField.style.display = exportResolution.value === 'custom' ? '' : 'none';
  updateDimsInfo();
  updateSizeEstimate();
}

function updateSizeEstimate() {
  const hasContent = state.layers.length > 0 || !!state.currentImg;
  if (!hasContent) return;

  clearTimeout(sizeEstimateTimer);
  sizeEstimateTimer = setTimeout(() => {
    const format = exportFormat.value;
    const cfg = FORMAT_CONFIG[format];
    if (!cfg) return;

    const quality = cfg.hasQuality ? Number(exportQuality.value) / 100 : undefined;
    const offscreen = buildExportCanvas();
    if (!offscreen) return;

    sizeEstimate.textContent = 'Estimating size…';
    sizeEstimateField.style.display = '';

    offscreen.toBlob((blob) => {
      if (blob) {
        sizeEstimate.textContent = `Estimated size: ${formatFileSize(blob.size)}`;
      } else {
        sizeEstimate.textContent = 'Size estimate unavailable';
      }
    }, cfg.mime, quality);
  }, 300);
}

function updateQualityVisibility() {
  const format = exportFormat.value;
  const cfg = FORMAT_CONFIG[format];
  if (!cfg) return;

  qualityField.style.display = cfg.hasQuality ? '' : 'none';
  if (cfg.hasQuality) {
    qualityLabel.textContent = cfg.label;
  }
  updateDimsInfo();
  updateSizeEstimate();
}

export function openExportDialog() {
  const hasContent = state.layers.length > 0 || !!state.currentImg;
  if (!hasContent) return;

  const src = getSourceDimensions();
  if (src) {
    sourceAspect = src.w / src.h;
    exportWidth.value = src.w;
    exportHeight.value = src.h;
  }

  exportFilename.value = getDefaultFilename();
  exportFormat.value = 'png';
  exportQuality.value = 92;
  qualityValue.textContent = '92';
  exportResolution.value = '1';
  aspectLocked = true;
  exportLinkDims.classList.add('active');
  exportLinkDims.setAttribute('aria-pressed', 'true');
  customDimsField.style.display = 'none';
  exportWarningField.style.display = 'none';

  const visibleRadio = document.querySelector('input[name="export-layers"][value="visible"]');
  if (visibleRadio) visibleRadio.checked = true;

  updateQualityVisibility();
  updateDimsInfo();
  exportOverlay.classList.add('visible');
  exportFilename.select();
  exportFocusTrap = trapFocus(document.getElementById('export-dialog'));
  announce('Export dialog opened');
}

export function closeExportDialog() {
  exportOverlay.classList.remove('visible');
  sizeEstimateField.style.display = 'none';
  exportWarningField.style.display = 'none';
  exportDimsInfo.style.display = 'none';
  if (exportFocusTrap) { exportFocusTrap(); exportFocusTrap = null; }
  saveBtn.focus();
  announce('Export dialog closed');
}

exportFormat.addEventListener('change', updateQualityVisibility);

exportQuality.addEventListener('input', () => {
  qualityValue.textContent = exportQuality.value;
  updateSizeEstimate();
});

exportResolution.addEventListener('change', () => {
  if (exportResolution.value === 'custom') {
    const src = getSourceDimensions();
    if (src) {
      exportWidth.value = src.w;
      exportHeight.value = src.h;
    }
  }
  updateCustomDimsVisibility();
});

let updatingDims = false;
exportWidth.addEventListener('input', () => {
  if (updatingDims) return;
  updatingDims = true;
  if (aspectLocked) {
    const w = parseInt(exportWidth.value, 10);
    if (w > 0) exportHeight.value = Math.round(w / sourceAspect);
  }
  updatingDims = false;
  updateDimsInfo();
  updateSizeEstimate();
});

exportHeight.addEventListener('input', () => {
  if (updatingDims) return;
  updatingDims = true;
  if (aspectLocked) {
    const h = parseInt(exportHeight.value, 10);
    if (h > 0) exportWidth.value = Math.round(h * sourceAspect);
  }
  updatingDims = false;
  updateDimsInfo();
  updateSizeEstimate();
});

exportLinkDims.addEventListener('click', () => {
  aspectLocked = !aspectLocked;
  exportLinkDims.classList.toggle('active', aspectLocked);
  exportLinkDims.setAttribute('aria-pressed', String(aspectLocked));
});

document.querySelectorAll('input[name="export-layers"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    updateDimsInfo();
    updateSizeEstimate();
  });
});

exportCancelBtn.addEventListener('click', closeExportDialog);

exportOverlay.addEventListener('click', (e) => {
  if (e.target === exportOverlay) closeExportDialog();
});

exportDownloadBtn.addEventListener('click', () => {
  const hasContent = state.layers.length > 0 || !!state.currentImg;
  if (!hasContent) return;

  const format = exportFormat.value;
  const cfg = FORMAT_CONFIG[format];
  if (!cfg) return;

  const dims = getExportDimensions();
  if (dims && (dims.w > MAX_EXPORT_DIM || dims.h > MAX_EXPORT_DIM)) {
    const proceed = confirm(`Export dimensions (${dims.w}×${dims.h}) exceed ${MAX_EXPORT_DIM}px. This may be slow or fail. Continue?`);
    if (!proceed) return;
  }

  const quality = cfg.hasQuality ? Number(exportQuality.value) / 100 : undefined;
  const ext = cfg.ext;
  const filename = (exportFilename.value.trim() || getDefaultFilename()) + '.' + ext;

  const offscreen = buildExportCanvas();
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
