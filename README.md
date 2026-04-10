# Social Media Analytics Extension (v3)

## 📌 Overview

Version 3 introduces a modular and scalable architecture for the Social Media Analytics Extension. The system is now divided into separate components for extraction, monitoring, and UI, improving maintainability and performance.

---

## 🚀 Features

| Feature                  | Description                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| Modular Architecture     | Separation of logic into extractor, monitor, UI, and utils modules |
| Improved Data Extraction | Cleaner and more structured DOM parsing                            |
| State Management         | Centralized handling of analytics data                             |
| Monitoring System        | Tracks changes in post metrics over time                           |
| Sidebar UI               | Enhanced interactive interface                                     |
| Media Handling           | Improved media detection and extraction                            |
| Persistent Storage       | Saves history using Chrome storage                                 |

---

## 🛠 Installation (Chrome / Edge)

### Step 1

Download or clone this repository

### Step 2

Open browser and go to:

```id="v1az9f"
chrome://extensions/
```

### Step 3

Enable:

```text id="w7yzq1"
Developer Mode
```

### Step 4

Click:

```text id="g91z2k"
Load unpacked
```

### Step 5

Select the project folder

---

## ▶️ How to Use

1. Open Instagram or Facebook
2. Navigate to a post
3. Click the extension icon
4. Sidebar will open
5. View:

   * Likes
   * Comments
   * Media URLs
6. Monitor changes in engagement over time
7. Use controls for downloading media

---

## ⚠️ Limitations

* Still relies on DOM scraping (not fully stable)
* Dynamic UI changes may break selectors
* API interception not yet implemented
* Limited accuracy for hidden metrics

---

## 📂 Project Structure

```id="q2n1bz"
manifest.json
background.js
content/
  extractor.js
  monitor.js
  ui.js
  utils.js
  sidebar.css
popup/
  popup.html
  popup.js
icons/
```

---

## 📈 Improvements Over v2

* Introduced modular architecture
* Improved maintainability
* Better performance and organization
* Added monitoring system
* Cleaner and reusable code

---

## 💡 Future Enhancements

* API-based scraping (GraphQL interception)
* Real-time analytics dashboard
* Chart visualization
* AI-based insights
