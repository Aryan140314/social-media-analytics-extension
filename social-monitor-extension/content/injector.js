// ============================================================
//  Social Post Monitor — Content Script Injector
//  Works on both Facebook and Instagram
// ============================================================

(function () {
  "use strict";

  const IS_FACEBOOK = location.hostname.includes("facebook.com");
  const IS_INSTAGRAM = location.hostname.includes("instagram.com");

  let panelInjected = false;
  let currentPostData = {};

  // ── Utility ──────────────────────────────────────────────
  function qs(selector, root = document) {
    return root.querySelector(selector);
  }
  function qsa(selector, root = document) {
    return [...root.querySelectorAll(selector)];
  }
  function firstText(...selectors) {
    for (const sel of selectors) {
      const el = qs(sel);
      if (el && el.innerText.trim()) return el.innerText.trim();
    }
    return null;
  }

  // ── Panel HTML ────────────────────────────────────────────
  function createPanel() {
    const div = document.createElement("div");
    div.id = "spm-panel";
    div.innerHTML = `
      <div id="spm-header">
        <span id="spm-logo">📊 Post Monitor</span>
        <span id="spm-platform-badge">${IS_FACEBOOK ? "Facebook" : "Instagram"}</span>
        <button id="spm-close">✕</button>
      </div>
      <div id="spm-body">
        <div class="spm-stats-grid">
          <div class="spm-stat-card" id="spm-likes-card">
            <div class="spm-stat-icon">❤️</div>
            <div class="spm-stat-value" id="spm-likes">—</div>
            <div class="spm-stat-label">Likes / Reactions</div>
          </div>
          <div class="spm-stat-card" id="spm-comments-card">
            <div class="spm-stat-icon">💬</div>
            <div class="spm-stat-value" id="spm-comments">—</div>
            <div class="spm-stat-label">Comments</div>
          </div>
          <div class="spm-stat-card" id="spm-shares-card">
            <div class="spm-stat-icon">🔁</div>
            <div class="spm-stat-value" id="spm-shares">—</div>
            <div class="spm-stat-label">Shares</div>
          </div>
          <div class="spm-stat-card" id="spm-reach-card">
            <div class="spm-stat-icon">👁️</div>
            <div class="spm-stat-value" id="spm-reach">—</div>
            <div class="spm-stat-label">Reach / Views</div>
          </div>
        </div>

        <div id="spm-actions">
          <button class="spm-btn spm-btn-download" id="spm-download-btn">
            ⬇️ Download Post
          </button>
          <button class="spm-btn spm-btn-share" id="spm-share-btn">
            ↗️ Quick Share
          </button>
          <button class="spm-btn spm-btn-refresh" id="spm-refresh-btn">
            🔄 Refresh Stats
          </button>
        </div>

        <div id="spm-media-list"></div>
        <div id="spm-status"></div>
        <div id="spm-insight-note"></div>
      </div>
      <div id="spm-footer">
        Last updated: <span id="spm-last-updated">—</span>
      </div>
    `;
    document.body.appendChild(div);
    makeDraggable(div);

    qs("#spm-close").onclick = () => { div.style.display = "none"; };
    qs("#spm-refresh-btn").onclick = () => refreshStats();
    qs("#spm-download-btn").onclick = () => handleDownload();
    qs("#spm-share-btn").onclick = () => handleShare();

    // Toggle button in page corner
    const toggleBtn = document.createElement("button");
    toggleBtn.id = "spm-toggle";
    toggleBtn.innerText = "📊";
    toggleBtn.title = "Social Post Monitor";
    toggleBtn.onclick = () => {
      div.style.display = div.style.display === "none" ? "flex" : "none";
      refreshStats();
    };
    document.body.appendChild(toggleBtn);
  }

  // ── Draggable Panel ───────────────────────────────────────
  function makeDraggable(el) {
    const header = qs("#spm-header", el);
    let isDragging = false, startX, startY, origX, origY;
    header.addEventListener("mousedown", (e) => {
      if (e.target.id === "spm-close") return;
      isDragging = true;
      startX = e.clientX; startY = e.clientY;
      origX = el.offsetLeft; origY = el.offsetTop;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", () => { isDragging = false; document.removeEventListener("mousemove", onMove); }, { once: true });
    });
    function onMove(e) {
      if (!isDragging) return;
      el.style.left = (origX + e.clientX - startX) + "px";
      el.style.top  = (origY + e.clientY - startY) + "px";
      el.style.right = "auto";
    }
  }

  // ── Status helper ─────────────────────────────────────────
  function setStatus(msg, type = "info") {
    const el = qs("#spm-status");
    if (!el) return;
    el.textContent = msg;
    el.className = "spm-status-" + type;
    if (type !== "error") setTimeout(() => { el.textContent = ""; }, 3000);
  }

  // ── Facebook Scrapers ─────────────────────────────────────
  function scrapeFacebook() {
    const data = { platform: "facebook", url: location.href };

    // ── Likes / Reactions ──
    const likeSelectors = [
      'span[aria-label*="reaction"]',
      'span[aria-label*="people reacted"]',
      '[data-testid="UFI2ReactionsCount/root"]',
      'span.x1e558r4',
    ];
    for (const sel of likeSelectors) {
      const els = qsa(sel);
      for (const el of els) {
        const t = el.innerText?.trim();
        if (t && /[\d,KkMm]/.test(t)) { data.likes = t; break; }
      }
      if (data.likes) break;
    }
    if (!data.likes) {
      // Try aria-labels with numbers
      qsa('[aria-label]').forEach(el => {
        const lbl = el.getAttribute('aria-label') || '';
        if (/\d/.test(lbl) && /react/i.test(lbl) && !data.likes) {
          data.likes = lbl.match(/[\d,]+/)?.[0] || null;
        }
      });
    }

    // ── Comments ──
    const commentSelectors = [
      'span[aria-label*="comment"]',
      '[data-testid="UFI2CommentsCount/root"]',
    ];
    for (const sel of commentSelectors) {
      const els = qsa(sel);
      for (const el of els) {
        const t = el.innerText?.trim();
        if (t && /[\d,KkMm]/.test(t)) { data.comments = t; break; }
      }
      if (data.comments) break;
    }
    if (!data.comments) {
      qsa('[aria-label]').forEach(el => {
        const lbl = el.getAttribute('aria-label') || '';
        if (/\d/.test(lbl) && /comment/i.test(lbl) && !data.comments) {
          data.comments = lbl.match(/[\d,]+/)?.[0] || null;
        }
      });
    }

    // ── Shares ──
    qsa('[aria-label]').forEach(el => {
      const lbl = el.getAttribute('aria-label') || '';
      if (/\d/.test(lbl) && /share/i.test(lbl) && !data.shares) {
        data.shares = lbl.match(/[\d,]+/)?.[0] || null;
      }
    });
    // Try text nodes containing "shares"
    if (!data.shares) {
      qsa('span, div').forEach(el => {
        const t = (el.innerText || '').trim();
        if (/^\d[\d,KkMm]*\s*share/i.test(t) && !data.shares) data.shares = t;
      });
    }

    // ── Reach / Views (own post insights) ──
    qsa('span, div').forEach(el => {
      const t = (el.innerText || '').trim();
      if (/(reach|people reached|views)/i.test(t) && /\d/.test(t) && !data.reach) {
        data.reach = t.match(/[\d,KkMm]+/)?.[0] || null;
      }
    });

    // ── Media URLs ──
    data.mediaUrls = extractFacebookMedia();
    return data;
  }

  function extractFacebookMedia() {
    const urls = new Set();
    // Images
    qsa('img[src*="fbcdn"]').forEach(img => {
      const src = img.src;
      if (src && src.includes("fbcdn") && (img.naturalWidth > 200 || img.width > 200)) {
        urls.add(src);
      }
    });
    // Videos
    qsa('video source, video[src]').forEach(v => {
      const s = v.src || v.getAttribute('src');
      if (s) urls.add(s);
    });
    // OG image as fallback
    const ogImg = qs('meta[property="og:image"]');
    if (ogImg) urls.add(ogImg.content);
    return [...urls].slice(0, 5);
  }

  // ── Instagram Scrapers ────────────────────────────────────
  function scrapeInstagram() {
    const data = { platform: "instagram", url: location.href };

    // ── Likes ──────────────────────────────────────────────
    // Strategy 1: "Liked by X and N others" → parse N+1
    const allSpans = qsa('span, a');
    for (const el of allSpans) {
      const t = (el.innerText || '').trim();
      // e.g. "Liked by innocence_unrevealed and 58 others"
      const othersMatch = t.match(/[Ll]iked by .+ and ([\d,]+) others?/);
      if (othersMatch) {
        const n = parseInt(othersMatch[1].replace(/,/g, ''), 10) + 1;
        data.likes = String(n);
        break;
      }
      // e.g. "Liked by 1,234 people" or just a standalone like count link
      const likedByNum = t.match(/^[Ll]iked by ([\d,]+) people/);
      if (likedByNum) { data.likes = likedByNum[1]; break; }
    }

    // Strategy 2: direct number inside the likes section (e.g. "59 likes")
    if (!data.likes) {
      for (const el of allSpans) {
        const t = (el.innerText || '').trim();
        const likesLabel = t.match(/^([\d,]+)\s+likes?$/i);
        if (likesLabel) { data.likes = likesLabel[1]; break; }
      }
    }

    // Strategy 3: aria-label on the heart button area
    if (!data.likes) {
      qsa('[aria-label]').forEach(el => {
        const lbl = el.getAttribute('aria-label') || '';
        // e.g. "59 likes" or "Like: 59"
        if (/like/i.test(lbl) && /\d/.test(lbl) && !data.likes) {
          data.likes = lbl.match(/[\d,]+/)?.[0] || null;
        }
      });
    }

    // ── Comments ───────────────────────────────────────────
    // Strategy 1: "View all N comments" text (appears when many comments exist)
    for (const el of allSpans) {
      const t = (el.innerText || '').trim();
      const viewAll = t.match(/[Vv]iew all ([\d,]+) comments?/);
      if (viewAll) { data.comments = viewAll[1]; break; }
      const commLabel = t.match(/^([\d,]+)\s+comments?$/i);
      if (commLabel) { data.comments = commLabel[1]; break; }
    }

    // Strategy 2: Count visible comment <li> rows in the dialog
    // Instagram renders each comment as an <li>. We count rows that:
    //   • have a nested <a> (username link) AND
    //   • are NOT the caption row (caption is the first <li> in the list)
    if (!data.comments) {
      const allLis = qsa(
        'div[role="dialog"] ul > li, article ul > li'
      );
      // Skip the first <li> which is usually the caption
      const commentLis = allLis.slice(1).filter(li => {
        const text = (li.innerText || '').trim();
        // Must have some text and not be a "Load more" / "View replies" control
        return text.length > 1 && !/^[Vv]iew\s+(all|replies)/i.test(text);
      });
      if (commentLis.length > 0) {
        data.comments = `${commentLis.length} (visible)`;
      }
    }

    // Strategy 3: Look for "Reply" links — each reply link = one comment row
    if (!data.comments) {
      const replyLinks = qsa('button, span').filter(el =>
        (el.innerText || '').trim() === 'Reply'
      );
      if (replyLinks.length > 0) {
        data.comments = `${replyLinks.length} (visible)`;
      }
    }

    // ── Reach / Views (Reels & Videos only) ────────────────
    // Check if there's a video element — if not, it's a photo post
    const hasVideo = qsa('video').length > 0;
    if (!hasVideo) {
      // Photo post — Instagram never shows view count for photos
      data.reach = "N/A (Photo)";
      data.reachIsNA = true;
    } else {
      // Video/Reel — look for "123K views" or "1,234 plays" text
      for (const el of qsa('span, div')) {
        const t = (el.innerText || '').trim();
        const viewsMatch = t.match(/^([\d,.]+[KkMmBb]?)\s*(views?|plays?)$/i);
        if (viewsMatch) { data.reach = viewsMatch[1]; break; }
      }
      // Sibling pattern: <span>123K</span><span>views</span>
      if (!data.reach) {
        qsa('span').forEach(el => {
          const t = (el.innerText || '').trim();
          const next = el.nextElementSibling?.innerText?.trim() || '';
          if (/^[\d,.]+[KkMm]?$/.test(t) && /views?/i.test(next) && !data.reach) {
            data.reach = t;
          }
        });
      }
      if (!data.reach) data.reach = "—";
    }

    // ── Media URLs ──
    data.mediaUrls = extractInstagramMedia();
    return data;
  }

  function extractInstagramMedia() {
    const urls = new Set();
    // Main post image
    qsa('article img[src*="cdninstagram"], article img[src*="fbcdn"]').forEach(img => {
      if (img.naturalWidth > 200 || img.width > 200) urls.add(img.src);
    });
    // Video
    qsa('video source[src], video[src]').forEach(v => {
      const s = v.src || v.getAttribute('src');
      if (s) urls.add(s);
    });
    // OG fallback
    const ogImg = qs('meta[property="og:image"]');
    if (ogImg) urls.add(ogImg.content);
    return [...urls].slice(0, 5);
  }

  // ── Update Panel UI ───────────────────────────────────────
  function updatePanel(data) {
    currentPostData = data;

    const set = (id, val, muted) => {
      const el = qs(`#spm-${id}`);
      if (!el) return;
      el.textContent = val || "—";
      el.style.fontSize = (val && val.length > 6) ? "12px" : "";
      el.style.color = muted ? "#aaa" : "";
    };

    set("likes", data.likes);
    set("comments", data.comments);
    set("shares", data.shares);
    set("reach", data.reach, data.reachIsNA);
    qs("#spm-last-updated").textContent = new Date().toLocaleTimeString();

    // Show insight note
    const note = qs("#spm-insight-note");
    if (data.reachIsNA) {
      note.textContent = "📷 Photo post — Instagram doesn't show view counts for photos. Views only appear on Reels & Videos.";
      note.style.display = "block";
    } else if (!data.reach || data.reach === "—") {
      note.textContent = "ℹ️ Reach is only visible on your own posts via Insights.";
      note.style.display = "block";
    } else {
      note.style.display = "none";
    }

    // Render media thumbnails
    const mediaList = qs("#spm-media-list");
    mediaList.innerHTML = "";
    if (data.mediaUrls && data.mediaUrls.length) {
      data.mediaUrls.forEach((url, i) => {
        const isVideo = /\.mp4|video/i.test(url);
        const item = document.createElement("div");
        item.className = "spm-media-item";
        item.innerHTML = isVideo
          ? `<div class="spm-media-thumb spm-video-thumb">🎬 Video ${i + 1}</div>`
          : `<img class="spm-media-thumb" src="${url}" alt="media ${i+1}" />`;
        item.addEventListener("click", () => downloadUrl(url, i));
        mediaList.appendChild(item);
      });
    }

    // Save to storage
    chrome.runtime.sendMessage({ type: "SAVE_STATS", data });
  }

  // ── Refresh Stats ─────────────────────────────────────────
  function refreshStats() {
    setStatus("Scanning post...", "info");
    const data = IS_FACEBOOK ? scrapeFacebook() : scrapeInstagram();
    updatePanel(data);
    setStatus("Stats updated ✓", "success");
  }

  // ── Download ──────────────────────────────────────────────
  function downloadUrl(url, index = 0) {
    if (!url) { setStatus("No media URL found.", "error"); return; }
    const ext = url.includes(".mp4") ? "mp4" : "jpg";
    const platform = IS_FACEBOOK ? "facebook" : "instagram";
    const filename = `${platform}_post_${Date.now()}_${index}.${ext}`;
    chrome.runtime.sendMessage(
      { type: "DOWNLOAD_MEDIA", url, filename },
      (res) => {
        if (res?.success) setStatus(`Downloading... (${filename})`, "success");
        else setStatus("Download failed: " + (res?.error || "unknown"), "error");
      }
    );
  }

  function handleDownload() {
    if (!currentPostData.mediaUrls?.length) {
      refreshStats();
      setTimeout(() => {
        if (currentPostData.mediaUrls?.length) {
          currentPostData.mediaUrls.forEach((url, i) => downloadUrl(url, i));
        } else {
          setStatus("No downloadable media found on this post.", "error");
        }
      }, 800);
    } else {
      currentPostData.mediaUrls.forEach((url, i) => downloadUrl(url, i));
    }
  }

  // ── Share ─────────────────────────────────────────────────
  function handleShare() {
    if (IS_FACEBOOK) {
      // Try clicking the native Share button
      const shareBtns = qsa('[aria-label*="Share"], [data-testid*="share"]');
      const btn = shareBtns.find(b => b.innerText?.toLowerCase().includes("share") || b.getAttribute("aria-label")?.toLowerCase().includes("share"));
      if (btn) {
        btn.click();
        setStatus("Share dialog opened ✓", "success");
      } else {
        // Fallback: use Web Share API or copy URL
        if (navigator.share) {
          navigator.share({ url: location.href, title: "Check this post" });
        } else {
          navigator.clipboard.writeText(location.href);
          setStatus("Post URL copied to clipboard!", "success");
        }
      }
    } else {
      // Instagram: find the share/send button
      const sendBtn = qsa('button, a').find(b =>
        b.getAttribute("aria-label")?.toLowerCase().includes("share") ||
        b.getAttribute("aria-label")?.toLowerCase().includes("send")
      );
      if (sendBtn) {
        sendBtn.click();
        setStatus("Share dialog opened ✓", "success");
      } else if (navigator.share) {
        navigator.share({ url: location.href, title: "Check this post" });
      } else {
        navigator.clipboard.writeText(location.href);
        setStatus("Post URL copied to clipboard!", "success");
      }
    }
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    if (panelInjected) return;
    panelInjected = true;
    createPanel();
    refreshStats();

    // Auto-refresh on URL change (SPA navigation)
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        panelInjected = false;
        setTimeout(() => {
          const existing = document.getElementById("spm-panel");
          if (!existing) {
            panelInjected = true;
            createPanel();
          }
          refreshStats();
        }, 1500);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Wait for page load
  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init);
  }
})();
