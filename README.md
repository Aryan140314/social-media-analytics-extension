# Social Media Analytics Extension (v2)

## 📌 Overview

Version 2 of the Social Media Analytics Extension introduces a sidebar-based UI, improved DOM extraction, and media handling features for Instagram and Facebook.

This version enhances usability and provides better interaction with extracted data.

---

## 🚀 Features

| Feature            | Description                                        |
| ------------------ | -------------------------------------------------- |
| Sidebar UI         | Interactive panel injected into social media pages |
| Post Analytics     | Extract likes, comments, and basic engagement data |
| Media Extraction   | Detect and collect image/video URLs                |
| Bulk Download      | Download multiple media files from posts           |
| Notifications      | Show alerts for actions like downloads             |
| Improved Selectors | More reliable DOM scraping logic                   |

---

## 🛠 Installation (Chrome / Edge)

### Step 1

Download or clone this repository

### Step 2

Open browser and go to:

```id="a1k29x"
chrome://extensions/
```

### Step 3

Enable:

```text id="z2mxo1"
Developer Mode
```

### Step 4

Click:

```text id="l9q1bc"
Load unpacked
```

### Step 5

Select the project folder

---

## ▶️ How to Use

1. Open Instagram or Facebook
2. Navigate to any post
3. Click on the extension icon
4. Sidebar will appear
5. View:

   * Likes
   * Comments
   * Media
6. Use download button to save media

---

## ⚠️ Limitations

* Relies on DOM structure (can break if UI changes)
* Not all posts expose full data
* Comment count may be approximate
* No API-based scraping yet

---

## 📂 Project Structure

```
manifest.json
background.js
content/
  injector.js
  sidebar.css
popup/
  popup.html
  popup.js
icons/
```

---

## 📈 Improvements Over v1

* Added UI (sidebar)
* Improved extraction logic
* Added media handling
* Better user interaction

---

## 💡 Future Plans

* Modular architecture (v3)
* API-based scraping (v4)
* Real-time analytics
* Data visualization
