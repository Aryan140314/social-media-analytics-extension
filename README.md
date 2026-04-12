# Social Media Analytics Extension (v5)

## 📌 Overview

Version 5 introduces a full data pipeline architecture for extracting, processing, and analyzing Instagram data using API interception and a modular analytics engine.

This version transforms the extension into a scalable analytics system with real-time monitoring, structured data processing, and advanced insights.

---

## 🚀 Features

| Feature               | Description                                              |
| --------------------- | -------------------------------------------------------- |
| API Interception      | Captures fetch & XMLHttpRequest calls                    |
| GraphQL Scraping      | Extracts structured Instagram API data                   |
| Modular Architecture  | Clean separation (interceptor, extractor, analytics, UI) |
| Data Normalization    | Converts raw values into consistent formats              |
| Deduplication & Cache | Prevents duplicate processing                            |
| History Tracking      | Stores engagement data over time                         |
| Analytics Engine      | Computes engagement, growth, viral score                 |
| Real-Time Monitoring  | Tracks changes in post metrics                           |
| CSV Export            | Export collected data                                    |
| Fallback System       | DOM scraping used if API fails                           |

---

## 🛠 Installation (Chrome / Edge)

### Step 1

Clone or download this repository

### Step 2

Open browser and go to:

```
chrome://extensions/
```

### Step 3

Enable:

```
Developer Mode
```

### Step 4

Click:

```
Load unpacked
```

### Step 5

Select the project folder

---

## ▶️ How to Use

1. Open Instagram
2. Navigate to a post
3. Extension automatically:

   * Intercepts API requests
   * Extracts structured data
4. Open extension panel
5. View:

   * Likes
   * Comments
   * Media
   * Engagement rate
6. Enable monitoring for real-time tracking
7. Export data using CSV button

---

## ⚠️ Limitations

* Depends on Instagram API structure (may change)
* Some endpoints require login
* Data availability varies by post type
* Network interception may miss cached requests

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

## 📈 Improvements Over v4

* Full data pipeline implementation
* Analytics engine added
* Deduplication and caching system
* History tracking
* Improved scalability and performance

---

## 💡 Future Scope

* Machine Learning insights
* Trend prediction
* Backend integration (Python/FastAPI)
* Advanced dashboard with charts
