# Social Media Analytics Extension (v6)

## 📌 Overview

Version 6 is the most advanced version of the Social Media Analytics Extension, featuring a robust data pipeline, improved API interception, enhanced analytics engine, and better error handling.

This version focuses on stability, accuracy, and scalability, making the extension more reliable for real-time social media analysis.

---

## 🚀 Features

| Feature                   | Description                                        |
| ------------------------- | -------------------------------------------------- |
| Advanced API Interception | Intercepts fetch and XMLHttpRequest calls          |
| Multi-Endpoint Support    | Handles GraphQL and multiple API endpoints         |
| Modular Data Pipeline     | interceptor → monitor → extractor → analytics → UI |
| Improved Error Handling   | Prevents crashes and logs issues                   |
| Data Normalization        | Converts raw data into structured format           |
| Deduplication System      | Avoids duplicate data processing                   |
| Caching Layer             | Improves performance and reduces redundant work    |
| Real-Time Monitoring      | Tracks engagement changes over time                |
| Analytics Engine          | Computes engagement rate, growth, and trends       |
| CSV Export                | Export analytics data                              |
| UI Improvements           | Cleaner and more stable interface                  |

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
4. Open the extension panel
5. View:

   * Likes
   * Comments
   * Engagement rate
   * Media URLs
6. Enable monitoring for real-time updates
7. Export data using CSV option

---

## ⚠️ Limitations

* Depends on Instagram API (may change anytime)
* Some data requires login session
* Network interception may miss cached responses
* Not all metrics are publicly available

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

## 📈 Improvements Over v5

* Better error handling and stability
* Improved data pipeline reliability
* Enhanced UI performance
* More accurate data extraction
* Reduced crashes and undefined states

---

## 💡 Future Scope

* Machine Learning insights
* Trend prediction
* Backend integration (Python/FastAPI)
* Advanced visualization dashboard
