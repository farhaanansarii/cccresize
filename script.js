'use strict';

/* =========================================================
   CCC Photo Resizer — script.js
   Pure client-side image resizing, compression, DPI tagging
   and ZIP packaging. No server, no frameworks.
   ========================================================= */

/* ---------- Configuration for each upload slot ---------- */
const SLOT_CONFIG = {
  photo: {
    width: 132, height: 170, maxKB: 45, dpi: 300,
    fileName: 'Photo.jpg', required: true, whiteBg: false
  },
  signature: {
    width: 170, height: 132, maxKB: 20, dpi: 200,
    fileName: 'Signature.jpg', required: true, whiteBg: true
  },
  thumb: {
    width: 170, height: 132, maxKB: 20, dpi: 200,
    fileName: 'Thumb.jpg', required: false, whiteBg: false
  }
};

/* Holds processed result per slot: { blob, dataUrl, width, height, sizeKB, ok } */
const state = {
  photo: null,
  signature: null,
  thumb: null
};

/* ---------------------------------------------------------
   THEME TOGGLE
   --------------------------------------------------------- */
const themeToggle = document.getElementById('themeToggle');
const iconSun = document.getElementById('iconSun');
const iconMoon = document.getElementById('iconMoon');
const themeLabel = document.getElementById('themeLabel');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const isDark = theme === 'dark';
  iconSun.style.display = isDark ? 'none' : 'inline';
  iconMoon.style.display = isDark ? 'inline' : 'none';
  themeLabel.textContent = isDark ? 'Light Mode' : 'Dark Mode';
}

// Light mode is default; no persistence needed across sessions per "browser based only" simplicity,
// but we still remember it for this tab session via a JS variable.
let currentTheme = 'light';
applyTheme(currentTheme);

themeToggle.addEventListener('click', () => {
  currentTheme = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(currentTheme);
});

/* ---------------------------------------------------------
   UPLOAD CARD WIRING
   --------------------------------------------------------- */
document.querySelectorAll('.upload-card').forEach(card => {
  const slot = card.dataset.slot;
  const dropzone = card.querySelector('.dropzone');
  const fileInput = card.querySelector('.file-input');
  const dzEmpty = card.querySelector('.dz-empty');
  const dzPreview = card.querySelector('.dz-preview');
  const previewImg = dzPreview.querySelector('img');
  const removeBtn = card.querySelector('.remove-btn');
  const progressTrack = card.querySelector('.progress-track');
  const progressFill = card.querySelector('.progress-fill');
  const resultBox = card.querySelector('.result-box');

  const openPicker = () => fileInput.click();

  dropzone.addEventListener('click', () => {
    if (dzPreview.hidden === false) return; // don't reopen picker if already has image; use remove first
    openPicker();
  });
  dropzone.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && dzPreview.hidden) {
      e.preventDefault();
      openPicker();
    }
  });

  // Drag & drop
  ['dragenter', 'dragover'].forEach(evt =>
    dropzone.addEventListener(evt, e => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach(evt =>
    dropzone.addEventListener(evt, e => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    })
  );
  dropzone.addEventListener('drop', e => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) handleFile(slot, file, card);
  });

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleFile(slot, file, card);
    fileInput.value = ''; // allow re-selecting same file later
  });

  removeBtn.addEventListener('click', e => {
    e.stopPropagation();
    resetSlot(slot, card);
  });
});

/* ---------------------------------------------------------
   FILE HANDLING — validate, resize, compress, preview
   --------------------------------------------------------- */
function handleFile(slot, file, card) {
  const validTypes = ['image/jpeg', 'image/png', 'image/jpg'];
  if (!validTypes.includes(file.type)) {
    showSlotError(card, 'Unsupported file type. Please upload JPG or PNG.');
    return;
  }

  const config = SLOT_CONFIG[slot];
  const progressTrack = card.querySelector('.progress-track');
  const progressFill = card.querySelector('.progress-fill');
  const resultBox = card.querySelector('.result-box');

  progressTrack.hidden = false;
  progressFill.style.width = '15%';
  resultBox.hidden = true;

  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      progressFill.style.width = '45%';
      // Slight delay so the progress bar is visible (also avoids blocking UI thread feel)
      setTimeout(() => {
        try {
          const result = processImage(img, config);
          progressFill.style.width = '100%';
          state[slot] = result;
          renderPreview(card, result);
          renderResult(card, result);
          setTimeout(() => { progressTrack.hidden = true; progressFill.style.width = '0%'; }, 500);
        } catch (err) {
          console.error(err);
          showSlotError(card, 'Could not process this image.');
          progressTrack.hidden = true;
        }
      }, 120);
    };
    img.onerror = () => showSlotError(card, 'Could not read this image file.');
    img.src = ev.target.result;
  };
  reader.onerror = () => showSlotError(card, 'Could not read this file.');
  reader.readAsDataURL(file);
}

/**
 * Resizes the source image onto a canvas at exact target dimensions,
 * then iteratively compresses JPEG quality until under maxKB,
 * and finally injects the requested DPI into the JPEG header.
 */
function processImage(img, config) {
  const { width, height, maxKB, dpi, whiteBg } = config;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // White background fill for signature (per spec); other slots keep original background
  // by simply drawing the image to fill the canvas (background unchanged = whatever was captured).
  if (whiteBg) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Draw image stretched exactly to target box (exact pixel dimensions requirement)
  ctx.drawImage(img, 0, 0, width, height);

  // Iteratively reduce quality to hit the max KB target while preserving quality as much as possible
  let quality = 0.92;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  let sizeKB = dataUrlSizeKB(dataUrl);
  let attempts = 0;

  while (sizeKB > maxKB && quality > 0.05 && attempts < 25) {
    quality -= quality > 0.3 ? 0.07 : 0.03;
    dataUrl = canvas.toDataURL('image/jpeg', Math.max(quality, 0.05));
    sizeKB = dataUrlSizeKB(dataUrl);
    attempts++;
  }

  // If still over budget, progressively downscale-then-upscale-redraw isn't allowed
  // (exact pixel dims required), so we report a soft failure if target unreachable.
  const ok = sizeKB <= maxKB;

  // Convert dataUrl -> binary -> inject DPI into JFIF header -> rebuild blob/dataUrl
  let bytes = dataUrlToBytes(dataUrl);
  bytes = setJpegDpi(bytes, dpi);
  const finalBlob = new Blob([bytes], { type: 'image/jpeg' });
  const finalDataUrl = bytesToDataUrl(bytes);
  const finalSizeKB = bytes.length / 1024;

  return {
    blob: finalBlob,
    dataUrl: finalDataUrl,
    width, height,
    sizeKB: finalSizeKB,
    maxKB,
    ok: finalSizeKB <= maxKB
  };
}

function dataUrlSizeKB(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  // Approximate decoded byte size from base64 length
  const padding = (base64.match(/=+$/) || [''])[0].length;
  const bytes = (base64.length * 3) / 4 - padding;
  return bytes / 1024;
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToDataUrl(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return 'data:image/jpeg;base64,' + btoa(binary);
}

/**
 * Injects/overwrites the DPI (density) values inside a JPEG's JFIF (APP0) header.
 * Canvas-exported JPEGs default to 96/72 DPI with no real metadata, so we patch
 * the standard JFIF APP0 segment bytes directly (units=1 -> dots per inch).
 */
function setJpegDpi(bytes, dpi) {
  // JFIF APP0 marker: FF D8 FF E0 ... "JFIF\0" version(2) units(1) xdensity(2) ydensity(2) ...
  // Standard canvas output: FF D8 FF E0 00 10 4A 46 49 46 00 01 01 00 00 01 00 01 00 00
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return bytes; // not a valid JPEG, return unchanged

  // Check for APP0 JFIF segment right after SOI
  if (bytes[2] === 0xFF && bytes[3] === 0xE0) {
    const out = bytes.slice(); // copy so we don't mutate caller's buffer unexpectedly
    // Offsets within APP0 payload (after the 4-byte marker+length header at index 4):
    // index 4-5: length, 6-10: "JFIF\0", 11: majorVer, 12: minorVer, 13: units, 14-15: xDensity, 16-17: yDensity
    out[13] = 0x01; // units = 1 (dots per inch)
    out[14] = (dpi >> 8) & 0xFF;
    out[15] = dpi & 0xFF;
    out[16] = (dpi >> 8) & 0xFF;
    out[17] = dpi & 0xFF;
    return out;
  }
  return bytes; // fallback: leave as-is if structure unexpected
}

/* ---------------------------------------------------------
   UI RENDERING HELPERS
   --------------------------------------------------------- */
function renderPreview(card, result) {
  const dzEmpty = card.querySelector('.dz-empty');
  const dzPreview = card.querySelector('.dz-preview');
  const img = dzPreview.querySelector('img');
  img.src = result.dataUrl;
  dzEmpty.hidden = true;
  dzPreview.hidden = false;
}

function renderResult(card, result) {
  const resultBox = card.querySelector('.result-box');
  const rPixels = card.querySelector('.r-pixels');
  const rSize = card.querySelector('.r-size');
  const rStatus = card.querySelector('.r-status');

  rPixels.textContent = `${result.width} × ${result.height} px`;
  rSize.textContent = `${result.sizeKB.toFixed(1)} KB (limit ${result.maxKB} KB)`;

  if (result.ok) {
    rStatus.innerHTML = `<span class="status-success"><span class="check-pop"></span> Ready</span>`;
    rStatus.classList.add('ok');
    rStatus.classList.remove('fail');
  } else {
    rStatus.innerHTML = `<span class="status-error">⚠ Could not reach target size</span>`;
    rStatus.classList.add('fail');
    rStatus.classList.remove('ok');
  }
  resultBox.hidden = false;
}

function showSlotError(card, message) {
  const resultBox = card.querySelector('.result-box');
  const rStatus = card.querySelector('.r-status');
  const rPixels = card.querySelector('.r-pixels');
  const rSize = card.querySelector('.r-size');
  rPixels.textContent = '—';
  rSize.textContent = '—';
  rStatus.innerHTML = `<span class="status-error">⚠ ${message}</span>`;
  resultBox.hidden = false;
}

function resetSlot(slot, card) {
  state[slot] = null;
  const dzEmpty = card.querySelector('.dz-empty');
  const dzPreview = card.querySelector('.dz-preview');
  const resultBox = card.querySelector('.result-box');
  const progressTrack = card.querySelector('.progress-track');
  dzEmpty.hidden = false;
  dzPreview.hidden = true;
  resultBox.hidden = true;
  progressTrack.hidden = true;
}

/* ---------------------------------------------------------
   RESET ALL
   --------------------------------------------------------- */
document.getElementById('resetBtn').addEventListener('click', () => {
  document.getElementById('applicantName').value = '';
  document.querySelectorAll('.upload-card').forEach(card => {
    resetSlot(card.dataset.slot, card);
  });
  hideOverallMsg();
});

/* ---------------------------------------------------------
   RESIZE & DOWNLOAD ZIP
   --------------------------------------------------------- */
const resizeBtn = document.getElementById('resizeBtn');
resizeBtn.addEventListener('click', async () => {
  hideOverallMsg();

  const nameInput = document.getElementById('applicantName');
  const rawName = nameInput.value.trim();

  if (!rawName) {
    showOverallMsg('Please enter the applicant name before creating the ZIP.', 'error');
    nameInput.focus();
    return;
  }
  if (!state.photo) {
    showOverallMsg('Passport photo is required.', 'error');
    return;
  }
  if (!state.signature) {
    showOverallMsg('Signature is required.', 'error');
    return;
  }

  const sanitizedName = rawName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_');
  if (!sanitizedName) {
    showOverallMsg('Applicant name contains no valid characters.', 'error');
    return;
  }

  showLoading('Preparing your ZIP file…');
  resizeBtn.disabled = true;

  try {
    // Small delay so the loading animation is perceptible (and to keep UI responsive)
    await wait(400);

    const zip = new JSZip();
    const folder = zip.folder(sanitizedName);

    folder.file(SLOT_CONFIG.photo.fileName, state.photo.blob);
    folder.file(SLOT_CONFIG.signature.fileName, state.signature.blob);
    if (state.thumb) {
      folder.file(SLOT_CONFIG.thumb.fileName, state.thumb.blob);
    }

    setLoadingText('Compressing ZIP archive…');
    const content = await zip.generateAsync({ type: 'blob' });

    setLoadingText('Finalizing download…');
    await wait(250);

    const zipName = `${sanitizedName}_CCC.zip`;
    downloadBlob(content, zipName);

    showOverallMsg(`Success! "${zipName}" has been downloaded.`, 'success');
  } catch (err) {
    console.error(err);
    showOverallMsg('Something went wrong while creating the ZIP. Please try again.', 'error');
  } finally {
    hideLoading();
    resizeBtn.disabled = false;
  }
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ---------------------------------------------------------
   LOADING OVERLAY
   --------------------------------------------------------- */
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');

function showLoading(text) {
  loadingText.textContent = text || 'Processing images…';
  loadingOverlay.hidden = false;
}
function setLoadingText(text) {
  loadingText.textContent = text;
}
function hideLoading() {
  loadingOverlay.hidden = true;
}

/* ---------------------------------------------------------
   OVERALL MESSAGE BANNER
   --------------------------------------------------------- */
const overallMsg = document.getElementById('overallMsg');
function showOverallMsg(text, type) {
  overallMsg.textContent = text;
  overallMsg.className = `overall-msg ${type}`;
  overallMsg.hidden = false;
}
function hideOverallMsg() {
  overallMsg.hidden = true;
  overallMsg.textContent = '';
  overallMsg.className = 'overall-msg';
}
