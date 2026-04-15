# Social Media Analytics Extension (v7)

## 📌 Overview

Version 7 is the final production-ready version of the Social Media Analytics Extension. It features a robust and optimized data pipeline, improved API interception, enhanced analytics engine, and stable UI for real-time social media analysis.

This version focuses on performance, accuracy, and maintainability.

---

## 🚀 Features

| Feature                   | Description                                        |
| ------------------------- | -------------------------------------------------- |
| Advanced API Interception | Intercepts fetch and XMLHttpRequest requests       |
| Multi-Endpoint Support    | Handles GraphQL and multiple API responses         |
| Optimized Data Pipeline   | interceptor → monitor → extractor → analytics → UI |
| Improved Error Handling   | Prevents crashes and ensures stability             |
| Data Normalization        | Converts raw data into structured format           |
| Deduplication System      | Avoids duplicate data processing                   |
| Caching Layer             | Improves performance and efficiency                |
| Real-Time Monitoring      | Tracks engagement changes live                     |
| Advanced Analytics        | Engagement rate, growth rate, trend detection      |
| CSV Export                | Export analytics data easily                       |
| UI Optimization           | Faster and cleaner interface                       |

---

## 🛠 Installation (Chrome / Edge)

### Step 1

Download or clone this repository

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

* Depends on Instagram API (can change anytime)
* Requires active login for full data
* Some data may not be accessible
* Network interception may miss cached responses

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

## 📈 Improvements Over v6

* Optimized data pipeline performance
* Better error handling and recovery
* Improved UI responsiveness
* More accurate analytics calculations
* Reduced redundant processing

---

## 💡 Future Scope

* Machine Learning insights
* Trend prediction system
* Backend integration (Python/FastAPI)
* Advanced visualization dashboard
