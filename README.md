# Social Media Analytics Extension (v8)

## 📌 Overview

Version 8 is a stabilized and production-ready version of the Social Media Analytics Extension. It focuses on reliability, robust data extraction, improved error handling, and a consistent analytics pipeline.

The extension captures Instagram API responses, processes structured data, and provides real-time analytics through a modular architecture.

---

## 🚀 Features

| Feature                      | Description                                        |
| ---------------------------- | -------------------------------------------------- |
| Advanced API Interception    | Intercepts fetch and XMLHttpRequest calls          |
| Multi-Format Data Extraction | Handles multiple Instagram API response structures |
| Modular Pipeline             | interceptor → monitor → extractor → analytics → UI |
| Robust Error Handling        | Prevents crashes and ensures stable execution      |
| Data Normalization           | Converts raw API data into structured format       |
| Deduplication System         | Avoids duplicate processing                        |
| Caching Layer                | Improves performance                               |
| Real-Time Monitoring         | Tracks engagement changes dynamically              |
| Analytics Engine             | Engagement rate, growth rate, trend detection      |
| UI Stability Improvements    | Prevents null rendering and crashes                |
| CSV Export                   | Export analytics data                              |

---

## 🛠 Installation (Chrome / Edge)

### Step 1

Download or clone the repository

### Step 2

Open browser and go to:

```
chrome://extensions/
```

### Step 3

Enable **Developer Mode**

### Step 4

Click **Load unpacked**

### Step 5

Select the project folder

---

## ▶️ How to Use

1. Open Instagram
2. Navigate to a post
3. Extension automatically:

   * Intercepts API requests
   * Extracts structured data
4. Open extension sidebar
5. View:

   * Likes
   * Comments
   * Engagement rate
   * Media URLs
6. Enable monitoring for real-time updates
7. Export data using CSV option

---

## ⚠️ Limitations

* Depends on Instagram API (subject to change)
* Requires login for full data access
* Some endpoints may not always respond
* Cached requests may not be captured

---

## 📂 Project Structure

```
manifest.json
background.js
content/
  interceptor.js
  extractor.js
  analytics.js
  monitor.js
  utils.js
  ui.js
  sidebar.css
popup/
  popup.html
  popup.js
icons/
```

---

## 📈 Improvements Over v7

* Fixed pipeline instability issues
* Improved extractor robustness (multi-format support)
* Added null safety and error guards
* Better UI handling for missing data
* Reduced crashes and console errors

---

## 💡 Future Scope

* AI-based insights
* Trend prediction
* Backend integration (Python/FastAPI)
* Advanced visualization dashboard
