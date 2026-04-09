// ─────────────────────────────────────────────────────────────
//  SPM Pro  —  Background Service Worker
// ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── Download a single media file ─────────────────────────
  if (msg.type === 'DOWNLOAD_MEDIA') {
    const { url, filename } = msg;
    chrome.downloads.download({ url, filename, saveAs: false }, (id) => {
      if (chrome.runtime.lastError) sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      else sendResponse({ ok: true, id });
    });
    return true;
  }

  // ── Bulk download queue ──────────────────────────────────
  if (msg.type === 'BULK_DOWNLOAD') {
    const { urls, prefix } = msg;
    let done = 0;
    urls.forEach((url, i) => {
      const ext  = /\.mp4|video/i.test(url) ? 'mp4' : 'jpg';
      const name = `${prefix}_${String(i + 1).padStart(3, '0')}.${ext}`;
      setTimeout(() => {
        chrome.downloads.download({ url, filename: name, saveAs: false });
        done++;
        if (done === urls.length) sendResponse({ ok: true, count: done });
      }, i * 400); // stagger downloads
    });
    return true;
  }

  // ── Send desktop notification ────────────────────────────
  if (msg.type === 'NOTIFY') {
    chrome.notifications.create(`spm-${Date.now()}`, {
      type:    'basic',
      iconUrl: 'icons/icon128.png',
      title:   msg.title  || 'Social Post Monitor',
      message: msg.body   || '',
      priority: 1,
    });
    sendResponse({ ok: true });
    return true;
  }

  // ── Storage: get all saved history ──────────────────────
  if (msg.type === 'GET_HISTORY') {
    chrome.storage.local.get(['spm_history'], (r) => {
      sendResponse({ history: r.spm_history || [] });
    });
    return true;
  }

  // ── Storage: append a history snapshot ──────────────────
  if (msg.type === 'PUSH_HISTORY') {
    chrome.storage.local.get(['spm_history'], (r) => {
      const arr = r.spm_history || [];
      arr.push({ ...msg.data, ts: Date.now() });
      // keep last 200 entries
      const trimmed = arr.slice(-200);
      chrome.storage.local.set({ spm_history: trimmed }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  // ── Storage: clear history ───────────────────────────────
  if (msg.type === 'CLEAR_HISTORY') {
    chrome.storage.local.remove('spm_history', () => sendResponse({ ok: true }));
    return true;
  }

  // ── Storage: get/set settings ───────────────────────────
  if (msg.type === 'GET_SETTINGS') {
    chrome.storage.local.get(['spm_settings'], (r) => {
      sendResponse({ settings: r.spm_settings || {} });
    });
    return true;
  }

  if (msg.type === 'SAVE_SETTINGS') {
    chrome.storage.local.set({ spm_settings: msg.settings }, () => sendResponse({ ok: true }));
    return true;
  }
});
