// Background Service Worker
// Handles download requests from content scripts

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "DOWNLOAD_MEDIA") {
    const { url, filename } = message;
    chrome.downloads.download(
      { url, filename, saveAs: false },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId });
        }
      }
    );
    return true; // keep channel open for async response
  }

  if (message.type === "GET_STATS") {
    chrome.storage.local.get(["stats"], (result) => {
      sendResponse({ stats: result.stats || [] });
    });
    return true;
  }

  if (message.type === "SAVE_STATS") {
    chrome.storage.local.get(["stats"], (result) => {
      const stats = result.stats || [];
      const existing = stats.findIndex((s) => s.url === message.data.url);
      if (existing >= 0) {
        stats[existing] = { ...stats[existing], ...message.data, updatedAt: Date.now() };
      } else {
        stats.push({ ...message.data, savedAt: Date.now(), updatedAt: Date.now() });
      }
      // keep only last 50 entries
      const trimmed = stats.slice(-50);
      chrome.storage.local.set({ stats: trimmed }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }
});
