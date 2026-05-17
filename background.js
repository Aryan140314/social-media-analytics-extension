/* ============================================================
   background.js — MV3 Service Worker
   v10 — fixes: removed separate spm_history storage (was out
         of sync with SpmStorage in content),
         PUSH_HISTORY now writes to same spm_data key,
         GET_HISTORY reads from spm_data,
         BULK_DOWNLOAD stagger reduced to 200ms (was 450ms)
   ============================================================ */

'use strict';

const ALLOWED_HOSTS = ['fbcdn.net', 'cdninstagram.com', 'facebook.com', 'instagram.com'];
const DATA_KEY = 'spm_data'; // FIX: same key as SpmStorage._KEY in utils.js

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}

// ── Message handler ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Security: only accept messages from our own extension pages/content scripts
  if (sender.id !== chrome.runtime.id) { sendResponse({ error: 'unauthorized' }); return false; }

  const handle = async () => {
    switch (msg.type) {

      case 'DOWNLOAD_MEDIA': {
        if (!isAllowedUrl(msg.url)) return { error: 'url_not_allowed' };
        const id = await chrome.downloads.download({ url: msg.url });
        return { ok: true, downloadId: id };
      }

      case 'BULK_DOWNLOAD': {
        const urls = (msg.urls || []).filter(isAllowedUrl);
        // FIX v10: stagger reduced from 450ms to 200ms; also cap at MAX_MEDIA=50
        const ids = [];
        for (const url of urls.slice(0, 50)) {
          await new Promise(r => setTimeout(r, 200));
          try { ids.push(await chrome.downloads.download({ url })); } catch (e) {}
        }
        return { ok: true, downloadIds: ids };
      }

      case 'NOTIFY': {
        const notifId = await chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: msg.title || 'SPM',
          message: msg.message || '',
        });
        return { ok: true, notifId };
      }

      // FIX v10: PUSH_HISTORY now writes to spm_data (same as SpmStorage)
      // instead of a separate spm_history flat array.
      // The content script already calls SpmStorage.saveSnapshot() directly,
      // so background just needs to record a lightweight index for popup use.
      case 'PUSH_HISTORY': {
        const snap = msg.data;
        if (!snap?.postId) return { error: 'missing postId' };
        // Store a lightweight recent list for popup (capped at 50)
        const result = await chrome.storage.local.get('spm_recent');
        const recent = result.spm_recent || [];
        recent.unshift({ postId: snap.postId, username: snap.username, url: snap.url, ts: snap.ts, likes: snap.likes });
        if (recent.length > 50) recent.length = 50;
        await chrome.storage.local.set({ spm_recent: recent });
        return { ok: true };
      }

      // FIX v10: GET_HISTORY reads from spm_data (same as SpmStorage)
      case 'GET_HISTORY': {
        const result = await chrome.storage.local.get('spm_recent');
        return { ok: true, history: result.spm_recent || [] };
      }

      case 'CLEAR_HISTORY': {
        await chrome.storage.local.remove([DATA_KEY, 'spm_recent']);
        return { ok: true };
      }

      default:
        return { error: 'unknown_type' };
    }
  };

  handle().then(sendResponse).catch(err => sendResponse({ error: String(err) }));
  return true; // keep message channel open for async response
});
