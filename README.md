# Social Media Analytics Extension (v4)

## 📌 Overview

Version 4 introduces API-based scraping using network interception (fetch and XMLHttpRequest), making data extraction significantly more reliable compared to DOM-based methods.

This version captures Instagram internal API (GraphQL) responses and extracts structured analytics data in real time.

---

## 🚀 Features

| Feature                  | Description                                         |
| ------------------------ | --------------------------------------------------- |
| API Interception         | Intercepts fetch and XMLHttpRequest calls           |
| GraphQL Scraping         | Extracts data directly from Instagram API responses |
| Reliable Data Extraction | More stable than DOM scraping                       |
| Real-Time Capture        | Captures live data as posts load                    |
| Structured Data Output   | Extracts normalized analytics data                  |
| Media Extraction         | Retrieves image/video URLs                          |
| Fallback System          | DOM scraping used when API data unavailable         |

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
3. The extension automatically:

   * Intercepts API requests
   * Extracts post data
4. Open the extension UI
5. View:

   * Likes
   * Comments
   * Caption
   * Media URLs
6. Monitor real-time updates

---

## ⚠️ Limitations

* Depends on Instagram API structure (may change)
* Some endpoints require user login
* Not all data is publicly accessible
* Interception may miss cached requests

---

## 📂 Project Structure

```
manifest.json
background.js
content/
  interceptor.js
  extractor.js
  monitor.js
  utils.js
  sidebar.css
popup/
  popup.html
  popup.js
icons/
```

---

## 📈 Improvements Over v3

* Added API interception layer
* Improved data reliability
* Reduced dependency on DOM
* Better performance and accuracy

---

## 💡 Future Enhancements (v5)

* Analytics engine
* Data visualization
* ML-based insights
* Backend integration (Python)
