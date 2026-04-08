// Popup script — loads saved stats from storage and renders them

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function renderStats(stats) {
  const container = document.getElementById("stats-container");

  if (!stats || stats.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">🔍</div>
        <div>No posts monitored yet.<br/>Open a post on Facebook or Instagram.</div>
      </div>`;
    return;
  }

  // Show most recent first
  const sorted = [...stats].reverse();
  container.innerHTML = sorted.map(s => {
    const platform = s.platform || "unknown";
    const url = s.url ? new URL(s.url).pathname.substring(0, 40) + "…" : "Unknown URL";
    const badges = [
      s.likes    ? `❤️ ${s.likes}`    : null,
      s.comments ? `💬 ${s.comments}` : null,
      s.shares   ? `🔁 ${s.shares}`   : null,
      s.reach    ? `👁️ ${s.reach}`    : null,
    ].filter(Boolean);

    return `
      <div class="stat-row">
        <div class="stat-url" title="${s.url}">${url}</div>
        <div class="stat-badges">
          <span class="badge badge-platform">${platform}</span>
          ${badges.map(b => `<span class="badge">${b}</span>`).join("")}
          ${badges.length === 0 ? '<span class="badge">No stats found</span>' : ""}
        </div>
        <div class="stat-time">Updated ${timeAgo(s.updatedAt)}</div>
      </div>
    `;
  }).join("");
}

// Load and render
chrome.runtime.sendMessage({ type: "GET_STATS" }, (res) => {
  renderStats(res?.stats || []);
});

// Clear button
document.getElementById("clear-btn").addEventListener("click", () => {
  chrome.storage.local.set({ stats: [] }, () => renderStats([]));
});
