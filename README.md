# Social Post Monitor Pro

Social Post Monitor Pro is a Manifest V3 browser extension for monitoring social media posts directly inside the browser. It injects a sidebar into supported pages, intercepts platform API responses, extracts post and profile data, computes engagement analytics, stores historical snapshots, and lets the user download discovered media.

The current codebase is built as a plain JavaScript extension with no build step, no backend, and no external dependencies. It is designed to be loaded as an unpacked Chromium extension during development or demos.

## Project Summary

This project focuses on:

- capturing post data from page network traffic
- falling back to DOM scraping when API data is not available
- analyzing likes, comments, shares, reach, engagement, and viral signals
- storing per-post history in local extension storage
- presenting the results in a right-side in-page dashboard and a popup summary

Although the manifest includes permissions for both Instagram and Facebook, the extraction and interceptor logic is currently much more Instagram-oriented. Facebook support is best described as partial or future-facing rather than fully implemented.

## Core Features

### 1. In-page monitoring sidebar

When the content scripts load, the extension injects a floating toggle button and a fixed right sidebar. The sidebar contains six tabs:

- `Stats`
- `Comments`
- `Profile`
- `Analytics`
- `Downloads`
- `Settings`

The sidebar is defined in [`content/ui.js`](content/ui.js) and styled in [`content/sidebar.css`](content/sidebar.css).

### 2. API interception

The extension injects [`content/interceptor.js`](content/interceptor.js) into the page's main world so it can patch:

- `window.fetch`
- `XMLHttpRequest.open`
- `XMLHttpRequest.send`

It listens for GraphQL and `/api/v1/` responses, parses JSON payloads, and forwards relevant data back to the content script through `window.postMessage()`.

This is the main mechanism used to capture richer structured data than the DOM alone usually exposes.

### 3. Multi-shape post extraction

[`content/extractor.js`](content/extractor.js) normalizes several possible response shapes into a consistent internal post format. It extracts fields such as:

- post ID
- username
- followers
- likes
- comments
- shares
- reach or views
- caption
- hashtags
- mentions
- media URLs
- whether the post is a video
- timestamp
- source (`api` or `dom`)
- platform
- current page URL

If API data is missing, it can fall back to DOM-based heuristics for likes, comments, shares, and reach.

### 4. Historical tracking

The extension stores snapshots in `chrome.storage.local` using a unified storage model:

- `spm_data`: full per-post history and metadata
- `spm_recent`: lightweight recent items for the popup

Each snapshot can include:

- timestamp
- likes
- comments
- shares
- reach
- engagement rate
- viral score

This lets the extension show trends over time instead of only a single live reading.

### 5. Analytics engine

[`content/analytics.js`](content/analytics.js) computes:

- engagement rate
- interaction breakdown
- engagement tier
- growth rate over time
- average likes per hour
- peak likes per hour
- trend direction
- viral score

The viral score is based on a combination of:

- engagement rate when follower data exists
- absolute like count
- growth velocity
- comment-to-like ratio

### 6. Real-time alerts

The monitor can run on a timer and compare current likes against the previous reading. If a threshold is exceeded, it emits an alert and triggers a browser notification through the background service worker.

### 7. Media download support

The extension supports:

- downloading a single discovered media asset
- bulk-downloading all media from the current post
- bulk-downloading media from the visible profile grid

Downloads are handled by the background service worker in [`background.js`](background.js), which validates URLs before starting any download.

### 8. Popup summary

The toolbar popup defined in [`popup/popup.html`](popup/popup.html) and [`popup/popup.js`](popup/popup.js) shows a quick list of recently tracked posts, including:

- username
- like count
- capture timestamp
- source URL

## How the Extension Works

The main runtime flow is:

1. The content script bundle loads on Instagram or Facebook pages.
2. [`content/monitor.js`](content/monitor.js) injects `interceptor.js`.
3. `interceptor.js` captures API responses from the page.
4. The payload is sent back to the isolated content script context.
5. [`content/extractor.js`](content/extractor.js) extracts normalized post data.
6. [`content/analytics.js`](content/analytics.js) builds an analytics report.
7. [`content/utils.js`](content/utils.js) stores the snapshot in local storage.
8. [`content/ui.js`](content/ui.js) updates the sidebar UI.
9. [`background.js`](background.js) updates popup history, handles notifications, and starts downloads on request.

## Tech Stack

- JavaScript
- Chrome Extensions Manifest V3
- `chrome.storage`
- `chrome.downloads`
- `chrome.notifications`
- content scripts
- service worker background script
- direct DOM manipulation
- inline SVG charts

There is no framework, bundler, package manager, or server component in the current project.

## Folder Structure

```text
final-project/
|-- manifest.json
|-- background.js
|-- README.md
|-- content/
|   |-- analytics.js
|   |-- extractor.js
|   |-- interceptor.js
|   |-- monitor.js
|   |-- sidebar.css
|   |-- ui.js
|   `-- utils.js
|-- popup/
|   |-- popup.html
|   `-- popup.js
`-- icons/
    |-- icon16.png
    |-- icon48.png
    `-- icon128.png
```

## File-by-File Responsibilities

### `manifest.json`

- declares Manifest V3 configuration
- registers the service worker
- injects the content script bundle on supported hosts
- exposes `interceptor.js` and icons as web-accessible resources
- defines popup and extension icons

### `background.js`

- receives runtime messages
- validates download URLs
- handles single and bulk downloads
- creates notifications
- maintains `spm_recent` popup history
- clears stored data when requested

### `content/utils.js`

- shared constants
- logging helpers
- number and timestamp normalization
- dedup and cache helpers
- rate limit and debounce utilities
- storage abstraction (`SpmStorage`)
- safe message sending to the service worker
- schema and URL validation helpers
- formatting and text extraction helpers

### `content/extractor.js`

- filters API payloads
- recognizes multiple response shapes
- normalizes post objects
- extracts comments and profile information
- falls back to DOM scraping
- caches recent extraction results

### `content/analytics.js`

- computes engagement rate
- computes growth rate from historical snapshots
- generates a viral score
- builds a full UI-ready analytics report

### `content/monitor.js`

- coordinates the extraction pipeline
- injects the main-world interceptor
- listens for page messages
- handles SPA navigation changes
- stores snapshots and emits UI events
- runs optional auto-monitoring on a timer

### `content/ui.js`

- builds the full sidebar interface
- updates tab content from incoming reports
- renders charts and history tables
- supports comment search and copying
- triggers downloads and export
- handles sidebar visibility and theme behavior

### `content/sidebar.css`

- styles the sidebar, tabs, cards, charts, media grid, buttons, and dark mode behavior

### `popup/popup.html` and `popup/popup.js`

- provide a compact recent-history summary in the extension popup

## Installation

Because this is a raw extension project, installation is simple.

### Load as an unpacked extension

1. Download or clone this repository.
2. Open a Chromium-based browser such as Chrome or Edge.
3. Go to `chrome://extensions/` or `edge://extensions/`.
4. Enable `Developer mode`.
5. Click `Load unpacked`.
6. Select the project folder.

The extension should now appear in the browser toolbar.

## How to Use

### Basic flow

1. Open Instagram in the browser.
2. Visit a post, reel, or profile page.
3. Wait for the extension to inject its floating `SPM` toggle button and right sidebar.
4. Open the sidebar and review the tabs.
5. Use `Scrape DOM` if API data has not yet appeared.
6. Use `Start Auto Monitor` to track engagement changes over time.
7. Use `Download All Media` or `Profile Grid` if you want to save discovered assets.
8. Open the extension popup from the toolbar to view recently tracked posts.

### What each tab does

#### `Stats`

- shows likes, comments, shares, and reach or views
- displays engagement rate
- displays viral score and its signals
- includes the auto-monitor control
- includes a manual DOM scrape button

#### `Comments`

- loads extracted or DOM-scraped comments
- filters comments by text
- copies all comments to the clipboard

#### `Profile`

- shows author name, username, follower count, following count, posts, bio, and avatar when available

#### `Analytics`

- renders likes-over-time chart
- renders comments-over-time chart
- renders engagement-over-time chart
- shows growth information
- shows a recent history table

#### `Downloads`

- previews discovered media
- allows one-by-one downloads
- supports bulk downloads for the current post or visible profile grid

#### `Settings`

- includes UI controls for dark mode, notifications, auto-save, export, and clear data

## Data Storage Model

The main storage abstraction is implemented in [`content/utils.js`](content/utils.js).

### `spm_data`

Stores a record per post ID:

```json
{
  "postId": {
    "meta": {
      "postId": "123",
      "username": "example_user",
      "url": "https://www.instagram.com/p/...",
      "platform": "instagram",
      "lastSeen": 1710000000000
    },
    "history": [
      {
        "ts": 1710000000000,
        "likes": 1200,
        "comments": 45,
        "shares": 10,
        "reach": 8000,
        "engagement": 0.034,
        "viralScore": 62
      }
    ]
  }
}
```

### `spm_recent`

Stores a compact list for popup display, capped to recent entries.

## Permissions Used

The manifest currently requests:

- `storage`: save tracked history and settings-related data
- `downloads`: download media assets
- `notifications`: show alert notifications during monitoring

Host permissions:

- `https://www.instagram.com/*`
- `https://www.facebook.com/*`

## Important Limitations

### Instagram support is the primary implementation

Even though Facebook is listed in the manifest, much of the extraction logic is built around Instagram-style GraphQL and `/api/v1/` payloads. The README should therefore present Instagram as the main supported platform.

### Platform changes can break extraction

This project depends on the structure of live platform responses and DOM markup. If Instagram or Facebook changes:

- API field names
- response nesting
- page structure
- access restrictions

some features may stop working until the extractor is updated.

### Some metrics may be unavailable

Depending on the page type and what data is exposed, the extension may not always be able to determine:

- follower count
- shares
- reach or view count
- full comment data

When that happens, the extension falls back to partial data rather than failing completely.

### Several settings are only partially wired

The UI shows controls for:

- notifications
- auto-save snapshots
- dark mode persistence

but not all of these controls are fully persisted or connected to extension-wide behavior yet. The export and clear-data actions are functional; some of the other settings are currently more like UI scaffolding.

### No build, packaging, or automated tests are included

This repository currently does not include:

- `package.json`
- linting setup
- unit tests
- integration tests
- CI configuration
- extension store packaging scripts

It is best treated as a working prototype or academic project extension rather than a production-ready packaged product.

## Strengths of the Current Version

Compared with a simpler scraping-only extension, this version has several strong design choices:

- network-level interception instead of relying only on visible DOM text
- unified storage instead of split history sources
- safe service-worker message retry logic
- deduplication to avoid repeated processing
- analytics based on historical snapshots rather than single readings
- chart rendering and UI state guards to reduce crashes
- URL validation before downloads

## Suggested Future Improvements

Good next steps for the project would be:

1. add explicit Facebook extraction logic instead of only host-level support
2. persist user settings properly in `chrome.storage`
3. add CSV export in addition to JSON export
4. improve profile and comments extraction coverage
5. add test fixtures for known API response shapes
6. add a build or linting workflow
7. package the extension for release
8. add error telemetry or developer diagnostics mode

## Version

The current manifest and runtime constants identify this build as:

- `Social Post Monitor Pro`
- version `10.0.0`

## Notes for Reviewers or Instructors

If this repository is being submitted as a final project, the strongest parts to highlight are:

- browser extension architecture using Manifest V3
- API interception in the main page context
- structured extraction plus DOM fallback
- analytics and local-history tracking
- end-to-end UI integration without external libraries

At the same time, it is fair and accurate to describe the project as a functional prototype with strong front-end extension logic, but not yet a fully production-hardened cross-platform analytics product.
