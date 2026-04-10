// ═══════════════════════════════════════════════════════════════
//  SPM Pro v3  ·  background.js  (Service Worker)
//  Handles downloads (with URL validation + queue),
//  notifications, and storage operations.
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── Trusted CDN hosts (security allowlist) ───────────────────────
const ALLOWED_HOSTS = [
  'fbcdn.net',
  'cdninstagram.com',
  'facebook.com',
  'instagram.com',
];

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.some(h => u.hostname.endsWith(h));
  } catch { return false; }
}

// ── Download queue (prevents browser rate-limit hammering) ──────
const _dlQueue   = [];
let   _dlRunning = false;
const DL_STAGGER = 450; // ms between downloads

function _enqueueDownload(url, filename) {
  return new Promise((resolve, reject) => {
    _dlQueue.push({ url, filename, resolve, reject });
    _processQueue();
  });
}

function _processQueue() {
  if (_dlRunning || _dlQueue.length === 0) return;
  _dlRunning = true;
  const { url, filename, resolve, reject } = _dlQueue.shift();

  chrome.downloads.download({ url, filename, saveAs: false }, (id) => {
    if (chrome.runtime.lastError) {
      console.error('[SPM BG] Download error:', chrome.runtime.lastError.message);
      reject(new Error(chrome.runtime.lastError.message));
    } else {
      resolve({ ok: true, id });
    }
    setTimeout(() => {
      _dlRunning = false;
      _processQueue();
    }, DL_STAGGER);
  });
}

// ── Validate incoming messages (schema guard) ─────────────────────
function _validateMsg(msg, required = []) {
  if (!msg || typeof msg !== 'object') return false;
  if (!msg.type || typeof msg.type !== 'string') return false;
  return required.every(k => Object.prototype.hasOwnProperty.call(msg, k));
}

// ── Message handler ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // Single file download
  if (msg.type === 'DOWNLOAD_MEDIA') {
    if (!_validateMsg(msg, ['url', 'filename'])) {
      sendResponse({ ok: false, error: 'Invalid message schema' });
      return true;
    }
    if (!isAllowedUrl(msg.url)) {
      console.warn('[SPM BG] Blocked download from untrusted host:', msg.url);
      sendResponse({ ok: false, error: 'URL not from a trusted host' });
      return true;
    }
    _enqueueDownload(msg.url, msg.filename)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  // Bulk download (array of URLs)
  if (msg.type === 'BULK_DOWNLOAD') {
    if (!_validateMsg(msg, ['urls', 'prefix'])) {
      sendResponse({ ok: false, error: 'Invalid message schema' });
      return true;
    }
    const validUrls = (msg.urls || []).filter(u => {
      if (isAllowedUrl(u)) return true;
      console.warn('[SPM BG] Skipping untrusted URL in bulk:', u);
      return false;
    });

    if (!validUrls.length) {
      sendResponse({ ok: false, error: 'No valid URLs to download' });
      return true;
    }

    Promise.all(validUrls.map((url, i) => {
      const ext = /\.mp4|video/i.test(url) ? 'mp4' : 'jpg';
      const fn  = `${msg.prefix}_${String(i + 1).padStart(3, '0')}.${ext}`;
      return _enqueueDownload(url, fn).catch(err => {
        console.error('[SPM BG] Bulk item failed:', fn, err.message);
        return null; // don't reject entire batch
      });
    })).then(results => {
      const ok = results.filter(Boolean).length;
      sendResponse({ ok: true, count: ok, total: validUrls.length });
    });
    return true;
  }

  // Desktop notification
  if (msg.type === 'NOTIFY') {
    if (!_validateMsg(msg, ['title', 'body'])) { sendResponse({ ok: false }); return true; }
    chrome.notifications.create(`spm-${Date.now()}`, {
      type:     'basic',
      iconUrl:  'icons/icon128.png',
      title:    String(msg.title).slice(0, 100),  // cap length
      message:  String(msg.body).slice(0, 300),
      priority: 1,
    }, () => sendResponse({ ok: !chrome.runtime.lastError }));
    return true;
  }

  // Storage: get history
  if (msg.type === 'GET_HISTORY') {
    chrome.storage.local.get(['spm_history'], r => {
      sendResponse({ history: r.spm_history || [] });
    });
    return true;
  }

  // Storage: push one history entry
  if (msg.type === 'PUSH_HISTORY') {
    if (!_validateMsg(msg, ['data'])) { sendResponse({ ok: false }); return true; }
    chrome.storage.local.get(['spm_history'], r => {
      const arr = r.spm_history || [];
      arr.push({ ...msg.data, ts: Date.now() });
      // Hard cap — no unbounded growth
      const trimmed = arr.slice(-200);
      chrome.storage.local.set({ spm_history: trimmed }, () =>
        sendResponse({ ok: !chrome.runtime.lastError })
      );
    });
    return true;
  }

  // Storage: clear history
  if (msg.type === 'CLEAR_HISTORY') {
    chrome.storage.local.remove('spm_history', () =>
      sendResponse({ ok: !chrome.runtime.lastError })
    );
    return true;
  }

  // Settings
  if (msg.type === 'GET_SETTINGS') {
    chrome.storage.local.get(['spm_settings'], r =>
      sendResponse({ settings: r.spm_settings || {} })
    );
    return true;
  }

  if (msg.type === 'SAVE_SETTINGS') {
    if (!_validateMsg(msg, ['settings'])) { sendResponse({ ok: false }); return true; }
    chrome.storage.local.set({ spm_settings: msg.settings }, () =>
      sendResponse({ ok: !chrome.runtime.lastError })
    );
    return true;
  }

  // Unknown message type — log and ignore
  console.warn('[SPM BG] Unknown message type:', msg.type);
  sendResponse({ ok: false, error: 'Unknown message type' });
  return false;
});

console.log('[SPM BG] Service worker v3 ready');
