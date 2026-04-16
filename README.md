# Social Media Analytics Extension (v8 - Updated)

## 📌 Overview

Version 8 (Updated) focuses on stabilizing the analytics pipeline, improving error handling, and ensuring consistent data extraction from Instagram API responses.

This version resolves previous issues related to unreliable data flow, UI crashes, and inconsistent extraction, making the extension significantly more stable and usable.

---

## 🚀 Features

| Feature                  | Description                                            |
| ------------------------ | ------------------------------------------------------ |
| API Interception         | Captures fetch and XMLHttpRequest calls from Instagram |
| GraphQL Data Extraction  | Extracts structured data from API responses            |
| Stabilized Data Pipeline | interceptor → monitor → extractor → analytics → UI     |
| Improved Error Handling  | Prevents crashes and logs errors safely                |
| Multi-Format Extraction  | Handles multiple API response structures               |
| Data Normalization       | Converts raw data into usable format                   |
| Deduplication System     | Prevents duplicate processing                          |
| Real-Time Monitoring     | Tracks engagement changes dynamically                  |
| Analytics Engine         | Calculates engagement rate and basic insights          |
| UI Stability Fixes       | Prevents null rendering and broken UI states           |

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
2. Navigate to any post
3. The extension automatically:

   * Intercepts API requests
   * Extracts structured data
4. Open the extension sidebar
5. View:

   * Likes
   * Comments
   * Engagement rate
   * Media URLs
6. Monitor updates in real time

---

## ⚠️ Limitations

* Depends on Instagram API structure (may change)
* Some data requires login session
* Not all metrics are publicly available
* Cached API responses may not always be captured

---

## 📂 Project Structure

```
manifest.json
background.js
content/
  interceptor.js
  monitor.js
  extractor.js
  analytics.js
  utils.js
  ui.js
  sidebar.css
popup/
  popup.html
  popup.js
icons/
```

---

## 📈 Improvements Over Previous v8

* Fixed pipeline break issues
* Improved extractor reliability (multi-format support)
* Added null safety across modules
* Prevented UI crashes on missing data
* Improved overall stability and consistency

---

## 💡 Future Scope

* Advanced analytics (growth trends, viral detection)
* Backend integration (Python / FastAPI)
* Data visualization dashboard
* AI-based insights
