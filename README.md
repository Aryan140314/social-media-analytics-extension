# 📊 Social Post Monitor — Chrome Extension (v1)

Monitor Facebook & Instagram posts: track likes, comments, shares, reach, download media, and quick-share posts.

---

## Features

| Feature | Facebook | Instagram |
|---------|----------|-----------|
| ❤️ Likes / Reactions | ✅ | ✅ |
| 💬 Comments Count | ✅ | ✅ |
| 🔁 Shares Count | ✅ | ⚠️ Not shown by IG |
| 👁️ Reach / Views | ✅ Own posts only | ✅ Reels/Videos |
| ⬇️ Download Media | ✅ Images & Videos | ✅ Images & Videos |
| ↗️ Quick Share | ✅ | ✅ |

---

## Installation (Chrome / Edge)

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer Mode** (toggle in top-right)
3. Click **"Load unpacked"**
4. Select this folder (`social-monitor-extension/`)
5. The extension is now installed!

---

## How to Use

1. Go to **Facebook** or **Instagram**
2. Open any post page
3. Click the **📊 button** in the bottom-right corner of the page
4. The panel shows stats automatically
5. Use the buttons:
   - 🔄 **Refresh Stats** — re-scan the page
   - ⬇️ **Download Post** — download image/video
   - ↗️ **Quick Share** — open the native share dialog

### Popup (Extension Icon)
Click the extension icon in the toolbar to see your **history** of monitored posts.

---

## Limitations

- **Reach data** is only visible on **your own posts** (via Facebook/Instagram Insights)
- **"Who shared to whom"** is private — neither Facebook nor Instagram expose this to anyone
- Facebook/Instagram update their DOM frequently — selectors may need updates over time
- Downloading media from other users' posts should only be done for personal, non-commercial use

---

## Files

```
social-monitor-extension/
├── manifest.json         — Extension config (Manifest V3)
├── background.js         — Service worker (handles downloads & storage)
├── content/
│   ├── injector.js       — Injected into FB/IG pages (scraper + panel)
│   └── panel.css         — Styles for the floating panel
├── popup/
│   ├── popup.html        — Extension popup UI
│   └── popup.js          — Popup logic
└── icons/
    └── icon.svg          — Extension icon
```
